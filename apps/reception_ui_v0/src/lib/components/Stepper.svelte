<script lang="ts">
  // ステップ表示（任意）。current/total を点で表す。
  let { current, total }: { current: number; total: number } = $props();
  const dots = $derived(Array.from({ length: total }, (_, i) => i + 1));
</script>

<div class="stepper" aria-label="ステップ {current}/{total}">
  {#each dots as d (d)}
    <span class="dot" class:on={d <= current} class:cur={d === current}></span>
  {/each}
</div>

<style>
  .stepper { display: flex; gap: 0.35rem; justify-content: center; margin: 0.2rem 0 1rem; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #cdd5d0; }
  .dot.on { background: #0b7a4b; }
  .dot.cur { transform: scale(1.35); }
</style>
