import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { settingsSchema } from './config.ts';
import { checkTransferBoundary, importAutoLoop, restoreAutoLoop } from './execution/ledger-transfer.ts';
import { copyLedgerFile, destination, fileTarget, ledger, regular, staged, withStoppedState } from './ledger-backup.ts';
import { stageDevelopmentWorktrees } from './development-migration.ts';

const common = ['orchestrator.sqlite', 'console/accounts.json', 'secrets.json'];
const optional = ['console/rbac_policy.csv', 'console/console-audit.jsonl', 'devices/host.key', 'feishu-ingress/inbox.sqlite'];
const autoLoop = 'autoloop/hub.db';
const autoLoopKey = 'autoloop/master.key';
const contractor = 'dispatch/hub.sqlite';
const archive = (file: string) => 'runtime-archive/' + file;

function assertBusinessIdle(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const pending = [
      ['workbench_receipt_journal', 'draft IS NOT NULL'],
      ['workbench_budget_charge', 'settled IS NULL'],
      ['workbench_point_charge', "state='reserved'"],
      ['workbench_device_claim', '1'],
    ];
    for (const [table, where] of pending)
      if (db.prepare(`SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`).get())
        throw new Error('有未结算的回执、预算预留或设备接单记录。请用原调度器恢复。');
  } finally { db.close(); }
}

/** Prepare a new, offline rehearsal directory. The original instance is never reconfigured. */
export async function migrateRuntime(directory: string, output: string) {
  const source = await realpath(directory);
  const target = await destination(source, output);
  return withStoppedState(source, async () => {
    const raw = JSON.parse(await readFile((await regular(source, 'workbench.json'))!, 'utf8'));
    const config = settingsSchema.parse(raw);
    const forward = config.executionRuntime === 'autoloop';
    const after = forward ? 'contractor' : 'autoloop';
    if (!forward && !await regular(source, archive(autoLoop), false))
      throw new Error('没有原 AutoLoop 事实日志。请选择由迁移生成的 Contractor 目录。');
    const activeFile = (await regular(source, forward ? autoLoop : contractor))!;
    const keyName = forward ? autoLoopKey : archive(autoLoopKey);
    const keyFile = (await regular(source, keyName))!;
    const key = (await readFile(keyFile, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('AutoLoop 原账本签名密钥无法核对。');
    const opposite = forward ? contractor : autoLoop;
    if (await regular(source, opposite, false)) throw new Error('同一个目录存在两套调度账本。');
    const marker = await regular(source, 'execution-driver', !forward);
    if (forward ? marker : await readFile(marker!, 'utf8') !== 'contractor') throw new Error('调度器标记与运行配置不符。');
    const active = ledger(activeFile, key);
    try {
      checkTransferBoundary(active);
      assertBusinessIdle((await regular(source, common[0]!))!);
      return await staged(target, async stage => {
        async function copy(from: string, to = from, needed = true) {
          const original = await regular(source, from, needed);
          if (original) await copyLedgerFile(original, await fileTarget(stage, to), key);
        }
        for (const name of common) await copy(name);
        for (const name of optional) await copy(name, name, false);
        // Presence belongs to the stopped instance. Keep device identities and routes.
        const business = new DatabaseSync(path.join(stage, 'orchestrator.sqlite'));
        try {
          business.exec('UPDATE workbench_device SET seen=NULL');
          await stageDevelopmentWorktrees(source, stage, config, business);
        }
        finally { business.close(); }

        if (forward) {
          await copy(autoLoop, archive(autoLoop));
          await copy(autoLoopKey, archive(autoLoopKey));
          importAutoLoop(active, await fileTarget(stage, contractor), key);
          await writeFile(path.join(stage, 'execution-driver'), 'contractor', { flag: 'wx', mode: 0o600 });
        } else {
          await copy(archive(autoLoop), autoLoop);
          await copy(archive(autoLoopKey), autoLoopKey);
          await copy(contractor, archive(contractor));
          restoreAutoLoop(active, path.join(stage, autoLoop), keyFile);
        }
        await writeFile(path.join(stage, 'workbench.json'), JSON.stringify({ ...raw, executionRuntime: after }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      });
    } finally { active.close(); }
  });
}
