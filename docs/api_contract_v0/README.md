# API契約 v0

指示書 `shijisho/shijisho_api_contract_v0_1.docx` の成果物。
**文書のみ（実装なし）**。Cloud Run(Hono+TS)層のAPI契約 v0。要件定義 第4章・11.4 に対応。

## 成果物

| ファイル | 内容 |
|---------|------|
| `api_contract_v0.md` / `.docx` | 命名規則＋主要エンドポイント＋日本語↔英語キー対応表（本体） |
| `endpoints_v0.md` / `.docx` | エンドポイント一覧表（メソッド・パス・用途・対象ロール） |

## 位置づけ

- 行の可視範囲は **DBのRLSに委譲**（`supabase/rls_v0/`）。APIは認証検証＋業務処理に専念。
- 英語キーは `supabase/dbschema_v0` / `rls_v0` のDB列名と一致。
- T1コアの主要分が対象。T2/T3は名称予約のみ（別指示書）。

## 確定フロー

LOL（設計まとめ役）が承認したら「API契約 v0」として確定。以降のCloud Run実装はこれに従う。
（md と docx は同内容。レビューしやすい方を使用）
