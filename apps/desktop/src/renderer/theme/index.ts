import { type ThemeConfig, theme } from 'antd'

export const appTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#3b82f6', // 现代科技蓝
    colorInfo: '#0ea5e9',
    colorSuccess: '#10b981', // 翡翠绿
    colorWarning: '#f59e0b', // 琥珀黄
    colorError: '#ef4444', // 珊瑚红
    colorBgBase: '#080d1a', // 沉浸暗夜蓝底色
    colorBgContainer: '#0f172a', // 容器背景
    colorBgElevated: '#1e293b', // 弹窗与抽屉背景
    colorBgLayout: '#080d1a',
    colorBorder: 'rgba(148, 163, 184, 0.14)',
    colorBorderSecondary: 'rgba(148, 163, 184, 0.08)',
    colorTextBase: '#f1f5f9',
    colorTextSecondary: '#94a3b8',
    colorTextTertiary: '#64748b',
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      "'Segoe UI'",
      'Roboto',
      "'Helvetica Neue'",
      'Arial',
      "'PingFang SC'",
      "'Microsoft YaHei'",
      'sans-serif'
    ].join(','),
    fontSize: 13,
  },
  components: {
    Layout: {
      bodyBg: '#080d1a',
      headerBg: 'rgba(15, 23, 42, 0.75)',
      siderBg: '#0b1120',
      headerPadding: '0 24px',
    },
    Card: {
      colorBgContainer: 'rgba(15, 23, 42, 0.75)',
      colorBorderSecondary: 'rgba(148, 163, 184, 0.12)',
      borderRadiusLG: 12,
      headerFontSize: 14,
      headerHeight: 44,
    },
    Table: {
      colorBgContainer: 'transparent',
      headerBg: 'rgba(30, 41, 59, 0.5)',
      rowHoverBg: 'rgba(51, 65, 85, 0.3)',
      borderColor: 'rgba(148, 163, 184, 0.12)',
      fontSize: 13,
    },
    Button: {
      borderRadius: 8,
      controlHeight: 34,
      controlHeightSM: 28,
      fontWeight: 500,
    },
    Tabs: {
      cardBg: 'rgba(15, 23, 42, 0.6)',
      itemColor: '#94a3b8',
      itemSelectedColor: '#38bdf8',
      itemHoverColor: '#bae6fd',
    },
    Drawer: {
      colorBgElevated: '#0f172a',
    },
    Modal: {
      contentBg: '#0f172a',
      headerBg: '#0f172a',
    },
    Tag: {
      borderRadiusSM: 4,
    },
    Statistic: {
      titleFontSize: 12,
      contentFontSize: 20,
    },
    Steps: {
      iconSize: 28,
    }
  }
}
