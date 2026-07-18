import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, motion, radius, space, type } from '../theme';
import { Counts, Stop, StopStatus } from '../types';
import { hasWarnings, stopWarnings } from '../warnings';
import SwipeToComplete from '../components/SwipeToComplete';
import CompletionModal from '../components/CompletionModal';

interface Props {
  nextStop: Stop | null;
  upcoming: Stop[];
  allStops: Stop[];
  counts: Counts;
  onFinalizeStop: (stop: Stop, status: StopStatus, photoUris?: string[]) => void;
  // 日内再訪（LOL確定2026-07-18）：不在の荷物を未処理に戻して再度タップできるようにする
  onRedispatch: (stop: Stop) => void;
  showToast: (message: string) => void;
}

// 抑制の効いた出現モーション（"精密な計器が反応する"感）。ロジックには一切関与しない純粋な演出。
function Reveal({ index = 0, children }: { index?: number; children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: motion.base,
      delay: Math.min(index, 6) * motion.stagger,
      useNativeDriver: true,
    }).start();
  }, [anim, index]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return <Animated.View style={{ opacity: anim, transform: [{ translateY }] }}>{children}</Animated.View>;
}

export default function DeliveryScreen({
  nextStop,
  upcoming,
  allStops,
  counts,
  onFinalizeStop,
  onRedispatch,
  showToast,
}: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const warnings = nextStop ? stopWarnings(nextStop, allStops) : [];
  const absentStops = allStops.filter((s) => s.status === '不在');

  const openHandoffChoice = () => {
    if (!nextStop) return;
    setModalVisible(true);
  };

  const finalizeCompletion = (photoUris: string[]) => {
    if (!nextStop) return;
    onFinalizeStop(nextStop, '完了', photoUris);
    setModalVisible(false);
    showToast(photoUris.length > 0 ? '✅ 完了・📍位置と📷写真を記録' : '✅ 完了・📍位置を記録');
  };

  const handleRedispatch = (stop: Stop) => {
    onRedispatch(stop);
    showToast('🔁 再配達の準備をしました（未処理に戻りました）');
  };

  const handleAbsent = () => {
    if (!nextStop) return;
    const stop = nextStop;
    // 不在=当日終端（再配達はお客様の受付経由・本日中は不可＝最短翌日）をルールとして提示
    Alert.alert(
      '不在として記録します',
      '不在票を投函してください。\n再配達はお客様からの受付で承ります（本日中の再配達は不可・最短で翌日）。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '不在で記録',
          style: 'destructive',
          onPress: () => {
            onFinalizeStop(stop, '不在');
            showToast('🚪 不在・📍位置を記録');
          },
        },
      ]
    );
  };

  const recipientLabel = (recipient: string) =>
    recipient === '—' ? 'お名前不明' : `${recipient} 様`;

  // 表示専用の派生値（進捗バーのセグメント幅）。stateにもロジックにも影響しない。
  const totalForRatio = counts.total > 0 ? counts.total : 1;
  const doneRatio = (counts.done / totalForRatio) * 100;
  const absentRatio = (counts.absent / totalForRatio) * 100;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>本日の配達</Text>
        <Pressable
          hitSlop={8}
          style={({ pressed }) => [styles.bellBtn, pressed && styles.pressedSubtle]}
          onPress={() => showToast('🔔 新しいお知らせはありません')}
        >
          <Ionicons name="notifications-outline" size={20} color={colors.ink800} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <Reveal index={0}>
          <View style={styles.progressCard}>
            <Text style={styles.progressOverline}>本日の進捗</Text>
            <View style={styles.progressMetricRow}>
              <View style={styles.progressMetricMain}>
                <Text style={styles.progressMetricValue}>{counts.processed}</Text>
                <Text style={styles.progressMetricTotal}>/{counts.total}</Text>
              </View>
              <View style={styles.progressRemainChip}>
                <Text style={styles.progressRemainChipText}>残り {counts.remaining} 件</Text>
              </View>
            </View>

            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarSegment, styles.progressBarDone, { width: `${doneRatio}%` }]} />
              <View
                style={[
                  styles.progressBarSegment,
                  styles.progressBarAbsent,
                  { width: `${absentRatio}%`, left: `${doneRatio}%` },
                ]}
              />
            </View>

            <View style={styles.progressFooterRow}>
              <View style={styles.progressLegendItem}>
                <View style={[styles.progressDot, { backgroundColor: colors.done }]} />
                <Text style={styles.progressLegendText}>完了 {counts.done}</Text>
              </View>
              <View style={styles.progressLegendItem}>
                <View style={[styles.progressDot, { backgroundColor: colors.absent }]} />
                <Text style={styles.progressLegendText}>不在 {counts.absent}</Text>
              </View>
              <Text style={styles.progressPct}>{counts.rate}%</Text>
            </View>
          </View>
        </Reveal>

        {nextStop ? (
          <>
            <Text style={styles.sectionOverline}>次の配達</Text>
            <Reveal key={nextStop.seq} index={1}>
              <View style={styles.nextCard}>
                <View style={styles.ncTopRow}>
                  <View style={styles.stopBadge}>
                    <Text style={styles.stopBadgeValue}>{nextStop.seq}</Text>
                  </View>
                  <Text style={styles.stopBadgeTotal}>/ {counts.total}</Text>
                  <View style={styles.winPill}>
                    <Text style={styles.winPillText}>{nextStop.window}</Text>
                  </View>
                </View>

                <View style={styles.addrRow}>
                  <Ionicons name="location" size={16} color={colors.brand600} style={{ marginTop: 3 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addrPrefecture}>{nextStop.prefectureWard}</Text>
                    <Text style={styles.addrTown}>
                      {nextStop.town}
                      {nextStop.banchi}
                    </Text>
                  </View>
                </View>
                <Text style={styles.recipientText}>{recipientLabel(nextStop.recipient)}</Text>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Ionicons name="cube-outline" size={14} color={colors.ink500} />
                    <Text style={styles.metaText}>荷物 {nextStop.packageCount}個</Text>
                  </View>
                  <View style={styles.metaDivider} />
                  <View style={styles.metaItem}>
                    <Ionicons name="pricetag-outline" size={14} color={colors.ink500} />
                    <Text style={styles.metaText}>かご {nextStop.basketCode}</Text>
                  </View>
                </View>

                {nextStop.memo ? (
                  <View style={styles.memoBox}>
                    <Ionicons name="document-text-outline" size={15} color={colors.brand700} />
                    <Text style={styles.memoText}>{nextStop.memo}</Text>
                  </View>
                ) : null}

                {warnings.map((w) => (
                  <View style={styles.warnBox} key={w}>
                    <Ionicons name="warning" size={15} color={colors.warn} />
                    <Text style={styles.warnText}>{w}</Text>
                  </View>
                ))}

                <View style={styles.quickActions}>
                  <Pressable
                    style={({ pressed }) => [styles.quickBtn, pressed && styles.pressedSubtle]}
                    onPress={() => showToast('🧭 GoogleMap起動（モック）')}
                  >
                    <Ionicons name="navigate-outline" size={16} color={colors.ink700} />
                    <Text style={styles.quickBtnText}>ナビ</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.quickBtn, pressed && styles.pressedSubtle]}
                    onPress={() => showToast('📞 発信（モック）')}
                  >
                    <Ionicons name="call-outline" size={16} color={colors.ink700} />
                    <Text style={styles.quickBtnText}>電話</Text>
                  </Pressable>
                </View>

                <View style={styles.swipeWrap}>
                  <SwipeToComplete key={nextStop.seq} label="スワイプで完了" onComplete={openHandoffChoice} />
                </View>

                <Pressable
                  style={({ pressed }) => [styles.absentBtn, pressed && styles.pressedSubtle]}
                  onPress={handleAbsent}
                >
                  <Ionicons name="person-outline" size={16} color={colors.absent700} />
                  <Text style={styles.absentBtnText}>不在</Text>
                </Pressable>
              </View>
            </Reveal>
          </>
        ) : (
          <Reveal index={1}>
            <View style={styles.doneCard}>
              <View style={styles.doneIconCircle}>
                <Ionicons name="checkmark" size={30} color={colors.done700} />
              </View>
              <Text style={styles.doneTitle}>本日の配達 完了！</Text>
              <View style={styles.doneStatsRow}>
                <Text style={styles.doneStatsText}>
                  <Text style={styles.doneStatsValue}>{counts.done}</Text> 件完了 ・{' '}
                  <Text style={styles.doneStatsValue}>{counts.absent}</Text> 件不在
                </Text>
              </View>
              <Text style={styles.doneHint}>「本日」タブから退勤できます</Text>
            </View>
          </Reveal>
        )}

        {upcoming.length > 0 ? (
          <>
            <Text style={styles.sectionOverline}>このあと（{upcoming.length}件）</Text>
            <View style={styles.listCard}>
              {upcoming.map((s, i) => (
                <View key={s.seq}>
                  {i > 0 ? <View style={styles.listDivider} /> : null}
                  <Reveal index={2 + Math.min(i, 6)}>
                    <View style={styles.stopRow}>
                      <View style={styles.stopSeq}>
                        <Text style={styles.stopSeqText}>{s.seq}</Text>
                      </View>
                      <View style={styles.stopRowMain}>
                        <Text style={styles.stopAddr}>
                          {s.ward}
                          {s.town}
                          {s.banchi}
                        </Text>
                      </View>
                      {hasWarnings(s, allStops) ? (
                        <Ionicons name="warning" size={14} color={colors.warn} style={styles.stopWarnIcon} />
                      ) : null}
                      <View style={styles.stopWinPill}>
                        <Text style={styles.stopWinPillText}>{s.window}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.ink300} />
                    </View>
                  </Reveal>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {absentStops.length > 0 ? (
          <>
            <Text style={styles.sectionOverline}>不在（{absentStops.length}件・再配達可能）</Text>
            {absentStops.map((s, i) => (
              <Reveal key={s.seq} index={2 + upcoming.length + Math.min(i, 4)}>
                <View style={styles.absentRow}>
                  <View style={styles.absentIcon}>
                    <Ionicons name="person" size={15} color={colors.absent700} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stopAddr}>
                      {s.ward}
                      {s.town}
                      {s.banchi}
                    </Text>
                    <Text style={styles.absentRowSub}>{recipientLabel(s.recipient)}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.redispatchBtn, pressed && styles.pressedSubtle]}
                    onPress={() => handleRedispatch(s)}
                  >
                    <Ionicons name="refresh" size={14} color={colors.brand700} />
                    <Text style={styles.redispatchBtnText}>再配達</Text>
                  </Pressable>
                </View>
              </Reveal>
            ))}
          </>
        ) : null}
      </ScrollView>

      <CompletionModal
        visible={modalVisible}
        stop={nextStop}
        onSelectHandoff={() => finalizeCompletion([])}
        onConfirmDropoff={finalizeCompletion}
        onCancel={() => setModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pressedSubtle: { opacity: 0.6 },

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
  headerTitle: { ...type.h1, color: colors.ink900 },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, backgroundColor: colors.paper },
  bodyContent: { padding: space.base, paddingBottom: space.xxl },

  // ---- 進捗カード ----
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.base,
    ...elevation.e1,
  },
  progressOverline: { ...type.overline, color: colors.ink500 },
  progressMetricRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  progressMetricMain: { flexDirection: 'row', alignItems: 'baseline' },
  progressMetricValue: { ...type.display, color: colors.ink900 },
  progressMetricTotal: {
    ...type.metric,
    fontSize: 18,
    lineHeight: 22,
    color: colors.ink400,
    marginLeft: 2,
  },
  progressRemainChip: {
    backgroundColor: colors.ink50,
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    marginBottom: 4,
  },
  progressRemainChipText: { ...type.label, color: colors.ink600 },
  progressBarTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.ink100,
    marginTop: space.md,
    overflow: 'hidden',
    position: 'relative',
  },
  progressBarSegment: { position: 'absolute', top: 0, bottom: 0, borderRadius: radius.pill },
  progressBarDone: { left: 0, backgroundColor: colors.done },
  progressBarAbsent: { backgroundColor: colors.absent },
  progressFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.sm,
    gap: space.md,
  },
  progressLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  progressLegendText: { ...type.caption, color: colors.ink500 },
  progressPct: { ...type.metric, fontSize: 12.5, color: colors.ink400, marginLeft: 'auto' },

  // ---- セクション見出し ----
  sectionOverline: {
    ...type.overline,
    color: colors.ink500,
    marginTop: space.xl,
    marginBottom: space.sm,
    marginLeft: 2,
  },

  // ---- 次の配達（主役カード） ----
  nextCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: colors.brand300,
    padding: space.lg,
    ...elevation.e3,
  },
  ncTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stopBadge: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.brand100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBadgeValue: { ...type.metric, fontSize: 18, lineHeight: 22, color: colors.brand700 },
  stopBadgeTotal: { ...type.metric, fontSize: 13, color: colors.ink400 },
  winPill: {
    marginLeft: 'auto',
    backgroundColor: colors.brand050,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: space.md,
  },
  winPillText: { ...type.label, color: colors.brand700 },

  addrRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  addrPrefecture: { ...type.caption, color: colors.ink400 },
  addrTown: { ...type.title, fontSize: 19, lineHeight: 25, color: colors.ink900, marginTop: 1 },
  recipientText: { ...type.body, color: colors.ink600, marginTop: space.xs, marginLeft: 22 },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
    gap: space.md,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { ...type.caption, color: colors.ink500 },
  metaDivider: { width: 1, height: 12, backgroundColor: colors.hairline },

  memoBox: {
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.brand050,
    borderRadius: radius.sm,
    padding: space.sm,
    marginTop: space.md,
    alignItems: 'flex-start',
  },
  memoText: { flex: 1, ...type.caption, color: colors.brand700, lineHeight: 18 },

  warnBox: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warnSoft,
    borderWidth: 1,
    borderColor: colors.warnLine,
    borderRadius: radius.sm,
    padding: space.sm,
    marginTop: space.sm,
  },
  warnText: { flex: 1, ...type.caption, color: colors.warn, lineHeight: 18 },

  quickActions: { flexDirection: 'row', gap: space.sm, marginTop: space.base },
  quickBtn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink50,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
  },
  quickBtnText: { ...type.bodyStrong, color: colors.ink700 },

  swipeWrap: { marginTop: space.base },

  absentBtn: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: space.sm,
    borderWidth: 1.5,
    borderColor: colors.absent,
    borderRadius: radius.md,
  },
  absentBtnText: { ...type.bodyStrong, color: colors.absent700 },

  doneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.xl,
    alignItems: 'center',
    marginTop: space.lg,
    ...elevation.e1,
  },
  doneIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.done100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  doneTitle: { ...type.h2, color: colors.ink900, marginTop: 4 },
  doneStatsRow: { marginTop: space.sm },
  doneStatsText: { ...type.body, color: colors.ink600 },
  doneStatsValue: { ...type.metric, fontSize: 14, color: colors.ink900 },
  doneHint: { ...type.caption, color: colors.ink400, marginTop: space.sm },

  listCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  listDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  stopRowMain: { flex: 1 },
  stopSeq: {
    width: 26,
    height: 26,
    borderRadius: radius.xs,
    backgroundColor: colors.ink50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSeqText: { ...type.metric, fontSize: 12, color: colors.ink600 },
  stopAddr: { ...type.bodyStrong, color: colors.ink900 },
  stopWarnIcon: { marginRight: 2 },
  stopWinPill: {
    backgroundColor: colors.ink50,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: space.sm,
  },
  stopWinPillText: { ...type.caption, color: colors.ink600 },

  absentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.absent100,
    borderWidth: 1,
    borderColor: colors.absent500,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  absentIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  absentRowSub: { ...type.caption, color: colors.ink600, marginTop: 2 },
  redispatchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.brand500,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: space.md,
    minHeight: 36,
  },
  redispatchBtnText: { ...type.label, color: colors.brand700 },
});
