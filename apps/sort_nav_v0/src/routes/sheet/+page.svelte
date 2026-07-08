<script lang="ts">
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';

  let { data } = $props();
  let { supabase } = $derived(data);

  type Row = {
    driver_id: string;
    delivery_order: number | null;
    basket_code: string | null;
    tracking_number: string;
    address: string | null;
    recipient_name: string | null;
    time_window: string | null;
    status: string | null;
    is_sorted: boolean | null;
  };
  type Summary = { driver_id: string; total: number; sorted: number; unsorted: number };

  let isPost = $derived(data.mode === 'post');

  // ドライバー別グループ。仕分後は「仕分済の行だけ」に絞る（§12.10.1 v0.3）。
  let groups = $derived.by(() => {
    const m = new Map<string, Row[]>();
    for (const r of data.rows as Row[]) {
      if (isPost && !r.is_sorted) continue; // 仕分後＝仕分済の行のみ（未仕分の明細は出さない）
      const a = m.get(r.driver_id) ?? [];
      a.push(r);
      m.set(r.driver_id, a);
    }
    return [...m.entries()].map(([driver_id, rows]) => ({ driver_id, rows }));
  });

  let summaryMap = $derived(new Map((data.summary as Summary[]).map((s) => [s.driver_id, s])));

  // 未仕分残数サマリ（仕分後のみ）：ドライバー別「未仕分 残N件」＋全体合計。
  let unsortedList = $derived(
    (data.summary as Summary[]).filter((s) => s.unsorted > 0).sort((a, b) => a.driver_id.localeCompare(b.driver_id))
  );
  let unsortedTotal = $derived((data.summary as Summary[]).reduce((n, s) => n + s.unsorted, 0));

  let busy = $state(false);
  let uploadMsg = $state('');
  let showDialog = $state(false);

  function setMode(mode: 'pre' | 'post') {
    goto(`/sheet?date=${data.date}&mode=${mode}`, { keepFocus: true });
  }
  function onDate(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (v) goto(`/sheet?date=${v}&mode=${data.mode}`);
  }

  // 出力ボタン → モード選択ダイアログ（迷ったら仕分後推奨・§12.10.1）
  function onPdfClick() {
    showDialog = true;
  }
  async function chooseMode(mode: 'pre' | 'post') {
    showDialog = false;
    if (data.mode !== mode) {
      await goto(`/sheet?date=${data.date}&mode=${mode}`, { keepFocus: true });
      await tick();
    }
    await makePdf();
  }

  // PDF生成：ドライバーごと（＋仕分後は先頭に未仕分残数サマリ）を画像化して1ページずつ。
  async function makePdf() {
    busy = true;
    uploadMsg = '';
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const sections = Array.from(document.querySelectorAll<HTMLElement>('.pdf-section'));
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const iw = pw - margin * 2;
      const contentH = ph - margin * 2;
      let firstPage = true;
      for (const section of sections) {
        const canvas = await html2canvas(section, { scale: 2, backgroundColor: '#ffffff' });
        const ratio = iw / canvas.width;
        const sliceHpx = Math.floor(contentH / ratio);
        let y = 0;
        while (y < canvas.height) {
          const hpx = Math.min(sliceHpx, canvas.height - y);
          const slice = document.createElement('canvas');
          slice.width = canvas.width;
          slice.height = hpx;
          slice.getContext('2d')?.drawImage(canvas, 0, y, canvas.width, hpx, 0, 0, canvas.width, hpx);
          const img = slice.toDataURL('image/jpeg', 0.72);
          if (!firstPage) pdf.addPage();
          pdf.addImage(img, 'JPEG', margin, margin, iw, hpx * ratio);
          firstPage = false;
          y += hpx;
        }
      }
      const modeJa = isPost ? '仕分後' : '仕分前';
      pdf.save(`配車表_${data.officeCode}_${data.date}_${modeJa}.pdf`);

      const blob = pdf.output('blob');
      const path = `${data.officeCode}/${data.date}/${data.mode}.pdf`;
      const { error } = await supabase.storage
        .from('dispatch-sheets')
        .upload(path, blob, { contentType: 'application/pdf', upsert: true });
      uploadMsg = error ? `Storage保存に失敗: ${error.message}` : `Storage保存OK（${modeJa}）: ${path}`;
    } catch (e) {
      uploadMsg = `PDF生成に失敗: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }
</script>

<section class="bar no-print">
  <div>
    <a href="/sort" class="back">← 仕分けナビ</a>
    <strong>配車表PDF</strong>
  </div>
  <div class="controls">
    <label>対象日 <input type="date" value={data.date} onchange={onDate} /></label>
    <div class="modes">
      <button class:active={!isPost} onclick={() => setMode('pre')}>仕分前</button>
      <button class:active={isPost} onclick={() => setMode('post')}>仕分後</button>
    </div>
    <button class="pdf" onclick={onPdfClick} disabled={busy}>{busy ? '生成中…' : 'PDF保存'}</button>
  </div>
</section>

{#if showDialog}
  <div class="dialog-backdrop no-print" role="dialog" aria-modal="true">
    <div class="dialog">
      <h3>どちらのモードで出力しますか？</h3>
      <p class="hint">迷ったら「仕分後」を推奨します（§12.10.1）。</p>
      <div class="dbtns">
        <button class="rec" onclick={() => chooseMode('post')}>仕分後で出力（推奨）</button>
        <button class="sub" onclick={() => chooseMode('pre')}>仕分前で出力</button>
        <button class="cancel" onclick={() => (showDialog = false)}>キャンセル</button>
      </div>
    </div>
  </div>
{/if}

{#if data.loadError}<p class="error no-print">取得に失敗：{data.loadError}</p>{/if}
{#if uploadMsg}<p class="msg no-print">{uploadMsg}</p>{/if}

{#if groups.length === 0 && !isPost}
  <p class="muted no-print">対象日（{data.date}）の対象がありません。</p>
{/if}

<div class="sheets">
  <!-- 仕分後：先頭に未仕分残数サマリ（ドライバー別＋合計）。PDFにも入る。 -->
  {#if isPost}
    <section class="driver-section pdf-section">
      <header class="sheet-head">
        <div class="h-left">
          <div class="h-title">未仕分 残数サマリ（仕分後）</div>
          <div class="h-sub">日付 {data.date} ／ 営業所 {data.officeCode}</div>
        </div>
        <div class="h-counts"><span class="unsorted">未仕分 残 合計 <strong>{unsortedTotal}</strong> 件</span></div>
      </header>
      {#if unsortedList.length > 0}
        <table class="sheet">
          <thead><tr><th>ドライバー</th><th>未仕分 残</th><th>仕分済</th><th>総数</th></tr></thead>
          <tbody>
            {#each unsortedList as s (s.driver_id)}
              <tr><td>{s.driver_id}</td><td class="num unsorted"><strong>{s.unsorted}</strong></td><td class="num">{s.sorted}</td><td class="num">{s.total}</td></tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted">未仕分の残はありません（全件 仕分済）。</p>
      {/if}
    </section>
  {/if}

  {#if isPost && groups.length === 0}
    <p class="muted no-print">仕分済の荷物がまだありません（スキャン→仕分済の反映後に表示されます）。上の残数サマリをご確認ください。</p>
  {/if}

  {#each groups as g (g.driver_id)}
    {@const s = summaryMap.get(g.driver_id)}
    <section class="driver-section pdf-section">
      <header class="sheet-head">
        <div class="h-left">
          <div class="h-title">配車表（{isPost ? '仕分後' : '仕分前'}）</div>
          <div class="h-sub">日付 {data.date} ／ 営業所 {data.officeCode} ／ ドライバー {g.driver_id}</div>
        </div>
        <div class="h-counts">
          <span>総数 <strong>{s?.total ?? g.rows.length}</strong></span>
          {#if isPost}
            <span class="sorted">仕分済 <strong>{g.rows.length}</strong></span>
            <span class="unsorted">未仕分 残 <strong>{s?.unsorted ?? 0}</strong>件</span>
          {/if}
        </div>
      </header>
      <table class="sheet">
        <thead>
          <tr><th>配達順</th><th>かご</th><th>問合番号</th><th>住所</th><th>氏名</th><th>時間</th></tr>
        </thead>
        <tbody>
          {#each g.rows as r (r.tracking_number)}
            <tr>
              <td class="num">{r.delivery_order ?? '—'}</td>
              <td class="kago">{r.basket_code ?? '—'}</td>
              <td>{r.tracking_number}</td>
              <td class="addr">{r.address ?? '—'}</td>
              <td>{r.recipient_name ?? '—'}</td>
              <td>{r.time_window ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/each}
</div>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; gap: 1rem; flex-wrap: wrap; }
  .back { color: #0b7a4b; text-decoration: none; margin-right: 0.75rem; }
  .controls { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .modes button { border: 1px solid #0b7a4b; background: #fff; color: #0b7a4b; padding: 0.35rem 0.7rem; cursor: pointer; }
  .modes button:first-child { border-radius: 6px 0 0 6px; }
  .modes button:last-child { border-radius: 0 6px 6px 0; border-left: none; }
  .modes button.active { background: #0b7a4b; color: #fff; }
  .pdf { background: #0b7a4b; color: #fff; border: none; border-radius: 6px; padding: 0.4rem 0.9rem; font-weight: 600; cursor: pointer; }
  .pdf:disabled { opacity: 0.6; }
  .dialog-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 20; }
  .dialog { background: #fff; border-radius: 10px; padding: 1.1rem 1.3rem; max-width: 92vw; width: 380px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); }
  .dialog h3 { margin: 0 0 0.3rem; font-size: 1.05rem; }
  .dialog .hint { margin: 0 0 0.9rem; color: #555; font-size: 0.88rem; }
  .dbtns { display: flex; flex-direction: column; gap: 0.5rem; }
  .dbtns .rec { background: #0b7a4b; color: #fff; border: none; border-radius: 6px; padding: 0.55rem; font-weight: 700; cursor: pointer; }
  .dbtns .sub { background: #fff; border: 1px solid #0b7a4b; color: #0b7a4b; border-radius: 6px; padding: 0.55rem; cursor: pointer; }
  .dbtns .cancel { background: #fff; border: 1px solid #bbb; color: #666; border-radius: 6px; padding: 0.45rem; cursor: pointer; }
  .muted { color: #777; }
  .error { color: #b00020; }
  .msg { color: #0b5a36; }
  .sheets { display: flex; flex-direction: column; gap: 1rem; }
  .driver-section { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.1rem; }
  .sheet-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0b7a4b; padding-bottom: 0.5rem; margin-bottom: 0.6rem; }
  .h-title { font-size: 1.15rem; font-weight: 700; }
  .h-sub { color: #444; font-size: 0.9rem; margin-top: 0.2rem; }
  .h-counts { display: flex; gap: 0.9rem; font-size: 0.9rem; white-space: nowrap; }
  .h-counts .sorted strong { color: #0b7a4b; }
  .h-counts .unsorted strong { color: #b00020; }
  table.sheet { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .sheet th, .sheet td { border: 1px solid #e3e3e3; padding: 0.3rem 0.45rem; text-align: left; }
  .sheet th { background: #f1f5f3; color: #333; }
  .num, .kago { text-align: center; }
  .num.unsorted { color: #b00020; }
  .kago { font-weight: 700; color: #0b7a4b; }
  .addr { max-width: 240px; }
  @media print {
    .no-print { display: none !important; }
    .pdf-section { page-break-after: always; border: none; }
  }
</style>
