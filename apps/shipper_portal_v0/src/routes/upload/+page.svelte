<script lang="ts">
  import { parseCsv } from '$lib/csv';

  let { data } = $props();

  // 正準フィールド（取込先）。* は必須。
  const FIELDS = [
    { key: 'tracking_number', label: '問合番号', required: true, hints: ['問合', '追跡', 'tracking', '番号'] },
    { key: 'address', label: '配送先住所', required: true, hints: ['住所', '配送先', 'address'] },
    { key: 'recipient_name', label: '氏名（配送先名）', required: false, hints: ['氏名', '宛名', '名前', 'recipient', 'name'] },
    { key: 'request_date', label: '依頼日', required: false, hints: ['依頼日', '日付', 'date'] },
    { key: 'note', label: '備考', required: false, hints: ['備考', 'メモ', 'note'] }
  ] as const;

  type FieldKey = (typeof FIELDS)[number]['key'];

  let fileName = $state('');
  let headers = $state<string[]>([]);
  let rows = $state<string[][]>([]);
  let mapping = $state<Record<FieldKey, number>>({
    tracking_number: -1,
    address: -1,
    recipient_name: -1,
    request_date: -1,
    note: -1
  });
  let parseError = $state('');
  let submitting = $state(false);
  let result = $state<null | {
    batch_id: string;
    csv_rows: number;
    valid_rows: number;
    unique_in_csv: number;
    csv_internal_dup_excluded: number;
    existing_dup_skipped: number;
    inserted: number;
    error_count: number;
    errors: { row_index: number; tracking_number: string | null; reason: string }[];
  }>(null);
  let apiError = $state('');

  function guessMapping() {
    const m: Record<FieldKey, number> = {
      tracking_number: -1, address: -1, recipient_name: -1, request_date: -1, note: -1
    };
    for (const f of FIELDS) {
      const idx = headers.findIndex((h) => f.hints.some((hint) => h.includes(hint)));
      m[f.key] = idx;
    }
    mapping = m;
  }

  async function onFile(e: Event) {
    parseError = '';
    result = null;
    apiError = '';
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    fileName = file.name;
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0) {
        parseError = 'CSV の中身が空、またはヘッダ行がありません。';
        headers = [];
        rows = [];
        return;
      }
      headers = parsed.headers;
      rows = parsed.rows;
      guessMapping();
    } catch (err) {
      parseError = `CSV の読み込みに失敗しました：${(err as Error).message}`;
    }
  }

  const requiredOk = $derived(mapping.tracking_number >= 0 && mapping.address >= 0);
  const previewRows = $derived(rows.slice(0, 5));

  function cell(row: string[], key: FieldKey): string {
    const idx = mapping[key];
    return idx >= 0 ? (row[idx] ?? '') : '';
  }

  async function submit() {
    if (!requiredOk || rows.length === 0) return;
    submitting = true;
    apiError = '';
    result = null;
    const payload = {
      rows: rows.map((r) => ({
        tracking_number: cell(r, 'tracking_number'),
        address: cell(r, 'address'),
        recipient_name: cell(r, 'recipient_name'),
        request_date: cell(r, 'request_date'),
        note: cell(r, 'note')
      }))
    };
    try {
      const res = await fetch('/api/v1/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      if (!res.ok) {
        apiError = body?.error?.message ?? `取込に失敗しました（HTTP ${res.status}）。`;
      } else {
        result = body.data;
      }
    } catch (err) {
      apiError = `送信に失敗しました：${(err as Error).message}`;
    } finally {
      submitting = false;
    }
  }
</script>

<section class="card">
  <div class="card-head">
    <div>
      <h1>CSVアップロード</h1>
      <p class="sub">自社荷物をCSVで登録します（荷主：{data.shipperName ?? data.shipperId}）。</p>
    </div>
    <form method="POST" action="/auth/signout">
      <button type="submit" class="signout">ログアウト</button>
    </form>
  </div>

  <nav class="tabs">
    <a class="tab" href="/">状況確認</a>
    <a class="tab active" href="/upload">CSVアップロード</a>
  </nav>
</section>

