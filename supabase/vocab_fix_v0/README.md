# 語彙是正 → address_master 撤去 v0.1（②〜⑤）

指示書「エリアマスタ／共通ID語彙の是正 → address_master 撤去 v0.1」の **②③④⑤** の成果物。
**①（文字化け修正）は単独版として `area_master_mojibake_fix_v0/` で完了済み**（ブランチ `fix/area_master`）。
②③④は**実DBで適用・合格確認済み**。⑤は**成果物完成・実行待ち**（案a採用・業務A承認済み）。

工程ゲート（audit 再実行・1画面版）も `area_master_mojibake_fix_v0/recheck_vocab_gates_v0.sql` にある。
**各ステップの後に必ずゲートを再実行**し、期待どおり変わったことを確認してから次へ進む（指示書の指定）。

## ファイル

| ファイル | 工程 | 内容 |
|---|---|---|
| `zone_plan_new_vocab_v0.sql` | ② | area_master（有効行）→ zone_plan へ新語彙を**追加のみ**（旧行は残す・冪等） |
| `diagnose_unresolved_deliveries_v0.sql` | ②後診断 | ②後も解決できない deliveries の正体特定（SELECTのみ） |
| `purge_old_vocab_deliveries_v0.sql` | ③ | 旧DSPダミー804行を **FK順に削除**（破壊的・冪等） |
| `migrate_functions_to_area_master_v0.sql` | ④ | 3関数（zone_rank / dispatch_build / delivery_status_public）を area_master 参照へ書換（**可逆**） |
| `drop_address_master_v0.sql` | ⑤ | ガード → drop → **旧 zone_plan 行と宙ぶらりん隣接の掃除（案a）**（**不可逆**・冪等） |
| `pglite_test_zone_plan_new_vocab.mjs` | ② | 19/19 PASS |
| `pglite_test_unresolved.mjs` | ②診断 | 8/8 PASS |
| `pglite_test_purge.mjs` | ③ | 14/14 PASS |
| `pglite_test_migrate_functions.mjs` | ④ | 29/29 PASS |
| `pglite_test_drop.mjs` | ⑤ | 28/28 PASS（**時限爆弾の実在とガードによる回避**を実証） |

## 実行順（Supabase SQL Editor・手動コピペ）

1. ゲート再実行（現在値の記録）
2. `zone_plan_new_vocab_v0.sql`（②）→ §3 で `new_vocab_missing = 0`
3. （4件残る場合）`diagnose_unresolved_deliveries_v0.sql` で正体確認
4. `purge_old_vocab_deliveries_v0.sql`（③）→ §3 で `old_vocab_only = 0`・`rows_kept > 0`
5. ゲート再実行 → seq 6 = 0 ✅
6. `migrate_functions_to_area_master_v0.sql`（④）→ 末尾 §4 の6行が全 ✅
7. ④の実機確認（ファイル末尾 §5。**対象日は §5-0 のSQLで現物確認してから**）
8. ゲート再実行 → **seq 3 が「✅ ⑤drop可」**
9. `drop_address_master_v0.sql`（⑤・**不可逆**）→ 末尾 §5 の10行が全 ✅
10. ゲート再実行 → **seq 3・6・7・8 が全て ✅**（seq 9 は ⚠＝本物の複数自治体・想定内）
11. 実機確認（配車・受付UI/AI応答の照会が実行時エラーにならないこと）

## 指示書との差分（実測に基づく変更。指示書本文は無修正＝実装メモ方式）

