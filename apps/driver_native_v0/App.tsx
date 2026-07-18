import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { colors } from './src/theme';
import { Counts, Stop, StopStatus, TabKey, ToastState } from './src/types';
import { DRIVER, generateStops } from './src/mockData';
import { isLiveMode, supabase } from './src/lib/supabase';
import { resolveDriverIdentity } from './src/lib/authProfile';
import { fetchTodayRoute } from './src/lib/deliveries';
import { recordDeliveryResult, startQueueAutoFlush } from './src/lib/queue';
import { submitDeliveryPhoto, startPhotoQueueAutoFlush } from './src/lib/photoQueue';
import { getCurrentCoords } from './src/lib/location';

import TabBar from './src/components/TabBar';
import Toast from './src/components/Toast';
import ClockInScreen from './src/screens/ClockInScreen';
import DeliveryScreen from './src/screens/DeliveryScreen';
import LoginScreen from './src/screens/LoginScreen';
import MapScreen from './src/screens/MapScreen';
import TodayScreen from './src/screens/TodayScreen';

// LIVEモード（env設定あり）のときだけ意味を持つ認証状態機械。
// DEMOモード（env未設定）は常に 'signedIn' 相当として扱い、従来のモック動作をそのまま維持する。
// 'error' は認証解決中の一時・通信エラー（本当に未登録＝'unauthorized' とは区別し、再試行可能にする）。
type AuthStatus = 'checking' | 'signedOut' | 'unauthorized' | 'error' | 'signedIn';

interface DriverInfo {
  driverId: string;
  familyName: string;
  fullName: string;
}

const DEMO_DRIVER: DriverInfo = {
  driverId: DRIVER.id,
  familyName: DRIVER.familyName,
  fullName: DRIVER.fullName,
};

