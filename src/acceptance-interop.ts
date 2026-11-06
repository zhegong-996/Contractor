// Adapter between SuitMe's sealed Acceptance Plan / per-item round and the
// pinned `lobehub/acceptance` (Apache-2.0) report contract. The upstream is
// a submodule at a fixed commit; its source is never modified. We only READ
// its schema reference and emit `result.json`-shaped payloads that its CLI can
// ingest (`cases[].evidence` = { path, description }, frozen plan ids intact).
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './config.ts';
import { eventId, type CollabEvent } from './event-stream.ts';
import type { AcceptancePlan } from './acceptance-plan.ts';
import type { AcceptanceRound } from './acceptance-round.ts';

export const ACCEPTANCE_UPSTREAM = path.join(root, 'upstream/acceptance');

export interface AcceptancePlanEntry {
  id: string;
  title: string;
  category: string;
  verifier: 'program' | 'agent' | 'llm';
  method: string;
  expected: string;
  requiredEvidence: string[];
}
export interface AcceptanceCase {
  id: string;
  category: string;
  name: string;
  surface: 'web' | 'cli';
  status: 'pass' | 'fail' | 'blocked';
  observation: string;
  evidence: { path: string; description: string }[];
}
export interface AcceptanceReport {
  title: string;
  createdAt: string;
  entry: string;
  subject: string;
  surfaces: string[];
  plan: AcceptancePlanEntry[];
  cases: AcceptanceCase[];
  summary: { total: number; passed: number; failed: number; blocked: number;
    verdict: 'pass' | 'fail' | 'partial'; conclusion: string };
}

function evidenceTypeOf(item: AcceptancePlan['items'][number]): string {
  return item.evidenceKind === 'captured' ? 'screenshot' : item.evidenceKind === 'imported' ? 'text' : 'text';
}

export function upstreamInfo(): { version: string; commit: string; licensePath: string; schemaPath: string } {
  const plugin = path.join(ACCEPTANCE_UPSTREAM, '.claude-plugin/plugin.json');
  const schema = path.join(ACCEPTANCE_UPSTREAM, 'skills/acceptance/references/report-schema.md');
  const licensePath = path.join(ACCEPTANCE_UPSTREAM, 'LICENSE');
  if (!existsSync(plugin) || !existsSync(schema) || !existsSync(licensePath))
    throw new Error('lobehub/acceptance submodule 未初始化：请先 git submodule update --init upstream/acceptance');
  const meta = JSON.parse(readFileSync(plugin, 'utf8')) as { version: string; license: string };
  if (meta.license !== 'Apache-2.0') throw new Error(`acceptance 协议已变化：${meta.license}`);
  const lock = JSON.parse(readFileSync(path.join(root, 'sources.lock.json'), 'utf8')) as {
    sources: Record<string, { commit: string }>;
  };
  return { version: meta.version, commit: lock.sources.acceptance?.commit ?? '', licensePath, schemaPath: schema };
}

/** Frozen plan items keep their ids verbatim — upstream ingest rejects unknown case ids. */
export function toAcceptancePlanItems(plan: AcceptancePlan, verifier: AcceptancePlanEntry['verifier'] = 'agent'): AcceptancePlanEntry[] {
  return plan.items.map(item => ({
    id: item.id,
    title: item.name,
    category: 'SuitMe v0.6 锁定验收项',
    verifier,
    method: `按开工前锁定标准「${item.criteria}」核验，等级 ${plan.level}，评审者 ${plan.reviewer.model}`,
    expected: item.criteria,
    requiredEvidence: [evidenceTypeOf(item)],
  }));
}

export function toAcceptanceReport(input: {
  plan: AcceptancePlan;
  round: AcceptanceRound;
  events?: CollabEvent[];
  verifier?: AcceptancePlanEntry['verifier'];
  /** Visual artifacts whose bytes are available; paths become real PNG files. */
  screenshots?: { eventId: string; mimeType?: string }[];
}): AcceptanceReport {
  if (input.round.planHash !== input.plan.hash) throw new Error('验收清单已变更，不能导出验收报告');
  const byId = new Map((input.events ?? []).map(e => [eventId(e), e]));
  const screenshots = new Set((input.screenshots ?? []).map(s => s.eventId));
  const planEntries = toAcceptancePlanItems(input.plan, input.verifier);
  const cases: AcceptanceCase[] = input.plan.items.map(item => {
    const judgement = input.round.judgements.find(j => j.itemId === item.id);
    const status: AcceptanceCase['status'] = judgement?.status === 'passed' ? 'pass'
      : judgement?.status === 'failed' ? 'fail' : 'blocked';
    const evidence = (judgement?.evidenceRefs ?? []).map(ref => {
      const event = byId.get(ref);
      const isImage = screenshots.has(ref);
      const filename = `assets/${ref.replace(/[^a-zA-Z0-9_-]/g, '_')}.${isImage ? 'png' : 'txt'}`;
      return {
        path: filename,
        description: isImage
          ? `任务 ${input.plan.taskId} 第 ${input.round.round} 轮截图证据，事件 ${ref}；${item.criteria}`
          : `统一事件流中 ${event ? `${event.kind}/${event.actor}` : '证据引用'} ${ref} 的捕获记录${event ? `（来源 ${event.provenance}，时间 ${event.at}）` : ''}；用于核验「${item.criteria}」`,
      };
    });
    return {
      id: item.id,
      category: 'SuitMe v0.6 锁定验收项',
      name: item.name,
      surface: evidenceTypeOf(item) === 'screenshot' ? 'web' : 'cli',
      status,
      observation: judgement?.reason || `按开工前锁定标准逐项核验：${status === 'pass' ? '通过' : status === 'fail' ? '未通过' : '受阻，缺少可回放证据'}`,
      evidence,
    };
  });
  const passed = cases.filter(c => c.status === 'pass').length;
  const failed = cases.filter(c => c.status === 'fail').length;
  const blocked = cases.filter(c => c.status === 'blocked').length;
  const verdict: AcceptanceReport['summary']['verdict'] = passed === cases.length ? 'pass'
    : passed > 0 ? 'partial' : 'fail';
  return {
    title: `SuitMe v0.6 逐项验收报告：${input.plan.taskId}`,
    createdAt: input.round.createdAt,
    entry: `SuitMe v0.6 /workspace/v06-acceptance-export · 第 ${input.round.round} 轮`,
    subject: `task-${input.plan.taskId}`,
    surfaces: [...new Set(cases.map(c => c.surface))],
    plan: planEntries,
    cases,
    summary: { total: cases.length, passed, failed, blocked, verdict,
      conclusion: `独立评审者 ${input.round.reviewer.model} 按开工前锁定清单逐项判定：${passed} 项通过、${failed} 项未通过、${blocked} 项受阻。报告只提供证据，最终核可仍由原发起人在原会话确认验收。` },
  };
}

