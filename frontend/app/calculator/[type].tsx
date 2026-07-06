import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type FieldDef = { key: string; label: string; placeholder: string };

const CONFIG: Record<
  string,
  { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; fields: FieldDef[]; hasSex?: boolean; hasCaseType?: boolean; hasBasis?: boolean }
> = {
  volume: {
    title: "Volumen de solución",
    subtitle: "Solución arterial estimada según el peso o la masa magra y el tipo de caso",
    icon: "flask-outline",
    hasCaseType: true,
    hasBasis: true,
    fields: [{ key: "weight_kg", label: "Peso corporal (kg)", placeholder: "Ej. 70" }],
  },
  lbm: {
    title: "Masa magra corporal",
    subtitle: "Fórmula de Boer (peso, estatura y sexo)",
    icon: "body-outline",
    hasSex: true,
    fields: [
      { key: "weight_kg", label: "Peso corporal (kg)", placeholder: "Ej. 70" },
      { key: "height_cm", label: "Estatura (cm)", placeholder: "Ej. 172" },
    ],
  },
  concentration: {
    title: "Concentración / Dilución",
    subtitle: "Fluido concentrado y agua para el índice deseado",
    icon: "beaker-outline",
    fields: [
      { key: "total_solution_l", label: "Solución total (L)", placeholder: "Ej. 4" },
      { key: "desired_index_pct", label: "Índice deseado (%)", placeholder: "Ej. 2" },
      { key: "fluid_index_pct", label: "Índice del fluido (%)", placeholder: "Ej. 25" },
    ],
  },
};

