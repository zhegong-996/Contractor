import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { DeliveryTemplate } from './delivery-template.ts';
import { WorkbenchError } from './errors.ts';
import { pullChecks, requiredCheckSchema } from './github-delivery.ts';
import { digest } from './knowledge.ts';
import type { DeliveryEvidence, Work } from './work-types.ts';

const caseId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const title = z.string().trim().min(1).max(140);
const expectation = z.string().trim().min(1).max(660);
const uniqueCases = (rows: { id: string }[]) => new Set(rows.map(row => row.id)).size === rows.length;
const namedCase = z.object({ id: caseId, title, expectation }).strict();
export const manualCasesInput = z.array(z.object({ title, expectation }).strict()).max(8);
export type ManualCase = z.infer<typeof namedCase>;
const trustedPath = z.string().max(200).regex(/^[.a-zA-Z0-9_-]+(?:\/[.a-zA-Z0-9_-]+)*$/)
  .refine(value => value.split('/').every(part => part !== '.' && part !== '..'));
export const productTemplateSchema = z.object({
  manual: z.array(namedCase.refine(item => !item.id.startsWith('task-'))).max(16).refine(uniqueCases).optional(),
  browser: z.object({
    check: requiredCheckSchema.extend({ app: z.literal('github-actions'), appId: z.number().int().positive() }).strict(),
    workflow: trustedPath.refine(value => /^\.github\/workflows\/[a-zA-Z0-9_-]+\.ya?ml$/.test(value)),
    trustedFiles: z.array(z.object({ path: trustedPath, blob: z.string().regex(/^[a-f0-9]{40}$/) }).strict()).min(1).max(12),
    artifact: caseId,
    captures: z.literal(true).optional(),
    cases: z.array(namedCase).min(1).max(20).refine(uniqueCases),
  }).strict().refine(value => value.trustedFiles.some(item => item.path === value.workflow)
    && new Set(value.trustedFiles.map(item => item.path)).size === value.trustedFiles.length, '请固定工作流与每个验证文件的 Git blob。').optional(),
}).strict().refine(value => !!(value.manual?.length || value.browser), '至少配置一条验收条件。');
export type BrowserVerification = NonNullable<z.infer<typeof productTemplateSchema>['browser']>;
export const browserCaseResult = z.object({
  id: caseId, passed: z.boolean(), detail: z.string().trim().min(1).max(400),
}).strict();
const captureKind = z.enum(['screenshot', 'recording']);
export const productCaptureInput = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/), check: z.coerce.number().int().positive().safe(), case: caseId, kind: captureKind,
}).strict();
export const captureFormats = {
  screenshot: { type: 'image/png', extension: 'png', limit: 768 * 1024, signature: '89504e470d0a1a0a' },
  recording: { type: 'video/webm', extension: 'webm', limit: 2 * 1024 * 1024, signature: '1a45dfa3' },
} as const;
export type BrowserCapture = { case: string; kind: z.infer<typeof captureKind>; bytes: Buffer };
export type BrowserProof = {
  plan: string; head: string; checkId: number; run: number; attempt: number; artifact: number; url: string;
  executor: 'github-actions'; browser: string; labels: string[]; cases: z.infer<typeof browserCaseResult>[];
  captures?: true;
};
export type BrowserReceipt = { proof: BrowserProof; captures: BrowserCapture[] };
export type HumanCheck = { id: string; passed: boolean; note: string; actor: string; at: string };
export const humanCheckInput = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/), case: caseId, passed: z.boolean(), note: z.string().trim().min(1).max(700),
  previous: z.number().int().nonnegative(), head: z.string().regex(/^[a-f0-9]{40}$/).optional(),
}).strict();

export function freezeManualCases(cases: z.infer<typeof manualCasesInput> = []): ManualCase[] {
  return cases.map((row, index) => ({ id: 'task-' + (index + 1), ...row }));
}

export function browserPlan(template?: DeliveryTemplate) {
  const browser = template?.product?.browser;
  if (browser) return digest({ template: template.id, version: template.version, repository: template.repository, browser });
}

export function browserCheck(spec: BrowserVerification, delivery: DeliveryEvidence) {
  return pullChecks(delivery.headSha, delivery.checks ?? [], [spec.check]).checks[0];
}

