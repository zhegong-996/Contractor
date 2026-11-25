// One lease owns one native ACP session. This host-side client exposes no filesystem, terminal or MCP methods.
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

const [mode, cwd, input, instruction, model, ...argv] = process.argv.slice(2);
let child, session, text = '', pending, serial = 0;
let admitted = false, cancelling = false;
function connect() {
  child = spawn(argv[0], argv.slice(1), { cwd, detached: mode === 'probe', stdio: ['pipe', 'pipe', 'ignore'] });
  // Bound reads also cover malformed peers that never finish a JSON line.
  let received = 0;
  child.stdout.on('data', bytes => {
    if ((received += bytes.length) > 16 * 1024 * 1024) child.kill('SIGKILL');
  });
  const lines = createInterface({ input: child.stdout });
  const send = value => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  child.stdin.on('error', () => {});
  const closed = new Promise(resolve => child.once('close', () => { pending?.reject(new Error('连接已关闭')); resolve(); }));
  child.on('error', () => pending?.reject(new Error('无法启动隔离执行端')));
  lines.on('line', line => {
    try {
      const msg = JSON.parse(line);
      if (msg.jsonrpc !== '2.0') throw new Error();
      if (msg.method && msg.id != null) {
        if (msg.method === 'session/request_permission') send({ id: msg.id, result: { outcome: { outcome: 'cancelled' } } });
        else send({ id: msg.id, error: { code: -32601, message: 'Client capability unavailable' } });
      } else if (msg.method === 'session/update' && session && msg.params?.sessionId === session) {
        const update = msg.params.update;
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') text += update.content.text;
      } else if (!msg.method && pending && msg.id === pending.id) {
        if (msg.error) {
          const code = /model_not_found|model_not_in_accessible_catalog/.test(JSON.stringify(msg.error)) ? 'model' : 'provider';
          pending.reject(Object.assign(new Error('ACP 请求未完成'), { rejection: code }));
        }
        else pending.resolve(msg.result);
      }
    } catch { child.kill('SIGKILL'); }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending = { id, resolve, reject };
    send({ id, method, params });
  }).finally(() => { pending = undefined; });
  return { rpc, closed, send };
}
async function initialize(peer) {
  const timeout = setTimeout(() => stopPeer('SIGTERM'), 12000);
  const reply = await peer.rpc('initialize', { protocolVersion: 1, clientCapabilities: {},
    clientInfo: { name: 'contractor', version: '1' } }).finally(() => clearTimeout(timeout));
  if (reply.protocolVersion !== 1 || reply.agentCapabilities?.loadSession !== true ||
      reply.agentInfo?.name !== 'codex-acp' || reply.agentInfo.version !== '0.16.0') throw new Error('只读 ACP 配置不匹配');
}
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
function stopPeer(signal) {
  if (mode === 'probe' && child.pid) {
    try { process.kill(-child.pid, signal); } catch { /* Group has exited. */ }
    return;
  }
  // The scheduler creates a dedicated process group for this one turn. Keep the
  // native peer in that group so the scheduler can still prove exit after client loss.
  const group = execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'pgid='], { encoding: 'utf8' }).trim();
  for (const line of execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,comm='], { encoding: 'utf8' }).split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (match && match[2] === group && match[3] === argv.at(-1)) {
      try { process.kill(Number(match[1]), signal); } catch { /* Peer has exited. */ }
    }
  }
  child.kill(signal);
}
const stop = async peer => {
  child.stdin.end();
  const timer = setTimeout(() => stopPeer('SIGTERM'), 150);
  const force = setTimeout(() => stopPeer('SIGKILL'), 1700);
  await peer.closed;
  clearTimeout(timer);
  clearTimeout(force);
};
let peer = connect();
process.once('SIGTERM', () => {
  cancelling = true;
  if (session && !child.stdin.destroyed) peer.send({ method: 'session/cancel', params: { sessionId: session } });
  void stop(peer);
});
try {
  await initialize(peer);
  if (mode === 'probe') emit({ ready: true, protocolVersion: 1, loadSession: true });
  else {
    const args = { cwd, mcpServers: [] };
    const created = await peer.rpc('session/new', args);
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(created.sessionId)) throw new Error('无效会话');
    session = created.sessionId;
    emit({ session });
    if (!model || created.configOptions?.find(option => option.id === 'model')?.currentValue !== model) {
      emit({ blocked: 'model' });
      throw new Error('执行端使用的模型与项目许可不符');
    }
    if (created.modes?.currentModeId !== 'read-only')
      await peer.rpc('session/set_mode', { sessionId: session, modeId: 'read-only' });
    const prompt = instruction + '\n\n' + readFileSync(input, 'utf8');
    if (cancelling) throw new Error('执行已取消');
    admitted = true;
    try {
      const done = await peer.rpc('session/prompt', { sessionId: session, prompt: [{ type: 'text', text: prompt }] });
      if (done.stopReason !== 'end_turn' || !text.trim()) throw new Error('没有完整结束回执');
      emit({ text });
    } catch (error) {
      if (cancelling) throw error;
      if (error.rejection) {
        emit({ blocked: error.rejection });
      } else {
        // Rebuild the projection from the session. The durable end-of-turn receipt
        // is checked separately, as replay alone cannot prove the prompt completed.
        await stop(peer);
        if (cancelling) throw error;
        text = '';
        peer = connect();
        await initialize(peer);
        await peer.rpc('session/load', { ...args, sessionId: session });
        emit({ replayed: true });
      }
    }
  }
} catch {
  if (admitted) emit({ uncertain: true });
  else process.exitCode = 1;
} finally { await stop(peer); }
