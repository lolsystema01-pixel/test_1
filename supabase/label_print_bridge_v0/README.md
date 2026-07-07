# ラベル印刷ブリッジ v0.4（内製分）

要件定義 **6.8 ラベル印刷**の内製分。ラベルペイロード生成・ラベルPDF・印刷ON/OFF＋送信フック・印刷履歴/再印刷・バーコード枠。
**印刷ブリッジ本体（b-PAC→Brother TD-2350）と `.lbx` はスポット外注**（孤立部品）＝本書では作らない（[外注仕様](../../docs/label_print_bridge_v0/outsource_spec_v0.md)）。

## ラベル内容（確定・数字のみ）

- 大＝**かご記号＋配達順**（例「西-5 1」／本DBは「A 1」「M01 2」）
- 小＝**問合番号**（数字のみ）／高さ約30mm／**住所・氏名は載せない**
- バーコードは**既定OFF**（枠のみ・将来用）。照合/仕分けスキャンは**配送伝票**のバーコードを読む（§8.5）。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `label_payload_v0.sql` | ビュー `label_payload`（機種非依存ペイロード・area RLS）＋ `print_history` 表 ＋ `record_prints(jsonb)` 関数 |
| `check_label_print_v0.sql` | 確認（ペイロード・PII非混入・area RLS・履歴/再印刷） |
| `pglite_test.mjs` | E2E検証（17/17 PASS） |
| `apps/sort_nav_v0/src/lib/label.ts` | ラベル内容の純関数（単体18/18） |
| `apps/sort_nav_v0/src/routes/label/` | `/label` 画面（PDF・ON/OFF送信フック・履歴/再印刷・バーコード枠） |
| `docs/label_print_bridge_v0/adapter_contract_v0.md` | 印刷ブリッジ **アダプタ契約**（境界仕様） |
| `docs/label_print_bridge_v0/outsource_spec_v0.md` | 印刷ブリッジ本体＋.lbx **外注仕様書** |

## セキュリティ／設計

- ペイロードは**機種非依存**（かご記号・配達順・問合番号のみ）。b-PAC/Brother はブリッジ側に隔離＝**機種抽象化**（11.4）。
- `label_payload` は **security_invoker ビュー**で area RLS継承（自営業所のみ）。
- 履歴の書込みは **SECURITY DEFINER 関数 `record_prints`** 経由（printed_by=auth.uid()・area は my_office() 固定）＝**service_role不要・書込みRLSポリシー不要**。
- PDF・送信フックは**クライアント側**（anon＋areaのJWT）。ブリッジ未接続でも PDF/履歴で運用継続（フォールバック）。

## 実行順（実機）

1. （前提）配車 v0.5 ＋ 採番一式 v0.5（deliveries に driver_id・basket_code・delivery_order）
2. `label_payload_v0.sql` を SQL Editor で実行
3. `check_label_print_v0.sql`（UUIDを自分の area に置換）
4. `apps/sort_nav_v0` を `npm run dev` → area ログイン → 「ラベル印刷」→ 対象日選択
   - 「ラベルPDF生成」＝数字のみPDF（バーコード枠は設定ONで描画）
   - 印刷ON/OFFを切替 →「印刷ブリッジへ送信」＝ON時のみ送信フック発火＋履歴記録
   - 履歴の「再印刷」＝PDF再生成＋履歴(reprint)
