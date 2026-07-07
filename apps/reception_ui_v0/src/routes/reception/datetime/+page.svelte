<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import DateField from '$lib/components/DateField.svelte';
  import SelectField from '$lib/components/SelectField.svelte';
  import Button from '$lib/components/Button.svelte';
  import Stepper from '$lib/components/Stepper.svelte';
  import { flow, save } from '$lib/reception.svelte';
  import { validateDateTime, isEmpty, needsDateTime, TIME_SLOTS } from '$lib/validation';

  let errors = $state<Record<string, string>>({});
  const today = new Date().toISOString().slice(0, 10);

  onMount(() => {
    if (!flow.token) return goto('/reception/tracking');
    if (!needsDateTime(flow.receptionType)) goto('/reception/type');
  });

  function onChange() {
    if (!isEmpty(errors)) errors = validateDateTime(flow, today);
  }

  function next() {
    errors = validateDateTime(flow, today);
    if (!isEmpty(errors)) return;
    save();
    goto('/reception/confirm');
  }
</script>

<Stepper current={4} total={6} />
<h1>ご希望の日時</h1>
<p class="lead">受け取りをご希望の日付と時間帯を選んでください。</p>

<DateField label="希望日" bind:value={flow.desiredDate} min={today} error={errors.desiredDate} onchange={onChange} />
<SelectField label="時間帯" bind:value={flow.timeSlot} options={TIME_SLOTS} error={errors.timeSlot} onchange={onChange} />

<Button onclick={next}>確認へ</Button>
<div class="back"><Button variant="secondary" onclick={() => goto('/reception/type')}>戻る</Button></div>

<style>
  h1 { font-size: 1.2rem; margin: 0 0 0.4rem; }
  .lead { color: #555; font-size: 0.92rem; margin: 0 0 1.1rem; }
  .back { margin-top: 0.6rem; }
</style>
