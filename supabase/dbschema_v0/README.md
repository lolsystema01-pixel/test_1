# DBスキーマ v0（骨格）

指示書 `shijisho/shijisho_dbschema_v0_2.docx` の成果物。
要件定義 **第9章 データ要件** に対応する5グループの骨格テーブル。
**RLSは含めない**（前提Aの「全テーブルRLS」方針は維持。設定は別指示書）。

## 成果物

| ファイル | 役割 |
|---------|------|
| `create_schema_v0.sql` | 8テーブルの定義＋参照(FK) |
| `seed_dummy_v0.sql` | 少量のダミーデータ |
| `check_v0.sql` | テーブル作成・参照成立・用語の確認 |
| `確認結果メモ.md` | 実行結果の記録用 |

## 実行順（SQL Editorで上から）

1. `create_schema_v0.sql` を Run
2. `seed_dummy_v0.sql` を Run
3. `check_v0.sql` を Run（A:テーブル8件 / B:FK4件 / C:JOIN件数 / D:廃止語0件 を確認）

エラーが出たら、その内容を Claude に渡して直して貼り直す。

## テーブル一覧と参照

```
depots(拠点) ──< offices(営業所) ──< drivers(ドライバー) ──< work_schedules(稼働予定)
                      ^                    
                      └──< deliveries(荷物) ──< delivery_index(問合Index)
zone_plan(ゾーン) ──< address_master(住所)
```

required FK（合格条件）:
- deliveries.office_code → offices.office_code
- drivers.office_code → offices.office_code
- work_schedules.driver_id → drivers.driver_id
- delivery_index.tracking_number → deliveries.tracking_number

## 設計メモ（割り切り）

- 識別子は英語 snake_case。用語集v0.1の語は各テーブル/列の COMMENT に日本語で併記。
- **バッグ番号・親バッグは作らない**（かご記号に一本化）。
- **荷主ID・取込バッチID は列のみ**でFKを張らない（対応マスタ未作成。後続指示書で接続）。
- deliveries.driver_id もFKなし（drivers より先に作成するため。合格条件の対象外）。
- 全国Master/ZonePlan の版管理ロジックは範囲外（骨格のみ）。
- 配達実績ログ・未登録住所・荷主・再配達受付・通話/対応ログ・サポートチケット・募集/応援は別指示書。
```
