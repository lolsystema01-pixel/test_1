import { Stop } from './types';

// 紛らわしい届け先の検知（誤配の予防）
//  (a) 同一住所に複数件・名前違い（二世帯/集合住宅）→ 宛名確認を促す
//  (b) 近接する同姓（2件並びの鈴木さん）→ 番地・表札確認を促す
// 本番は当日ルートのデータ照合で同等の判定を行う（追加API不要・実装コスト小）

const addrKey = (s: Stop) => `${s.town}${s.banchi}`;
const surname = (recipient: string) =>
  recipient === '—' ? '' : recipient.split(/[ 　]/)[0];
const isNear = (a: Stop, b: Stop) =>
  Math.abs(a.lat - b.lat) + Math.abs(a.lng - b.lng) < 0.0015;

export function stopWarnings(stop: Stop, all: Stop[]): string[] {
  const warnings: string[] = [];

  const sameAddr = all.filter(
    (s) => s.seq !== stop.seq && addrKey(s) === addrKey(stop)
  );
  if (sameAddr.length > 0 && sameAddr.some((s) => s.recipient !== stop.recipient)) {
    const names = [stop, ...sameAddr]
      .map((s) => surname(s.recipient) || '名前不明')
      .join('様・');
    warnings.push(`同じ住所に${sameAddr.length + 1}件（${names}様）— 宛名を確認`);
  }

  const sn = surname(stop.recipient);
  if (sn) {
    const nearSame = all.filter(
      (s) =>
        s.seq !== stop.seq &&
        addrKey(s) !== addrKey(stop) &&
        surname(s.recipient) === sn &&
        isNear(s, stop)
    );
    if (nearSame.length > 0) {
      warnings.push(
        `すぐ近くに同じ${sn}様（${nearSame[0].town}${nearSame[0].banchi}）— 番地・表札を確認`
      );
    }
  }

  return warnings;
}

export function hasWarnings(stop: Stop, all: Stop[]): boolean {
  return stopWarnings(stop, all).length > 0;
}
