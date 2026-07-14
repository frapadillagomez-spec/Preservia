import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { BrandBar, BrandLogo } from "@/src/components/BrandLogo";

export default function Profile() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <BrandBar />
      <View style={styles.header}>
        <Text style={styles.title}>Perfil</Text>
      </View>

      <View style={styles.body}>
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
      </View>

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
  body: { flex: 1, alignItems: "center", paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
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
