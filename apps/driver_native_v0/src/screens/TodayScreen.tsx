import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, motion, radius, space, type } from '../theme';
import { Counts } from '../types';

interface Props {
  counts: Counts;
  clockInTime: Date | null;
  clockedOut: boolean;
  clockOutTime: Date | null;
  onClockOut: () => void;
  onBackToClockIn: () => void; // 退勤後に出勤画面へ戻る（次の勤務サイクルへ）
}

function formatClock(d: Date): string {
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatElapsed(start: Date, end: Date): string {
  const totalMin = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}時間${m}分`;
}

export default function TodayScreen({
  counts,
  clockInTime,
  clockedOut,
  clockOutTime,
  onClockOut,
  onBackToClockIn,
}: Props) {
  const allDone = counts.remaining === 0;
  const title = clockedOut || allDone ? 'お疲れさまでした！' : '本日の実績';
  const subtitle =
    clockedOut || allDone
      ? '本日の配達が完了しました'
      : `残り ${counts.remaining} 件あります`;

  const now = clockOutTime ?? new Date();
  const distance = (counts.processed * 0.8 + 5).toFixed(1);
  const duration = clockInTime ? formatElapsed(clockInTime, now) : '--';

  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: motion.slow, useNativeDriver: true }).start();
  }, [anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View style={{ opacity: anim, transform: [{ translateY }], width: '100%', alignItems: 'center' }}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark-circle" size={44} color={colors.brand600} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.grid}>
          <MetricTile
            icon="checkmark-circle-outline"
            iconColor={colors.done700}
            iconBg={colors.done100}
            label="完了数"
            value={String(counts.done)}
            unit="件"
          />
          <MetricTile
            icon="person-outline"
            iconColor={colors.absent700}
            iconBg={colors.absent100}
            label="不在数"
            value={String(counts.absent)}
            unit="件"
          />
          <MetricTile
            icon="pie-chart-outline"
            iconColor={colors.brand700}
            iconBg={colors.brand100}
            label="処理率"
            value={String(counts.rate)}
            unit="%"
          />
          <MetricTile
            icon="car-outline"
            iconColor={colors.ink600}
            iconBg={colors.ink50}
            label="走行距離"
            value={distance}
            unit="km"
          />
        </View>

        <View style={styles.durationCard}>
          <View style={styles.durationLeft}>
            <Ionicons name="time-outline" size={18} color={colors.ink500} />
            <Text style={styles.durationLabel}>稼働時間</Text>
          </View>
          <Text style={styles.durationValue}>{duration}</Text>
        </View>

        {clockedOut ? (
          <>
            <View style={[styles.clockOutBtn, styles.clockOutBtnDone]}>
              <Ionicons name="checkmark" size={18} color={colors.ink500} />
              <Text style={styles.clockOutDoneText}>
                退勤済み {clockOutTime ? formatClock(clockOutTime) : ''}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.backToClockInBtn, pressed && styles.clockOutBtnPressed]}
              onPress={onBackToClockIn}
            >
              <Ionicons name="refresh" size={18} color={colors.brand} />
              <Text style={styles.backToClockInText}>出勤画面へ戻る</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.clockOutBtn, pressed && styles.clockOutBtnPressed]}
            onPress={onClockOut}
          >
            <Text style={styles.clockOutText}>退勤する</Text>
          </Pressable>
        )}
      </Animated.View>
    </ScrollView>
  );
}

function MetricTile({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  unit,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <View style={styles.tile}>
      <View style={[styles.tileIconCircle, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      <View style={styles.tileValueRow}>
        <Text style={styles.tileValue}>{value}</Text>
        <Text style={styles.tileUnit}>{unit}</Text>
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, backgroundColor: colors.paper },
  content: { padding: space.lg, paddingTop: space.xxl, paddingBottom: space.xxl, alignItems: 'center' },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.brand050,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.base,
  },
  title: { ...type.h1, color: colors.ink900 },
  subtitle: { ...type.body, color: colors.ink500, marginTop: space.xs, marginBottom: space.xl },

  grid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    ...elevation.e1,
  },
  tileIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  tileValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  tileValue: { ...type.display, fontSize: 28, lineHeight: 32, color: colors.ink900 },
  tileUnit: { ...type.metric, fontSize: 13, color: colors.ink500, marginLeft: 2 },
  tileLabel: { ...type.label, color: colors.ink500, marginTop: 2 },

  durationCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: space.md,
    paddingHorizontal: space.base,
    marginTop: space.sm,
  },
  durationLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  durationLabel: { ...type.bodyStrong, color: colors.ink700 },
  durationValue: { ...type.metric, fontSize: 17, color: colors.ink900 },

  backToClockInBtn: {
    width: '100%',
    minHeight: 56,
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.brandBg,
    borderWidth: 1.5,
    borderColor: colors.brand,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
  },
  backToClockInText: {
    ...type.bodyStrong,
    fontSize: 16,
    color: colors.brand,
  },
  clockOutBtn: {
    width: '100%',
    minHeight: 60,
    backgroundColor: colors.brand600,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xl,
    ...elevation.e3,
  },
  clockOutBtnPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  clockOutText: { color: colors.white, fontSize: 16, fontWeight: '800' },
  clockOutBtnDone: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    gap: space.sm,
    shadowOpacity: 0,
    elevation: 0,
  },
  clockOutDoneText: { ...type.bodyStrong, color: colors.ink500 },
});
