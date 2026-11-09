/**
 * 第三十八轮 · 交付流水线的独立审码阶段。
 *
 * RE-AUDIT「待补」第 4 项：交付链路是「提交 → 等 CI → 预览部署 → 线上核对」，
 * 中间的「审码」被合并进了验收 —— 于是同一批人既写又验，且验收要等预览起
 * 才行，问题发现得太晚。这一层把审码拆成**独立阶段**：
 *
 *   publish（提交 PR）→ sync（等 CI）→ **code-review（独立审码）** → preview（预览部署）→ accept（人签）
 *
 * 两个刻意的设计选择：
 *   1. **审码者是别人**：报告由独立阶段产出、单独落 Paperclip 文档，不与验收
 *      合并；它只提供证据，**不替代**原发起人在原会话「确认验收」；
 *   2. **判断可复算**：这里的规则是确定性的（不调模型），同一份 diff 永远得
 *      出同一份结论 —— 模型评审可以另外加，但不能成为唯一闸门，否则「为什么
 *      被拦」就说不清了。规则只覆盖「不涉及业务判断、但人一定会拦」的硬项。
 */
import { command } from './commands.ts';
import { runtime } from './config.ts';
import type { Config } from './config.ts';

export type ReviewSeverity = 'block' | 'warn' | 'info';
export type ReviewFinding = {
  rule: string;
  severity: ReviewSeverity;
  path?: string;
  line?: number;
  message: string;
  /** 命中的那几行原文（脱敏后），给人自助判断用，不做二次推断。 */
  excerpt?: string;
};
export type ReviewedFile = { path: string; added: number; removed: number; binary: boolean; addedLines: { text: string; line: number }[] };
export type CodeReviewReport = {
  schemaVersion: 1;
  baseSha: string;
  headSha: string;
  at: string;
  verdict: 'pass' | 'warn' | 'block';
  files: { path: string; added: number; removed: number; binary: boolean }[];
  stats: { files: number; added: number; removed: number };
  findings: ReviewFinding[];
  /** 明确写清本报告的边界，避免被当成验收结论使用。 */
  boundary: string;
};

const BOUNDARY = '本报告是独立审码阶段的证据，不是验收结论；最终「确认验收」仍由原发起人在原会话用中文完成。';

/** 解析 `git diff` 的统一格式；只取新增行，用于逐条规则比对。 */
export function parseUnifiedDiff(text: string): ReviewedFile[] {
  const files: ReviewedFile[] = [];
  let current: ReviewedFile | undefined;
  let lineNo = 0;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      current = { path: match?.[2] ?? raw.slice(11).trim(), added: 0, removed: 0, binary: false, addedLines: [] };
      files.push(current); continue;
    }
    if (!current) continue;
    if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) { current.binary = true; continue; }
    if (raw.startsWith('@@')) {
      const match = /\+(\d+)(?:,\d+)?/.exec(raw);
      lineNo = match ? Number(match[1]) : 0; continue;
    }
    if (raw.startsWith('+++ ') || raw.startsWith('--- ')) continue;
    if (raw.startsWith('+')) {
      current.added += 1;
      current.addedLines.push({ text: raw.slice(1), line: lineNo });
      lineNo += 1; continue;
    }
    if (raw.startsWith('-')) { current.removed += 1; continue; }
    lineNo += 1;
  }
  return files;
}

/** 只脱敏展示，不把命中的密钥原文带进报告 / 文档 / 日志。 */
function mask(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length <= 12) return '***';
  return trimmed.slice(0, 8) + '***' + trimmed.slice(-4);
}

