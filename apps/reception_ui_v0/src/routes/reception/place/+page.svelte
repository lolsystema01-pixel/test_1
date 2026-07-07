<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import TextField from '$lib/components/TextField.svelte';
  import Button from '$lib/components/Button.svelte';
  import Stepper from '$lib/components/Stepper.svelte';
  import FieldError from '$lib/components/FieldError.svelte';
  import { flow, save } from '$lib/reception.svelte';
  import { validatePlace, isEmpty, needsDropPlace, MEMO_MAX } from '$lib/validation';

  let errors = $state<Record<string, string>>({});

  onMount(() => {
    if (!flow.token) return goto('/reception/tracking');
    if (!needsDropPlace(flow.receptionType)) goto('/reception/type');
  });

  function onInput() {
    if (!isEmpty(errors)) errors = validatePlace(flow);
  }

  function next() {
    errors = validatePlace(flow);
    if (!isEmpty(errors)) return;
    save();
    goto('/reception/confirm');
  }
</script>

<Stepper current={4} total={6} />
<h1>置き配場所</h1>
<p class="lead">置き配をご希望の場所を入力してください。</p>

<TextField label="置き配場所" bind:value={flow.dropPlace} error={errors.dropPlace} placeholder="例：玄関前 / 宅配ボックス" oninput={onInput} />

<label class="field">
  <span class="lbl">メモ（任意・{MEMO_MAX}文字以内）</span>
  <textarea class="ta" class:err={!!errors.memo} bind:value={flow.memo} maxlength={MEMO_MAX + 50} rows="3" oninput={onInput}></textarea>
  <span class="count">{(flow.memo ?? '').length}/{MEMO_MAX}</span>
  <FieldError message={errors.memo} />
</label>

<Button onclick={next}>確認へ</Button>
<div class="back"><Button variant="secondary" onclick={() => goto('/reception/type')}>戻る</Button></div>

<style>
  h1 { font-size: 1.2rem; margin: 0 0 0.4rem; }
  .lead { color: #555; font-size: 0.92rem; margin: 0 0 1.1rem; }
  .field { display: block; margin-bottom: 1rem; }
  .lbl { display: block; font-size: 0.9rem; font-weight: 600; margin-bottom: 0.3rem; }
  .ta { width: 100%; padding: 0.6rem 0.8rem; font-size: 1rem; border: 2px solid #cdd5d0; border-radius: 8px; box-sizing: border-box; }
  .ta:focus { outline: none; border-color: #0b7a4b; }
  .ta.err { border-color: #b00020; }
  .count { display: block; text-align: right; font-size: 0.78rem; color: #888; }
  .back { margin-top: 0.6rem; }
</style>
