import { Stop } from './types';

// ダミーデータ（DEMOモード専用・Supabase接続なし）。
// LIVEモード（env設定あり）では使われず、src/lib/deliveries.ts の実データ取得に置き換わる
// （env未設定時はこのモックにフォールバックし、従来のデモ動作をそのまま維持する）。
// ドライバー: DRV001 谷川（営業所A01相当）。住所はモックアップ画像に合わせ世田谷系。
export const DRIVER = {
  id: 'DRV001',
  familyName: '谷川',
  fullName: '谷川 太郎',
  office: '営業所A01',
};

const TOWN_BANCHI: Array<[string, string]> = [
  ['桜新町', '2-10-5'],
  ['桜新町', '3-4-12'],
  ['深沢', '5-1-8'],
  ['等々力', '6-10-3'],
  ['用賀', '4-2-9'],
  ['玉川', '3-15-2'],
  ['尾山台', '2-8-11'],
  ['奥沢', '1-6-4'],
  ['野毛', '2-3-7'],
  ['上野毛', '4-11-1'],
  ['弦巻', '3-9-6'],
  ['経堂', '1-4-8'],
  ['桜丘', '5-2-3'],
  ['若林', '2-7-9'],
  ['松原', '4-1-5'],
  ['代田', '3-6-2'],
  ['世田谷', '1-9-4'],
  ['下馬', '2-5-8'],
  ['三軒茶屋', '2-14-1'],
  ['太子堂', '1-3-9'],
  ['駒沢', '3-8-2'],
  ['深沢', '2-11-6'],
  ['等々力', '3-5-9'],
  ['上馬', '4-2-1'],
];

const RECIPIENTS = [
  '田中 一郎',
  '鈴木 花子',
  '佐々木 健',
  '山本 美咲',
  '—',
  '中村 陽子',
  '高橋 修',
  '伊藤 さくら',
  '渡辺 大輔',
  '小林 舞',
  '加藤 隆',
  '斎藤 恵',
];

const WINDOWS = [
  '9:00〜10:30',
  '10:30〜12:00',
  '12:00〜14:00',
  '14:00〜16:00',
  '16:00〜18:00',
  '18:00〜20:00',
  '指定なし',
];

const WARD = '世田谷区';
const PREF_WARD = '東京都世田谷区';

const MEMOS = [
  '',
  '',
  '置き配希望：宅配ボックス',
  '',
  'インターホン故障のため電話をお願いします',
  '',
  '不在時は管理人室へ',
  '',
  '玄関前に置き配OK',
  '',
];

const BASKET_LETTERS = ['A', 'B', 'C'];

// 世田谷区周辺のおおよその座標を中心にスケッチ用の分布を作る
const BASE_LAT = 35.63;
const BASE_LNG = 139.635;
const SPREAD_LAT = 0.028;
const SPREAD_LNG = 0.034;

function padTrackingNumber(n: number): string {
  return String(900000000000 + n);
}

export function generateStops(): Stop[] {
  const total = 24;
  const preDone = 18; // 18済・6残（指示書どおり）
  const stops: Stop[] = [];

  for (let i = 0; i < total; i++) {
    const [town, banchi] = TOWN_BANCHI[i % TOWN_BANCHI.length];
    const recipient = RECIPIENTS[i % RECIPIENTS.length];
    const win = WINDOWS[i % WINDOWS.length];

    let status: Stop['status'] = '未処理';
    if (i < preDone) {
      // 18件の既済のうち2件だけ不在（デモの見た目用）
      status = i % 9 === 8 ? '不在' : '完了';
    }

    // 決定的な分布（インデックスベースの疑似ランダム、再現性のため乱数は使わない）
    const angle = (i / total) * Math.PI * 2;
    const jitter = ((i * 37) % 11) / 11 - 0.5;
    const lat = BASE_LAT + Math.sin(angle) * (SPREAD_LAT / 2) + jitter * 0.004;
    const lng = BASE_LNG + Math.cos(angle) * (SPREAD_LNG / 2) + jitter * 0.005;

    const basketCode = `${BASKET_LETTERS[i % BASKET_LETTERS.length]}-${String(
      1 + (i % 12)
    ).padStart(2, '0')}`;
    const memo = MEMOS[i % MEMOS.length];
    const packageCount = 1 + (i % 3);

    stops.push({
      seq: i + 1,
      trackingNumber: padTrackingNumber(1000 + i),
      prefectureWard: PREF_WARD,
      ward: WARD,
      town,
      banchi,
      recipient,
      window: win,
      status,
      lat,
      lng,
      packageCount,
      basketCode,
      memo: memo || undefined,
    });
  }

  // デモ用: 紛らわしい届け先（管理要望「同住所で名前違い」「2件並びの同姓」を残り6件の中に再現）
  const override = (i: number, patch: Partial<Stop>) => {
    stops[i] = { ...stops[i], ...patch };
  };
  if (total >= 22) {
    // 同住所・別名（二世帯/集合住宅）: 次の配達=seq19 とその次=seq20 が同じ住所
    override(18, { town: '三軒茶屋', banchi: '2-14-1', recipient: '高橋 修' });
    override(19, {
      town: '三軒茶屋',
      banchi: '2-14-1',
      recipient: '佐藤 みどり',
      lat: stops[18].lat + 0.0002,
      lng: stops[18].lng + 0.0002,
    });
    // 近接・同姓（2件並びの鈴木さん）: seq21 / seq22 が隣の番地で同じ名字
    override(20, { town: '駒沢', banchi: '3-8-2', recipient: '鈴木 一男' });
    override(21, {
      town: '駒沢',
      banchi: '3-8-4',
      recipient: '鈴木 直子',
      lat: stops[20].lat + 0.0003,
      lng: stops[20].lng - 0.0002,
    });
  }

  return stops;
}
