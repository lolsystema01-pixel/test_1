// =============================================================
// 受付チャネル v0 — 会話状態マシン（LINE/SMS等のテキスト会話で受付フローを進める）。
//   ・読み取り/認証/登録は「サービス」として注入（DI）＝$env非依存・単体テスト可能。
//   ・フロー＝v0.4と同一：問合番号→認証(OTP)→受付種別→（希望日時 or 置き配場所）→確認→完了。
//   ・読み取り＝既存 SECURITY DEFINER 関数（lookup）／登録＝N-4（register）を流用（本書では作らない）。
// =============================================================
import {
  vTracking,
  vAuthCode,
  vReceptionType,
  vDesiredDate,
  vTimeSlot,
  vDropPlace,
  needsDateTime,
  needsDropPlace,
  RECEPTION_TYPES,
  TIME_SLOTS
} from '../../validation';

export type ChStep = 'tracking' | 'otp' | 'type' | 'date' | 'slot' | 'place' | 'confirm' | 'overwrite' | 'done';

export type ChSession = {
  step: ChStep;
  channel: string; // line / sms / phone
  trackingNumber?: string;
  token?: string;
  receptionType?: string;
  desiredDate?: string;
  timeSlot?: string;
  dropPlace?: string;
  receiptNo?: string;
};

export type FsmServices = {
  lookup: (tn: string) => Promise<{ status: string | null; municipality: string | null } | null>;
  issueOtp: (tn: string) => { devCode?: string };
  verifyOtp: (
    tn: string,
    code: string
  ) => { ok: boolean; token?: string; locked?: boolean; remaining?: number; reason?: string };
  register: (
    tn: string,
    payload: { type: string; desiredDate?: string; timeSlot?: string; dropPlace?: string },
    overwrite?: boolean
  ) => { ok: boolean; duplicate?: boolean; receiptNo?: string; existing?: { receiptNo: string; type: string } };
  sendOtp: (tn: string, code: string | undefined, channel: string) => void | Promise<void>;
  today: () => string;
};

export type FsmResult = { session: ChSession; replies: string[] };

export function newSession(channel: string): ChSession {
  return { step: 'tracking', channel };
}

const TYPE_BY_INDEX: Record<string, string> = { '1': '再配達', '2': '置き配', '3': '時間変更' };
const RESET_WORDS = new Set(['最初から', 'やり直し', 'キャンセル', 'リセット']);
const YES = new Set(['はい', 'ＯＫ', 'OK', 'ok', '送信', 'する', 'うん', 'y', 'Y']);
const NO = new Set(['いいえ', 'やめる', 'しない', 'no', 'N', 'n']);

function r(session: ChSession, replies: string[]): FsmResult {
  return { session, replies };
}

