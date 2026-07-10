<script lang="ts">
  // ログイン済みだが area（営業所）ロール／所属営業所が未設定。
  // 本部が role=area・所属営業所を割り当てると仕分けナビを使える。
  // hq（本部/管理者）は営業所ホームを持たないため、ここから管理者設定へ抜けられるようにする。
  let { data } = $props();
</script>

<section class="card">
  {#if data.role === 'hq'}
    <h1>本部（hq）としてログイン中です</h1>
    <p>この画面は<strong>営業所オペレータ（area）専用</strong>です。</p>
    <p class="muted">本部が使うのは管理者設定（§12.13）です。</p>
    <a class="primary" href="/admin/settings">管理者設定へ</a>
  {:else}
    <h1>営業所の権限がありません</h1>
    <p>
      アカウントは確認できましたが、<strong>営業所オペレータ（area）としての設定</strong>がまだです。
    </p>
    <p class="muted">
      本部による role=area・所属営業所の割り当てが済むと、仕分けナビを利用できます。
    </p>
  {/if}

  <form method="POST" action="/auth/signout">
    <button type="submit" class="signout">ログアウト</button>
  </form>
</section>

<style>
  .card {
    background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    padding: 1.5rem; max-width: 440px; margin: 2rem auto; text-align: center;
  }
  h1 { font-size: 1.2rem; margin: 0 0 1rem; }
  .muted { color: #666; font-size: 0.9rem; }
  .primary {
    display: inline-block; margin-top: 0.6rem; background: #0b5cab; color: #fff;
    border-radius: 6px; padding: 0.55rem 1.2rem; text-decoration: none; font-weight: 700;
  }
  .signout {
    margin-top: 1rem; background: #0b7a4b; color: #fff; border: none;
    border-radius: 6px; padding: 0.55rem 1rem; cursor: pointer;
  }
</style>
