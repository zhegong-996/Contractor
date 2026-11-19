import { createHash, randomBytes } from 'node:crypto';
import type { PlatformActor } from './channel-links.ts';
import { WorkbenchError } from './errors.ts';

type Challenge = {
  username: string;
  verifier: string;
  started: number;
  expires: number;
  verified?: PlatformActor;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class AccountRecovery {
  private readonly challenges = new Map<string, Challenge>();

  constructor(private readonly member: (sender: PlatformActor, at?: string) => string | undefined,
    private readonly active: (username: string) => boolean, private readonly now = Date.now) {}

  begin(username: string) {
    const started = this.now();
    for (const [code, row] of this.challenges) if (row.expires <= started) this.challenges.delete(code);
    if (this.challenges.size >= 1000) throw new WorkbenchError('找回请求较多，请稍后再试。', 429);
    const code = randomBytes(16).toString('hex');
    const token = randomBytes(32).toString('hex');
    const expires = started + 10 * 60_000;
    // The response is indistinguishable for existing and unknown accounts.
    this.challenges.set(code, { username, verifier: hash(token), started, expires });
    return { code, token, expires, command: '/找回口令 ' + code };
  }

  verify(code: string, sender: PlatformActor, sentAt: string, direct: boolean) {
    const row = this.challenges.get(code);
    const at = Date.parse(sentAt);
    if (!direct || sender.provider !== 'feishu' || !row || row.verified || row.expires <= this.now()
      || !Number.isFinite(at) || at < row.started || at >= row.expires || !this.active(row.username)
      || this.member(sender, sentAt) !== row.username) return false;
    row.verified = sender;
    return true;
  }

  complete(code: string, token: string, setPassword: (username: string) => void) {
    const row = this.challenges.get(code);
    if (!row || row.verifier !== hash(token) || row.expires <= this.now())
      throw new WorkbenchError('找回请求已失效，请重新发起。', 409);
    if (!row.verified || !this.active(row.username) || this.member(row.verified) !== row.username)
      throw new WorkbenchError('尚未收到该账号已绑定飞书的本人私聊验证。', 409);
    setPassword(row.username);
    for (const [key, other] of this.challenges) if (other.username === row.username) this.challenges.delete(key);
  }
}
