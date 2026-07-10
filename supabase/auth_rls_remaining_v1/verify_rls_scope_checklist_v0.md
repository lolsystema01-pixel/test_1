# ③ 範囲外0件チェックリスト（機微テーブル×ロール・実機サインオフ用）

- 原則: **主張＝検証 1:1**。「範囲外0件」は必ず「範囲内>0件」と対で確認する（全部塞がっていても0件になるため）。
- 2段構え:
  - **(A) SQLなりすまし検証** … `verify_rls_scope_v0.sql` を SQL Editor で実行。`set local role authenticated`＋JWTクレームで**RLSを実際に効かせて**機械的に証明（rollbackで副作用なし）。
  - **(B) 実機ログイン検証** … Storage APIの実経路と最終サインオフ。SQLでは通らない層（supabase-js→PostgREST/Storage API）を潰す。
- 記入: 実施日・実施者・判定（☐→☒）。NGが出たら該当ポリシーを修正して再検証。

## 事前準備
- ☒ `storage_rls_all_buckets_v0.sql` 適用済み（①）
- ☒ 検証ユーザーが profiles に揃っている（hq／area=IT01／depot／driver=DRV001／shipper=SHIP01）
- ☒ 対象日に deliveries・Storage(3バケット)にデータがある

---

## (A) SQLなりすまし検証（verify_rls_scope_v0.sql）— **全ブロック合格**（2026/07/10）

> ⚠️ 実行時の注意: `set local` は同一トランザクション内でのみ有効。**`begin;` から `rollback;` まで丸ごと**
> 実行すること。途中の行だけを選択して Run すると postgres（RLSバイパス）のまま走り、範囲外が0にならない。
> 判定は結果の**先頭行「なりすまし確認」**で行う（`detail` に `area / IT01` 等が出れば効いている）。

| # | ブロック | 主張 | 対の確認（実測） | 判定 |
|---|---|---|---|---|
| A-1 | §1 area | deliveries/drivers/work_schedules/offices/print_history/index/log：**他営業所=0件** | 自営業所 deliveries 2548・drivers 9 | ☒ |
| A-2 | §1 area | hq限定8テーブル＝**全部0件**（`area_master_staging` は GRANT無し＝より強い） | hqで area_master 81196 を確認 | ☒ |
| A-3 | §1 area | profiles：他人=0件 | 自分=1件 | ☒ |
| A-4 | §1 area | Storage 3バケット：他営業所パス=**0件** | 自営業所パス 4件 | ☒ |
| A-5 | §2 driver | deliveries：他人の担当=0件／Storage=0件／drivers=self以外0件 | 自分の担当 241件 | ☒ |
| A-6 | §3 shipper | deliveries：他荷主=0件／drivers=0件／Storage=0件 | 自荷主 27件 | ☒ |
| A-7 | §4 depot | 配下営業所以外=0件（deliveries/offices/Storage） | 配下>0件 | ☒ |
| A-8 | §5 hq | 全件見える（塞ぎすぎていない） | deliveries 3413・drivers 12・area_master 81196・storage 10 | ☒ |
| A-9 | §6 書込 | 業務テーブルへの直接write＝全ロール拒否（対象9表とも write policy 0本） | 書込は SECURITY DEFINER 関数のみ | ☒ |

**可視範囲が hq ⊃ area ⊃ driver の部分集合になっており、数値に矛盾がない。**

## (B) 実機ログイン検証

### B-1 area（IT01でログイン → 仕分けナビ各画面）

**Storage API 経路の確認は一時ページ `/rlscheck` で実施した（実施後に削除済み）。**
DevTools コンソールから `supabase.storage...` を直接叩く方法は使えない
（アプリの Supabase クライアントはモジュールスコープにあり `window` に露出していないため）。

再検証したくなった場合の手順（ページを作り直す）:
1. SQL Editor で**実在パス**を調べる（存在しないパスは権限が無くても同じ404になり検証にならない）
   ```sql
   select bucket_id, name from storage.objects
   where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')
   order by bucket_id, name;
   ```
2. 自営業所(IT01)以外で始まるパスを1つ控える（例 `A01/2026-06-17/all.pdf`）
3. area でログインした状態のページ内から、ブラウザの Supabase クライアントで
   `storage.from(bucket).list(<他営業所>)` が **0件**、`download(<他営業所の実在パス>)` が **失敗**、
   自営業所の同操作が **成功** することを確認する

**実施日 2026/07/10 — 全8チェック OK（area/IT01）**

