import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { command } from '../commands.ts';
import { githubApi } from '../github.ts';
import { formerName } from './compatibility.ts';
import type { DeliveryTemplate } from './delivery-template.ts';
import { commitSha } from './github-delivery.ts';
import { browserCaseResult, browserCheck, browserPlan, type BrowserProof } from './product-verification.ts';
import type { DeliveryEvidence } from './work-types.ts';

const numericId = z.number().int().positive().safe();
const timestamp = z.iso.datetime();
const jobSchema = z.object({ id: numericId, run_id: numericId, run_attempt: numericId, head_sha: commitSha, name: z.string(),
  status: z.string(), conclusion: z.string().nullable(), started_at: timestamp.nullable(),
  completed_at: timestamp.nullable(), check_run_url: z.string(), labels: z.array(z.string().min(1).max(100)).max(30).default([]) });
const repo = z.object({ id: numericId });
const runSchema = z.object({ id: numericId, run_attempt: numericId, path: z.string(), event: z.string(), head_sha: commitSha,
  repository: repo, head_repository: repo, status: z.string() });
const artifactsSchema = z.object({ artifacts: z.array(z.object({
  id: numericId, name: z.string(), expired: z.boolean(), size_in_bytes: z.number().int().positive(), created_at: timestamp,
})) });
const reportSchema = z.object({ schema: z.literal(1), check: z.string(), sha: commitSha,
  browser: z.string().min(1).max(70), cases: z.array(browserCaseResult).min(1).max(20) });
const maxArchiveBytes = 256 * 1024;

async function download(repository: string, artifact: number, member: string) {
  const { stdout: zip } = await promisify(execFile)('gh', ['api', 'repos/' + repository + '/actions/artifacts/' + artifact + '/zip'],
    { encoding: 'buffer', timeout: 15_000, maxBuffer: maxArchiveBytes, env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
  const folder = await mkdtemp(join(tmpdir(), 'contractor-product-report-'));
  try {
    const path = join(folder, 'report.zip');
    await writeFile(path, zip, { mode: 0o600 });
    // Read only the named member. Decompression is bounded and never writes archive paths.
    const { stdout } = await promisify(execFile)('unzip', ['-p', path, member],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 48 * 1024 });
    return JSON.parse(stdout);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function listArtifacts(repository: string, run: number, name: string) {
  return JSON.parse(await command('gh', ['api', 'repos/' + repository + '/actions/runs/' + run + '/artifacts?per_page=100&name='
    + encodeURIComponent(name), '--paginate', '--slurp']));
}

// The platform accepts only evidence from the frozen repository, pinned workflow and selected job attempt.
export async function inspectProductVerification(template: DeliveryTemplate | undefined, evidence: DeliveryEvidence,
  ports = { api: githubApi, download, listArtifacts }): Promise<BrowserProof | undefined> {
  const spec = template?.product?.browser;
  const plan = browserPlan(template);
  if (!template || !spec || !plan || !evidence.repoId || evidence.headRepoId !== evidence.repoId
    || template.repository.toLowerCase() !== evidence.repository.toLowerCase()) return;
  const check = browserCheck(spec, evidence);
  const url = check?.html_url && URL.parse(check.html_url);
  const route = url && /^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/job\/(\d+)\/?$/.exec(url.pathname);
  if (!check || check.status !== 'completed' || !['success', 'failure'].includes(check.conclusion ?? '')
    || !url || url.origin !== 'https://github.com' || url.username || url.password || !route || route[1]?.toLowerCase() !== evidence.repository.toLowerCase()
    || route[3] !== String(check.id)) return;
  const repository = evidence.repository;
  const job = jobSchema.parse(await ports.api(repository, 'actions/jobs/' + check.id));
  if (job.id !== check.id || String(job.run_id) !== route[2] || job.name !== spec.check.name || job.head_sha !== evidence.headSha
    || job.status !== 'completed' || job.conclusion !== check.conclusion || !job.started_at || !job.completed_at
    || job.check_run_url.toLowerCase() !== 'https://api.github.com/repos/' + repository.toLowerCase() + '/check-runs/' + check.id) return;
  const artifactName = spec.artifact + '-' + evidence.headSha + '-attempt-' + job.run_attempt;
  const [run, pages] = await Promise.all([
    ports.api(repository, 'actions/runs/' + job.run_id + '/attempts/' + job.run_attempt).then(value => runSchema.parse(value)),
    ports.listArtifacts(repository, job.run_id, artifactName).then(value => z.array(artifactsSchema).parse(value)),
  ]);
  if (run.id !== job.run_id || run.run_attempt !== job.run_attempt || run.path !== spec.workflow || run.event !== 'push'
    || run.status !== 'completed' || run.head_sha !== evidence.headSha || run.repository.id !== evidence.repoId
    || run.head_repository.id !== evidence.repoId) return;
  const artifacts = pages.flatMap(page => page.artifacts).filter(artifact => !artifact.expired
    && artifact.name === artifactName && artifact.size_in_bytes <= maxArchiveBytes
    && Date.parse(artifact.created_at) >= Date.parse(job.started_at!) && Date.parse(artifact.created_at) <= Date.parse(job.completed_at!));
  if (artifacts.length !== 1) return;
  const [artifact] = artifacts;
  const pins = await Promise.all(spec.trustedFiles.map(async pinned => {
    const route = 'contents/' + pinned.path.split('/').map(encodeURIComponent).join('/') + '?ref=' + evidence.headSha;
    const file = z.object({ type: z.literal('file'), sha: commitSha }).parse(await ports.api(repository, route));
    return file.sha === pinned.blob;
  }));
  if (pins.some(match => !match)) return;
  const member = 'contractor-verification.json';
  const report = reportSchema.parse(await ports.download(repository, artifact!.id,
    spec.workflow.startsWith(formerName('.github/workflows/contractor-')) ? formerName(member) : member));
  const cases = spec.cases.flatMap(item => report.cases.filter(result => result.id === item.id));
  if (report.check !== spec.check.name || report.sha !== evidence.headSha || report.cases.length !== spec.cases.length
    || new Set(cases.map(item => item.id)).size !== spec.cases.length || cases.length !== report.cases.length
    || check.conclusion === 'success' && cases.some(item => !item.passed)) return;
  return { plan, head: evidence.headSha, checkId: check.id, run: job.run_id, attempt: job.run_attempt, artifact: artifact!.id,
    url: 'https://github.com/' + repository + '/actions/runs/' + job.run_id + '/attempts/' + job.run_attempt,
    executor: 'github-actions', browser: report.browser, labels: job.labels, cases };
}
