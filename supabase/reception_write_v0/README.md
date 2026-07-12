# 受付登録の記録口（N-4/N-5/N-6）v0

要件定義 D章相当（受付種別・希望日時・置き配場所の必須項目）／N-4(受付登録)・N-5(二重受付)・N-6(状態照会)。
店頭のインメモリ実装（`apps/reception_ui_v0/src/lib/server/store.ts`）をSupabaseへ移す第一歩。書き込みは本モジュールの
SECURITY DEFINER関数に一本化（本基盤の規約：write policyを作らず記録口関数で代替）。

受付は「お客様チャネル（Web/LINE/SMS/電話/AI電話）」からの**未認証アクセス**を想定するため、
`register_reception` と `get_reception_public` のみ例外的に **anon にも実行権を付与**する
（`ai_status_reply_v0/delivery_status_rpc_v0.sql` の `delivery_status_public` と同じ考え方）。

## ファイル（コピペ実行）

| ファイル | 役割 |
| --- | --- |
| `reception_write_v0.sql` | `number_bands`（帯設定）＋`reception_requests`（受付）＋`register_reception`（記録口）＋`get_reception_public`（非PII照会）＋RLS（SELECTのみ） |
| `seed_reception_write_v0.sql` | 検証用ダミー（冪等）。900000099001〜099999・KAZ900000099099 |
| `check_reception_write_v0.sql` | 確認（①件数突合 ②二重受付 ③上書き履歴 ④帯設定一覧 ⑤なりすましRLS ⑥write policy ⑦anon実在番号） |
| `pglite_test.mjs` | E2E検証（**94/94 PASS**） |

## 実行順（実機・Supabase SQL Editor）

1. `reception_write_v0.sql`
2. `seed_reception_write_v0.sql`
3. `check_reception_write_v0.sql`

前提: `dbschema_v0`（`offices` の A01 等）実行済み。seedが検証用 `deliveries` 行を自前で作るため、
`csv_import` 等の取込データが無い環境でも本モジュール単体で確認できる。

**運用ルール（CLAUDE.md準拠）**:
- SQLはSupabase SQL Editorに**手動コピペしてRun**（自動マイグレーション不使用）。psqlではないため `\set` 等のメタコマンドは不可。値は直接埋め込む。
- 複数文は**最後の結果しか表示されない**ため、コメント区切り（`-- ① ...` 等）の**ブロック単位でCtrl+Enter個別実行**すること。
- `check_reception_write_v0.sql` の⑤・⑦（なりすまし確認）は `begin;`〜`rollback;` を**丸ごと**実行する（`set local role` は同一トランザクション内でしか効かない。部分実行するとRLSバイパスのまま走り誤判定になる）。すべてrollbackで終わるためDBには一切書き込まれない。

## 帯（number_bands）の解禁手順

帯の追加は `number_bands` の**行変更のみ**で完結する（コード改修不要・要件v0 §4）。

初期状態: `demo9000`/`req`/`dsp` は照合あり。`kaz`/`a`/`four` は**仮値**（現場確認前提で照合なし）。

現場確認後、対象帯の受付時実在チェックを有効にする場合は1行UPDATEのみ：

```sql
update public.number_bands
set verify_on_reception = true
where band_key = 'kaz';  -- 対象帯キーに置き換え
```

- `verify_on_reception`＝受付時に `deliveries` 実在チェックを課すか（falseなら未照合でも受付可）。**本モジュールの `register_reception` が実際に参照する**（実装済み・機能する）。
- `lookup_enabled`＝状況照会の解禁フラグとして列は用意済みだが、**本モジュールのどの関数からも未参照**（初期値の投入のみ）。
  1. 現状、この列を見て分岐する処理は存在しない（`get_reception_public` はこの列を一切SELECTしていない）。
  2. 参照する実装は**指示書❸（AI状況照会エンジン）**で行う想定（本モジュールのスコープ外）。
  3. そのため**現状の `get_reception_public` は帯を問わず全ての活性受付（受付済）の非PIIサマリを返す**（＝`lookup_enabled=false`の`kaz`/`a`/`four`帯で受け付けた内容も、問合番号さえ分かれば照会できてしまう）。
  この挙動のままで良いか（`lookup_enabled`実装までの暫定として許容するか、先に照会側も止めるか）は**LOL確認事項**。

## 設計判断（LOL向け明記）

### ① 未照合行（band照合なし受付）は hq のみ可視

`reception_requests` のSELECT RLSは「その荷物（`deliveries`）が見えるなら受付も見える」＝`deliveries` のRLSを継承する設計（`status_log_inherit` と同型）。
`verify_on_reception=false` の帯（KAZ等）で受け付けた行は `deliveries` 側に対応する親行が存在しないため、
depot/area/driver/shipper のロールでは**継承先の親が無く誰にも見えない**。そのため未照合行は例外的に **hq のみ** 可視とし、
`my_role() = 'hq' or exists(deliveries側で紐づく)` の2条件をORで判定している（`reception_write_v0.sql` §5・ポリシー `reception_requests_select`）。

### ② `get_reception_public` を設けた理由

N-6の状態照会（`reception/done` ページの反映確認）は、**登録直後に改めてDBを読み直して**受付内容を表示する。
チャネル系（LINE/SMS/電話等）でも登録後に状態を確認する経路が今後増える想定のため、
「登録後にDBを読んで非PIIサマリだけ返す」専用関数として `get_reception_public` を1本化した。
`caller_phone`（PII）・`created_by` は意図的にSELECTしない＝非PIIマスキングを**関数の内部（源流）で強制**する設計
（`ai_phone`等のAI/受付側でPIIを誤って露出させない狙い。CLAUDE.mdの「AI/受付のPIIマスキングを源流で強制」と同じ考え方）。

