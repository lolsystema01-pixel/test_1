import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';
import { Stop } from '../types';

type Step = 'choice' | 'photo';

interface Props {
  visible: boolean;
  stop: Stop | null;
  onSelectHandoff: () => void;
  onSelectDropoff: () => void;
  onConfirmPhoto: () => void;
  onCancel: () => void;
}

export default function CompletionModal({
  visible,
  stop,
  onSelectHandoff,
  onSelectDropoff,
  onConfirmPhoto,
  onCancel,
}: Props) {
  const [step, setStep] = useState<Step>('choice');
  const [captured, setCaptured] = useState(false);

  useEffect(() => {
    if (visible) {
      setStep('choice');
      setCaptured(false);
    }
  }, [visible]);

  const handleDropoff = () => {
    setStep('photo');
    onSelectDropoff();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Pressable style={styles.closeBtn} onPress={onCancel} hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.faint} />
        </Pressable>

        {step === 'choice' ? (
          <>
            <Text style={styles.title}>受け取り方法を選択</Text>
            {stop ? (
              <Text style={styles.subtitle}>
                {stop.ward}
                {stop.town}
                {stop.banchi}・{stop.recipient} 様
              </Text>
            ) : null}

            <Pressable style={styles.optionRow} onPress={onSelectHandoff}>
              <View style={[styles.optionIcon, { backgroundColor: colors.brandSoft }]}>
                <Ionicons name="hand-left-outline" size={22} color={colors.brandDark} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>手渡し</Text>
                <Text style={styles.optionSub}>対面でお渡しします</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </Pressable>

            <Pressable style={styles.optionRow} onPress={handleDropoff}>
              <View style={[styles.optionIcon, { backgroundColor: colors.doneSoft }]}>
                <Ionicons name="cube-outline" size={22} color={colors.done} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>置き配</Text>
                <Text style={styles.optionSub}>玄関先などに置いて配達します</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>置き配写真を撮影（モック）</Text>
            <Pressable
              style={[styles.photoBox, captured && styles.photoBoxCaptured]}
              onPress={() => setCaptured(true)}
            >
              <Ionicons
                name={captured ? 'checkmark-circle' : 'camera-outline'}
                size={40}
                color={captured ? colors.done : colors.faint}
              />
              <Text style={[styles.photoText, captured && { color: colors.done }]}>
                {captured ? '撮影しました（モック）' : 'タップして撮影（モック）'}
              </Text>
            </Pressable>
            <Text style={styles.note}>
              ※プロトタイプにつき実際のカメラは使用しません
            </Text>
            <Pressable style={styles.confirmBtn} onPress={onConfirmPhoto}>
              <Text style={styles.confirmText}>確定して次へ</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,14,20,0.45)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: 20,
    paddingBottom: 30,
    ...shadow.floating,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 12,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12.5,
    color: colors.soft,
    textAlign: 'center',
    marginBottom: 16,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginTop: 10,
  },
  optionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
  },
  optionSub: {
    fontSize: 11.5,
    color: colors.faint,
    marginTop: 2,
  },
  photoBox: {
    marginTop: 18,
    height: 160,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: 'dashed',
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoBoxCaptured: {
    backgroundColor: colors.doneSoft,
    borderColor: colors.done,
    borderStyle: 'solid',
  },
  photoText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.faint,
  },
  note: {
    fontSize: 11,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 10,
  },
  confirmBtn: {
    marginTop: 18,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  confirmText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '800',
  },
});
