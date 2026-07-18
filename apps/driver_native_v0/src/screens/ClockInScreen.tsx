import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';

interface Props {
  driverFamilyName: string;
  onClockIn: () => void;
  showToast: (message: string) => void;
}

export default function ClockInScreen({ driverFamilyName, onClockIn, showToast }: Props) {
  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.iconCircle}>
        <MaterialCommunityIcons name="truck-outline" size={38} color={colors.brand} />
      </View>

      <Text style={styles.greeting}>おはようございます</Text>
      <Text style={styles.greeting}>{driverFamilyName}さん</Text>
      <Text style={styles.subtitle}>今日も安全運転でお願いします！</Text>

      <Pressable style={styles.clockInBtn} onPress={onClockIn}>
        <View style={styles.clockInRow}>
          <Ionicons name="time-outline" size={20} color={colors.white} />
          <Text style={styles.clockInText}>出勤する</Text>
        </View>
        <Text style={styles.clockInSub}>6:00〜</Text>
      </Pressable>

      <View style={styles.gpsNote}>
        <Ionicons name="location-outline" size={13} color={colors.faint} />
        <Text style={styles.gpsNoteText}>
          出勤中のみ、位置情報を会社に送信します（1〜2分間隔・退勤で自動停止）
        </Text>
      </View>

      <View style={styles.checkCard}>
        <Text style={styles.checkCardLabel}>出勤前の確認</Text>

        <Pressable
          style={styles.checkRow}
          onPress={() => showToast('この機能は後日追加予定です')}
        >
          <Ionicons name="close-circle-outline" size={22} color={colors.faint} />
          <View style={{ flex: 1 }}>
            <Text style={styles.checkRowTitle}>アルコールチェック</Text>
            <Text style={styles.checkRowStatus}>未実施</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.faint} />
        </Pressable>

        <View style={styles.checkDivider} />

        <Pressable
          style={styles.checkRow}
          onPress={() => showToast('この機能は後日追加予定です')}
        >
          <Ionicons name="person-outline" size={22} color={colors.faint} />
          <View style={{ flex: 1 }}>
            <Text style={styles.checkRowTitle}>顔写真の撮影（後で追加）</Text>
            <Text style={styles.checkRowStatus}>未撮影</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.faint} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  iconCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  greeting: { fontSize: 22, fontWeight: '800', color: colors.ink, lineHeight: 30 },
  subtitle: { fontSize: 13.5, color: colors.soft, marginTop: 10, marginBottom: 28 },
  clockInBtn: {
    width: '100%',
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
    ...shadow.floating,
  },
  clockInRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clockInText: { color: colors.white, fontSize: 18, fontWeight: '800' },
  clockInSub: { color: colors.white, fontSize: 13, opacity: 0.85, marginTop: 4 },
  gpsNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 12,
    paddingHorizontal: 6,
  },
  gpsNoteText: { flex: 1, fontSize: 11, color: colors.faint, lineHeight: 16 },
  checkCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginTop: 26,
  },
  checkCardLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.soft,
    marginBottom: 10,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  checkRowTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  checkRowStatus: { fontSize: 12, color: colors.faint, marginTop: 2 },
  checkDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
});
