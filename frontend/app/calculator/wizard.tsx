import { useMemo, useState } from "react";
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
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const STEPS = ["Masa magra", "Dilución", "Volumen"];

export default function Wizard() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { caseId } = useLocalSearchParams<{ caseId: string }>();

  const [step, setStep] = useState(0);
  // step 1 - lean body mass
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [sex, setSex] = useState<"male" | "female">("male");
  const [lbm, setLbm] = useState<number | null>(null);
  const [busy1, setBusy1] = useState(false);
  // step 2 - dilution
  const [c2, setC2] = useState(""); // desired index
  const [c1, setC1] = useState(""); // fluid index (stock)
  const [v1, setV1] = useState("473"); // concentrate volume mL (16 fl oz bottle)
  // step 3 - volume
  const [caseType, setCaseType] = useState<"normal" | "jaundice" | "edema">("normal");
  const [result, setResult] = useState<{ summary: string; results: Record<string, any> } | null>(null);
  const [busy3, setBusy3] = useState(false);
  const [saving, setSaving] = useState(false);

  const num = (s: string) => parseFloat((s || "").replace(",", "."));

  const ratio = useMemo(() => {
    const a = num(c2);
    const b = num(c1);
    if (isNaN(a) || isNaN(b) || b <= 0 || a <= 0 || a > b) return null;
    const concentratePct = (a / b) * 100;
    return { concentratePct, waterPct: 100 - concentratePct };
  }, [c1, c2]);

  const computeLbm = async () => {
    const w = num(weight);
    const h = num(height);
    if (isNaN(w) || isNaN(h)) {
      toast.show("Ingresa peso y estatura válidos", "error");
      return;
    }
    setBusy1(true);
    try {
      const resp = await api.post("/calculate", {
        type: "lbm",
        inputs: { weight_kg: w, height_cm: h, sex },
      });
      setLbm(resp.results.lbm_kg);
    } catch (e: any) {
      toast.show(e?.detail || "Error al calcular", "error");
    } finally {
      setBusy1(false);
    }
  };

  const computeVolume = async () => {
    setBusy3(true);
    try {
      const resp = await api.post("/calculate", {
        type: "injection",
        inputs: {
          weight_kg: num(weight),
          height_cm: num(height),
          sex,
          case_type: caseType,
          desired_index_pct: num(c2),
          fluid_index_pct: num(c1),
          concentrate_ml: num(v1),
        },
      });
      setResult(resp);
    } catch (e: any) {
      toast.show(e?.detail || "Error al calcular el volumen", "error");
    } finally {
      setBusy3(false);
    }
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const base = { weight_kg: num(weight), height_cm: num(height), sex };
      await api.post(`/cases/${caseId}/calculations`, { type: "lbm", inputs: base });
      await api.post(`/cases/${caseId}/calculations`, {
        type: "injection",
        inputs: {
          ...base,
          case_type: caseType,
          desired_index_pct: num(c2),
          fluid_index_pct: num(c1),
          concentrate_ml: num(v1),
        },
      });
      toast.show("Cálculos guardados en el caso", "success");
      router.back();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const goNext = () => {
    Haptics.selectionAsync().catch(() => {});
    setStep((s) => Math.min(s + 1, 2));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Cálculo de inyección</Text>
        <Pressable testID="wizard-close" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* stepper */}
      <View style={styles.stepper}>
        {STEPS.map((label, i) => (
          <View key={label} style={styles.stepWrap}>
            <View style={[styles.stepDot, i <= step && styles.stepDotActive]}>
              {i < step ? (
                <Ionicons name="checkmark" size={14} color={colors.onSurfaceInverse} />
              ) : (
                <Text style={[styles.stepDotText, i <= step && { color: colors.onSurfaceInverse }]}>
                  {i + 1}
                </Text>
              )}
            </View>
            <Text style={[styles.stepLabel, i === step && { color: colors.onSurface }]}>{label}</Text>
            {i < STEPS.length - 1 && <View style={styles.stepLine} />}
          </View>
        ))}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <>
              <Text style={styles.stepTitle}>Paso 1 · Masa magra corporal</Text>
              <Text style={styles.stepSub}>Fórmula de Boer. Se usará como base del volumen de solución.</Text>
              <View style={styles.segment}>
                {(["male", "female"] as const).map((s) => (
                  <Pressable
                    key={s}
                    testID={`wiz-sex-${s}`}
                    onPress={() => {
                      setSex(s);
                      setLbm(null);
                    }}
                    style={[styles.segmentBtn, sex === s && styles.segmentActive]}
                  >
                    <Text style={[styles.segmentText, sex === s && styles.segmentTextActive]}>
                      {s === "male" ? "Masculino" : "Femenino"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Field
                testID="wiz-weight"
                label="Peso corporal (kg)"
                value={weight}
                onChangeText={(t) => {
                  setWeight(t);
                  setLbm(null);
                }}
                keyboardType="decimal-pad"
                placeholder="Ej. 70"
              />
              <Field
                testID="wiz-height"
                label="Estatura (cm)"
                value={height}
                onChangeText={(t) => {
                  setHeight(t);
                  setLbm(null);
                }}
                keyboardType="decimal-pad"
                placeholder="Ej. 172"
              />
              <Button
                testID="wiz-compute-lbm"
                label="Calcular masa magra"
                variant="secondary"
                icon="body-outline"
                onPress={computeLbm}
                loading={busy1}
              />
              {lbm !== null && (
                <View testID="wiz-lbm-result" style={styles.resultCard}>
                  <Text style={styles.resultLabel}>Masa magra</Text>
                  <Text style={styles.resultValue}>{lbm} kg</Text>
                </View>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <Text style={styles.stepTitle}>Paso 2 · Concentración / Dilución</Text>
              <Text style={styles.stepSub}>C1·V1 = C2·V2 — define el índice deseado y el del fluido.</Text>
              <Field
                testID="wiz-c2"
                label="Índice deseado C2 (%)"
                value={c2}
                onChangeText={setC2}
                keyboardType="decimal-pad"
                placeholder="Ej. 2"
              />
              <Field
                testID="wiz-c1"
                label="Índice del fluido concentrado C1 (%)"
                value={c1}
                onChangeText={setC1}
                keyboardType="decimal-pad"
                placeholder="Ej. 25"
              />
              <Field
                testID="wiz-v1"
                label="Volumen de concentrado V1 (mL)"
                value={v1}
                onChangeText={(t) => {
                  setV1(t);
                  setResult(null);
                }}
                keyboardType="decimal-pad"
                placeholder="473 (botella 16 oz)"
              />
              <Text style={styles.hintLine}>
                V1 fijo en 473 mL (botella comercial de 16 oz fl). Puedes editarlo (p. ej. 946 mL = 2 botellas).
              </Text>
              {ratio && (
                <View testID="wiz-ratio-result" style={styles.resultCard}>
                  <Text style={styles.resultLabel}>Relación de dilución</Text>
                  <Text style={styles.resultValue}>
                    {ratio.concentratePct.toFixed(1)}% concentrado · {ratio.waterPct.toFixed(1)}% agua
                  </Text>
                  <Text style={styles.resultHint}>
                    Por cada 1000 mL: {(ratio.concentratePct * 10).toFixed(0)} mL concentrado +{" "}
                    {(ratio.waterPct * 10).toFixed(0)} mL agua
                  </Text>
                </View>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.stepTitle}>Paso 3 · Volumen de solución</Text>
              <Text style={styles.stepSub}>Resultado final: con V1 (concentrado) y C1·V1=C2·V2 se obtiene el volumen total V2.</Text>
              <Text style={styles.selectorLabel}>Tipo de caso</Text>
              <View style={styles.segment}>
                {([
                  { key: "normal", label: "Normal" },
                  { key: "jaundice", label: "Ictericia" },
                  { key: "edema", label: "Edema" },
                ] as const).map((c) => (
                  <Pressable
                    key={c.key}
                    testID={`wiz-casetype-${c.key}`}
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
              <Button
                testID="wiz-compute-volume"
                label="Calcular volumen"
                variant="secondary"
                icon="flask-outline"
                onPress={computeVolume}
                loading={busy3}
              />
              {result && (
                <View testID="wiz-volume-result" style={styles.resultCard}>
                  <Text style={styles.resultLabel}>Volumen de solución (V2)</Text>
                  <Text style={styles.resultValue}>{result.results.total_l} L</Text>
                  <View style={styles.resultGrid}>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>V1 concentrado</Text>
                      <Text style={styles.resultNum}>{result.results.concentrate_ml} mL</Text>
                    </View>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>agua</Text>
                      <Text style={styles.resultNum}>{result.results.water_ml} mL</Text>
                    </View>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>botellas</Text>
                      <Text style={styles.resultNum}>{result.results.bottles}</Text>
                    </View>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>masa magra</Text>
                      <Text style={styles.resultNum}>{result.results.lbm_kg} kg</Text>
                    </View>
                  </View>
                  <Text style={styles.resultHint}>
                    {result.results.case_type} ({result.results.adjustment}) · Recomendado por masa magra:
                    {" "}~{result.results.recommended_l} L (~{result.results.recommended_bottles} botellas de 473 mL).
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.footerRow}>
          {step > 0 && (
            <Button testID="wiz-back" label="Atrás" variant="outline" onPress={goBack} style={{ flex: 1 }} />
          )}
          {step === 0 && (
            <Button
              testID="wiz-next-0"
              label="Siguiente"
              onPress={goNext}
              disabled={lbm === null}
              style={{ flex: 2 }}
            />
          )}
          {step === 1 && (
            <Button
              testID="wiz-next-1"
              label="Siguiente"
              onPress={goNext}
              disabled={!ratio}
              style={{ flex: 2 }}
            />
          )}
          {step === 2 && (
            <Button
              testID="wiz-save"
              label="Guardar en el caso"
              icon="save-outline"
              onPress={saveAll}
              loading={saving}
              disabled={!result}
              style={{ flex: 2 }}
            />
          )}
        </View>
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
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xl },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  stepWrap: { flexDirection: "row", alignItems: "center" },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotActive: { backgroundColor: colors.surfaceInverse },
  stepDotText: { color: colors.onSurfaceTertiary, fontFamily: font.monoSemibold, fontSize: fontSize.sm },
  stepLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: fontSize.sm, marginLeft: spacing.xs },
  stepLine: { width: 16, height: 1, backgroundColor: colors.border, marginHorizontal: spacing.sm },
  scroll: { padding: spacing.lg, paddingTop: 0 },
  stepTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg, marginBottom: spacing.xs },
  stepSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base, marginBottom: spacing.lg, lineHeight: 20 },
  hintLine: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: -spacing.sm, marginBottom: spacing.md, lineHeight: 18 },
  selectorLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base, marginBottom: spacing.xs },
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
  segmentText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base },
  segmentTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  resultCard: {
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  resultLabel: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.medium,
    fontSize: fontSize.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  resultValue: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.xl, marginTop: spacing.sm },
  resultHint: { color: colors.onSurfaceSecondary, fontFamily: font.mono, fontSize: fontSize.sm, marginTop: spacing.sm },
  resultGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.lg },
  resultItem: { backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minWidth: 92 },
  resultKey: { color: colors.onSurfaceTertiary, fontFamily: font.mono, fontSize: fontSize.sm },
  resultNum: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.lg, marginTop: 2 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  footerRow: { flexDirection: "row", gap: spacing.md },
});
