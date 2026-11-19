import path from 'node:path';
import { backupLedger, restoreLedger } from '../src/workbench/ledger-backup.ts';
import { migrateRuntime } from '../src/workbench/runtime-migration.ts';

const [action, source, target, ...extra] = process.argv.slice(2);
const actions = new Map([['backup', backupLedger], ['restore', restoreLedger], ['migrate-runtime', migrateRuntime]]);
if (!actions.has(action) || !source || !target
  || !path.isAbsolute(source) || !path.isAbsolute(target) || extra.length) {
  console.error('用法 npm run ledger -- backup|restore|migrate-runtime <源目录> <尚不存在的目标目录>');
  process.exitCode = 1;
} else {
  try { console.log(await actions.get(action)(source, target)); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
