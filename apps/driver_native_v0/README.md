# driver_native_v0

ドライバーアプリ（RN + Expo・独立アプリ）。MVP = 進捗可視化（当日ルート表示＋完了/不在の記録）。
検証環境向け。設計の背景は `docs/superpowers/plans/2026-07-17-driver-mvp-wiring.md` を参照。

## モード切替（DEMO / LIVE）

`.env` の設定有無で自動的に切り替わる（`src/lib/supabase.ts`）。**未設定でもアプリは壊れない**＝
常にDEMOへフォールバックする設計。

- **DEMO**（既定・`.env` 未設定）: `src/mockData.ts` のモックデータのみで動作。Supabaseに一切接続しない。
- **LIVE**（`.env` に `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` を設定）: Supabase接続。
  ログイン→プロフィール解決（`src/lib/authProfile.ts`）→当日ルート取得（`src/lib/deliveries.ts`）→
  完了/不在の記録（`src/lib/queue.ts` 経由で `record_delivery_result` rpc）。

画面右上の `DEMO`/`LIVE` バッジ（`ModeBadge`、`App.tsx`）で現在のモードを常時表示する。

## rpc契約（`record_delivery_result`）

`supabase.rpc('record_delivery_result', { p_tracking_number, p_result, p_lat, p_lng })`。

- 成功時のレスポンス種別（`jsonb`）:
  - `{"result":"recorded", ...}` — 新規記録
  - `{"result":"already", ...}` — 既に同じ結果で記録済み（冪等・二度押し無害）。両方とも**成功**として扱う。
- 恒久エラー（サーバに記録されない・**再送しない**）:
  - `42501` — 権限エラー（担当ドライバー以外・driver専用口にdriver以外がアクセス等）
  - `23514` — 値域エラー（`p_result` が完了/不在以外・座標が不正・未配車/配車済など線形遷移の違反）
  - `P0002` — 対象の問合番号が見つからない
- それ以外（ネットワーク断など）は一時エラーとして扱い、`src/lib/queue.ts` の取りこぼし防止キュー
  （AsyncStorage）に積んで、次のアプリforeground復帰時に自動再送する。

### 恒久エラー時の巻き戻し方針

タップ時は楽観更新でローカルを即座に「完了/不在」にする（`App.tsx` `handleFinalizeStop`）。

- **恒久エラー**（上記3コード）: サーバに記録されていないので、**画面も未処理へ巻き戻す**
  （`App.tsx` `submitDeliveryResult`）＋トーストでエラーを通知。
- **一時エラー**: キューに積んで自動再送するので、楽観更新の「済」表示はそのまま維持する
  （サイレント・ユーザー操作を妨げない）。

## LIVEモードの前提（DBスキーマ）

`deliveries` テーブルに **`recipient_name` 列が存在すること**（`src/lib/deliveries.ts` の
`fetchTodayRoute` が select する）。この列が無い環境で LIVE モードに切り替えると、当日ルート取得が
`42703`（列が存在しない）で失敗する。`csv_import_v0` 等の適用でスキーマが揃っていることを確認してから
LIVE化すること。

## 認証状態

`App.tsx` の `AuthStatus` は LIVEモードのみ意味を持つ状態機械。

- `checking` → セッション確認中
- `signedOut` → 未ログイン（`LoginScreen`）
- `unauthorized` → **本当に**未登録（`profiles` 行が無い／`role≠driver`／`driver_id` 無し）。
  管理者への連絡を促す（`UnauthorizedScreen`）
- `error` → 認証解決中の**一時・通信エラー**（`auth.getUser()`/`profiles` 取得の失敗等）。
  `unauthorized` とは区別し、`AuthErrorScreen` で「再試行」ボタン（`resolveDriverIdentity` を
  再実行）＋「ログアウト」を提示する
- `signedIn` → 通常フロー

`drivers`（氏名）の引き失敗は認可とは無関係なので `unauthorized`/`error` にはせず、`driver_id` を
氏名フォールバックにして `ok` を返す（`src/lib/authProfile.ts`）。

## 実機手順

`docs/superpowers/plans/2026-07-17-driver-mvp-wiring.md` の Task 3 を参照。

## 既知の改善余地（今回スコープ外）

- flush成功後にAppStateから当日ルートを再フェッチしない（成功済みの表示更新は次回起動待ち）
- `flushQueue` 開始前に `getUser()` で認証セッションの生存確認を往復していない
- クロックイン（出勤）時点で `expo-location` の権限を先読みプリフェッチしていない（初回の完了/不在
  タップ時に初めてリクエストされる）
