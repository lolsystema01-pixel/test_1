<script lang="ts">
  // 共通ボタン（次へ/戻る/送信）。状態＝通常/無効/ローディング。スマホ最適（大きめタップ域）。
  type Props = {
    type?: 'button' | 'submit';
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
    loading?: boolean;
    onclick?: () => void;
    children?: import('svelte').Snippet;
  };
  let { type = 'button', variant = 'primary', disabled = false, loading = false, onclick, children }: Props = $props();
</script>

<button {type} class="btn {variant}" disabled={disabled || loading} {onclick}>
  {#if loading}<span class="spinner" aria-hidden="true"></span>{/if}
  {@render children?.()}
</button>

<style>
  .btn {
    width: 100%;
    min-height: 52px;
    border: none;
    border-radius: 10px;
    font-size: 1.05rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .primary { background: #0b7a4b; color: #fff; }
  .secondary { background: #eef2f0; color: #0b7a4b; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .spinner {
    width: 1rem; height: 1rem; border: 2px solid currentColor; border-right-color: transparent;
    border-radius: 50%; display: inline-block; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
