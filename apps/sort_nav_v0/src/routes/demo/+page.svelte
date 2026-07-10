<script lang="ts">
  // 一連の流れデモ（仮・ローカル用）：dry-run→確認→実行 で 配車→採番(zone配達順)。
  //   ・本物の dispatch_build/renumber_build を SECURITY DEFINER 関数(demo_*)経由で実行。
  //   ・前提：demo_functions_v0.sql 適用＋取込＋②付与＋region_setup 済み。
  let { data } = $props();
  let { supabase } = $derived(data);

  let date = $state(data.date ?? '2026-07-04'); // 営業所ホームの予測対象日を引き継ぐ（?date=）
  let busy = $state('');
  let msg = $state('');
  let summary = $state<Record<string, number> | null>(null);
  let drivers = $state<{ driver_id: string; cnt: number }[]>([]);
  let driver = $state('');
  let rows = $state<
    { driver_id: string; delivery_order: number; common_id: string; zone_no: number | null; basket_code: string; address: string }[]
  >([]);

  // dry-run プレビュー結果（nullなら未実行）
  let dispatchPreview = $state<Record<string, number> | null>(null);
  let renumberPreview = $state<Record<string, number> | null>(null);

  async function rpc(fn: string, args: Record<string, unknown> = {}) {
    const { data: res, error } = await supabase.rpc(fn, { p_date: date, ...args });
    if (error) {
      const parts = [error.message, error.details, error.hint, error.code].filter(Boolean);
      throw new Error(parts.join(' ／ '));
    }
    return res;
  }

  async function refresh() {
    summary = ((await rpc('demo_summary')) as Record<string, number>) ?? null;
    drivers = ((await rpc('demo_drivers')) as { driver_id: string; cnt: number }[]) ?? [];
    if (driver && !drivers.some((x) => x.driver_id === driver)) driver = '';
    rows = ((await rpc('demo_delivery_order', { p_driver: driver || null, p_limit: 60 })) as typeof rows) ?? [];
  }

  async function act(label: string, work: () => Promise<void>) {
    busy = label;
    msg = '';
    try {
      await work();
    } catch (e) {
      msg = `${label} 失敗：${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = '';
    }
  }

  // ④ 配車：dry-run → 確認 → 実行
  const previewDispatch = () =>
    act('④ 配車 dry-run', async () => {
      dispatchPreview = (await rpc('demo_dispatch_preview')) as Record<string, number>;
      msg = '配車のプレビュー（未確定）。内容を確認して「配車を実行」を押してください。';
    });
  const commitDispatch = () =>
    act('④ 配車 実行', async () => {
      const r = await rpc('demo_dispatch');
      dispatchPreview = null;
      msg = `④ 配車を確定：${JSON.stringify(r)}`;
      await refresh();
    });

  // ⑤ 採番：dry-run → 確認 → 実行
  const previewRenumber = () =>
    act('⑤ 採番 dry-run', async () => {
      renumberPreview = (await rpc('demo_renumber_preview')) as Record<string, number>;
      msg = '採番のプレビュー（未確定）。「採番を実行」で配達順が確定します。';
    });
  const commitRenumber = () =>
    act('⑤ 採番 実行', async () => {
      const r = await rpc('demo_renumber');
      renumberPreview = null;
      msg = `⑤ 採番を確定：${JSON.stringify(r)}`;
      await refresh();
    });

  const reset = () =>
    act('リセット', async () => {
      await rpc('demo_reset');
      dispatchPreview = null;
      renumberPreview = null;
      msg = 'リセットしました（配車/採番前に戻しました）。';
      await refresh();
    });

  $effect(() => {
    date; // 対象日変更で再取得＋プレビュー破棄
    dispatchPreview = null;
    renumberPreview = null;
    refresh();
  });

  function zoneChanged(i: number): boolean {
    return i === 0 || rows[i].driver_id !== rows[i - 1].driver_id || rows[i].zone_no !== rows[i - 1].zone_no;
  }
</script>

<section class="bar no-print">
  <div><a href="/home" class="back">← 営業所ホーム</a> <strong>一連の流れデモ</strong></div>
  <div class="controls">
    <label>対象日 <input type="date" bind:value={date} /></label>
    <button class="go" onclick={previewDispatch} disabled={!!busy}>④ 配車 dry-run</button>
    <button class="go alt" onclick={previewRenumber} disabled={!!busy}>⑤ 採番 dry-run</button>
    <button class="reset" onclick={reset} disabled={!!busy}>リセット</button>
  </div>
</section>

{#if msg}<p class="msg no-print">{msg}</p>{/if}

<!-- ④ 配車プレビュー → 確認 → 実行 -->
{#if dispatchPreview}
  <section class="preview no-print">
    <h3>④ 配車プレビュー（未確定）</h3>
    <p>
      割当 <strong>{dispatchPreview.to_dispatch}</strong> 件
      ／ 実ドライバー {dispatchPreview.real_count}名に {dispatchPreview.real_assigned}件
      ／ 仮ドライバー {dispatchPreview.virtual_count}名に {dispatchPreview.virtual_assigned}件
    </p>
    <div class="pbtn">
      <button class="go" onclick={commitDispatch} disabled={!!busy}>この内容で配車を実行</button>
      <button class="cancel" onclick={() => (dispatchPreview = null)} disabled={!!busy}>取消</button>
    </div>
  </section>
{/if}

<!-- ⑤ 採番プレビュー → 確認 → 実行 -->
{#if renumberPreview}
  <section class="preview no-print blue">
    <h3>⑤ 採番プレビュー（未確定）</h3>
    <p>
      配達順を <strong>{renumberPreview.plan_rows}</strong> 件（{renumberPreview.drivers}ドライバー）分 計算しました。
      「採番を実行」で確定し、下の表に反映されます。
    </p>
    <div class="pbtn">
      <button class="go alt" onclick={commitRenumber} disabled={!!busy}>採番を実行</button>
      <button class="cancel" onclick={() => (renumberPreview = null)} disabled={!!busy}>取消</button>
    </div>
  </section>
{/if}

<section class="cards">
  <div class="card"><span class="k">取込</span><span class="v">{summary?.total ?? '—'}</span></div>
  <div class="card"><span class="k">共通ID付与</span><span class="v">{summary?.with_common ?? '—'}</span></div>
  <div class="card"><span class="k">ゾーン番号</span><span class="v">{summary?.with_zone ?? '—'}</span></div>
  <div class="card hl"><span class="k">配車済</span><span class="v">{summary?.dispatched ?? '—'}</span></div>
  <div class="card hl"><span class="k">採番</span><span class="v">{summary?.numbered ?? '—'}</span></div>
  <div class="card"><span class="k">保留</span><span class="v">{summary?.held ?? '—'}</span></div>
</section>

<section class="table-wrap">
  <div class="tbar">
    <h2>配達順（ゾーン番号順）</h2>
    <label>ドライバー
      <select bind:value={driver} onchange={refresh}>
        <option value="">全員</option>
        {#each drivers as d (d.driver_id)}<option value={d.driver_id}>{d.driver_id}（{d.cnt}）</option>{/each}
      </select>
    </label>
  </div>
  {#if rows.length > 0}
    <table>
      <thead>
        <tr><th>ドライバー</th><th>配達順</th><th>共通ID</th><th>ゾーン</th><th>かご</th><th>住所</th></tr>
      </thead>
      <tbody>
        {#each rows as r, i (r.driver_id + '-' + r.delivery_order)}
          <tr class:zonebreak={zoneChanged(i)}>
            <td class="mono">{r.driver_id}</td>
            <td class="mono">{r.delivery_order}</td>
            <td class="mono sm">{r.common_id}</td>
            <td class="zone">{r.zone_no ?? '—'}</td>
            <td class="mono">{r.basket_code}</td>
            <td class="addr">{r.address}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted">配達順データがありません。「④ 配車 dry-run」→確認→実行 →「⑤ 採番 dry-run」→確認→実行 の順で押してください。</p>
  {/if}
</section>

<p class="note no-print">
  ※ ローカルデモ用（仮）。dry-run（プレビュー・未確定）→ 確認 → 実行（確定）。本物の dispatch_build / renumber_build(zone版) を demo_* 経由で実行。
  前提：<code>demo_functions_v0.sql</code> 適用＋取込＋②付与＋region_setup 済み。
</p>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; gap: 1rem; flex-wrap: wrap; }
  .back { color: #0b7a4b; text-decoration: none; margin-right: 0.5rem; }
  .controls { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .go { background: #0b7a4b; color: #fff; border: none; border-radius: 6px; padding: 0.45rem 1rem; font-weight: 700; cursor: pointer; }
  .go.alt { background: #0b5cab; }
  .reset { background: #fff; border: 1px solid #b00020; color: #b00020; border-radius: 6px; padding: 0.45rem 0.8rem; cursor: pointer; }
  .cancel { background: #fff; border: 1px solid #999; color: #555; border-radius: 6px; padding: 0.45rem 0.8rem; cursor: pointer; }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  .msg { color: #0b5a36; font-size: 0.9rem; }
  .preview { background: #eef7f1; border: 1px solid #0b7a4b; border-radius: 8px; padding: 0.7rem 1rem; margin-bottom: 1rem; }
  .preview.blue { background: #eaf1fb; border-color: #0b5cab; }
  .preview h3 { margin: 0 0 0.3rem; font-size: 0.98rem; }
  .preview p { margin: 0 0 0.6rem; font-size: 0.92rem; }
  .pbtn { display: flex; gap: 0.6rem; }
  .cards { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 0.6rem 0.9rem; min-width: 92px; display: flex; flex-direction: column; }
  .card.hl { border-color: #0b7a4b; }
  .card .k { font-size: 0.78rem; color: #666; }
  .card .v { font-size: 1.4rem; font-weight: 700; color: #0b7a4b; }
  .table-wrap { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 0.6rem 0.9rem; }
  .tbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
  h2 { font-size: 1rem; margin: 0.2rem 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th, td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #eee; }
  th { color: #555; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .sm { font-size: 0.8rem; color: #555; }
  .zone { font-weight: 700; color: #0b5cab; }
  .addr { color: #333; }
  tr.zonebreak td { border-top: 2px solid #0b7a4b; }
  .muted { color: #777; }
  .note { color: #888; font-size: 0.78rem; margin-top: 0.8rem; }
  .note code { background: #f1f3f5; padding: 0 0.25rem; border-radius: 3px; }
</style>
