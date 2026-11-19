import { useState } from 'react';
import { Avatar as DesignAvatar } from 'antd';
import BoringAvatar from 'boring-avatars';
import { Bot, Folder } from 'lucide-react';
import { avatarPresets, type AvatarPreset, type MemberAvatar } from '../../../src/workbench/profile-contract.ts';

export const avatarDesigns = {
  sky: { label: '晴空', colors: ['#def1ff', '#a8d6ff', '#4e97df', '#1b62a8', '#25497d'] },
  summit: { label: '远山', colors: ['#e9f0ec', '#b7d5ca', '#458375', '#264543', '#96b5b1'] },
  leaf: { label: '新叶', colors: ['#eff7d9', '#c2db87', '#76994c', '#375d35', '#ccd4ad'] },
  sunrise: { label: '日光', colors: ['#fce8c0', '#f7d384', '#eda367', '#ab5d30', '#ffe7d1'] },
  tide: { label: '潮汐', colors: ['#def1f2', '#97d7d8', '#5cb2bd', '#237187', '#2b5276'] },
  starlight: { label: '星光', colors: ['#f1e9ff', '#d9c3f8', '#aa89d0', '#6d4f9f', '#664582'] },
  orbit: { label: '行星', colors: ['#f9e3ed', '#f3b0cb', '#db779a', '#934668', '#e7b8d3'] },
  compass: { label: '罗盘', colors: ['#e6eefd', '#aabedc', '#6c8ab3', '#344f7d', '#cae0eb'] },
} satisfies Record<AvatarPreset, { label: string; colors: string[] }>;
const diameters = { small: 30, medium: 38, large: 56 };

function defaultPreset(value: string) {
  let index = 0;
  for (const point of value) index = (index * 31 + point.codePointAt(0)!) % avatarPresets.length;
  return avatarPresets[index]!;
}

export function Avatar({ value, avatar, kind = 'person', size = 'small' }: {
  value: string; avatar?: MemberAvatar; kind?: 'person' | 'agent' | 'project'; size?: 'small' | 'medium' | 'large';
}) {
  const [failed, setFailed] = useState<string>();
  const src = kind === 'person' && avatar?.kind === 'image' ? avatar.src : undefined;
  const preset = avatar?.kind === 'preset' ? avatar.id : defaultPreset(value);
  const graphic = kind === 'person'
    ? <BoringAvatar size={diameters[size]} name={preset} colors={avatarDesigns[preset].colors} variant="beam" />
    : kind === 'agent' ? <Bot size={17} /> : <Folder size={17} />;
  return <DesignAvatar shape={kind === 'person' ? 'circle' : 'square'} size={diameters[size]} className={'avatar avatar-' + kind}
    data-design={kind === 'person' ? preset : undefined} aria-hidden="true" icon={graphic}
    src={src && failed !== src ? <img src={src} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(src)} /> : undefined} />;
}
