<script lang="ts">
  // 管理者設定（§12.13）：かご台車上限・かご振り順・自動ログアウト・印刷機種を営業所別に編集。
  //   ・保存は SECURITY DEFINER 関数 update_office_settings（hqのみ）。offices に write policy は無い。
  //   ・「かご振り順」の DB値 'ドライバー順' は、実装が【担当件数の多い順】のため画面ラベルもそれに合わせる。
  //   ・未設定(空欄)は「消費側の既定を使う」の意味（かご台車上限=50／自動ログアウト=有効30分／印刷=TD-2350）。
  type OfficeSetting = {
    office_code: string;
    office_name: string;
    basket_cart_limit: number | null;
    basket_order: string;
    auto_logout_enabled: boolean | null;
    auto_logout_minutes: number | null;
    printer_model: string | null;
  };
  let { data } = $props();
  let { supabase, canEdit, role } = $derived(data);

  // DB値 → 画面ラベル（§12.12 の3択。'ドライバー順' の実装は担当件数の多い順）
  const ORDER_OPTIONS = [
    { value: 'ドライバー順', label: '担当件数の多い順' },
    { value: '配達順順', label: '配達順に従う' },
    { value: 'ゾーン順', label: 'ゾーン順に従う' }
  ] as const;
  const PRINTER_OPTIONS = ['Brother TD-2350', '汎用サーマル'] as const;

  let rows = $state<OfficeSetting[]>(structuredClone(data.offices));
  let saving = $state('');
  let msg = $state('');
  let msgErr = $state(false);

  const numOrNull = (v: number | string | null) =>
    v === '' || v === null || Number.isNaN(Number(v)) ? null : Number(v);

  async function save(o: OfficeSetting) {
    saving = o.office_code;
    msg = '';
    msgErr = false;
    const { error } = await supabase.rpc('update_office_settings', {
      p_office_code: o.office_code,
      p_basket_cart_limit: numOrNull(o.basket_cart_limit),
      p_basket_order: o.basket_order,
      p_auto_logout_enabled: o.auto_logout_enabled,
      p_auto_logout_minutes: numOrNull(o.auto_logout_minutes),
      p_printer_model: o.printer_model || null
    });
    if (error) {
      msgErr = true;
      msg = `${o.office_code} の保存に失敗：${[error.message, error.details, error.hint].filter(Boolean).join(' ／ ')}`;
    } else {
      msg = `${o.office_code} を保存しました。`;
    }
    saving = '';
  }

  // 再読込して保持を確認（保存後の実値をDBから取り直す）
  async function reload() {
    const { data: fresh, error } = await supabase
      .from('offices')
      .select('office_code, office_name, basket_cart_limit, basket_order, auto_logout_enabled, auto_logout_minutes, printer_model')
      .order('office_code', { ascending: true });
    if (error) {
      msgErr = true;
      msg = `再読込に失敗：${error.message}`;
      return;
    }
    rows = (fresh as OfficeSetting[]) ?? [];
    msgErr = false;
    msg = '再読込しました（保存値が保持されているか確認してください）。';
  }
</script>

<section class="bar">
  <div><a href="/home" class="back">← 営業所ホーム</a> <strong>管理者設定</strong></div>
  <div class="right">
    <span class="role" class:hq={canEdit}>{role}{canEdit ? '（編集可）' : '（参照のみ）'}</span>
    <button class="reload" onclick={reload}>再読込</button>
  </div>
</section>

<p class="lead">営業所別の運用設定です。<strong>日常的には触りません</strong>（不具合や設定変更時のみ）。</p>

