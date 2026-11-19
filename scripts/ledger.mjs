import path from 'node:path';
import { backupLedger, restoreLedger } from '../src/workbench/ledger-backup.ts';

const [action, source, target, ...extra] = process.argv.slice(2);
if ((action !== 'backup' && action !== 'restore') || !source || !target
  || !path.isAbsolute(source) || !path.isAbsolute(target) || extra.length) {
  console.error('用法 npm run ledger -- backup <运行目录> <新备份目录>，或 restore <备份目录> <新运行目录>');
  process.exitCode = 1;
} else {
  try { console.log(await (action === 'backup' ? backupLedger : restoreLedger)(source, target)); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
