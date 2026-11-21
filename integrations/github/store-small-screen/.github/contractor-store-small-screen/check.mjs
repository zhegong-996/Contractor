import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const [file, sha, reportFile] = process.argv.slice(2);
if (!file || !reportFile || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
  throw new Error('Expected an HTML path, a full commit SHA and a report path.');
}

const report = { schema: 1, check: 'contractor-store-small-screen', sha, browser: null, htmlSha256: null, viewports: [], cases: [], passed: false };
const failureText = {
  'missing-long-word': '缺少连续长词样例',
  'viewport-mismatch': '视口宽度不符',
  'hidden-text': '正文不可见或被裁切',
  'long-word-does-not-wrap': '连续长词未换行',
  'text-outside-viewport': '文字超出视口',
  'page-overflows': '页面横向溢出',
  'content-overflows': '正文横向溢出',
  'content-narrower-than-244': '正文可用宽度低于 244px',
};
async function captureViewport(browser, html, width, captures, recordings) {
  const viewport = { width, height: 800 };
  const context = await browser.newContext({ viewport, javaScriptEnabled: false, offline: true, deviceScaleFactor: 1,
    recordVideo: { dir: recordings, size: viewport } });
  let video;
  try {
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    video = page.video();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const sample = await page.evaluate(() => {
      const paragraphs = Array.from(document.querySelectorAll('p'));
      for (const paragraph of paragraphs) {
        const iterator = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        for (let node = iterator.nextNode(); node; node = iterator.nextNode()) {
          const word = /[A-Za-z0-9]{50,}/.exec(node.textContent ?? '');
          if (!word) continue;
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
          let visible = true;
          const origin = node.parentElement;
          for (let element = origin; element; element = element.parentElement) {
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            const left = bounds.left + element.clientLeft;
            const top = bounds.top + element.clientTop;
            const clipped = element !== document.documentElement && rects.some(rect =>
              ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) && (rect.left < left - 0.5 || rect.right > left + element.clientWidth + 0.5)
              || ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (rect.top < top - 0.5 || rect.bottom > top + element.clientHeight + 0.5));
            if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden'
              || element === origin && /^(transparent|rgba\(.+,\s*0\))$/.test(style.color) || clipped) {
              visible = false;
              break;
            }
          }
          return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
            contentWidth: paragraph.clientWidth, contentScroll: paragraph.scrollWidth, visible,
            wrapLines: new Set(rects.map(rect => Math.round(rect.top))).size,
            textOutsideViewport: rects.some(rect => rect.left < -0.5 || rect.right > innerWidth + 0.5) };
        }
      }
      return null;
    });
    await page.screenshot({ path: join(captures, 'viewport-' + width + '.png'), timeout: 10000 });
    // Keep the measured frame visible in this short clip of a static fixture.
    await delay(1200);
    return sample;
  } finally {
    await context.close();
    if (video) await video.saveAs(join(captures, 'viewport-' + width + '.webm'));
  }
}

const captures = join(dirname(reportFile), 'captures');
const recordings = await mkdtemp(join(tmpdir(), 'contractor-layout-video-'));
let browser;
try {
  await mkdir(captures, { recursive: true });
  const fileInfo = await lstat(file);
  if (!fileInfo.isFile() || fileInfo.size > 256 * 1024) throw new Error('Expected a regular HTML fixture of at most 256 KiB.');
  const html = await readFile(file, 'utf8');
  report.htmlSha256 = createHash('sha256').update(html).digest('hex');
  browser = await chromium.launch(process.env.CONTRACTOR_CHROMIUM ? { executablePath: process.env.CONTRACTOR_CHROMIUM } : {});
  report.browser = browser.version();
  for (const width of [280, 320, 360]) {
    const sample = await captureViewport(browser, html, width, captures, recordings);
    if (!sample) {
      report.viewports.push({ width, passed: false, failures: ['missing-long-word'] });
      continue;
    }
    const failures = [
      sample.viewport !== width && 'viewport-mismatch',
      !sample.visible && 'hidden-text',
      sample.wrapLines < 2 && 'long-word-does-not-wrap',
      sample.textOutsideViewport && 'text-outside-viewport',
      (sample.pageWidth > width || sample.bodyWidth > width) && 'page-overflows',
      sample.contentScroll > sample.contentWidth && 'content-overflows',
      width === 280 && sample.contentWidth < 244 && 'content-narrower-than-244',
    ].filter(Boolean);
    report.viewports.push({ width, ...sample, passed: failures.length === 0, failures });
  }
  report.passed = report.viewports.length === 3 && report.viewports.every(viewport => viewport.passed);
  report.cases = report.viewports.map(row => ({
    id: 'viewport-' + row.width, passed: row.passed,
    detail: [row.contentWidth === undefined ? '' : '正文 ' + row.contentWidth + 'px，长词 ' + row.wrapLines + ' 行',
      row.passed ? '页面和正文无横向溢出' : row.failures.map(code => failureText[code]).join('、')].filter(Boolean).join('。'),
  }));
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Evaluation failed';
} finally {
  try { await browser?.close(); }
  finally {
    await rm(recordings, { recursive: true, force: true });
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  }
}

for (const row of report.viewports) {
  console.log(`${row.width}px: ${row.passed ? 'passed' : row.failures.join(', ')}`
    + (row.contentWidth === undefined ? '' : ` (content ${row.contentWidth}px; lines ${row.wrapLines})`));
}
if (report.error) console.error(report.error);
if (!report.passed) process.exitCode = 1;
