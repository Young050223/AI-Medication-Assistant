import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.medicationtracker.app',
  appName: 'AI用药助手',
  webDir: 'dist',
  // iOS 配置
  ios: {
    // 隐藏 WebView 的滚动条
    scrollEnabled: true,
    // 内容模式
    contentInset: 'automatic',
    // 允许内联媒体播放
    allowsLinkPreview: false,
  },
  // 服务器配置
  server: {
    // 允许导航到任何URL
    allowNavigation: ['*'],
  },
  // 插件配置
  plugins: {
    // 键盘配置
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