function AppInner() {
  const insets = useSafeAreaInsets();

  const [authStatus, setAuthStatus] = useState<AuthStatus>(isLiveMode ? 'checking' : 'signedIn');
  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(isLiveMode ? null : DEMO_DRIVER);

  const [stops, setStops] = useState<Stop[]>(() => (isLiveMode ? [] : generateStops()));
  const [routeLoaded, setRouteLoaded] = useState(!isLiveMode);

  const [activeTab, setActiveTab] = useState<TabKey>('delivery');
  const [clockedIn, setClockedIn] = useState(false);
  const [clockInTime, setClockInTime] = useState<Date | null>(null);
  const [clockedOut, setClockedOut] = useState(false);
  const [clockOutTime, setClockOutTime] = useState<Date | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = (message: string) => {
    setToast({ id: Date.now(), message });
  };

  // resolve() を保持しておき、「再試行」ボタンから同じ解決処理を呼べるようにする。
  const resolveAuthRef = useRef<() => Promise<void>>(async () => {});

  // --- 認証（LIVEモードのみ）: セッション変化を購読し、role=driver＋driver_id有りのみ許可 ---
  useEffect(() => {
    if (!isLiveMode || !supabase) return;
    let active = true;

    const resolve = async () => {
      setAuthStatus('checking');
      try {
        const result = await resolveDriverIdentity();
        if (!active) return;
        if (result.status === 'ok') {
          setDriverInfo(result.identity);
          setAuthStatus('signedIn');
        } else if (result.status === 'unauthorized') {
          // 本当に未登録（profile無し／role≠driver／driver_id無し）のときのみ
          setDriverInfo(null);
          setAuthStatus('unauthorized');
        } else {
          // 通信・一時エラー：unauthorizedにせず再試行可能な画面へ
          setDriverInfo(null);
          setAuthStatus('error');
        }
      } catch {
        if (!active) return;
        setDriverInfo(null);
        setAuthStatus('error');
      }
    };

    resolveAuthRef.current = resolve;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) {
        void resolve();
      } else {
        setDriverInfo(null);
        setAuthStatus('signedOut');
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleRetryAuth = () => {
    void resolveAuthRef.current();
  };

  // --- 当日ルート取得（LIVEモード・signedIn後） ---
  useEffect(() => {
    if (!isLiveMode) return;
    if (authStatus !== 'signedIn') return;
    let active = true;
    (async () => {
      try {
        const rows = await fetchTodayRoute();
        if (!active) return;
        setStops(rows);
      } catch {
        if (!active) return;
        showToast('本日のルート取得に失敗しました');
      } finally {
        if (active) setRouteLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [authStatus]);

  // --- 取りこぼし防止キューの自動再送（LIVEモードのみ・アプリforeground復帰時） ---
  useEffect(() => {
    if (!isLiveMode) return;
    return startQueueAutoFlush();
  }, []);

  // --- 置き配写真POD の取りこぼし防止キューの自動再送（完了/不在キューとは独立） ---
  useEffect(() => {
    if (!isLiveMode) return;
    return startPhotoQueueAutoFlush();
  }, []);

  const counts: Counts = useMemo(() => {
    const total = stops.length;
    const done = stops.filter((s) => s.status === '完了').length;
    const absent = stops.filter((s) => s.status === '不在').length;
    const processed = done + absent;
    const remaining = total - processed;
    const rate = total > 0 ? Math.round((processed / total) * 100) : 0;
    return { done, absent, processed, remaining, total, rate };
  }, [stops]);

  const nextStop = useMemo(
    () => stops.find((s) => s.status === '未処理') ?? null,
    [stops]
  );
  const upcoming = useMemo(
    () => stops.filter((s) => s.status === '未処理' && s.seq !== nextStop?.seq),
    [stops, nextStop]
  );

  const handleClockIn = () => {
    setClockedIn(true);
    setClockInTime(new Date());
    showToast('🕕 出勤しました・📍位置情報の送信を開始（退勤で停止）');
  };

  const handleClockOut = () => {
    setClockedOut(true);
    setClockOutTime(new Date());
    showToast('🏁 お疲れさまでした');
  };

  const handleFinalizeStop = (stop: Stop, status: StopStatus, photoUri?: string | null) => {
    // 楽観更新：押した瞬間にローカルを済にする（LIVEモードの送信は裏で行う）
    setStops((prev) => prev.map((s) => (s.trackingNumber === stop.trackingNumber ? { ...s, status } : s)));

    if (!isLiveMode || (status !== '完了' && status !== '不在')) return;
    void submitDeliveryResult(stop.trackingNumber, status, photoUri ?? null);
  };

  const submitDeliveryResult = async (
    trackingNumber: string,
    status: '完了' | '不在',
    photoUri: string | null
  ) => {
    const coords = await getCurrentCoords(); // 拒否/失敗/5秒タイムアウトでも null で続行
    const outcome = await recordDeliveryResult(trackingNumber, status, coords?.lat ?? null, coords?.lng ?? null);
    // 方針: 恒久エラー(42501/23514/P0002)＝サーバに記録されない → 画面（楽観更新）も未処理へ巻き戻す。
    //       一時エラー＝キューに積んで自動再送するので、楽観更新の「済」表示はそのまま維持する。
    if (outcome.outcome === 'permanent') {
      setStops((prev) =>
        prev.map((s) => (s.trackingNumber === trackingNumber ? { ...s, status: '未処理' } : s))
      );
      showToast(`⚠️ ${outcome.message ?? '記録に失敗しました'}`);
      return; // 完了自体が成立しなかった＝写真も紐付ける対象が無いので送らない
    }
    // 'ok' は既存のトースト（完了/不在タップ時）でカバー済み。'queued' はサイレント（自動再送）。

    // 置き配写真：完了記録の成否（ok/queued いずれも）と独立して試みる。
    // 失敗しても完了自体は既に成立しているため、ここでのエラーは画面のstatusを巻き戻さない
    // （写真はキューに積まれて自動再送される。§10.5「完了は写真の成否と独立」）。
    if (!photoUri || !driverInfo) return;
    void submitDeliveryPhoto(trackingNumber, driverInfo.driverId, photoUri).then((photoOutcome) => {
      if (photoOutcome.outcome === 'permanent') {
        showToast(`⚠️ ${photoOutcome.message ?? '写真を記録できませんでした'}`);
      }
      // 'ok'/'queued' はサイレント（完了時のトーストで既にカバー・自動再送に任せる）。
    });
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const handleTabChange = (tab: TabKey) => {
    if (isLiveMode && authStatus !== 'signedIn') return;
    if (!clockedIn) {
      if (tab !== 'delivery') showToast('先に出勤してください');
      return;
    }
    setActiveTab(tab);
  };

  let content: React.ReactNode;
  let showChrome = true; // TabBar/Toastの下地を出すかどうか

  if (isLiveMode && authStatus === 'checking') {
    showChrome = false;
    content = <CenteredMessage label="ログイン状態を確認しています…" showSpinner />;
  } else if (isLiveMode && authStatus === 'signedOut') {
    showChrome = false;
    content = <LoginScreen showToast={showToast} />;
  } else if (isLiveMode && authStatus === 'unauthorized') {
    showChrome = false;
    content = <UnauthorizedScreen onSignOut={handleSignOut} />;
  } else if (isLiveMode && authStatus === 'error') {
    showChrome = false;
    content = <AuthErrorScreen onRetry={handleRetryAuth} onSignOut={handleSignOut} />;
  } else if (isLiveMode && !routeLoaded) {
    content = <CenteredMessage label="本日のルートを取得しています…" showSpinner />;
  } else if (!clockedIn) {
    content = (
      <ClockInScreen
        driverFamilyName={driverInfo?.familyName ?? DEMO_DRIVER.familyName}
        onClockIn={handleClockIn}
        showToast={showToast}
      />
    );
  } else if (activeTab === 'map') {
    content = <MapScreen stops={stops} showToast={showToast} />;
  } else if (activeTab === 'today') {
    content = (
      <TodayScreen
        counts={counts}
        clockInTime={clockInTime}
        clockedOut={clockedOut}
        clockOutTime={clockOutTime}
        onClockOut={handleClockOut}
      />
    );
  } else {
    content = (
      <DeliveryScreen
        nextStop={nextStop}
        upcoming={upcoming}
        allStops={stops}
        counts={counts}
        onFinalizeStop={handleFinalizeStop}
        showToast={showToast}
      />
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeTop} edges={['top']}>
        <View style={styles.flexFill}>{content}</View>
      </SafeAreaView>
      {showChrome ? (
        <View style={{ paddingBottom: insets.bottom > 0 ? insets.bottom - 8 : 0 }}>
          <TabBar active={activeTab} onChange={handleTabChange} />
        </View>
      ) : null}
      <Toast toast={toast} />
      <ModeBadge topInset={insets.top} />
    </View>
  );
}

function CenteredMessage({ label, showSpinner }: { label: string; showSpinner?: boolean }) {
  return (
    <View style={styles.centered}>
      {showSpinner ? <ActivityIndicator color={colors.brand} style={{ marginBottom: 12 }} /> : null}
      <Text style={styles.centeredText}>{label}</Text>
    </View>
  );
}

function UnauthorizedScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.centeredTitle}>登録未完了</Text>
      <Text style={styles.centeredText}>
        このアカウントはドライバーとして登録されていません。{'\n'}
        管理者に連絡してドライバー登録（役割・ドライバーID）を確認してください。
      </Text>
      <Pressable style={styles.signOutBtn} onPress={onSignOut}>
        <Text style={styles.signOutBtnText}>別のアカウントでログインし直す</Text>
      </Pressable>
    </View>
  );
}

// 認証解決中の一時・通信エラー用（本当に未登録のUnauthorizedScreenとは別）。再試行を主動線にする。
function AuthErrorScreen({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.centeredTitle}>確認できませんでした</Text>
      <Text style={styles.centeredText}>
        ログイン状態の確認中に通信エラーが発生しました。{'\n'}
        電波状況をご確認のうえ、もう一度お試しください。
      </Text>
      <Pressable style={styles.retryBtn} onPress={onRetry}>
        <Text style={styles.retryBtnText}>再試行</Text>
      </Pressable>
      <Pressable style={styles.signOutBtn} onPress={onSignOut}>
        <Text style={styles.signOutBtnText}>ログアウト</Text>
      </Pressable>
    </View>
  );
}

// 開発・検証用の小さな表示（DEMO=モックデータ／LIVE=Supabase接続）。任意・軽量。
function ModeBadge({ topInset }: { topInset: number }) {
  return (
    <View pointerEvents="none" style={[styles.modeBadge, { top: topInset + 4 }]}>
      <Text style={styles.modeBadgeText}>{isLiveMode ? 'LIVE' : 'DEMO'}</Text>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safeTop: { flex: 1, backgroundColor: colors.card },
  flexFill: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: colors.bg,
  },
  centeredTitle: { fontSize: 18, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  centeredText: { fontSize: 13.5, color: colors.soft, textAlign: 'center', lineHeight: 20 },
  signOutBtn: {
    marginTop: 22,
    borderWidth: 1.5,
    borderColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  signOutBtnText: { color: colors.brand, fontWeight: '800', fontSize: 13.5 },
  retryBtn: {
    marginTop: 22,
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  retryBtnText: { color: colors.white, fontWeight: '800', fontSize: 13.5 },
  modeBadge: {
    position: 'absolute',
    right: 10,
    backgroundColor: 'rgba(17,19,24,0.72)',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  modeBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
});