{#if data.loadError}<p class="msg err">読み込みに失敗しました：{data.loadError}</p>{/if}
{#if !canEdit}
  <p class="msg warn">編集は管理者/HQのみです。現在は参照のみ表示しています。</p>
{/if}
{#if msg}<p class="msg" class:err={msgErr}>{msg}</p>{/if}

{#if rows.length === 0}
  <p class="muted">対象の営業所がありません。</p>
{/if}

{#each rows as o (o.office_code)}
  <section class="card">
    <h3>{o.office_code} <span class="name">{o.office_name}</span></h3>

    <div class="grid">
      <label>
        かご台車上限個数
        <input type="number" min="1" max="500" placeholder="未設定（50を使用）"
               bind:value={o.basket_cart_limit} disabled={!canEdit} />
        <small>1台のかご台車に乗せる荷物の数。空欄なら採番は <strong>50</strong> を使います（1〜500）。</small>
      </label>

      <label>
        かご振り順
        <select bind:value={o.basket_order} disabled={!canEdit}>
          {#each ORDER_OPTIONS as op (op.value)}<option value={op.value}>{op.label}</option>{/each}
        </select>
        <small>営業所内でどのドライバーのかごから若い記号（A,B,C…）を振るか。</small>
      </label>

      <label class="chk">
        自動ログアウト
        <span class="row">
          <input type="checkbox" checked={o.auto_logout_enabled ?? true} disabled={!canEdit}
                 onchange={(e) => (o.auto_logout_enabled = e.currentTarget.checked)} />
          <span>有効にする</span>
          <input type="number" min="1" max="600" placeholder="30" class="min"
                 bind:value={o.auto_logout_minutes} disabled={!canEdit} />
          <span>分</span>
        </span>
        <small>共有端末対策。空欄なら既定 <strong>有効・30分</strong>（1〜600分）。</small>
      </label>

      <label>
        印刷エージェント機種
        <select bind:value={o.printer_model} disabled={!canEdit}>
          <option value={null}>未設定（Brother TD-2350 を使用）</option>
          {#each PRINTER_OPTIONS as p (p)}<option value={p}>{p}</option>{/each}
        </select>
        <small>ラベル印刷ブリッジが使う機種。</small>
      </label>
    </div>

    {#if canEdit}
      <div class="actions">
        <button class="save" onclick={() => save(o)} disabled={saving === o.office_code}>
          {saving === o.office_code ? '保存中…' : '保存'}
        </button>
      </div>
    {/if}
  </section>
{/each}

<p class="note">
  ※ 保存は <code>update_office_settings</code>（SECURITY DEFINER・hqのみ）経由。
  <code>offices</code> に書き込みポリシーは作らない設計です。<br />
  ※ 「担当件数の多い順」は DB上 <code>ドライバー順</code> として保存されます（採番エンジンの実装がこの並びのため。用語集の定義更新を申し送り済み）。<br />
  ※ 自動ログアウト（§12.1）・印刷機種（§15.3）の<strong>消費側は未実装</strong>です。本画面は設定の器まで。
</p>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  .back { color: #0b7a4b; text-decoration: none; margin-right: 0.4rem; }
  .right { display: flex; align-items: center; gap: 0.6rem; }
  .role { background: #e9ecef; color: #555; border-radius: 5px; padding: 0.1rem 0.5rem; font-size: 0.78rem; }
  .role.hq { background: #0b7a4b; color: #fff; }
  .reload { background: #f1f3f5; border: 1px solid #aaa; border-radius: 6px; padding: 0.3rem 0.8rem; cursor: pointer; }
  .lead { color: #666; font-size: 0.86rem; margin: 0 0 0.8rem; }
  .msg { font-size: 0.88rem; color: #0b5a36; background: #eaf6ee; border: 1px solid #0b7a4b; border-radius: 6px; padding: 0.5rem 0.8rem; }
  .msg.err { color: #8a0018; background: #fdecef; border-color: #b00020; }
  .msg.warn { color: #8a5300; background: #fff4e5; border-color: #e08a00; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 0.9rem 1.1rem; margin-bottom: 0.8rem; }
  .card h3 { margin: 0 0 0.6rem; font-size: 1rem; }
  .name { color: #777; font-weight: 400; font-size: 0.86rem; margin-left: 0.4rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.8rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.84rem; color: #444; }
  input[type='number'], select { padding: 0.35rem 0.5rem; border: 1px solid #bbb; border-radius: 6px; }
  input:disabled, select:disabled { background: #f6f7f8; color: #777; }
  .chk .row { display: flex; align-items: center; gap: 0.4rem; }
  .chk .min { width: 5.5rem; }
  small { color: #888; font-size: 0.74rem; }
  .actions { margin-top: 0.8rem; }
  .save { background: #0b7a4b; color: #fff; border: none; border-radius: 6px; padding: 0.4rem 1.2rem; font-weight: 700; cursor: pointer; }
  .save:disabled { opacity: 0.6; cursor: not-allowed; }
  .muted { color: #888; }
  .note { color: #999; font-size: 0.76rem; margin-top: 1rem; }
  code { background: #f1f3f5; padding: 0 0.25rem; border-radius: 3px; }
</style>
