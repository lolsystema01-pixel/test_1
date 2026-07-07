<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Button from '$lib/components/Button.svelte';
  import Stepper from '$lib/components/Stepper.svelte';
  import { flow, save } from '$lib/reception.svelte';
  import { validateAll, isEmpty, needsDateTime, needsDropPlace } from '$lib/validation';
  import { apiPost, ApiError } from '$lib/api';

  let busy = $state(false);
  let apiErr = $state('');
  let duplicate = $state(false); // N-5：二重受付の確認表示
  const today = new Date().toISOString().slice(0, 10);

  onMount(() => {
    if (!flow.token) return goto('/reception/tracking');
    // 念のため最終バリデーション。NGなら種別へ戻す。
    if (!isEmpty(validateAll(flow, today))) goto('/reception/type');
  });

  async function submit(overwrite = false) {
    busy = true;
    apiErr = '';
    try {
      const data = (await apiPost(
        '/api/redelivery',
        {
          type: flow.receptionType,
          desiredDate: flow.desiredDate,
          timeSlot: flow.timeSlot,
          dropPlace: flow.dropPlace,
          memo: flow.memo,
          overwrite
        },
        flow.token
      )) as { receiptNo?: string };
      flow.receiptNo = data?.receiptNo ?? '';
      save();
      await goto('/reception/done');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_RECEPTION') {
        duplicate = true;
        apiErr = e.message;
      } else {
        apiErr = e instanceof ApiError ? e.message : '受付に失敗しました。';
      }
    } finally {
      busy = false;
    }
  }
</script>

<Stepper current={5} total={6} />
<h1>入力内容の確認</h1>
<p class="lead">内容をご確認のうえ「送信」してください。</p>

<dl class="summary">
  <div><dt>問合番号</dt><dd>{flow.trackingNumber}</dd></div>
  <div><dt>受付種別</dt><dd>{flow.receptionType}</dd></div>
  {#if needsDateTime(flow.receptionType)}
    <div><dt>希望日</dt><dd>{flow.desiredDate}</dd></div>
    <div><dt>時間帯</dt><dd>{flow.timeSlot}</dd></div>
  {/if}
  {#if needsDropPlace(flow.receptionType)}
    <div><dt>置き配場所</dt><dd>{flow.dropPlace}</dd></div>
    {#if flow.memo}<div><dt>メモ</dt><dd>{flow.memo}</dd></div>{/if}
  {/if}
</dl>

{#if apiErr}<p class="apierr">{apiErr}</p>{/if}

{#if duplicate}
  <div class="dup">
    <p>すでに受付済みの番号です。<strong>上書き</strong>して受付し直しますか？</p>
    <Button onclick={() => submit(true)} loading={busy}>上書きして送信</Button>
    <div class="back"><Button variant="secondary" onclick={() => goto('/reception/done')} disabled={busy}>やめる</Button></div>
  </div>
{:else}
  <Button onclick={() => submit(false)} loading={busy}>送信</Button>
  <div class="back"><Button variant="secondary" onclick={() => history.back()} disabled={busy}>戻る</Button></div>
{/if}

<style>
  h1 { font-size: 1.2rem; margin: 0 0 0.4rem; }
  .lead { color: #555; font-size: 0.92rem; margin: 0 0 1.1rem; }
  .summary { margin: 0 0 1.1rem; border: 1px solid #e3e7e5; border-radius: 10px; overflow: hidden; }
  .summary > div { display: flex; border-bottom: 1px solid #eef0ef; }
  .summary > div:last-child { border-bottom: none; }
  dt { width: 6.5rem; flex: none; background: #f6f8f7; padding: 0.6rem 0.7rem; font-size: 0.85rem; color: #555; margin: 0; }
  dd { margin: 0; padding: 0.6rem 0.7rem; font-weight: 600; }
  .apierr { color: #b00020; font-size: 0.9rem; }
  .dup { background: #fff7e6; border: 1px solid #e0a800; border-radius: 10px; padding: 0.8rem; }
  .dup p { margin: 0 0 0.6rem; font-size: 0.92rem; }
  .back { margin-top: 0.6rem; }
</style>