| 工程 | 指示書 | 本実装 | 理由（実測） |
|---|---|---|---|
| ② | `distinct common_id, zone_no, depot` を upsert | **common_id ごとに `min(zone_no)` で畳む** | 1つの common_id が複数 zone_no を持つ（**1,015/1,653件**＝共通IDはゾーン範囲。例 ABK_C_29_32 = zone 29〜32）。そのままでは `ON CONFLICT DO UPDATE` が「cannot affect row a second time」で落ちる。min＝範囲のFrom は旧実装（`load_master_v0.sql:55` `zone_from as zone_no`）と同じ慣習。depot は common_id ごとに一意（ゲート seq 10 = 0 で実証） |
| ② | upsert | **`on conflict do nothing`（追加のみ）** | 新旧に共通する共通IDが1件あり（overlap=1）、`do update` するとその行の adjacent_zones（旧語彙の隣接定義）が NULL で潰れる。決定事項C「旧行は残す・隣接は別タスク」に従い既存行は不変。`do nothing` の「黙って捨てる」リスクは §0 ガード（投入元の一意性検査）で塞いだ |
| ③ | 「delivery_index は on delete cascade で自動削除」 | **delivery_index も明示削除** | **cascade は付いていない**（`create_schema_v0.sql:100-102`）。指示書どおりだと FK違反で落ちる（pglite テストAで実証）。deliveries を参照する FK 全数調査済み：status_log／index＝明示削除、unregistered_addresses＝cascade で自動、print_history＝FKでない |
| ④ | lookup を置換 | 指示書どおり＋**§0 ガード追加** | 旧語彙が residual のまま書き換えると静かな劣化になるため、実行のたびに ③完了（旧語彙0件）を機械検査 |
| ⑤ | 前提「§2〜§4 の語彙ゲート全合格」 | **§3 を前提から外し、掃除後の確認項目に格上げ**（案a） | §3（seq 7・8）は決定事項Cにより構造的に 0 にできず、前提のままでは永久に満たせない。下記参照 |
| ⑤ | drop のみ | **drop → 旧 zone_plan 行の掃除（§3）→ 宙ぶらりん隣接の掃除（§3-2）** | 案a。§3-2 は pglite で発見（新旧共通の1件が旧語彙の隣接を保持したまま残り seq 8 が緑にならない） |

## ⑤の前提の読み替え＝案a（業務A承認済み 2026-07-17）

⑤の前提「audit §2〜§4 の語彙ゲート全合格」のうち、**§3（ゲート seq 7・8）は決定事項Cにより構造的に満たせない**。
zone_plan の旧語彙行は「削除しない（追加のみ）」と決めたため。一方、旧行を消すには
`address_master → zone_plan` の FK が邪魔＝**⑤の後**でないと消せない（循環）。

- **案a（採用）**: ⑤で drop → **その後に旧行を掃除**（`drop_address_master_v0.sql` の §3・§3-2）。
  掃除後は seq 7・8 も 0 になる。⑤の前提からは §3 を外し、**掃除後の確認項目に格上げ**する。
  根拠: 決定事項Cの理由は「**drop 前に**消すと孤児になる」＝**時限つきの制約**であり、drop で失効する。
  案aはCの反故ではなく**Cの完了**。消す旧行は `load_master_v0.sql:30-41` のハードコード由来＝**再実行で完全復元可能**（情報の損失なし）。
- **案b（不採用）**: §3 を「deliveries が引く行が新語彙か」に読み替える案。それは seq 6（§2）と同値になり、
  監査が意図した「配車品質の劣化検知」という観点そのものが消える。加えて**赤いまま放置されたゲートは
  「無視してよい ✗」を常態化させ、本物の signal を殺す**（ゲートが無いより有害）。
- ③完了により**旧行は誰からも参照されない死んだ行**＝④の動作には影響しない（④を先行させた根拠）。

## 申し送り

- **共通IDは不透明キーとして扱う（パースしない）**: 命名に2系統が混在（`<県>_<英字>_<from>_<to>`＝範囲 ／ `KGW_01_02` 等＝単一ゾーン・`01` は From ではない）。文字列から範囲や zone を読むと香川・高知で静かに間違える。範囲情報は現状どこにも保持していない。
- **zone_plan.zone_no は現状どこからも読まれない**（zone_rank=adjacent_zones のみ／dispatch_build=split_threshold のみ／配達順=deliveries.zone_no）。②の min は「後で誰かが読んだとき」のための決定化。
- **新語彙同士の rank3（隣接）は発火しない**（adjacent_zones=NULL・決定事項C）。隣接の再構築は別タスク。
- ③で **dispatch_v0 等の検証ベースライン800件（06-17）は消えた**（過去の確認結果メモの件数は再現不可・業務A確認済み）。
- 大きいCSVの取込後は `area_master_mojibake_fix_v0/detect_mojibake_v0.sql` で U+FFFD 検査（①の再発防止・恒久対策は別タスク）。

## 検証（Claude Code）

```bash
node supabase/vocab_fix_v0/pglite_test_zone_plan_new_vocab.mjs   # 19/19
node supabase/vocab_fix_v0/pglite_test_unresolved.mjs            #  8/8
node supabase/vocab_fix_v0/pglite_test_purge.mjs                 # 14/14
node supabase/vocab_fix_v0/pglite_test_migrate_functions.mjs     # 29/29
node supabase/vocab_fix_v0/pglite_test_drop.mjs                   # 28/28
```

④のテストは**転記の正確性**（原本 prosrc＋想定置換 == 移行後 prosrc の文字単位一致）を含む＝宣言した変更以外していないことの機械証明。
