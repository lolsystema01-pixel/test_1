<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { onMount } from 'svelte';

  let { data, children } = $props();
  let { supabase, session } = $derived(data);

  onMount(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession?.expires_at !== session?.expires_at) {
        invalidate('supabase:auth');
      }
    });
    return () => authListener.subscription.unsubscribe();
  });
</script>

<header class="app-header">
  <span class="app-title">LOL 仕分けナビ <small>v0 / 営業所</small></span>
</header>

<main class="app-main">
  {@render children()}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', Meiryo, sans-serif;
    color: #1a1a1a;
    background: #f5f6f8;
  }
  .app-header {
    background: #0b7a4b;
    color: #fff;
    padding: 0.6rem 1rem;
  }
  .app-title {
    font-weight: 600;
  }
  .app-title small {
    opacity: 0.85;
    font-weight: 400;
  }
  .app-main {
    max-width: 920px;
    margin: 0 auto;
    padding: 1rem;
  }
</style>
