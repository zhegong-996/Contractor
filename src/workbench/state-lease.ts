import { closeSync, openSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type StateWriter = 'workbench' | 'feishu-ingress';
export const stateLeasePath = (directory: string, writer: StateWriter) => path.join(directory, '.' + writer + '-writer.sqlite');

export function acquireStateLease(directory: string, writer: StateWriter) {
  const file = stateLeasePath(directory, writer);
  closeSync(openSync(file, 'a', 0o600));
  const lock = new DatabaseSync(file);
  try {
    lock.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
  } catch (cause) {
    lock.close();
    throw new Error(writer + ' 正在写入该运行目录，请先停止原进程。', { cause });
  }
  return () => lock.close();
}
