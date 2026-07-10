<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    buildGodoorCsv,
    groupByDriver,
    driverLabel,
    GODOOR_MAX_ROWS,
    type GodoorRow
  } from '$lib/godoor';

  let { data } = $props();
  let { supabase } = $derived(data);

  const rows = $derived(data.rows as GodoorRow[]);
  const drivers = $derived(groupByDriver(rows));

  let busy = $state(false);
  let uploadMsg = $state('');
  let warnMsg = $state('');
  // 生成済みファイル（ダウンロード用）
  let files = $state<{ name: string; label: string; count: number; url: string }[]>([]);

  function onDate(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (v) goto(`/godoor?date=${v}`);
  }

  const ymd = $derived(data.date.replaceAll('-', '')); // 2026-06-17 → 20260617
  // UTF-8 BOM 付き CSV Blob（GoDoor Ver4.0 は UTF-8 BOM）
  function bomBlob(csv: string): Blob {
    return new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  }
  // Supabase Storage のキーは ASCII のみ（日本語は Invalid key）。
  //   ＝ DLファイル名は日本語のまま、Storageキーだけ ASCII safe に変換（全体→all・ドライバー→driver_id/連番）。
  function storageSafe(s: string, fallback: string): string {
    return /^[A-Za-z0-9_.\-]+$/.test(s) ? s : fallback;
  }

  async function generate() {
    busy = true;
    uploadMsg = '';
    warnMsg = '';
    // 既存のダウンロードURLを解放
    for (const f of files) URL.revokeObjectURL(f.url);
    files = [];
    try {
      if (rows.length === 0) {
        warnMsg = '対象（仕分済×有効ドライバー）がありません。';
        busy = false;
        return;
      }

      // (1) 全体ファイル ＋ (2) ドライバー別ファイル を1回で生成
      //   name = ダウンロード名（日本語OK）／key = Storageキー（ASCIIのみ）
      const built: { name: string; key: string; label: string; rows: GodoorRow[] }[] = [
        { name: `${ymd}_GODOOR_全体.csv`, key: `${ymd}_GODOOR_all.csv`, label: '全体', rows },
        ...drivers.map((d, i) => ({
          name: `${ymd}_GODOOR_${d.label}.csv`,
          key: `${ymd}_GODOOR_${storageSafe(d.rows[0]?.driver_id ?? '', 'driver' + (i + 1))}.csv`,
          label: d.label,
          rows: d.rows
        }))
      ];

      // 10000件超 WARNING（全体・各ドライバー別とも）
      const over = built.filter((b) => b.rows.length > GODOOR_MAX_ROWS);
      if (over.length > 0) {
        warnMsg = `⚠ 10000件超: ${over.map((o) => `${o.label}(${o.rows.length})`).join(' / ')}`;
      }

      const uploaded: string[] = [];
      const made: typeof files = [];
      for (const b of built) {
        const csv = buildGodoorCsv(b.rows);
        const blob = bomBlob(csv);
        made.push({ name: b.name, label: b.label, count: b.rows.length, url: URL.createObjectURL(blob) });
        // Supabase Storage（バケット godoor-csv・日付サブフォルダ）。anon＋areaのJWT＋RLS。
        //   キーは ASCII（b.key）。ダウンロード名（b.name）は日本語のまま。
        const path = `${data.officeCode}/${data.date}/${b.key}`;
        const { error } = await supabase.storage
          .from('godoor-csv')
          .upload(path, blob, { contentType: 'text/csv;charset=utf-8', upsert: true });
        if (error) throw new Error(`${b.name}: ${error.message}`);
        uploaded.push(path);
      }
      files = made;
      uploadMsg = `Storage保存OK（${uploaded.length}ファイル）: ${data.officeCode}/${data.date}/`;
    } catch (e) {
      uploadMsg = `生成/保存に失敗: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }
</script>

<section class="bar no-print">
  <div>
    <a href="/home" class="back">← 営業所ホーム</a>
    <strong>GoDoor用CSV出力</strong>
  </div>
  <div class="controls">
    <label>対象日 <input type="date" value={data.date} onchange={onDate} /></label>
    <button class="go" onclick={generate} disabled={busy}>{busy ? '生成中…' : 'CSV生成・保存'}</button>
  </div>
</section>

{#if data.loadError}<p class="error no-print">取得に失敗：{data.loadError}</p>{/if}
{#if warnMsg}<p class="warn no-print">{warnMsg}</p>{/if}
{#if uploadMsg}<p class="msg no-print">{uploadMsg}</p>{/if}

<section class="card">
  <h2>対象（仕分済 × 有効ドライバー）</h2>
  <p class="summary">
    対象日 <strong>{data.date}</strong> ／ 営業所 <strong>{data.officeCode}</strong>
    ／ 件数 <strong>{rows.length}</strong> ／ ドライバー <strong>{drivers.length}</strong> 名
  </p>
  {#if drivers.length > 0}
    <ul class="drivers">
      {#each drivers as d (d.label)}
        <li><span class="dname">{d.label}</span> <span class="dcount">{d.rows.length}件</span></li>
      {/each}
    </ul>
  {:else}
    <p class="muted">対象がありません。seed_sort_status_v0 で一部を仕分済にしてください（対象日の status='仕分済'）。</p>
  {/if}
</section>

{#if files.length > 0}
  <section class="card">
    <h2>生成ファイル（21列・UTF-8 BOM・CRLF）</h2>
    <p class="muted">「CSV生成・保存」で全体＋ドライバー別を一括生成・Storage保存しました。各ファイルは下からダウンロードできます。</p>
    <ul class="files">
      {#each files as f (f.name)}
        <li>
          <a class="dl" href={f.url} download={f.name}>⬇ {f.name}</a>
          <span class="fcount">{f.count}件</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card note no-print">
  <h3>様式メモ（GAS 27 準拠）</h3>
  <ul>
    <li>21列・ヘッダ行・<strong>UTF-8 BOM</strong>・CRLF・全フィールドダブルクオート囲み。</li>
    <li>データ内のカンマ（半角/全角）・改行は<strong>スペースに置換</strong>、<code>"</code> は <code>""</code> エスケープ。</li>
    <li>届け先名１＝氏名＋「 様」／届け先名２＝かご記号＋配達順（連結）／伝票番号＝問合番号。</li>
    <li>並び：全体＝担当ドライバー名昇順→配達順昇順。ドライバー別＝配達順昇順。</li>
    <li>固定列：配達状況「配達」／梱包「ダンボール」／種類「指定なし」／色「茶」／サイズ「中」／個口数 1／代金徴収「なし」／置き配「不可」／宅配BOX「不可」。</li>
  </ul>
</section>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; gap: 1rem; flex-wrap: wrap; }
  .back { color: #0b7a4b; text-decoration: none; margin-right: 0.75rem; }
  .controls { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .go { background: #0b7a4b; color: #fff; border: none; border-radius: 6px; padding: 0.4rem 0.9rem; font-weight: 600; cursor: pointer; }
  .go:disabled { opacity: 0.6; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 0.9rem 1.1rem; margin-bottom: 1rem; }
  h2 { font-size: 1rem; margin: 0 0 0.6rem; }
  h3 { font-size: 0.9rem; margin: 0 0 0.5rem; }
  .summary { font-size: 0.92rem; }
  .summary strong { color: #0b7a4b; }
  .muted { color: #777; font-size: 0.88rem; }
  .error { color: #b00020; }
  .warn { color: #9a6700; }
  .msg { color: #0b5a36; }
  .drivers { list-style: none; padding: 0; margin: 0.5rem 0 0; display: flex; flex-wrap: wrap; gap: 0.4rem 0.9rem; }
  .drivers li { font-size: 0.9rem; }
  .dname { font-weight: 600; }
  .dcount { color: #0b7a4b; }
  .files { list-style: none; padding: 0; margin: 0.3rem 0 0; }
  .files li { display: flex; align-items: center; gap: 0.6rem; padding: 0.3rem 0; border-bottom: 1px solid #f0f0f0; }
  .dl { color: #0b5cab; text-decoration: none; font-weight: 600; }
  .fcount { color: #777; font-size: 0.85rem; }
  .note ul { margin: 0; padding-left: 1.1rem; font-size: 0.85rem; color: #444; }
  .note code { background: #f1f3f5; padding: 0 0.25rem; border-radius: 3px; }
</style>