/** 硬密钥形态：命中即 block —— 这类东西一旦进仓库就不可撤销。 */
const SECRET_RULES: { rule: string; pattern: RegExp; message: string }[] = [
  { rule: 'secret/aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/, message: '看起来是 AWS Access Key，进了仓库就只能轮换' },
  { rule: 'secret/private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, message: '私钥不能进仓库' },
  { rule: 'secret/openai-style-key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/, message: '看起来是模型服务密钥' },
  { rule: 'secret/github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, message: '看起来是 GitHub Token' },
  { rule: 'secret/feishu-app-secret', pattern: /\b(?:app_secret|appSecret)\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/, message: '飞书 App Secret 不能写进代码' },
  { rule: 'secret/assignment', pattern: /\b(?:password|passwd|api[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, message: '疑似把口令 / 密钥写死在代码或配置里' },
];

/** 调试残留：只 warn —— 有时是有意的诊断代码，交给人看。 */
const NOISE_RULES: { rule: string; pattern: RegExp; message: string }[] = [
  { rule: 'noise/debugger', pattern: /^\s*debugger\s*;?\s*$/, message: '调试器断点没有删' },
  { rule: 'noise/console-log', pattern: /^\s*console\.(?:log|debug)\(/, message: '调试输出留在代码里（除非是 CLI 的正常输出）' },
  { rule: 'noise/only-test', pattern: /\.only\(/, message: '测试里的 .only 会让其它用例静默跳过' },
  { rule: 'noise/skip-test', pattern: /\.skip\(|xit\(|xdescribe\(/, message: '被跳过的测试要么修好，要么写清原因' },
];

/**
 * 确定性审码：同一份 diff 永远同一份结论。
 * 只判「人一定会拦」的硬项与「人一定会问」的软项，不冒充业务判断。
 */
export function reviewCode(input: { baseSha: string; headSha: string; diff: string; at?: string }): CodeReviewReport {
  const files = parseUnifiedDiff(input.diff);
  const findings: ReviewFinding[] = [];
  const push = (finding: ReviewFinding) => {
    // 同一规则同一文件同一行只报一次，避免大 diff 把报告刷满。
    if (findings.some(f => f.rule === finding.rule && f.path === finding.path && f.line === finding.line)) return;
    findings.push(finding);
  };

  for (const file of files) {
    const isSource = /\.(?:ts|tsx|js|jsx|mjs|cjs|vue|py|go|rs|java|rb|php|sh)$/.test(file.path);
    for (const { text, line } of file.addedLines) {
      for (const rule of SECRET_RULES) {
        if (rule.pattern.test(text)) push({ rule: rule.rule, severity: 'block', path: file.path, line, message: rule.message, excerpt: mask(text) });
      }
      if (!isSource) continue;
      for (const rule of NOISE_RULES) {
        if (rule.pattern.test(text)) push({ rule: rule.rule, severity: 'warn', path: file.path, line, message: rule.message, excerpt: text.trim().slice(0, 120) });
      }
    }
    // 环境文件与锁文件：不是绝对不能动，但必须有人明确知道。
    if (/(^|\/)\.env(?:\.|$)/.test(file.path) && !/\.example$/.test(file.path)) {
      push({ rule: 'file/env-changed', severity: 'block', path: file.path, message: '环境文件带着真实凭据，不能进仓库；用 .env.example 描述字段' });
    }
    if (file.path.startsWith('upstream/')) {
      push({ rule: 'file/upstream-edited', severity: 'warn', path: file.path, message: '直接改上游子模块会让下一次同步冲突；适配层应写在 src/' });
    }
  }

  const stats = files.reduce((acc, file) => ({ files: acc.files + 1, added: acc.added + file.added, removed: acc.removed + file.removed }),
    { files: 0, added: 0, removed: 0 });
  // 大 diff 不是错误，但「一眼看不出改了什么」本身就是要人注意的信号。
  if (stats.added + stats.removed > 800) {
    push({ rule: 'size/large-diff', severity: 'warn', message: `本次改动 ${stats.added + stats.removed} 行，建议拆小再验；大 diff 的验收通过率低` });
  }
  const touchedSource = files.some(file => /^(?:src|plugins)\//.test(file.path) && !/\.(?:md|json)$/.test(file.path));
  const touchedTests = files.some(file => /^tests\//.test(file.path) || /\.test\.(?:ts|js|mjs)$/.test(file.path));
  if (touchedSource && !touchedTests) {
    push({ rule: 'tests/missing', severity: 'warn', message: '改了实现但没动测试：要么补一个会失败的用例，要么在交付说明里写清为什么不需要' });
  }
  if (!files.length) push({ rule: 'diff/empty', severity: 'info', message: '这次交付没有代码差异（可能只改了文档或配置）' });

  const verdict: CodeReviewReport['verdict'] = findings.some(f => f.severity === 'block') ? 'block'
    : findings.some(f => f.severity === 'warn') ? 'warn' : 'pass';
  return {
    schemaVersion: 1, baseSha: input.baseSha, headSha: input.headSha,
    at: input.at ?? new Date().toISOString(), verdict, files,
    stats, findings, boundary: BOUNDARY,
  };
}

/**
 * 闸门：只有 block 级 findings 会拦住预览部署。
 * 关掉 enforce 时降级为「记录但不拦」，并在报告里如实说明 —— 不假装审过。
 */
export function assertCodeReviewGate(report: CodeReviewReport, enforce: boolean): void {
  if (!enforce) return;
  const blocking = report.findings.filter(finding => finding.severity === 'block');
  if (!blocking.length) return;
  const head = blocking.slice(0, 3).map(finding => `${finding.rule}${finding.path ? `（${finding.path}${finding.line ? `:${finding.line}` : ''}）` : ''}`).join('；');
  throw new Error(`独立审码未通过（${blocking.length} 项阻断：${head}${blocking.length > 3 ? ' 等' : ''}）。请先修掉再部署预览；审码报告只是证据，验收仍由原发起人在原会话确认。`);
}

/**
 * 从本机裸仓库取 diff 并跑审码。
 *
 * base 缺省用 `main` 与本次交付的 merge-base —— 审「这次改动相对主干的差」，
 * 而不是相对上一个同名分支（后者会把别人的提交算进来）。取不到就如实记一条
 * `review/unavailable` 的待确认项，不静默跳过。
 */
export async function reviewDelivery(orig: { config: Config; headSha: string; baseSha?: string; at?: string }): Promise<CodeReviewReport> {
  const bare = runtime('git', 'repos', `${orig.config.delivery.repoName}.git`);
  try {
    const baseSha = orig.baseSha
      ?? (await command('git', ['--git-dir', bare, 'merge-base', 'refs/heads/main', orig.headSha])).trim();
    if (!baseSha) throw new Error('没有可用的 base 提交');
    const diff = await command('git', ['--git-dir', bare, 'diff', `${baseSha}..${orig.headSha}`]);
    return reviewCode({ baseSha, headSha: orig.headSha, diff, ...(orig.at ? { at: orig.at } : {}) });
  } catch (error) {
    // 取不到 diff 不等于「没问题」：给 warn 让人看一眼，但不拿它阻断部署。
    const message = String(error instanceof Error ? error.message : error).slice(0, 200);
    return {
      schemaVersion: 1, baseSha: orig.baseSha ?? '', headSha: orig.headSha,
      at: orig.at ?? new Date().toISOString(), verdict: 'warn', files: [],
      stats: { files: 0, added: 0, removed: 0 },
      findings: [{ rule: 'review/unavailable', severity: 'warn', message: `取不到本次交付的 diff（${message}），本次审码未真正执行` }],
      boundary: BOUNDARY,
    };
  }
}

/** 报告转成给人读的中文摘要（落 Paperclip 文档与通知用）。 */
export function codeReviewLines(report: CodeReviewReport): string[] {
  const verdict = { pass: '通过（无需处理项）', warn: '通过（有待确认项）', block: '未通过（有阻断项）' }[report.verdict];
  const lines = [
    `结论：${verdict}`,
    `范围：${report.baseSha.slice(0, 8)}..${report.headSha.slice(0, 8)} · ${report.stats.files} 个文件 · +${report.stats.added}/-${report.stats.removed}`,
  ];
  if (!report.findings.length) lines.push('处理项：无');
  for (const finding of report.findings) {
    const level = { block: '阻断', warn: '待确认', info: '说明' }[finding.severity];
    const where = finding.path ? ` · ${finding.path}${finding.line ? `:${finding.line}` : ''}` : '';
    lines.push(`[${level}] ${finding.rule}${where} —— ${finding.message}`);
  }
  lines.push(`边界：${report.boundary}`);
  return lines;
}
