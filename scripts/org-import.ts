// 组织导入：把飞书草案里的真实成员一次性写入职能注册表（都在产研）。
//
//   npm run org:import
//
// 用户拍板「都在产研，龚哲是 CEO 权限最大」。这一步只改 members，不改 role 定义：
// - 4 人都落到 role-product（用飞书机器人应用空间下的正确 open_id）；
// - 龚哲的历史领域与「顶增长」的邻接能力保留，但主职能从 role-growth 迁到 role-product；
// - 清掉旧草案留下的错应用 open_id（ou_6cf9… / ou_80c1…），换成这次读到的正确 id。
//
// 幂等：重复跑不产生重复成员。
import { readFileSync } from 'node:fs';
import { api } from '../src/client.ts';

const draft = JSON.parse(readFileSync('.runtime/org-mapping-draft.json', 'utf8')) as any;
const byName = new Map((draft.members ?? []).map((m: any) => [m.name, m.openId]));
const id = (name: string) => {
  const found = byName.get(name);
  if (!found) throw new Error(`草案里找不到成员 ${name}，先运行 npm run org:preview`);
  return found;
};

const gongzhe = id('龚哲');
const xujiahao = id('许家豪');
const liuyushun = id('刘玉顺');
const linhengchang = id('林恒昌');

const view = await api('/workspace/v06-roles-view', {}) as any;
const registry = view.registry;
const revision = view.revision;
if (!registry || !revision) throw new Error('未取得职能注册表当前修订号，拒绝离线覆盖');

const nextVersion = registry.version + 1;
// role-growth 是龚哲的旧主职能，现在保留为空职能（活跃、无人），历史任务不受影响。
const roleProduct = registry.roles.find((r: any) => r.id === 'role-product');
const roleGrowth = registry.roles.find((r: any) => r.id === 'role-growth');
if (!roleProduct || !roleGrowth) throw new Error('role-product / role-growth 定义缺失');

const snap = (roleId: string, name: string, ownerUserId: string) =>
  ({ roleId, name, ownerUserId, registryVersion: nextVersion });

const member = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId, roleId: 'role-product', domains: [], adjacency: [], roleSnapshot: snap('role-product', roleProduct.name, roleProduct.ownerUserId), ...extra,
});

const members = [
  // 龚哲：保留门店试用反馈的领域证据 + 保留「能顶增长」的邻接（改成指向 role-growth，避免指向自己）。
  member(gongzhe, {
    domains: [{ tag: '门店试用反馈', weight: 0.8, evidence: ['SUI-128 飞书真实接单'] }],
    adjacency: [{ roleId: 'role-growth', weight: 0.3, evidence: ['SUI-129 增长整理销售反馈并交产研形成方案'] }],
  }),
  member(xujiahao),
  member(liuyushun),
  member(linhengchang),
];

const next = { ...registry, version: nextVersion, updatedAt: new Date().toISOString(), members };

const result = await api('/workspace/v06-roles-save', { registry: next, revision }) as any;
console.log(JSON.stringify({
  version: result?.registry?.version,
  members: result?.registry?.members?.length,
  roles: result?.registry?.roles?.length,
  note: '都在产研；旧错应用 open_id 已被正确 id 替换；龚哲历史领域与增长邻接保留。',
}, null, 2));