| 観点 | 期待 | 実際 | 判定 |
|---|---|---|---|
| `/rlscheck` A: 自営業所 `IT01/` の list（carry-sheets） | 1件以上 | 1件 | ☒ |
| `/rlscheck` B: 他営業所 `A01/` の list（carry-sheets） | 0件 | 0件 | ☒ |
| `/rlscheck` A: 自営業所 `IT01/` の list（dispatch-sheets） | 1件以上 | 1件 | ☒ |
| `/rlscheck` B: 他営業所 `A01/` の list（dispatch-sheets） | 0件 | 0件 | ☒ |
| `/rlscheck` A: 自営業所 `IT01/` の list（godoor-csv） | 1件以上 | 1件 | ☒ |
| `/rlscheck` B: 他営業所 `A01/` の list（godoor-csv） | 0件 | 0件 | ☒ |
| `/rlscheck` C: 自営業所の実在パスを download（`IT01/2026-07-04/all.pdf`） | 成功 | 成功 | ☒ |
| **`/rlscheck` D: 他営業所の実在パスを download（`A01/2026-06-17/all.pdf`）** | **失敗** | **失敗: Object not found** | ☒ |

**この検証が有効である根拠（主張=検証 1:1）**
- D のパスは SQL Editor（postgres＝RLSバイパス）で `storage.objects` を直接見て**実在を確認した**もの。
  よって「ファイルが無いから404」ではなく、**RLSが存在ごと隠している**（Supabase Storage は権限が無い場合、
  オブジェクトの存在を漏らさないため 404 を返す）。B の `A01/ list = 0件` とも整合。
- C で自営業所は download 成功しているため、「全部塞がっているから404」でもない。

> ✅ 確認完了後、一時ページ `apps/sort_nav_v0/src/routes/rlscheck/` は削除済み（本PRには含まれない）。

### B-2〜B-4 driver / shipper / hq / depot
これらのアプリは **帳票Storage（3バケット）を一切呼び出さない**（ドライバーアプリ・荷主ポータルに
Storage の導線が無い）。したがって「API経路で他営業所が読めるか」を試す UI が存在しない。

可視範囲の証明は **(A) SQLなりすまし検証で完了済み**（`verify_rls_scope_v0.sql`）:

| ロール | storage 範囲外 | データ範囲外 | 対（範囲内>0） | 判定 |
|---|---|---|---|---|
| driver (DRV001) | 3バケットすべて **0件** | 他人の担当 0件 | 自分の担当 241件 | ☒ |
| shipper (SHIP01) | 3バケットすべて **0件** | 他荷主 0件・drivers 0件 | 自荷主 27件 | ☒ |
| depot | 配下外 **0件** | 配下外 0件 | 配下 >0 | ☒ |
| hq | —（全office 10件見える） | — | area_master 81196 等 >0 | ☒ |

※ driver/shipper は `storage.objects` の RLS で3バケットとも 0件。API を呼んでも同じ RLS が適用されるため、
  B-1 と同じ結果になる（Supabase Storage は `storage.objects` の RLS を適用する）。

---

## ②の記録（address_master：今回の結論＝**dropしない**）
- コード監査（Fable独立監査）と実DBの `pg_proc.prosrc` 検索が**完全一致**。指示書の「参照が無ければdrop」の条件**不成立**。
- `audit_address_master_v0.sql` 実行結果（2026/07/10）:
  - ☒ **§1-1 参照関数**: `delivery_status_public(text)`（**SECURITY DEFINER**・anon公開）／`dispatch_build(date)`（配車エンジン）／`zone_rank(text,text)`（同一市判定）
  - ☒ **§2 旧語彙残置** `old_vocab_only` = **804行**（2026-06-17: 800／06-16: 4。すべて旧DSPダミー日付。実データは新語彙）→ 不合格
  - ☒ **§3 zone_plan 隣接の未知ID** = **13行すべて旧語彙** → zone_plan は丸ごと旧語彙 → 不合格
  - ☒ **§4 municipality非一意** = **8件**（うち3件 `GM2_07_07`／`HY4_12`／`KY3_NAK_186_195` は本物の複数自治体。CSV原本で確認）→ 不合格
- **落とし穴**: Postgres は関数本体の参照を `pg_depend` に記録しないため `drop table` は**エラー無しで成功**し、次の配車実行・顧客照会で初めて壊れる。参照確認は `pg_proc.prosrc` 検索で行うこと。
- 次のステップ（別指示書）: ゲート全合格 → 3関数を area_master 参照へ書換（`is_valid` フィルタ＋決定的 `order by`）→ pglite回帰＋実機 → drop。

## 実施記録
- 実施日: 2026 / 07 / 10
- 実施者: 業務A（Claude Code）＋ 業務B（実機・SQL Editor 実行）
- 事前検証: pglite storage 26/26・audit 9/9・verify_scope 11/11（計 **46/46 PASS**）
- 特記事項:
  - ③の検証SQLは当初「ブロック途中だけを実行すると postgres のまま走る」問題があり、
    1ブロック=1本のSELECT＋先頭行「なりすまし確認」＋OK/NG判定に改修（`5a7c500`）。
  - `area_master_staging` は `authenticated` に GRANT が無く素の `count(*)` が権限エラーで落ちたため、
    `pg_temp.safe_count()` で捕捉し `-1`（GRANT無し＝0件より強い防御）として合格判定に（`2cbb199`）。
  - 監査の副産物として `area_master` の文字化け（town_key破損13行）を検出。**本PRのスコープ外**として記録のみ。
