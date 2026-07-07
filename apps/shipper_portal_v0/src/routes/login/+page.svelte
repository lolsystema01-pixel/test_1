<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/stores';

  let { data } = $props();
  let { supabase } = $derived(data);

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let errorMsg = $state('');
  let infoMsg = $state('');

  let queryError = $derived($page.url.searchParams.get('error'));

  // パスワードでログイン（その場でセッション確立 → ホームへ）
  async function signInWithPassword() {
    loading = true;
    errorMsg = '';
    infoMsg = '';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      errorMsg = error.message;
      loading = false;
      return;
    }
    await invalidate('supabase:auth');
    await goto('/');
  }

  // マジックリンクを送る（メールのリンク → /auth/callback でセッション確立）
  async function sendMagicLink() {
    if (!email) {
      errorMsg = 'メールアドレスを入力してください。';
      return;
    }
    loading = true;
    errorMsg = '';
    infoMsg = '';
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
    });
    loading = false;
    if (error) {
      errorMsg = error.message;
      return;
    }
    infoMsg = `${email} にログイン用リンクを送信しました。メールのリンクを開いてください。`;
  }
</script>

<section class="login">
  <h1>荷主ログイン</h1>
  <p class="lead">自社の荷物の状況確認・CSVアップロードにはログインしてください。</p>

  {#if queryError}
    <p class="error">ログインに失敗しました。リンクの期限切れの可能性があります。もう一度お試しください。</p>
  {/if}
  {#if errorMsg}<p class="error">{errorMsg}</p>{/if}
  {#if infoMsg}<p class="info">{infoMsg}</p>{/if}

  <form onsubmit={(e) => { e.preventDefault(); signInWithPassword(); }}>
    <label>メールアドレス
      <input type="email" bind:value={email} autocomplete="username" required disabled={loading} />
    </label>
    <label>パスワード
      <input type="password" bind:value={password} autocomplete="current-password" disabled={loading} />
    </label>
    <button type="submit" class="primary" disabled={loading}>
      {loading ? '処理中…' : 'パスワードでログイン'}
    </button>
  </form>

  <div class="divider"><span>または</span></div>

  <button class="secondary" onclick={sendMagicLink} disabled={loading}>
    マジックリンクをメールで送る
  </button>

  <p class="note">荷主アカウントは本部が発行します（パスワード／マジックリンク）。</p>
</section>

<style>
  .login {
    max-width: 380px;
    margin: 2rem auto;
    padding: 1.5rem;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }
  h1 {
    font-size: 1.25rem;
    margin: 0 0 0.5rem;
    text-align: center;
  }
  .lead {
    color: #555;
    margin: 0 0 1.25rem;
    text-align: center;
    font-size: 0.9rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: #555;
  }
  input {
    padding: 0.55rem 0.6rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.95rem;
  }
  .primary {
    padding: 0.7rem 1rem;
    font-size: 1rem;
    font-weight: 600;
    color: #fff;
    background: #0b5cab;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  .secondary {
    width: 100%;
    padding: 0.6rem 1rem;
    font-size: 0.95rem;
    color: #0b5cab;
    background: #fff;
    border: 1px solid #0b5cab;
    border-radius: 8px;
    cursor: pointer;
  }
  .primary:disabled,
  .secondary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .divider {
    display: flex;
    align-items: center;
    text-align: center;
    color: #aaa;
    font-size: 0.8rem;
    margin: 1rem 0;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid #eee;
  }
  .divider span {
    padding: 0 0.6rem;
  }
  .note {
    color: #888;
    font-size: 0.8rem;
    margin: 1rem 0 0;
    text-align: center;
  }
  .error {
    color: #b00020;
    font-size: 0.9rem;
  }
  .info {
    color: #0b6b3a;
    font-size: 0.9rem;
  }
</style>
