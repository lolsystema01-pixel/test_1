// =============================================================
// LOL Driver — デザインシステム "Field Instrument"
//   方向性: 屋外・片手・手袋・直射日光・長時間労働のプロ用途に最適化した
//   「業務計器」。Amazon配達アプリを設計思想の目標にしつつ、視覚言語はLOL独自。
//   ・高コントラスト＆大タップ領域／数字は等幅揃え(tabular)で計器の可読性
//   ・確信ある単一ブランド色を"次・主要操作"に絞って使う（色で溢れさせない）
//   ・意味は必ずアイコン＋ラベル併記（色だけに頼らない）
//   後方互換: 旧キー(colors.brand / shadow.card 等)は温存。未改修画面もそのまま動く。
// =============================================================
import { TextStyle } from 'react-native';

// ---- Palette（warm-cool balanced graphite → paper, 確信あるazure, semantic） ----
export const palette = {
  ink900: '#0E1116',
  ink800: '#161A20',
  ink700: '#252B34',
  ink600: '#3B434E',
  ink500: '#5C6672',
  ink400: '#7A8593',
  ink300: '#9AA4B2',
  ink200: '#C7CED8',
  ink150: '#DCE1E8',
  ink100: '#E6EAEF',
  ink50: '#F1F3F6',
  paper: '#F6F7F9',
  surface: '#FFFFFF',
  white: '#FFFFFF',

  // Brand — bootstrap-blueより深く意図的なazure
  brand800: '#0A3081',
  brand700: '#0B3EA8',
  brand600: '#0F4FCB',
  brand500: '#1560E6',
  brand400: '#4B87F0',
  brand300: '#7EA8F5',
  brand100: '#E4EDFF',
  brand050: '#F2F6FF',

  // Semantic
  done700: '#0B7A43',
  done600: '#0E8A4C',
  done500: '#159A56',
  done100: '#E1F4EA',
  absent700: '#8E5C08',
  absent600: '#B0730A',
  absent500: '#C9820A',
  absent100: '#FBF0DA',
  danger600: '#C4362B',
  danger500: '#DC3B2F',
  danger100: '#FCE7E5',
  warn: '#9A6A0B',
  warnSoft: '#FCF3E3',
  warnLine: '#F0D9A8',
  pending: '#B6BFC9',
} as const;

export const colors = {
  // --- 旧キー（後方互換・値は微調整のみ） ---
  bg: palette.paper,
  card: palette.surface,
  ink: palette.ink800,
  soft: palette.ink500,
  faint: palette.ink300,
  line: palette.ink100,
  brand: palette.brand500,
  brandDark: palette.brand600,
  brandSoft: palette.brand100,
  done: palette.done500,
  doneSoft: palette.done100,
  absent: palette.absent500,
  absentSoft: palette.absent100,
  // --- 新キー ---
  ...palette,
  danger: palette.danger500,
  dangerSoft: palette.danger100,
  brandBg: palette.brand050,
  hairline: palette.ink150,
  pendingSoft: palette.ink50,
} as const;

// ---- Spacing（4pxリズム） ----
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  huge: 40,
} as const;

// ---- Radius ----
export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 28,
  pill: 999,
} as const;

// ---- Typography（system font ＋ tabular-nums で計器の可読性） ----
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  tabular,
  // 大メトリクス（件数・退勤サマリー等）
  display: { fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6, ...tabular },
  // 画面タイトル
  h1: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.3 },
  h2: { fontSize: 18, lineHeight: 24, fontWeight: '800', letterSpacing: -0.2 },
  // カード見出し・住所
  title: { fontSize: 17, lineHeight: 23, fontWeight: '800', letterSpacing: -0.2 },
  bodyStrong: { fontSize: 14, lineHeight: 21, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21, fontWeight: '500' },
  label: { fontSize: 12.5, lineHeight: 17, fontWeight: '700' },
  caption: { fontSize: 11.5, lineHeight: 16, fontWeight: '600' },
  // セクションのオーバーライン（英字は大文字トラッキング）
  overline: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  // 計器数字（サイズは用途ごとに上書き）
  metric: { fontWeight: '800', letterSpacing: -0.4, ...tabular },
} as unknown as Record<
  'tabular' | 'display' | 'h1' | 'h2' | 'title' | 'bodyStrong' | 'body' | 'label' | 'caption' | 'overline' | 'metric',
  TextStyle
>;

// ---- Elevation（焦点化のための立体） ----
export const elevation = {
  e0: {} as const,
  e1: {
    shadowColor: '#0E1116',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  e2: {
    shadowColor: '#0E1116',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  e3: {
    shadowColor: '#0B2A6B',
    shadowOpacity: 0.2,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
} as const;

// 旧キー後方互換
export const shadow = {
  card: elevation.e2,
  floating: elevation.e3,
} as const;

// ---- Motion（抑制の効いた・目的あるアニメ） ----
export const motion = {
  fast: 140,
  base: 220,
  slow: 340,
  stagger: 55,
  spring: { damping: 17, stiffness: 220, mass: 0.9 },
} as const;
