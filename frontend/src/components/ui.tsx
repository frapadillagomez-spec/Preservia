import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";

// ---------- Button ----------
type BtnProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  testID,
  style,
}: BtnProps) {
  const isDisabled = disabled || loading;
  const bg =
    variant === "primary"
      ? colors.surfaceInverse
      : variant === "danger"
        ? colors.errorBg
        : variant === "secondary"
          ? colors.surfaceTertiary
          : "transparent";
  const fg =
    variant === "primary"
      ? colors.onSurfaceInverse
      : variant === "danger"
        ? colors.error
        : variant === "outline"
          ? colors.onSurface
          : colors.onSurfaceSecondary;
  const border = variant === "outline" ? colors.borderStrong : "transparent";

  return (
    <Pressable
      testID={testID}
      disabled={isDisabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, borderWidth: variant === "outline" ? 1 : 0 },
        pressed && { opacity: 0.8 },
        isDisabled && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.btnInner}>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------- Text field ----------
type FieldProps = TextInputProps & {
  label?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
};

export function Field({ label, icon, testID, style, ...rest }: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputRow}>
        {icon && <Ionicons name={icon} size={18} color={colors.onSurfaceTertiary} />}
        <TextInput
          testID={testID}
          placeholderTextColor={colors.onSurfaceTertiary}
          style={[styles.input, style]}
          {...rest}
        />
      </View>
    </View>
  );
}

// ---------- Card ----------
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  btnInner: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  btnText: { fontFamily: font.semibold, fontSize: fontSize.lg },
  fieldWrap: { gap: spacing.xs, marginBottom: spacing.lg },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },
  input: {
    flex: 1,
    color: colors.onSurface,
    fontFamily: font.regular,
    fontSize: fontSize.lg,
    paddingVertical: spacing.md,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
});