export default function Calculator() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { type, caseId } = useLocalSearchParams<{ type: string; caseId: string }>();
  const cfg = CONFIG[type || "volume"];

  const [values, setValues] = useState<Record<string, string>>({});
  const [sex, setSex] = useState<"male" | "female">("male");
  const [caseType, setCaseType] = useState<"normal" | "jaundice" | "edema">("normal");
  const [basis, setBasis] = useState<"total" | "lean">("total");
  const [result, setResult] = useState<{ summary: string; results: Record<string, any> } | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!cfg) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Calculadora no encontrada</Text>
      </View>
    );
  }

  const buildInputs = () => {
    const inputs: Record<string, any> = {};
    for (const f of cfg.fields) {
      const v = parseFloat((values[f.key] || "").replace(",", "."));
      if (isNaN(v)) return null;
      inputs[f.key] = v;
    }
    if (cfg.hasSex) inputs.sex = sex;
    if (cfg.hasCaseType) inputs.case_type = caseType;
    if (cfg.hasBasis) {
      inputs.basis = basis;
      if (basis === "lean") {
        const h = parseFloat((values["height_cm"] || "").replace(",", "."));
        if (isNaN(h)) return null;
        inputs.height_cm = h;
        inputs.sex = sex;
      }
    }
    return inputs;
  };

  const calculate = async () => {
    const inputs = buildInputs();
    if (!inputs) {
      toast.show("Completa todos los campos con números válidos", "error");
      return;
    }
    setCalculating(true);
    try {
      const resp = await api.post("/calculate", { type, inputs });
      setResult(resp);
    } catch (e: any) {
      toast.show(e?.detail || "Error al calcular", "error");
    } finally {
      setCalculating(false);
    }
  };

  const save = async () => {
    const inputs = buildInputs();
    if (!inputs) return;
    setSaving(true);
    try {
      await api.post(`/cases/${caseId}/calculations`, { type, inputs });
      toast.show("Cálculo guardado en el caso", "success");
      router.back();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Ionicons name={cfg.icon} size={22} color={colors.onSurface} />
          <Text style={styles.title}>{cfg.title}</Text>
        </View>
        <Pressable testID="calc-close" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
      </View>
      <Text style={styles.subtitle}>{cfg.subtitle}</Text>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {result && (
            <View testID="calc-result" style={styles.resultCard}>
              <Text style={styles.resultLabel}>Resultado</Text>
              <Text style={styles.resultValue}>{result.summary}</Text>
              <View style={styles.resultGrid}>
                {Object.entries(result.results).map(([k, v]) => (
                  <View key={k} style={styles.resultItem}>
                    <Text style={styles.resultKey}>{k}</Text>
                    <Text style={styles.resultNum}>{String(v)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {cfg.hasSex && (
            <View style={styles.segment}>
              {(["male", "female"] as const).map((s) => (
                <Pressable
                  key={s}
                  testID={`sex-${s}`}
                  onPress={() => setSex(s)}
                  style={[styles.segmentBtn, sex === s && styles.segmentActive]}
                >
                  <Text style={[styles.segmentText, sex === s && styles.segmentTextActive]}>
                    {s === "male" ? "Masculino" : "Femenino"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {cfg.hasCaseType && (
            <View>
              <Text style={styles.selectorLabel}>Tipo de caso</Text>
              <View style={styles.segment}>
                {([
                  { key: "normal", label: "Normal" },
                  { key: "jaundice", label: "Ictericia" },
                  { key: "edema", label: "Edema" },
                ] as const).map((c) => (
                  <Pressable
                    key={c.key}
                    testID={`casetype-${c.key}`}
                    onPress={() => {
                      setCaseType(c.key);
                      setResult(null);
                    }}
                    style={[styles.segmentBtn, caseType === c.key && styles.segmentActive]}
                  >
                    <Text style={[styles.segmentText, caseType === c.key && styles.segmentTextActive]}>
                      {c.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {cfg.fields.map((f) => (
            <Field
              key={f.key}
              testID={`calc-input-${f.key}`}
              label={f.label}
              value={values[f.key] || ""}
              onChangeText={(t) => {
                setValues((v) => ({ ...v, [f.key]: t }));
                setResult(null);
              }}
              keyboardType="decimal-pad"
              placeholder={f.placeholder}
            />
          ))}

          {cfg.hasBasis && (
            <View>
              <Text style={styles.selectorLabel}>Base de cálculo</Text>
              <View style={styles.segment}>
                {([
                  { key: "total", label: "Peso total" },
                  { key: "lean", label: "Masa magra" },
                ] as const).map((b) => (
                  <Pressable
                    key={b.key}
                    testID={`basis-${b.key}`}
                    onPress={() => {
                      setBasis(b.key);
                      setResult(null);
                    }}
                    style={[styles.segmentBtn, basis === b.key && styles.segmentActive]}
                  >
                    <Text style={[styles.segmentText, basis === b.key && styles.segmentTextActive]}>
                      {b.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {cfg.hasBasis && basis === "lean" && (
            <>
              <Field
                testID="calc-input-height_cm"
                label="Estatura (cm)"
                value={values["height_cm"] || ""}
                onChangeText={(t) => {
                  setValues((v) => ({ ...v, height_cm: t }));
                  setResult(null);
                }}
                keyboardType="decimal-pad"
                placeholder="Ej. 172"
              />
              <Text style={styles.selectorLabel}>Sexo</Text>
              <View style={styles.segment}>
                {(["male", "female"] as const).map((s) => (
                  <Pressable
                    key={s}
                    testID={`sex-${s}`}
                    onPress={() => {
                      setSex(s);
                      setResult(null);
                    }}
                    style={[styles.segmentBtn, sex === s && styles.segmentActive]}
                  >
                    <Text style={[styles.segmentText, sex === s && styles.segmentTextActive]}>
                      {s === "male" ? "Masculino" : "Femenino"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Button
            testID="calc-compute-button"
            label="Calcular"
            variant="secondary"
            icon="calculator-outline"
            onPress={calculate}
            loading={calculating}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          testID="calc-save-button"
          label="Guardar en el caso"
          icon="save-outline"
          onPress={save}
          loading={saving}
          disabled={!result}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xl, flexShrink: 1 },
  subtitle: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  scroll: { padding: spacing.lg, paddingTop: 0 },
  resultCard: {
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  resultLabel: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.medium,
    fontSize: fontSize.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  resultValue: {
    color: colors.onSurface,
    fontFamily: font.monoSemibold,
    fontSize: fontSize.xl,
    marginTop: spacing.sm,
  },
  resultGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.lg },
  resultItem: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minWidth: 90,
  },
  resultKey: { color: colors.onSurfaceTertiary, fontFamily: font.mono, fontSize: fontSize.sm },
  resultNum: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.lg, marginTop: 2 },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectorLabel: {
    color: colors.onSurfaceSecondary,
    fontFamily: font.medium,
    fontSize: fontSize.base,
    marginBottom: spacing.xs,
  },
  segmentBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surfaceInverse },
  segmentText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base },
  segmentTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
});
