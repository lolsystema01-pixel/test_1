<script lang="ts">
  import FieldError from './FieldError.svelte';
  // 希望日（今日以降）。min で過去日を抑止（検証はD章でも再チェック）。
  type Props = {
    label: string;
    value: string;
    min?: string;
    error?: string;
    onchange?: () => void;
  };
  let { label, value = $bindable(), min, error, onchange }: Props = $props();
</script>

<label class="field">
  <span class="label">{label}</span>
  <input class="input" class:error={!!error} type="date" {min} bind:value {onchange} />
  <FieldError message={error} />
</label>

<style>
  .field { display: block; margin-bottom: 1rem; }
  .label { display: block; font-size: 0.9rem; font-weight: 600; margin-bottom: 0.3rem; }
  .input {
    width: 100%; min-height: 48px; padding: 0 0.8rem; font-size: 1.05rem;
    border: 2px solid #cdd5d0; border-radius: 8px; box-sizing: border-box;
  }
  .input:focus { outline: none; border-color: #0b7a4b; }
  .input.error { border-color: #b00020; }
</style>
