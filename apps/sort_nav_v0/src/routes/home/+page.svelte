<script lang="ts">
  // 営業所ホーム 概況カード（§12.0.1）：状態行・受信件数・配車済み・仮配車・最終配車実行・再予測合図。
  //   ・読むだけ（集計）。処理本体（予測配車=#25／仕分け／出力）は各機能（下のリンク）。
  //   ・Realtime：deliveries / delivery_status_log の変更を購読 → 自動で再集計（§12.0.1）。
  //   ・手動「状態更新」ボタンも保持。対象日カード（前日/今日/翌日・既定today）に連動（§12.0.2）。
  type OfficeHomeCard = {
    office_code: string;
    delivery_date: string;
    received: number;
    real_drivers: number;
    real_items: number;
    virt_drivers: number;
    virt_items: number;
    dispatched_items: number;
    sorted_items: number;
    last_dispatch_at: string | null;
    last_import_at: string | null;
    need_repredict: boolean;
    state_line: string;
    state_color: string;
  };
  let { data } = $props();
  let { supabase, officeCode } = $derived(data);

  // ローカル日付で統一（UTC変換だと today/shift がTZで1日ズレて前日/今日/翌日が二重点灯する）
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());
  const shift = (base: string, days: number) => {
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return ymd(d);
  };

  let date = $state<string>(data.date);
  let card = $state<OfficeHomeCard | null>(data.card);
  let updatedAt = $state<string>('');
  let live = $state(false); // Realtime購読中
  let refreshing = $state(false); // 状態更新の実行中
  let refreshMsg = $state(''); // 状態更新の結果（✓更新／エラー）
  let headcount = $state<number | null>(data.headcount ?? null); // 対象日の稼働人数（承認済み）
  let phMsg = $state(''); // 未実装セクションの通知

  // 対象日×自営業所の概況カードを取得（RLSで自営業所のみ）
  async function fetchCard(manual = false) {
    if (manual) {
      refreshing = true;
      refreshMsg = '';
    }
    try {
      const { data: row, error } = await supabase
        .from('office_home_summary')
        .select('*')
        .eq('office_code', officeCode)
        .eq('delivery_date', date)
        .maybeSingle();
      if (error) {
        if (manual) refreshMsg = `更新に失敗：${error.message}`;
        return;
      }
      card = (row as OfficeHomeCard | null) ?? null;
      updatedAt = new Date().toLocaleTimeString('ja-JP');
      if (manual) refreshMsg = `✓ 更新しました（${updatedAt}）`;
    } catch (e) {
      if (manual) refreshMsg = `更新に失敗：${e instanceof Error ? e.message : String(e)}`;
    } finally {
      if (manual) refreshing = false;
    }
  }

  // 稼働人数（対象日・承認済み・area RLSで自営業所ドライバーのみ）を読み取り（§12.0.3 セクション1）
  async function fetchHeadcount() {
    const { data: rows } = await supabase
      .from('work_schedules')
      .select('driver_id')
      .eq('work_date', date)
      .eq('application_status', '承認');
    headcount = rows ? new Set(rows.map((r: { driver_id: string }) => r.driver_id)).size : 0;
  }

  const notImpl = (name: string) => (phMsg = `「${name}」は準備中（未実装）です。導線のみ配置しています。`);

  // 受信0（データ無し）の既定表示
  const received = $derived(card?.received ?? 0);
  const stateLine = $derived(card?.state_line ?? '本日の受信はありません');
  const stateColor = $derived(card?.state_color ?? '緑');
  const needRepredict = $derived(card?.need_repredict ?? false);
  const fmtDt = (s: string | null) =>
    s ? new Date(s).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  // 予測対象日を変えると 概況カード・稼働人数 が連動して再取得（§12.0.2）
  $effect(() => {
    date;
    fetchCard();
    fetchHeadcount();
  });

  // Realtime購読（DB変更を即反映）。購読は一度だけ張り、変更時に現在の対象日で再集計。
  $effect(() => {
    const ch = supabase
      .channel('office_home')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => fetchCard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_status_log' }, () => fetchCard())
      .subscribe((status: string) => {
        live = status === 'SUBSCRIBED';
      });
    return () => {
      supabase.removeChannel(ch);
    };
  });
</script>

<section class="bar">
  <div><strong>営業所ホーム</strong> <span class="office">{officeCode}</span></div>
  <div class="controls">
    <button class="refresh" onclick={() => fetchCard(true)} disabled={refreshing}>
      {refreshing ? '更新中…' : '状態更新'}
    </button>
    <span class="live" class:on={live} title={live ? 'リアルタイム更新中' : '未接続'}>● {live ? 'LIVE' : '—'}</span>
  </div>
</section>

