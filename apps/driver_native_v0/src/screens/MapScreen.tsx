import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, radius, space, type } from '../theme';
import { Stop } from '../types';

interface Props {
  stops: Stop[];
  showToast: (message: string) => void;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function computeBounds(stops: Stop[]): Bounds {
  const lats = stops.map((s) => s.lat);
  const lngs = stops.map((s) => s.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

const PAD = 0.14; // 端にピンが張り付かないよう周囲に余白を確保

function toXY(lat: number, lng: number, b: Bounds) {
  const latSpan = b.maxLat - b.minLat || 1;
  const lngSpan = b.maxLng - b.minLng || 1;
  const nx = (lng - b.minLng) / lngSpan;
  const ny = (lat - b.minLat) / latSpan;
  const x = PAD * 100 + nx * (1 - PAD * 2) * 100;
  const y = (1 - ny) * (1 - PAD * 2) * 100 + PAD * 100;
  return { x, y };
}

function pinColor(status: Stop['status']) {
  if (status === '完了') return colors.done;
  if (status === '不在') return colors.absent;
  return colors.pending;
}

export default function MapScreen({ stops, showToast }: Props) {
  const bounds = computeBounds(stops);
  const processedDesc = [...stops].filter((s) => s.status !== '未処理').sort((a, b) => b.seq - a.seq);
  const current = processedDesc[0] ?? stops[0];
  const currentXY = current ? toXY(current.lat, current.lng, bounds) : { x: 50, y: 50 };

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable hitSlop={8} onPress={() => showToast('メニュー（モック）')}>
          <Ionicons name="menu-outline" size={24} color={colors.ink800} />
        </Pressable>
        <Text style={styles.headerTitle}>地図</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.mapBox}>
          <View style={styles.park} />
          <View style={[styles.road, { left: 0, top: '46%', width: '100%', height: 4 }]} />
          <View style={[styles.road, { left: '38%', top: 0, width: 4, height: '100%' }]} />
          <View
            style={[styles.road, { left: '70%', top: 0, width: 3, height: '100%', opacity: 0.5 }]}
          />

          <Text style={[styles.mapLabel, { left: '8%', top: '10%' }]}>桜新町駅</Text>
          <Text style={[styles.mapLabel, { right: '6%', top: '8%' }]}>駒沢公園</Text>
          <Text style={[styles.mapLabel, { left: '10%', bottom: '14%' }]}>等々力</Text>

          {stops.map((s) => {
            const p = toXY(s.lat, s.lng, bounds);
            return (
              <View
                key={s.seq}
                style={[
                  styles.pin,
                  {
                    left: `${p.x}%`,
                    top: `${p.y}%`,
                    backgroundColor: pinColor(s.status),
                  },
                ]}
              />
            );
          })}

          <View
            style={[
              styles.meWrap,
              { left: `${currentXY.x}%`, top: `${currentXY.y}%` },
            ]}
          >
            <Animated.View
              style={[
                styles.meRing,
                { opacity: ringOpacity, transform: [{ scale: ringScale }] },
              ]}
            />
            <View style={styles.meDot} />
          </View>

          <Pressable
            hitSlop={8}
            style={({ pressed }) => [styles.locateBtn, pressed && styles.locateBtnPressed]}
            onPress={() => showToast('現在地に移動（モック）')}
          >
            <Ionicons name="navigate" size={18} color={colors.brand600} />
          </Pressable>
        </View>

        <View style={styles.legend}>
          <LegendItem color={colors.pending} label="未配達" />
          <LegendItem color={colors.done} label="完了" />
          <LegendItem color={colors.absent} label="不在" />
          <LegendItem color={colors.brand600} label="現在地" />
        </View>

        <Pressable
          style={({ pressed }) => [styles.navBtn, pressed && styles.navBtnPressed]}
          onPress={() => showToast('🧭 GoogleMapでナビを開始します（モック）')}
        >
          <Ionicons name="navigate-outline" size={18} color={colors.white} />
          <Text style={styles.navBtnText}>GoogleMapでナビを開始</Text>
        </Pressable>

        <Text style={styles.mapPlanNote}>
          ※本番: アプリ内の地図（全ピン俯瞰）＝ゼンリン地図API ／
          走行中のナビ＝GoogleMapを外部起動（進行方向上向き・音声案内）
        </Text>
      </ScrollView>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerTitle: { ...type.h2, color: colors.ink900 },
  body: { flex: 1, backgroundColor: colors.paper },
  bodyContent: { padding: space.base, paddingBottom: space.xxl },

  mapBox: {
    width: '100%',
    aspectRatio: 0.95,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#eef1f5',
    overflow: 'hidden',
    position: 'relative',
  },
  park: {
    position: 'absolute',
    right: '4%',
    top: '4%',
    width: '30%',
    height: '18%',
    backgroundColor: '#dcefdf',
    borderRadius: 16,
  },
  road: {
    position: 'absolute',
    backgroundColor: '#d3dae2',
  },
  mapLabel: {
    position: 'absolute',
    ...type.caption,
    color: colors.ink500,
  },
  pin: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.white,
    marginLeft: -7,
    marginTop: -7,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  meWrap: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meRing: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    marginTop: -8,
    backgroundColor: colors.brand600,
  },
  meDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    marginTop: -8,
    backgroundColor: colors.brand600,
    borderWidth: 3,
    borderColor: colors.white,
  },
  locateBtn: {
    position: 'absolute',
    right: space.md,
    bottom: space.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.e3,
  },
  locateBtnPressed: { opacity: 0.85 },

  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { ...type.caption, color: colors.ink500 },

  navBtn: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    backgroundColor: colors.brand600,
    borderRadius: radius.lg,
    marginTop: space.base,
    ...elevation.e3,
  },
  navBtnPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  navBtnText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  mapPlanNote: {
    ...type.caption,
    color: colors.ink500,
    lineHeight: 16,
    marginTop: space.sm,
    paddingHorizontal: space.xs,
  },
});
