import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, elevation, radius, space, type } from '../theme';
import { Stop } from '../types';

type Step = 'choice' | 'photo';

// 1配達につき最大3枚（2026-07-18 LOL確定）。
const MAX_PHOTOS = 3;
const PHOTO_SLOTS = [0, 1, 2] as const;

interface Props {
  visible: boolean;
  stop: Stop | null;
  onSelectHandoff: () => void;
  // 置き配確定：撮影した順で最大3枚（0枚=撮影なしも可・撮影は必須にしない）
  onConfirmDropoff: (photoUris: string[]) => void;
  onCancel: () => void;
}

// 撮影ガイド文言（要件8.5）：置き配写真は「荷物と置き場所」の証跡。プライバシーに配慮する。
const PHOTO_GUIDE =
  '荷物と置き場所が分かるように撮影してください（最大3枚・0枚でも完了できます）。人物・車のナンバー・室内は写さないでください。';

export default function CompletionModal({
  visible,
  stop,
  onSelectHandoff,
  onConfirmDropoff,
  onCancel,
}: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('choice');
  // 3枠固定（null=未撮影）。indexがそのままseq-1（Storageパスの{seq}に対応）。
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // 手渡し＝選択→確定の2段階（誤タップでの即確定を防ぐ）。
  const [selectedHandoff, setSelectedHandoff] = useState(false);

  useEffect(() => {
    if (visible) {
      setStep('choice');
      setPhotos([null, null, null]);
      setPermissionDenied(false);
      setSelectedHandoff(false);
    }
  }, [visible]);

  const handleDropoff = () => {
    setStep('photo');
  };

  const handleTakePhoto = async (slot: number) => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      const result = await ImagePicker.launchCameraAsync({ quality: 0.4 });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setPhotos((prev) => prev.map((p, i) => (i === slot ? result.assets[0].uri : p)));
      }
    } catch {
      // カメラ起動自体の失敗も静かに無視する（撮影必須にしない＝「写真なしで完了」に進める）
    }
  };

  const photoCount = photos.filter((p) => p !== null).length;

  const handleConfirm = () => {
    onConfirmDropoff(photos.filter((p): p is string => p !== null));
  };

  // 撮影済み写真が1枚以上あるときは破棄確認を挟む（X・背景タップ・onRequestCloseの共通経路）。
  const attemptCancel = () => {
    if (photoCount > 0) {
      Alert.alert('写真を破棄しますか？', '撮影した写真は保存されません', [
        { text: '撮り直しに戻る', style: 'cancel' },
        { text: '破棄して閉じる', style: 'destructive', onPress: onCancel },
      ]);
      return;
    }
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={attemptCancel}>
      <Pressable style={styles.backdrop} onPress={attemptCancel} />
      <View style={[styles.sheet, { paddingBottom: space.xxl + insets.bottom }]}>
        <View style={styles.grabber} />
        <Pressable style={styles.closeBtn} onPress={attemptCancel} hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.ink400} />
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

            <Pressable
              style={({ pressed }) => [
                styles.optionRow,
                selectedHandoff && styles.optionRowSelected,
                pressed && styles.optionRowPressed,
              ]}
              onPress={() => setSelectedHandoff(true)}
            >
              <View style={[styles.optionIcon, { backgroundColor: colors.brand100 }]}>
                <Ionicons name="hand-left-outline" size={22} color={colors.brand700} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>手渡し</Text>
                <Text style={styles.optionSub}>対面でお渡しします</Text>
              </View>
              {selectedHandoff ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.brand600} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.ink300} />
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}
              onPress={handleDropoff}
            >
              <View style={[styles.optionIcon, { backgroundColor: colors.done100 }]}>
                <Ionicons name="cube-outline" size={22} color={colors.done700} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>置き配</Text>
                <Text style={styles.optionSub}>玄関先などに置いて配達します</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.ink300} />
            </Pressable>

            {selectedHandoff ? (
              <Pressable
                style={({ pressed }) => [styles.confirmBtn, pressed && styles.confirmBtnPressed]}
                onPress={onSelectHandoff}
              >
                <Text style={styles.confirmText}>手渡しで完了</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.title}>置き配写真を撮影</Text>
            <Text style={styles.photoGuide}>{PHOTO_GUIDE}</Text>

            <View style={styles.photoRow}>
              {PHOTO_SLOTS.map((slot) => {
                const uri = photos[slot];
                return (
                  <Pressable
                    key={slot}
                    style={({ pressed }) => [
                      styles.photoBox,
                      uri && styles.photoBoxCaptured,
                      pressed && styles.photoBoxPressed,
                    ]}
                    onPress={() => handleTakePhoto(slot)}
                  >
                    {uri ? (
                      <>
                        <Image source={{ uri }} style={styles.photoPreview} resizeMode="cover" />
                        <View style={styles.retakeBadge}>
                          <Ionicons name="camera-reverse-outline" size={12} color={colors.white} />
                        </View>
                      </>
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={26} color={colors.ink300} />
                        <Text style={styles.photoText}>{slot + 1}枚目</Text>
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {permissionDenied ? (
              <Text style={styles.note}>
                カメラの権限が許可されていません。「写真なしで完了」で先に進められます。
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.confirmBtn, pressed && styles.confirmBtnPressed]}
              onPress={handleConfirm}
            >
              <Text style={styles.confirmText}>
                {photoCount > 0 ? `確定して次へ（${photoCount}枚）` : '写真なしで完了'}
              </Text>
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
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.lg,
    ...elevation.e3,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: space.md,
  },
  closeBtn: {
    position: 'absolute',
    top: space.base,
    right: space.base,
    padding: 4,
  },
  title: {
    ...type.h2,
    color: colors.ink900,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    ...type.caption,
    color: colors.ink500,
    textAlign: 'center',
    marginBottom: space.base,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    marginTop: space.sm,
  },
  optionRowPressed: { opacity: 0.85 },
  optionRowSelected: {
    borderColor: colors.brand600,
    borderWidth: 1.5,
    backgroundColor: colors.brand050,
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
    ...type.bodyStrong,
    fontSize: 15,
    color: colors.ink900,
  },
  optionSub: {
    ...type.caption,
    color: colors.ink400,
    marginTop: 2,
  },
  photoGuide: {
    ...type.caption,
    color: colors.ink500,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 4,
  },
  photoRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
  },
  photoBox: {
    flex: 1,
    height: 100,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: 'dashed',
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  photoBoxPressed: { opacity: 0.75 },
  photoBoxCaptured: {
    backgroundColor: colors.done100,
    borderColor: colors.done,
    borderStyle: 'solid',
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  retakeBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    backgroundColor: 'rgba(10,14,20,0.6)',
    borderRadius: radius.pill,
    padding: 4,
  },
  photoText: {
    ...type.bodyStrong,
    fontSize: 13,
    color: colors.ink300,
  },
  note: {
    ...type.caption,
    color: colors.ink400,
    textAlign: 'center',
    marginTop: space.sm,
  },
  confirmBtn: {
    marginTop: space.lg,
    minHeight: 56,
    backgroundColor: colors.brand600,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnPressed: { opacity: 0.9 },
  confirmText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '800',
  },
});
