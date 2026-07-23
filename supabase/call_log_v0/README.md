# 通話・対応ログ＋折り返しリスト v0

要件定義 **§9.2「通話・対応ログ」エンティティ**／設計原理§0「例外はすべて『折り返しリスト』に落ちる」。
AI電話計画（指示書❷）。電話番号申請・会話エンジン(❸)・音声接続(❹)とは無関係に着手可能。
列定義は正本 `docs/shijisho_drafts/shijisho_call_log_v0_1_draft.md`（承認済み）に整合。

## 何を作るか

- `call_logs`：AI電話の1通話＝1行を記録する表。
- 記録口 `record_call_log`（SECURITY DEFINER・authenticated＋anon）：会話エンジンが通話終了時に呼ぶ。`call_sid` で冪等。
- 処理口 `resolve_callback`（SECURITY DEFINER・authenticatedのみ）：CS（hq/depot/area）が折り返し**完了・不要**を記録（`p_status='完了'|'不要'`）。
- ビュー `callback_queue`（security_invoker=on）：`callback_status='待ち'` を優先度→古い順に並べる＝折り返しリストの元。

## セキュリティ修正（レビュー2本対応・v0.2）

- **入力ハードニング（`call_logs` 列長CHECK制約）**：`record_call_log` は anon 実行可のため、長さ・値域チェックが無いと巨大 `transcript`/`summary` の無制限INSERT＋`priority`巨大値＋`outcome='折り返し要'`（→`callback_status='待ち'`自動）で `callback_queue`（`order by priority desc`）を偽の最優先で埋める「キューポイズニング」＋テーブル肥大が成立した。`char_length`ベースの列長CHECKと`priority between 0 and 9`を追加（列一覧は下記）。
- **`record_call_log` の `priority` clamp**：関数内で `p_priority := least(greatest(coalesce(p_priority,0),0),9)`。列のCHECKと二重防御。
- **`resolve_callback` の二重解決レース修正**：旧実装は `select ... into` で読んでから無条件UPDATEするcheck-then-actで、同一`call_id`への同時呼び出し2本が両方通過し後勝ちで上書きされ得た。`update ... where id=p_call_id and callback_status='待ち'` の条件付きUPDATE＋`GET DIAGNOSTICS`で1本のみ成功するように修正。
- **`resolve_callback` に「不要」を追加**：引数 `p_status text default '完了'`（`'完了'|'不要'`以外は例外）。上記の条件付きUPDATE（`callback_status='待ち'`のみ対象）により、既に`完了`/`不要`の行への誤上書きも同時に防止。
- **`record_call_log` の anon実行口について（運用ゲート・必須）**：この関数はインターネットに直接晒さず、**Twilio署名検証＋レート制限を行うCloud Run会話サーバ経由に限定する**。列長CHECK・priority clampは「壊れた/悪意ある入力の被害を抑える」対策であり、無制限リクエスト自体は防げない。これは指示書❹（音声接続）で anon 口を公開する前の必須ゲート。

## ファイル（コピペ実行）

| ファイル | 役割 |
| --- | --- |
| `call_log_v0.sql` | `call_logs` 表＋`record_call_log`／`resolve_callback`＋`callback_queue`ビュー＋GRANT＋RLS |
| `seed_call_log_v0.sql` | ダミー通話7件（`record_call_log`経由・`call_sid`一意制約で冪等・9000帯tracking_numberを使用） |
| `check_call_log_v0.sql` | 確認（件数分布／冪等／queue並び／resolve_callback／RLSなりすまし5ロール＋anon） |
| `pglite_test.mjs` | E2E検証（55/55 PASS） |

## 列（正本準拠）

- 通話識別: `id`／`call_sid`（一意・冪等キー）／`channel`（`ai_phone`/`phone`・default `ai_phone`）／`started_at`／`ended_at`／`duration_sec`
- 相手: `caller_phone`（**PII**）
- 内容: `tracking_number`（FKなし）／`band_key`／`intent`（用件分類・自由文字列）／`summary`（AI要約）／`transcript`（**PII**）／`recording_url`（**PII**）
- 結果: `outcome`（AI完結/転送済/折り返し要/中断/いたずら・default AI完結）／`receipt_no`／`priority`
- 折り返し: `callback_status`（待ち/完了/不要・default 不要）／`callback_by`（uuid）／`callback_at`／`callback_note`
- 記録メタ: `created_at`／`created_by`

## 実行順（実機・SQL Editor）

1. `call_log_v0.sql`
2. `seed_call_log_v0.sql`
3. `check_call_log_v0.sql`（④のなりすましブロックは `rls_v0/seed_accounts_v0.sql` のロール別UUIDと同じ値を使用。未投入環境では0件表示になるため、先に `rls_v0` 一式を投入しておくこと）

