// 组织 owner 的人工核对结论 → 可导入的组织表。
//
//   npm run org:table -- --exclude "已离职成员A,已离职成员B" \
//     --bind "成员姓名=<注册表已有稳定ID>:role-growth" --default-role role-product
//
// 产物只落本机 .runtime/v06/：owner 决策（排除名单）与组织表（含真实标识），
// 两者都不进仓库。排除名单会被 FeishuOrgService.preview() 读取，
// 避免 --has-chatted 把已离职成员反复带回草案。
import { readFileSync, writeFileSync } from 'node:fs';
import { runtime } from '../src/config.ts';
import { parseOrgTable, type OwnerDecisions } from '../src/feishu-org.ts';

const args = process.argv.slice(2);
function value(name: string): string | undefined {
  const exact = args.find(a => a.startsWith(name + '='));
  if (exact) return exact.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
const list = (input: string | undefined) => (input ?? '').split(/[,，、]/).map(s => s.trim()).filter(Boolean);
const excludedNames = list(value('--exclude'));
const defaultRole = value('--default-role') ?? 'role-product';
const actor = value('--actor') ?? 'organization-owner';
const binds: string[] = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--bind' && args[i + 1]) binds.push(args[i + 1]!);
const bindings = [...new Set(binds)].map(raw => {
  const [name, rest] = raw.split('=');
  const split = (rest ?? '').lastIndexOf(':');
  if (!name?.trim() || split < 1) throw new Error(`--bind 格式应为「姓名=稳定成员ID:职能ID」，收到：${raw}`);
  return { name: name.trim(), userId: rest!.slice(0, split), roleId: rest!.slice(split + 1) };
});

const draft = JSON.parse(readFileSync(runtime('org-mapping-draft.json'), 'utf8')) as any;
const registry = JSON.parse(readFileSync(runtime('v06', 'role-registry.json'), 'utf8')) as any;
const activeRoles = new Set<string>((registry?.value?.roles ?? []).filter((r: any) => r.active).map((r: any) => String(r.id)));
const members: any[] = Array.isArray(draft.members) ? draft.members : [];
if (!members.length) throw new Error('草案里没有成员，先运行 npm run org:preview');

const at = new Date().toISOString();
const decisions: OwnerDecisions = {
  schemaVersion: 1, updatedAt: at, actor,
  excluded: excludedNames.map(name => {
    const found = members.find(m => m.name === name);
    return { name, ...(found?.openId ? { openId: String(found.openId) } : {}),
      reason: '组织 owner 确认已不在组织内，不进入职能注册表', at };
  }),
  note: 'owner 核对结论只作用于本机的组织草案与派单候选，不修改飞书通讯录、不等于真人登录。',
};
const decisionsFile = runtime('v06', 'org-owner-decisions.json');
writeFileSync(decisionsFile, JSON.stringify(decisions, null, 2), { mode: 0o600 });

const entries = members.filter(m => !excludedNames.includes(String(m.name))).map(m => {
  const bind = bindings.find(b => b.name === m.name);
  return { userId: bind?.userId ?? String(m.openId), name: String(m.name),
    roleId: bind?.roleId ?? defaultRole, ...(m.department ? { department: String(m.department) } : {}), domains: [] };
});
const parsed = parseOrgTable(entries);
for (const entry of parsed) {
  if (!activeRoles.has(entry.roleId)) throw new Error(`职能 ${entry.roleId} 不存在或已停用，请先配置职能`);
}
const tableFile = runtime('v06', 'org-table.json');
writeFileSync(tableFile, JSON.stringify(parsed, null, 2), { mode: 0o600 });

console.log(JSON.stringify({
  decisionsFile, tableFile, actor,
  excluded: decisions.excluded.map(e => e.name),
  importedMembers: parsed.length,
  entries: parsed.map(e => ({ name: e.name, roleId: e.roleId,
    boundToExistingId: bindings.some(b => b.name === e.name), department: e.department ?? null })),
  note: '组织表含真实成员标识，只在 .runtime，不进仓库；下一步 npm run org:apply -- .runtime/v06/org-table.json',
}, null, 2));
