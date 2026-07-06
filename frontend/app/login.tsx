import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, spacing } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1685973323988-666a38e0acc2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzV8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBjYWxjdWxhdG9yJTIwYXBwJTIwYWJzdHJhY3QlMjBiYWNrZ3JvdW5kJTIwZGFyayUyMGJsdWUlMjBncmF5fGVufDB8fHx8MTc4MzM3NzcwNHww&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const { login, loginWithGoogle, googleBusy } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast.show("Ingresa correo y contraseña", "error");
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      toast.show(e?.detail || "Error al iniciar sesión", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Image source={HERO} style={styles.hero} contentFit="cover" />
      <LinearGradient
        colors={["transparent", "rgba(15,23,42,0.6)", colors.surface]}
        style={styles.scrim}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandBlock}>
            <Text style={styles.brand}>PRESERVIA</Text>
            <Text style={styles.tagline}>Gestión profesional de casos de tanatopraxia</Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Iniciar sesión</Text>
            <Field
              testID="login-email-input"
              label="Correo"
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="tu@correo.com"
            />
            <Field
              testID="login-password-input"
              label="Contraseña"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
            />
            <Button testID="login-submit-button" label="Entrar" onPress={submit} loading={busy} />

            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.orText}>o</Text>
              <View style={styles.line} />
            </View>

            <Button
              testID="login-google-button"
              label="Continuar con Google"
              icon="logo-google"
              variant="outline"
              loading={googleBusy}
              onPress={loginWithGoogle}
            />

            <View style={styles.footer}>
              <Text style={styles.footerText}>¿No tienes cuenta?</Text>
              <Text
                testID="go-register-link"
                style={styles.link}
                onPress={() => router.push("/register")}
              >
                Crear cuenta
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  hero: { position: "absolute", top: 0, left: 0, right: 0, height: 340 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, height: 360 },
  scroll: { flexGrow: 1, justifyContent: "flex-end", padding: spacing.xl, paddingTop: 200 },
  brandBlock: { marginBottom: spacing.xl },
  brand: {
    color: colors.onSurface,
    fontFamily: font.bold,
    fontSize: 32,
    letterSpacing: 4,
  },
  tagline: {
    color: colors.onSurfaceSecondary,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    marginTop: spacing.xs,
  },
  formCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  formTitle: {
    color: colors.onSurface,
    fontFamily: font.semibold,
    fontSize: fontSize.xl,
    marginBottom: spacing.lg,
  },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.lg },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { color: colors.onSurfaceTertiary, fontFamily: font.regular },
  footer: { flexDirection: "row", justifyContent: "center", gap: spacing.xs, marginTop: spacing.xl },
  footerText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base },
  link: { color: colors.info, fontFamily: font.semibold, fontSize: fontSize.base },
});
