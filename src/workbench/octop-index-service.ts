import { requirePersistentStateDir, runtime } from '../config.ts';
import { loadSettings } from './config.ts';
import { octopPythonEnv, octopScript } from './octop-bridge.ts';

requirePersistentStateDir(process.env.COLLAB_STATE_DIR, '知识索引服务');
const { octop } = await loadSettings();
if (!octop?.indexSocket) throw new Error('请先设置 octop.indexSocket。');
if (!process.execve) throw new Error('知识索引服务需要支持 Unix socket 和 execve 的 Node 24 环境。');
process.execve(octop.python, [octop.python, octopScript, 'serve-index', octop.indexSocket], octopPythonEnv(runtime()));
