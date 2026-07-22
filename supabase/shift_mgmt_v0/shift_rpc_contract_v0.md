# シフト書き込み口 I/O 仕様書 v0.7（RPC契約）

指示書「シフト管理（DB＋書き込み口・フロント抜き）v0.7」の成果物。
**ドライバーアプリ（ネイティブ担当）／営業所フロント（別担当）が、この3関数を Supabase RPC で直接叩く**ための契約。

- 呼び出しは `supabase.rpc('<関数名>', { <引数> })`（anonキー＋ログインセッション）。
- **認可は関数内（DEFINER）で強制**。RPC 直叩きでも門番が効く。`work_schedules` に write policy は無い＝**書けるのはこの3関数のみ**。
- なりすまし防止: `apply_shift` は `driver_id` を引数で受けず `my_driver()` から取る。承認/直接入力は area が対象を指定するが `my_office_drivers()` 配下のみ。
- 戻り値は `jsonb`。成功は例外なし＋`result` フィールドで分岐。失敗は Postgres エラー（`code`/`message`）。

---

## 1. `apply_shift` — 稼働申請（ドライバー本人）

| 項目 | 内容 |
|---|---|
| 呼ぶ人 | **driver 本人**（`my_role()='driver'`） |
| 引数 | `p_work_date date`（必須）／`p_work_type text`（必須・稼働区分ラベル）／`p_preferred_areas text[]`（任意・希望エリア=common_id配列） |
| 認可 | `my_driver()` 本人。driver_id は**引数で受けない**（なりすまし防止） |
| 期間 | `p_work_date` が `[today, today + offices.request_period_days]` の将来日。`request_period_days` が NULL の営業所は無制限 |
| 二重申請 | 同一 `(driver_id, work_date, work_type)` が既にあれば登録せず `already` |

**RPC 例**
```ts
const { data, error } = await supabase.rpc('apply_shift', {
  p_work_date: '2026-08-01',
  p_work_type: 'フル',
  p_preferred_areas: ['OKZ_C_01_06', 'GM2_07_07']  // 省略可
});
```

**戻り値**
```jsonc
// 新規申請
{ "result": "applied", "id": 123, "driver_id": "DRV001",
  "work_date": "2026-08-01", "work_type": "フル", "status": "申請中" }
// 既にその日に申請/承認あり（1日1稼働＝二重申請扱い）
{ "result": "already", "id": 123, "driver_id": "DRV001",
  "work_date": "2026-08-01", "work_type": "フル", "status": "申請中" }
// その日が「却下」だった → 本人が再申請でき、申請中に戻る（work_type/希望も更新）
{ "result": "reapplied", "id": 123, "driver_id": "DRV001",
  "work_date": "2026-08-01", "work_type": "6時間", "status": "申請中" }
```

**エラー**

| code | 意味 |
|---|---|
| `42501` | driver 本人でない（role≠driver / my_driver()=null） |
| `22023` | work_type 空 ／ 申請可能期間外（過去日・request_period_days 超） |
| `23505` | 同一 `(driver, date)` の同時申請が競合（1日1稼働 UNIQUE）。再試行すれば `already` に収束＝再送安全 |
| `P0002` | ドライバーの所属営業所が解決できない ／ **稼働区分が自営業所の `shift_labels` に未定義**（先に管理者設定で登録が必要・再送しても直らない） |

**冪等性・1日1稼働**: 判定キーは **`(driver, date)`**（work_type は問わない）。同一日に既に「申請中/承認」があれば `already`（行は増えない）。**「却下」だった場合のみ本人の再申請を許し**、同じ行を `申請中` に戻す（`reapplied`）。
DB 制約 `UNIQUE(driver_id, work_date)` が「1日1稼働」を保証する（別 work_type での二重行は作れない＝配車 `dispatch_build` が同一ドライバー2 cap で 23505 停止するのを構造的に防ぐ）。

---

## 2. `approve_reject_shift` — 承認/却下（営業所）

| 項目 | 内容 |
|---|---|
| 呼ぶ人 | **area**（`my_role()='area'`） |
| 引数 | `p_id bigint`（対象 work_schedules.id）／`p_decision text`（`'承認'` \| `'却下'`） |
| 認可 | 対象の `driver_id` が `my_office_drivers()` 配下のみ（他営業所は拒否） |
| 遷移 | `申請中 → 承認` / `申請中 → 却下` のみ。既確定は下記の冪等ルール |

**RPC 例**
```ts
const { data, error } = await supabase.rpc('approve_reject_shift', { p_id: 123, p_decision: '承認' });
```

**戻り値**
```jsonc
// 申請中 → 承認/却下
{ "result": "decided", "id": 123, "driver_id": "DRV001", "status": "承認" }
// 既に「同じ決定」で確定済み（再送）＝成功扱い（apply/office_direct と対称）
{ "result": "already", "id": 123, "driver_id": "DRV001", "status": "承認" }
```

**エラー**

| code | 意味 |
|---|---|
| `42501` | area でない ／ 対象が**見つからない・自営業所の配下でない**（両者を同一に畳む＝id 存在オラクル回避） |
| `22023` | decision が 承認/却下 以外（**入力値エラー**） |
| `23514` | 既に**別の**決定で確定済み（例: 承認済みを却下へ変更）＝**状態競合・再送してはならない** |
| `P0002` | **承認**しようとした稼働区分がその営業所の `shift_labels` に未定義（承認時のみ・**却下は対象外**）。先に登録が必要・再送しても直らない |

