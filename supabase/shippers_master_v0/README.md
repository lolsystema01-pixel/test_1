# 荷主マスタ v0.2（table化・直接seed・取込でのshipper_id解決）

指示書 `shijisho/shijisho_shippers_master_v0_2.docx` の成果物。
荷主（`shippers`）を作り、直接seedで登録し、取込で `staging.shipper`（名称）→ `shipper_id` を解決して
`deliveries.shipper_id` に入れる。**本質＝取込経路に「名称→shipper_idコード変換」を組み込み、再取込で名前が混入しないようにする。**
要件定義 9.2（荷主：荷主ID・名称）／6.1（取込：荷主名→shipper_id 解決）／7.2（荷主ポータルの土台 `shipper_id=my_shipper()`）。

## 確定事項（指示書 前提・要確認＋正準規格 v1）

- `shipper_id` は **text**（`deliveries.shipper_id` / `profiles.shipper_id` と同流儀。`depot_code`/`office_code` と同じ。**uuidは使わない**）。
- 荷主マスタは **2社**（`docs/dummy_data_standard_v1.md` §4）：
  - `SHIP01` = **HACHI EXPRESS**（取込ダミーの実体。突合は『HACHI EXPRESS → SHIP01』の1対応）。
  - `SHIP02` = **ニコイチ運輸**（RLS分離デモ用の2社目。各 seed が参照する SHIP02 の FK もこれで成立）。
  - 旧 `SHIP03` は廃止（SHIP01/SHIP02 に寄せた）。
- `import_v0.sql §4` は名称をそのまま `shipper_id` に入れていた → **本モジュールが恒久対応の置き換え版**。

## 成果物

| ファイル | 役割 |
|---------|------|
| `shippers_v0.sql` | `shippers` テーブル作成＋直接seed（SHIP01/HACHI EXPRESS）＋RLS＋**ガード付きFK**（未解決0件のときだけ張る・冪等） |
| `import_shipper_map_v0.sql` | **`import_v0` の置き換え版**。取込で名称→shipper_idコード変換（未一致は保留）＋既存 `deliveries` の名称→SHIP01 backfill |
| `check_shippers_v0.sql` | seed・取込マッピング・未一致件数・backfill・FK・RLS の確認 |
| `確認結果メモ.md` | 期待/実の記録（pglite事前検証の結果を含む） |

## 実行順（Supabase SQL Editor にコピペ）

1. （前提）`dbschema_v0/` ＋ `rls_v0/`（profiles・`my_shipper()`）実行済み。
2. `shippers_v0.sql` … create+seed+RLS。
   - この時点で `deliveries` に名称（HACHI EXPRESS）が残っていれば **FKは自動スキップ**し NOTICE を出す（正常）。
3. `import_shipper_map_v0.sql` … **1回目**（取込16件＋既存名称→SHIP01 backfill）。
   - 末尾 counts 行の `unresolved_shipper` が **0** であること（HACHI EXPRESS は登録済）。
4. `import_shipper_map_v0.sql` … **2回目**（任意・冪等確認。取込0件・名称混入なし）。
5. `shippers_v0.sql` … **再Run**。未解決0件になっているので **FKが張られる**（NOTICE「FK…を作成しました」）。
6. `check_shippers_v0.sql` … 確認（begin〜rollback ブロックは選択して個別実行）。

> `shippers_v0.sql` は create=`if not exists` / seed=upsert / RLS=drop→create / FK=ガード付きなので**何度でも再実行可**。

## 期待結果（合格条件）

| 観点 | 期待 | check |
|------|------|------|
| text PK で seed | `SHIP01/HACHI EXPRESS`・`SHIP02/ニコイチ運輸` の2行 | ① |
| 名称→コード変換／名前は入らない | `shipper_id='HACHI EXPRESS'` の行 = **0** | ② |
| 未一致は保留・件数で分かる | 未一致荷主名 0行・保留deliveries **0** | ③ |
| 名称→SHIP01 backfill／混在解消 | 名称のまま残存 = **0** | ④ |
| FK成立（未解決0件） | FK存在=1 ＆ 未解決 = **0** | ⑤ |
| `shippers` RLS有効 | true | ⑥ |
| hq=全 / 荷主=自社のみ（範囲外0件） | hq=2 / 自社=1・他社SHIP02=**0** | ⑦⑧ |
| driver は読めない | 0 | ⑨ |

## RLS 方針

- `hq` = 全行 / `shipper` = 自社行（`shipper_id = my_shipper()`） / `area`・`depot` = 全行（荷主名表示用・非機微の名称マスタ）。
- `driver` ロールのポリシーは置かない（＝driver は `shippers` を読めない。`offices` と同じ流儀）。

## 未一致（マスタに無い荷主名）の運用

- 取込時、`shippers` に無い荷主名は **コード化せず保留**（`deliveries.shipper_id` を NULL のまま＝名前を素通りさせない）。
- `import_shipper_map_v0.sql` 末尾 `unresolved_shipper` と `check ③` で**件数可視化**。
- 人手で `shippers` に荷主を追加 → `import_shipper_map_v0.sql` を再Run すると、保留(NULL)行も §6 で事後解決される。

## 注意（環境メモ）

- 正準規格 v1 で `SHIP01`/`SHIP02` を**両方マスタ登録**したため、各 seed（`rls_v0` 等）が参照する `SHIP02` も FK 成立する。旧 `SHIP03` は廃止済み。
  マスタに無いコードが `deliveries` に残っている場合のみ `shippers_v0.sql` の FK がスキップされ NOTICE で件数提示する（仕様どおり＝未解決0件にしてから張る）。
- Supabase SQL Editor は psql ではない → `\set` 等メタコマンド不使用。値は直接埋め込み済み。

## 事前検証（pglite）

実スキーマ（`dbschema_v0`）→ RLS（`rls_v0`）→ 旧取込（`csv_import_v0`＝名称混入）を再現し、本モジュールを流して
E2E で 16 項目すべて PASS（`auth.uid()` スタブ＋`authenticated` ロールで RLS を実効検証）。詳細は `確認結果メモ.md`。
