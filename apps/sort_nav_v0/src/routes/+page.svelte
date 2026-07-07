<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { idbGet, idbSet } from '$lib/idb';

  let { data } = $props();

  // --- ブラウザ内参照用のマップ（起動時の一括取得から構築）---
  let indexMap = $derived(new Map(data.index.map((r) => [r.tracking_number, r])));
  let statusMap = $derived(new Map(data.today.map((r) => [r.tracking_number, r.status])));
  let todaySet = $derived(new Set(data.today.map((r) => r.tracking_number)));

  // スキャン済（IndexedDBで永続化＝再読込で復元。DBには書かない）
  let scanned = new SvelteSet<string>();
  const idbKey = $derived(`${data.officeCode}:${new Date().toISOString().slice(0, 10)}`);

  let inputValue = $state('');
  let inputEl: HTMLInputElement | undefined = $state();
  let lastResult = $state<
    | { kind: 'ok' | 'dup' | 'hold'; tn: string; basket?: string; order?: number | null; driver?: string | null }
    | { kind: 'unknown' | 'foreign'; tn: string }
    | null
  >(null);

  // 未保存・自動保存閾値（既定50）。保存先はローカルのみ（DB確定は後続）。
  const AUTOSAVE_THRESHOLD = 50;
  let unsaved = $state(0);
  let autosavedNote = $state(false);

  // 照会時間（ブラウザ内Map参照。目標400ms未満＝§11.1 性能の実測用）
  let lookupMs = $state<number | null>(null);

  // かご一覧（営業所全体）：basket_code 単位で 個数・スキャン済・残
  let baskets = $derived.by(() => {
    const m = new Map<string, { basket_code: string; driver_id: string | null; total: number; scanned: number }>();
    for (const r of data.index) {
      let b = m.get(r.basket_code);
      if (!b) {
        b = { basket_code: r.basket_code, driver_id: r.driver_id, total: 0, scanned: 0 };
        m.set(r.basket_code, b);
      }
      b.total++;
      if (scanned.has(r.tracking_number)) b.scanned++;
    }
    // かご記号順（短い記号→アルファベット順。A..Z→AA.. / M01..M10）
    return [...m.values()].sort(
      (a, b) => a.basket_code.length - b.basket_code.length || a.basket_code.localeCompare(b.basket_code)
    );
  });

  let totalItems = $derived(data.index.length);
  let scannedItems = $derived(data.index.filter((r) => scanned.has(r.tracking_number)).length);
  let remainingItems = $derived(totalItems - scannedItems);

  async function persist() {
    try {
      await idbSet(idbKey, [...scanned]);
    } catch {
      /* ローカル保存失敗は致命ではない */
    }
  }

  function handleScan(raw: string) {
    const tn = raw.trim();
    if (!tn) return;

    // ── 照会（ブラウザ内参照）の時間を計測 ──
    const t0 = performance.now();
    const row = indexMap.get(tn);
    const inToday = todaySet.has(tn);
    const st = statusMap.get(tn);
    lookupMs = performance.now() - t0;

    if (row) {
      if (scanned.has(tn)) {
        // 重複スキャンは弾く（カウントしない）
        lastResult = { kind: 'dup', tn, basket: row.basket_code, order: row.delivery_order, driver: row.driver_id };
        return;
      }
      scanned.add(tn);
      persist();
      unsaved++;
      if (unsaved >= AUTOSAVE_THRESHOLD) {
        autosavedNote = true; // ローカルへは都度保存済み。閾値到達の表示のみ。
        unsaved = 0;
      }
      lastResult = {
        kind: st === '保留' ? 'hold' : 'ok',
        tn,
        basket: row.basket_code,
        order: row.delivery_order,
        driver: row.driver_id
      };
      return;
    }

    // index に無い場合の分類
    if (inToday) {
      if (st === '保留') {
        lastResult = { kind: 'hold', tn };
      } else {
        lastResult = { kind: 'unknown', tn }; // index欠落＝担当者不明
      }
      return;
    }
    lastResult = { kind: 'foreign', tn }; // 当日・自営業所の対象に無い＝対象外（誤仕分け）
  }

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    handleScan(inputValue);
    inputValue = '';
    inputEl?.focus();
  }

  function clearLocal() {
    if (!confirm('この営業所・当日のローカルのスキャン済を消去します。よろしいですか？')) return;
    scanned.clear();
    unsaved = 0;
    autosavedNote = false;
    persist();
    inputEl?.focus();
  }

  // --- カメラ読取（任意・BarcodeDetector が使える場合のみ）---
  let cameraOn = $state(false);
  let cameraError = $state('');
  let videoEl: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | null = null;
  let camTimer: ReturnType<typeof setInterval> | null = null;
  let lastCam = '';

  async function toggleCamera() {
    if (cameraOn) {
      stopCamera();
      return;
    }
    cameraError = '';
    const Detector = (globalThis as unknown as { BarcodeDetector?: new () => { detect: (s: unknown) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) {
      cameraError = 'このブラウザはカメラ読取（BarcodeDetector）に未対応です。ハンディスキャナ／直接入力をご利用ください。';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      cameraOn = true;
      await Promise.resolve();
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
      const detector = new Detector();
      camTimer = setInterval(async () => {
        if (!videoEl) return;
        try {
          const codes = await detector.detect(videoEl);
          if (codes.length > 0) {
            const v = codes[0].rawValue;
            if (v && v !== lastCam) {
              lastCam = v;
              handleScan(v);
              setTimeout(() => (lastCam = ''), 1200); // 同一コードの連続検出を抑制
            }
          }
        } catch {
          /* フレーム検出失敗は無視 */
        }
      }, 350);
    } catch {
      cameraError = 'カメラを起動できませんでした（権限・HTTPSをご確認ください）。';
      stopCamera();
    }
  }

  function stopCamera() {
    cameraOn = false;
    if (camTimer) {
      clearInterval(camTimer);
      camTimer = null;
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  onMount(() => {
    (async () => {
      const saved = await idbGet(idbKey).catch(() => [] as string[]);
      saved.forEach((tn) => scanned.add(tn));
    })();
    inputEl?.focus();
    return () => stopCamera();
  });
</script>

<section class="bar">
  <div>
    <strong>営業所 {data.officeCode}</strong>
    <span class="muted">／ 当日 {totalItems}件</span>
  </div>
  <div class="bar-right">
    <a href="/sheet" class="sheet-link">配車表PDF</a>
    <a href="/carry" class="sheet-link">かご持出表PDF</a>
    <a href="/godoor" class="sheet-link">GoDoor CSV</a>
    <a href="/label" class="sheet-link">ラベル印刷</a>
    <a href="/demo" class="sheet-link demo">一連デモ</a>
    <span class="muted small">{data.email ?? ''}</span>
    <form method="POST" action="/auth/signout"><button class="signout">ログアウト</button></form>
  </div>
</section>

{#if data.loadError}
  <p class="error">一括取得に失敗しました：{data.loadError}</p>
{/if}

<!-- スキャン入力＋結果 -->
<section class="card">
  <form class="scan-form" onsubmit={onSubmit}>
    <input
      bind:this={inputEl}
      bind:value={inputValue}
      class="scan-input"
      placeholder="問合番号をスキャン／入力して Enter"
      autocomplete="off"
      inputmode="text"
    />
    <button type="submit" class="scan-btn">照会</button>
    <button type="button" class="cam-btn" onclick={toggleCamera}>{cameraOn ? 'カメラ停止' : 'カメラ'}</button>
  </form>

  {#if cameraError}<p class="error small">{cameraError}</p>{/if}
  {#if cameraOn}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={videoEl} class="cam" muted playsinline></video>
  {/if}

  {#if lastResult}
    {#if lastResult.kind === 'ok' || lastResult.kind === 'dup' || lastResult.kind === 'hold'}
      <div class="result {lastResult.kind}">
        <div class="result-main">
          <span class="kago">かご {lastResult.basket}</span>
          <span class="order">配達順 {lastResult.order ?? '—'}</span>
        </div>
        <div class="result-sub">
          問合番号 {lastResult.tn}{lastResult.driver ? ` ／ 担当 ${lastResult.driver}` : ''}
          {#if lastResult.kind === 'dup'}<span class="tag warn">重複スキャン</span>{/if}
          {#if lastResult.kind === 'hold'}<span class="tag hold">保留</span>{/if}
        </div>
      </div>
    {:else}
      <div class="result {lastResult.kind}">
        <div class="result-main warn-text">
          {#if lastResult.kind === 'unknown'}担当者不明（問合Indexに無し）{/if}
          {#if lastResult.kind === 'foreign'}対象外（当日・自営業所に無し）= 誤仕分け{/if}
        </div>
        <div class="result-sub">問合番号 {lastResult.tn}</div>
      </div>
    {/if}
  {:else}
    <p class="muted hint">スキャンするとここに「かご記号・配達順」が表示されます。</p>
  {/if}

  <div class="progress">
    <span>スキャン済 <strong>{scannedItems}</strong> / {totalItems}　残 <strong>{remainingItems}</strong></span>
    {#if lookupMs !== null}
      <span class="muted small">照会 {lookupMs < 1 ? '<1' : lookupMs.toFixed(1)} ms（目標 400ms未満）</span>
    {/if}
    <span class="muted small">
      未保存 {unsaved}件 ／ 自動保存閾値 {AUTOSAVE_THRESHOLD}
      {#if autosavedNote}<span class="tag ok">ローカル保存済</span>{/if}
    </span>
    <button class="link" onclick={clearLocal}>ローカル消去</button>
  </div>
  <p class="muted tiny">※ スキャン済はこの端末のローカル（IndexedDB）保持。DBの仕分済確定は「書き込みRLS整備」後。</p>
</section>

<!-- 本日のかご一覧（営業所全体） -->
<section class="card">
  <h2>本日のかご一覧 <span class="muted small">（{baskets.length}かご・全ドライバー）</span></h2>
  {#if baskets.length === 0}
    <p class="muted">当日の対象がありません。</p>
  {:else}
    <table class="kago-table">
      <thead>
        <tr><th>かご</th><th>担当</th><th>個数</th><th>スキャン済</th><th>残</th></tr>
      </thead>
      <tbody>
        {#each baskets as b (b.basket_code)}
          <tr class:done={b.scanned >= b.total}>
            <td class="kago-code">{b.basket_code}</td>
            <td>{b.driver_id ?? '—'}</td>
            <td>{b.total}</td>
            <td>{b.scanned}</td>
            <td class:rem={b.total - b.scanned > 0}>{b.total - b.scanned}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
  .bar-right { display: flex; align-items: center; gap: 0.75rem; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); padding: 1rem 1.25rem; margin-bottom: 1rem; }
  .muted { color: #777; }
  .small { font-size: 0.82rem; }
  .tiny { font-size: 0.75rem; margin: 0.5rem 0 0; }
  .signout { background:#fff; color:#0b7a4b; border:1px solid #0b7a4b; border-radius:6px; padding:0.35rem 0.7rem; cursor:pointer; font-size:0.82rem; }
  .sheet-link { color:#0b7a4b; text-decoration:none; font-size:0.85rem; font-weight:600; border:1px solid #0b7a4b; border-radius:6px; padding:0.35rem 0.7rem; }
  .sheet-link.demo { color:#0b5cab; border-color:#0b5cab; }
  .scan-form { display: flex; gap: 0.5rem; }
  .scan-input { flex: 1; padding: 0.7rem 0.8rem; font-size: 1.1rem; border: 2px solid #0b7a4b; border-radius: 8px; }
  .scan-btn, .cam-btn { padding: 0 1rem; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; }
  .scan-btn { background: #0b7a4b; color: #fff; }
  .cam-btn { background: #eef2f0; color: #0b5; color: #0b7a4b; }
  .cam { width: 100%; max-height: 260px; margin-top: 0.6rem; border-radius: 8px; background: #000; }
  .result { margin-top: 0.8rem; padding: 0.9rem 1rem; border-radius: 10px; }
  .result.ok { background: #e7f6ee; border: 1px solid #0b7a4b; }
  .result.dup { background: #fff7e6; border: 1px solid #e0a800; }
  .result.hold { background: #eef0ff; border: 1px solid #5560d0; }
  .result.unknown, .result.foreign { background: #fdecec; border: 1px solid #b00020; }
  .result-main { display: flex; gap: 1.2rem; align-items: baseline; }
  .kago { font-size: 2rem; font-weight: 700; color: #0b7a4b; }
  .order { font-size: 1.3rem; font-weight: 600; }
  .warn-text { font-size: 1.2rem; font-weight: 700; color: #b00020; }
  .result-sub { margin-top: 0.3rem; color: #444; }
  .tag { display: inline-block; margin-left: 0.5rem; padding: 0.05rem 0.45rem; border-radius: 999px; font-size: 0.72rem; }
  .tag.warn { background:#e0a800; color:#fff; }
  .tag.hold { background:#5560d0; color:#fff; }
  .tag.ok { background:#0b7a4b; color:#fff; }
  .hint { margin: 0.8rem 0 0; }
  .progress { display: flex; gap: 1rem; align-items: center; justify-content: space-between; margin-top: 0.9rem; flex-wrap: wrap; }
  .link { background: none; border: none; color: #b00020; cursor: pointer; font-size: 0.82rem; text-decoration: underline; }
  h2 { font-size: 1rem; margin: 0 0 0.75rem; }
  .kago-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .kago-table th, .kago-table td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #eee; }
  .kago-table th { color: #777; font-size: 0.8rem; }
  .kago-code { font-weight: 700; color: #0b7a4b; }
  td.rem { color: #b00020; font-weight: 600; }
  tr.done { opacity: 0.55; }
  .error { color: #b00020; }
</style>
