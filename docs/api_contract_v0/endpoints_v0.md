# endpoints_v0 一覧表（API契約 v0）

データフロー順（取込→全国配分→配車→仕分け→出力）＋参照系。対象ロールの「可視範囲」はRLSで解決する。

## T1コア 主要エンドポイント

| # | フロー | メソッド | パス | 用途 | 主な入出力 | 対象ロール |
|---|--------|---------|------|------|-----------|-----------|
| 1 | 取込 | POST | /api/v1/imports | 荷主取込（CSV）。問合番号で重複排除、batch発行 | in: csv／out: import_batch_id, accepted, rejected[] | 本部 / 荷主(自社) |
| 2 | 全国配分 | POST | /api/v1/national-allocation/runs | 共通ID・拠点・営業所・かご等の付与を実行 | in: {mode:dry_run\|commit, import_batch_id}／out: run_id, summary, unregistered[] | 本部 |
| 3 | 全国配分 | GET | /api/v1/national-allocation/runs/{run_id} | 実行結果サマリ参照 | out: status, counts | 本部 |
| 4 | 全国配分 | GET | /api/v1/unregistered-addresses | 未登録住所一覧（修正フロー） | list規約 | 本部 / 営業所 |
| 5 | 配車 | POST | /api/v1/dispatch/runs | ドライバー予測の実行 | in: {date, office_code, mode, priority}／out: run_id, provisional_drivers | 営業所 |
| 6 | 配車 | GET | /api/v1/dispatch/runs/{run_id} | 配車結果参照 | out: assignments, shortage | 営業所 |
| 7 | 仕分け | GET | /api/v1/sorting/today | 当日分の問合Indexを一括照会 | in: {date, office_code}／out: delivery_index[] | 営業所 |
| 8 | 出力 | POST | /api/v1/labels | ラベル印刷データ生成（b-PAC／PDF） | in: {tracking_numbers[]\|date}／out: label_job / pdf_url | 営業所 |
| 9 | 出力 | POST | /api/v1/reports | 帳票生成（配車表/GoDoor CSV/かご持出表） | in: {type, date, office_code}／out: file_url | 営業所 / 本部 |

## 参照系

| # | メソッド | パス | 用途 | 対象ロール（可視範囲はRLS） |
|---|---------|------|------|------------------------------|
| 10 | GET | /api/v1/deliveries | 配送データ一覧（list規約） | 全ロール |
| 11 | GET | /api/v1/deliveries/{tracking_number} | 配送データ1件 | 全ロール |
| 12 | GET | /api/v1/delivery-index | 問合Index照会 | 全ロール |
| 13 | GET | /api/v1/masters/address-master | 全国Master参照 | 本部（v0） |
| 14 | GET | /api/v1/masters/zone-plan | 全国ZonePlan参照 | 本部（v0） |
| 15 | GET | /api/v1/masters/offices | 営業所マスタ参照 | 本部 / 営業所 |
| 16 | GET | /api/v1/drivers | ドライバー参照 | 本部 / 営業所 / 本人 |
| 17 | GET | /api/v1/work-schedules | 稼働予定参照 | 本部 / 営業所 / 本人 |

## 予約（名称のみ・詳細は別指示書）

| メソッド | パス | トラック |
|---------|------|---------|
| POST/PATCH | /api/v1/work-schedules（申請/承認） | T1（6.4） |
| - | /api/v1/redelivery-requests | T2 |
| - | /api/v1/shipper-portal | T2 |
| - | /api/v1/support-tickets | T2 |
| - | /api/v1/driver/deliveries, /driver/attendance, /driver/gps, /driver/reports | T3 |

## 方針メモ

- **配布専用エンドポイントは作らない**：全国配分 run の帰属付与＋RLSで表現（4.5）。
- 実行系（全国配分・配車）は run リソースの作成（POST .../runs）で表現し、dry_run/commit を body で切替。