<section class="card">
  <h2>1. CSVファイルを選ぶ</h2>
  <input type="file" accept=".csv,text/csv" onchange={onFile} />
  {#if fileName}<p class="muted">選択中：{fileName}（{rows.length}行）</p>{/if}
  {#if parseError}<p class="error">{parseError}</p>{/if}
</section>

{#if headers.length > 0}
  <section class="card">
    <h2>2. 列のマッピング</h2>
    <p class="muted">CSVのどの列を取込先の項目に対応させるか選びます（<strong>*</strong> は必須）。</p>
    <div class="maprows">
      {#each FIELDS as f (f.key)}
        <label class="maprow">
          <span class="mlabel">{f.label}{#if f.required}<em>*</em>{/if}</span>
          <select bind:value={mapping[f.key]}>
            <option value={-1}>（対応なし）</option>
            {#each headers as h, i (i)}
              <option value={i}>{h}</option>
            {/each}
          </select>
        </label>
      {/each}
    </div>
    {#if !requiredOk}
      <p class="warn">問合番号・配送先住所の列を指定してください。</p>
    {/if}
  </section>

  <section class="card">
    <h2>3. プレビュー（先頭5行）</h2>
    <table class="preview">
      <thead>
        <tr><th>問合番号</th><th>住所</th><th>氏名</th><th>依頼日</th><th>備考</th></tr>
      </thead>
      <tbody>
        {#each previewRows as r, i (i)}
          <tr>
            <td>{cell(r, 'tracking_number') || '—'}</td>
            <td class="addr">{cell(r, 'address') || '—'}</td>
            <td>{cell(r, 'recipient_name') || '—'}</td>
            <td>{cell(r, 'request_date') || '—'}</td>
            <td>{cell(r, 'note') || '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <button class="primary" onclick={submit} disabled={!requiredOk || submitting}>
      {submitting ? '取込中…' : `取込を実行（${rows.length}行）`}
    </button>
    <p class="rls-note">※ 取込はサーバ側で実行され、自社（{data.shipperId}）の荷物として登録されます。問合番号で重複排除・取込直後は未配車。</p>
  </section>
{/if}

{#if apiError}
  <section class="card"><p class="error">{apiError}</p></section>
{/if}

{#if result}
  <section class="card">
    <h2>取込結果</h2>
    <p class="batch">取込バッチID：<code>{result.batch_id}</code></p>
    <table class="counts">
      <tbody>
        <tr><th>CSV行数</th><td>{result.csv_rows}</td></tr>
        <tr><th>有効行</th><td>{result.valid_rows}</td></tr>
        <tr class="hl"><th>取込（新規）</th><td>{result.inserted}</td></tr>
        <tr><th>CSV内重複の除外</th><td>{result.csv_internal_dup_excluded}</td></tr>
        <tr><th>既存重複でスキップ</th><td>{result.existing_dup_skipped}</td></tr>
        <tr><th>エラー行</th><td>{result.error_count}</td></tr>
      </tbody>
    </table>

    {#if result.errors.length > 0}
      <h3>エラー行（取込されません）</h3>
      <ul class="errors">
        {#each result.errors as e (e.row_index)}
          <li>{e.row_index + 1}行目：{e.reason}{#if e.tracking_number}（{e.tracking_number}）{/if}</li>
        {/each}
      </ul>
    {/if}

    <a class="link" href="/">→ 状況確認で取込結果を見る</a>
  </section>
{/if}

<style>
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
  }
  h3 {
    font-size: 0.9rem;
    margin: 1rem 0 0.5rem;
    color: #b00020;
  }
  .sub {
    color: #666;
    font-size: 0.85rem;
    margin: 0.25rem 0 0;
  }
  .muted {
    color: #666;
    font-size: 0.85rem;
  }
  .signout {
    background: #fff;
    color: #0b5cab;
    border: 1px solid #0b5cab;
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    border-bottom: 1px solid #eee;
  }
  .tab {
    padding: 0.5rem 0.85rem;
    text-decoration: none;
    color: #555;
    font-size: 0.9rem;
    border-bottom: 2px solid transparent;
  }
  .tab.active {
    color: #0b5cab;
    font-weight: 600;
    border-bottom-color: #0b5cab;
  }
  .maprows {
    display: grid;
    gap: 0.5rem;
  }
  .maprow {
    display: grid;
    grid-template-columns: 12rem 1fr;
    align-items: center;
    gap: 0.5rem;
  }
  .mlabel {
    font-size: 0.9rem;
    color: #444;
  }
  .mlabel em {
    color: #b00020;
    font-style: normal;
    margin-left: 0.15rem;
  }
  select {
    padding: 0.4rem 0.5rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.9rem;
    max-width: 22rem;
  }
  table.preview,
  table.counts {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    margin-bottom: 0.75rem;
  }
  .preview th,
  .preview td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid #eee;
  }
  .preview th {
    color: #777;
    font-size: 0.8rem;
  }
  .addr {
    max-width: 240px;
  }
  .counts th {
    text-align: left;
    color: #555;
    font-weight: 500;
    padding: 0.35rem 0.5rem;
    width: 12rem;
  }
  .counts td {
    padding: 0.35rem 0.5rem;
    font-weight: 600;
  }
  .counts tr.hl td,
  .counts tr.hl th {
    color: #0b5cab;
  }
  .primary {
    padding: 0.65rem 1.1rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: #fff;
    background: #0b5cab;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .warn {
    color: #9a6700;
    font-size: 0.85rem;
  }
  .error {
    color: #b00020;
    font-size: 0.9rem;
  }
  .errors {
    margin: 0;
    padding-left: 1.1rem;
    color: #b00020;
    font-size: 0.85rem;
  }
  .batch code {
    background: #f1f3f5;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
  }
  .rls-note {
    color: #999;
    font-size: 0.78rem;
    margin: 0.5rem 0 0;
  }
  .link {
    color: #0b5cab;
    font-size: 0.9rem;
  }
</style>
