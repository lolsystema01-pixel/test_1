import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';
import { Counts, Stop, StopStatus } from '../types';
import { hasWarnings, stopWarnings } from '../warnings';
import SwipeToComplete from '../components/SwipeToComplete';
import CompletionModal from '../components/CompletionModal';

interface Props {
  nextStop: Stop | null;
  upcoming: Stop[];
  allStops: Stop[];
  counts: Counts;
  onFinalizeStop: (stop: Stop, status: StopStatus, photoUri?: string | null) => void;
  showToast: (message: string) => void;
}

export default function DeliveryScreen({
  nextStop,
  upcoming,
  allStops,
  counts,
  onFinalizeStop,
  showToast,
}: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const warnings = nextStop ? stopWarnings(nextStop, allStops) : [];

  const openHandoffChoice = () => {
    if (!nextStop) return;
    setModalVisible(true);
  };

  const finalizeCompletion = (photoUri?: string | null) => {
    if (!nextStop) return;
    onFinalizeStop(nextStop, '完了', photoUri ?? null);
    setModalVisible(false);
    showToast(photoUri ? '✅ 完了・📍位置と📷写真を記録' : '✅ 完了・📍位置を記録');
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>本日の配達</Text>
        <Pressable
          hitSlop={8}
          onPress={() => showToast('🔔 新しいお知らせはありません')}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.ink} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progressCard}>
          <View style={styles.progressTopRow}>
            <Text style={styles.progressMain}>
              処理 <Text style={styles.progressBold}>{counts.processed}</Text> /{' '}
              予定 {counts.total}
            </Text>
            <Text style={styles.progressRemain}>残り {counts.remaining} 件</Text>
          </View>
          <View style={styles.progressBarTrack}>
            <View
              style={[styles.progressBarFill, { width: `${counts.rate}%` }]}
            />
          </View>
          <Text style={styles.progressPct}>{counts.rate}%</Text>
        </View>

        {nextStop ? (
          <>
            <Text style={styles.sectionLabel}>次の配達</Text>
            <View style={styles.nextCard}>
              <View style={styles.ncTopRow}>
                <View style={styles.seqBadge}>
                  <Text style={styles.seqBadgeText}>{nextStop.seq}</Text>
                </View>
                <Text style={styles.seqTotal}>/ {counts.total}</Text>
                <View style={styles.winPill}>
                  <Text style={styles.winPillText}>{nextStop.window}</Text>
                </View>
              </View>

              <View style={styles.addrRow}>
                <Ionicons
                  name="location"
                  size={16}
                  color={colors.ink}
                  style={{ marginTop: 3 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.addrText}>{nextStop.prefectureWard}</Text>
                  <Text style={styles.addrText}>
                    {nextStop.town}
                    {nextStop.banchi}
                  </Text>
                </View>
              </View>
              <Text style={styles.recipientText}>
                {recipientLabel(nextStop.recipient)}
              </Text>

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Ionicons name="cube-outline" size={14} color={colors.soft} />
                  <Text style={styles.metaText}>
                    荷物 {nextStop.packageCount}個
                  </Text>
                </View>
                <View style={styles.metaDivider} />
                <View style={styles.metaItem}>
                  <Ionicons name="pricetag-outline" size={14} color={colors.soft} />
                  <Text style={styles.metaText}>かご {nextStop.basketCode}</Text>
                </View>
              </View>

              {nextStop.memo ? (
                <View style={styles.memoBox}>
                  <Ionicons
                    name="document-text-outline"
                    size={15}
                    color={colors.brandDark}
                  />
                  <Text style={styles.memoText}>{nextStop.memo}</Text>
                </View>
              ) : null}

              {warnings.map((w) => (
                <View style={styles.warnBox} key={w}>
                  <Ionicons name="warning" size={15} color={WARN_INK} />
                  <Text style={styles.warnText}>{w}</Text>
                </View>
              ))}

              <View style={styles.quickActions}>
                <Pressable
                  style={styles.quickBtn}
                  onPress={() => showToast('🧭 GoogleMap起動（モック）')}
                >
                  <Ionicons name="navigate-outline" size={16} color={colors.brandDark} />
                  <Text style={styles.quickBtnText}>ナビ</Text>
                </Pressable>
                <Pressable
                  style={styles.quickBtn}
                  onPress={() => showToast('📞 発信（モック）')}
                >
                  <Ionicons name="call-outline" size={16} color={colors.brandDark} />
                  <Text style={styles.quickBtnText}>電話</Text>
                </Pressable>
              </View>

              <View style={styles.swipeWrap}>
                <SwipeToComplete
                  key={nextStop.seq}
                  label="スワイプで完了"
                  onComplete={openHandoffChoice}
                />
              </View>

              <Pressable style={styles.absentBtn} onPress={handleAbsent}>
                <Ionicons name="person-outline" size={16} color={colors.absent} />
                <Text style={styles.absentBtnText}>不在</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.doneCard}>
            <Ionicons name="checkmark-circle" size={40} color={colors.done} />
            <Text style={styles.doneTitle}>本日の配達 完了！</Text>
            <Text style={styles.doneSub}>
              {counts.done} 件完了 ・ {counts.absent} 件不在
            </Text>
            <Text style={styles.doneHint}>「本日」タブから退勤できます</Text>
          </View>
        )}

        {upcoming.length > 0 ? (
          <>
            <Text style={styles.listLabel}>このあと（{upcoming.length}件）</Text>
            {upcoming.map((s) => (
              <View style={styles.stopRow} key={s.seq}>
                <View style={styles.stopSeq}>
                  <Text style={styles.stopSeqText}>{s.seq}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stopAddr}>
                    {s.ward}
                    {s.town}
                    {s.banchi}
                  </Text>
                </View>
                {hasWarnings(s, allStops) ? (
                  <Ionicons name="warning" size={15} color={WARN_INK} />
                ) : null}
                <View style={styles.stopWinPill}>
                  <Text style={styles.stopWinPillText}>{s.window}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.faint} />
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      <CompletionModal
        visible={modalVisible}
        stop={nextStop}
        onSelectHandoff={() => finalizeCompletion(null)}
        onConfirmDropoff={(photoUri) => finalizeCompletion(photoUri)}
        onCancel={() => setModalVisible(false)}
      />
    </View>
  );
}

const WARN_INK = '#9A6A0B';

const styles = StyleSheet.create({
  container: { flex: 1 },
  warnBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#FCF3E3',
    borderWidth: 1,
    borderColor: '#F0D9A8',
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 10,
  },
  warnText: { flex: 1, fontSize: 12.5, color: WARN_INK, fontWeight: '700', lineHeight: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: colors.card,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  body: { flex: 1, backgroundColor: colors.bg },
  bodyContent: { padding: 16, paddingBottom: 28 },

  progressCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  progressTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  progressMain: { fontSize: 15, fontWeight: '700', color: colors.ink },
  progressBold: { fontSize: 17, fontWeight: '800' },
  progressRemain: { fontSize: 13, color: colors.soft, fontWeight: '600' },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.brand,
    borderRadius: 4,
  },
  progressPct: {
    fontSize: 11,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 6,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.soft,
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 2,
  },

  nextCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    ...shadow.card,
  },
  ncTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  seqBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqBadgeText: { color: colors.brandDark, fontWeight: '800', fontSize: 14 },
  seqTotal: { color: colors.faint, fontWeight: '700', fontSize: 13 },
  winPill: {
    marginLeft: 'auto',
    backgroundColor: colors.brandSoft,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  winPillText: { color: colors.brandDark, fontWeight: '800', fontSize: 12 },

  addrRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  addrText: { fontSize: 17, fontWeight: '800', color: colors.ink, lineHeight: 23 },
  recipientText: { fontSize: 13, color: colors.soft, marginTop: 6, marginLeft: 22 },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 10,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12.5, color: colors.soft, fontWeight: '600' },
  metaDivider: { width: 1, height: 12, backgroundColor: colors.line },

  memoBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 12,
    alignItems: 'flex-start',
  },
  memoText: { flex: 1, fontSize: 12.5, color: colors.brandDark, lineHeight: 18 },

  quickActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  quickBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  quickBtnText: { color: colors.brandDark, fontWeight: '800', fontSize: 13 },

  swipeWrap: { marginTop: 16 },

  absentBtn: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: colors.absent,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  absentBtnText: { color: colors.absent, fontWeight: '800', fontSize: 14 },

  doneCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 24,
    alignItems: 'center',
    marginTop: 18,
    gap: 4,
  },
  doneTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginTop: 6 },
  doneSub: { fontSize: 13, color: colors.soft },
  doneHint: { fontSize: 12, color: colors.faint, marginTop: 6 },

  listLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.soft,
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 2,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
  },
  stopSeq: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSeqText: { color: colors.soft, fontWeight: '800', fontSize: 12 },
  stopAddr: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  stopWinPill: {
    backgroundColor: colors.brandSoft,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  stopWinPillText: { color: colors.brandDark, fontWeight: '700', fontSize: 10.5 },
});
