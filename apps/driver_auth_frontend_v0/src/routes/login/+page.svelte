<script lang="ts">
  import { page } from '$app/stores';

  let { data } = $props();
  let { supabase } = $derived(data);
  let loading = $state(false);
  let errorMsg = $state('');

  // ON にすると毎回 Google のアカウント選択画面を出す（別アカウントで入りたいとき）。
  // OFF（既定）なら、ブラウザに残っている Google アカウントでそのままログイン。
  let chooseAccount = $state(false);

  // コールバックでエラーになって戻ってきた場合の表示
  let queryError = $derived($page.url.searchParams.get('error'));

  async function signInWithGoogle() {
    loading = true;
    errorMsg = '';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // チェックON時のみ、アカウント選択を強制する。
        ...(chooseAccount ? { queryParams: { prompt: 'select_account' } } : {})
      }
    });
    if (error) {
      errorMsg = error.message;
      loading = false;
    }
    // 成功時は Google の同意画面へ遷移するのでここには戻らない
  }
</script>

<section class="login">
  <h1>ドライバーログイン</h1>
  <p class="lead">担当の荷物を確認するにはログインしてください。</p>

  {#if queryError}
    <p class="error">ログインに失敗しました。もう一度お試しください。</p>
  {/if}
  {#if errorMsg}
    <p class="error">{errorMsg}</p>
  {/if}

  <button class="google-btn" onclick={signInWithGoogle} disabled={loading}>
    {loading ? 'リダイレクト中…' : 'Google でログイン'}
  </button>

  <label class="choose">
    <input type="checkbox" bind:checked={chooseAccount} disabled={loading} />
    別のアカウントを選んでログインする
  </label>

  <p class="note">社内向けの Google アカウントでログインします。</p>
</section>

<style>
  .login {
    max-width: 360px;
    margin: 2rem auto;
    padding: 1.5rem;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    text-align: center;
  }
  h1 {
    font-size: 1.25rem;
    margin: 0 0 0.5rem;
  }
  .lead {
    color: #555;
    margin: 0 0 1.25rem;
  }
  .google-btn {
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    font-weight: 600;
    color: #fff;
    background: #0b5cab;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  .google-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .choose {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    margin: 0.85rem 0 0;
    font-size: 0.85rem;
    color: #555;
    cursor: pointer;
  }
  .note {
    color: #888;
    font-size: 0.8rem;
    margin: 1rem 0 0;
  }
  .error {
    color: #b00020;
    font-size: 0.9rem;
  }
</style>
