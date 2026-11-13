import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { useCaseSheetInfo } from "@/src/hooks/use-case-sheet-info";
import { CoInjector, CoInjectors, coinjectorsFromLogbook, toL } from "@/src/components/CoInjectors";
import { FluidTemplates } from "@/src/components/FluidTemplates";

const STEPS = ["Masa magra", "Vtotal", "Arterial y V1"];

const LBM_METHOD_OPTS = [
  { key: "average", label: "Promedio (3)" },
  { key: "janmahasatian", label: "Janmahasatian" },
  { key: "boer", label: "Boer" },
  { key: "james", label: "James" },
] as const;
type LbmMethod = (typeof LBM_METHOD_OPTS)[number]["key"];

export default function Wizard() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { caseId } = useLocalSearchParams<{ caseId: string }>();

  const [step, setStep] = useState(0);
  // step 1 - lean body mass
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [sex, setSex] = useState<"male" | "female">("male");
  const [method, setMethod] = useState<LbmMethod>("average");
  const [lbm, setLbm] = useState<number | null>(null);
  const [busy1, setBusy1] = useState(false);
  // step 2 - dilution
  const [c2, setC2] = useState(""); // desired index
  const [c1, setC1] = useState(""); // fluid index (stock)
  const [fluidName, setFluidName] = useState("");
  const [bottleMl, setBottleMl] = useState("473");
  // step 3 - volume: Vtotal = MM x K x F (K y F de la hoja del caso)
  const sheetInfo = useCaseSheetInfo(caseId);
  const [result, setResult] = useState<{ summary: string; results: Record<string, any> } | null>(null);
  const [busy3, setBusy3] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [coinj, setCoinj] = useState<CoInjector[]>([]);

  useEffect(() => {
    if (!sheetInfo || prefilled) return;
    setPrefilled(true);
    setWeight((w) => w || sheetInfo.weight);
    setHeight((h) => h || sheetInfo.height);
    if (sheetInfo.sex) setSex(sheetInfo.sex);
    setCoinj((c) => (c.length ? c : coinjectorsFromLogbook(sheetInfo.logbook)));
  }, [sheetInfo, prefilled]);

  const num = (s: string) => parseFloat((s || "").replace(",", "."));

  // Cualquier cambio en pasos anteriores invalida el resultado del paso 3.
  useEffect(() => {
    setResult(null);
  }, [weight, height, sex, method, c1, c2]);

  const kVal = sheetInfo?.general?.avg ?? null;
  const fVal = sheetInfo?.factor?.f ?? null;
  const sheetReady = kVal !== null && fVal !== null;
  const vtotal = sheetReady && lbm !== null ? Math.round(lbm * kVal! * fVal! * 100) / 100 : null;

  const injectionInputs = () => ({
    weight_kg: num(weight),
    height_cm: num(height),
    sex,
    lbm_method: method,
    mode: "kf",
    k_factor: kVal,
    factor_f: fVal,
    desired_index_pct: num(c2),
    fluid_index_pct: num(c1),
    ...(fluidName ? { fluid_name: fluidName } : {}),
    bottle_ml: num(bottleMl) > 0 && num(bottleMl) <= 20000 ? num(bottleMl) : 473,
    coinjectors: coinj,
  });

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
        inputs: { weight_kg: w, height_cm: h, sex, method },
      });
      setLbm(resp.results.lbm_kg);
    } catch (e: any) {
      toast.show(e?.detail || "Error al calcular", "error");
    } finally {
      setBusy1(false);
    }
  };

  const computeVolume = async () => {
    if (!sheetReady) {
      toast.show("Primero llena la condición general y las condiciones en la Hoja del caso", "error");
      return;
    }
    setBusy3(true);
    try {
      const resp = await api.post("/calculate", { type: "injection", inputs: injectionInputs() });
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
      await api.post(`/cases/${caseId}/calculations`, { type: "lbm", inputs: { ...base, method } });
      await api.post(`/cases/${caseId}/calculations`, { type: "injection", inputs: injectionInputs() });
      toast.show("Cálculos guardados en el caso", "success");
      if (router.canGoBack()) router.back();
      else router.replace(`/case/${caseId}`);
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

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && (
            <>
              <Text style={styles.stepTitle}>Paso 1 · Masa magra corporal</Text>
              <Text style={styles.stepSub}>
                Elige el método (Janmahasatian, Boer, James o promedio). Se usará como base del volumen.
              </Text>
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
              <Text style={styles.selectorLabel}>Método de cálculo</Text>
              <View style={styles.methodRow}>
                {LBM_METHOD_OPTS.map((m) => (
                  <Pressable
                    key={m.key}
                    testID={`wiz-method-${m.key}`}
                    onPress={() => {
                      setMethod(m.key);
                      setLbm(null);
                      setResult(null);
                    }}
                    style={[styles.methodChip, method === m.key && styles.methodChipActive]}
                  >
                    <Text style={[styles.methodText, method === m.key && styles.methodTextActive]}>
                      {m.label}
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
                  <Text style={styles.resultHint}>
                    Método: {LBM_METHOD_OPTS.find((m) => m.key === method)?.label}
                  </Text>
                </View>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <Text style={styles.stepTitle}>Paso 2 · Volumen total recomendado</Text>
              <Text style={styles.stepSub}>Vtotal = Masa magra × K × F, con K y F de la Hoja del caso.</Text>
              {sheetReady ? (
                <View testID="wiz-kf-card" style={[styles.resultCard, styles.kfCard]}>
                  <View style={[styles.resultGrid, { marginTop: 0 }]}>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>Masa magra</Text>
                      <Text style={styles.resultNum}>{lbm ?? "—"} kg</Text>
                    </View>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>Factor K</Text>
                      <Text testID="wiz-k-value" style={styles.resultNum}>{kVal!.toFixed(3)} L/kg</Text>
                    </View>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>Factor F</Text>
                      <Text testID="wiz-f-value" style={styles.resultNum}>{fVal!.toFixed(3)}</Text>
                    </View>
                  </View>
                  <Text style={styles.resultHint}>
                    K: {sheetInfo!.general!.label} · F: {sheetInfo!.factor!.dominant.label}
                    {sheetInfo!.factor!.secondary ? ` (${sheetInfo!.factor!.adjustmentPct > 0 ? "+" : ""}${sheetInfo!.factor!.adjustmentPct}% ${sheetInfo!.factor!.secondary.label})` : ""}
                  </Text>
                  {vtotal !== null && (
                    <>
                      <Text style={[styles.resultLabel, { marginTop: spacing.lg }]}>Vtotal recomendado</Text>
                      <Text testID="wiz-vtotal" style={styles.resultValue}>{vtotal.toFixed(2)} L</Text>
                    </>
                  )}
                </View>
              ) : (
                <View testID="wiz-sheet-missing" style={[styles.resultCard, styles.kfCard]}>
                  <Text style={styles.resultLabel}>Falta información en la Hoja del caso</Text>
                  <Text style={styles.resultHint}>
                    {!caseId
                      ? "Abre este asistente desde un caso para usar su Factor K y F."
                      : `Selecciona ${kVal === null ? "la condición general (Factor K)" : ""}${kVal === null && fVal === null ? " y " : ""}${fVal === null ? "al menos una condición del cuerpo (Factor F)" : ""} para calcular el volumen total.`}
                  </Text>
                  {!!caseId && (
                    <View style={{ marginTop: spacing.md }}>
                      <Button
                        testID="wiz-open-sheet"
                        label="Llenar Hoja del caso"
                        variant="outline"
                        icon="document-text-outline"
                        onPress={() => router.push(`/case/sheet?caseId=${caseId}`)}
                      />
                    </View>
                  )}
                </View>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.stepTitle}>Paso 3 · Arterial y V1</Text>
              <Text style={styles.stepSub}>
                V1 × C1 = Vtotal × C punto de inyección → V1 = Vtotal × C punto de inyección ÷ C1
              </Text>
              <FluidTemplates
                c1={c1}
                bottleMl={bottleMl}
                onPick={(idx, name, bottle) => {
                  setC1(idx);
                  setFluidName(name);
                  setBottleMl(bottle);
                  setResult(null);
                }}
              />
              <Field
                testID="wiz-c1"
                label={`Index del Arterial C1 (%)${fluidName ? ` · ${fluidName}` : ""}`}
                value={c1}
                onChangeText={(t) => {
                  setC1(t);
                  setFluidName("");
                  setResult(null);
                }}
                keyboardType="decimal-pad"
                placeholder="Ej. 25"
              />
              <Field
                testID="wiz-c2"
                label="Concentración en el punto de inyección (%)"
                value={c2}
                onChangeText={setC2}
                keyboardType="decimal-pad"
                placeholder="Ej. 2"
              />
              <Field
                testID="wiz-bottle"
                label="Tamaño de botella del arterial (mL)"
                value={bottleMl}
                onChangeText={(t) => {
                  setBottleMl(t);
                  setResult(null);
                }}
                keyboardType="decimal-pad"
                placeholder="473 (16 oz)"
              />
              {bottleMl !== "" && !(num(bottleMl) > 0 && num(bottleMl) <= 20000) && (
                <Text testID="wiz-bottle-error" style={[styles.hintLine, { color: colors.error }]}>
                  Tamaño de botella no válido: se usarán 473 mL (16 oz).
                </Text>
              )}
              <Text style={styles.hintLine}>Vtotal: {vtotal !== null ? `${vtotal.toFixed(2)} L` : "—"}</Text>
              {num(c1) > 0 && num(c2) > num(c1) && (
                <Text testID="wiz-c-error" style={[styles.hintLine, { color: colors.error }]}>
                  La concentración en el punto de inyección no puede superar el Index del Arterial (C1).
                </Text>
              )}
              <CoInjectors
                items={coinj}
                onChange={(items) => {
                  setCoinj(items);
                  setResult(null);
                }}
              />
              <Button
                testID="wiz-compute-volume"
                label="Calcular V1"
                variant="secondary"
                icon="flask-outline"
                onPress={computeVolume}
                loading={busy3}
                disabled={!sheetReady || !ratio}
              />
              {result && (
                <View testID="wiz-volume-result" style={styles.resultCard}>
                  <Text style={styles.resultLabel}>Arterial a agregar (V1)</Text>
                  <Text testID="wiz-v1" style={styles.resultValue}>{result.results.v1_l} L</Text>
                  <Text testID="wiz-instruction" style={styles.instruction}>{result.results.instruction}</Text>
                  <Text style={styles.resultHint}>
                    {result.results.total_l} L × {result.results.desired_index_pct}% ÷ {result.results.fluid_index_pct}% = {result.results.v1_l} L
                  </Text>
                  <View style={styles.resultGrid}>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>Botellas de arterial</Text>
                      <Text testID="wiz-bottles" style={styles.resultNum}>
                        {result.results.bottles} <Text style={styles.resultKey}>(de {result.results.bottle_ml} mL)</Text>
                      </Text>
                    </View>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>Vtotal</Text>
                      <Text style={styles.resultNum}>{result.results.total_l} L</Text>
                    </View>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>Co-inyectores</Text>
                      <Text testID="wiz-coinj-total" style={styles.resultNum}>{toL(result.results.coinjectors_ml ?? 0)}</Text>
                    </View>
                    <View style={styles.resultItem}>
                      <Text style={styles.resultKey}>Agua a agregar en bomba</Text>
                      <Text testID="wiz-water" style={styles.resultNum}>
                        {(result.results.water_ml / 1000).toFixed(2)} L
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.resultHint}>Agua = Vtotal − V1 − co-inyectores</Text>
                </View>
              )}
            </>
          )}
        </KeyboardAwareScrollView>

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
              disabled={vtotal === null}
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
  instruction: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base, marginTop: spacing.sm, lineHeight: 22 },
  hintLine: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: -spacing.sm, marginBottom: spacing.md, lineHeight: 18 },
  selectorLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base, marginBottom: spacing.xs },
  methodRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  methodChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  methodChipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  methodText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  methodTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
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
  kfCard: { marginTop: spacing.sm, marginBottom: spacing.lg },
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
