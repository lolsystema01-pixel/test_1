# API契約 v0（命名規則・主要エンドポイント）

対象：Cloud Run（Hono＋TypeScript）層のAPI契約 v0（**文書のみ・実装はしない**）
対応：要件定義 第4章（4.1 階層と責務／4.2 技術スタックと層構成／4.5 階層間のデータフロー）／11.4 保守性（部品化・LEGO方式）
状態：☐ 承認待ち ☐ 承認済み ☒ 確定（LOL＝設計まとめ役の承認で「API契約 v0」確定）

---

## 0. 前提と責務分離

- 層構成（4.2）：フロント＝**SvelteKit** ／ データ・認証・RLS＝**Supabase(PostgreSQL)** ／ 業務ロジック・帳票・外部連携＝**Cloud Run(Hono+TS)**。
- **行の可視範囲はDBのRLSに委譲し、API層で再実装しない**（4.1・11.4）。APIは「**認証検証＋業務処理**」に専念する。
- API → Supabase アクセスは、原則**呼び出しユーザーのJWTを引き継いで**行い、RLSを効かせる。RLSを跨ぐ管理処理のみ `service_role`（環境変数管理）を限定使用。
- LEGO方式：各エンドポイントは入出力が明確な部品。設計まとめ役がこの契約（DB/API）を統制し、組み立て担当が結合する。

---

## 1. 命名規則

### 1.1 ベースパス・版
- ベースパス：`/api/v1`。
- **後方互換**：破壊的変更はメジャー版を上げ新パス（`/api/v2`）で並行提供し、旧版は猶予期間維持。**フィールドの追加は後方互換**（既存キーは不変、追加のみ）とみなす。

### 1.2 リソース名・パス設計
- 英語・**複数形**・**kebab-case**（例：`/deliveries`、`/work-schedules`、`/national-allocation`）。
- ネストは浅く保つ。可視範囲はRLSで解くため、`/offices/{id}/deliveries` のような帰属ネストは作らず `/deliveries?office_code=` で表現。
- **実行系（バッチ処理）はRPC動詞を避け、「実行＝runリソースの作成」**で表す：
  - `POST /national-allocation/runs`（全国配分を実行）／`GET /national-allocation/runs/{run_id}`（結果参照）。
  - dry-run / 本実行は body の `mode: "dry_run" | "commit"` で切替（要件の「お試し→本実行」二段階）。

### 1.3 メソッドとステータス
| メソッド | 用途 |
|---------|------|
| GET | 取得（副作用なし） |
| POST | 作成・実行（runの作成を含む） |
| PATCH | 部分更新 |
| DELETE | 削除 |

- PUT（全置換）は使わず PATCH に統一する。
- 成功：`200`（取得/更新）／`201`（作成）／`202`（非同期実行を受付）／`204`（削除・本文なし）。
- エラー：`400`（構文/バリデーション）／`401`（未認証）／`403`（アクセス禁止）／`404`（無し）／`409`（競合：問合番号重複等）／`422`（意味的バリデーション）／`429`（レート）／`500`（サーバ）。
  - ※RLSで「見えない」結果は**0件（空配列）**で返り、403ではない（行の不可視と権限エラーは区別する）。

### 1.4 フィールド命名
- **英語 snake_case** を既定。日本語業務用語との対応は「§3 対応表」に従い、表外の独自命名を作らない（命名の一貫性）。

### 1.5 統一エラー形式
```json
{
  "error": {
    "code": "DUPLICATE_TRACKING_NUMBER",
    "message": "問合番号が重複しています。",
    "details": [{ "field": "tracking_number", "value": "Q0000001" }]
  }
}
```
- `code`：機械可読の固定文字列（例：`VALIDATION_ERROR` / `DUPLICATE_TRACKING_NUMBER` / `UNREGISTERED_ADDRESS` / `FORBIDDEN` / `NOT_FOUND` / `CONFLICT`）。
- `message`：人間可読（日本語可）。`details`：任意の補足配列。

### 1.6 認証
- `Authorization: Bearer <Supabase JWT>`。
- API（Cloud Run）は **JWTの署名・`exp`・`aud` を検証**し、`role`・帰属（`office_code`/`depot_code`/`driver_id`/`shipper_id`）を取り出すのみ。**行の可視範囲はRLSに委譲**（APIで再フィルタしない）。
- Supabaseアクセスはユーザー JWT を引き継ぐ。`service_role` はRLSを跨ぐ管理処理（全国配分の一括付与等）に限定。

### 1.7 一覧（list）の共通規約
- **ページング**：`?limit=`（既定 50・最大 200）＋ `?cursor=`（カーソル方式を既定）。レスポンス：
  ```json
  { "data": [ ... ], "page": { "next_cursor": "…", "has_more": true } }
  ```
- **フィルタ**：`?field=value`（snake_case）。範囲は `?date_from=&date_to=`。
- **ソート**：`?sort=field`（昇順）／`?sort=-field`（降順）。複数は `?sort=-delivery_date,delivery_order`。

---

## 2. 主要エンドポイント（v0・4.5のデータフロー順）

詳細表は別紙 `endpoints_v0.md` を正とする。本章は要点。

### 2.1 取込
- `POST /api/v1/imports` … 荷主取込（CSV、将来API）。問合番号で重複排除し `import_batch_id` を発行。取込直後の `status` は「未配車」。**対象ロール：本部 / 荷主（自社分）**。

