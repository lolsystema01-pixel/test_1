# 仕分けナビ v0（T1 営業所オペレータ画面）

指示書 `shijisho/shijisho_sort_nav_v0_3.docx` の成果物。要件定義 **6.7 仕分け（仕分けナビ）／11.1 性能（照会400ms未満）** に対応。

**スタック**: SvelteKit (Svelte 5) + `@supabase/ssr` / Supabase直＋RLS / **anonキーのみ**（service roleキーは置かない・11.3）。
**範囲**: 当日一括取得 → スキャン→かご記号・配達順の即時表示 → 営業所全体のかご一覧 → 保留/誤仕分け/重複防止 → **スキャン済はローカル（IndexedDB）**。
**読み取りのみ**（DBの仕分済確定＝書き込みRLS整備後・別指示書）。

## 構成

| パス | 役割 |
|---|---|
| `src/hooks.server.ts` | Supabaseサーバークライアント(anon)＋セッション＋認証ガード（流用） |
| `src/routes/login/` ・ `auth/callback` ・ `auth/signout` | Google OAuth（areaロール）ログイン／コールバック／ログアウト |
| `src/routes/+page.server.ts` | **ルート `/` → `/home` にリダイレクト**（307） |
| `src/routes/home/` | **営業所ホーム**：予測対象日カード＋概況カード（Realtime）＋5セクション導線（DBは `supabase/office_home_v0/`） |
| `src/routes/sort/+page.server.ts` | **当日一括取得**：`index_today`＋`deliveries_today`。areaロール＋自営業所ガード |
| `src/routes/sort/+page.svelte` | 仕分けナビUI（スキャン・即時表示・かご一覧・保留/誤仕分け/重複・IndexedDB） |
| `src/routes/sheet/` ・ `carry/` ・ `godoor/` ・ `label/` | 出力（配車表PDF／かご持出表PDF／GoDoor CSV／ラベル印刷） |
| `src/routes/demo/` | 予測配車・採番（デモ。`?date=` でホームの予測対象日を引き継ぐ） |
| `src/routes/incomplete/` | area未設定（権限なし）ページ |
| `src/lib/idb.ts` | スキャン済のIndexedDB保持（再読込で復元） |
| `src/lib/jstDate.ts` | 日付ヘルパ（**JST固定**。サーバ(UTC)/ブラウザのTZに依存しない） |
| `supabase/deliveries_today_v0.sql` | 読み取り補助ビュー（status付き当日荷物・保留/対象外/担当者不明 判定用） |
| `supabase/promote_test_area_v0.sql` | 検証用：テストGoogleユーザーを area(A01) に昇格 |

> **ルート再編について**：`/`＝仕分けナビだったものを `/`→`/home`（営業所ホーム）へリダイレクトし、仕分けナビを `/sort` に移設しました（旧URLは307で救済）。営業所ホームが5セクションの起点になる構成のためで、**指示書の範囲外の変更**です（PRで合意）。各セクションからは「← 営業所ホーム」で戻れます。

## スコープと分類（RLS委譲）

- **読み取りスコープ＝自営業所の当日分・全ドライバー横断**（areaロールのRLS：自営業所の全荷物）。`index_today`/`deliveries_today` は `security_invoker=on` で呼び出し元RLSを適用。
- スキャン時の分類：
  - `index_today` にあり → **かご記号・配達順を即時表示**（ブラウザ内Map参照）。重複は弾く。
  - `deliveries_today` にあり・`index` に無し → **担当者不明**（index欠落）。status=保留 → **保留表示**。
  - どちらにも無し → **対象外（誤仕分け警告）**。

## 動かす前の準備

### 1. 上流データ（実機・前提）
配車 v0 → 採番一式 v0 を実機実行し、当日の `delivery_index` と `index_today` ビューがある状態。
`supabase/deliveries_today_v0.sql` を SQL Editor で実行（読み取り補助ビュー作成）。

### 2. T1 営業所ログイン（area）の用意
- Supabase の Google プロバイダ有効化＋Redirect URL `http://localhost:5173/auth/callback`（ドライバーアプリと同じ）。
- `.env`：`PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`（anonのみ）。
- アプリにテスト用Googleで一度ログイン（role=NULL→「権限なし」）→ `supabase/promote_test_area_v0.sql`（メール書換）で **role=area / office_code=A01** に昇格 → 再読込。

### 3. 起動
```powershell
npm install
npm run dev   # http://localhost:5173
```

## 合格条件（→ `動作確認メモ.md`）

1. 起動時に自営業所の当日分（全ドライバー）が `index_today` から一括取得され、以降の照会がブラウザ内で解決（400ms未満）。
2. 自営業所の問合番号スキャンで かご記号・配達順 が即時表示（例 A / 5）。
3. ハンディスキャナ（USB-HID）／カメラ（BarcodeDetector）／直接入力 で入力できる。
4. 本日のかご一覧（営業所全体）に 個数・スキャン済・残 が表示され、スキャンで残が減る。再読込でローカルのスキャン済が復元。
5. 保留で保留表示／対象外で誤仕分け警告／index欠落で担当者不明／重複スキャンが弾かれる。
6. DB側の荷物ステータスは変更されない（書き込みRLS未整備）。service roleキー不在（anonのみ）。

## 注意

- **書き込みなし**：スキャン済はこの端末のローカル（IndexedDB）保持のみ。DB永続化は「書き込みRLS整備（area=自営業所のUPDATE）」後に追加。
- カメラ読取は `BarcodeDetector` 対応ブラウザ（Chromium系）でのみ。未対応時はハンディ／直接入力にフォールバック（メッセージ表示）。
- ハンディスキャナはUSB-HID＝キーボード入力として、フォーカスした入力欄＋Enterで取り込む（追加ドライバ不要）。
