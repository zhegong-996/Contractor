import type { ThemeConfig } from 'antd';

export const palettes = {
  light: {
    page: '#f5f7fa', surface: '#ffffff', ink: '#172033', dim: '#526176', placeholder: '#69788c',
    border: '#c8d1dc', line: '#e3e8ef', muted: '#f7f8fa', hover: '#f3f5f8', pressed: '#e9edf2',
    primary: '#2563eb', link: '#1d4ed8', selected: '#edf4ff', ring: '#2563eb1a', onPrimary: '#ffffff',
    danger: '#c0364c', success: '#18794e', warning: '#9a6700',
  },
  dark: {
    page: '#10161e', surface: '#18212c', ink: '#e6edf5', dim: '#b0bccb', placeholder: '#96a6b8',
    border: '#53667c', line: '#344354', muted: '#1d2835', hover: '#243141', pressed: '#2a394c',
    primary: '#4384ee', link: '#9dc3ff', selected: '#233a59', ring: '#589bff40', onPrimary: '#07172c',
    danger: '#ff96a3', success: '#81d4a4', warning: '#edc476',
  },
};
export function themeFor(mode: keyof typeof palettes): ThemeConfig {
  const p = palettes[mode];
  return {
    hashed: false, cssVar: { key: 'contractor' },
    token: {
      colorPrimary: p.primary, colorLink: p.link, colorText: p.ink, colorTextSecondary: p.dim,
      colorTextPlaceholder: p.placeholder, colorBorder: p.border, colorBorderSecondary: p.line,
      colorBgLayout: p.page, colorBgContainer: p.surface, colorBgElevated: p.surface,
      colorError: p.danger, colorSuccess: p.success, colorWarning: p.warning,
      borderRadius: 6, controlHeight: 36, controlHeightSM: 32,
      motionDurationFast: '0.08s', motionDurationMid: '0.14s', motionDurationSlow: '0.20s',
      motionEaseOutBack: 'cubic-bezier(0.2, 0.8, 0.2, 1)', motionEaseInBack: 'cubic-bezier(0.4, 0, 1, 1)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif',
    },
    components: {
      Button: { defaultShadow: 'none', primaryShadow: 'none', dangerShadow: 'none', fontWeight: 550,
        defaultBg: p.surface, defaultColor: p.ink, defaultBorderColor: p.border, primaryColor: p.onPrimary,
        textHoverBg: p.hover, colorBgTextActive: p.pressed },
      Input: { activeShadow: '0 0 0 3px ' + p.ring, activeBorderColor: p.primary, hoverBorderColor: p.border },
      Layout: { headerBg: p.surface, lightSiderBg: p.surface, bodyBg: p.page },
      Menu: { itemBg: 'transparent', itemColor: p.dim, itemSelectedBg: p.selected,
        itemSelectedColor: p.link, itemHoverBg: p.hover, itemHeight: 38, itemBorderRadius: 6 },
      Card: { headerBg: p.surface, bodyPaddingSM: 18, headerHeightSM: 46, headerFontSizeSM: 14 },
      Tabs: { itemColor: p.dim, itemSelectedColor: p.link, inkBarColor: p.primary, cardBg: p.hover },
      Table: { headerBg: p.muted, headerColor: p.dim, borderColor: p.line,
        rowHoverBg: p.muted, cellPaddingBlockSM: 11, cellPaddingInlineSM: 14 },
      Modal: { titleFontSize: 17, titleLineHeight: 1.5, headerBg: p.surface },
      Drawer: { colorBgElevated: p.surface }, Alert: { borderRadiusLG: 6 },
    },
  };
}
export const workbenchTheme = themeFor('light');
