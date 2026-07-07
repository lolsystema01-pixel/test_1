<script lang="ts">
  import FieldError from './FieldError.svelte';
  // 共通選択（時間帯など）。
  type Props = {
    label: string;
    value: string;
    options: readonly string[];
    error?: string;
    placeholder?: string;
    onchange?: () => void;
  };
  let { label, value = $bindable(), options, error, placeholder = '選択してください', onchange }: Props = $props();
</script>

<label class="field">
  <span class="label">{label}</span>
  <select class="select" class:error={!!error} bind:value {onchange}>
    <option value="" disabled>{placeholder}</option>
    {#each options as opt (opt)}
      <option value={opt}>{opt}</option>
    {/each}
  </select>
  <FieldError message={error} />
</label>

<style>
  .field { display: block; margin-bottom: 1rem; }
  .label { display: block; font-size: 0.9rem; font-weight: 600; margin-bottom: 0.3rem; }
  .select {
    width: 100%; min-height: 48px; padding: 0 0.8rem; font-size: 1.05rem;
    border: 2px solid #cdd5d0; border-radius: 8px; background: #fff; box-sizing: border-box;
  }
  .select:focus { outline: none; border-color: #0b7a4b; }
  .select.error { border-color: #b00020; }
</style>
