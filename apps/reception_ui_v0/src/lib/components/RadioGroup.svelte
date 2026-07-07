<script lang="ts">
  import FieldError from './FieldError.svelte';
  // 受付種別など、必須の単一選択（大きめタップ域・スマホ最適）。
  type Props = {
    label: string;
    value: string;
    options: readonly string[];
    error?: string;
    onchange?: () => void;
  };
  let { label, value = $bindable(), options, error, onchange }: Props = $props();
  function pick(o: string) {
    value = o;
    onchange?.();
  }
</script>

<fieldset class="group" class:error={!!error}>
  <legend class="label">{label}</legend>
  <div class="opts">
    {#each options as opt (opt)}
      <button type="button" class="opt" class:active={value === opt} onclick={() => pick(opt)}>
        {opt}
      </button>
    {/each}
  </div>
  <FieldError message={error} />
</fieldset>

<style>
  .group { border: none; padding: 0; margin: 0 0 1rem; }
  .label { font-size: 0.9rem; font-weight: 600; margin-bottom: 0.4rem; padding: 0; }
  .opts { display: flex; flex-direction: column; gap: 0.5rem; }
  .opt {
    min-height: 50px; border: 2px solid #cdd5d0; border-radius: 8px; background: #fff;
    font-size: 1.05rem; cursor: pointer; text-align: left; padding: 0 1rem;
  }
  .opt.active { border-color: #0b7a4b; background: #e7f6ee; font-weight: 700; }
</style>
