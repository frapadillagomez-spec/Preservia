import { Pressable, StyleSheet, Text, View } from "react-native";

import { Field } from "@/src/components/ui";
import { FactorF, F_MAX, F_MIN } from "@/src/data/factorF";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export type CaseType = "normal" | "jaundice" | "edema" | "sheet";

type Props = {
  testPrefix: string;
  caseType: CaseType;
  onCaseType: (k: CaseType) => void;
  factorF: string;
  onFactorF: (t: string) => void;
  sheetFactor: FactorF | null;
};

/** Selector de tipo de caso con la opción "Factor F" sugerida por la hoja del caso. */
export function FactorFPicker({ testPrefix, caseType, onCaseType, factorF, onFactorF, sheetFactor }: Props) {
  const opts: { key: CaseType; label: string }[] = [
    ...(sheetFactor ? [{ key: "sheet" as CaseType, label: "Factor F" }] : []),
    { key: "normal", label: "Normal" },
    { key: "jaundice", label: "Ictericia" },
    { key: "edema", label: "Edema" },
  ];
  return (
    <View>
      <Text style={styles.label}>Tipo de caso</Text>
      <View style={styles.segment}>
        {opts.map((c) => (
          <Pressable
            key={c.key}
            testID={`${testPrefix}-${c.key}`}
            onPress={() => onCaseType(c.key)}
            style={[styles.segmentBtn, caseType === c.key && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, caseType === c.key && styles.segmentTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      {caseType === "sheet" && sheetFactor && (
        <View testID={`${testPrefix}-factor-card`} style={styles.card}>
          <Text style={styles.cardText}>
            Sugerido por la hoja del caso: F = {sheetFactor.f.toFixed(3)} ({sheetFactor.dominant.label}
            {sheetFactor.secondary ? ` · ${sheetFactor.adjustmentPct > 0 ? "+" : ""}${sheetFactor.adjustmentPct}% ${sheetFactor.secondary.label}` : ""})
          </Text>
          <Field
            testID={`${testPrefix}-factor-input`}
            label={`Factor F aplicado (${F_MIN}–${F_MAX})`}
            value={factorF}
            onChangeText={onFactorF}
            keyboardType="decimal-pad"
            placeholder={sheetFactor.f.toFixed(3)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base, marginBottom: spacing.xs },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surfaceInverse },
  segmentText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  segmentTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  card: {
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  cardText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm, lineHeight: 18, marginBottom: spacing.sm },
});
