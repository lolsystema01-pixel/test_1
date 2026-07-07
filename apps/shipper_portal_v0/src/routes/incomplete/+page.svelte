<script lang="ts">
  // 登録未完了：ログイン済みだが profiles に role=shipper / shipper_id が未設定。
  // 本部のオンボーディング（本部発行）で荷主アカウントが付与されると利用可能になる。
</script>

<section class="card">
  <h1>登録が完了していません</h1>
  <p>
    アカウントは確認できましたが、<strong>荷主としての登録</strong>がまだ完了していません。
  </p>
  <p class="muted">
    本部による荷主ID（所属荷主）の割り当て（オンボーディング＝本部発行）が済むと、
    自社の荷物の状況確認・CSVアップロードが使えるようになります。
  </p>

  <form method="POST" action="/auth/signout">
    <button type="submit" class="signout">ログアウト</button>
  </form>
</section>

<style>
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    padding: 1.5rem;
    max-width: 460px;
    margin: 2rem auto;
    text-align: center;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0 0 1rem;
  }
  .muted {
    color: #666;
    font-size: 0.9rem;
  }
  .signout {
    margin-top: 1rem;
    background: #0b5cab;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0.55rem 1rem;
    cursor: pointer;
  }
</style>
