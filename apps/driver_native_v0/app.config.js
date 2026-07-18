// app.json → app.config.js化（Supabase配線）。
// EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY を expo.extra に注入する。
// 値は直書きしない：.env（gitignore対象）または実行環境の環境変数から読む。
// 未設定のときは extra が null のままになり、アプリはモックモードにフォールバックする
// （src/lib/supabase.ts の isLiveMode 判定）。

module.exports = {
  expo: {
    name: 'driver_native_v0',
    slug: 'driver_native_v0',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? null,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? null,
    },
  },
};
