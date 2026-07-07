<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="shell">
  <header class="hd">
    <span class="brand">LOL 配送</span>
    <span class="ttl">再配達・お受け取りのお手続き</span>
  </header>
  <main class="main">
    {@render children?.()}
  </main>
  <footer class="ft">
    <span>不在票のQR・URLからのお手続きページです（検証環境・ダミー）。</span>
  </footer>
</div>

<style>
  .shell { max-width: 480px; margin: 0 auto; min-height: 100dvh; display: flex; flex-direction: column; background: #fff; }
  .hd { background: #0b7a4b; color: #fff; padding: 0.7rem 1rem; display: flex; flex-direction: column; gap: 0.1rem; }
  .brand { font-size: 0.75rem; opacity: 0.85; }
  .ttl { font-size: 1.05rem; font-weight: 700; }
  .main { flex: 1; padding: 1.1rem 1.1rem 1.5rem; }
  .ft { padding: 0.8rem 1.1rem 1.2rem; color: #888; font-size: 0.72rem; border-top: 1px solid #eef0ef; }
</style>
