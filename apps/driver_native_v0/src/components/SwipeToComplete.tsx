import React, { useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, radius, type } from '../theme';

const HANDLE_SIZE = 46;
const TRACK_PADDING = 4;
// 完了判定は一般的な slide-to-confirm の作法に合わせる（現場は手袋・片手・歩きながら）:
//   ・距離: トラックの45%まで引けば成立
//   ・フリック: 速い払い（vx>=0.45px/ms）なら15%で成立
//   ・ジェスチャ: 横意図（|dx|>|dy|）で即クレームし、一度掴んだら親スクロールに奪わせない
//     （斜めに動いた瞬間スクロールに横取りされ途中でバネ戻りする＝「シビア」の正体）
const THRESHOLD_RATIO = 0.45;
const FLICK_VELOCITY = 0.45;
const FLICK_MIN_RATIO = 0.15;
const CLAIM_DX = 4; // この横移動で掴む（px）

interface Props {
  label?: string;
  onComplete: () => void;
  disabled?: boolean;
}

// スワイプで完了バー（Amazon配達アプリ風）。しきい値を超えて離すと onComplete を呼び、
// ハンドルは即座に先端表示→開始位置へ戻る（確定の見た目はモーダル側で担う）。
export default function SwipeToComplete({ label = 'スワイプで完了', onComplete, disabled }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const maxTranslate = Math.max(trackWidth - HANDLE_SIZE - TRACK_PADDING * 2, 1);

  // PanResponderはuseRefで一度だけ生成されるため、レンダー変数を閉じ込めると
  // 初回レイアウト前の値（トラック幅0→maxTranslate=1px）で固定されてしまう。
  // 最新値はrefで渡し、ハンドルが指に正しく追従するようにする。
  const maxTranslateRef = useRef(1);
  maxTranslateRef.current = maxTranslate;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const disabledRef = useRef(!!disabled);
  disabledRef.current = !!disabled;

  const panResponder = useRef(
    PanResponder.create({
      // タッチ開始では掴まない（バー上から縦スクロールを始める操作を殺さないため）。
      // 横方向の意図（dx>=4px かつ |dx|>|dy|）が見えた瞬間に掴む。
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, g) =>
        !disabledRef.current && g.dx > CLAIM_DX && Math.abs(g.dx) > Math.abs(g.dy),
      // 一度掴んだら親（ScrollView等）の横取り要求を拒否する＝途中でバネ戻りしない。
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderMove: (_evt, gesture) => {
        const max = maxTranslateRef.current;
        const next = Math.min(Math.max(gesture.dx, 0), max);
        translateX.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const max = maxTranslateRef.current;
        const next = Math.min(Math.max(gesture.dx, 0), max);
        const passed =
          next >= max * THRESHOLD_RATIO ||
          (gesture.vx >= FLICK_VELOCITY && next >= max * FLICK_MIN_RATIO);
        if (passed) {
          Animated.timing(translateX, {
            toValue: max,
            duration: 120,
            useNativeDriver: false,
          }).start(() => {
            onCompleteRef.current();
            Animated.timing(translateX, {
              toValue: 0,
              duration: 160,
              useNativeDriver: false,
            }).start();
          });
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            friction: 6,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: false, friction: 6 }).start();
      },
    })
  ).current;

  const fillWidth = Animated.add(translateX, new Animated.Value(HANDLE_SIZE + TRACK_PADDING));
  const labelOpacity = translateX.interpolate({
    inputRange: [0, Math.max(maxTranslate * 0.6, 1)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    // 当たり判定はバーの見た目より上下14px/左右8px広い透明ラッパーで受ける。
    // 「緑のバーを正確になぞらないと反応しない」＝指がわずかに外れて始まると無反応、の対策。
    <View
      style={styles.touchArea}
      {...(disabled ? {} : panResponder.panHandlers)}
    >
      <View
        style={[styles.track, disabled && styles.trackDisabled]}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        <Animated.View style={[styles.fill, { width: fillWidth }]} />
        <Animated.Text style={[styles.label, { opacity: labelOpacity }]}>
          {`→ ${label}`}
        </Animated.Text>
        <Animated.View style={[styles.handle, { transform: [{ translateX }] }]}>
          <Ionicons name="checkmark" size={22} color={colors.white} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  touchArea: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginVertical: -14,
    marginHorizontal: -8,
  },
  track: {
    height: HANDLE_SIZE + TRACK_PADDING * 2,
    borderRadius: radius.pill,
    backgroundColor: colors.done100,
    borderWidth: 1,
    borderColor: colors.done500,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  trackDisabled: {
    opacity: 0.5,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.done,
    borderRadius: radius.pill,
  },
  label: {
    position: 'absolute',
    alignSelf: 'center',
    ...type.bodyStrong,
    fontSize: 14,
    color: colors.done700,
  },
  handle: {
    position: 'absolute',
    left: TRACK_PADDING,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: colors.done,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.e2,
  },
});
