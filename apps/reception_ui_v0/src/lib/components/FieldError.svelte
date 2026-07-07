<script lang="ts">
  // D章：エラーは該当項目の直下に赤字で表示。
  let { message }: { message?: string } = $props();
</script>

{#if message}
  <p class="err" role="alert">{message}</p>
{/if}

<style>
  .err { color: #b00020; font-size: 0.85rem; margin: 0.3rem 0 0; }
</style>