<!-- 予測対象日カード（§12.0.2：ホーム全体の連動キー） -->
<section class="datecard-box">
  <span class="dc-label">予測対象日</span>
  <div class="dc-controls">
    <button class="q" class:on={date === shift(today(), -1)} onclick={() => (date = shift(today(), -1))}>前日</button>
    <button class="q" class:on={date === today()} onclick={() => (date = today())}>今日</button>
    <button class="q" class:on={date === shift(today(), 1)} onclick={() => (date = shift(today(), 1))}>翌日</button>
    <input type="date" bind:value={date} />
  </div>
  <span class="dc-note">この日付に 概況カード・稼働人数・ドライバー予測 が連動します</span>
</section>

{#if refreshMsg}<p class="refreshmsg" class:err={refreshMsg.startsWith('更新に失敗')}>{refreshMsg}</p>{/if}
{#if phMsg}<p class="refreshmsg ph-note">{phMsg} <button class="dismiss" onclick={() => (phMsg = '')}>×</button></p>{/if}

<!-- 状態行（青=作業中／緑=完了） -->
<section class="stateline" class:blue={stateColor === '青'} class:green={stateColor === '緑'}>
  <span class="dot"></span>
  <span class="txt">{stateLine}</span>
  <span class="meta">{date}{updatedAt ? ` ・更新 ${updatedAt}` : ''}</span>
</section>

<!-- 再予測合図（新規受信 > 最終配車実行） -->
{#if needRepredict}
  <section class="repredict">
    ⚠ 最終配車実行のあとに新規受信があります。<strong>再予測してください</strong>（自動再予測はしません・運用者判断）。
  </section>
{/if}

<!-- 概況カードの4項目 -->
<section class="cards">
  <div class="card">
    <span class="k">受信件数</span>
    <span class="v">{received}</span>
    <span class="u">件</span>
  </div>
  <div class="card ok">
    <span class="k">配車済み（実ドライバー）</span>
    <span class="v">{card?.real_drivers ?? 0}<small> 人</small> / {card?.real_items ?? 0}<small> 件</small></span>
  </div>
  <div class="card" class:warn={(card?.virt_items ?? 0) > 0}>
    <span class="k">仮配車（仮ドライバー）</span>
    <span class="v">{card?.virt_drivers ?? 0}<small> 人</small> / {card?.virt_items ?? 0}<small> 件</small></span>
    <span class="u">{(card?.virt_items ?? 0) > 0 ? '仮配車あり（0が理想）' : '0（理想）'}</span>
  </div>
  <div class="card">
    <span class="k">最終配車実行</span>
    <span class="v sm">{fmtDt(card?.last_dispatch_at ?? null)}</span>
    <span class="u">再予測判定の基準</span>
  </div>
</section>

<!-- 5セクション構造（§12.0.3・マニュアル踏襲）。導線と日付連動のみ（機能本体は各機能側） -->
<section class="sections">
  <!-- 1. スケジュール作成 -->
  <div class="sec">
    <h3>1. スケジュール作成</h3>
    <p class="sec-metric">稼働人数 <strong>{headcount ?? '—'}</strong> 人<span class="sub">（{date}・承認済み）</span></p>
    <div class="sec-actions">
      <button class="ph" onclick={() => notImpl('シフト管理')}>シフト管理</button>
      <button class="ph" onclick={() => notImpl('3か月分一括作成')}>3か月分一括作成</button>
    </div>
  </div>

  <!-- 2. ドライバー予測 -->
  <div class="sec">
    <h3>2. ドライバー予測</h3>
    <p class="sec-desc">自動割当エンジンで予測配車・採番を実行します。</p>
    <div class="sec-actions">
      <a class="go" href="/demo?date={date}">予測を実行</a>
    </div>
  </div>

  <!-- 3. 仕分けナビ -->
  <div class="sec">
    <h3>3. 仕分けナビ</h3>
    <p class="sec-desc">スキャンで仕分けを進めます。</p>
    <div class="sec-actions">
      <a class="go" href="/sort">仕分けナビを開く</a>
    </div>
  </div>

  <!-- 4. 出力 -->
  <div class="sec">
    <h3>4. 出力</h3>
    <p class="sec-desc">帳票をPDF/CSVで出力します。</p>
    <div class="sec-actions">
      <a href="/sheet?date={date}">配車表PDF</a>
      <a href="/godoor">GoDoor CSV</a>
      <a href="/carry">かご持出表PDF</a>
      <a href="/label">ラベル印刷</a>
      <button class="ph" onclick={() => notImpl('3点まとめ出力')}>3点まとめ出力</button>
    </div>
  </div>

  <!-- 5. 管理者設定 -->
  <div class="sec">
    <h3>5. 管理者設定</h3>
    <div class="sec-actions">
      <button class="ph" onclick={() => notImpl('システム設定')}>システム設定</button>
      <button class="ph" onclick={() => notImpl('データ再同期')}>データ再同期</button>
      <form method="POST" action="/auth/signout" class="signout"><button class="danger" type="submit">ログアウト</button></form>
    </div>
  </div>
</section>

<p class="note">
  ※ 本ホームは「予測対象日カード（連動キー）＋概況カード＋5セクション導線」（§12.0.2／§12.0.3）。
  各セクションのリンク先機能の本体は各機能側。「準備中」は未実装のプレースホルダ導線です。
</p>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
  .office { background: #0b7a4b; color: #fff; border-radius: 5px; padding: 0.05rem 0.5rem; font-size: 0.8rem; }
  .controls { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .q { background: #fff; border: 1px solid #bbb; border-radius: 6px; padding: 0.3rem 0.7rem; cursor: pointer; }
  .q.on { background: #0b5cab; color: #fff; border-color: #0b5cab; }
  .refresh { background: #f1f3f5; border: 1px solid #aaa; border-radius: 6px; padding: 0.3rem 0.8rem; cursor: pointer; }
  .refresh:disabled { opacity: 0.6; cursor: not-allowed; }
  .refreshmsg { margin: -0.4rem 0 0.8rem; font-size: 0.85rem; color: #0b5a36; }
  .refreshmsg.err { color: #b00020; }
  .ph-note { color: #7a5a00; }
  .dismiss { background: none; border: none; color: #999; cursor: pointer; font-size: 1rem; padding: 0 0.2rem; }
  .live { font-size: 0.8rem; color: #bbb; }
  .live.on { color: #0b7a4b; font-weight: 700; }

  .stateline { display: flex; align-items: center; gap: 0.6rem; border-radius: 8px; padding: 0.8rem 1rem; margin-bottom: 0.8rem; font-size: 1.05rem; font-weight: 700; }
  .stateline.blue { background: #eaf1fb; color: #0b3f7a; border: 1px solid #0b5cab; }
  .stateline.green { background: #eaf6ee; color: #0b5a36; border: 1px solid #0b7a4b; }
  .stateline .dot { width: 12px; height: 12px; border-radius: 50%; background: currentColor; }
  .stateline .meta { margin-left: auto; font-size: 0.78rem; font-weight: 400; opacity: 0.75; }

  .repredict { background: #fff4e5; border: 1px solid #e08a00; color: #8a5300; border-radius: 8px; padding: 0.6rem 1rem; margin-bottom: 0.8rem; font-size: 0.92rem; }

  .cards { display: flex; gap: 0.7rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 0.7rem 1rem; min-width: 170px; flex: 1; display: flex; flex-direction: column; gap: 0.15rem; }
  .card.ok { border-color: #0b7a4b; }
  .card.warn { border-color: #e08a00; background: #fffaf2; }
  .card .k { font-size: 0.8rem; color: #666; }
  .card .v { font-size: 1.7rem; font-weight: 800; color: #143; }
  .card .v.sm { font-size: 1.1rem; }
  .card .v small { font-size: 0.9rem; font-weight: 600; color: #567; }
  .card .u { font-size: 0.74rem; color: #8a8a8a; }
  .card.warn .u { color: #b06a00; }

  /* 予測対象日カード（連動キー） */
  .datecard-box { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; background: #f4f8fc; border: 1px solid #bcd3ec; border-radius: 10px; padding: 0.6rem 1rem; margin-bottom: 0.9rem; }
  .datecard-box .dc-label { font-weight: 800; color: #0b3f7a; }
  .dc-controls { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .dc-note { color: #6a7f97; font-size: 0.78rem; margin-left: auto; }

  /* 5セクション構造 */
  .sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.7rem; margin-bottom: 0.8rem; }
  .sec { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 0.8rem 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .sec h3 { margin: 0; font-size: 0.98rem; color: #143; }
  .sec-desc { margin: 0; font-size: 0.82rem; color: #777; }
  .sec-metric { margin: 0; font-size: 0.95rem; color: #333; }
  .sec-metric strong { font-size: 1.5rem; font-weight: 800; color: #0b5cab; }
  .sec-metric .sub { font-size: 0.75rem; color: #8a8a8a; margin-left: 0.3rem; }
  .sec-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: auto; align-items: center; }
  .sec-actions a, .sec-actions .ph { border-radius: 20px; padding: 0.35rem 0.9rem; font-size: 0.85rem; text-decoration: none; cursor: pointer; }
  .sec-actions a { background: #fff; border: 1px solid #ccd; color: #0b5cab; }
  .sec-actions a:hover { background: #eef3fb; }
  .sec-actions a.go { background: #0b7a4b; border-color: #0b7a4b; color: #fff; font-weight: 700; }
  .sec-actions a.go:hover { background: #096b41; }
  .ph { background: #f3f4f6; border: 1px dashed #b8bcc4; color: #7a7f88; }
  .ph::after { content: '（準備中）'; font-size: 0.7rem; }
  .signout { margin: 0; }
  .danger { background: #fff; border: 1px solid #b00020; color: #b00020; border-radius: 20px; padding: 0.35rem 0.9rem; font-size: 0.85rem; cursor: pointer; }
  .danger:hover { background: #fdecef; }
  .note { color: #999; font-size: 0.78rem; }
</style>
