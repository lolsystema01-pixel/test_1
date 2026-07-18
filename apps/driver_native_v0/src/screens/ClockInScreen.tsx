import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, elevation, motion, radius, space, type } from '../theme';

interface Props {
  driverFamilyName: string;
  onClockIn: () => void;
  showToast: (message: string) => void;
}

export default function ClockInScreen({ driverFamilyName, onClockIn, showToast }: Props) {
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
          <MaterialCommunityIcons name="truck-outline" size={38} color={colors.brand600} />
        </View>

        <Text style={styles.greeting}>おはようございます</Text>
        <Text style={styles.greeting}>{driverFamilyName}さん</Text>
        <Text style={styles.subtitle}>今日も安全運転でお願いします！</Text>

        <Pressable
          style={({ pressed }) => [styles.clockInBtn, pressed && styles.clockInBtnPressed]}
          onPress={onClockIn}
        >
          <View style={styles.clockInRow}>
            <Ionicons name="time-outline" size={20} color={colors.white} />
            <Text style={styles.clockInText}>出勤する</Text>
          </View>
          <Text style={styles.clockInSub}>6:00〜</Text>
        </Pressable>

        <View style={styles.gpsNote}>
          <Ionicons name="location-outline" size={13} color={colors.ink400} />
          <Text style={styles.gpsNoteText}>
            出勤中のみ、位置情報を会社に送信します（1〜2分間隔・退勤で自動停止）
          </Text>
        </View>

        <View style={styles.checkCard}>
          <Text style={styles.checkCardLabel}>出勤前の確認</Text>

          <Pressable
            style={({ pressed }) => [styles.checkRow, pressed && styles.pressedSubtle]}
            onPress={() => showToast('この機能は後日追加予定です')}
          >
            <Ionicons name="close-circle-outline" size={22} color={colors.ink300} />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkRowTitle}>アルコールチェック</Text>
              <Text style={styles.checkRowStatus}>未実施</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.ink300} />
          </Pressable>

          <View style={styles.checkDivider} />

          <Pressable
            style={({ pressed }) => [styles.checkRow, pressed && styles.pressedSubtle]}
            onPress={() => showToast('この機能は後日追加予定です')}
          >
            <Ionicons name="person-outline" size={22} color={colors.ink300} />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkRowTitle}>顔写真の撮影（後で追加）</Text>
              <Text style={styles.checkRowStatus}>未撮影</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.ink300} />
          </Pressable>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, backgroundColor: colors.paper },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.huge,
  },
  pressedSubtle: { opacity: 0.6 },
  iconCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.brand050,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  greeting: { ...type.h1, fontSize: 23, lineHeight: 30, color: colors.ink900 },
  subtitle: { ...type.body, color: colors.ink500, marginTop: space.sm, marginBottom: space.xxl },
  clockInBtn: {
    width: '100%',
    minHeight: 64,
    backgroundColor: colors.brand600,
    borderRadius: radius.lg,
    paddingVertical: space.base,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.e3,
  },
  clockInBtnPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  clockInRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  clockInText: { color: colors.white, fontSize: 18, fontWeight: '800' },
  clockInSub: { color: colors.white, fontSize: 12.5, opacity: 0.85, marginTop: 4 },
  gpsNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: space.md,
    paddingHorizontal: space.xs,
  },
  gpsNoteText: { flex: 1, ...type.caption, color: colors.ink400, lineHeight: 16 },
  checkCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.base,
    marginTop: space.xl,
  },
  checkCardLabel: { ...type.overline, color: colors.ink500, marginBottom: space.sm },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    minHeight: 48,
  },
  checkRowTitle: { ...type.bodyStrong, color: colors.ink900 },
  checkRowStatus: { ...type.caption, color: colors.ink400, marginTop: 2 },
  checkDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
});
