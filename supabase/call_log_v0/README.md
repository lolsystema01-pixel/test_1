# 通話・対応ログ＋折り返しリスト v0

要件定義 **§9.2「通話・対応ログ」エンティティ**／設計原理§0「例外はすべて『折り返しリスト』に落ちる」。
AI電話計画（指示書❷）。電話番号申請・会話エンジン(❸)・音声接続(❹)とは無関係に着手可能。
列定義は正本 `docs/shijisho_drafts/shijisho_call_log_v0_1_draft.md`（承認済み）に整合。

## 何を作るか

- `call_logs`：AI電話の1通話＝1行を記録する表。
- 記録口 `record_call_log`（SECURITY DEFINER・authenticated＋anon）：会話エンジンが通話終了時に呼ぶ。`call_sid` で冪等。
- 処理口 `resolve_callback`（SECURITY DEFINER・authenticatedのみ）：CS（hq/depot/area）が折り返し完了・不要を記録。
- ビュー `callback_queue`（security_invoker=on）：`callback_status='待ち'` を優先度→古い順に並べる＝折り返しリストの元。

## ファイル（コピペ実行）

| ファイル | 役割 |
| --- | --- |
| `call_log_v0.sql` | `call_logs` 表＋`record_call_log`／`resolve_callback`＋`callback_queue`ビュー＋GRANT＋RLS |
| `seed_call_log_v0.sql` | ダミー通話7件（`record_call_log`経由・`call_sid`一意制約で冪等・9000帯tracking_numberを使用） |
| `check_call_log_v0.sql` | 確認（件数分布／冪等／queue並び／resolve_callback／RLSなりすまし5ロール＋anon） |
| `pglite_test.mjs` | E2E検証（39/39 PASS） |

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
- `resolve_callback`：既存行の折り返し状態の更新のみ。CS（hq/depot/area）に限定・`auth.uid()` 必須（anon拒否）。
  対象が無ければ `P0002`、既に`完了`なら冪等に`already`を返す（二重解決の防止）。

どちらも SECURITY DEFINER。GRANT は record_call_log→`authenticated, anon`／resolve_callback→`authenticated`のみで、
「実行権そのものの剥奪」と「関数内 `auth.uid()`/`my_role()` チェック」の二重防御にしている。

### `callback_queue` は `security_invoker=on`

呼び出し元の `call_logs` RLSがそのまま効くため、hq/depot/areaは待ち行列が見え、driver/shipperは0件（`call_logs`が0件なので自動的に0件）。

### PII

`caller_phone`（発信者番号）・`transcript`（全文文字起こし）・`recording_url`（録音URL・メタのみで音声本体はTwilio側管理／保持期間未決＝範囲外）の3列はPII。表・列にCOMMENTで明示。

### `intent`（用件分類）はcheck制約なしの自由文字列

再配達／状況照会／時間変更／置き配／クレーム／その他 等を想定するが、カテゴリ確定は運用の細かい仕様のため
`outcome`（AI完結／転送済／折り返し要／中断／いたずら）・`channel`（ai_phone／phone）・`callback_status`（待ち／完了／不要）のみcheck制約を付け、
`intent`は自由記述にした。

## 用語（用語集v0.1・実値）

問合番号（tracking_number）／号（—）。結果: AI完結・転送済・折り返し要・中断・いたずら。折り返し状態: 待ち・完了・不要。

## 実機手順（LOL承認後・本タスクの範囲外）

1. Supabase SQL Editor で `call_log_v0.sql` → `seed_call_log_v0.sql` → `check_call_log_v0.sql` の順に実行。
2. `check_call_log_v0.sql` ④の各ブロックで judge列が全て `OK` になることを確認。anonブロックはエラー（`permission denied for table call_logs`）になれば合格。
3. 結果を `確認結果メモ.md` に記録。
