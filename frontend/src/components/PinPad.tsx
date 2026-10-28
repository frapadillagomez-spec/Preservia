import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";

import { PIN_LENGTH } from "@/src/lock/lockSettings";
import { colors, font, fontSize, spacing } from "@/src/theme";

type Props = {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
  /** Botón extra a la izquierda del 0 (p. ej. Face ID). */
  extra?: { icon: "scan-outline" | "finger-print-outline"; label: string; onPress: () => void } | null;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Teclado numérico con indicadores del PIN. */
export function PinPad({ value, onChange, error, disabled, extra }: Props) {
  const press = (d: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;
    Haptics.selectionAsync().catch(() => {});
    onChange(value + d);
  };
  const back = () => !disabled && onChange(value.slice(0, -1));

  return (
    <View style={styles.root}>
      <View testID="pin-dots" style={styles.dots}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotOn, !!error && styles.dotErr]} />
        ))}
      </View>
      <Text testID="pin-error" style={styles.error}>{error || " "}</Text>
      <View style={[styles.grid, disabled && { opacity: 0.4 }]}>
        {KEYS.map((k) => (
          <Key key={k} testID={`pin-key-${k}`} onPress={() => press(k)}>
            <Text style={styles.keyText}>{k}</Text>
          </Key>
        ))}
        {extra ? (
          <Key testID="pin-bio" onPress={extra.onPress} label={extra.label}>
            <Ionicons name={extra.icon} size={28} color={colors.onSurface} />
          </Key>
        ) : (
          <View style={styles.key} />
        )}
        <Key testID="pin-key-0" onPress={() => press("0")}>
          <Text style={styles.keyText}>0</Text>
        </Key>
        <Key testID="pin-back" onPress={back} label="Borrar">
          <Ionicons name="backspace-outline" size={26} color={colors.onSurface} />
        </Key>
      </View>
    </View>
  );
}

function Key({ children, onPress, testID, label }: { children: React.ReactNode; onPress: () => void; testID: string; label?: string }) {
  return (
    <Pressable testID={testID} accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.key, styles.keyBtn, pressed && styles.keyPressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center" },
  dots: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.sm },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.onSurfaceTertiary },
  dotOn: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  dotErr: { borderColor: colors.error },
  error: { color: colors.error, fontFamily: font.medium, fontSize: fontSize.sm, minHeight: 20, marginBottom: spacing.md, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", width: 288, justifyContent: "space-between", rowGap: spacing.md },
  key: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  keyBtn: { borderRadius: 40, backgroundColor: colors.surfaceSecondary },
  keyPressed: { backgroundColor: colors.surfaceTertiary },
  keyText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: 28 },
});
