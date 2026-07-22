# driver_native_v0 の前提

- **Expo SDK 54 固定**（`package.json` の `expo: ~54.0.36` が正）。ストアのExpo Goが対応する最新がSDK 54のため、**@latest / SDK 55+ へ勝手に上げない**。
- 依存追加は必ず `npx expo install <pkg>`（SDK54互換の解決を任せる）。
- 参照ドキュメントは https://docs.expo.dev/versions/v54.0.0/
- 検証: `npx tsc --noEmit`（0エラー）＋ `npx expo export --platform ios`（bundle確認後 `dist/` 削除）。
- 実機: `npx expo start -c` → Expo Go。バックグラウンド位置情報など native 機能は Expo Go 不可＝EAS 開発ビルドが必要（第1.5弾）。
