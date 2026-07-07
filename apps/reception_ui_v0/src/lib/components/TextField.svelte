<script lang="ts">
  import FieldError from './FieldError.svelte';
  // 共通入力欄（テキスト/数字）。状態＝通常/フォーカス/エラー/無効。直下にエラー赤字。
  type Props = {
    label: string;
    value: string;
    error?: string;
    type?: 'text' | 'tel' | 'number';
    placeholder?: string;
    inputmode?: 'text' | 'numeric' | 'tel';
    maxlength?: number;
    disabled?: boolean;
    hint?: string;
    oninput?: () => void;
  };
  let {
    label,
    value = $bindable(),
    error,
    type = 'text',
    placeholder = '',
    inputmode = 'text',
    maxlength,
    disabled = false,
    hint,
    oninput
  }: Props = $props();
</script>

<label class="field">
  <span class="label">{label}</span>
  <input
    class="input"
    class:error={!!error}
    {type}
    {inputmode}
    {placeholder}
    {maxlength}
    {disabled}
    bind:value
    {oninput}
  />
  {#if hint}<span class="hint">{hint}</span>{/if}
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
  .input:disabled { background: #f2f4f3; }
  .hint { display: block; font-size: 0.8rem; color: #777; margin-top: 0.25rem; }
</style>
