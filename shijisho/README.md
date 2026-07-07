# shijisho（指示書置き場）

今後の作業指示書（.docx 等）をこのフォルダに置く。

## 使い方

1. 指示書ファイルをこのフォルダにドラッグして置く
2. チャットで「`shijisho/ファイル名` お願い」のように指示する
3. Claude が内容を読み取り、要件定義書（`requirements_v2_0.docx`）の該当章と
   照らし合わせて対応する

## 前提（共通）

- 正典: 親フォルダの `requirements_v2_0.docx`（LOL配送統合システム 要件定義書 v0.1）
- 検証環境のみ・ダミーデータ・本番/現行GASには触れない
- 全テーブルRLS有効・秘密情報は環境変数(.env)
- ファイル名は半角英数の接頭辞を推奨（要件定義 12.1）

## これまでの成果物

- `../supabase/rls_dummy/` … 指示書「ダミーテーブル作成＋RLS動作確認（営業所別アクセス制御）」の成果物
- `../apps/driver_auth_frontend_v0/` … 指示書「ドライバーアプリ認証フロント v0」の成果物（SvelteKit/PWA・Google OAuth→担当荷物のみ表示＝RLS）
- `../supabase/dispatch_v0/` … 指示書「配車 v0.5（処理能力優先・仮ドライバー）」の成果物（cap=skill×時間／ゾーン分割／隣接束ね／仮ドライバー／dry-run→本実行）
- `../supabase/seq_kago_index_v0/` … 指示書「配達順・かご記号 採番＋問合Index同期 v0.5」の成果物（配達順→かご記号→問合Index同期／当日一括取得ビュー。delivery_indexが埋まる）
- `../apps/sort_nav_v0/` … 指示書「仕分けナビ v0.3」の成果物（T1営業所フロント・スキャン→かご記号/配達順・当日一括取得・読取のみ・スキャン済ローカル）
- `../supabase/dispatch_sheet_v0/` … 指示書「配車表PDF（仕分前／仕分後）v0」の成果物（ビュー＋検証seed＋Storage。出力画面は `apps/sort_nav_v0/.../sheet`）
- `../apps/driver_auth_frontend_v0/`（§8.3追加） … 指示書「配送一覧（配車結果表示）v0」の成果物（ドライバーアプリのホーム＝配送一覧・配達順・対象日切替・読取のみ）
