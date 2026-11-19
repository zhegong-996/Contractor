import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ConsoleAccount } from '../console-auth.ts';
import { WorkbenchError } from './errors.ts';
import { avatarEncodedLimit, avatarPixels, avatarPresets, type AvatarPreset, type MemberAvatar } from './profile-contract.ts';

const profileText = (limit: number) => z.string().trim().max(limit).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value), '请去掉不可见控制字符。');
export const profileUpdate = z.object({
  displayName: profileText(60), bio: profileText(160),
  avatar: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('auto') }).strict(),
    z.object({ kind: z.literal('preset'), id: z.enum(avatarPresets) }).strict(),
    z.object({ kind: z.literal('upload'), image: z.base64().max(avatarEncodedLimit).optional() }).strict(),
  ]),
}).strict();
type ProfileUpdate = z.infer<typeof profileUpdate>;
type SavedProfile = {
  display_name: string;
  bio: string;
  preset: AvatarPreset | null;
  photo_id: string | null;
};
type Identity = Pick<ConsoleAccount, 'username' | 'displayName' | 'imProfile'>;
type MemberProfile = { displayName?: string; avatar?: MemberAvatar; bio?: string };

function uploadedPng(image: string) {
  const bytes = Buffer.from(image, 'base64');
  if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR'
    || bytes.readUInt32BE(16) !== avatarPixels || bytes.readUInt32BE(20) !== avatarPixels
    || bytes[24] !== 8 || ![2, 6].includes(bytes[25]!) || bytes.toString('hex', bytes.length - 12) !== '0000000049454e44ae426082')
    throw new WorkbenchError('头像图片格式无效，请重新选择图片。', 400);
  return bytes;
}

export function openMemberProfiles(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_member_profile (
    username TEXT PRIMARY KEY, display_name TEXT NOT NULL, bio TEXT NOT NULL,
    preset TEXT, photo_id TEXT, photo BLOB
  )`);
  const find = db.prepare('SELECT display_name,bio,preset,photo_id FROM workbench_member_profile WHERE username=?');
  const read = (username: string) => find.get(username) as SavedProfile | undefined;
  const getPhoto = db.prepare('SELECT photo FROM workbench_member_profile WHERE username=? AND photo_id=?');
  const syncedAvatar = (account: Identity): MemberAvatar | undefined =>
    account.imProfile?.avatar ? { kind: 'image', src: account.imProfile.avatar } : undefined;
  function view(account: Identity | undefined, saved = account && read(account.username)): MemberProfile {
    if (!account) return {};
    const avatar: MemberAvatar | undefined = saved?.preset ? { kind: 'preset', id: saved.preset }
      : saved?.photo_id ? { kind: 'image', src: '/api/member-avatar/' + encodeURIComponent(account.username) + '/' + saved.photo_id }
        : syncedAvatar(account);
    return { displayName: saved?.display_name || account.displayName, avatar, bio: saved?.bio || undefined };
  }
  function own(account: Identity) {
    const saved = read(account.username);
    return {
      username: account.username, ...view(account, saved), customName: saved?.display_name ?? '',
      syncedName: account.displayName, syncedAvatar: syncedAvatar(account), syncProvider: account.imProfile?.provider,
      avatarChoice: saved?.preset ? { kind: 'preset' as const, id: saved.preset }
        : saved?.photo_id ? { kind: 'upload' as const } : { kind: 'auto' as const },
    };
  }
  function save(account: Identity, update: ProfileUpdate) {
    const { avatar } = update;
    const preset = avatar.kind === 'preset' ? avatar.id : null;
    const bytes = avatar.kind === 'upload' && avatar.image ? uploadedPng(avatar.image) : null;
    const photoId = bytes && createHash('sha256').update(bytes).digest('hex');
    if (avatar.kind === 'upload' && !bytes) {
      const changed = db.prepare(`UPDATE workbench_member_profile SET display_name=?,bio=?
        WHERE username=? AND photo_id IS NOT NULL`).run(update.displayName, update.bio, account.username);
      if (!changed.changes) throw new WorkbenchError('请先选择一张头像图片。', 409);
    } else {
      db.prepare(`INSERT INTO workbench_member_profile VALUES (?,?,?,?,?,?)
        ON CONFLICT(username) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,
        preset=excluded.preset,photo_id=excluded.photo_id,photo=excluded.photo`)
        .run(account.username, update.displayName, update.bio, preset, photoId, bytes);
    }
    return own(account);
  }
  const photo = (username: string, revision: string) => getPhoto.get(username, revision)?.photo as Uint8Array | undefined;
  return { view, own, save, photo };
}
