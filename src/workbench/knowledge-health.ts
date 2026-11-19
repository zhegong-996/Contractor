import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { runtime } from '../config.ts';
import type { OctopSettings } from './config.ts';
import { octopPythonEnv, octopScript } from './octop-bridge.ts';

type Health = { state: 'ready' | 'unavailable' | 'disabled'; mode: 'service' | 'local' | 'disabled'; checkedAt: number };

async function socketProbe(address: string): Promise<void> {
  for (const [file, directory] of [[path.dirname(address), true], [address, false]] as const) {
    const stat = await lstat(file);
    if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) || !(directory ? stat.isDirectory() : stat.isSocket()))
      throw new Error('Invalid index socket');
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection(address);
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('Index timed out')), 2000);
    function finish(error?: Error) { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(); }
    socket.on('connect', () => socket.write('{"op":"health"}\n'));
    socket.on('error', finish);
    socket.on('end', () => finish(new Error('Index closed without health response')));
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 1024) return finish(new Error('Invalid health response'));
      if (buffer.includes('\n')) {
        try { if (JSON.parse(buffer).ready !== true) throw new Error('Index unavailable'); finish(); }
        catch { finish(new Error('Invalid health response')); }
      }
    });
  });
}

function localProbe(config: OctopSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.python, [octopScript, 'health'], { env: octopPythonEnv(runtime()), stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 1024) child.kill('SIGKILL'); });
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timer);
      try { if (code !== 0 || JSON.parse(output).ready !== true) throw new Error('Index unavailable'); resolve(); }
      catch { reject(new Error('Index unavailable')); }
    });
    child.stdin.end('{}');
  });
}

/** Coalesce concurrent probes and cache briefly; never send project content. */
export function knowledgeHealth(config?: OctopSettings, cacheMs = 3000) {
  let cached: Health | undefined;
  let pending: Promise<Health> | undefined;
  return async (): Promise<Health> => {
    if (!config) return { state: 'disabled', mode: 'disabled', checkedAt: Date.now() };
    if (cached && Date.now() - cached.checkedAt < cacheMs) return cached;
    if (pending) return pending;
    pending = (async () => {
      let state: Health['state'] = 'ready';
      try { await (config.indexSocket ? socketProbe(config.indexSocket) : localProbe(config)); }
      catch { state = 'unavailable'; }
      cached = { state, mode: config.indexSocket ? 'service' : 'local', checkedAt: Date.now() };
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
