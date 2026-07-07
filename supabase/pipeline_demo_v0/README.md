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

## セキュリティ（割り切り）
- **ローカルデモ用の一時物**。demo_* は anon から実行可（DEFINER）。本番投入する類のものではない（デモ後は関数を drop 可）。
- 住所を表示する（内部デモ想定）。外部公開はしない。

## 検証（Claude Code）
- pglite 8/8（demo_* のコンパイル・実行・リセット・anon付与）／sort_nav svelte-check 0/0・build 成功。

## 後片付け（デモ終了後）
```sql
drop function if exists public.demo_dispatch(date), public.demo_renumber(date), public.demo_reset(date),
  public.demo_summary(date), public.demo_delivery_order(date,text,int), public.demo_drivers(date);
```
（フロントの `/demo` ルートとホームのリンクは残しても害なし。）
