// =============================================================
// 最小CSVパーサ（クライアント側でアップロードCSVをプレビュー/列マッピングする用）。
//  ・ダブルクオート囲み・""エスケープ・改行(CRLF/LF)・引用内カンマ/改行に対応。
//  ・BOM除去。空行はスキップ。先頭行をヘッダとして返す。
//  ・取込の本処理はサーバ(/api/v1/imports)。ここは画面表示と列マッピング用。
// =============================================================

export type ParsedCsv = { headers: string[]; rows: string[][] };

export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^﻿/, ''); // BOM 除去
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    // 完全な空行（1セルかつ空）は捨てる
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRecord();
    } else if (c === '\r') {
      // CRLF の CR は無視（次の \n で確定）。単独 CR も改行扱い。
      if (src[i + 1] !== '\n') pushRecord();
    } else {
      field += c;
    }
  }
  // 末尾（最終行に改行が無い場合）
  if (field !== '' || record.length > 0) pushRecord();

  if (records.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = records;
  return { headers: headers.map((h) => h.trim()), rows };
}
