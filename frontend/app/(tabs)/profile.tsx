import { ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { BrandBar, BrandLogo } from "@/src/components/BrandLogo";
import { LockSettingsCard } from "@/src/components/LockSettingsCard";

export default function Profile() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <BrandBar />
      <View style={styles.header}>
        <Text style={styles.title}>Perfil</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        <View style={styles.logoWrap}>
          <BrandLogo height={36} />
        </View>
        <Text style={styles.tagline}>Gestión profesional de casos de tanatopraxia</Text>

        <View style={styles.infoCard}>
          <Ionicons name="cloud-done-outline" size={20} color={colors.success} />
          <Text style={styles.infoText}>
            Tus casos, cálculos y notas se guardan de forma segura en la nube.
          </Text>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.info} />
          <Text style={styles.infoText}>
            La app funciona sin necesidad de crear una cuenta.
          </Text>
        </View>

        <LockSettingsCard />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.version}>Preservia · v1.0.0</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxxl },
  body: { alignItems: "center", paddingTop: spacing.xxl, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  logoWrap: { marginBottom: spacing.md },
  tagline: {
    color: colors.onSurfaceSecondary,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    textAlign: "center",
    marginBottom: spacing.xxl,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    alignSelf: "stretch",
  },
  infoText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.base, lineHeight: 20 },
  footer: { paddingHorizontal: spacing.lg, alignItems: "center" },
  version: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm },
});
