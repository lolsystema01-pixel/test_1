import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';
import { Stop } from '../types';

type Step = 'choice' | 'photo';

interface Props {
  visible: boolean;
  stop: Stop | null;
  onSelectHandoff: () => void;
  // 置き配確定：写真を撮っていれば localUri・撮っていなければ null（撮影は必須にしない）
  onConfirmDropoff: (photoUri: string | null) => void;
  onCancel: () => void;
}

// 撮影ガイド文言（要件8.5）：置き配写真は「荷物と置き場所」の証跡。プライバシーに配慮する。
const PHOTO_GUIDE = '荷物と置き場所が分かるように撮影してください。人物・車のナンバー・室内は写さないでください。';

export default function CompletionModal({
  visible,
  stop,
  onSelectHandoff,
  onConfirmDropoff,
  onCancel,
}: Props) {
  const [step, setStep] = useState<Step>('choice');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (visible) {
      setStep('choice');
      setPhotoUri(null);
      setPermissionDenied(false);
    }
  }, [visible]);

  const handleDropoff = () => {
    setStep('photo');
  };

  const handleTakePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      const result = await ImagePicker.launchCameraAsync({ quality: 0.4 });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch {
      // カメラ起動自体の失敗も静かに無視する（撮影必須にしない＝「写真なしで完了」に進める）
    }
  };

  const handleConfirm = () => {
    onConfirmDropoff(photoUri);
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
            <Text style={styles.title}>置き配写真を撮影</Text>
            <Text style={styles.photoGuide}>{PHOTO_GUIDE}</Text>

            <Pressable
              style={[styles.photoBox, photoUri && styles.photoBoxCaptured]}
              onPress={handleTakePhoto}
            >
              {photoUri ? (
                <>
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
                  <View style={styles.retakeBadge}>
                    <Ionicons name="camera-reverse-outline" size={14} color={colors.white} />
                    <Text style={styles.retakeBadgeText}>タップで撮り直す</Text>
                  </View>
                </>
              ) : (
                <>
                  <Ionicons name="camera-outline" size={40} color={colors.faint} />
                  <Text style={styles.photoText}>タップして撮影</Text>
                </>
              )}
            </Pressable>

            {permissionDenied ? (
              <Text style={styles.note}>
                カメラの権限が許可されていません。「写真なしで完了」で先に進められます。
              </Text>
            ) : null}

            <Pressable style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmText}>{photoUri ? '確定して次へ' : '写真なしで完了'}</Text>
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
  photoGuide: {
    fontSize: 12,
    color: colors.soft,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 4,
  },
  photoBox: {
    marginTop: 14,
    height: 160,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: 'dashed',
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  photoBoxCaptured: {
    backgroundColor: colors.doneSoft,
    borderColor: colors.done,
    borderStyle: 'solid',
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  retakeBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(10,14,20,0.6)',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  retakeBadgeText: {
    color: colors.white,
    fontSize: 10.5,
    fontWeight: '700',
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
