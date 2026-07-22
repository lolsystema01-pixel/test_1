<script lang="ts">
  // 初期設定（§12.14）：営業所を新規追加したときの初回のみ表示する2項目入力。
  //   ・完了判定＝offices.gdrive_folder_url が NULL かどうか（専用フラグ列は作らない）。
  //   ・保存は SECURITY DEFINER 関数 save_office_init_setup（offices に write policy は無い）。
  //     権限は関数側が判定（hq=常時／area=自営業所かつ初回のみ）。
  //   ・拠点コード・タイムゾーン等はこの画面では扱わない（事前に管理者がDBで設定・§12.14）。
  import { goto, invalidateAll } from '$app/navigation';

  let { data } = $props();
  let { supabase, officeCode, officeName, printerModels, loadError } = $derived(data);

  let gdriveFolderUrl = $state('');
  let printerModel = $state<string>(data.printerModel ?? 'Brother TD-2350');
  let saving = $state(false);
  let msg = $state('');

  // 入力時の簡易チェック（サーバ側 DEFINER 関数でも再検証＝多層防御）
  // 保存口（save_office_init_setup）＋CHECK制約と同一条件。画面だけ緩いと RPC 直叩きで素通りするため。
  //   URL安全文字のみ・改行/空白/記号なし・末尾固定・500文字以内。
  let urlError = $derived(
    gdriveFolderUrl.trim() === ''
      ? '持出バッグリストのフォルダURLを入力してください。'
      : gdriveFolderUrl.trim().length > 500
        ? 'URLが長すぎます（500文字以内）。'
        : !/^https:\/\/drive\.google\.com\/[A-Za-z0-9/_?=&%.-]+$/.test(gdriveFolderUrl.trim())
          ? 'GドライブのフォルダURL（https://drive.google.com/… ）を入力してください。'
          : ''
  );
  let canSave = $derived(!saving && urlError === '' && printerModel !== '');

  async function save() {
    saving = true;
    msg = '';
    const { error } = await supabase.rpc('save_office_init_setup', {
      p_office_code: officeCode,
      p_gdrive_folder_url: gdriveFolderUrl.trim(),
      p_printer_model: printerModel
    });
    if (error) {
      msg = `保存できませんでした：${[error.message, error.details, error.hint].filter(Boolean).join(' ／ ')}`;
      saving = false;
      return;
    }
    // 保存できた＝gdrive_folder_url が入る＝以降この画面は自動表示されない
    await invalidateAll();
    await goto('/home');
  }
</script>

<svelte:head><title>初期設定 | {officeName}</title></svelte:head>

<main>
  <h1>初期設定</h1>
  <p class="lead">
    <strong>{officeName}</strong>（{officeCode}）の初回設定です。
    以下の2項目を入力すると、次回以降この画面は表示されません。
    変更は<strong>管理者設定</strong>から行えます。
  </p>

  {#if loadError}
    <p class="err" role="alert">
      設定を取得できませんでした：{loadError}<br />
      入力しても保存できない可能性があります。管理者に連絡してください。
    </p>
  {/if}

  <section class="card">
    <label class="field">
      <span class="label">持出バッグリスト フォルダURL</span>
      <span class="hint">かご持出表PDFの保存先（Gドライブ）。フォルダを開いてURLをコピーしてください。</span>
      <input
        type="url"
        bind:value={gdriveFolderUrl}
        placeholder="https://drive.google.com/drive/folders/..."
        autocomplete="off"
      />
      {#if gdriveFolderUrl !== '' && urlError}<span class="err-inline">{urlError}</span>{/if}
    </label>

    <label class="field">
      <span class="label">ラベルプリンタ機種</span>
      <span class="hint">ラベル印刷で使う機種を選んでください。</span>
      <select bind:value={printerModel}>
        {#each printerModels as m (m)}
          <option value={m}>{m}</option>
        {/each}
      </select>
    </label>

    <div class="actions">
      <button class="primary" onclick={save} disabled={!canSave}>
        {saving ? '保存中…' : '保存して開始'}
      </button>
    </div>

    {#if msg}<p class="err" role="alert">{msg}</p>{/if}
  </section>

  <p class="note">
    拠点コード・タイムゾーン等はこの画面では設定しません（事前に管理者が設定します）。
  </p>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  .lead { color: #444; line-height: 1.7; margin: 0 0 20px; }
  .card {
    border: 1px solid #d7dbe0; border-radius: 10px; padding: 20px;
    background: #fff; display: grid; gap: 20px;
  }
  .field { display: grid; gap: 6px; }
  .label { font-weight: 600; font-size: 14px; }
  .hint { color: #666; font-size: 12px; line-height: 1.5; }
  input, select {
    padding: 10px 12px; border: 1px solid #c6ccd3; border-radius: 6px;
    font-size: 16px; width: 100%; box-sizing: border-box;
  }
  .actions { display: flex; justify-content: flex-end; }
  .primary {
    padding: 10px 20px; border: 0; border-radius: 6px; background: #1769aa;
    color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  .primary:disabled { background: #9fb4c6; cursor: not-allowed; }
  .err {
    color: #b3261e; background: #fdecea; border: 1px solid #f5c2be;
    border-radius: 6px; padding: 10px 12px; margin: 0; font-size: 14px; line-height: 1.6;
  }
  .err-inline { color: #b3261e; font-size: 12px; }
  .note { color: #666; font-size: 12px; margin: 16px 0 0; }
</style>
