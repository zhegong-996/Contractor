// C-1：PG 宿主的纯函数契约。需要真实数据库的部分由 `npm run host:pg` 真跑，
// 单测不连接数据库，避免没有 PG 的环境出现「跳过也算通过」的假绿。
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalPgDsn, pgDsn, PG_SCHEMA, PgHostPlatform } from '../src/pg-host.ts';

test('C-1 专属 schema 固定，避免污染同一实例上的其它库', () => {
  assert.equal(PG_SCHEMA, 'suitme_c1');
});

test('C-1 PG 连接只接受本机回环地址', () => {
  for (const dsn of [
    'postgresql://127.0.0.1:5432/suitme_collab_c1',
    'postgres://localhost:5432/suitme_collab_c1',
    'postgresql://[::1]:5432/suitme_collab_c1',
  ]) assert.equal(assertLocalPgDsn(dsn), dsn);
});

test('C-1 PG 连接拒绝外部主机与非 postgres 协议（材料不得外发）', () => {
  assert.throws(() => assertLocalPgDsn('postgresql://db.example.com:5432/suitme_collab_c1'), /本机回环地址/);
  assert.throws(() => assertLocalPgDsn('postgresql://10.0.0.8:5432/suitme_collab_c1'), /本机回环地址/);
  assert.throws(() => assertLocalPgDsn('https://127.0.0.1:5432/suitme_collab_c1'), /协议/);
});

test('C-1 pgDsn 从配置指定的环境变量读取，凭据不写进配置文件', () => {
  const name = 'COLLAB_TEST_PG_DSN';
  const prior = process.env[name];
  process.env[name] = 'postgresql://127.0.0.1:5432/from-env';
  try {
    const dsn = pgDsn({ host: { provider: 'local-pg', pgDsnEnv: name } } as any);
    assert.equal(dsn, 'postgresql://127.0.0.1:5432/from-env');
  } finally {
    if (prior === undefined) delete process.env[name]; else process.env[name] = prior;
  }
});

test('C-1 未配置 DSN 时默认本机回环且不携带任何凭据', () => {
  const name = 'COLLAB_TEST_PG_DSN_ABSENT';
  const prior = process.env[name];
  delete process.env[name];
  try {
    const dsn = pgDsn({ host: { provider: 'local-pg', pgDsnEnv: name } } as any);
    assert.match(dsn, /^postgresql:\/\/127\.0\.0\.1:5432\/suitme_collab_c1$/);
    assert.ok(!dsn.includes('@'), '默认 DSN 不得包含用户名或密码');
  } finally {
    if (prior !== undefined) process.env[name] = prior;
  }
});

test('C-1 PG 宿主能力清单如实区分「本机已实现」与「仍缺」', async () => {
  const host = new PgHostPlatform('postgresql://127.0.0.1:5432/suitme_collab_c1');
  try {
    const caps = host.capabilities();
    assert.equal(caps.id, 'local-pg');
    assert.equal(caps.pluginSdk, false, '② 下 Plugin SDK 不再是能力来源');
    assert.ok(caps.implemented.some(item => item.includes('SKIP LOCKED')), '必须真实声明并发领取');
    assert.ok(caps.implemented.some(item => item.includes('checkout')), '必须真实声明 runToken 语义');
    assert.ok(caps.missing.some(item => item.includes('远端工具沙箱')), '未部署的执行环境不得假装完成');
    assert.ok(caps.missing.some(item => item.includes('Redis')), '本机不引 Redis 的取舍必须写明');
    assert.ok(!caps.missing.some(item => item.includes('PostgreSQL 事务')), 'PG 已真跑，事务不应再列为缺口');
  } finally { await host.close(); }
});