### 2.2 全国配分（本部）
- `POST /api/v1/national-allocation/runs` … 住所→`common_id`・`depot_code`・`office_code`・かご等の付与を実行（`mode: dry_run|commit`）。判定不能は未登録住所へ。**対象：本部**。
- `GET /api/v1/national-allocation/runs/{run_id}` … 実行結果サマリ参照。**対象：本部**。
- `GET /api/v1/unregistered-addresses` … 未登録住所一覧（修正フロー）。**対象：本部 / 営業所**。

### 2.3 配車（営業所）
- `POST /api/v1/dispatch/runs` … ドライバー予測の実行（`date`・`office_code`・`mode`・`priority`）。結果に仮ドライバー必要数を含む。**対象：営業所**。
- `GET /api/v1/dispatch/runs/{run_id}` … 配車結果参照。**対象：営業所**。

### 2.4 仕分け（営業所）
- `GET /api/v1/sorting/today` … 仕分けナビ用、当日分の問合Indexを一括照会（`date`・`office_code`）。**対象：営業所**。

### 2.5 出力
- `POST /api/v1/labels` … ラベル印刷データ生成（Brother TD-2350／b-PAC、PDFフォールバック）。**対象：営業所**。
- `POST /api/v1/reports` … 帳票生成（`type`：配車表PDF / GoDoor用CSV / かご持出表PDF）。**対象：営業所 / 本部**。

### 2.6 参照系
- `GET /api/v1/deliveries`、`GET /api/v1/deliveries/{tracking_number}` … 配送データ（可視範囲はRLS）。
- `GET /api/v1/delivery-index` … 問合Index照会。
- `GET /api/v1/masters/address-master`、`/masters/zone-plan`、`/masters/offices` … マスタ参照。
- `GET /api/v1/drivers` … ドライバー（可視範囲はRLS）。
- `GET /api/v1/work-schedules` … 稼働予定（可視範囲はRLS）。※申請/承認（`POST`/`PATCH`）は項目名のみ予約。

### 2.7 配布の扱い（方針として明記）
- **配布は独立エンドポイントを設けない。** 現行の「ファイル間コピー」は、本基盤では**全国配分 run 実行時の帰属付与（`depot_code`/`office_code`）＋RLSによる可視範囲制御**で表現する（4.5）。よって `/distribution` は v0 では作らない。

### 2.8 予約（今回は名称のみ。詳細は別指示書）
- T2 CS：`/redelivery-requests`、`/shipper-portal`、`/support-tickets`、`/inquiries`。
- T3 ドライバーアプリ：`/driver/deliveries`、`/driver/attendance`（点呼・アルコール）、`/driver/gps`、`/driver/reports`。

---

## 3. 日本語業務用語 ↔ 英語APIキー 対応表

`schema_v0` / `rls_v0` のDB列名と一致させる（命名の一貫性）。

| 日本語業務用語 | 英語APIキー | 備考 |
|---------------|------------|------|
| 配送データ（荷物） | delivery（複数形 deliveries） | |
| 問合番号 | tracking_number | 荷物の主キー |
| 共通ID | common_id | 住所→ゾーン中核キー |
| ゾーン | zone / zone_no | ZonePlan |
| TownKey | town_key | マスタ重複検査 |
| かご記号 | basket_code | バッグ番号・親バッグは廃止 |
| 配達順 | delivery_order | |
| 拠点コード | depot_code | |
| 営業所コード | office_code | |
| ドライバーID | driver_id | |
| 荷主ID | shipper_id | |
| 取込バッチID | import_batch_id | 重複排除 |
| ステータス | status | 未配車→配車済→仕分済→配送中→完了/不在 |
| 時間指定 | time_window | |
| 問合Index | delivery_index | 高速参照 |
| 未登録住所 | unregistered_address | |
| 稼働予定 | work_schedule（work-schedules） | |
| 稼働区分 | work_type | フル/2時間/6時間 等 |
| 申請状態 | application_status | 申請中/承認/却下 |
| 配車優先方式 | dispatch_priority | 処理能力優先（既定）/最低保証優先 |
| かご振り順 | basket_order | ドライバー順/配達順順/ゾーン順 |
| スキル（1時間あたり配達個数） | skill_per_hour | |
| 全国Master | address_master | 版管理 |
| 全国ZonePlan | zone_plan | 版管理 |
| 仮ドライバー | provisional_driver | 仮1, 仮2… |
| 全国配分 | national_allocation | 本部の中核処理 |
| 配車（ドライバー予測） | dispatch | |
| 仕分け（仕分けナビ） | sorting | |

---

## 4. 合格条件チェック（自己確認）

- [x] 命名規則が一通り揃っている（パス・メソッド・フィールド・エラー・認証・一覧規約）。
- [x] 主要エンドポイントが4.5フロー（取込→全国配分→配車→仕分け→出力）＋参照系を網羅し、各々にメソッド/パス/用途/対象ロールがある。
- [x] 用語が要件定義／用語集v0.1どおりで、日本語↔英語キーの対応が取れている。
- [x] 同概念の命名重複なし（DB列名と一致）。
- [x] RLSとの責務分離を明記（APIは認証検証、行可視範囲はDB）。

## 5. やらないこと（範囲外・確認）

- 実装コード（Honoのルーティング実体・ハンドラ）。今回は契約のみ。
- T2/T3固有エンドポイントの詳細（名称予約のみ）。
- RLSロジックのAPI再実装。
- OpenAPI完全網羅・全フィールド厳密スキーマ（v0は骨格）。
- 認証基盤の実構築・UI・本番/現行GASアクセス。
