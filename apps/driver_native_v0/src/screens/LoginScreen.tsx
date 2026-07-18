import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';
import { supabase } from '../lib/supabase';

interface Props {
  showToast: (message: string) => void;
}

export default function LoginScreen({ showToast }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!supabase) return;
    if (!email.trim() || !password) {
      setErrorMessage('メールアドレスとパスワードを入力してください');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);
    if (error) {
      setErrorMessage('ログインできませんでした。メールアドレス・パスワードをご確認ください');
      return;
    }
    // 成功時は App 側の onAuthStateChange 購読で自動的に次の画面へ遷移する
    showToast('ログインしました');
  };

  return (
    <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="truck-outline" size={38} color={colors.brand} />
        </View>

        <Text style={styles.title}>ドライバーログイン</Text>
        <Text style={styles.subtitle}>登録済みのメールアドレスでログインしてください</Text>

        <View style={styles.field}>
          <Text style={styles.label}>メールアドレス</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={colors.faint}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>パスワード</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.faint}
          />
        </View>

        {errorMessage ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.absent} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <Pressable style={styles.loginBtn} onPress={handleLogin} disabled={submitting}>
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.loginBtnText}>ログイン</Text>
          )}
        </Pressable>

        {/* TODO(stretch): Google OAuth（signInWithOAuth + expo-web-browser + deep link scheme）。
            redirect設定（Supabase側のRedirect URL・app.config.jsのscheme）が【人】依存のため
            本v0では未実装。導入時はこの下に「Googleでログイン」ボタンを追加する。 */}
      </ScrollView>
    </KeyboardAvoidingView>
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
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  subtitle: {
    fontSize: 13,
    color: colors.soft,
    marginTop: 8,
    marginBottom: 26,
    textAlign: 'center',
  },
  field: { width: '100%', marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '700', color: colors.soft, marginBottom: 6 },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  errorBox: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    backgroundColor: '#FBEAEA',
    borderWidth: 1,
    borderColor: '#F0C6C6',
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 4,
    marginBottom: 8,
    width: '100%',
  },
  errorText: { flex: 1, fontSize: 12.5, color: colors.absent, fontWeight: '700', lineHeight: 18 },
  loginBtn: {
    width: '100%',
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 10,
    ...shadow.floating,
  },
  loginBtnText: { color: colors.white, fontSize: 16, fontWeight: '800' },
});
