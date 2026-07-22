import { supabase } from './supabase';

// ログイン後のプロフィール解決：role=driver かつ driver_id 有りのみ許可。
// それ以外（role未設定・role違い・driver_id無し）は「登録未完了」扱い。
//
// 'unauthorized' は「本当に未登録」（profile無し／role≠driver／driver_id無し）の場合のみ返す。
// auth.getUser()/profiles取得の失敗（authError/profileError等）は一時・通信エラーとして
// 'error' を返し、呼び出し側で再試行可能な画面へ誘導する（誤って「登録未完了」扱いにしない）。
// drivers（氏名）の引き失敗は認可とは無関係なので unauthorized にはせず、
// driver_id を氏名フォールバックにして 'ok' を返す（行が無い場合の既存フォールバックと同じ扱い）。

export interface DriverIdentity {
  driverId: string;
  fullName: string;
  familyName: string;
}

export type ProfileCheckResult =
  | { status: 'ok'; identity: DriverIdentity }
  | { status: 'unauthorized' }
  | { status: 'error' };

function familyNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  const bySpace = trimmed.split(/[ 　]/)[0];
  return bySpace || trimmed;
}

export async function resolveDriverIdentity(): Promise<ProfileCheckResult> {
  if (!supabase) return { status: 'error' };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { status: 'error' };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, driver_id')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (profileError) return { status: 'error' };
  if (!profile || profile.role !== 'driver' || !profile.driver_id) {
    return { status: 'unauthorized' };
  }

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('driver_name')
    .eq('driver_id', profile.driver_id)
    .maybeSingle();
  // driverError（氏名引き失敗）はunauthorizedにしない：無エラー時に行が無い場合と同じ
  // フォールバック（driver_idを氏名として使う）でokを返す。
  const fullName =
    !driverError && driver?.driver_name && driver.driver_name.trim()
      ? driver.driver_name.trim()
      : profile.driver_id;
  return {
    status: 'ok',
    identity: { driverId: profile.driver_id, fullName, familyName: familyNameOf(fullName) },
  };
}
