import React, { useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

const HANDLE_SIZE = 46;
const TRACK_PADDING = 4;
const THRESHOLD_RATIO = 0.72;

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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderMove: (_evt, gesture) => {
        const max = maxTranslateRef.current;
        const next = Math.min(Math.max(gesture.dx, 0), max);
        translateX.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const max = maxTranslateRef.current;
        const next = Math.min(Math.max(gesture.dx, 0), max);
        const passed = next >= max * THRESHOLD_RATIO;
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
    <View
      style={[styles.track, disabled && styles.trackDisabled]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View style={[styles.fill, { width: fillWidth }]} />
      <Animated.Text style={[styles.label, { opacity: labelOpacity }]}>
        {`→ ${label}`}
      </Animated.Text>
      <Animated.View
        style={[styles.handle, { transform: [{ translateX }] }]}
        {...(disabled ? {} : panResponder.panHandlers)}
      >
        <Ionicons name="checkmark" size={22} color={colors.white} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: HANDLE_SIZE + TRACK_PADDING * 2,
    borderRadius: radius.pill,
    backgroundColor: colors.doneSoft,
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
    fontSize: 14,
    fontWeight: '800',
    color: colors.done,
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
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
