# 荷主ポータル骨格 v0（ログイン＋状況確認＋CSVアップロード）

指示書 `shijisho/shijisho_shipper_portal_v0_2.docx` の成果物。要件定義 **7.2 荷主ポータル**。
荷主がログインし、**自社荷物の配送状況をRLSで自社分のみ確認**し、**CSVで自社荷物を登録**できる最小ポータル。
請求確認・KPIは範囲外（T2-P2）。

## 構成（要件の責務分離）— ★service_role を使わない設計

| 層 | 役割 | 鍵 |
|---|---|---|
| SvelteKit フロント | ログイン・状況確認（読み取り）・CSVアップロードUI（列マッピング） | **anonキーのみ**＋RLS委譲 |
| 状況確認 | `deliveries`/`shippers` を Supabase直で取得。`shipper_id` で明示フィルタせず **RLS(deliveries_shipper / shippers_shipper)** が自社のみに絞る | anon＋RLS |
| 取込 `POST /api/v1/imports`（SvelteKitサーバendpoint） | CSV行を検証・重複排除し、**ログイン荷主自身のJWT**で DB関数を呼ぶだけ | anon＋ユーザーJWT |
| 取込の書込み（DB） | **SECURITY DEFINER 関数 `shipper_import_deliveries`**。関数内で `shipper_id := my_shipper()` に固定して `deliveries` へ重複排除取込（import_v0準拠） | 関数（owner）。鍵は持たない |

- **service_role キーをアプリに置かない**（持たない）。状況確認も取込も anonキー＋ログイン荷主の JWT で動く。
- 書込みは DB の SECURITY DEFINER 関数だけが行い、`shipper_id` を `my_shipper()` に固定＝**自社の荷物しか登録できない**（CSVの荷主列は無視）。
- `deliveries` の RLS は **SELECT 専用のまま**（INSERTポリシー＝書込みRLSは足さない）。ユーザーの直接 INSERT は今までどおり拒否＝書けるのはこの関数経由のみ。
- 別Cloud Runサービスは作らず、ポータル内endpointで実装（将来 Cloud Run へ移設可）。**「API連携取込」（荷主システム直結）は将来＝範囲外**。

## 画面

- `/login` … パスワード／マジックリンク（Supabase Auth メール認証）。
- `/`（状況確認）… 自社荷物の一覧＋ステータス（問合番号・住所・氏名・配達予定・時間・状態）＋荷主名称。読み取り専用。
- `/upload`（CSVアップロード）… ファイル選択→**列マッピング**→プレビュー→取込実行→結果（取込/重複除外/エラー件数）。
- `/incomplete` … ログイン済みだが role≠shipper（本部発行待ち）。

## 前提

- **荷主マスタ v0（`supabase/shippers_master_v0/`）を実機実行済み**（`shippers` 作成＋seed＋取込で `recipient_name` 列付与＋名称→`shipper_id`解決）。
  - 状況確認の荷主名称表示と、取込関数の `recipient_name` 列はこれに依存。
- RLS v0.2（`supabase/rls_v0/`）実行済み（`my_role`/`my_shipper`、`shipper` RLS＝自社のみ）。
- **【人】** `supabase/shipper_import_rpc_v0.sql` を SQL Editor で実行（取込関数 `shipper_import_deliveries` を作成）。
- Supabase Auth でメール認証（パスワード／マジックリンク）が有効。

## セットアップ（検証）

```powershell
cd apps/shipper_portal_v0
Copy-Item .env.example .env   # 値を実プロジェクトのものに（PUBLIC_ の2つだけ。service_roleは不要）
npm install
npm run dev
```

1. （前提SQL）`supabase/shipper_import_rpc_v0.sql` を SQL Editor で実行（取込関数を作成）。
2. テスト用メールで一度ログイン（profiles に role=NULL の行ができる）。
3. **【人】** `supabase/promote_test_shipper_v0.sql` のメールを自分のテスト用に変えて SQL Editor で実行（role=shipper / shipper_id=SHIP01 を付与＋検証用荷物 seed）。
4. アプリ再読込 → 状況確認に自社荷物が出る。
5. `/upload` で CSV をアップロード→列マッピング→取込実行→結果確認。

## 合格条件（→ `確認結果メモ.md`）

- テスト荷主で Supabase Auth ログインでき、role=shipper の自社スコープになる。
- 状況確認に自社荷物＋ステータスが出る。**他社の荷物は0件（RLS）**。
- CSVアップロード→列マッピング→取込APIで自社荷物として登録（問合番号で重複排除・未配車・`shipper_id`付与）。
- アップロード結果（取込／重複除外／エラー件数）が画面に返る。
- **他社荷主では自社分しか見えない・登録できない**（`shipper_id`スコープ）。
- service／APIキーがフロントに露出しない。エンドポイントが API契約 v0 準拠（`/api/v1/imports`・統一エラー）。

## やらないこと（範囲外）

- 請求確認・KPI（T2-P2）／将来のAPI連携取込（荷主システム直結）。
- 荷主の自己登録＋本部承認の完全フロー・本部側の荷主アカウント管理UI。
- 配送状況の書き込み・再配達受付（7.1）・荷主による荷物の修正/削除。
- 本番データ・現行GAS・Claude/serviceキーのフロント配置。

## 事前検証（このリポジトリで実施済み）

| 検証 | 結果 |
|---|---|
| `npm run check`（svelte-check） | 0 errors |
| `npm run build` | 成功 |
| `importCore`（取込前処理 純関数）単体テスト | 13/13 PASS（検証・CSV内重複排除・日付パース・shipper_id非保持） |
| pglite：取込関数 `shipper_import_deliveries` | 11/11 PASS |

pglite で実証した取込関数の性質：
- **shipper_id は `my_shipper()` に固定**＝JSONで他社IDを詐称しても自社で入る（詐称無効）。
- 再取込は **重複排除**（inserted=0）。別荷主は自社IDで入る。
- **非荷主(hq)は取込拒否**（42501）。
- **ユーザーの直接 INSERT は拒否**（INSERT権限を付与してもRLSで弾かれる）＝書けるのは関数経由のみ。
- RLS：荷主は自社の荷物のみ可視・他社は範囲外0件。
- **service_role キーはアプリに無い**（持たない設計）。
