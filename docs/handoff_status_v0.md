# 現状ハンドオフ（指示書執筆AI向け）

最終更新: 2026-07-20 / 対象リポジトリ: `test_1`（LOL配送統合システム 検証環境）
（本文中の「2026-07-17」は語彙是正①〜⑤の**実測日**。最終更新日とは別。）

このファイルは「次の作業指示書（`shijisho/*.docx`）を書くAI」への引き継ぎ資料。
ここを読めば、正典・既存資産・DBスキーマ・未実装・ハマりどころが分かるようにしてある。

---

## 0. 大前提（毎回共通・正典）

- **正典**: ルートの `requirements_v2_0.docx`（LOL配送統合システム 要件定義書 v0.1）。指示書はこの章番号に紐づける。
- 新基盤（**Supabase ＋ SvelteKit ＋ Cloud Run**）。移行ではなく**新規構築**。既存GASは並行稼働、T1コア本番化（8月末目標）で切替。
- **検証環境のみ・AI生成のダミーデータ**。本番データ・現行GASには触らない。
- **全テーブルRLS有効**。秘密情報は環境変数(.env)。service roleキーはフロントに置かない（11.3）。
- 画面・用語は現行マニュアルv9／用語集v0.1に合わせる（ドライバーID・所属営業所・配送物・問合番号・かご記号・共通ID 等）。
- 識別子は英語snake_case、用語集の語は COMMENT で併記。

## 1. トラック構成（要件定義より）

- **T1コア**: 取込→共通ID判定→拠点/営業所振分→配車→問合Index → 帳票。DB＋RLS基盤。
- **T2 CS**: カスタマーサポート系（名称予約のみ・未着手）。
- **T3 ドライバーアプリ**: SvelteKit(PWA)。ログイン→仕分け→配達→報告。**第8章**。

階層: 本部(hq) → 拠点(depot) → 営業所(area) → ドライバー(driver) ／ 荷主(shipper)。RLSはこの帰属で可視範囲を決める。

---

## 2. 作業の進め方（既存の運用ルール）

- 1機能 = 1モジュールフォルダ。中に **SQL一式 ＋ `README.md` ＋ `確認結果メモ.md`**。
- SQLは **Supabase SQL Editor に手動コピペして Run**（自動マイグレーションはまだ使っていない）。
- 各モジュールに `check_*.sql`（確認用）があり、**期待件数 vs 実際** を 1:1 で突き合わせて合格判定する。
- 機微テーブル（drivers/work_schedules 等）は「**範囲外0件**」を必ず実証する（主張＝検証 1:1）。
- 指示書ファイル名・SQLは半角英数接頭辞推奨（要件定義 12.1）。

---

## 3. 既存資産（実装済み）

### 3.1 DB / RLS（`supabase/` 配下）

