import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { colors } from './src/theme';
import { Counts, StopStatus, TabKey, ToastState } from './src/types';
import { DRIVER, generateStops } from './src/mockData';

import TabBar from './src/components/TabBar';
import Toast from './src/components/Toast';
import ClockInScreen from './src/screens/ClockInScreen';
import DeliveryScreen from './src/screens/DeliveryScreen';
import MapScreen from './src/screens/MapScreen';
import TodayScreen from './src/screens/TodayScreen';

function AppInner() {
  const insets = useSafeAreaInsets();

  const [stops, setStops] = useState(() => generateStops());
  const [activeTab, setActiveTab] = useState<TabKey>('delivery');
  const [clockedIn, setClockedIn] = useState(false);
  const [clockInTime, setClockInTime] = useState<Date | null>(null);
  const [clockedOut, setClockedOut] = useState(false);
  const [clockOutTime, setClockOutTime] = useState<Date | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = (message: string) => {
    setToast({ id: Date.now(), message });
  };

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

  const handleFinalizeStop = (seq: number, status: StopStatus) => {
    setStops((prev) => prev.map((s) => (s.seq === seq ? { ...s, status } : s)));
  };

  const handleTabChange = (tab: TabKey) => {
    if (!clockedIn) {
      if (tab !== 'delivery') showToast('先に出勤してください');
      return;
    }
    setActiveTab(tab);
  };

  let content: React.ReactNode;
  if (!clockedIn) {
    content = (
      <ClockInScreen
        driverFamilyName={DRIVER.familyName}
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
      <View style={{ paddingBottom: insets.bottom > 0 ? insets.bottom - 8 : 0 }}>
        <TabBar active={activeTab} onChange={handleTabChange} />
      </View>
      <Toast toast={toast} />
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
});
