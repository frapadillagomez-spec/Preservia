import { Pressable, StyleSheet, Text, View } from "react-native";

import { Field } from "@/src/components/ui";
import { GENERAL_CONDITIONS, K_MAX, K_MIN } from "@/src/data/factorF";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export const isKValid = (t: string) => {
  const k = parseFloat(t.replace(",", "."));
  return !isNaN(k) && k >= K_MIN - 1e-9 && k <= K_MAX + 1e-9;
};

type Props = {
  condKey: string;
  onCond: (key: string, avg: number) => void;
  kFactor: string;
  onK: (t: string) => void;
  fromSheet: boolean;
};

/** Condición general → Factor K (L/kg), con valor editable. */
export function KFactorPicker({ condKey, onCond, kFactor, onK, fromSheet }: Props) {
  return (
    <View>
      <Text style={styles.label}>Condición general (Factor K)</Text>
      {fromSheet && <Text style={styles.hint}>Tomada de la hoja del caso.</Text>}
      <View style={styles.chips}>
        {GENERAL_CONDITIONS.map((g) => {
          const active = condKey === g.key;
          return (
            <Pressable
              key={g.key}
              testID={`kcond-calc-${g.key}`}
              onPress={() => onCond(g.key, g.avg)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {g.label} · {g.avg.toFixed(3)} L/kg
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Field
        testID="k-factor-input"
        label={`Factor K aplicado (${K_MIN}–${K_MAX} L/kg)`}
        value={kFactor}
        onChangeText={onK}
        keyboardType="decimal-pad"
        placeholder="0.135"
      />
      {kFactor.trim() !== "" && !isKValid(kFactor) && (
        <Text testID="k-factor-warning" style={styles.warning}>
          El Factor K debe estar entre {K_MIN} y {K_MAX} L/kg.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base, marginBottom: spacing.xs },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginBottom: spacing.sm },
  chips: { gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  chipTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  warning: { color: colors.error, fontFamily: font.medium, fontSize: fontSize.sm, marginTop: -spacing.sm, marginBottom: spacing.md },
});
