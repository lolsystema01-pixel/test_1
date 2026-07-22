# 初期設定（営業所新規追加時の初回画面）v0.2（§12.14）

指示書 `shijisho/shijisho_office_init_setup_v0_2.docx` の成果物。
営業所を新規追加したとき、**初回ログインでのみ自動表示**する2項目入力の「器」と「保存口」＋画面。

| 入力項目 | offices の列 | 状態 |
|---|---|---|
| 持出バッグリスト フォルダURL | `gdrive_folder_url` | **本モジュールで新規追加** |
| ラベルプリンタ機種 | `printer_model` | 管理者設定 v0.1 で追加済み（CHECK制約）＝**初回入力のみ** |

## 設計

- **設定の実体は `offices`**（`office_settings` テーブルは作らない）。管理者設定 v0.1 と同じ器。
- **完了フラグ（`setup_completed` 相当）は作らない**。`gdrive_folder_url IS NULL` を「初期設定 未完」とみなし、初回ゲートの判定に流用する（1列で状態を表す）。
  - `printer_model` は既定値やCHECKで入り得るため、未完判定には**使わない**。
  - **空文字ではなく NULL** を「未完」とする（保存口が空文字を弾く）。
- **書込みは write policy を作らず SECURITY DEFINER 関数**（本基盤の規約）。

## ⚠ 権限の設計（指示書が「要確認」としている論点）

指示書は「権限＝管理者（§13.1）」としつつ、「**初回ログイン時に自動表示なので初回ログインユーザー（営業所長/オペレータ）との整合は要確認**」と保留しています。本実装は次の折衷を採りました。

| ロール | 保存できる範囲 |
|---|---|
| **hq** | いつでも・全営業所 |
| **area** | **自営業所のみ**、かつ **`gdrive_folder_url` が NULL のとき（＝初回）だけ** |

**理由**: 初回ゲートを実際に見るのは area ユーザーです（`sort_nav` は area 用アプリで、hq はルートから `/admin/settings` へ振られる）。hq 限定にすると「**画面は出るが保存できない**」デッドロックになり、機能が成立しません。一方で area に恒久的な編集権を与えないため、**2回目以降の変更は hq（管理者設定§12.13）に限定**しています。

→ **業務Aの確認事項。** 「初期設定も hq 限定」で運用するなら、`office_init_setup_v0.sql` §2 の area 分岐を落とせば hq 限定になります。

## ファイル

| ファイル | 内容 |
|---|---|
| `office_init_setup_v0.sql` | `gdrive_folder_url` 追加＋保存口 `save_office_init_setup`（DEFINER）。冪等 |
| `check_office_init_v0.sql` | 列・ゲート判定・権限の確認（§4 はなりすまし実証・rollback） |
| `pglite_test_office_init.mjs` | 23/23 PASS |
| （フロント）`apps/sort_nav_v0/src/routes/setup/` | 初期設定画面（2項目入力＋保存） |
| （フロント）`apps/sort_nav_v0/src/routes/home/+page.server.ts` | 初回ゲート（未完なら `/setup` へ） |

## 実行順（Supabase SQL Editor・手動コピペ）

1. `office_init_setup_v0.sql` … 列追加＋保存口
2. `check_office_init_v0.sql` … §1〜§3 を確認（§4 は権限の実証・任意）
3. フロント: `apps/sort_nav_v0` を起動 → **`gdrive_folder_url` が NULL の営業所**の area ユーザーでログイン → `/home` が `/setup` へ自動遷移 → 2項目を入力して保存 → `/home` に戻る → 再訪しても `/setup` に飛ばされない

## 画面の挙動

- **初回ゲート**: `/home` の load で `offices.gdrive_folder_url` を見て、NULL なら `/setup` へリダイレクト。入力後は NULL でなくなるので素通りする。

### ⚠ ゲートの適用範囲は `/home` のみ（v0.2 の割り切り・既知の制限）

**`/label`・`/carry`・`/sheet`・`/godoor`・`/sort` は `gdrive_folder_url` を見ていません。**
通常導線（ログイン → `/` → `/home`）では必ずゲートを通りますが、**URLを直接打てば初期設定を飛ばせます**。

v0.2 の指示書が「**初回ログイン時に自動表示**」を求めており「全機能の利用前に必須」とはしていないため、本実装は `/home` のゲートに留めています。実害も限定的です。

- `printer_model` … 未設定でも消費側が既定値（Brother TD-2350）を適用する（管理者設定 v0.1）
- `gdrive_folder_url` … 消費側（Gドライブ保存）が**そもそも未実装**なので、未設定でも壊れない

