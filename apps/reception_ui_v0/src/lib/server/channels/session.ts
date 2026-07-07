// チャネル会話セッション（インメモリ・チャネル×ユーザー単位）。
import { type ChSession, newSession } from './fsm';

const sessions = new Map<string, ChSession>();
const key = (channel: string, userId: string) => `${channel}:${userId}`;

export function getSession(channel: string, userId: string): ChSession {
  return sessions.get(key(channel, userId)) ?? newSession(channel);
}
export function setSession(channel: string, userId: string, s: ChSession): void {
  sessions.set(key(channel, userId), s);
}
export function __resetSessions(): void {
  sessions.clear();
}