| モジュール | 内容 | 状態 |
|---|---|---|
| `dbschema_v0/` | 骨格8テーブル作成（下記） | ✅ |
| `rls_v0/` | **RLS v0.2**：profiles＋判定ヘルパー＋全テーブルRLS＋SELECTポリシー＋ロール別seed | ✅ 全項目合格 |
| `master_zoneplan_v0/` | 全国Master/ZonePlan 読込 v0.4 | ✅ |
| `csv_import_v0/` | CSV取込＋重複排除 v0.2（荷主の取込は下記 `shippers_master_v0` が置き換え版） | ✅ |
| `shippers_master_v0/` | **荷主マスタ v0.2**：`shippers`(text PK)＋直接seed(SHIP01/HACHI EXPRESS)＋取込で名称→shipper_idコード変換(未一致は保留)＋既存名称→SHIP01 backfill＋FK＋RLS | ✅ **pglite検証16/16 PASS**（2026-06-18） |
| `address_match_v0/` | 住所正規化・共通ID判定 v0.2 | ✅ |
| `unregistered_address_v0/` | 未登録住所の記録・修正フロー | ✅ |
| `office_assign_v0/` | 拠点振分 v0.2（共通ID→拠点→営業所） | ✅ |
| `area_master_v0/` | **エリアマスタ取込 v0.1**：集約masterを最小列（town_key＋zone_no＋common_id＋有効＋優先度）で `area_master` に取込（**親バッグ/バッグ番号/ユニット番号は廃止**）。CSVは Dashboard インポート→ `area_master_load_v0.sql` で正規化・有効・優先度確定・upsert。RLS hq参照 | ✅ pglite E2E 18/18（有効のみ・優先度小勝ち・zone_no整数化・廃止列なし） |
| `common_id_assign_v0/` | **共通ID付与 v0.4**：②住所判定を `area_master` **直lookup**（town_key前方一致・最長一致）に簡素化し `deliveries.common_id`＋**`zone_no` を保存**（unit_noは廃止）。未突合→保留＋`common_id_rematch_v0.sql`で再マッチ。**旧 `address_match_v0/match_v0.sql`(②)を置換**（①normalize_v0は前段で存続） | ✅ pglite E2E 18/18（付与・zone_no保存・保留・unit_no列なし） |
| `region_itami_demo_v0/` | **地域セット（伊丹営業所デモ）v0**：兵庫/大阪の実依頼リスト（2026-06-29）を1営業所IT01で①〜⑤通す（A案）。拠点D_ITM＋IT01＋ドライバー8＋稼働＋office直割当（`region_setup_v0`）→ 配車(記録口)＋採番(zone)（`run_flow_v0`）。実データ②付与率 **98.7%**（2,538/2,571・保留33）実測 | ✅ 実データ取込＋②実測。④⑤は検証済み関数の日付オーケストレーション |
| `delivery_order_zone_v0/` | **配達順修正 v0.3**：採番一式v0.5 `renumber_build` のソートを **①common_id ②時間 ③zone_no ④住所 ⑤問合番号** に（③住所→zone_noへ置換・ユニット不使用）。採番本体は無改修 | ✅ pglite E2E 18/18（zone_no昇順・zone_noが住所より優先・保留末尾・冪等） |
| `work_schedule_v0/` | ドライバー参照＋稼働予定 | ✅ |
| `auth_oauth_v0/` | **認証 v0.3**：新規authユーザー時に profiles 自動作成（role=NULL）トリガ | ✅ |
| `dispatch_v0/` | **配車 v0.5**（処理能力優先・cap=skill×時間・ゾーン分割・隣接束ね・仮ドライバー・dry-run→本実行・当日スコープ） | ✅ **実機確認済み**（2026-06-17・性能 約8,800件0.88秒） |
| `seq_kago_index_v0/` | **採番一式 v0.5**（配達順→かご記号→問合Index同期・当日一括取得ビュー `index_today`） | ✅ **実機確認済み**（2026-06-17・`delivery_index`実機800件） |
| `basket_carry_sheet_v0/` | **かご持出表PDF v0**：ドライバー×かご記号の担当個数・合計ビュー2本（security_invoker・area RLS）＋ `carry-sheets` Storage設定。フロントは `sort_nav_v0` の `/carry`（html2canvas+jsPDF・1ドライバー1枚・フッター記入欄・**service_role不要**） | ✅ pglite 15/15（自営業所のみ・範囲外0件・採番一致）・実機PDF出力確認済 |
| `godoor_csv_v0/` | **GoDoor用CSV出力 v0.2**：仕分済×有効ドライバー抽出ビュー（security_invoker・area RLS）＋ `godoor-csv` Storage設定。フロントは `sort_nav_v0` の `/godoor`（GAS27準拠の21列Ver4.0・UTF-8 BOM・CRLF・サニタイズ・全体＋ドライバー別・10000警告・**service_role不要**）。整形は `lib/godoor.ts`（純関数） | ✅ godoor.ts 28/28＋pglite 9/9（仕分済のみ・未割当除外・自営業所のみ） |
| `status_log_v0/` | **配達実績の記録口（ステータス遷移）v0（6.10第1項）**：`delivery_status_log` 表（from/to/changed_at/actor/source・SELECTは**deliveries RLS継承**）＋**記録口関数 `record_status_transition`**（線形遷移検証〔未配車→配車済→仕分済→配送中→完了/不在〕＋status更新＋ログを**不可分**・**SECURITY DEFINER＋関数内scope認可**＝status書込みを関数1本に限定＝**書込みRLS整備の代替**）。配車v0.5の`配車済`化は `dispatch_status_hook_v0.sql` で**記録口へ寄せ替え** | ✅ pglite 23/23（全遷移通る・許可外拒否・status一致・scope認可・RLS継承） |
| `label_print_bridge_v0/` | **ラベル印刷ブリッジ v0.4（6.8）**：機種非依存ペイロードビュー `label_payload`（かご記号・配達順・問合番号／**住所・氏名なし**・security_invoker・area RLS）＋ `print_history` 表＋ **SECURITY DEFINER 関数 `record_prints`**（printed_by=auth.uid()・area=自営業所固定・**service_role/書込みRLS不要**）。フロントは `sort_nav_v0` の `/label`（ラベルPDF〔数字のみ・大=かご記号+配達順／小=問合番号・約30mm〕・**印刷ON/OFF＋送信フック**〔端末別〕・履歴/再印刷・**バーコード枠既定OFF**）。整形は `lib/label.ts`（純関数）。**ブリッジ本体＋.lbxは外注**（孤立部品） | ✅ label.ts 18/18＋pglite 17/17（PII非混入・自営業所のみ・履歴office固定・RLS）・svelte-check 0/0 |
| `dispatch_sheet_v0/` | **配車表PDF（仕分前／仕分後）v0（6.9）**：明細ビュー `dispatch_sheet`（ドライバー×配達順）＋ `dispatch_sheet_summary`（総数/仕分済/未仕分）（security_invoker・area RLS）＋ `dispatch-sheets` Storage。フロントは `sort_nav_v0` の `/sheet`（html2canvas+jsPDF・1ドライバー1ページ・仕分前(pre)/仕分後(post)切替） | ✅ pglite（仕分前 sorted:0／seed後 DRV001 仕分済30・未仕分130／総量 summary=sheet=800一致）・実機PDF出力は `確認結果メモ.md` |
| `office_home_v0/` | **営業所ホーム 概況カード v0.1（§12.0.1）＋ 予測対象日カード・5セクション構造 v1.0（§12.0.2/3）**：`deliveries.imported_at` 列追加＋集計ビュー `office_home_summary`（security_invoker・area RLS）＋Realtime publication。状態行（青=作業中/緑=完了）・受信/配車済(実)/仮配車/最終配車実行/**再予測合図**（最新受信 > 最終配車実行）。フロントは `sort_nav_v0` の `/home`（Realtime購読・対象日クイック・稼働人数・5セクション導線） | ✅ pglite 23/23＋svelte-check 0/0・実機確認済（2026-07-08） |
| `admin_settings_v0/` | **管理者設定 v0.1（§12.13）**：営業所別の運用設定4項目（かご台車上限・かご振り順・自動ログアウト・印刷機種）の**器＋編集画面**。**`offices` に3列追加**（`office_settings` テーブルは作らない＝採番エンジンが `offices` を直読みするため二重管理回避）＋CHECK制約＋保存口 `update_office_settings`（SECURITY DEFINER・**hqのみ**）。フロントは `sort_nav_v0` の `/admin/settings`（hq=全営業所編集／area=自営業所参照のみ） | ✅ pglite 20/20＋svelte-check 0/0・**実機確認済（hq/area 両ロール）**。自動ログアウト・印刷機種は**器のみ**（消費側 §12.1／§15.3 は未実装） |
| `auth_rls_remaining_v1/` | **認証・権限 残課題 v1.1**：①Storage 3バケット（carry-sheets/dispatch-sheets/godoor-csv）を **office_code prefix × my_*** で制限（select+insert+**update**＝upsert上書きの潜在バグ修正）／②`address_master` 参照監査（**調査のみ・dropせず**）／③機微テーブル×ロールの**範囲外0件**証明（`set local role authenticated`＋JWTクレームで SQL Editor でもRLSを実効化・rollback） | ✅ pglite 26/26＋9/9＋11/11。**②の結論＝drop不可**（下記 §7・§6 参照） |
| `area_master_mojibake_fix_v0/` | **エリアマスタ文字化け修正（語彙是正① 単独版）v0.1**：`area_master`／`area_master_staging` の U+FFFD 破損を原本CSV `エリアマスタ_最終3_nobom.csv`（84,023行・U+FFFD 0件）と **intact列で個別突合**して是正。実測は staging **43行**／area_master **37行**（引き継ぎ期待≈20/≈13 の2〜3倍だったため一旦停止→`diagnose_mojibake_v0.sql` で「1行1フィールドのみ破損・common_id は全行intact」を確認して続行） | ✅ **U+FFFD 0件 実測達成**（pglite 9/9）。ブランチ `fix/area_master`。※親の**②〜⑤は未着手**（§7） |
| `pipeline_demo_v0/` | **パイプラインデモ v0（仮・ローカル用）**：`sort_nav_v0` の `/demo` から**本物の 配車→採番(zone配達順)** をボタンで動かす一時デモ。`demo_dispatch`／`demo_renumber`／`demo_reset`＋表示用関数（SECURITY DEFINER・anon実行可） | ✅ pglite 8/8＋svelte-check 0/0。⚠ **ローカルデモ用の割り切り**（anon から DEFINER 実行可・住所表示）。**本番投入しない**。デモ後は README 末尾の drop で撤去 |
| `rls_dummy/` | 初期PoC（営業所別RLS） | ✅ |

### 3.2 ドキュメント

- `docs/api_contract_v0/` … API契約 v0（**文書のみ・実装なし**）。Cloud Run(Hono+TS)層の命名規則・主要エンドポイント・日英キー対応。行の可視範囲はDBのRLSに委譲する方針。
- `docs/label_print_bridge_v0/` … ラベル印刷ブリッジ v0.4 の**境界仕様**：`adapter_contract_v0.md`（印刷ブリッジ アダプタ契約＝ペイロード＋トランスポート・機種抽象化）／`outsource_spec_v0.md`（b-PACブリッジ本体＋.lbx の**外注仕様書**・Windows/Brother TD-2350前提）。

### 3.3 フロント（`apps/` 配下）

- `apps/driver_auth_frontend_v0/` … **指示書「ドライバーアプリ認証フロント v0」の成果物**。
  - SvelteKit(Svelte5)＋`@supabase/ssr`、anonキーのみ、Supabase直＋RLS。
  - Google OAuth ログイン → セッション(Cookie/hooks) → 自分のドライバーprofile → **担当荷物のみ表示（RLS委譲）** → ガード → ログアウト → 「登録未完了」ページ。
  - 範囲は要件定義 **8.2 のみ**。8.3以降（配送一覧/仕分け/地図/配達処理/報告/稼働申請/点呼/GPS/オフライン）は**範囲外**。
  - ログイン画面に「別のアカウントを選んでログインする」チェック（`prompt=select_account`）あり。
  - 検証補助: `apps/driver_auth_frontend_v0/supabase/promote_test_driver_v0.sql`（テストGoogleユーザーを driver(DRV001) に昇格）。

- `apps/shipper_portal_v0/` … **指示書「荷主ポータル骨格 v0.2」の成果物**（要件定義 **7.2**）。
  - SvelteKit(Svelte5)＋`@supabase/ssr`。認証＝**パスワード／マジックリンク**（Supabase Auth メール）。
  - **状況確認**＝自社荷物の一覧＋ステータス＋荷主名称（anonキー＋RLS委譲＝自社のみ・他社0件）。
  - **CSVアップロード**＝ファイル→列マッピング→`POST /api/v1/imports`（**SvelteKitサーバendpoint**）。**service_roleは使わない**：endpointはログイン荷主のJWTで DB の **SECURITY DEFINER 関数 `shipper_import_deliveries`** を呼ぶだけ。関数が `shipper_id := my_shipper()` に固定して重複排除取込（import_v0準拠）。`deliveries` のRLSは**SELECT専用のまま（書込みRLSポリシー無し）**＝書けるのは関数経由のみ。別Cloud Runは作らず（将来移設可）。「API連携取込（荷主システム直結）」は将来＝範囲外。
  - 前提：荷主マスタ v0 実機実行済み（`shippers`＋`recipient_name`列）／`supabase/shipper_import_rpc_v0.sql` 実行（取込関数作成）。検証補助: `supabase/promote_test_shipper_v0.sql`（テストユーザーを shipper(SHIP01) に昇格）。
  - 事前検証：svelte-check 0err / build OK / importCore 13/13 / pglite 関数 11/11（自社固定・詐称無効・非荷主拒否・直接INSERT拒否・他社0件・重複排除）。

- `apps/ai_status_reply_v0/` … **指示書「Claude API PoC（配送状況の自動応答）v0」の成果物**（要件定義 **7.4**・**Cloud Run層の初実装**）。
  - **Hono+TS** 1エンドポイント `POST /api/v1/ai/delivery-status-reply`（問合番号＋任意question→Claudeが状況・配達予定を日本語自然文で回答）。モデル `claude-opus-4-8`（`@anthropic-ai/sdk`）。
  - **PIIマスキングを源流で強制**：DBの **SECURITY DEFINER 関数 `delivery_status_public`**（`supabase/ai_status_reply_v0/delivery_status_rpc_v0.sql`）が **氏名・詳細住所・連絡先を一切返さない**（status・予定日・時間帯・配達順・市レベルのみ）。＝サーバもClaudeもPIIを受け取らない・**service_role不要**（anon＋関数）。
  - **Claude APIキーはサーバ環境変数のみ**（フロント/レスポンス/ログに出さない・11.3）。API契約v0準拠（/api/v1・snake_case・統一エラー code/message）。PoCはローカルHono起動で十分（デプロイ任意）。荷受人認証(7.1)は範囲外。
  - 事前検証：typecheck 0err / prompt単体 20/20 / pglite関数 14/14（氏名・連絡先・詳細住所が結果に出ない・該当なしnull・anon/authenticated実行可）。Claude実呼び出しは【人】がキー設定して確認。

- `apps/reception_ui_v0/` … **指示書「受付UI＋内製定義＋バリデーション（Web受付・統合版）v0.4」の成果物**（要件定義 **7.1**）。
  - SvelteKit(Svelte5)。**不在票QR/URL → 問合番号 →〔OTP認証〕→ 受付種別 →（再配達/時間変更=希望日時 ／ 置き配=置き配場所）→ 確認 →〔受付登録/二重受付〕→ 完了〔状態取得〕** の7画面（受付種別で分岐）。共通部品（Button/入力/Select/Date/Radio/Stepper）・スマホ最適。
  - C章 N-1〜N-6・N-10・N-11 を実装：N-3 OTP認証（トークン・失敗回数・**ロック**）／N-4 受付登録（`POST /api/redelivery`）／N-5 二重受付（409→overwrite）／N-6 状態（`GET /api/status`・**PII返さず市レベルのみ**）／N-10 **PIIマスキングログ**（`mask.ts`）。認証中核(N-3)は外注に出さない。
  - **読み取りは検証Supabaseに実接続**（`src/lib/server/lookup.ts`）：番号存在チェック(N-3)・配送状況/市レベル(N-6)を **anon＋SECURITY DEFINER関数 `delivery_status_public`**（非PII）で取得。`.env` の `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY` 未設定なら**アプリ内ダミー**（`src/lib/server/store.ts`）へ自動フォールバック。**書き込み（受付登録・OTP送信）は実接続せずダミー**（受付テーブル・SMSチャネル=別指示書）。本番DB/鍵には触れない（検証DBのみ・anonキー）。
  - **バリデーション**（D章/N-2）の正は `src/lib/validation.ts`（7項目・直下赤字・入力時&送信時・全OKで送信可）。サーバ(N-4)でも再検証＝多層防御。
  - 事前検証：N-11 単体/結合 19/19（validation10+flow9）・**HTTPスモーク10/10**（OTP/ロック/受付/二重/状態・PII非混入）・svelte-check 0/0・build OK。
  - **受付チャネル v0（N-7〜N-9）を同アプリに増築済み**（指示書「受付チャネル LINE/SMS/電話 v0」）：`src/lib/server/channels/`（会話FSM・DI／LINE署名検証・返信／SMS送信アダプタ／レート制限／会話セッション）＋ `routes/webhook/{line,sms,phone}`。**読み取り=既存 `delivery_status_public`／登録=N-4／認証=N-3 を流用**。外部サービスは検証スタブ（キーは環境変数・本番非接続）、service ロールキー不使用。書き込み本実装は保留中の論点（チャネルはN-4をそのまま使う）。事前検証：channels単体 11/11（FSM3経路・ロック・二重・署名・イベント解釈・レート制限）＋HTTPスモーク6/6（**検証Supabase実接続**・実在番号）。詳細 `README_channels.md`／`確認結果メモ_channels.md`。
  - **ドライバー向けLINE QR返信 v0.1 を同アプリに増築済み**（PR #1→#3）：ドライバー専用LINE公式アカウントに**問合番号の数字部分**を送ると「KAZ＋数字」のQR画像が返る（伝票のバーコード/QR破損時の代替スキャン手段）。`routes/qr/[number]/+server.ts`（オンザフライPNG生成）＋ `routes/webhook/driver-line/+server.ts`。**ステートレス・DB非接触・service_role不使用**、荷受人向け `/webhook/line` とは**完全分離**（ルート・secret・環境変数）。**Netlify に検証本番デプロイ済み**（現場利用中）。公開運用の安全装置3点＝**署名検証 fail-closed**（SECRET未設定のスタブ通過はdevのみ・公開環境は403）／**`PUBLIC_APP_BASE_URL` 未設定は503**（QRは印刷物のためHostヘッダ由来URLで生成しない）／**公開ゲート `hooks.server.ts`**（本番既定の公開は `/qr/*` と `/webhook/driver-line` のみ・受付UIとその他チャネルは `RECEPTION_UI_PUBLIC=true` まで404）。既知の制約：`ratelimit.ts` はプロセス内メモリ＝サーバレスでは効きが弱い（driver webhookは署名必須のため悪用不可・受付チャネル本公開時は外部ストア化が必要）。詳細 `README_driver_qr.md`／`確認結果メモ_driver_qr.md`。

- `apps/sort_nav_v0/` … **T1営業所の画面シェル**（複数指示書の成果物が集約）。SvelteKit(Svelte5)＋anonキー＋RLS委譲・**service_role不使用**。areaロール想定（`/admin/settings` のみhqも）。
  - ルート：`/home`（営業所ホーム＝`office_home_v0`）・`/sort`（仕分けナビ）・`/sheet`（配車表PDF＝`dispatch_sheet_v0`）・`/godoor`（GoDoor CSV＝`godoor_csv_v0`）・`/carry`（かご持出表＝`basket_carry_sheet_v0`）・`/label`（ラベル印刷＝`label_print_bridge_v0`）・`/admin/settings`（管理者設定＝`admin_settings_v0`）・`/demo`（一連デモ＝`pipeline_demo_v0`・**一時物**）・`/incomplete`（登録未完了）・`/login`。
  - **日付はJST固定**（`src/lib/jstDate.ts`）＝サーバ(UTC)/ブラウザTZに依らず「今日」を解決。整形の純関数は `lib/godoor.ts`／`lib/label.ts`。
  - 検証補助: `apps/sort_nav_v0/supabase/promote_test_hq_v0.sql`（テストユーザーを hq に昇格）。

---

## 4. DBスキーマ（英語列名・要点のみ）

参照される側が先。`dbschema_v0/create_schema_v0.sql` が正。

- `depots(depot_code PK, depot_name)` … 拠点
- `offices(office_code PK, depot_code FK, office_name, dispatch_priority, basket_order, basket_cart_limit, autosave_threshold, request_period_days, auto_logout_enabled, auto_logout_minutes, printer_model)` … 営業所＋設定。後半3列は `admin_settings_v0` が追加（**器のみ・消費側未実装**）。書込みは `update_office_settings`（hqのみ）経由に限定＝write policy無し
- `zone_plan(common_id PK, zone_no, adjacent_zones)` … 全国ZonePlan
- ~~`address_master`~~ … **撤去済み（2026-07-17・語彙是正⑤）**。後継は `area_master`。3関数（`zone_rank`／`dispatch_build`／`delivery_status_public`）は area_master 参照へ移行済み。⚠ **旧マスタを作る/参照する記述が各所に残っている**（`dbschema_v0/create_schema_v0.sql`・`rls_v0/rls_v0.sql`・`master_zoneplan_v0/create_master_v0.sql`・`dispatch_v0/dispatch_v0.sql`・`ai_status_reply_v0/delivery_status_rpc_v0.sql`・`address_match_v0/match_v0.sql`・`unregistered_address_v0/unregistered_v0.sql`）。**すべて RETIRED 表明済み・再実行しないこと**（特に後ろ2つの関数原本は再実行すると④を巻き戻す）。詳細 `supabase/vocab_fix_v0/README.md`
- `area_master(town_key PK=normalize_addr(都道府県+自治体+町名), prefecture, municipality, town, chome, zone_no integer, common_id, area, depot, source_town_key, postal_code, is_valid, priority)` … **エリアマスタ（新語彙）**。②共通ID付与v0.4の直lookup元。RLSはhq参照
- `area_master_staging(prefecture, municipality, town, chome, zone_no, common_id, is_valid, priority, area, depot, src_town_key, postal_code)` … 集約masterのCSV取込バッファ（**全列text受け**）。`area_master_load_v0.sql` が正規化・有効絞り・優先度確定して `area_master` へupsert。※SELECTのGRANTが無い（`verify_rls_scope_v0` の `safe_count()` 対象）
- `delivery_status_log(id PK, tracking_number FK→deliveries, from_status, to_status, changed_at, changed_by, actor, source, note)` … **ステータス遷移ログ**（`status_log_v0`）。書込みは `record_status_transition` 経由のみ・SELECTは deliveries RLS継承
- `print_history(id PK, printed_at, printed_by, office_code, tracking_number, basket_code, delivery_order, kind['print','reprint','pdf'], terminal_id)` … ラベル印刷履歴（`label_print_bridge_v0`）。書込みは `record_prints` 経由のみ
- `deliveries(tracking_number PK, delivery_date, address, recipient_name, common_id, zone_no, depot_code, office_code FK, driver_id, delivery_order, basket_code, status, time_window, shipper_id FK→shippers, import_batch_id, imported_at)` … **配送データ（荷物）**。`shipper_id` は `shippers_master_v0` で FK 化（名称ではなくコード SHIP01 が入る）。`zone_no` は共通ID付与v0.4が保存（配達順v0.3のソートに使用）。`recipient_name` は `csv_import_v0` 由来（**PII**＝ラベル/ステータスAPIには出さない）。`imported_at` は `office_home_v0` が追加（概況カードの受信・再予測合図の判定に使用）
- `shippers(shipper_id PK=text, shipper_name)` … **荷主マスタ**（`shippers_master_v0`）。検証ダミーは HACHI EXPRESS=SHIP01 の1社
- `delivery_index(tracking_number PK FK→deliveries, driver_id, delivery_order, basket_code, common_id)` … **問合Index（高速参照）**
- `drivers(driver_id PK, driver_name, contact, vehicle, skill_per_hour, contract_start_date, contract_end_date, office_code FK, registration_status)` … ドライバーマスタ（機微）
- `work_schedules(id PK, driver_id FK, work_date, work_type, application_status['申請中','承認','却下'])` … 稼働予定（機微）
- `profiles(user_id PK=auth.uid(), role['hq','depot','area','driver','shipper' / NULL可], depot_code, office_code, driver_id, shipper_id)` … **アカウント↔帰属。RLS判定の起点**

### RLS判定ヘルパー（SECURITY DEFINER, `rls_v0/profiles_v0.sql`）
`my_role()` / `my_office()` / `my_depot()` / `my_driver()` / `my_shipper()` / `my_depot_offices()` / `my_office_drivers()`

### RLS SELECTポリシー要点（`rls_v0/rls_v0.sql`）
- `deliveries`: hq=全行 / depot=配下営業所 / area=自営業所 / **driver=自分の担当(`driver_id=my_driver()`)** / shipper=自社。
- `delivery_index`: 見える荷物に属する問合番号のみ（荷物RLSを継承）。
- `drivers`: hq=全 / area=自営業所所属 / **driver=自分の行のみ**。
- `work_schedules`: hq=全 / area=自営業所所属ドライバー分 / **driver=自分のみ**。
- `offices`: hq / area=自 / depot=配下。**driverロールのポリシーは無い**（＝driverはofficesを読めない）。
- `zone_plan`/`area_master`: 現状 hq のみ（詳細範囲は別指示書）。※`area_master_staging` は **SELECT の GRANT 自体が無い**（RLS以前にアクセス不可＝0件より強い防御）。※`address_master` は撤去済み（§7.0）。
- INSERT/UPDATE/DELETE ポリシーは**意図的に未整備**（v0はSELECT可視範囲のみ）。**これは穴ではなく設計**：書込みは **SECURITY DEFINER 関数＋関数内認可**に一本化し、write policy を作らないことで書込み口を数本に限定している（`record_status_transition`／`record_prints`／`update_office_settings`／`shipper_import_deliveries`）。新しい書込みもこの型に合わせる。
- **Storage**（`auth_rls_remaining_v1`）：3バケット（`carry-sheets`／`dispatch-sheets`／`godoor-csv`）は **`<office_code>/…` の prefix × my_*** で select+insert+update を制限。hq=全office／depot=配下／area=自営業所／他=拒否。**office prefix の無いパス（ルート直下等）へは誰も書けない**（意図どおり）。

---

## 5. 検証用ダミーデータ（★正準規格 v1 ＋ 伊丹デモ系の2系統）

⚠ **2系統が併存している**（2026-07-17 時点）。新規の**基盤/RLS検証**は下記 A（正準規格v1）に従う。B は実データを1営業所で通すデモ用。

- **A. 正準規格 v1（愛知系）**＝ `docs/dummy_data_standard_v1.md`（正典）。基盤・RLS・各モジュールの pglite 検証はこちら。
- **B. 伊丹デモ系（`IT01`）**＝ `region_itami_demo_v0` が導入（拠点 `D_ITM`＋営業所 `IT01`＋ドライバー8）。**実依頼リスト（2026-06-29・兵庫/大阪）**を①〜⑤通すためのもの。その後 `office_home_v0`（seed は `IT01`・`OH-%`・`OHD1/OHD2/仮OH1` で隔離）・`admin_settings_v0`（`IT01`=かご台車上限50）・`pipeline_demo_v0`（`/demo` の対象日 `2026-06-29`）も **IT01 前提**。
- 3営業所は共存する（`IT01`=50 / `A01`=10 / `C01`=10）。**どちらの系統の話をしているか毎回明示すること。**

以下は A（正準規格v1）の内容。

- **地域**：愛知（岡崎・豊田・東海・知多）。東京/神奈川は廃止。
- **拠点**：`D01`=愛知県第1拠点 / `D02`=愛知県第2拠点（**コードは英字**。旧 `'愛知県1'` 日本語コードは廃止）。
- **営業所**：`A01`(D01)=愛知県1営業所 / `C01`(D02)=愛知県2営業所（1:1）。**旧 B01 は廃止**。
- **ドライバー**：DRV001,DRV002∈A01 / DRV003,DRV004∈C01。
- **荷主**：`SHIP01`=HACHI EXPRESS（取込実体）/ `SHIP02`=ニコイチ運輸（RLS分離デモ）。両方 `shippers` 登録済（旧 SHIP03 廃止）。
- **common_id**：`OKZ_C_01_08` 等の OKZ_* 系。`C0001` は廃止。
- **問合番号**：実問合番号=12桁数字（基盤/RLSデモは `9000…` 帯）。配車量産のみ `DSP-<common_id>-<4桁>`。
- 主な seed：`rls_v0/seed_accounts_v0.sql`（RLSマトリクス・6荷物）/ `dbschema_v0/seed_dummy_v0.sql`（FK確認・3荷物）/ `office_assign_v0` `work_schedule_v0` `dispatch_v0`（パイプライン）/ `promote_test_driver_v0.sql`（認証フロント）。
- pglite で統一後 **計63項目 PASS**：基盤/RLSマトリクス/荷主FK・RLS/depot→office結合（35）＋ work_schedule・dispatch(800件・cap・分割・隣接束ね・仮)・address_match(14/2/2)・csv_import(16)（28）。

profiles は通常 `auth.users` のGoogleログインで自動作成（role=NULL）。検証ではSQLで role/driver_id を付与して昇格させる（本部オンボーディング相当）。

---

## 6. 環境・運用メモ（ハマりどころ）

- OS: Windows 11 / シェルは PowerShell。
- **PowerShellの実行ポリシー**でnpmが弾かれることがある → `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`、または `npm.cmd` を使う。
- フロントの環境変数は **SvelteKitの規約で `PUBLIC_` 接頭辞が必須**（クライアントへ渡す公開値）。`apps/driver_auth_frontend_v0/.env` に `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`。
- **Supabase URL は `https://xxxx.supabase.co` まで**。`/rest/v1/` 等のパスを付けると supabase-js が二重付与して「No API key found」になる。
- **Supabase SQL Editor は psql ではない** → `\set` などメタコマンドや `:'var'` 変数は使えない。値は直接埋め込む。
- Google OAuth：同意画面が「テスト中」の間は**テストユーザーに登録したGoogleアカウントのみ**ログイン可（Google Cloud → Auth Platform → 対象 → テストユーザー）。OAuthクライアントID/シークレットの発行プロジェクトと、テストユーザー設定プロジェクトは**同一**であること。
- アプリのログアウトはSupabaseセッションのみ破棄。ブラウザのGoogleログインは残るので、別アカウントで入るには `prompt=select_account`（上記チェック）を使う。
- Claude Code のローカル権限で外部送信系（WebFetch/WebSearch/curl/wget/Invoke-WebRequest 等）を deny 済み（`.claude/settings.local.json`）。

### 2026-06-16 以降に判明した落とし穴（重要）

- ⚠ **`drop table` は関数の参照を検知しない（時限爆弾）**：Postgres は**関数本体内のテーブル参照を `pg_depend` に記録しない**。そのため参照中の表でも `drop table` は**エラー無しで成功**し、次にその関数が走ったとき（配車実行・顧客照会）に初めて壊れる。参照確認は必ず **`pg_proc.prosrc` の全文検索**で行う（`auth_rls_remaining_v1/audit_address_master_v0.sql` §1）。
- ⚠ **`set local` は同一トランザクション内でしか効かない**：`verify_rls_scope_v0.sql` のなりすまし検証は、ブロックを **`begin;` から `rollback;` まで丸ごと**実行しないと `set local role authenticated` が効かず、**postgres のまま＝RLSバイパス**で走って「範囲外0件」が嘘になる。判定は結果の**先頭行「なりすまし確認」**で行う（`(null)/(null)` なら効いていない）。**結果ペイン右下の Role 表示は当てにしない**。
- ⚠ **SQL Editor（postgres）は RLS をバイパスする**＝範囲外0件の最終サインオフは**実機ログイン**で行う。SQL Editor での証明はなりすましブロックの中でのみ有効。
- ⚠ **Supabase の CSVインポートはマルチバイト文字を破損させる**：チャンク境界がマルチバイト文字を割り、**1行1フィールドだけ** U+FFFD（`chr(65533)`）になる。原本CSVは無傷。84,023行の取込で staging 43セル／area_master 37行が破損した実績あり（`area_master_mojibake_fix_v0`）。**大きいCSVを入れたら `detect_mojibake_v0.sql` で毎回検査する**。取込方式そのものの対策は**別タスク（未着手）**。
- ⚠ **破損セルの修復に `src_town_key` を使わない**：原本内で `src_town_key ≠ prefecture|municipality|town` が **856行**（実測）＝別の町に化ける。単一列JOINでの一括UPDATEも不可（`(pref|muni|town|chome)` は重複31種・`src_town_key` は重複549種）。**破損していない intact 列で1行ずつ突合**する。
- **日付は JST 固定が必須**：Cloud Run は UTC・ブラウザはローカルTZのため、「今日」を素直に解決すると既定日がズレる。フロントは `apps/sort_nav_v0/src/lib/jstDate.ts` を使う。
- **取得失敗を握りつぶさない**：営業所ホームの状態行は業務判断に使うため、ビュー未適用・RLS事故のときに「本日の受信はありません（緑=完了）」を出してはいけない（赤いエラー帯を出す）。
- **`.gitignore` がルート直下の実データを除外している**（`/*.csv`, `/*.xlsx`, `/*.pdf`）。原本 `エリアマスタ_最終3_nobom.csv` 等はリポジトリに入らない＝**ローカルにのみ存在**する。

---

## 7. 未実装・次の候補（指示書を書くなら）

### 7.0 ✅ 完了：語彙是正 → address_master 撤去 v0.1（①〜⑤・2026-07-17）

親指示書「語彙是正→address_master撤去 v0.1」は**①〜⑤すべて完了**。成果物は `supabase/vocab_fix_v0/`（②〜⑤）と `supabase/area_master_mojibake_fix_v0/`（①・工程ゲート）。pglite 計150項目 PASS。

| # | 内容 | 結果 |
|---|---|---|
| ① | 文字化け是正 | ✅ U+FFFD 43/37行 → **0/0**（`area_master_mojibake_fix_v0`・ブランチ `fix/area_master`） |
| ② | `zone_plan` 新語彙 | ✅ 1,653件を追加（旧行は残す）。**`min(zone_no)` で決定化**（指示書の `distinct` では PK衝突で落ちる） |
| ③ | `deliveries` 旧語彙 804行 | ✅ **0**（実データ2,607行は温存）。**`delivery_index` も明示削除**（指示書の「cascade で自動」は誤り） |
| ④ | 3関数の `area_master` 移行 | ✅ `zone_rank`／`dispatch_build`／`delivery_status_public`。実機: 配車 `muni_null=0`・anon で市名取得 |
| ⑤ | `address_master` drop ＋ 旧 zone_plan 行の掃除（**案a**） | ✅ **drop 後も3関数が動くことを実証**＝時限爆弾なし。zone_plan は新語彙1,653行のみ |

**工程ゲート**：`area_master_mojibake_fix_v0/recheck_vocab_gates_v0.sql`（13行・1画面・SELECTのみ・**drop 前後どちらでも動く**）。
⑤完了時点で **seq 9 の ⚠ 以外はすべて緑**。→ **以後この表に ✗/⚠ が出たら本物の異常**（想定内の赤は残していない）。
seq 9 = 3 は `GM2_07_07`／`HY4_12`／`KY3_NAK_186_195`＝**本物の複数自治体**で、消えないのが正しい（④の `order by priority asc nulls last, town_key` で決定化済み）。

**この工程で確立された教訓（次の指示書AIへ）**:
- **`drop table` は関数の参照を検知しない**（§6）。⑤の実行前に `pg_proc.prosrc` 全文検索で参照0件を機械確認した。ガードを外して素の drop を撃つと**エラー無しで成功し、次の顧客照会で落ちる**ことを pglite で実証済み。
- **共通IDは不透明キーとして扱う**（文字列からパースしない）。命名に2系統が混在（`<県>_<英字>_<from>_<to>`＝ゾーン範囲 ／ `KGW_01_02` 等＝単一ゾーンで `01` は From ではない）。パースすると香川・高知で静かに間違える。
- **指示書の記述をコードと突き合わせてから実装する**。本工程では指示書の誤り2件（③の cascade・②の distinct）と抜け2件（④で書き換えた関数原本の retire 対象漏れ）を実測で発見した。

### 7.0.1 語彙是正の残作業（別タスク）

- **`adjacent_zones` の再構築＝rank3 隣接判定の復活**（決定事項Cで別タスクに切り出し）。新語彙分は現在 **NULL**＝新語彙同士の隣接判定は発火しない。新エリアマスタCSVに隣接列が無いため、**新語彙のZonePlan原本（隣接定義）の supply が前提**。
- **CSVインポートの破損対策**（§6の U+FFFD・恒久対策は未着手）。当面は取込後に `detect_mojibake_v0.sql` で検査する運用。
- **用語集v0.1 の申し送り**：「ドライバー順」→「担当件数の多い順」（§7.2）。

### 7.1 第8章 T3ドライバーアプリの残り

| 章 | 機能 | 補足 |
|---|---|---|
| 8.3 | ~~配送一覧の作り込み~~ → **実装済み**（`apps/driver_auth_frontend_v0` ホーム＝配送一覧・配達順・対象日切替・氏名・読取のみ） | ✅ |
| — | **当日一括取得／仕分けナビ** | §146・§239。問合Index採番＋同期は `seq_kago_index_v0`、当日一括取得ビュー `index_today` も用意済み。**仕分けナビのフロントUIは `apps/sort_nav_v0` で実装済み**（T1営業所・スキャン→かご記号/配達順・かご一覧・保留/誤仕分け/重複・スキャン済ローカルIndexedDB・読取のみ）。残りは**仕分済のDB永続化**（書き込みRLS整備後）。 |
| 8.4 | 地図ナビ | |
| 8.5 | 配達処理（書き込み） | **status（完了/不在）は `record_status_transition` を呼べば書ける**（整備済み）。残る配達詳細（写真・受領者・備考等）の書込み口が未整備＝**DEFINER関数を1本足す**のが本基盤の型（write policy は作らない・§7.2） |
| 8.6 | 報告 | |
| 8.7 | 稼働申請（フロント） | DB側 `work_schedule_v0` は実装済み。**表示のみ実装済**（`/home` セクション1の稼働人数＝対象日×承認済みのユニーク数・読取のみ）。申請/シフト編集のフロントは未実装 |
| 8.8 | 点呼/アルコール | |
| 8.9 | GPS | |
| 8.10 | オフライン本実装 | PWA。今回v0では未実装 |

### 7.2 その他の基盤候補

- ~~★ 語彙是正 ②〜⑤~~ → **完了**（§7.0）。残作業は §7.0.1（隣接の再構築・CSV破損対策）。
- **書き込み系RLS（INSERT/UPDATE/DELETE）の整備**：配達処理・稼働申請などフロントの書き込みに必須。現状SELECTのみ。※ただし **`deliveries.status` の書き込みは `status_log_v0` の記録口関数 `record_status_transition`（SECURITY DEFINER＋scope認可）で既に安全に可能**（仕分けナビ『仕分済』・T3『完了/不在』はこの口を呼べばよい＝status書込みは整備済み扱い）。残るは status 以外の書き込み（配達詳細ログ・稼働申請等）。
  - **本基盤で定着した規約**：write policy は作らず、書込みは **SECURITY DEFINER 関数1本＋関数内で認可検査**に寄せる（`record_status_transition`／`record_prints`／`update_office_settings`／`shipper_import_deliveries` が全てこの型）。新しい書込み口もこの型に合わせること。
- **帳票出力（6.9）は概ね実装済み**：配車表PDF（`dispatch_sheet_v0`）・GoDoor CSV（`godoor_csv_v0`）・かご持出表（`basket_carry_sheet_v0`）・ラベル（`label_print_bridge_v0`）。残りは **`/home` セクション4の「3点まとめ出力」**（準備中）と、**ラベル印刷ブリッジ本体＋.lbx（外注・孤立部品）**。
- **消費側が未実装の設定**（`admin_settings_v0` は器のみ）：**自動ログアウト**（§12.1・認証）と **印刷機種**（§15.3・印刷ブリッジ）。画面で設定できるが、まだ何にも効かない。
- **`pipeline_demo_v0` の撤去**：`/demo` の `demo_*` 関数は **anon から DEFINER 実行可**のローカルデモ用の割り切り。予測配車の本実装（#25）が入ったら README 末尾の drop で撤去する。
- T1コアの配車本実装（予測配車 #25）。
- API契約 v0 に基づく Cloud Run(Hono+TS) 実装（現状は `apps/ai_status_reply_v0` の1エンドポイントのみ）。
- zone_plan/address_master の詳細RLS範囲。
- **CSVインポートの破損対策**（§6の U+FFFD・別タスク）：現状は「入れたら `detect_mojibake_v0.sql` で検査する」運用でしのいでいる。
- **anon の問合番号 総当たり照会**（既存仕様・未対応）：`delivery_status_public` は anon 実行可のため、問合番号を総当たりすれば非PIIの配送状況（status/予定日/時間帯/配達順/市）を引ける。**返すのは非PIIのみで設計どおり**だが、番号推測に対する保護は無い。→ **要件定義 7.1 の前段認証（荷受人の簡易認証）**を入れる将来タスク。レート制限も併せて検討（`ratelimit.ts` はプロセス内メモリでサーバレスでは弱い＝§3.3 の既知制約）。
- **用語集v0.1 の申し送り**：「ドライバー順」の定義を **「担当件数の多い順」** に更新（実装 `renumber_v0.sql:132` は `cnt desc`。指示書の「ドライバー登録順」とは異なる）。登録順に変えるなら**採番本体の修正**＝別指示書。

---

## 8. 指示書を書くときのテンプレ観点（既存指示書の型）

各指示書は概ね以下の構成: **タイトル / 対象機能（要件定義 章番号）/ 前提 / やること（【人】【AI】区分）/ やらないこと（範囲外）/ 合格条件（動作確認の観点）/ 成果物**。
- 【人】＝手作業（Supabase設定・OAuth・実ログイン等）、【AI】＝Claude Codeで生成・実行。
- 合格条件は**観点ごとに期待値を数値で**書く（件数・ミリ秒・0件 等）。機微データは範囲外0件を必須化。
- 成果物は「SQL一式＋README＋確認結果メモ（期待/実の表＋スクショ）」を基本形にする。
