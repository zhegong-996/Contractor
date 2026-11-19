import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { WorkbenchError, requireValue } from './errors.ts';
import { digest } from './knowledge.ts';
import type { ProductVerificationState } from './product-verification.ts';

export const resultVersionInput = z.object({
  ticket: z.string().min(1).max(80),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ResultVersion = z.infer<typeof resultVersionInput>;
const term = z.string().trim().min(1).max(160);
const selectedCheck = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), terms: z.array(term).min(1).max(8)
    .refine(items => new Set(items.map(item => item.toLowerCase())).size === items.length), citation: z.boolean() }).strict(),
  z.object({ kind: z.literal('manual'), id: z.string().min(1).max(48) }).strict(),
  z.object({ kind: z.literal('browser'), id: z.string().min(1).max(48) }).strict(),
]);
export const regressionCaseInput = z.object({
  title: z.string().trim().min(1).max(140), baseline: resultVersionInput, check: selectedCheck,
}).strict();
export const regressionCompareInput = z.object({ case: z.string().regex(/^[a-f0-9]{64}$/), candidate: resultVersionInput }).strict();

type CaseInput = z.infer<typeof regressionCaseInput>;
type Result = {
  project: string; topic?: string; requestHash: string; body: string; citations: number; version: number;
  title: string; run: number; attempt: number;
  product?: ProductVerificationState;
  provenance: {
    agent: string; agentVersion: string; policyVersion?: string; prompt: string;
    skills: { id: string; revision: string }[];
    sources: { id: string; revision: string }[];
    requestedModel?: string; reportedModel?: string;
    template?: { id: string; version: number };
  };
};
type Criterion = Extract<CaseInput['check'], { kind: 'answer' }> |
  { kind: 'manual' | 'browser'; id: string; title: string; expectation: string };
type RegressionCase = {
  id: string; title: string; baseline: ResultVersion; criterion: Criterion; baselineReview: Evaluation; createdAt: string;
};
type Evaluation = ReturnType<typeof evaluate>;
type StoredComparison = {
  id: string; case: string; baseline: Evaluation; candidate: Evaluation; at: string;
};

const missing = (message: string) => ({ status: 'unavailable' as const, detail: message });

function evaluate(ref: ResultVersion, result: Result, criterion: Criterion) {
  const view = { ...ref, title: result.title, version: result.version, run: result.run, attempt: result.attempt, provenance: result.provenance };
  if (criterion.kind === 'answer') {
    const body = result.body.normalize('NFKC').toLowerCase();
    const absent = criterion.terms.filter(value => !body.includes(value.normalize('NFKC').toLowerCase()));
    const needsCitation = criterion.citation && !result.citations;
    return { ...view, status: absent.length || needsCitation ? 'failed' as const : 'passed' as const,
      detail: [...(absent.length ? ['缺少 ' + absent.join('、')] : []), ...(needsCitation ? ['缺少已登记的知识引用'] : [])].join('。')
        || '指定字词和引用条件已核对。' };
  }
  const observed = result.product?.cases.find(row => row.id === criterion.id && row.kind === criterion.kind);
  if (!observed || observed.title !== criterion.title || observed.expectation !== criterion.expectation)
    return { ...view, ...missing('此版没有同一口径的原始检查。') };
  if (observed.state === 'pending') return { ...view, ...missing('此版的检查证据尚未记录。') };
  const proof = observed.kind === 'manual' ? observed.result?.sequence : result.product?.execution?.proof?.checkId;
  return { ...view, status: observed.state, detail: observed.state === 'passed' ? '对应版本的检查已通过。' : '对应版本的检查未通过。',
    proof, head: result.product?.head };
}

export function openRegressionReview(db: DatabaseSync, read: (actor: string, ref: ResultVersion) => Result | undefined) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_regression_case (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workbench_regression_comparison (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, case_id TEXT NOT NULL, value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workbench_regression_case_project ON workbench_regression_case(project);
    CREATE INDEX IF NOT EXISTS workbench_regression_comparison_project ON workbench_regression_comparison(project,case_id);
  `);
  const get = (project: string, id: string): RegressionCase | undefined => {
    const row = db.prepare('SELECT value FROM workbench_regression_case WHERE project=? AND id=?').get(project, id);
    return row && JSON.parse(String(row.value));
  };
  const visible = (actor: string, project: string, ref: ResultVersion) => {
    const result = read(actor, ref);
    return result?.project === project ? result : undefined;
  };
  return {
    list(actor: string, project: string) {
      const cases = db.prepare('SELECT value FROM workbench_regression_case WHERE project=? ORDER BY rowid DESC').all(project)
        .flatMap(row => {
          const item = JSON.parse(String(row.value)) as RegressionCase;
          return visible(actor, project, item.baseline) ? [item] : [];
        });
      const accessible = new Set(cases.map(item => item.id));
      const comparisons = db.prepare('SELECT value FROM workbench_regression_comparison WHERE project=? ORDER BY rowid DESC').all(project)
        .flatMap(row => {
          const item = JSON.parse(String(row.value)) as StoredComparison;
          return accessible.has(item.case) && visible(actor, project, item.candidate) ? [item] : [];
        });
      return { cases, comparisons };
    },
    create(actor: string, project: string, input: CaseInput) {
      const baseline = requireValue(visible(actor, project, input.baseline), '找不到当前可读的基准成果。', 404);
      let criterion: Criterion;
      if (input.check.kind === 'answer') criterion = input.check;
      else {
        const check = input.check;
        const item = requireValue(baseline.product?.cases.find(row => row.id === check.id && row.kind === check.kind && row.state !== 'pending'),
          '请选择已有结果的验收检查。', 409);
        criterion = { kind: item.kind, id: item.id, title: item.title, expectation: item.expectation };
      }
      const id = digest({ project, baseline: input.baseline, criterion });
      const entry: RegressionCase = { id, title: input.title, baseline: input.baseline, criterion,
        baselineReview: evaluate(input.baseline, baseline, criterion), createdAt: new Date().toISOString() };
      db.prepare('INSERT OR IGNORE INTO workbench_regression_case VALUES (?,?,?)').run(id, project, JSON.stringify(entry));
      return get(project, id)!;
    },
    compare(actor: string, project: string, input: z.infer<typeof regressionCompareInput>) {
      const item = requireValue(get(project, input.case), '找不到回归用例。', 404);
      const baseline = requireValue(visible(actor, project, item.baseline), '基准成果当前不可读。', 404);
      const candidate = requireValue(visible(actor, project, input.candidate), '候选成果当前不可读。', 404);
      if (item.baseline.ticket === input.candidate.ticket && item.baseline.revision === input.candidate.revision)
        throw new WorkbenchError('请选择另一份成果版本。', 409);
      if (baseline.topic !== candidate.topic || baseline.requestHash !== candidate.requestHash && item.criterion.kind === 'answer')
        throw new WorkbenchError('请选择同一主题下的可比成果。回答用例还要求原始请求一致。', 409);
      const comparison = { case: item.id, baseline: item.baselineReview,
        candidate: evaluate(input.candidate, candidate, item.criterion) };
      const id = digest(comparison);
      const entry = { ...comparison, id, at: new Date().toISOString() };
      db.prepare('INSERT OR IGNORE INTO workbench_regression_comparison VALUES (?,?,?,?)').run(id, project, item.id, JSON.stringify(entry));
      const row = db.prepare('SELECT value FROM workbench_regression_comparison WHERE project=? AND id=?').get(project, id);
      return JSON.parse(String(row!.value)) as StoredComparison;
    },
  };
}