**冪等性（★消費側の再送キューはこの表どおりに分類）**: 既確定の再送は「**同じ決定なら `result:'already'`（成功扱い・再送安全）**／別の決定なら `23514`（競合・再送不可）」。apply/office_direct の `already` と対称。**23514/42501 受領時は恒久失敗として扱い再送しない**（1回目が瞬断で成功していても、同一決定の再送は `already` で成功が返るため誤表示にならない）。

---

## 3. `office_direct_shift` — 直接入力（営業所・フォールバック）

| 項目 | 内容 |
|---|---|
| 呼ぶ人 | **area**（`my_role()='area'`） |
| 引数 | `p_driver_id text`（必須）／`p_work_date date`（必須）／`p_work_type text`（必須）／`p_preferred_areas text[]`（任意） |
| 認可 | `p_driver_id` が `my_office_drivers()` 配下のみ。`p_driver_id` 空/NULL は認可判定の前に `22023` で弾く |
| 登録 | **承認状態**で直接登録（アプリ未使用者・訂正用）。1日1稼働（`(driver, date)` で二重登録防止） |

**RPC 例**
```ts
const { data, error } = await supabase.rpc('office_direct_shift', {
  p_driver_id: 'DRV002', p_work_date: '2026-08-01', p_work_type: 'フル'
});
```

**戻り値**
```jsonc
{ "result": "registered", "id": 124, "driver_id": "DRV002",
  "work_date": "2026-08-01", "work_type": "フル", "status": "承認" }
// 既にその日に登録あり（申請中/承認）
{ "result": "already", "id": 124, "driver_id": "DRV002",
  "work_date": "2026-08-01", "work_type": "フル", "status": "承認" }
// その日が「却下」だった → 承認で上書き（訂正用に再登録）
{ "result": "registered", "id": 124, "driver_id": "DRV002",
  "work_date": "2026-08-01", "work_type": "フル", "status": "承認" }
```

**エラー**

| code | 意味 |
|---|---|
| `42501` | area でない ／ 対象ドライバーが自営業所の配下でない |
| `22023` | driver_id 空/NULL ／ work_type 空 |
| `23505` | 同一 `(driver, date)` の同時登録が競合（1日1稼働 UNIQUE）。再試行すれば `already` に収束＝再送安全 |
| `P0002` | 稼働区分がその営業所の `shift_labels` に未定義（直接登録＝即承認のため入口で弾く）。先に登録が必要・再送しても直らない |

**冪等性・1日1稼働**: 判定キーは **`(driver, date)`**。同一日に既に「申請中/承認」があれば `already`。**「却下」だった場合のみ承認で上書き**（訂正用に却下を戻せる）。UNIQUE(driver_id, work_date) と同キー。

---

## 共通事項

### 希望エリア（`preferred_areas`）
- **値は common_id の配列**で保存する（例 `['OKZ_C_01_06', 'GM2_07_07']`）。配車 #28（主担当ゾーン優先）・#29（突合）が**同じ common_id** で照合する。
- **表示名の解決は #28 の表示名解決ビュー依存**。⚠ **#28 未実装のため、現状は common_id そのものしか出せない**（人間可読なエリア名は #28 完成後）。フロントは当面 common_id を選択肢に出すか、#28 完成まで希望エリア入力を保留する。
- 配列要素の妥当性（NULL要素なし・空文字なし・重複なし）は `work_schedules` の CHECK（`preferred_areas_ok`）が保証する。違反は `23514` 相当で弾かれる。

### 稼働区分ラベル（`work_type`）と cap
- `work_type` は営業所別マスタ `shift_labels(office_code, work_type)` に定義された値。
- **未定義のラベルは書き込み口が入口で弾く（`P0002`）**：apply（申請時）・approve（承認時）・office_direct（直接登録時）はいずれも「その営業所に稼働区分が定義済みか」を確認し、未定義なら**その1操作だけ**を止める（承認済みに入れない＝配車が壊れる状態を作らない）。**却下は対象外**（配車に載らないため）。
- **配車 `dispatch_build` の事前チェックは最後の砦**：直接SQL・移行スクリプトが入口を迂回して未定義ラベルの承認済み稼働を作った場合に限り、`dispatch_build` が名指しで停止する（フォールバックしない・二重の守り）。
- 8.7 申請画面は work_type 選択肢を `shift_labels`（driver 読取）から出すので、通常フローでは未定義を選べない。上記 `P0002` は raw RPC・ラベル削除後の承認など**入口を通らない/後から状態が変わった**場合の保険。
- 新設営業所は `seed_office_shift_labels(office_code)`（hqのみ）で標準ラベルを配布できる（自動実行しない）。

### 欠勤（`is_absent`）
- `work_schedules.is_absent` 列は用意済み（承認済みでも欠勤を記録する土台）。**cap 集計への反映は未実装**（v0.7 は器のみ・消費側は将来）。

### headcount（配車入力）
- 「承認済みを営業所×日付で人数」＝配車の入力。集計は消費側（配車 #25）が下記で取る:
```sql
select count(distinct ws.driver_id) as headcount
from public.work_schedules ws join public.drivers d on d.driver_id = ws.driver_id
where d.office_code = :office and ws.work_date = :date and ws.application_status = '承認';
```

### 読取 RLS（参照範囲）
- `work_schedules`: hq=全 / area=自営業所所属ドライバー分 / driver=自分のみ（既存 rls_v0）。
- `shift_labels`: hq=全 / area=自営業所 / **driver=自分の営業所**。**8.7 稼働申請画面の work_type 選択肢は、この driver 読取で `select work_type from shift_labels`（自営業所ぶん）を引いて出す**（営業所別に自由編集可のため、固定リストではなくこの口から取る）。
