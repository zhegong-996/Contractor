import { spawnSync } from 'node:child_process';
import { root, runtime } from '../src/config.ts';
const result = spawnSync('uv', ['sync', '--project', 'upstream/cognee', '--frozen', '--no-dev', '--python', '3.12'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, UV_PROJECT_ENVIRONMENT: runtime('cognee-venv') },
});
if (result.status !== 0) throw new Error('Cognee 隔离环境安装失败');
console.log('已安装固定版本 Cognee；未启动模型服务、自动抽取或资料批量摄取。');