/** Static conformance check against the pinned upstream report-schema.md. */
export function assertAcceptanceReport(report: AcceptanceReport): void {
  const info = upstreamInfo();
  const schema = readFileSync(info.schemaPath, 'utf8');
  for (const field of ['"cases"', '"plan"', '"summary"', '"surfaces"', '"title"', '"createdAt"', '"entry"'])
    if (!schema.includes(field)) throw new Error(`上游报告规范缺少字段 ${field}`);
  const ids = new Set(report.plan.map(p => p.id));
  if (!report.title || !report.entry || !report.subject || !report.surfaces.length) throw new Error('报告缺少标题/入口/主体/界面');
  if (Number.isNaN(Date.parse(report.createdAt))) throw new Error('报告时间无效');
  for (const item of report.cases) {
    if (!ids.has(item.id)) throw new Error(`用例 ${item.id} 不在锁定清单内`);
    if (!['pass', 'fail', 'blocked'].includes(item.status)) throw new Error('用例状态不符合上游规范');
    for (const evidence of item.evidence) {
      if (!evidence.path.startsWith('assets/')) throw new Error('证据路径必须在 assets/ 内');
      if (!evidence.description || evidence.description.length < 12) throw new Error('每条证据必须有具体描述');
    }
    if (item.status === 'pass' && !item.evidence.length) throw new Error('通过的检查项必须有证据');
  }
  const { total, passed, failed, blocked, verdict } = report.summary;
  if (total !== report.cases.length || passed + failed + blocked !== total) throw new Error('汇总计数与逐项判定不一致');
  if (!['pass', 'fail', 'partial'].includes(verdict)) throw new Error('汇总结论不符合上游规范');
}

/** Write a real ingestible round directory: result.json + assets + report.md. */
export function writeAcceptanceBundle(dir: string, report: AcceptanceReport, input: {
  events?: CollabEvent[];
  screenshotBytes?: Record<string, { base64: string; mimeType?: string }>;
} = {}): string[] {
  assertAcceptanceReport(report);
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  // Several cases may cite the same captured event (one screenshot can prove
  // more than one criterion). Write it once and list it once.
  const written = new Set<string>();
  const byId = new Map((input.events ?? []).map(e => [eventId(e), e]));
  for (const item of report.cases) for (const evidence of item.evidence) {
    const ref = path.basename(evidence.path).replace(/\.(txt|png)$/, '');
    const event = [...byId.entries()].find(([id]) => id.replace(/[^a-zA-Z0-9_-]/g, '_') === ref)?.[1];
    const image = input.screenshotBytes?.[ref];
    if (evidence.path.endsWith('.png')) {
      if (!image) throw new Error(`缺少截图字节，不能伪造证据文件：${evidence.path}`);
      writeFileSync(path.join(dir, evidence.path), Buffer.from(image.base64, 'base64'), { mode: 0o600 });
    } else {
      writeFileSync(path.join(dir, evidence.path), JSON.stringify({
        ref, taskId: report.subject, capturedEvent: event ?? null,
        note: event ? '本文件是 SuitMe 统一事件流的可回放捕获记录' : '该证据引用未在当前事件快照中找到，需人工核对',
      }, null, 2), { mode: 0o600 });
    }
    written.add(evidence.path);
  }
  writeFileSync(path.join(dir, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  writeFileSync(path.join(dir, 'report.md'), `# 第 ${report.entry} 轮验收报告\n\n${report.summary.conclusion}\n\n` +
    `结论：${report.summary.verdict}（通过 ${report.summary.passed} / 未通过 ${report.summary.failed} / 受阻 ${report.summary.blocked}）\n\n` +
    `本报告由独立评审者产出，只提供证据，不替代原发起人在原会话「确认验收」。\n`, { mode: 0o600 });
  written.add('result.json'); written.add('report.md');
  return [...written];
}
