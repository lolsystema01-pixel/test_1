# パイプラインデモ v0（仮・ローカル用）

仕分けナビ（`sort_nav_v0`）の **「一連デモ」ページ**から、フロントのボタンで **本物の 配車→採番(zone配達順)** を動かして見せるための一時デモ。

## 構成
- **DB**：`demo_functions_v0.sql` — SECURITY DEFINER 関数（anonキーで呼べる。owner実行でRLS回避）：
  - `demo_dispatch(date)` … dispatch_build → driver_id付与 → 記録口で配車済
  - `demo_renumber(date)` … renumber_build(zone版) → deliveries反映 → 問合Index同期
  - `demo_reset(date)` … 配車/採番前に戻す（common_id/zone_noは残す＝②はやり直さない）
  - `demo_summary(date)` / `demo_delivery_order(date,driver,limit)` / `demo_drivers(date)` … 表示用
- **フロント**：`apps/sort_nav_v0/src/routes/demo/+page.svelte`（配車開始/採番開始/リセット＋件数サマリ＋zone配達順テーブル）。ホーム右上に「一連デモ」リンク。

## 前提（適用済みであること）
取込＋②付与＋`region_setup_v0`（office/drivers）＋ `dispatch_v0`／`status_log_v0`＋`record_status_transition_v0`／`delivery_order_zone_sort_v0`／`seq_kago_index_v0`。
そのうえで **`demo_functions_v0.sql` を実行**（関数作成＋anon付与）。

## 使い方（ローカル）
1. Supabase SQL Editor で `demo_functions_v0.sql` 実行
2. `apps/sort_nav_v0` を `npm run dev` → ブラウザ → ホーム右上「一連デモ」（または `/demo`）
3. 対象日 `2026-06-29` → **「④ 配車開始」→「⑤ 採番開始」** を押す
   - サマリ（取込/付与/ゾーン/配車済/採番/保留）が更新
   - 下の表が **ゾーン番号順の配達順**で並ぶ（ゾーンが変わる行に緑の区切り線）
   - ドライバーで絞り込み可。**「リセット」で何度でも実演**可能

## ⚠ セキュリティ: 停止済み（2026-07-17）

**当初「割り切り」で anon 実行可（DEFINER）にしていたが、独立2監査が Critical 判定。**
anonキーは実質公開のため、未認証で `demo_reset` による全営業所データ破壊、`demo_summary`/
`demo_delivery_order` による全件PII読取が可能だった（営業所スコープ判定なし）。

- **対応**: `revoke_demo_anon_v0.sql` で anon/authenticated/public から**全面 revoke**（完全停止）。
  ソースの grant ブロックは RETIRED（再実行しても anon は付かない）。
- **`/demo` は動かなくなる**（権限エラー）。デモ不要のため許容。
  リンク: `home/+page.svelte:221`・`sort/+page.svelte:206`（除去は任意）。
- **将来「配車・採番の画面」が要るなら案B**で作り直す:
  authenticated のみ＋関数内 `my_office()` スコープ認可、読取は `security_invoker` ビュー＋area RLS
  （＝ `record_status_transition` / `office_home_summary` と同じ規約）。

## 完全に消す場合（デモを二度と使わないと確定したら）
```sql
-- ※ 8関数すべて（旧READMEの drop 文は preview 系2本が抜けていた）。
drop function if exists
  public.demo_dispatch_preview(date), public.demo_renumber_preview(date),
  public.demo_dispatch(date), public.demo_renumber(date), public.demo_reset(date),
  public.demo_summary(date), public.demo_delivery_order(date,text,int), public.demo_drivers(date);
```
（`/demo` ルートと home/sort のリンクも併せて削除する。）
