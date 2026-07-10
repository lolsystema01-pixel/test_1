<script lang="ts">
  import { goto } from '$app/navigation';

  let { data } = $props();
  let { supabase } = $derived(data);

  type Row = {
    driver_id: string;
    driver_name: string | null;
    basket_code: string | null;
    item_count: number;
  };
  type Summary = { driver_id: string; driver_name: string | null; basket_count: number; total_count: number };

  // ドライバー別にグループ化（かご記号順は load で済み）
  let groups = $derived.by(() => {
    const m = new Map<string, Row[]>();
    for (const r of data.rows as Row[]) {
      const a = m.get(r.driver_id) ?? [];
      a.push(r);
      m.set(r.driver_id, a);
    }
    return [...m.entries()].map(([driver_id, rows]) => ({ driver_id, rows }));
  });
  let summaryMap = $derived(new Map((data.summary as Summary[]).map((s) => [s.driver_id, s])));

  let busy = $state(false);
  let uploadMsg = $state('');

  function onDate(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (v) goto(`/carry?date=${v}`);
  }

  // PDF生成：ドライバーごとのセクションを画像化して1ページずつ（日本語はDOM画像化で再現）。
  //   ＝配車表PDF(/sheet)と同じ方式。フォント埋め込み不要・service_role不要（anon+JWTでStorage）。
  async function makePdf() {
    busy = true;
    uploadMsg = '';
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const sections = Array.from(document.querySelectorAll<HTMLElement>('.driver-section'));
      if (sections.length === 0) {
        uploadMsg = '対象がありません。';
        busy = false;
        return;
      }
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const iw = pw - margin * 2;
      const contentH = ph - margin * 2;
      let firstPage = true;
      for (const section of sections) {
        // 1ドライバー＝1ページ。コンテンツ枠に収まるよう縦横比を保って縮小（はみ出す分割・空白ページを作らない）。
        const canvas = await html2canvas(section, { scale: 2, backgroundColor: '#ffffff' });
        let w = iw;
        let h = (canvas.height * iw) / canvas.width;
        if (h > contentH) {
          h = contentH;
          w = (canvas.width * contentH) / canvas.height;
        }
        const img = canvas.toDataURL('image/jpeg', 0.8);
        if (!firstPage) pdf.addPage(); // ドライバーごとに改ページ（1ドライバー=1枚）
        pdf.addImage(img, 'JPEG', margin, margin, w, h);
        firstPage = false;
      }
      pdf.save(`かご持出表_${data.officeCode}_${data.date}.pdf`);

      // Supabase Storage へ保存（バケット: carry-sheets）。anon＋areaのJWT＋Storage RLS。
      const blob = pdf.output('blob');
      const path = `${data.officeCode}/${data.date}/all.pdf`;
      const { error } = await supabase.storage
        .from('carry-sheets')
        .upload(path, blob, { contentType: 'application/pdf', upsert: true });
      uploadMsg = error ? `Storage保存に失敗: ${error.message}` : `Storage保存OK: ${path}`;
    } catch (e) {
      uploadMsg = `PDF生成に失敗: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }
</script>

<section class="bar no-print">
  <div>
    <a href="/home" class="back">← 営業所ホーム</a>
    <strong>かご持出表PDF</strong>
  </div>
  <div class="controls">
    <label>対象日 <input type="date" value={data.date} onchange={onDate} /></label>
    <button class="pdf" onclick={makePdf} disabled={busy}>{busy ? '生成中…' : 'PDF保存'}</button>
  </div>
</section>

{#if data.loadError}<p class="error no-print">取得に失敗：{data.loadError}</p>{/if}
{#if uploadMsg}<p class="msg no-print">{uploadMsg}</p>{/if}

{#if groups.length === 0}
  <p class="muted no-print">対象日（{data.date}）の持出対象（ドライバー確定分）がありません。</p>
{/if}

<div class="sheets">
  {#each groups as g (g.driver_id)}
    {@const s = summaryMap.get(g.driver_id)}
    <section class="driver-section">
      <header class="sheet-head">
        <div class="h-left">
          <div class="h-title">かご持出表</div>
          <div class="h-sub">
            日付 {data.date} ／ 営業所 {data.officeCode} ／ ドライバー {s?.driver_name ?? g.rows[0]?.driver_name ?? g.driver_id}（{g.driver_id}）
          </div>
        </div>
        <div class="h-counts">
          <span>かご数 <strong>{s?.basket_count ?? g.rows.length}</strong></span>
          <span>合計個数 <strong>{s?.total_count ?? g.rows.reduce((a, r) => a + r.item_count, 0)}</strong></span>
        </div>
      </header>

      <table class="sheet">
        <thead>
          <tr><th class="kago">かご記号</th><th class="cnt">担当個数</th></tr>
        </thead>
        <tbody>
          {#each g.rows as r (r.basket_code ?? '—')}
            <tr>
              <td class="kago">{r.basket_code ?? '（未採番）'}</td>
              <td class="cnt">{r.item_count}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <th class="kago">合計</th>
            <td class="cnt total">{s?.total_count ?? g.rows.reduce((a, r) => a + r.item_count, 0)}</td>
          </tr>
        </tfoot>
      </table>

      <!-- フッター＝記入欄（手書き）。点呼・アルコール(8.8)の実データは未連携のため空欄。 -->
      <footer class="sheet-foot">
        <div class="f-row">
          <span class="f-label">積込開始時間</span>
          <span class="f-blank">　　　　：　　　　</span>
        </div>
        <div class="f-row">
          <span class="f-label">アルコールチェック</span>
          <span class="f-sub">結果</span><span class="f-blank short">　　　　</span>
          <span class="f-sub">時刻</span><span class="f-blank short">　　：　　</span>
          <span class="f-sub">確認者</span><span class="f-blank">　　　　　　</span>
        </div>
        <p class="f-note">※ 点呼・アルコールチェックは記入欄（将来データ連携で自動表示へ切替）。</p>
      </footer>
    </section>
  {/each}
</div>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; gap: 1rem; flex-wrap: wrap; }
  .back { color: #0b7a4b; text-decoration: none; margin-right: 0.75rem; }
  .controls { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .pdf { background: #0b7a4b; color: #fff; border: none; border-radius: 6px; padding: 0.4rem 0.9rem; font-weight: 600; cursor: pointer; }
  .pdf:disabled { opacity: 0.6; }
  .muted { color: #777; }
  .error { color: #b00020; }
  .msg { color: #0b5a36; }
  .sheets { display: flex; flex-direction: column; gap: 1rem; }
  .driver-section { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.1rem; }
  .sheet-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0b7a4b; padding-bottom: 0.5rem; margin-bottom: 0.6rem; }
  .h-title { font-size: 1.15rem; font-weight: 700; }
  .h-sub { color: #444; font-size: 0.9rem; margin-top: 0.2rem; }
  .h-counts { display: flex; gap: 0.9rem; font-size: 0.9rem; white-space: nowrap; }
  .h-counts strong { color: #0b7a4b; }
  table.sheet { width: 100%; border-collapse: collapse; font-size: 0.9rem; max-width: 360px; }
  .sheet th, .sheet td { border: 1px solid #e3e3e3; padding: 0.35rem 0.6rem; text-align: left; }
  .sheet th { background: #f1f5f3; color: #333; }
  .sheet .kago { font-weight: 700; color: #0b7a4b; }
  .sheet .cnt { text-align: right; width: 6rem; }
  .sheet .cnt.total { font-weight: 700; }
  .sheet-foot { margin-top: 0.9rem; border-top: 1px dashed #bbb; padding-top: 0.6rem; }
  .f-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; margin-bottom: 0.4rem; flex-wrap: wrap; }
  .f-label { font-weight: 600; min-width: 8.5rem; }
  .f-sub { color: #555; }
  .f-blank { border-bottom: 1px solid #333; min-width: 6rem; letter-spacing: 0.1em; }
  .f-blank.short { min-width: 3.5rem; }
  .f-note { color: #888; font-size: 0.78rem; margin: 0.3rem 0 0; }
  @media print {
    .no-print { display: none !important; }
    .driver-section { page-break-after: always; border: none; }
  }
</style>
