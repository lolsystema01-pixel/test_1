# 配車サマリ（仮割当・保留・希望外）v0.2

指示書「配車サマリ（仮割当・保留・希望外の検出と表示）v0.2」の DB 成果物。
配車結果を **deliveries（確定実績・既存の役割別RLS）** から読んで、3指標を検出・集計するだけ（割当はしない）。§12.5.3。

## v0.1→v0.2 の再定義
配車後の「未割当（実にも仮にも割り当たっていない）」は構造上ゼロと判明したため作らない。指標を **仮割当／保留／希望外** に再定義。正は `deliveries`（`dispatch_*` は hq限定RLSで security_invoker 化が要るため第2段送り＝本モジュールは触らない）。

## 3指標（対象日×自営業所）

| 指標 | 判定（deliveries） | 意味／打ち手 |
|---|---|---|
| 仮割当 | `driver_id LIKE '仮%'` | 実で捌けない＝要員不足。人/シフトを増やす。0が理想 |
| 保留 | `common_id IS NULL かつ status='保留'` | 住所が引けず配車の土俵に乗らない＝マスタ不備 |
| 希望外 | 割当 common_id が担当ドライバーの `preferred_areas` に無い（実のみ） | 希望と違うエリア。#28／シフトv0.7 実装後に点灯（それまで0） |

## ファイルと実行順（Supabase SQL Editor）

| # | ファイル | 内容 |
|---|---|---|
| 1 | `dispatch_summary_v0.sql` | 3ビュー：`dispatch_summary`(3指標)／`dispatch_summary_by_driver`(ドライバー別内訳)／`dispatch_summary_detail`(明細カテゴリ)。すべて **security_invoker=on** で deliveries RLS 継承 |
| 2 | `seed_dispatch_summary_v0.sql` | 検証用（冪等）：要員不足で仮割当5／common_id未付与で保留2／希望エリア外で希望外3 |
| 3 | `check_dispatch_summary_v0.sql` | 確認（3指標・概況カード一致・保留定義一致・ドライバー別・RLSなりすまし） |

前提: `dbschema_v0`（offices の A01 等）・`shift_mgmt v0.7`（`work_schedules.preferred_areas`・1日1稼働 UNIQUE）実機済み。

## 設計判断
- **deliveries ベース**（v0.2）: `dispatch_*`（assign_rank 等の割当理由）は RLS が hq のみで security_invoker 化が要るため第2段。#28 で `dispatch_assignments.off_preference` に希望外を記録済みだが、**#29 v0.2 は deliveries から同一条件で再計算**する（役割別RLSがそのまま効く deliveries を正にする）。
- **希望外の条件は #28 と同一**（業務A確定 2026-07-20）: 実ドライバーのみ・`preferred_areas` NULL は数えない（希望なし＝どこでも可）・common_id が preferred_areas に無い。preferred_areas は `work_schedules`（driver_id×work_date=delivery_date・承認）から引く。1日1稼働 UNIQUE により join で行が増えない。
- **仮割当は概況カードと同定義**（`office_home_summary` の仮配車＝`driver_id LIKE '仮%'`）＝件数・人数が一致する（合格条件）。
- **security_invoker の依存**: ビューは `deliveries` と `work_schedules` を読む。呼び出しロールは両方に SELECT 権が要る（実Supabaseは authenticated に付与済み＋RLS）。area は自営業所の deliveries と、その配下ドライバーの work_schedules を見られるため成立する。

## 検証（Claude Code・pglite 16/16）
```bash
node supabase/dispatch_summary_v0/pglite_test.mjs   # 16/16
```
- 3指標（仮4/保留2/希望外3）＋受信16 … ①
- 希望外の #28 同一条件：DRV2(希望{ZA}→ZB)=3・DRV3(希望NULL)=0・仮=0 … ②
- 明細カテゴリ（仮割当/保留/希望外/正常） … ③
- RLS：area は自営業所のみ・範囲外0件（範囲内>0 と対） … ④
- 希望外フォールバック（preferred_areas 全NULL→0＝実装前の状態） … ⑤

## 範囲外（別担当・後続）
- 配車サマリ**画面**（3指標＋ドライバー別＋明細＋警告色＋再実行導線・確認ダイアログ）＝フロント担当。
- 自動割当の実処理（dispatch_build＝配車v0.5）・再実行のクリア処理。割当理由(assign_rank)つき詳細＝dispatch_* 系（第2段・RLS手当て要）。手動調整#30。希望エリア入力（シフトv0.7フロント）。本番データ・現行GAS。

## 申し送り
- **希望外は preferred_areas にデータが入るまで 0**（shift_mgmt はマージ済で列は在るが、希望を反映した割当は #28＝`assign_priority/v0_3` マージ後）。ビューは正しく書いてあるので実装後に自動点灯。
- 表示名（common_id→エリア名）が要るなら、画面側で #28 の `common_id_display` ビューを join する（#28 マージ後）。本ビューは common_id を素で返す。
