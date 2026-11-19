import { useEffect, useState } from 'react';
import { Upload as DesignUpload } from 'antd';
import { Check, Pencil, Upload } from 'lucide-react';
import { avatarEncodedLimit, avatarPixels, avatarPresets } from '../../src/workbench/profile-contract.ts';
import { api, useData, type PersonalProfile } from './api.ts';
import { avatarDesigns } from './components/avatar.tsx';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
import { SettingsDrawer } from './components/settings-drawer.tsx';
import { imNames } from './im-login.tsx';
import { Avatar, Failure, Field, Loading, Section, useActions } from './ui.tsx';

type Choice = PersonalProfile['avatarChoice'];
type Portrait = { blob: Blob; image: string };
const acceptedPhotos = 'image/png,image/jpeg,image/webp';

async function thumbnail(file: File): Promise<Portrait> {
  if (!acceptedPhotos.split(',').includes(file.type) || file.size > 10 * 1024 * 1024)
    throw new Error('请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片。');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('无法读取这张图片，请重新选择。'); });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = avatarPixels;
  try {
    const size = Math.min(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context || !size) throw new Error('无法读取这张图片，请重新选择。');
    context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, avatarPixels, avatarPixels);
  } finally { bitmap.close(); }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('无法生成头像，请重新选择。');
  const image = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  if (image.length > avatarEncodedLimit) throw new Error('无法生成头像，请选择另一张照片。');
  return { blob, image };
}

export function PersonalProfileSettings() {
  const request = useData<PersonalProfile>('account/profile');
  const [editing, setEditing] = useState(false);
  const profile = request.data;
  return <Section title="个人资料" action={profile && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil />编辑资料</Button>}>
    {request.error && <Failure error={request.error} retry={() => void request.refetch()} />}
    {!profile && !request.error && <Loading />}
    {profile && <div className="profile-summary">
      <Avatar avatar={profile.avatar} value={profile.username} size="large" />
      <div><strong>{profile.displayName ?? profile.username}</strong>
        <p className="muted-text">账号 {profile.username}</p>
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
      </div>
    </div>}
    {editing && profile && <ProfileEditor profile={profile} close={() => setEditing(false)} />}
  </Section>;
}

function ProfileEditor({ profile, close }: { profile: PersonalProfile; close: () => void }) {
  const { run, busy } = useActions();
  const [displayName, setDisplayName] = useState(profile.customName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [choice, select] = useState<Choice>(profile.avatarChoice);
  const [upload, setUpload] = useState<Portrait>();
  const [previewUrl, setPreviewUrl] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState('');
  useEffect(() => {
    if (!upload) return;
    const url = URL.createObjectURL(upload.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [upload]);
  const uploaded = previewUrl ? { kind: 'image' as const, src: previewUrl }
    : profile.avatarChoice.kind === 'upload' ? profile.avatar : undefined;
  const preview = choice.kind === 'auto' ? profile.syncedAvatar : choice.kind === 'upload' ? uploaded : choice;
  const baseName = profile.syncedName ?? profile.username;
  const origin = profile.syncProvider ? imNames[profile.syncProvider] : 'IM';
  const changed = displayName.trim() !== profile.customName || bio.trim() !== (profile.bio ?? '')
    || JSON.stringify(choice) !== JSON.stringify(profile.avatarChoice) || !!upload && choice.kind === 'upload';
  return <SettingsDrawer title="编辑个人资料" close={close} submit={{ form: 'member-profile', label: '保存资料', disabled: !changed || preparing }}>
    <form id="member-profile" className="form profile-form" onSubmit={async event => {
      event.preventDefault();
      if (!changed || preparing) return;
      if (await run(() => api('account/profile', {
        displayName, bio, avatar: choice.kind === 'upload' ? { kind: 'upload', image: upload?.image } : choice,
      }), '个人资料已保存')) close();
    }}>
      <div className="profile-summary profile-summary-preview">
        <Avatar value={profile.username} avatar={preview} size="large" />
        <div><strong>{displayName.trim() || baseName}</strong><p className="muted-text">账号 {profile.username}</p></div>
      </div>
      <Field label="显示名称" hint={profile.syncedName ? '留空使用' + origin + '同步名称。' : '留空显示账号名。'}>
        <Input value={displayName} placeholder={baseName} maxLength={60} onChange={event => setDisplayName(event.target.value)} />
      </Field>
      <Field label="个人简介" hint="同项目成员和平台成员管理员可见。">
        <Input value={bio} maxLength={160} placeholder="介绍你的职责或擅长的事" onChange={event => setBio(event.target.value)} />
      </Field>
      <fieldset className="profile-avatar-fieldset" disabled={busy || preparing}>
        <legend>头像</legend>
        <div className="profile-avatar-options">
          <label className="profile-avatar-option">
            <input type="radio" name="avatar" checked={choice.kind === 'auto'} onChange={() => select({ kind: 'auto' })} />
            <Avatar size="medium" value={profile.username} avatar={profile.syncedAvatar} />
            <span>{profile.syncedAvatar ? origin + '头像' : '自动选择'}</span><Check className="profile-avatar-check" size={13} aria-hidden="true" />
          </label>
          {avatarPresets.map(id => <label className="profile-avatar-option" key={id}>
            <input type="radio" name="avatar" checked={choice.kind === 'preset' && choice.id === id} onChange={() => select({ kind: 'preset', id })} />
            <Avatar size="medium" value={profile.username} avatar={{ kind: 'preset', id }} />
            <span>{avatarDesigns[id].label}</span><Check className="profile-avatar-check" size={13} aria-hidden="true" />
          </label>)}
          {uploaded && <label className="profile-avatar-option">
            <input type="radio" name="avatar" checked={choice.kind === 'upload'} onChange={() => select({ kind: 'upload' })} />
            <Avatar size="medium" value={profile.username} avatar={uploaded} />
            <span>我的照片</span><Check className="profile-avatar-check" size={13} aria-hidden="true" />
          </label>}
        </div>
      </fieldset>
      <div className="profile-upload">
        <DesignUpload accept={acceptedPhotos} disabled={preparing || busy} showUploadList={false} beforeUpload={async file => {
            setPhotoError('');
            setPreparing(true);
            try {
              setUpload(await thumbnail(file));
              select({ kind: 'upload' });
            } catch (error) { setPhotoError(error instanceof Error ? error.message : '无法读取这张图片，请重新选择。'); }
            finally { setPreparing(false); }
            return DesignUpload.LIST_IGNORE;
          }}>
          <Button variant="outline" loading={preparing} disabled={preparing || busy}><Upload aria-hidden="true" />{uploaded ? '更换照片' : '上传照片'}</Button>
        </DesignUpload>
        {preparing && <span role="status" className="muted-text">正在生成头像</span>}
      </div>
      {photoError && <p className="field-error" role="alert">{photoError}</p>}
    </form>
  </SettingsDrawer>;
}
