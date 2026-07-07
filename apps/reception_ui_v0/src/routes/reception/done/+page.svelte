<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Button from '$lib/components/Button.svelte';
  import Stepper from '$lib/components/Stepper.svelte';
  import { flow, reset } from '$lib/reception.svelte';
  import { apiGet, ApiError } from '$lib/api';

  // N-6：受付後の状態取得・反映確認
  let statusText = $state('確認中…');
  let receipt = $state('');
  let summary = $state<{ type: string; desiredDate?: string; timeSlot?: string; dropPlace?: string } | null>(null);

  onMount(async () => {
    if (!flow.receiptNo || !flow.token) return goto('/reception/tracking');
    receipt = flow.receiptNo;
    try {
      const s = (await apiGet('/api/status', flow.token)) as {
        delivery_status?: string;
        municipality?: string;
        reception?: { type: string; desiredDate?: string; timeSlot?: string; dropPlace?: string } | null;
      };
      statusText = `${s.municipality ?? ''}／配送状況：${s.delivery_status ?? '—'}`;
      summary = s.reception ?? null;
    } catch (e) {
      statusText = e instanceof ApiError ? e.message : '状態を取得できませんでした。';
    }
  });

  function again() {
    const tn = flow.trackingNumber;
    reset();
    flow.trackingNumber = tn;
    goto('/reception/tracking');
  }
</script>

<Stepper current={6} total={6} />
<div class="done">
  <div class="check">✓</div>
  <h1>受付が完了しました</h1>
  <p class="receipt">受付番号 <strong>{receipt}</strong></p>
</div>

{#if summary}
  <dl class="summary">
    <div><dt>受付種別</dt><dd>{summary.type}</dd></div>
    {#if summary.desiredDate}<div><dt>希望日</dt><dd>{summary.desiredDate}</dd></div>{/if}
    {#if summary.timeSlot}<div><dt>時間帯</dt><dd>{summary.timeSlot}</dd></div>{/if}
    {#if summary.dropPlace}<div><dt>置き配場所</dt><dd>{summary.dropPlace}</dd></div>{/if}
  </dl>
{/if}

<p class="status">{statusText}</p>
<p class="note">完了通知メールの送信は別途（本書の範囲外）。</p>

<div class="again"><Button variant="secondary" onclick={again}>別の手続きをする</Button></div>

<style>
  .done { text-align: center; margin: 1rem 0 1.2rem; }
  .check { width: 56px; height: 56px; border-radius: 50%; background: #0b7a4b; color: #fff; font-size: 1.8rem; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.6rem; }
  h1 { font-size: 1.2rem; margin: 0 0 0.3rem; }
  .receipt { color: #333; margin: 0; }
  .summary { margin: 0 0 1rem; border: 1px solid #e3e7e5; border-radius: 10px; overflow: hidden; }
  .summary > div { display: flex; border-bottom: 1px solid #eef0ef; }
  .summary > div:last-child { border-bottom: none; }
  dt { width: 6.5rem; flex: none; background: #f6f8f7; padding: 0.6rem 0.7rem; font-size: 0.85rem; color: #555; margin: 0; }
  dd { margin: 0; padding: 0.6rem 0.7rem; font-weight: 600; }
  .status { color: #0b5a36; font-size: 0.92rem; }
  .note { color: #888; font-size: 0.78rem; }
  .again { margin-top: 1rem; }
</style>
