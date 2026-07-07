<script lang="ts">
  // ログイン済みだが area（営業所）ロール／所属営業所が未設定。
  // 本部が role=area・所属営業所を割り当てると仕分けナビを使える。
</script>

<section class="card">
  <h1>営業所の権限がありません</h1>
  <p>
    アカウントは確認できましたが、<strong>営業所オペレータ（area）としての設定</strong>がまだです。
  </p>
  <p class="muted">
    本部による role=area・所属営業所の割り当てが済むと、仕分けナビを利用できます。
  </p>

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
  .signout {
    margin-top: 1rem; background: #0b7a4b; color: #fff; border: none;
    border-radius: 6px; padding: 0.55rem 1rem; cursor: pointer;
  }
</style>
