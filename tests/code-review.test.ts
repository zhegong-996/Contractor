// 第三十八轮 · 交付前独立审码（src/code-review.ts）。
//
// 红线：同一份 diff 永远得出同一份结论（确定性，不靠模型）；密钥类问题一律
// block 且报告里只留脱敏片段；报告边界必须写明「不是验收结论」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff, reviewCode, assertCodeReviewGate, codeReviewLines } from '../src/code-review.ts';

const diffOf = (file: string, lines: string[]) => [
  `diff --git a/${file} b/${file}`, 'index 1111111..2222222 100644', `--- a/${file}`, `+++ b/${file}`,
  `@@ -1,2 +1,${lines.length + 1} @@`, ' const keep = 1;', ...lines.map(line => '+' + line), '',
].join('\n');

test('解析统一 diff：文件、增删行数与新增行行号', () => {
  const files = parseUnifiedDiff(diffOf('src/a.ts', ['const a = 1;', 'const b = 2;']));
  assert.equal(files.length, 1);
  assert.equal(files[0]!.path, 'src/a.ts');
  assert.equal(files[0]!.added, 2);
  assert.equal(files[0]!.removed, 0);
  // diffOf 里第一行是上下文行，所以新增行从第 2 行起 —— 行号要按真实位置算。
  assert.deepEqual(files[0]!.addedLines.map(line => line.line), [2, 3]);
});

test('密钥进代码一律阻断，且报告里不留原文', () => {
  const report = reviewCode({ baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
    diff: diffOf('src/keys.ts', ['const k = "AKIAIOSFODNN7EXAMPLE";']) });
  assert.equal(report.verdict, 'block');
  const finding = report.findings.find(item => item.rule === 'secret/aws-access-key');
  assert.ok(finding, '必须报出 AWS 形态的密钥');
  assert.ok(!finding!.excerpt!.includes('AKIAIOSFODNN7EXAMPLE'), '报告里不能留密钥原文');
  assert.match(report.boundary, /不是验收结论/);
});

test('环境文件写进仓库直接阻断；私钥同样阻断', () => {
  const env = reviewCode({ baseSha: 'x', headSha: 'y', diff: diffOf('.env', ['TOKEN=abcdef123456']) });
  assert.equal(env.verdict, 'block');
  assert.ok(env.findings.some(item => item.rule === 'file/env-changed'));
  const key = reviewCode({ baseSha: 'x', headSha: 'y', diff: diffOf('deploy/id_rsa', ['-----BEGIN OPENSSH PRIVATE KEY-----']) });
  assert.ok(key.findings.some(item => item.rule === 'secret/private-key' && item.severity === 'block'));
});

test('调试残留与缺测试只是待确认，不阻断', () => {
  const report = reviewCode({ baseSha: 'x', headSha: 'y',
    diff: diffOf('src/thing.ts', ['console.log("why");', 'debugger;']) });
  assert.equal(report.verdict, 'warn');
  assert.ok(report.findings.every(item => item.severity !== 'block'));
  assert.ok(report.findings.some(item => item.rule === 'noise/console-log'));
  assert.ok(report.findings.some(item => item.rule === 'tests/missing'));
  // 改了测试就不再提示缺测试。
  const withTests = reviewCode({ baseSha: 'x', headSha: 'y',
    diff: [diffOf('src/thing.ts', ['const ok = true;']), diffOf('tests/thing.test.ts', ['assert.ok(ok);'])].join('\n') });
  assert.ok(!withTests.findings.some(item => item.rule === 'tests/missing'));
});

test('闸门只拦阻断项；关掉 enforce 时如实记录但不拦', () => {
  const blocking = reviewCode({ baseSha: 'x', headSha: 'y', diff: diffOf('src/k.ts', ['const key = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";']) });
  assert.throws(() => assertCodeReviewGate(blocking, true), /独立审码未通过.*验收仍由原发起人/);
  assert.doesNotThrow(() => assertCodeReviewGate(blocking, false));
  const warnOnly = reviewCode({ baseSha: 'x', headSha: 'y', diff: diffOf('src/t.ts', ['debugger;']) });
  assert.doesNotThrow(() => assertCodeReviewGate(warnOnly, true), '待确认项不该拦住部署');
});

test('人读摘要逐条列处理项，并写明边界', () => {
  const report = reviewCode({ baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
    diff: diffOf('src/app.js', ['console.log(1);']), at: '2026-11-09T10:00:00.000Z' });
  const lines = codeReviewLines(report);
  assert.match(lines[0]!, /通过（有待确认项）/);
  assert.ok(lines.some(line => /^\[待确认\] noise\/console-log · src\/app\.js:2/.test(line)));
  assert.ok(lines[lines.length - 1]!.startsWith('边界：'));
});
