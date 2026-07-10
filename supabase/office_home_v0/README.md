# 営業所ホーム 概況カード v0.1（§12.0.1）

対象日×自営業所の **状態行・受信件数・配車済み・仮配車・最終配車実行・再予測合図** を
リアルタイム更新で表示する概況カード。**読むだけ（集計）**で、処理本体（予測配車=#25／仕分け／出力）は各機能。

## 指示書の抽象テーブル → 本基盤の実テーブル マッピング
| 指示書 | 本基盤 |
| --- | --- |
| parcels（受信・imported_at） | `public.deliveries`（+ `imported_at` 列を追加） |
| dispatches（実/仮ドライバー） | `public.deliveries.driver_id`（`仮%`=仮ドライバー） |
| dispatches.assigned_at（最終配車実行） | `delivery_status_log.max(changed_at) where source='配車'` |
| 再予測合図 | 最新受信(imported_at) > 最終配車実行(assigned_at) |

## 状態行の導出（青=作業中／緑=完了）
| 条件 | 状態行 | 色 |
| --- | --- | --- |
| 受信=0 | 本日の受信はありません | 緑 |
| 受信>0・配車0 | 予測配車を実行してください | 青 |
| 配車後に新規受信（再予測合図） | 再予測してください | 青 |
| 配車済が全て仕分済 | 仕分け完了・出力可能 | 緑 |
| それ以外（仕分け途中） | 仕分けを進めてください | 青 |

## 実行順（Supabase SQL Editor・手動コピペ）
1. `office_home_summary_v0.sql` … `imported_at` 列追加 ＋ 集計ビュー `office_home_summary`（security_invoker=on／area RLS）＋ Realtime publication 追加（冪等）
2. `seed_office_home_v0.sql` … 検証用ダミー（IT01・対象日=`current_date`＝今日・`OH-%`で隔離・冪等）
3. `check_office_home_v0.sql` … 集計/最終配車実行/状態行/再予測合図 ＋ **規約の実証**（`security_invoker=on`・ビュー列名＝フロント型 `OfficeHomeCard`・status実値 `'配車済'/'仕分済'`・Realtime publication 登録）。RLSの最終証明はアプリ実機

## フロント（sort_nav_v0）
- ルート **`/home`**（area/自営業所が前提）。
- `+page.server.ts`：初期ロード（`office_home_summary` を対象日で1枚・RLS）。
- `+page.svelte`：状態行（青/緑）・4項目・再予測合図バナー・**Realtime購読**（deliveries/delivery_status_log の postgres_changes → 自動再集計）・**手動「状態更新」ボタン**・対象日クイック（前日/今日/翌日・既定today）・5セクションのリンク。
- seed投入後は **/home の既定（今日）** にそのまま表示される。

## 検証
- `node supabase/office_home_v0/pglite_test.mjs` … **23/23 PASS**（受信/配車済(実)/仮配車/最終配車実行/再予測合図/状態行4種/office分離 ＋ `security_invoker=on`／列名一致／status実値）。
- フロント：`npx svelte-check`（0エラー）＋ `npm run build`（成功）。

## 実装上の注意
- **日付はJST固定**（`src/lib/jstDate.ts`）。サーバ(Cloud Run=UTC)/ブラウザのTZに依らず「今日」を解決する（既定日ズレ・クイック二重点灯の防止）。
- **取得失敗は握りつぶさない**。ビュー未適用・障害・RLS事故のときは赤いエラー帯を出し、「本日の受信はありません（緑=完了）」を**表示しない**（状態行は業務判断に使うため）。
- Realtime は publication `supabase_realtime` に `deliveries`/`delivery_status_log` の登録が必要（`office_home_summary_v0.sql` §2 が冪等に追加。`check` ⑧で確認）。

## 範囲外（やらないこと）
予測実行本体（#25）・仕分け/出力/シフトの各機能・配車サマリ詳細(#29)・認証(§12.1)・書き込み系。