### ③ `unchanged` 判定は内容4項目比較（channel/caller_phoneは除外）

`register_reception` の冪等判定（同一問合番号の活性受付に対する再送）は、
**種別(reception_type)・希望日(desired_date)・時間帯(time_slot)・置き配場所(drop_place)の4項目一致**でのみ `unchanged` とする。
`channel`・`caller_phone` は比較対象に**含めない**（例: Web経由で受け付けた内容と同一内容をLINE経由で再送しても、
チャネルが違うというだけで新しい行を作らない＝行を無駄に増やさない設計）。

### ④ 旧版のインデックスを適用済みの環境への注意

`reception_requests_active_tn_uidx`（部分UNIQUEインデックス）は、開発初期に作成した非UNIQUE版
`reception_requests_tn_idx`（同一定義・UNIQUE制約なし）を置き換えたもの。`create index if not exists` は
**名前が違うインデックスを自動では消さない**ため、旧版を先に適用した環境では以下を1行実行してから
`reception_write_v0.sql` を流し直すこと（新規環境では不要）:

```sql
drop index if exists public.reception_requests_tn_idx;
```

## アプリ側の接続（`apps/reception_ui_v0`）

`src/lib/server/reception.ts` が本モジュールへの窓口（ファサード）。`lookup.ts` と同型の live/fallback切替:

- **live**: `PUBLIC_SUPABASE_URL`／`PUBLIC_SUPABASE_ANON_KEY`（環境変数名のみ。値は書かない）が設定済みなら、anonキーで
  `register_reception`（登録）・`get_reception_public`（非PIIサマリ照会）をRPC呼び出しする。
- **fallback**: 未設定時は店頭のインメモリ実装（`store.ts`）へフォールバック（既存挙動と完全一致）。
- RPCエラー（ネットワーク/PostgREST）時は**フォールバックしない**＝`{ok:false}` を返す（silent fallbackで書き込み先がDBとインメモリに割れるのを防ぐ）。

呼び出し元4箇所（すべて `submitReception`/`getReception` 経由に統一済み・Task 5）:

| 呼び出し元 | channel |
| --- | --- |
| `src/lib/server/channels/services.ts`（LINE/SMS会話FSM） | `'line'` / `'sms'`（セッションのチャネルから） |
| `src/routes/webhook/phone/+server.ts`（電話受け口） | `'phone'` |
| `src/routes/api/redelivery/+server.ts`（Web受付） | `'web'` |
| `src/routes/api/status/+server.ts`（N-6状態照会） | — （`getReception` を使用。登録ではなく照会） |

**既知の設計上の差異（メモの非永続化）**: `api/redelivery` の入力にはメモ欄（`body.memo`）があるが、
`reception_requests` に memo列は存在しないため、バリデーションのみ行い**登録には含めない**
（従来のインメモリ実装では保持していたが、どのUIからもAPI経由で読み返されておらず観測可能な挙動変化はない。
自由記述の永続化が必要になった場合はスキーマ追加の指示書が別途必要）。

## anon実行の前提とリスク

`register_reception`・`get_reception_public` は anon（未認証）から直接RPC実行できる設計（お客様チャネル向け）。
実機運用に入る前提として、以下のリスクは残ったままであることを明記しておく：

- **N-3のOTPはアプリ層のゲート**であり、RPCを直接叩く経路には適用されない。`p_overwrite=true` を渡せば
  誰でも既存の活性受付を上書きできてしまう（`duplicate` 結果は既存の `receipt_no`／`reception_type` を
  そのまま返すため、これもOTPなしで読める）。アプリのUIはOTP確認後にしか上書きを呼ばないが、
  RPCへの直接アクセスにはこの制約が効かない。
- **直接PostgRESTアクセスにはアプリのレート制限が効かない**（アプリ側のレート制限はアプリ層の実装であり、
  RPCへの直接アクセスを止めるものではない）。
- **入力上限と `desired_date` の窓はDB/関数側で強制済み**（`register_reception` の事前バリデーション＋
  `reception_requests` のCHECK制約バックストップ。最終レビュー対応I2）。
- 検証トークン等の恒久策（RPC直叩きそのものを構造的に防ぐ仕組み）は後続指示書の論点＝**LOL確認事項**。

値・秘密（Supabase URL・anonキー等）は本節にも一切記載しない。

## 承認後の実機手順（LOL承認後に実施）

1. SQL Editorで `reception_write_v0.sql` → `seed_reception_write_v0.sql` → `check_reception_write_v0.sql` を適用（本README「実行順」のとおり）。
2. `apps/reception_ui_v0/.env`（または環境）に `PUBLIC_SUPABASE_URL`／`PUBLIC_SUPABASE_ANON_KEY` を設定（**値はここに書かない**。設定済み/環境変数名のみ記録）。
3. アプリを起動し、実在の検証用問合番号（例: `900000099001`）で受付フローを通し、`register_reception` が **anon実行で `result=created`** になることを確認。
4. `/api/status` で登録直後の内容（種別・希望日・時間帯・置き配場所）が反映されていることを確認（`get_reception_public` 経由）。
5. 確認結果は `確認結果メモ.md` の「実機確認」欄に記録する。
6. **ブロッカー**: 実機env有効化の前に、`!ok`汎用失敗レスポンス（現状フォールバック含め常に500。`format_error`→400／`not_found`→404への振り分け）を精緻化すること。

現時点では上記は**未実施**（LOL承認前のため共有Supabaseへは接続していない）。