// テキスト1通を受けて会話を1歩進める。
export async function advance(session: ChSession, raw: string, svc: FsmServices): Promise<FsmResult> {
  const input = (raw ?? '').trim();

  // どの段階でも「最初から」で受付やり直し
  if (RESET_WORDS.has(input)) {
    return r(newSession(session.channel), ['最初からやり直します。問合番号を入力してください。']);
  }

  switch (session.step) {
    case 'tracking': {
      const m = vTracking(input);
      if (m) return r(session, [m]);
      const found = await svc.lookup(input);
      if (!found) return r(session, ['問合番号が見つかりません。番号をご確認のうえ、もう一度入力してください。']);
      const { devCode } = svc.issueOtp(input);
      await svc.sendOtp(input, devCode, session.channel);
      const next: ChSession = { ...session, trackingNumber: input, step: 'otp' };
      return r(next, [`認証コード（6桁）を送信しました。コードを入力してください。${devCode ? `（検証用: ${devCode}）` : ''}`]);
    }

    case 'otp': {
      const m = vAuthCode(input);
      if (m) return r(session, [m]);
      const v = svc.verifyOtp(session.trackingNumber!, input);
      if (v.ok) {
        const next: ChSession = { ...session, token: v.token, step: 'type' };
        return r(next, ['本人確認できました。受付種別を選んでください：1.再配達 2.置き配 3.時間変更']);
      }
      if (v.locked) return r(session, ['認証に複数回失敗したためロックされました。しばらくしてから「最初から」と送信してください。']);
      if (v.reason === 'expired')
        return r(session, ['認証の有効期限が切れています。「最初から」と送信してやり直してください。']);
      return r(session, [`認証コードが正しくありません。（残り${v.remaining ?? 0}回）もう一度入力してください。`]);
    }

    case 'type': {
      const picked = TYPE_BY_INDEX[input] ?? input;
      const m = vReceptionType(picked);
      if (m) return r(session, [`${m} 1.再配達 2.置き配 3.時間変更`]);
      if (needsDropPlace(picked)) {
        return r({ ...session, receptionType: picked, step: 'place' }, ['置き配場所を入力してください（例：玄関前 / 宅配ボックス）。']);
      }
      return r({ ...session, receptionType: picked, step: 'date' }, ['ご希望の日付を入力してください（例：2026-07-01）。']);
    }

    case 'date': {
      const m = vDesiredDate(input, svc.today());
      if (m) return r(session, [m]);
      return r({ ...session, desiredDate: input, step: 'slot' }, [`時間帯を選んでください：${TIME_SLOTS.join(' / ')}`]);
    }

    case 'slot': {
      const idx = Number(input);
      const picked = Number.isInteger(idx) && idx >= 1 && idx <= TIME_SLOTS.length ? TIME_SLOTS[idx - 1] : input;
      const m = vTimeSlot(picked);
      if (m) return r(session, [`${m} ${TIME_SLOTS.join(' / ')}`]);
      const next: ChSession = { ...session, timeSlot: picked, step: 'confirm' };
      return r(next, [summary(next) + '\nこの内容で受付しますか？「はい」または「いいえ」']);
    }

    case 'place': {
      const m = vDropPlace(input, session.receptionType);
      if (m) return r(session, [m]);
      const next: ChSession = { ...session, dropPlace: input, step: 'confirm' };
      return r(next, [summary(next) + '\nこの内容で受付しますか？「はい」または「いいえ」']);
    }

    case 'confirm': {
      if (NO.has(input)) return r(newSession(session.channel), ['受付を中止しました。最初からやり直す場合は問合番号を入力してください。']);
      if (!YES.has(input)) return r(session, ['「はい」または「いいえ」で答えてください。']);
      return submit(session, svc, false);
    }

    case 'overwrite': {
      if (NO.has(input)) return r({ ...session, step: 'done' }, ['既存の受付を維持しました。ありがとうございました。']);
      if (!YES.has(input)) return r(session, ['「はい」または「いいえ」で答えてください。']);
      return submit(session, svc, true);
    }

    case 'done':
    default:
      return r(session, ['受付は完了しています。新しい手続きは「最初から」と送信してください。']);
  }
}

async function submit(session: ChSession, svc: FsmServices, overwrite: boolean): Promise<FsmResult> {
  const res = svc.register(
    session.trackingNumber!,
    {
      type: session.receptionType!,
      desiredDate: needsDateTime(session.receptionType) ? session.desiredDate : undefined,
      timeSlot: needsDateTime(session.receptionType) ? session.timeSlot : undefined,
      dropPlace: needsDropPlace(session.receptionType) ? session.dropPlace : undefined
    },
    overwrite
  );
  if (!res.ok && res.duplicate) {
    return r({ ...session, step: 'overwrite' }, [
      `すでに受付済みです（受付番号 ${res.existing?.receiptNo}・${res.existing?.type}）。上書きしますか？「はい」または「いいえ」`
    ]);
  }
  if (!res.ok) return r(session, ['受付に失敗しました。時間をおいて「最初から」と送信してください。']);
  return r({ ...session, step: 'done', receiptNo: res.receiptNo }, [`受付が完了しました。受付番号：${res.receiptNo}`]);
}

function summary(s: ChSession): string {
  const lines = [`問合番号：${s.trackingNumber}`, `受付種別：${s.receptionType}`];
  if (needsDateTime(s.receptionType)) {
    lines.push(`希望日：${s.desiredDate}`, `時間帯：${s.timeSlot}`);
  }
  if (needsDropPlace(s.receptionType)) lines.push(`置き配場所：${s.dropPlace}`);
  return lines.join('\n');
}

export { RECEPTION_TYPES };
