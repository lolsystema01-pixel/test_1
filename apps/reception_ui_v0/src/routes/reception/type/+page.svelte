<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import RadioGroup from '$lib/components/RadioGroup.svelte';
  import Button from '$lib/components/Button.svelte';
  import Stepper from '$lib/components/Stepper.svelte';
  import { flow, save } from '$lib/reception.svelte';
  import { validateType, isEmpty, needsDropPlace, RECEPTION_TYPES } from '$lib/validation';

  let errors = $state<Record<string, string>>({});

  onMount(() => {
    if (!flow.token) goto('/reception/tracking');
  });

  function onChange() {
    errors = {};
  }

  function next() {
    errors = validateType(flow);
    if (!isEmpty(errors)) return;
    save();
    // 分岐：置き配→置き配場所 ／ 再配達・時間変更→希望日時
    goto(needsDropPlace(flow.receptionType) ? '/reception/place' : '/reception/datetime');
  }
</script>

<Stepper current={3} total={6} />
<h1>ご希望の手続き</h1>
<p class="lead">ご希望の受付種別を選んでください。</p>

<RadioGroup label="受付種別" bind:value={flow.receptionType} options={RECEPTION_TYPES} error={errors.receptionType} onchange={onChange} />

<Button onclick={next}>次へ</Button>

<style>
  h1 { font-size: 1.2rem; margin: 0 0 0.4rem; }
  .lead { color: #555; font-size: 0.92rem; margin: 0 0 1.1rem; }
</style>
