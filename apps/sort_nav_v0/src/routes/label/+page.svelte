<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import {
    toLabelText,
    barcodeValue,
    toPrintItems,
    LABEL_HEIGHT_MM,
    type LabelPayload,
    type PrintKind
  } from '$lib/label';

  let { data } = $props();
  let { supabase } = $derived(data);

  const payloads = $derived(data.payloads as LabelPayload[]);

  // 端末別の設定（localStorage）：印刷ON/OFF・バーコードON/OFF・端末ID・ブリッジURL・用紙幅
  let printOn = $state(true);
  let barcodeOn = $state(false); // ★既定OFF（枠のみ）
  let terminalId = $state('');
  let bridgeUrl = $state(''); // 外注ブリッジのローカル受け口（未設定＝未接続）
  let paperWidthMm = $state(50); // 用紙幅（見本の“x”＝未指定。外注で確定）

  let busy = $state(false);
  let msg = $state('');
  let warn = $state('');
  let pdfUrl = $state('');

  onMount(() => {
    printOn = localStorage.getItem('label_print_on') !== '0';
    barcodeOn = localStorage.getItem('label_barcode_on') === '1';
    terminalId = localStorage.getItem('label_terminal_id') ?? '';
    bridgeUrl = localStorage.getItem('label_bridge_url') ?? '';
    paperWidthMm = Number(localStorage.getItem('label_paper_w') ?? '50') || 50;
    history = data.history as any[]; // SSR初期値
  });
  function persist() {
    localStorage.setItem('label_print_on', printOn ? '1' : '0');
    localStorage.setItem('label_barcode_on', barcodeOn ? '1' : '0');
    localStorage.setItem('label_terminal_id', terminalId);
    localStorage.setItem('label_bridge_url', bridgeUrl);
    localStorage.setItem('label_paper_w', String(paperWidthMm));
  }

  function onDate(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (v) goto(`/label?date=${v}`);
  }

  // 履歴を記録（record_prints・printed_by=auth.uid()／area=自営業所に固定）
  async function record(items: LabelPayload[], kind: PrintKind) {
    const { error } = await supabase.rpc('record_prints', {
      p_items: toPrintItems(items, kind, terminalId || null)
    });
    if (error) throw new Error(`履歴記録に失敗: ${error.message}`);
  }

  // ラベルPDF（数字のみ・大＝かご記号＋配達順／小＝問合番号・1ラベル=1ページ・約30mm）。
  //   バーコードは barcodeOn の時のみ枠を描画（既定OFF）。プリンタ/b-PAC 不要。
  async function buildLabelPdf(items: LabelPayload[]): Promise<Blob> {
    const { jsPDF } = await import('jspdf');
    const w = Math.max(20, paperWidthMm);
    const h = LABEL_HEIGHT_MM;
    const pdf = new jsPDF({ unit: 'mm', format: [w, h] });
    items.forEach((p, i) => {
      if (i > 0) pdf.addPage([w, h], w > h ? 'l' : 'p');
      const t = toLabelText(p);
      // 大＝かご記号＋配達順
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(26);
      pdf.text(t.large || '-', w / 2, 11, { align: 'center' });
      // 小＝問合番号（数字のみ）
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(12);
      pdf.text(t.small, w / 2, barcodeOn ? 17 : 22, { align: 'center' });
      // バーコード枠（ON時のみ・将来用。実シンボロジーは外注ブリッジ/.lbx側で確定）
      if (barcodeOn) {
        const bx = 4,
          by = 19,
          bw = w - 8,
          bh = h - by - 2;
        pdf.setLineWidth(0.2);
        pdf.rect(bx, by, bw, bh);
        pdf.setFontSize(6);
        pdf.text(`barcode枠(OFF既定): ${barcodeValue(p)}`, w / 2, by + bh / 2, { align: 'center' });
      }
    });
    return pdf.output('blob');
  }

  async function onPdf() {
    busy = true;
    msg = '';
    warn = '';
    try {
      if (payloads.length === 0) {
        warn = '対象（採番済）がありません。';
        return;
      }
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      const blob = await buildLabelPdf(payloads);
      pdfUrl = URL.createObjectURL(blob);
      await record(payloads, 'pdf'); // PDF出力も履歴に残す
      msg = `ラベルPDFを生成しました（${payloads.length}枚・${barcodeOn ? 'バーコード枠ON' : '数字のみ'}）。`;
    } catch (e) {
      warn = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      persist();
    }
  }

  // 送信フック：印刷ON時のみ発火。ブリッジ（外注・ローカルagent）へペイロードをPOST＋履歴記録。
  //   OFF＝送信しない（読取のみ）。ブリッジ未接続でもフック発火と履歴は残す（PoC）。
  async function sendToBridge(items: LabelPayload[], kind: PrintKind) {
    if (!printOn) {
      warn = '印刷OFF：送信しません（読取のみ）。ONにすると送信フックが発火します。';
      return;
    }
    busy = true;
    msg = '';
    warn = '';
    try {
      // (1) 送信フック＝外注ブリッジへPOST（アダプタ契約：{ items:[ペイロード] }）
      let bridge = 'ブリッジ未接続（URL未設定）';
      if (bridgeUrl) {
        try {
          const res = await fetch(bridgeUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ items: toPrintItems(items, kind, terminalId || null) })
          });
          bridge = res.ok ? 'ブリッジ送信OK' : `ブリッジ応答 ${res.status}`;
        } catch {
          bridge = 'ブリッジ未接続（送信先に届かず）';
        }
      }
      // (2) 履歴記録（送信フックが発火した事実を残す）
      await record(items, kind);
      msg = `送信フック発火（${kind}・${items.length}件）／${bridge}／履歴に記録しました。`;
      await refreshHistory();
    } catch (e) {
      warn = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      persist();
    }
  }

  // 履歴の再読込（初期値はSSRの data.history を onMount で取り込む）
  let history = $state<any[]>([]);
  async function refreshHistory() {
    const { data: h } = await supabase
      .from('print_history')
      .select('id, printed_at, tracking_number, basket_code, delivery_order, kind, terminal_id')
      .order('printed_at', { ascending: false })
      .limit(50);
    history = h ?? [];
  }

  // 再印刷：履歴1行から復元して PDF再生成＋記録（reprint）。ONならブリッジにも送信。
  async function reprint(row: any) {
    const p: LabelPayload = {
      office_code: data.officeCode,
      delivery_date: data.date,
      driver_id: null,
      tracking_number: row.tracking_number,
      basket_code: row.basket_code,
      delivery_order: row.delivery_order
    };
    busy = true;
    msg = '';
    warn = '';
    try {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      const blob = await buildLabelPdf([p]);
      pdfUrl = URL.createObjectURL(blob);
      await record([p], 'reprint');
      if (printOn && bridgeUrl) {
        try {
          await fetch(bridgeUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ items: toPrintItems([p], 'reprint', terminalId || null) })
          });
        } catch {
          /* ブリッジ未接続でも履歴とPDFは残す */
        }
      }
      msg = `再印刷（${row.tracking_number}）：PDF再生成＋履歴記録しました。`;
      await refreshHistory();
    } catch (e) {
      warn = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const KIND_LABEL: Record<string, string> = { print: '印刷', reprint: '再印刷', pdf: 'PDF' };
</script>

<section class="bar no-print">
  <div>
    <a href="/sort" class="back">← 仕分けナビ</a>
    <strong>ラベル印刷ブリッジ</strong>
  </div>
  <div class="controls">
    <label>対象日 <input type="date" value={data.date} onchange={onDate} /></label>
    <button class="go" onclick={onPdf} disabled={busy}>{busy ? '処理中…' : 'ラベルPDF生成'}</button>
    <button class="go alt" onclick={() => sendToBridge(payloads, 'print')} disabled={busy}>
      印刷ブリッジへ送信
    </button>
  </div>
</section>

{#if data.payloadError}<p class="error no-print">取得に失敗：{data.payloadError}</p>{/if}
{#if warn}<p class="warn no-print">{warn}</p>{/if}
{#if msg}<p class="msg no-print">{msg}</p>{/if}

<section class="card no-print">
  <h2>印刷設定（この端末）</h2>
  <div class="settings">
    <label class="sw">
      <input type="checkbox" bind:checked={printOn} onchange={persist} />
      印刷 {printOn ? 'ON（送信フック発火）' : 'OFF（読取のみ・送信しない）'}
    </label>
    <label class="sw">
      <input type="checkbox" bind:checked={barcodeOn} onchange={persist} />
      バーコード枠 {barcodeOn ? 'ON（将来用）' : 'OFF（既定・数字のみ）'}
    </label>
    <label>端末ID <input type="text" bind:value={terminalId} onblur={persist} placeholder="T-001" /></label>
    <label>用紙幅mm <input type="number" bind:value={paperWidthMm} onblur={persist} min="20" /></label>
    <label class="wide">
      ブリッジURL
      <input type="text" bind:value={bridgeUrl} onblur={persist} placeholder="http://localhost:9100/print（外注agent）" />
    </label>
  </div>
  <p class="muted">
    ※ 印刷ブリッジ本体（b-PAC→Brother TD-2350）と .lbx は<strong>スポット外注</strong>。未接続でも
    PDF出力・送信フック・履歴は内製分で確認できます。
  </p>
</section>

<section class="card">
  <h2>ラベルペイロード（採番済・機種非依存）</h2>
  <p class="summary">
    対象日 <strong>{data.date}</strong> ／ 営業所 <strong>{data.officeCode}</strong>
    ／ ラベル <strong>{payloads.length}</strong> 枚
  </p>
  {#if payloads.length > 0}
    <table>
      <thead>
        <tr><th>ドライバー</th><th>大（かご記号＋配達順）</th><th>小（問合番号）</th></tr>
      </thead>
      <tbody>
        {#each payloads as p (p.tracking_number)}
          {@const t = toLabelText(p)}
          <tr>
            <td class="mono">{p.driver_id ?? '-'}</td>
            <td class="lg">{t.large || '-'}</td>
            <td class="mono">{t.small}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted">対象（採番済）がありません。配車v0.5＋採番一式v0.5を実機実行のうえ対象日を選んでください。</p>
  {/if}
</section>

{#if pdfUrl}
  <section class="card no-print">
    <h2>ラベルPDF（数字のみ・約{LABEL_HEIGHT_MM}mm）</h2>
    <a class="dl" href={pdfUrl} download={`label_${data.officeCode}_${data.date}.pdf`}>⬇ ラベルPDFをダウンロード</a>
  </section>
{/if}

<section class="card">
  <h2>印刷履歴（直近・自営業所）</h2>
  {#if history.length > 0}
    <table>
      <thead>
        <tr><th>日時</th><th>種別</th><th>問合番号</th><th>かご/順</th><th>端末</th><th></th></tr>
      </thead>
      <tbody>
        {#each history as h (h.id)}
          <tr>
            <td class="mono sm">{new Date(h.printed_at).toLocaleString('ja-JP')}</td>
            <td><span class="kind k-{h.kind}">{KIND_LABEL[h.kind] ?? h.kind}</span></td>
            <td class="mono">{h.tracking_number}</td>
            <td class="mono">{h.basket_code ?? '-'} / {h.delivery_order ?? '-'}</td>
            <td class="mono sm">{h.terminal_id ?? '-'}</td>
            <td><button class="re" onclick={() => reprint(h)} disabled={busy}>再印刷</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted">履歴はまだありません。「ラベルPDF生成」または「印刷ブリッジへ送信」で記録されます。</p>
  {/if}
</section>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; gap: 1rem; flex-wrap: wrap; }
  .back { color: #0b7a4b; text-decoration: none; margin-right: 0.75rem; }
  .controls { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .go { background: #0b7a4b; color: #fff; border: none; border-radius: 6px; padding: 0.4rem 0.9rem; font-weight: 600; cursor: pointer; }
  .go.alt { background: #0b5cab; }
  .go:disabled { opacity: 0.6; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 0.9rem 1.1rem; margin-bottom: 1rem; }
  h2 { font-size: 1rem; margin: 0 0 0.6rem; }
  .summary { font-size: 0.92rem; }
  .summary strong { color: #0b7a4b; }
  .muted { color: #777; font-size: 0.85rem; }
  .error { color: #b00020; }
  .warn { color: #9a6700; }
  .msg { color: #0b5a36; }
  .settings { display: flex; flex-wrap: wrap; gap: 0.6rem 1.2rem; align-items: center; }
  .settings label { font-size: 0.88rem; }
  .settings .wide input { width: 22rem; max-width: 60vw; }
  .sw { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #eee; }
  th { color: #555; font-weight: 600; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .sm { font-size: 0.8rem; color: #555; }
  .lg { font-weight: 700; font-size: 1.05rem; }
  .dl { color: #0b5cab; text-decoration: none; font-weight: 600; }
  .kind { font-size: 0.78rem; padding: 0.05rem 0.4rem; border-radius: 999px; }
  .k-print { background: #e3f1ea; color: #0b5a36; }
  .k-reprint { background: #fdeccf; color: #9a6700; }
  .k-pdf { background: #e7eefb; color: #0b5cab; }
  .re { background: #fff; border: 1px solid #0b5cab; color: #0b5cab; border-radius: 5px; padding: 0.15rem 0.55rem; cursor: pointer; font-size: 0.82rem; }
  .re:disabled { opacity: 0.5; }
</style>
