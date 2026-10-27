import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { CaseSheetForm, EMPTY_SHEET, Sheet } from "@/src/components/CaseSheetForm";
import { colors, font, fontSize, spacing } from "@/src/theme";
import { dateMx, timeMx } from "@/src/utils/mxtime";

export default function CaseSheet() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { caseId } = useLocalSearchParams<{ caseId: string }>();

  const [sheet, setSheet] = useState<Sheet>(EMPTY_SHEET);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const resp = await api.get<{ case: any }>(`/cases/${caseId}`);
      const c = resp.case;
      const existing = c.case_sheet;
      if (existing && typeof existing === "object") {
        setSheet({ ...EMPTY_SHEET, ...existing });
      } else {
        setSheet({
          ...EMPTY_SHEET,
          nombre_difunto: c.deceased_name || "",
          fecha_ingreso: dateMx(c.embalming_date || c.date),
          inicio_emb: timeMx(c.embalming_start),
          termino_emb: timeMx(c.embalming_end),
        });
      }
    } catch {
      toast.show("No se pudo cargar la hoja", "error");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/cases/${caseId}/sheet`, { sheet });
      toast.show("Hoja del caso guardada", "success");
      if (router.canGoBack()) router.back();
      else router.replace(`/case/${caseId}`);
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo guardar la hoja", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Hoja del caso</Text>
          <Text style={styles.subtitle}>Análisis del caso — Embalsamamiento</Text>
        </View>
        <Pressable testID="sheet-close" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {loading ? null : <CaseSheetForm sheet={sheet} onChange={setSheet} />}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="sheet-save-button" label="Guardar hoja" onPress={save} loading={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxl },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
});