**「全機能利用前に必須」に格上げする場合**は、`apps/sort_nav_v0/src/routes/+layout.server.ts` に共通化してください（現在は session/cookies を渡すだけ）。その際は `/setup` 自身と `/login`・`/incomplete` を除外し、area 以外は素通りさせること。**全ページで profiles＋offices の2クエリが増える**ため、ゲートが必要な期間（＝初回のみ）とのコスト比較のうえで判断してください。
- **`/setup` を直接開いた場合**: 既に完了していれば `/home` へ戻す（初回のみの画面のため）。
- **取得失敗**: ゲートでは**通す**（ホームを塞がない）。`/setup` 側でエラーを表示する。
  「未完だから表示」と「取得できなかった」を取り違えないため（`office_home_v0` の「取得失敗を握りつぶさない」規約）。
- **URL 形式**: 画面・保存口・**CHECK 制約の3層**で同一条件を検証（多層防御）。
  条件は `^https://drive\.google\.com/[A-Za-z0-9/_?=&%.-]+$`（URL安全文字のみ）＋改行なし（`strpos(...,chr(10))=0`）＋500文字以内。
  - 画面だけに置くと RPC 直叩きで素通りするため保存口にも同条件を、さらに postgres 直UPDATEにも効くよう CHECK にも同条件を持たせている。
  - **改行注入・HTMLメタ文字（`<>`）・過大長を弾く**：この値は出力の保存先 v0.3（Gドライブ保存）や帳票に埋め込まれるため、改行注入・不正コンテンツの芽を源流で断つ。
  - ⚠ 正規表現の落とし穴（実測で確認）: `\Z` は Postgres 非対応（リテラルZ扱い）、`[^\s]` はブラケット内でバックスラッシュがリテラル化し「s以外」になる（"folders" の s で正常URLを誤弾き）。→ 文字クラス allowlist ＋ 既定の `$`（文字列末尾）＋ `strpos` の改行チェックで構成した。
- **空文字も CHECK で作れない**（`offices_gdrive_folder_url_chk`）。未完の表現を **NULL のみ**に限定するため。
  空文字を許すと「ゲートは完了とみなして画面を出さないのに、area は `v_current is null` でしか保存できず直せない」宙づり状態が直UPDATEで作れてしまう。→ 不正な状態を表現できなくして根本から塞ぐ。
- **並行時の「初回のみ」保証（TOCTOU対策）**: 権限判定は事前チェック（明確なエラー用）に加え、
  **最終 UPDATE の WHERE に `(hq OR gdrive_folder_url IS NULL)` を落とし込み**、`row_count=0` を並行競合として拒否する。
  READ COMMITTED では同一行への2本目のUPDATEが1本目のcommit後に最新値でWHEREを再評価するため、
  先発が非NULLにした後の後発は0件更新になる＝read→writeの隙間に別リクエストが確定するレースでも「初回のみ」が保たれる。

## 範囲外

- `gdrive_folder_url` / `printer_model` の**消費本体**（出力の保存先 v0.3＝Gドライブ保存、印刷ブリッジ§15.3）。
- `printer_model` 列の追加（管理者設定で追加済み）／再編集（管理者設定§12.13）。
- `setup_completed` 専用フラグの新設（作らない）／拠点コード・タイムゾーン／営業所の新規作成そのもの。

## フォローアップ課題（本PR範囲外・明示的に積む）

- **⚠ hq の再編集口が UI に無い**: 権限設計では「hq＝常時・全営業所」だが、**現状 hq は
  `gdrive_folder_url` を UI から変更できない**。管理者設定（`/admin/settings`）にも `update_office_settings`
  RPC にもこの列が無いため、hq の変更は生SQLでしか行使できない（IT01 のプレースホルダ置換も同様）。
  → **`/admin/settings` に `gdrive_folder_url` 欄を追加**（`update_office_settings` に引数追加 or 専用RPC）。
  権限は既に `save_office_init_setup` が hq 常時可なので、UI から呼べば済む。
- **printer_model の許容値が2箇所ハードコード**（CHECK 制約と関数内 `not in (...)`）。機種追加時に不整合の芽。
  将来は許容値マスタ化 or 単一箇所参照に。
- **監査痕跡なし**（誰が・いつ初期設定したか）。一度きりの重要操作なので `updated_at`/`updated_by` 相当を将来検討。
  既存パターン踏襲であり本PR固有の後退ではない。

## 申し送り

- **`gdrive_folder_url` の消費側（Gドライブ保存）は未実装**です。この列は「保存先の指定」を持つだけで、実際にDriveへ書く仕組み（認可・アップロード）は出力の保存先 v0.3 の担当ですが、**そちらは Drive 認可基盤が存在せず方式選定で保留中**です。
  → **列に URL が入っていても、まだDriveには保存されません。**
- 上記のため、初期設定を「完了」にしても Drive 連携が動くわけではない点に注意（画面の文言では「保存先の指定」までを約束しています）。

## 検証

```bash
node supabase/office_init_setup_v0/pglite_test_office_init.mjs   # 43/43
node supabase/office_init_setup_v0/pglite_test_check_sql.mjs     #  8/8
cd apps/sort_nav_v0 && npx svelte-check   # 0 errors
cd apps/sort_nav_v0 && npm run build      # 成功
```
