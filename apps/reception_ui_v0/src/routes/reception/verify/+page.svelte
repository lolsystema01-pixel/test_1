<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import TextField from '$lib/components/TextField.svelte';
  import Button from '$lib/components/Button.svelte';
  import Stepper from '$lib/components/Stepper.svelte';
  import { flow, save } from '$lib/reception.svelte';
  import { validateAuth, isEmpty } from '$lib/validation';
  import { apiPost, ApiError } from '$lib/api';

  let code = $state('');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let apiErr = $state('');
  let locked = $state(false);

  onMount(() => {
    if (!flow.trackingNumber) goto('/reception/tracking');
  });

  function onInput() {
    if (!isEmpty(errors)) errors = validateAuth({ authCode: code });
  }

  async function submit() {
    errors = validateAuth({ authCode: code });
    if (!isEmpty(errors)) return;
    busy = true;
    apiErr = '';
    try {
      const data = (await apiPost('/api/auth/verify', { trackingNumber: flow.trackingNumber, code: code.trim() })) as { token?: string };
      flow.token = data?.token ?? '';
      save();
      await goto('/reception/type');
    } catch (e) {
      if (e instanceof ApiError) {
        apiErr = e.message;
        if (e.code === 'AUTH_LOCKED') locked = true;
      } else apiErr = '認証に失敗しました。';
    } finally {
      busy = false;
    }
  }
</script>

<Stepper current={2} total={6} />
<h1>認証コードの入力</h1>
<p class="lead">ご本人確認のため、認証コード（6桁）を入力してください。</p>

{#if flow.devCode}
  <p class="demo">※検証用：認証コードは <strong>{flow.devCode}</strong>（実運用ではSMS/メールで届きます）</p>
{/if}
{#if apiErr}<p class="apierr">{apiErr}</p>{/if}

<TextField
  label="認証コード"
  bind:value={code}
  error={errors.authCode}
  inputmode="numeric"
  maxlength={6}
  placeholder="123456"
  disabled={locked}
  oninput={onInput}
/>

<Button onclick={submit} loading={busy} disabled={locked}>認証する</Button>

{#if locked}
  <p class="demo">ロック中です。最初からやり直す場合は番号入力へ戻ってください。</p>
  <div class="back"><Button variant="secondary" onclick={() => goto('/reception/tracking')}>番号入力へ戻る</Button></div>
{/if}

<style>
  h1 { font-size: 1.2rem; margin: 0 0 0.4rem; }
  .lead { color: #555; font-size: 0.92rem; margin: 0 0 1.1rem; }
  .apierr { color: #b00020; font-size: 0.9rem; }
  .demo { color: #777; font-size: 0.8rem; margin: 0.2rem 0 1rem; }
  .back { margin-top: 0.6rem; }
</style>
