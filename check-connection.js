// Supabase 接続確認スクリプト
// 接続情報は .env から読み込みます（コードには直書きしません）。
// 実行: npm run check   （または node check-connection.js）

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  // --- 環境変数チェック ---
  if (!url || !key) {
    console.error('❌ .env に SUPABASE_URL / SUPABASE_ANON_KEY が設定されていません。');
    console.error('   .env.example をコピーして .env を作り、値を入れてください。');
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, key);
  console.log(`🔌 接続先: ${url}`);

  // --- 接続確認 ---
  // テーブルがまだ無くても「接続自体」は成功します。
  // 存在しないテーブルを叩いて、返ってくるエラーの種類で接続可否を判定します。
  const { error } = await supabase
    .from('__connection_check__')
    .select('*')
    .limit(1);

  if (!error) {
    // 万一そのテーブルが存在した場合（基本来ない）
    console.log('✅ 接続成功（クエリも通りました）。');
    return;
  }

  // PGRST205 / 42P01 = テーブルが存在しない → サーバーには到達できている＝接続OK
  if (error.code === 'PGRST205' || error.code === '42P01') {
    console.log('✅ 接続成功（Supabase まで到達できています）。');
    console.log('   ※ テーブルはまだ作っていないので、その旨のエラーが返るのは正常です。');
    return;
  }

  // 認証系エラー
  if (error.message?.toLowerCase().includes('api key') || error.code === '401') {
    console.error('❌ 接続失敗: API キーが不正な可能性があります。');
    console.error(`   詳細: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  // それ以外
  console.error('❌ 接続失敗:');
  console.error(error);
  process.exitCode = 1;
}

main();
