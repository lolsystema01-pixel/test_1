import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';
import { Counts } from '../types';

interface Props {
  counts: Counts;
  clockInTime: Date | null;
  clockedOut: boolean;
  clockOutTime: Date | null;
  onClockOut: () => void;
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

  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.iconCircle}>
        <Ionicons name="checkmark-circle" size={44} color={colors.brand} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.card}>
        <StatRow
          icon="checkmark-circle-outline"
          iconColor={colors.done}
          label="完了数"
          value={`${counts.done} 件`}
          valueColor={colors.done}
        />
        <Divider />
        <StatRow
          icon="person-outline"
          iconColor={colors.absent}
          label="不在数"
          value={`${counts.absent} 件`}
          valueColor={colors.absent}
        />
        <Divider />
        <StatRow
          icon="pie-chart-outline"
          iconColor={colors.brand}
          label="処理率"
          value={`${counts.rate}%`}
          valueColor={colors.brand}
        />
        <Divider />
        <StatRow
          icon="car-outline"
          iconColor={colors.soft}
          label="走行距離"
          value={`${distance} km`}
          valueColor={colors.ink}
        />
        <Divider />
        <StatRow
          icon="time-outline"
          iconColor={colors.soft}
          label="稼働時間"
          value={duration}
          valueColor={colors.ink}
        />
      </View>

      {clockedOut ? (
        <View style={[styles.clockOutBtn, styles.clockOutBtnDone]}>
          <Ionicons name="checkmark" size={18} color={colors.soft} />
          <Text style={styles.clockOutDoneText}>
            退勤済み {clockOutTime ? formatClock(clockOutTime) : ''}
          </Text>
        </View>
      ) : (
        <Pressable style={styles.clockOutBtn} onPress={onClockOut}>
          <Text style={styles.clockOutText}>退勤する</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function StatRow({
  icon,
  iconColor,
  label,
  value,
  valueColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  value: string;
  valueColor: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={18} color={iconColor} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  body: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 32, paddingBottom: 32, alignItems: 'center' },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: 13.5, color: colors.soft, marginTop: 6, marginBottom: 24 },
  card: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  rowValue: { fontSize: 17, fontWeight: '800' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  clockOutBtn: {
    width: '100%',
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 26,
    ...shadow.floating,
  },
  clockOutText: { color: colors.white, fontSize: 16, fontWeight: '800' },
  clockOutBtnDone: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    gap: 8,
    shadowOpacity: 0,
    elevation: 0,
  },
  clockOutDoneText: { color: colors.soft, fontSize: 14, fontWeight: '700' },
});
