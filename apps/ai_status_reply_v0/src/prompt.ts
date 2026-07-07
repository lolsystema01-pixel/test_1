// =============================================================
// プロンプト雛形（純関数・DB/SDK非依存＝単体テスト可能）。
//   マスク済みデータ（非個人情報のみ）＋ステータス語彙(6.10) → 状況・配達予定の自然文回答。
//   ★ 入力 MaskedDelivery は氏名・詳細住所・連絡先を**含まない**型。PIIはここに到達しない。
// =============================================================

// SECURITY DEFINER 関数 delivery_status_public が返す非PIIの形。
export type MaskedDelivery = {
  tracking_number: string;
  status: string | null;
  delivery_date: string | null; // YYYY-MM-DD
  time_window: string | null;
  delivery_order: number | null;
  municipality: string | null; // 市レベルのみ
};

// 許可キー（テストで「これ以外が混入していないこと」を検証する）
export const ALLOWED_KEYS: ReadonlyArray<keyof MaskedDelivery> = [
  'tracking_number',
  'status',
  'delivery_date',
  'time_window',
  'delivery_order',
  'municipality'
];

// 6.10 ステータス語彙 → 応答の言い回しガイド（status に応じて回答を変える）。
export const STATUS_GUIDE: Record<string, string> = {
  未配車: 'まだ配送の手配前です。準備が整い次第お届けします。',
  配車済: '配送担当者の割り当てが済み、配送準備中です。',
  仕分済: '仕分けが完了し、まもなく配送に出発します。',
  配送中: '本日配送中です。お届けまでお待ちください。',
  完了: 'お届けが完了しています。',
  不在: 'ご不在のため持ち戻りました。再配達の手配が可能です。',
  保留: '住所等の確認のため一時保留中です。確認後にお届けします。'
};

export function buildSystemPrompt(): string {
  return [
    'あなたは配送会社のカスタマーサポートAIです。荷受人からの問い合わせに、',
    '日本語の簡潔で丁寧な自然文（2〜3文）で回答します。',
    '',
    '【厳守】',
    '・回答は与えられた「配送情報」だけに基づくこと。データに無い事実（氏名・詳細住所・電話番号・置き配の可否など）は推測も記載もしない。',
    '・内部コード（問合番号以外のID・共通ID等）や社内用語をそのまま出さない。',
    '・前置きや思考過程は書かず、最終的な回答文のみを出力する。',
    '',
    '【ステータスの意味（6.10）】',
    ...Object.entries(STATUS_GUIDE).map(([k, v]) => `・${k}：${v}`),
    '',
    '【回答の組み立て】',
    '・現在の配送状況をステータスに応じて伝える。',
    '・配達予定（日付・時間帯）が分かる場合は併せて伝える。完了/不在はその旨を優先。',
    '・市レベルの地域までは触れてよいが、詳細住所は述べない。'
  ].join('\n');
}

export function buildUserMessage(masked: MaskedDelivery, question?: string): string {
  const q = (question ?? '').trim() || '配送状況と配達予定を教えてください。';
  const info = {
    問合番号: masked.tracking_number,
    状況: masked.status ?? '不明',
    配達予定日: masked.delivery_date ?? '未定',
    時間帯: masked.time_window ?? '指定なし',
    配達順: masked.delivery_order ?? '未定',
    地域: masked.municipality ?? '不明'
  };
  return [
    '以下は問い合わせ対象の配送情報です（個人情報は含みません）。',
    JSON.stringify(info, null, 2),
    '',
    `質問：${q}`
  ].join('\n');
}