export function openProductVerification(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_product_browser (
      ticket TEXT NOT NULL, revision TEXT NOT NULL, check_id INTEGER NOT NULL, plan TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(ticket,revision,check_id,plan)
    );
    CREATE TABLE IF NOT EXISTS workbench_product_capture (
      ticket TEXT NOT NULL, revision TEXT NOT NULL, check_id INTEGER NOT NULL, plan TEXT NOT NULL,
      case_id TEXT NOT NULL, kind TEXT NOT NULL, bytes BLOB NOT NULL,
      PRIMARY KEY(ticket,revision,check_id,plan,case_id,kind)
    );
    CREATE TABLE IF NOT EXISTS workbench_product_manual (
      ticket TEXT NOT NULL, revision TEXT NOT NULL, target TEXT NOT NULL, case_id TEXT NOT NULL, sequence INTEGER NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(ticket,revision,target,case_id,sequence)
    );
  `);
  const targetOf = (head?: string) => head ?? 'result';
  const recordBrowser = (ticket: string, revision: string, { proof, captures }: BrowserReceipt) => {
    const key = [ticket, revision, proof.checkId, proof.plan] as const;
    const inserted = db.prepare('INSERT OR IGNORE INTO workbench_product_browser VALUES (?,?,?,?,?)')
      .run(...key, JSON.stringify(proof));
    if (inserted.changes && captures.length) {
      const add = db.prepare('INSERT INTO workbench_product_capture VALUES (?,?,?,?,?,?,?)');
      for (const item of captures) add.run(...key, item.case, item.kind, item.bytes);
    }
    return inserted;
  };
  const capture = (ticket: string, revision: string, proof: BrowserProof, id: string, kind: BrowserCapture['kind']) => {
    const row = db.prepare('SELECT bytes FROM workbench_product_capture WHERE ticket=? AND revision=? AND check_id=? AND plan=? AND case_id=? AND kind=?')
      .get(ticket, revision, proof.checkId, proof.plan, id, kind);
    return row?.bytes instanceof Uint8Array ? row.bytes : undefined;
  };
  const evidence = (ticket: string, revision: string, check: number, plan: string): BrowserProof | undefined => {
    const row = db.prepare('SELECT value FROM workbench_product_browser WHERE ticket=? AND revision=? AND check_id=? AND plan=?')
      .get(ticket, revision, check, plan);
    return row && JSON.parse(String(row.value));
  };
  const browserHistory = (ticket: string, revision: string, plan: string) => db.prepare(
    'SELECT value FROM workbench_product_browser WHERE ticket=? AND revision=? AND plan=? ORDER BY check_id DESC',
  ).all(ticket, revision, plan).map(row => JSON.parse(String(row.value)) as BrowserProof);
  const humanHistory = (ticket: string, revision: string, head?: string) => db.prepare(
    'SELECT sequence,value FROM workbench_product_manual WHERE ticket=? AND revision=? AND target=? ORDER BY sequence',
  ).all(ticket, revision, targetOf(head)).map(row => ({ ...JSON.parse(String(row.value)) as HumanCheck, sequence: Number(row.sequence) }));
  const manualCases = (work: Pick<Work, 'deliveryTemplate' | 'productCases'>) =>
    [...(work.deliveryTemplate?.product?.manual ?? []), ...(work.productCases ?? [])];
  const recordHuman = (ticket: string, head: string | undefined, input: z.infer<typeof humanCheckInput>, actor: string) => {
    const last = humanHistory(ticket, input.revision, head).filter(row => row.id === input.case).at(-1);
    if (last?.passed === input.passed && last.note === input.note && last.actor === actor) return last;
    if ((last?.sequence ?? 0) !== input.previous) throw new WorkbenchError('此项核对已更新，请刷新。', 409);
    const result: HumanCheck = { id: input.case, note: input.note, passed: input.passed, actor, at: new Date().toISOString() };
    const sequence = (last?.sequence ?? 0) + 1;
    db.prepare('INSERT INTO workbench_product_manual VALUES (?,?,?,?,?,?)')
      .run(ticket, input.revision, targetOf(head), input.case, sequence, JSON.stringify(result));
    return { ...result, sequence };
  };
  function state(ticket: string, revision: string, work: Work, delivery?: DeliveryEvidence) {
    const browser = work.deliveryTemplate?.product?.browser;
    const manual = manualCases(work);
    if (!browser && !manual.length) return;
    const plan = browserPlan(work.deliveryTemplate);
    const check = browser && delivery ? browserCheck(browser, delivery) : undefined;
    const proof = check && plan ? evidence(ticket, revision, check.id, plan) : undefined;
    const verified = proof?.head === delivery?.headSha && check?.status === 'completed' ? proof : undefined;
    const records = humanHistory(ticket, revision, delivery?.headSha);
    const cases = [
      ...(browser?.cases.map(spec => {
        const result = verified?.cases.find(row => row.id === spec.id);
        return { ...spec, kind: 'browser' as const, state: result ? (result.passed ? 'passed' as const : 'failed' as const) : 'pending' as const,
          detail: result?.detail };
      }) ?? []),
      ...manual.map(spec => {
        const result = records.filter(row => row.id === spec.id).at(-1);
        return { ...spec, kind: 'manual' as const, state: result ? (result.passed ? 'passed' as const : 'failed' as const) : 'pending' as const, result };
      }),
    ];
    return { head: delivery?.headSha, cases, manualHistory: records, execution: browser && plan ? {
      check: browser.check.name, target: 'GitHub Actions', proof: verified, history: browserHistory(ticket, revision, plan),
    } : undefined,
      ready: cases.every(row => row.state === 'passed') && (!browser || !!verified && check?.conclusion === 'success') };
  }
  return { state, evidence, recordBrowser, capture, recordHuman, humanHistory, manualCases };
}

export type ProductVerification = ReturnType<typeof openProductVerification>;
export type ProductVerificationState = NonNullable<ReturnType<ProductVerification['state']>>;
