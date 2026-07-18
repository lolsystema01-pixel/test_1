import { supabase } from './supabase';

// ログイン後のプロフィール解決：role=driver かつ driver_id 有りのみ許可。
// それ以外（role未設定・role違い・driver_id無し）は「登録未完了」扱い。

export interface DriverIdentity {
  driverId: string;
  fullName: string;
  familyName: string;
}

export type ProfileCheckResult =
  | { status: 'unauthorized' }
  | { status: 'ok'; identity: DriverIdentity };

function familyNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  const bySpace = trimmed.split(/[ 　]/)[0];
  return bySpace || trimmed;
}

export async function resolveDriverIdentity(): Promise<ProfileCheckResult> {
  if (!supabase) return { status: 'unauthorized' };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { status: 'unauthorized' };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, driver_id')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.role !== 'driver' || !profile.driver_id) {
    return { status: 'unauthorized' };
  }

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('driver_name')
    .eq('driver_id', profile.driver_id)
    .maybeSingle();
  if (driverError) return { status: 'unauthorized' };

  const fullName = driver?.driver_name && driver.driver_name.trim() ? driver.driver_name.trim() : profile.driver_id;
  return {
    status: 'ok',
    identity: { driverId: profile.driver_id, fullName, familyName: familyNameOf(fullName) },
  };
}
