<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import TextField from '$lib/components/TextField.svelte';
  import Button from '$lib/components/Button.svelte';
  import Stepper from '$lib/components/Stepper.svelte';
  import { flow, save } from '$lib/reception.svelte';
  import { validateTracking, isEmpty, TRACKING_MIN, TRACKING_MAX } from '$lib/validation';
  import { apiPost, ApiError } from '$lib/api';

  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let apiErr = $state('');

  onMount(() => {
    const tn = $page.url.searchParams.get('tn');
    if (tn && !flow.trackingNumber) flow.trackingNumber = tn;
  });

  // 入力時チェック（D章：入力時＆送信時）
  function onInput() {
    if (!isEmpty(errors)) errors = validateTracking(flow);
  }

  async function next() {
    errors = validateTracking(flow);
    if (!isEmpty(errors)) return;
    busy = true;
    apiErr = '';
    try {
      const data = (await apiPost('/api/auth/otp', { trackingNumber: flow.trackingNumber.trim() })) as { devCode?: string };
      flow.trackingNumber = flow.trackingNumber.trim();
      flow.devCode = data?.devCode ?? '';
      save();
      await goto('/reception/verify');
    } catch (e) {
      apiErr = e instanceof ApiError ? e.message : '送信に失敗しました。';
    } finally {
      busy = false;
    }
  }
</script>

<Stepper current={1} total={6} />
<h1>問合番号の入力</h1>
<p class="lead">不在票に記載の問合番号を入力してください。</p>

{#if apiErr}<p class="apierr">{apiErr}</p>{/if}

<TextField
  label="問合番号"
  bind:value={flow.trackingNumber}
  error={errors.trackingNumber}
  inputmode="text"
  maxlength={TRACKING_MAX}
  placeholder="例: 900000000001"
  hint={`半角英数 ${TRACKING_MIN}〜${TRACKING_MAX}桁`}
  oninput={onInput}
/>

<Button onclick={next} loading={busy}>次へ</Button>

<p class="demo">※検証用ダミー番号：900000000001／900000000002／900000000003</p>

<style>
  h1 { font-size: 1.2rem; margin: 0 0 0.4rem; }
  .lead { color: #555; font-size: 0.92rem; margin: 0 0 1.1rem; }
  .apierr { color: #b00020; font-size: 0.9rem; }
  .demo { color: #999; font-size: 0.75rem; margin-top: 1rem; }
</style>
