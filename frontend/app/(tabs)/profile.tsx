import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/context/AuthContext";
import { Button } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Perfil</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.avatarWrap}>
          {user?.picture ? (
            <Image source={user.picture} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.name || user?.email || "?").slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <Text testID="profile-name" style={styles.name}>{user?.name || "Profesional"}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.badge}>
          <Ionicons
            name={user?.provider === "google" ? "logo-google" : "mail"}
            size={13}
            color={colors.onSurfaceTertiary}
          />
          <Text style={styles.badgeText}>
            {user?.provider === "google" ? "Cuenta Google" : "Correo y contraseña"}
          </Text>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="cloud-done-outline" size={20} color={colors.success} />
          <Text style={styles.infoText}>
            Tus casos, notas y fotos se respaldan de forma privada en la nube.
          </Text>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button
          testID="logout-button"
          label="Cerrar sesión"
          icon="log-out-outline"
          variant="outline"
          onPress={logout}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxxl },
  body: { flex: 1, alignItems: "center", paddingTop: spacing.xl, paddingHorizontal: spacing.xl },
  avatarWrap: { marginBottom: spacing.lg },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: fontSize.xxl },
  name: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.xl },
  email: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base, marginTop: 2 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginTop: spacing.md,
  },
  badgeText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: fontSize.sm },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.xxl,
  },
  infoText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.base, lineHeight: 20 },
  footer: { paddingHorizontal: spacing.lg },
});
