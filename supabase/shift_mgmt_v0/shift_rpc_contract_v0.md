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
// 既に申請済み（二重申請）
{ "result": "already", "id": 123, "driver_id": "DRV001",
  "work_date": "2026-08-01", "work_type": "フル" }
```

**エラー**

| code | 意味 |
|---|---|
| `42501` | driver 本人でない（role≠driver / my_driver()=null） |
| `22023` | work_type 空 ／ 申請可能期間外（過去日・request_period_days 超） |
| `P0002` | ドライバーの所属営業所が解決できない |

**冪等性**: 同一 `(driver, date, work_type)` の再呼び出しは `already`（行は増えない）。

---

## 2. `approve_reject_shift` — 承認/却下（営業所）

| 項目 | 内容 |
|---|---|
| 呼ぶ人 | **area**（`my_role()='area'`） |
| 引数 | `p_id bigint`（対象 work_schedules.id）／`p_decision text`（`'承認'` \| `'却下'`） |
| 認可 | 対象の `driver_id` が `my_office_drivers()` 配下のみ（他営業所は拒否） |
| 遷移 | `申請中 → 承認` / `申請中 → 却下` のみ。既に承認/却下済みは不可 |

**RPC 例**
```ts
const { data, error } = await supabase.rpc('approve_reject_shift', { p_id: 123, p_decision: '承認' });
```

**戻り値**
```jsonc
{ "result": "decided", "id": 123, "driver_id": "DRV001", "status": "承認" }
```

**エラー**

| code | 意味 |
|---|---|
| `42501` | area でない ／ 対象が自営業所の配下でない |
| `23514` | decision が 承認/却下 以外 ／ 対象が「申請中」でない（既に確定済み） |
| `P0002` | 対象 id が存在しない |

**冪等性**: 承認済みを再度 `承認` で呼ぶと `23514`（申請中のみ遷移可）。二重承認は起きない。

---

## 3. `office_direct_shift` — 直接入力（営業所・フォールバック）

| 項目 | 内容 |
|---|---|
| 呼ぶ人 | **area**（`my_role()='area'`） |
| 引数 | `p_driver_id text`（必須）／`p_work_date date`（必須）／`p_work_type text`（必須）／`p_preferred_areas text[]`（任意） |
| 認可 | `p_driver_id` が `my_office_drivers()` 配下のみ |
| 登録 | **承認状態**で直接登録（アプリ未使用者・訂正用）。二重登録防止 |

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
// 既に登録済み
{ "result": "already", "id": 124, "driver_id": "DRV002",
  "work_date": "2026-08-01", "work_type": "フル" }
```

**エラー**

| code | 意味 |
|---|---|
| `42501` | area でない ／ 対象ドライバーが自営業所の配下でない |
| `22023` | work_type 空 |

**冪等性**: 同一 `(driver, date, work_type)` の再呼び出しは `already`。

---

## 共通事項

### 希望エリア（`preferred_areas`）
- **値は common_id の配列**で保存する（例 `['OKZ_C_01_06', 'GM2_07_07']`）。配車 #28（主担当ゾーン優先）・#29（突合）が**同じ common_id** で照合する。
- **表示名の解決は #28 の表示名解決ビュー依存**。⚠ **#28 未実装のため、現状は common_id そのものしか出せない**（人間可読なエリア名は #28 完成後）。フロントは当面 common_id を選択肢に出すか、#28 完成まで希望エリア入力を保留する。
- 配列要素の妥当性（NULL要素なし・空文字なし・重複なし）は `work_schedules` の CHECK（`preferred_areas_ok`）が保証する。違反は `23514` 相当で弾かれる。

### 稼働区分ラベル（`work_type`）と cap
- `work_type` は営業所別マスタ `shift_labels(office_code, work_type)` に定義された値。**未定義のラベルで承認済み稼働があると、配車 `dispatch_build` が名指しエラーで停止する**（フォールバックしない・§`shift_labels_office_v0.sql`）。
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
- `shift_labels`: hq=全 / area=自営業所のみ。
