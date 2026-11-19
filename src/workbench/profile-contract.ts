export const avatarPresets = ['sky', 'summit', 'leaf', 'sunrise', 'tide', 'starlight', 'orbit', 'compass'] as const;
export type AvatarPreset = typeof avatarPresets[number];
export type MemberAvatar = { kind: 'preset'; id: AvatarPreset } | { kind: 'image'; src: string };
export const avatarPixels = 96;
export const avatarEncodedLimit = 52_000;
