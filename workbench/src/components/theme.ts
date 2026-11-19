import type { ThemeConfig } from 'antd';

export const workbenchTheme = {
  hashed: false,
  cssVar: { key: 'contractor' },
  token: {
    colorPrimary: '#1763cc',
    colorLink: '#1763cc',
    colorText: '#182f4c',
    colorTextSecondary: '#4b617a',
    colorTextPlaceholder: '#5d7188',
    colorBorder: '#b7cbe2',
    colorBorderSecondary: '#dbe6f3',
    colorBgLayout: '#f3f7fd',
    colorBgContainer: '#ffffff',
    colorError: '#b4233d',
    borderRadius: 8,
    controlHeight: 36,
    controlHeightSM: 32,
    fontFamily: 'Instrument Sans, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  components: {
    Button: { defaultShadow: 'none', primaryShadow: 'none', dangerShadow: 'none', fontWeight: 600 },
    Input: { activeShadow: '0 0 0 3px #1763cc26' },
    Layout: { headerBg: '#fff', lightSiderBg: '#eaf3ff', bodyBg: '#f3f7fd' },
    Menu: { itemBg: 'transparent', itemColor: '#36516f', itemSelectedBg: '#dceaff',
      itemSelectedColor: '#114a97', itemHoverBg: '#e2eeff', itemHeight: 40, itemBorderRadius: 7 },
    Card: { headerBg: '#f8fbff', bodyPaddingSM: 18, headerHeightSM: 44 },
    Tabs: { itemColor: '#415871', itemSelectedColor: '#114a97', inkBarColor: '#1763cc', cardBg: '#eef5ff' },
    Table: {
      headerBg: '#eef5ff', headerColor: '#314963', borderColor: '#dbe6f3',
      rowHoverBg: '#f4f8ff', cellPaddingBlockSM: 11, cellPaddingInlineSM: 14,
    },
  },
} satisfies ThemeConfig;
