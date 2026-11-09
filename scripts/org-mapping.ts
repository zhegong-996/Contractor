// 飞书组织映射的本地操作入口。
//
//   npm run org:preview                     读取当前授权范围可见的真实成员，生成草案
//   npm run org:apply -- <org-table.json>   管理员确认后，把组织表导入职能注册表
//
// 草案与已导入记录只落在本机 .runtime/v06/，含真实姓名与 open_id，不进仓库。
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { api } from '../src/client.ts';
import { runtime } from '../src/config.ts';

const action = process.argv[2];

if (action === 'preview') {
  const result = await api('/workspace/v06-org-mapping-preview', { includeChatted: true }) as any;
  const draft = result?.draft;
  if (!draft) throw new Error('未取得飞书组织映射草案');
  const file = runtime('org-mapping-draft.json');
  await writeFile(file, JSON.stringify(draft, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({
    file, available: draft.available, appId: draft.appId,
    members: draft.members.map((m: any) => ({ name: m.name, openId: m.openId, department: m.department })),
    departmentScopeMissing: draft.departmentScopeMissing,
    departmentStructure: draft.departmentStructure,
    departmentNote: draft.departmentNote,
    botAppId: draft.botAppId ?? null,
    idScopeMismatch: draft.idScopeMismatch === true,
    ...(draft.idScopeMismatch ? { idScopeNote: draft.idScopeNote } : {}),
    authorizationHint: draft.authorizationHint,
    ...(draft.authorizationUrl ? { authorizationUrl: draft.authorizationUrl } : {}),
    missingScopes: draft.missingScopes ?? [],
    scopeLogin: draft.missingScopes?.length
      ? '运行 npm run org:auth 取得携带现有全部 scope 的登录命令（需本人在飞书确认）'
      : '部门读取范围已具备',
    excludedByOwner: draft.excludedByOwner?.map((item: any) => item.name) ?? [],
    note: draft.note,
  }, null, 2));
} else if (action === 'apply') {
  const file = process.argv[3];
  if (!file) throw new Error('Usage: npm run org:apply -- <org-table.json>');
  // open_id 按应用隔离：读组织的应用与收消息的机器人不同应用时，
  // 导进去的人「在册但派单匹配不上」。宁可拒绝，也不留一份看起来成功的映射。
  if (!process.argv.includes('--force-foreign-app')) {
    const draftFile = runtime('org-mapping-draft.json');
    if (existsSync(draftFile)) {
      const draft = JSON.parse(await readFile(draftFile, 'utf8')) as any;
      if (draft?.idScopeMismatch === true) {
        throw new Error(draft.idScopeNote ?? '组织草案的 open_id 属于另一个应用，不能直接导入；'
          + '请先给机器人应用补齐通讯录权限后用它的身份重读，或确认无碍后加 --force-foreign-app');
      }
    }
  }
  const table = JSON.parse(await readFile(file, 'utf8'));
  const entries = Array.isArray(table) ? table : table.entries;
  if (!Array.isArray(entries) || !entries.length) throw new Error('组织表为空或格式不正确');
  const current = await api('/workspace/v06-roles-view', {}) as any;
  if (!current?.revision) throw new Error('未取得职能注册表当前修订号，拒绝离线覆盖');
  const result = await api('/workspace/v06-org-mapping-apply', { entries, registryRevision: current.revision }) as any;
  console.log(JSON.stringify({ imported: entries.length, registryVersion: result?.registry?.version,
    registeredMembers: result?.registry?.members, note: result?.record?.note }, null, 2));
} else {
  console.log('Usage: npm run org:preview | npm run org:apply -- <org-table.json>\n' +
    '组织表每行：{ "userId": "成员稳定标识", "name": "姓名", "roleId": "职能ID", "department": "部门（可选）", "domains": [] }');
  process.exitCode = 1;
}
