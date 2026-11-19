import type { DatabaseSync } from 'node:sqlite';
import type { OctopIMDeliveryForm } from './octop-im-contract.ts';
import type { CardReference } from './feishu-cards.ts';

type ReceiptReference = CardReference & { target: string };

export function channelDeliveryJournal(db: DatabaseSync, table: 'workbench_octop_delivery' | 'channel_delivery' = 'workbench_octop_delivery') {
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY)`);
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  for (const column of ['connector', 'started_at', 'acknowledged_at', 'form', 'uncertain_at', 'reference']) {
    if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
  }
  const row = db.prepare(`SELECT connector,started_at,acknowledged_at,form,uncertain_at,reference FROM ${table} WHERE id=?`);
  const insert = db.prepare(`INSERT INTO ${table}(id,connector,started_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING`);
  const acknowledge = db.prepare(`UPDATE ${table} SET acknowledged_at=COALESCE(acknowledged_at,?),form=?,uncertain_at=NULL,
    reference=COALESCE(reference,?) WHERE id=? AND connector=? AND (acknowledged_at IS NULL OR (? IS NOT NULL AND reference IS NULL))`);
  const unknown = db.prepare(`UPDATE ${table} SET uncertain_at=COALESCE(uncertain_at,?)
    WHERE id=? AND acknowledged_at IS NULL`);
  return {
    begin: (id: string, connector: string) => Number(insert.run(id, connector, new Date().toISOString()).changes) === 1,
    acknowledge: (id: string, connector: string, form?: OctopIMDeliveryForm | void, reference?: ReceiptReference) =>
      acknowledge.run(new Date().toISOString(), form ?? null, reference ? JSON.stringify(reference) : null, id, connector, reference ? 1 : null),
    unknown: (id: string) => unknown.run(new Date().toISOString(), id),
    get(id: string, connector: string) {
      const found = row.get(id);
      if (!found) return;
      if (found.connector === connector && typeof found.acknowledged_at === 'string') {
        const form = found.form === 'card' || found.form === 'markdown' ? found.form : undefined;
        const reference = typeof found.reference === 'string' ? JSON.parse(found.reference) as ReceiptReference : undefined;
        return { state: 'sent' as const, at: found.acknowledged_at, form, ...(reference && { reference }) };
      }
      if (found.connector === connector && typeof found.started_at === 'string'
        && !found.uncertain_at && Date.now() - Date.parse(found.started_at) < 45000) return { state: 'in-flight' as const };
      return { state: 'uncertain' as const };
    },
  };
}
