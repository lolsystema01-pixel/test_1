<script lang="ts">
  // 【一時ページ】Storage RLS 実機確認（③ チェックリスト B-1）
  //   ボタン1つで、Storage API 経路の可視範囲を判定する。読み取りのみ（書き込みはしない）。
  //   ・A: 自営業所プレフィックスの list → 1件以上（塞ぎすぎていない）
  //   ・B: 他営業所プレフィックスの list → 0件（範囲外は見えない）
  //   ・C: 自営業所の実在パスを download → 成功
  //   ・D: 他営業所の実在パスを download → 失敗（← ここが本命）
  //   ※ D は「実在するパス」でないと意味がない（存在しない場合も同じ404になるため）。
  //     パスは SQL Editor で調べて貼り付ける（画面に手順あり）。
  let { data } = $props();
  let { supabase, officeCode } = $derived(data);

  const BUCKETS = ['carry-sheets', 'dispatch-sheets', 'godoor-csv'] as const;

  type Row = { name: string; expect: string; actual: string; judge: 'OK' | 'NG' | '—' };

  let otherOffice = $state('A01');
  let otherPath = $state(''); // 例: A01/2026-07-10/all.pdf
  let otherBucket = $state<string>('carry-sheets');
  let running = $state(false);
  let rows = $state<Row[]>([]);
  let ownPathFound = $state('');

  // 自営業所配下の実在ファイルを1つ探す（<office>/<日付>/<file>）
  async function findOwnFile(bucket: string): Promise<string | null> {
    const { data: folders } = await supabase.storage.from(bucket).list(officeCode, { limit: 20 });
    for (const f of folders ?? []) {
      const { data: files } = await supabase.storage.from(bucket).list(`${officeCode}/${f.name}`, { limit: 20 });
      const file = (files ?? []).find((x: { id: string | null }) => x.id !== null);
      if (file) return `${officeCode}/${f.name}/${file.name}`;
    }
    return null;
  }

  async function run() {
    running = true;
    rows = [];
    ownPathFound = '';
    const out: Row[] = [];

    for (const b of BUCKETS) {
      // A: 自営業所プレフィックス → 1件以上見える
      const own = await supabase.storage.from(b).list(officeCode, { limit: 100 });
      const ownCnt = own.data?.length ?? 0;
      out.push({
        name: `A [${b}] 自営業所 ${officeCode}/ の list`,
        expect: '1件以上',
        actual: own.error ? `エラー: ${own.error.message}` : `${ownCnt}件`,
        judge: !own.error && ownCnt > 0 ? 'OK' : ownCnt === 0 ? '—' : 'NG'
      });

      // B: 他営業所プレフィックス → 0件（RLSで行が消えるのでエラーではなく空になる）
      const other = await supabase.storage.from(b).list(otherOffice, { limit: 100 });
      const otherCnt = other.data?.length ?? 0;
      out.push({
        name: `B [${b}] 他営業所 ${otherOffice}/ の list`,
        expect: '0件',
        actual: other.error ? `エラー: ${other.error.message}` : `${otherCnt}件`,
        judge: otherCnt === 0 ? 'OK' : 'NG'
      });
    }

    // C: 自営業所の実在パスを download → 成功
    for (const b of BUCKETS) {
      const p = await findOwnFile(b);
      if (!p) continue;
      ownPathFound = `${b} : ${p}`;
      const { error } = await supabase.storage.from(b).download(p);
      out.push({
        name: `C [${b}] 自営業所パスを download（${p}）`,
        expect: '成功',
        actual: error ? `失敗: ${error.message}` : '成功',
        judge: error ? 'NG' : 'OK'
      });
      break; // 1バケットで足りる
    }

    // D: 他営業所の実在パスを download → 失敗（本命）
    if (otherPath.trim()) {
      const { error } = await supabase.storage.from(otherBucket).download(otherPath.trim());
      out.push({
        name: `D [${otherBucket}] 他営業所パスを download（${otherPath.trim()}）`,
        expect: '失敗（読めない）',
        actual: error ? `失敗: ${error.message}` : '★成功してしまった',
        judge: error ? 'OK' : 'NG'
      });
    } else {
      out.push({
        name: 'D 他営業所パスの download',
        expect: '失敗（読めない）',
        actual: '未実施（実在パスを入力してください）',
        judge: '—'
      });
    }

    rows = out;
    running = false;
  }

  const allOk = $derived(rows.length > 0 && rows.every((r) => r.judge === 'OK'));
  const anyNg = $derived(rows.some((r) => r.judge === 'NG'));
</script>

