# 管理者設定 v0.1（§12.13）

営業所別の運用設定4項目（かご台車上限・かご振り順・自動ログアウト・印刷機種）の**設定の器＋編集画面**。
消費側（採番／認証／印刷）は参照のみで、本モジュールでは実装しない。

## 指示書との差分（PRで合意済み）

| 論点 | 指示書 | 本実装 | 理由 |
| --- | --- | --- | --- |
| 設定の器 | `office_settings` テーブルを新設（§14） | **`offices` に列追加**（`office_settings` は作らない） | **採番エンジン `renumber_build` が `offices` を直接読んでいる**。新テーブルを作ると「画面で編集しても採番に効かない」二重管理になる |
| 既定値 | `basket_capacity_max` 既定40（※GAS26=50 要確認） | **既存値は保持**（IT01=50/A01=10/C01=10）。列DEFAULTを50にし、**新規営業所のINSERTにのみ**適用 | 既存の運用値を壊さない。採番の `coalesce(...,50)` とも整合 |
| かご振り順のラベル | `ドライバー順`＝ドライバー登録順 | DB値は `ドライバー順` のまま、**画面ラベルを「担当件数の多い順」に改名** | 実装（`renumber_v0.sql:132` の `cnt desc`）は**担当件数の多い順**。実装を変えずにラベルを実態へ寄せる（用語集の更新を申し送り） |

### 列名の対応
| 指示書 | 本基盤 |
| --- | --- |
| `office_settings.basket_capacity_max` | `offices.basket_cart_limit`（既存） |
| `office_settings.basket_assign_order` | `offices.basket_order`（既存） |
| `office_settings.auto_logout_enabled` | `offices.auto_logout_enabled`（追加） |
| `office_settings.auto_logout_minutes` | `offices.auto_logout_minutes`（追加） |
| `office_settings.printer_model` | `offices.printer_model`（追加） |

## 実行順（Supabase SQL Editor・手動コピペ）
1. `office_settings_admin_v0.sql` … 3列追加＋CHECK制約＋新規営業所の既定50＋保存口 `update_office_settings`（SECURITY DEFINER・hqのみ）
2. `check_office_settings_v0.sql` … 保存・保持・CHECK・書込ポリシー0本・**hqのみ編集可**（なりすましで実証）

## 権限（本基盤の規約どおり）
- `offices` に **write policy は作らない**。書き込みは **SECURITY DEFINER 関数 `update_office_settings`** のみ。
- 編集は **hq** のみ（関数内で `my_role()='hq'` を検査）。
- 参照は既存の select ポリシー（hq=全件／depot=配下／area=自営業所）。

## 未設定（NULL）のときの既定
| 列 | NULL のときの扱い | 消費側 |
| --- | --- | --- |
| `basket_cart_limit` | **50**（`coalesce(...,50)`・1〜500にclamp） | 採番一式v0.5（**実装済み**） |
| `basket_order` | NOT NULL（既定 `ドライバー順`） | 採番一式v0.5（**実装済み**） |
| `auto_logout_enabled` | 既定 **有効** | 認証 §12.1（未実装・別書） |
| `auto_logout_minutes` | 既定 **30** | 認証 §12.1（未実装・別書） |
| `printer_model` | 既定 **Brother TD-2350** | 印刷ブリッジ §15.3（未実装・別書） |

## フロント
- ルート **`/admin/settings`**（sort_nav_v0）。`/home` の「5. 管理者設定」から遷移。
- **hq＝全営業所を編集**／**area＝自営業所を参照のみ**（RLSが範囲を絞る。明示フィルタなし）。
- 保存は `supabase.rpc('update_office_settings', …)`。空欄は「未設定に戻す」の意味。
- 「再読込」ボタンで保存値の保持を確認できる。

## 検証
- `node supabase/admin_settings_v0/pglite_test_admin_settings.mjs` … **20/20 PASS**
  - 既存の `basket_cart_limit` を保持（IT01=50/A01=10/C01=10）
  - 新規営業所だけ既定50／既存行は DEFAULT 変更の影響を受けない
  - CHECK（3択・1〜500・1〜600分・既知機種のみ・NULL許可）
  - `update_office_settings`：hq成功／area権限エラー／不正値を弾く／保存が反映される
  - `basket_order` に NULL を渡すと現在値を維持（NOT NULL 列の保護）
  - 未設定(NULL)が採番側で 50 に解決される（`greatest(1, least(500, coalesce(...,50)))`）
- フロント：`npx svelte-check`（0エラー）＋ `npm run build`（成功）

## 申し送り
- **用語集v0.1 の「ドライバー順」の定義を「担当件数の多い順」に更新**してください（リポジトリ外のドキュメント）。
  実装（`renumber_v0.sql:132`）は `cnt desc`＝担当件数の多い順で、指示書の「ドライバー登録順」とは異なります。
  登録順に変更したい場合は**採番本体の修正**になるため、別指示書で扱ってください。
- 自動ログアウト・印刷機種は**器のみ**。消費側（§12.1／§15.3）は未実装です。
