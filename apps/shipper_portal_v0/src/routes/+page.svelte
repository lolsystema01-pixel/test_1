<script lang="ts">
  let { data } = $props();
</script>

<section class="card">
  <div class="card-head">
    <div>
      <h1>状況確認</h1>
      <p class="sub">自社の荷物の配送状況を確認できます。</p>
    </div>
    <form method="POST" action="/auth/signout">
      <button type="submit" class="signout">ログアウト</button>
    </form>
  </div>

  <dl class="profile">
    <dt>荷主ID</dt>
    <dd>{data.shipperId}</dd>
    <dt>荷主名称</dt>
    <dd>{data.shipperName ?? '—'}</dd>
    <dt>ログイン</dt>
    <dd class="muted">{data.email ?? '—'}</dd>
  </dl>

  <nav class="tabs">
    <a class="tab active" href="/">状況確認</a>
    <a class="tab" href="/upload">CSVアップロード</a>
  </nav>
</section>

<section class="card">
  <div class="list-head">
    <h2>自社荷物 <span class="count">{data.deliveries.length}件</span></h2>
  </div>

  {#if data.deliveriesError}
    <p class="error">荷物の取得に失敗しました：{data.deliveriesError}</p>
  {:else if data.deliveries.length === 0}
    <p class="empty">自社の荷物はまだありません。「CSVアップロード」から登録できます。</p>
  {:else}
    <table class="deliveries">
      <thead>
        <tr>
          <th>問合番号</th>
          <th>配送先住所</th>
          <th>氏名</th>
          <th>配達予定</th>
          <th>時間</th>
          <th>状態</th>
        </tr>
      </thead>
      <tbody>
        {#each data.deliveries as d (d.tracking_number)}
          <tr>
            <td>{d.tracking_number}</td>
            <td class="addr">{d.address ?? '—'}</td>
            <td>{d.recipient_name ?? '—'}</td>
            <td>{d.delivery_date ?? '—'}</td>
            <td>{d.time_window ?? '—'}</td>
            <td><span class="status">{d.status}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <p class="rls-note">
    ※ 表示は RLS により「自社の荷物」のみ。他社の荷物は0件。読み取り専用（状況の書き込み・再配達受付は範囲外＝7.1）。
  </p>
</section>

<style>
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0;
  }
  .sub {
    color: #666;
    font-size: 0.85rem;
    margin: 0.25rem 0 0;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
  }
  .count {
    color: #0b5cab;
    font-weight: 600;
    margin-left: 0.25rem;
  }
  .signout {
    background: #fff;
    color: #0b5cab;
    border: 1px solid #0b5cab;
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .profile {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 1rem;
    margin: 1rem 0 0;
  }
  .profile dt {
    color: #777;
    font-size: 0.85rem;
  }
  .profile dd {
    margin: 0;
    font-weight: 600;
  }
  .profile dd.muted {
    font-weight: 400;
    color: #555;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    border-bottom: 1px solid #eee;
  }
  .tab {
    padding: 0.5rem 0.85rem;
    text-decoration: none;
    color: #555;
    font-size: 0.9rem;
    border-bottom: 2px solid transparent;
  }
  .tab.active {
    color: #0b5cab;
    font-weight: 600;
    border-bottom-color: #0b5cab;
  }
  table.deliveries {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  .deliveries th,
  .deliveries td {
    text-align: left;
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid #eee;
  }
  .deliveries th {
    color: #777;
    font-weight: 600;
    font-size: 0.8rem;
  }
  .addr {
    max-width: 260px;
  }
  .status {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    background: #eef3fa;
    color: #0b5cab;
    border-radius: 999px;
    font-size: 0.8rem;
  }
  .empty {
    color: #777;
  }
  .error {
    color: #b00020;
  }
  .rls-note {
    color: #999;
    font-size: 0.78rem;
    margin: 0.75rem 0 0;
  }
</style>