## 設計判断

### RLSは「役割ベース」＝deliveriesのRLS継承ではない

status_log_v0 の `delivery_status_log` は「その荷物が見えるならログも見える」で **deliveries のRLSを継承**したが、
`call_logs` は着信時点でどの荷物・どの営業所に属するかが未確定（`tracking_number` は判明時のみ・FK無し）。
そのため deliveries 継承は使えず、**「配達センター（CS業務）は全通話を横断で見る」という業務要件をそのまま
`my_role() in ('hq','depot','area')` の役割ベースポリシー**にした（本指示書の承認事項）。営業所単位の絞り込みは行わない＝
hq/depot/area は同じ可視件数（全件）になる。driver・shipper・anon は該当ロールが無いため 0 件（default-deny）。

### 書き込みは記録口2関数に一本化

`call_logs` に INSERT/UPDATE/DELETE のRLSポリシーは置かない。書き込みは：
- `record_call_log`：新規記録のみ（`call_sid` で冪等・`on conflict do nothing`）。authenticated と anon の両方から呼べる
  （会話エンジンは通話ごとに未認証セッションで動く想定のため）。
- `resolve_callback(p_call_id bigint, p_note text default null, p_status text default '完了')`：既存行の折り返し状態の更新のみ。
  CS（hq/depot/area）に限定・`auth.uid()` 必須（anon拒否）。`p_status` は `'完了'|'不要'` のみ許可（それ以外は例外）。
  対象が無ければ `P0002`。UPDATEは `where id=p_call_id and callback_status='待ち'` の条件付きで実行し、
  対象外（既に`完了`/`不要`・存在しない`待ち`状態）なら更新0件＝冪等に`already`を返す（二重解決・誤上書きの防止）。

どちらも SECURITY DEFINER。GRANT は record_call_log→`authenticated, anon`／resolve_callback→`authenticated`のみで、
「実行権そのものの剥奪」と「関数内 `auth.uid()`/`my_role()` チェック」の二重防御にしている。

### 列長CHECK制約（v0.2追加）

| 列 | 上限（`char_length`） | 備考 |
| --- | --- | --- |
| `transcript` | 20000 | 全文文字起こし・PII |
| `summary` | 4000 | AI要約 |
| `caller_phone` | 32 | 発信者番号・PII |
| `callback_note` | 2000 | 折り返しメモ |
| `recording_url` | 2048 | 録音URL・PII（一般的なURL長の上限目安） |
| `band_key` | 64 | 番号帯 |
| `intent` | 64 | 用件分類（自由文字列だが短い値を想定） |
| `receipt_no` | 64 | 受付番号 |
| `tracking_number` | 64 | 問合番号（FKなしのゆるい参照。実値は12桁／`DSP-`量産系も収まる） |
| `call_sid` | 128 | 実値（Twilio CallSid等）に合わせて緩め |
| `priority`（値域） | 0〜9 | `record_call_log`内のclampと二重防御 |

既存seed7件（`seed_call_log_v0.sql`）はいずれも上限を大きく下回ることを確認済み。

### `callback_queue` は `security_invoker=on`

呼び出し元の `call_logs` RLSがそのまま効くため、hq/depot/areaは待ち行列が見え、driver/shipperは0件（`call_logs`が0件なので自動的に0件）。

### PII

`caller_phone`（発信者番号）・`transcript`（全文文字起こし）・`recording_url`（録音URL・メタのみで音声本体はTwilio側管理／保持期間未決＝範囲外）の3列はPII。表・列にCOMMENTで明示。

### `intent`（用件分類）は列挙値checkなしの自由文字列（長さCHECKのみ）

再配達／状況照会／時間変更／置き配／クレーム／その他 等を想定するが、カテゴリ確定は運用の細かい仕様のため
`outcome`（AI完結／転送済／折り返し要／中断／いたずら）・`channel`（ai_phone／phone）・`callback_status`（待ち／完了／不要）のみ列挙値check制約を付け、
`intent`は自由記述にした（v0.2で`char_length<=64`の長さCHECKのみ追加・値の列挙制約はしない）。

## 用語（用語集v0.1・実値）

問合番号（tracking_number）／号（—）。結果: AI完結・転送済・折り返し要・中断・いたずら。折り返し状態: 待ち・完了・不要。

## 実機手順（LOL承認後・本タスクの範囲外）

1. Supabase SQL Editor で `call_log_v0.sql` → `seed_call_log_v0.sql` → `check_call_log_v0.sql` の順に実行。
2. `check_call_log_v0.sql` ④の各ブロックで judge列が全て `OK` になることを確認。anonブロックはエラー（`permission denied for table call_logs`）になれば合格。
3. 結果を `確認結果メモ.md` に記録。
