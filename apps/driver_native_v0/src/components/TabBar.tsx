import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, type } from '../theme';
import { TabKey } from '../types';

interface TabDef {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const TABS: TabDef[] = [
  { key: 'delivery', label: '配達', icon: 'cube-outline' },
  { key: 'map', label: '地図', icon: 'map-outline' },
  { key: 'today', label: '本日', icon: 'calendar-outline' },
];

interface Props {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

export default function TabBar({ active, onChange }: Props) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const isOn = active === tab.key;
        const tintColor = isOn ? colors.brand600 : colors.ink400;
        return (
          <Pressable
            key={tab.key}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            onPress={() => onChange(tab.key)}
            hitSlop={6}
          >
            <View style={[styles.iconWrap, isOn && styles.iconWrapOn]}>
              <Ionicons name={tab.icon} size={21} color={tintColor} />
            </View>
            <Text style={[styles.label, { color: tintColor }, isOn && styles.labelOn]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabPressed: { opacity: 0.6 },
  iconWrap: {
    width: 40,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapOn: {
    backgroundColor: colors.brand050,
  },
  label: {
    ...type.caption,
    fontSize: 10.5,
  },
  labelOn: {
    fontWeight: '800',
  },
});
