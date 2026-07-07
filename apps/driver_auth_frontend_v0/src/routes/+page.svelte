<script lang="ts">
  import { goto } from '$app/navigation';

  let { data } = $props();

  function onDate(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (v) goto(`/?date=${v}`);
  }
</script>

<section class="card">
  <div class="card-head">
    <h1>担当荷物</h1>
    <form method="POST" action="/auth/signout">
      <button type="submit" class="signout">ログアウト</button>
    </form>
  </div>

  <dl class="profile">
    <dt>ドライバーID</dt>
    <dd>{data.driver?.driver_id ?? data.profile.driver_id}</dd>
    <dt>氏名</dt>
    <dd>{data.driver?.driver_name ?? '—'}</dd>
    <dt>所属営業所</dt>
    <dd>{data.officeCode ?? '—'}</dd>
    <dt>ログイン</dt>
    <dd class="muted">{data.email ?? '—'}</dd>
  </dl>
</section>

<section class="card">
  <div class="list-head">
    <h2>配送一覧 <span class="count">{data.deliveries.length}件</span></h2>
    <label class="date">対象日 <input type="date" value={data.date} onchange={onDate} /></label>
  </div>

  {#if data.deliveriesError}
    <p class="error">荷物の取得に失敗しました：{data.deliveriesError}</p>
  {:else if data.deliveries.length === 0}
    <p class="empty">対象日（{data.date}）の担当の荷物はありません。</p>
  {:else}
    <table class="deliveries">
      <thead>
        <tr>
          <th>配達順</th>
          <th>かご</th>
          <th>問合番号</th>
          <th>配送先住所</th>
          <th>氏名</th>
          <th>時間</th>
          <th>状態</th>
        </tr>
      </thead>
      <tbody>
        {#each data.deliveries as d (d.tracking_number)}
          <tr>
            <td class="num">{d.delivery_order ?? '—'}</td>
            <td class="kago">{d.basket_code ?? '—'}</td>
            <td>{d.tracking_number}</td>
            <td class="addr">{d.address ?? '—'}</td>
            <td>{d.recipient_name ?? '—'}</td>
            <td>{d.time_window ?? '—'}</td>
            <td>{d.status}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <p class="rls-note">※ 表示は RLS により「自分が担当の荷物」のみ・配達順に表示。他ドライバーの荷物は0件。読み取り専用（配達処理は §8.5）。</p>
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
    align-items: center;
    justify-content: space-between;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0;
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
  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .date {
    font-size: 0.85rem;
    color: #555;
  }
  .num,
  .kago {
    text-align: center;
  }
  .kago {
    font-weight: 700;
    color: #0b5cab;
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
    max-width: 200px;
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
