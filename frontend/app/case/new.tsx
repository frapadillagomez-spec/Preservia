import { useCallback, useEffect, useState } from "react";
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

const pad = (n: number) => String(n).padStart(2, "0");

function splitDT(iso?: string | null): [string, string] {
  if (!iso) return ["", ""];
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ["", ""];
  return [
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  ];
}

function toISO(dateStr: string, timeStr: string): string | null {
  if (!dateStr.trim()) return null;
  const dt = new Date(`${dateStr.trim()}T${(timeStr.trim() || "00:00")}:00`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

export default function NewCase() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const [name, setName] = useState("");
  const [caseRef, setCaseRef] = useState("");
  const [deceased, setDeceased] = useState("");
  const [sex, setSex] = useState<"male" | "female" | "">("");
  const [caseNumber, setCaseNumber] = useState("");
  const [dod, setDod] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const resp = await api.get<{ case: any }>(`/cases/${id}`);
      const c = resp.case;
      setName(c.name || "");
      setCaseRef(c.case_ref || "");
      setDeceased(c.deceased_name || "");
      setSex(c.sex || "");
      setCaseNumber(c.case_number || "");
      const [dd] = splitDT(c.date_of_death);
      setDod(dd || (c.date_of_death ? String(c.date_of_death).slice(0, 10) : ""));
      const [sd, st] = splitDT(c.embalming_start);
      setStartDate(sd);
      setStartTime(st);
      const [ed, et] = splitDT(c.embalming_end);
      setEndDate(ed);
      setEndTime(et);
    } catch {
      toast.show("No se pudo cargar el caso", "error");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const setNow = (which: "start" | "end") => {
    const d = new Date();
    const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const ts = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (which === "start") {
      setStartDate(ds);
      setStartTime(ts);
    } else {
      setEndDate(ds);
      setEndTime(ts);
    }
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.show("El nombre del caso es obligatorio", "error");
      return;
    }
    const payload = {
      name: name.trim(),
      case_ref: caseRef.trim(),
      deceased_name: deceased.trim(),
      sex,
      date_of_death: dod.trim() ? dod.trim() : null,
      embalming_start: toISO(startDate, startTime),
      embalming_end: toISO(endDate, endTime),
    };
    setBusy(true);
    try {
      if (isEdit) {
        await api.put(`/cases/${id}`, payload);
        toast.show("Caso actualizado", "success");
        router.back();
      } else {
        const resp = await api.post("/cases", payload);
        toast.show("Caso creado", "success");
        router.replace(`/case/${resp.case.case_id}`);
      }
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo guardar el caso", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{isEdit ? "Editar caso" : "Nuevo caso"}</Text>
        <Pressable testID="new-case-close" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!!caseNumber && (
            <View style={styles.numberCard}>
              <Ionicons name="barcode-outline" size={18} color={colors.onSurfaceSecondary} />
              <Text style={styles.numberText}>N.º de caso: {caseNumber}</Text>
            </View>
          )}
          {!isEdit && (
            <Text style={styles.hint}>
              Se generará un número de caso único con año, mes y día. La fecha de embalsamamiento coincide con la
              apertura del caso.
            </Text>
          )}

          <Field
            testID="case-name-input"
            label="Nombre del caso *"
            icon="briefcase-outline"
            value={name}
            onChangeText={setName}
            placeholder="Ej. Caso 2026-042"
          />
          <Field
            testID="case-ref-input"
            label="ID / Referencia"
            icon="pricetag-outline"
            value={caseRef}
            onChangeText={setCaseRef}
            placeholder="Referencia interna (opcional)"
          />
          <Field
            testID="case-deceased-input"
            label="Nombre del fallecido"
            icon="person-outline"
            value={deceased}
            onChangeText={setDeceased}
            placeholder="Nombre completo"
          />

          <Text style={styles.label}>Sexo</Text>
          <View style={styles.rowChips}>
            {([
              { key: "male", label: "Masculino" },
              { key: "female", label: "Femenino" },
            ] as const).map((s) => (
              <Pressable
                key={s.key}
                testID={`case-sex-${s.key}`}
                onPress={() => setSex(sex === s.key ? "" : s.key)}
                style={[styles.chip, sex === s.key && styles.chipActive]}
              >
                <Ionicons
                  name={sex === s.key ? "checkbox" : "square-outline"}
                  size={18}
                  color={sex === s.key ? colors.onSurfaceInverse : colors.onSurfaceSecondary}
                />
                <Text style={[styles.chipText, sex === s.key && styles.chipTextActive]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>

          <Field
            testID="case-dod-input"
            label="Fecha de fallecimiento (AAAA-MM-DD)"
            icon="calendar-outline"
            value={dod}
            onChangeText={setDod}
            placeholder="2026-06-01"
          />

          <View style={styles.sectionRow}>
            <Text style={styles.label}>Inicio de embalsamamiento</Text>
            <Pressable testID="start-now" onPress={() => setNow("start")} style={styles.nowBtn}>
              <Ionicons name="time-outline" size={14} color={colors.onSurface} />
              <Text style={styles.nowText}>Ahora</Text>
            </Pressable>
          </View>
          <View style={styles.dtRow}>
            <View style={styles.dtCol}>
              <Field testID="start-date" label="Fecha (AAAA-MM-DD)" value={startDate} onChangeText={setStartDate} placeholder="2026-06-02" />
            </View>
            <View style={styles.dtColSm}>
              <Field testID="start-time" label="Hora (HH:MM)" value={startTime} onChangeText={setStartTime} placeholder="09:00" />
            </View>
          </View>

          <View style={styles.sectionRow}>
            <Text style={styles.label}>Término de embalsamamiento</Text>
            <Pressable testID="end-now" onPress={() => setNow("end")} style={styles.nowBtn}>
              <Ionicons name="time-outline" size={14} color={colors.onSurface} />
              <Text style={styles.nowText}>Ahora</Text>
            </Pressable>
          </View>
          <View style={styles.dtRow}>
            <View style={styles.dtCol}>
              <Field testID="end-date" label="Fecha (AAAA-MM-DD)" value={endDate} onChangeText={setEndDate} placeholder="2026-06-02" />
            </View>
            <View style={styles.dtColSm}>
              <Field testID="end-time" label="Hora (HH:MM)" value={endTime} onChangeText={setEndTime} placeholder="11:30" />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          testID="create-case-button"
          label={isEdit ? "Guardar cambios" : "Crear caso"}
          onPress={submit}
          loading={busy}
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
    paddingBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxl },
  scroll: { padding: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  numberCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  numberText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginBottom: spacing.md, lineHeight: 18 },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base, marginBottom: spacing.sm, marginTop: spacing.sm },
  rowChips: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  chipTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  nowBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSecondary,
  },
  nowText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
  dtRow: { flexDirection: "row", gap: spacing.md },
  dtCol: { flex: 2 },
  dtColSm: { flex: 1 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
});