<section class="bar">
  <div><a href="/home" class="back">← 営業所ホーム</a> <strong>Storage RLS 実機確認</strong> <span class="office">{officeCode}</span></div>
  <span class="temp">一時ページ（確認後に削除）</span>
</section>

<section class="note">
  <p><strong>D の「他営業所パス」は、実在するパスでないと検証になりません。</strong>（存在しないパスは権限が無くても同じ 404 になるため）</p>
  <p>SQL Editor で実在パスを調べて、下に貼り付けてください：</p>
  <pre>select bucket_id, name from storage.objects
where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')
order by bucket_id, name;</pre>
  <p class="muted">自営業所（{officeCode}）以外で始まるパスを1つ選ぶ。例: <code>A01/2026-07-10/all.pdf</code></p>
</section>

<section class="form">
  <label>他営業所コード <input bind:value={otherOffice} placeholder="A01" /></label>
  <label>バケット
    <select bind:value={otherBucket}>
      {#each BUCKETS as b (b)}<option value={b}>{b}</option>{/each}
    </select>
  </label>
  <label class="wide">他営業所の実在パス <input bind:value={otherPath} placeholder="A01/2026-07-10/all.pdf" /></label>
  <button class="go" onclick={run} disabled={running}>{running ? '確認中…' : '確認する'}</button>
</section>

{#if rows.length > 0}
  <section class="verdict" class:ok={allOk} class:ng={anyNg}>
    {#if anyNg}⛔ NG があります。ポリシーを確認してください。
    {:else if allOk}✅ すべて OK（Storage API 経路でも自営業所のみ）
    {:else}△ 一部未実施（「—」の行）があります。{/if}
  </section>

  <table>
    <thead><tr><th>チェック</th><th>期待</th><th>実際</th><th>判定</th></tr></thead>
    <tbody>
      {#each rows as r (r.name)}
        <tr class:ng={r.judge === 'NG'} class:skip={r.judge === '—'}>
          <td>{r.name}</td><td>{r.expect}</td><td class="mono">{r.actual}</td>
          <td class="judge">{r.judge}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if ownPathFound}<p class="muted">自営業所の実在パス（自動検出）: <code>{ownPathFound}</code></p>{/if}
{/if}

<p class="muted small">
  ※ 読み取りのみ。書き込みは行いません。A が「0件」の場合は、まだ自営業所のPDF/CSVを保存していないだけです
  （/sheet /carry /godoor で一度保存してから再実行）。
</p>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
  .back { color: #0b7a4b; text-decoration: none; margin-right: 0.4rem; }
  .office { background: #0b7a4b; color: #fff; border-radius: 5px; padding: 0.05rem 0.5rem; font-size: 0.8rem; }
  .temp { background: #fff4e5; border: 1px solid #e08a00; color: #8a5300; border-radius: 5px; padding: 0.1rem 0.5rem; font-size: 0.78rem; }
  .note { background: #f4f8fc; border: 1px solid #bcd3ec; border-radius: 8px; padding: 0.7rem 1rem; margin-bottom: 0.8rem; font-size: 0.88rem; }
  .note p { margin: 0.2rem 0; }
  .note pre { background: #fff; border: 1px solid #dde; border-radius: 6px; padding: 0.5rem; font-size: 0.78rem; overflow-x: auto; }
  .form { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: end; margin-bottom: 1rem; }
  .form label { display: flex; flex-direction: column; font-size: 0.8rem; color: #555; gap: 0.2rem; }
  .form label.wide { flex: 1; min-width: 280px; }
  .form input, .form select { padding: 0.35rem 0.5rem; border: 1px solid #bbb; border-radius: 6px; }
  .go { background: #0b7a4b; color: #fff; border: none; border-radius: 6px; padding: 0.45rem 1.1rem; font-weight: 700; cursor: pointer; }
  .go:disabled { opacity: 0.6; cursor: not-allowed; }
  .verdict { border-radius: 8px; padding: 0.6rem 1rem; margin-bottom: 0.8rem; font-weight: 700; background: #f1f3f5; }
  .verdict.ok { background: #eaf6ee; color: #0b5a36; border: 1px solid #0b7a4b; }
  .verdict.ng { background: #fdecef; color: #8a0018; border: 1px solid #b00020; }
  table { width: 100%; border-collapse: collapse; font-size: 0.86rem; background: #fff; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; }
  th { color: #555; }
  tr.ng { background: #fdecef; }
  tr.skip { color: #999; }
  .judge { font-weight: 700; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.8rem; }
  .muted { color: #888; font-size: 0.82rem; }
  .small { font-size: 0.76rem; }
  code { background: #f1f3f5; padding: 0 0.25rem; border-radius: 3px; }
</style>
