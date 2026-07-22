import React, { useRef, useState } from 'react';
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
import { colors, elevation, radius, space, type } from '../theme';
import { supabase } from '../lib/supabase';

interface Props {
  showToast: (message: string) => void;
}

export default function LoginScreen({ showToast }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

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
          <MaterialCommunityIcons name="truck-outline" size={38} color={colors.brand600} />
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
            placeholderTextColor={colors.ink300}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>パスワード</Text>
          <TextInput
            ref={passwordRef}
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.ink300}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (!submitting) handleLogin();
            }}
          />
        </View>

        {errorMessage ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger600} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.loginBtn, pressed && styles.loginBtnPressed]}
          onPress={handleLogin}
          disabled={submitting}
        >
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
  body: { flex: 1, backgroundColor: colors.paper },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.huge,
  },
  iconCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.brand050,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  title: { ...type.h1, color: colors.ink900 },
  subtitle: {
    ...type.body,
    color: colors.ink500,
    marginTop: space.sm,
    marginBottom: space.xl,
    textAlign: 'center',
  },
  field: { width: '100%', marginBottom: space.md },
  label: { ...type.label, color: colors.ink500, marginBottom: space.xs },
  input: {
    width: '100%',
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 15,
    color: colors.ink900,
    backgroundColor: colors.surface,
  },
  errorBox: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.danger100,
    borderWidth: 1,
    borderColor: colors.danger600,
    borderRadius: radius.sm,
    padding: space.sm,
    marginTop: space.xs,
    marginBottom: space.sm,
    width: '100%',
  },
  errorText: { flex: 1, ...type.caption, color: colors.danger600, lineHeight: 18 },
  loginBtn: {
    width: '100%',
    minHeight: 56,
    backgroundColor: colors.brand600,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
    ...elevation.e3,
  },
  loginBtnPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  loginBtnText: { color: colors.white, fontSize: 16, fontWeight: '800' },
});
