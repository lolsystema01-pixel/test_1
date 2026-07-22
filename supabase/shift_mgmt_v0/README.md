# シフト管理（DB＋書き込み口・フロント抜き）v0.7

指示書「シフト管理（DB＋書き込み口・フロント抜き）v0.7」の成果物。
**シフトの DB ＋ 3つの書き込み口（DEFINER関数）＋ I/O仕様書**。フロント（ドライバーアプリ／営業所の編集・承認画面）は別担当が**同じ関数を RPC で叩く**。

## 立ち位置（分業）
- T3ドライバーアプリはネイティブで別担当。DB（Supabase＋RLS）はこちら。シフト申請は単純DB操作＝Cloud Run 不要、ネイティブが関数を RPC で直接叩く。
- 本書＝**DB＋書き込み口＋I/O仕様書まで**。画面は各担当（契約は `shift_rpc_contract_v0.md`）。

## ファイルと実行順（Supabase SQL Editor・手動コピペ）

| # | ファイル | 内容 |
|---|---|---|
| 1 | `work_schedules_ext_v0.sql` | `work_schedules` に `preferred_areas`(common_id[])/`is_virtual`/`is_absent` 追加（**default無し・既存不変**）＋希望エリア妥当性（`preferred_areas_ok`）＋**`UNIQUE(driver_id, work_date)`（1日1稼働）**＋重複警告 |
| 2 | `shift_labels_office_v0.sql` | 営業所別 `shift_labels(office_code, work_type→hours)`＋`shift_hours` から**全営業所複製で移行**＋配布口 `seed_office_shift_labels`＋RLS(hq/area参照) |
| 3 | `cap_wire_shift_labels_v0.sql` | `dispatch_build` の cap 時間側参照を `shift_hours`→`shift_labels(office_code,work_type)` へ差替。**式#27は無変更**。承認済み稼働のラベル未定義は**事前チェックで名指し停止** |
| 4 | `shift_write_definers_v0.sql` | 3書き込み口 `apply_shift`/`approve_reject_shift`/`office_direct_shift`（DEFINER・認可強制・write policy無し） |
| — | `shift_rpc_contract_v0.md` | **3関数のI/O仕様書**（ネイティブ／営業所フロントへ配布） |

**⚠ 適用順の注意**: `cap_wire`（③）は `dispatch_build` を create or replace する。dispatch_build の正は `vocab_fix_v0/migrate_functions_to_area_master_v0.sql`（④=area_master版）で、③は**その④版を完全転記＋(0)在庫チェック＋(1)join差替のみ**。**④ → ③ の順**で適用すること（`dispatch_v0.sql` の旧版=shift_hours参照 を後から流すと巻き戻る＝RETIRED表明済み）。

## 3つの書き込み口（認可が各々違う門番）

| 書き込み口 | 呼ぶ人 | 関数内の認可（門番） |
|---|---|---|
| `apply_shift` | driver | `my_driver()` 本人のみ・`request_period_days` 期間チェック・**1日1稼働**の二重申請防止（却下後は再申請可）。**driver_id は引数で受けない**（なりすまし防止） |
| `approve_reject_shift` | area | `my_office_drivers()` 配下のみ・状態遷移（申請中→承認/却下） |
| `office_direct_shift` | area | 同上・承認状態で直接登録（フォールバック・却下は承認で上書き） |

認可は**関数内で強制**＝RPC 直叩きでも門番が効く。書込はこの3関数のみ・`work_schedules` に write policy は作らない（認証v1.1）。

## 設計判断（業務A確認済み 2026-07-20）

- **is_virtual = フラグ列だけ**（(a)）。`work_schedules.driver_id` は drivers への FK で、仮ドライバー（仮N）は drivers に無く配車エンジンが実行時に `dispatch_drivers` 上に生成するだけ。「仮の稼働も work_schedules に入れる」(b) は FK を外すことになり既存設計が崩れるので**採らない**。列だけ用意（将来要件が出たら別途設計）。
- **shift_labels 移行＝shift_hours 全行 × 全営業所を複製**。「ラベル未定義=エラー」と「既存デモを壊さない」を両立する唯一の道。移行直後は全営業所が同ラベル・同時間＝**既存 cap は1件も変わらない（回帰成立）**。営業所別に変えたければその行だけ編集。
- **ラベル未定義はフォールバックしない（指示書厳守）**。ただし①名指しエラー（「営業所 X01 の稼働区分『フル』が未定義」）②cap 計算の前に事前チェックして silent に落とさない（このプロジェクトが繰り返し潰してきた「join が行を落として静かに劣化」の再発防止）③新設営業所へは `seed_office_shift_labels` で明示配布（自動実行しない＝管理者が「標準を入れる/独自定義」を選ぶ）。
- **is_absent は器のみ**（cap 除外は未実装）。指示書が cap 変更を「時間側の参照だけ差替」と絞っているため。printer_model / auto_logout と同じ「器あり・消費未実装」。
- **1日1稼働＝`UNIQUE(driver_id, work_date)`**（業務A確定 2026-07-20）。cap＝skill×hours も dispatch_drivers PK`(run_date,driver_id)` も「1日1ドライバー1cap」前提。同一(driver,date)の承認が2行あると dispatch_build (1) が 23505 で**その日の全営業所配車が全停止**（外部レビュー実証）→ 定義域として制約で禁止。書き込み口の二重判定も `(driver,date)` に統一（3つ組のままだと2件目がINSERT時23505で不親切に落ちる）。却下後だけは再申請/上書きを許す。

## 依存・申し送り

- ⚠ **希望エリアの表示名は #28 依存**。`preferred_areas` は common_id で保存するが、**人間可読なエリア名の解決は #28 の表示名解決ビュー（未実装）**。#28 完成までフロントは common_id を出すか希望エリア入力を保留する（`shift_rpc_contract_v0.md` 共通事項）。
- **新設営業所でラベル0件だと配車が落ちる条件**＝「承認済み稼働があるのに (office, work_type) が未定義」。稼働申請が無い営業所は dispatch_build の対象に入らず落ちない。`seed_office_shift_labels` を呼ぶと NOTICE で「標準初期値・実態と違えば管理者設定で修正」を促す（標準を入れて放置→実態ズレ、が唯一の残リスク）。
- `shift_hours`（旧グローバル）は**消さない**（配車の旧経路・verify_rls_scope 等が参照）。cap の参照先だけ切替。

## 範囲外（別担当）
フロント画面（ドライバーアプリ申請／営業所の日次編集・承認）／3か月一括（§12.2.2）／配車本体#25・cap式#27・割当優先#28・認証書込骨格v1.1／地図等の外部API。

## 検証（Claude Code）

```bash
node supabase/shift_mgmt_v0/pglite_test_ext_labels_cap.mjs   # 15/15（列拡張・labels移行・cap回帰・名指しraise）
node supabase/shift_mgmt_v0/pglite_test_definers.mjs         # 24/24（認可・期間/二重・遷移・headcount・範囲外0件＋1日1稼働UNIQUE/TOCTOU/再申請/NULL）
```
