# ③ 範囲外0件チェックリスト（機微テーブル×ロール・実機サインオフ用）

- 原則: **主張＝検証 1:1**。「範囲外0件」は必ず「範囲内>0件」と対で確認する（全部塞がっていても0件になるため）。
- 2段構え:
  - **(A) SQLなりすまし検証** … `verify_rls_scope_v0.sql` を SQL Editor で実行。`set local role authenticated`＋JWTクレームで**RLSを実際に効かせて**機械的に証明（rollbackで副作用なし）。
  - **(B) 実機ログイン検証** … Storage APIの実経路と最終サインオフ。SQLでは通らない層（supabase-js→PostgREST/Storage API）を潰す。
- 記入: 実施日・実施者・判定（☐→☒）。NGが出たら該当ポリシーを修正して再検証。

## 事前準備
- ☐ `storage_rls_all_buckets_v0.sql` 適用済み（①）
- ☐ 検証ユーザーが profiles に揃っている（hq／area=IT01／area=A01（比較用）／depot／driver／shipper）
- ☐ 対象日に deliveries・Storage(3バケット)にデータがある（無ければ seed）

---

## (A) SQLなりすまし検証（verify_rls_scope_v0.sql）

| # | ブロック | 主張 | 対の確認 | 判定 |
|---|---|---|---|---|
| A-1 | §1 area | deliveries/drivers/work_schedules/offices/print_history/index/log：**他営業所=0件** | 自営業所>0件 | ☐ |
| A-2 | §1 area | hq限定8テーブル（area_master・zone_plan・renumber_plan・dispatch_*・shift_hours等）＝**全部0件** | —（hqで>0を確認） | ☐ |
| A-3 | §1 area | profiles：他人=0件 | 自分=1件 | ☐ |
| A-4 | §1 area | Storage 3バケット：他営業所パス=**0件** | 自営業所パス>0件 | ☐ |
| A-5 | §2 driver | deliveries：他人の担当=0件／Storage=0件／drivers=self以外0件 | 自分の担当>0件 | ☐ |
| A-6 | §3 shipper | deliveries：他荷主=0件／drivers=0件／Storage=0件 | 自荷主>0件 | ☐ |
| A-7 | §4 depot | 配下営業所以外=0件（deliveries/offices/Storage） | 配下>0件 | ☐ |
| A-8 | §5 hq | 全件見える（塞ぎすぎていない） | 各テーブル>0件 | ☐ |
| A-9 | §6 書込 | 業務テーブルへの直接write＝全ロール拒否（write policy 0本） | DEFINER関数経由は成功（既存機能） | ☐ |

## (B) 実機ログイン検証

### B-1 area（IT01でログイン → 仕分けナビ各画面）

**Storage API 経路の確認は一時ページ `/rlscheck` を使う**（ボタン1つで判定。読み取りのみ・書き込みなし）。
DevTools は不要。アプリの Supabase クライアントは `window` に露出していないため、コンソールから
`supabase.storage...` を直接叩くことはできない。

手順:
1. SQL Editor で**実在パス**を調べる（存在しないパスは権限が無くても同じ404になり検証にならない）
   ```sql
   select bucket_id, name from storage.objects
   where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')
   order by bucket_id, name;
   ```
2. 自営業所(IT01)以外で始まるパスを1つ控える（例 `A01/2026-07-10/all.pdf`）
3. area/IT01 でログイン → `/rlscheck` を開き、他営業所コード・バケット・実在パスを入力して「確認する」

| 観点 | 期待 | 判定 |
|---|---|---|
| /home /sort /sheet /carry /godoor /label | 自営業所のデータだけ表示される | ☐ |
| /sheet /carry /godoor の Storage保存 | 成功（自営業所パスに保存） | ☐ |
| `/rlscheck` A: 自営業所プレフィックスの list（3バケット） | 1件以上（塞ぎすぎていない） | ☐ |
| `/rlscheck` B: 他営業所プレフィックスの list（3バケット） | **0件** | ☐ |
| `/rlscheck` C: 自営業所の実在パスを download | 成功 | ☐ |
| **`/rlscheck` D: 他営業所の実在パスを download** | **失敗（Object not found 等）** ← 本命 | ☐ |
| 同日の再保存（upsert上書き） | 成功（update ポリシー） | ☐ |

> 確認が終わったら `apps/sort_nav_v0/src/routes/rlscheck/` は削除してよい（一時ページ）。

### B-2 driver（ドライバーアプリ）
| 観点 | 期待 | 判定 |
|---|---|---|
| 荷物一覧 | 自分の担当のみ | ☐ |
| 帳票Storage（console で download） | 全バケット拒否 | ☐ |

### B-3 shipper（荷主ポータル）
| 観点 | 期待 | 判定 |
|---|---|---|
| 取込/一覧 | 自荷主分のみ | ☐ |

### B-4 hq / depot（アカウントがあれば）
| 観点 | 期待 | 判定 |
|---|---|---|
| hq | 全officeのStorage/データが見える | ☐ |
| depot | 配下営業所のみ | ☐ |

---

## ②の記録（address_master：今回の結論）
- コード監査（Fable独立監査）: **参照あり**（`zone_rank`／`dispatch_build`／`delivery_status_public`=anon公開）→ 指示書の「参照が無ければdrop」の条件**不成立＝dropしない**。
- `audit_address_master_v0.sql` 実行結果の記録欄:
  - ☐ §1-1 参照関数の検出結果: ＿＿＿＿＿＿＿＿（期待: 上記3関数）
  - ☐ §2 旧語彙残置 old_vocab_only = ＿＿＿（0なら語彙ゲートA合格）
  - ☐ §3 zone_plan not_in_new = ＿＿＿／隣接未知ID = ＿＿＿行
  - ☐ §4 municipality非一意 = ＿＿＿行
- 次のステップ（別指示書）: ゲート全合格 → 3関数を area_master 参照へ書換（is_valid＋決定的order by）→ pglite回帰＋実機 → drop。

## 実施記録
- 実施日: 2026 / ＿＿ / ＿＿
- 実施者: ＿＿＿＿＿
- 特記事項: ＿＿＿＿＿
