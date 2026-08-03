import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Calc = { calc_id: string; label: string; summary: string; inputs: Record<string, any>; created_at: string };
type Note = { note_id: string; text: string; date: string; photos: string[]; created_at: string };
type CaseData = {
  case_id: string;
  name: string;
  case_ref: string;
  deceased_name: string;
  date: string;
  status: string;
  calculations: Calc[];
  notes: Note[];
};

const CALCULATORS: { type: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: "volume", label: "Volumen de solución", icon: "flask-outline" },
  { type: "lbm", label: "Masa magra corporal", icon: "body-outline" },
  { type: "concentration", label: "Concentración / Dilución", icon: "beaker-outline" },
];

type Tab = "calc" | "notes" | "report";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function CaseDetail() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [data, setData] = useState<CaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("calc");

  // note composer
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const resp = await api.get<{ case: CaseData }>(`/cases/${id}`);
      setData(resp.case);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // ---------- notes ----------
  const saveNote = async () => {
    if (!noteText.trim()) {
      toast.show("Agrega texto a la nota", "error");
      return;
    }
    setSavingNote(true);
    try {
      await api.post(`/cases/${id}/notes`, { text: noteText.trim(), photos: [] });
      setNoteText("");
      toast.show("Nota guardada", "success");
      load();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo guardar la nota", "error");
    } finally {
      setSavingNote(false);
    }
  };

  const deleteCalc = async (calcId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await api.del(`/cases/${id}/calculations/${calcId}`);
    load();
  };

  const deleteNote = async (noteId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await api.del(`/notes/${noteId}`);
    load();
  };

  const deleteCase = async () => {
    await api.del(`/cases/${id}`);
    toast.show("Caso eliminado", "success");
    router.replace("/(tabs)");
  };

  const toggleArchive = async () => {
    if (!data) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const next = data.status === "archived" ? "active" : "archived";
    try {
      await api.patch(`/cases/${id}/status`, { status: next });
      toast.show(next === "archived" ? "Caso archivado" : "Caso reactivado", "success");
      load();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo actualizar el caso", "error");
    }
  };

  const generateReport = () => {
    router.push({
      pathname: "/viewer",
      params: { scope: "report", id: String(id), title: "Reporte del caso" },
    });
  };

  const safeName = (data?.name || "caso").replace(/[^\w\-]+/g, "_").slice(0, 40) || "caso";

  const exportData = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const payload = {
        app: "Preservia",
        export_version: 1,
        exported_at: new Date().toISOString(),
        case: {
          case_id: data.case_id,
          name: data.name,
          case_ref: data.case_ref,
          deceased_name: data.deceased_name,
          date: data.date,
          status: data.status,
          calculations: data.calculations,
          notes: data.notes.map((n) => ({ note_id: n.note_id, text: n.text, date: n.date })),
        },
      };
      const json = JSON.stringify(payload, null, 2);
      const filename = `Preservia_${safeName}.json`;
      if (Platform.OS === "web") {
        const link = document.createElement("a");
        link.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
        link.download = filename;
        link.click();
      } else {
        const uri = FileSystem.cacheDirectory + filename;
        await FileSystem.writeAsStringAsync(uri, json);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "application/json", UTI: "public.json" });
        }
      }
      toast.show("Datos exportados", "success");
    } catch (e: any) {
      toast.show(e?.detail || "No se pudieron exportar los datos", "error");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.onSurfaceSecondary} />
      </View>
    );
  }
  if (error || !data) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.onSurfaceTertiary} />
        <Text style={styles.emptyTitle}>No se pudo cargar el caso</Text>
        <Pressable testID="case-retry" onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable testID="case-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {data.name}
          </Text>
          {data.status === "archived" ? (
            <View style={styles.archivedBadge}>
              <Ionicons name="archive" size={11} color={colors.onSurfaceTertiary} />
              <Text style={styles.archivedText}>Archivado</Text>
            </View>
          ) : (
            !!data.case_ref && <Text style={styles.headerSub}>Ref. {data.case_ref}</Text>
          )}
        </View>
        <Pressable testID="case-archive" onPress={toggleArchive} hitSlop={12} style={{ marginRight: spacing.md }}>
          <Ionicons
            name={data.status === "archived" ? "arrow-undo-outline" : "archive-outline"}
            size={22}
            color={colors.onSurfaceSecondary}
          />
        </Pressable>
        <Pressable testID="case-delete" onPress={deleteCase} hitSlop={12}>
          <Ionicons name="trash-outline" size={22} color={colors.error} />
        </Pressable>
      </View>

      {/* Segmented control */}
      <View style={styles.segment}>
        {([
          { key: "calc", label: "Cálculos" },
          { key: "notes", label: "Notas" },
          { key: "report", label: "Reporte" },
        ] as const).map((s) => (
          <Pressable
            key={s.key}
            testID={`tab-${s.key}`}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setTab(s.key);
            }}
            style={[styles.segmentBtn, tab === s.key && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, tab === s.key && styles.segmentTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      {tab === "calc" && (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>Asistente de cálculo</Text>
          <Pressable
            testID="open-wizard"
            style={({ pressed }) => [styles.wizardTile, pressed && { opacity: 0.9 }]}
            onPress={() => router.push(`/calculator/wizard?caseId=${id}`)}
          >
            <View style={styles.wizardIcon}>
              <Ionicons name="git-branch-outline" size={24} color={colors.onSurfaceInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.wizardTitle}>Cálculo de inyección</Text>
              <Text style={styles.wizardSub}>Masa magra → dilución → volumen (C1·V1=C2·V2)</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={colors.onSurface} />
          </Pressable>

          <Text style={styles.sectionLabel}>Calculadoras individuales</Text>
          <View style={styles.calcGrid}>
            {CALCULATORS.map((c) => (
              <Pressable
                key={c.type}
                testID={`open-calc-${c.type}`}
                style={({ pressed }) => [styles.calcTile, pressed && { opacity: 0.85 }]}
                onPress={() => router.push(`/calculator/${c.type}?caseId=${id}`)}
              >
                <Ionicons name={c.icon} size={24} color={colors.onSurface} />
                <Text style={styles.calcTileText}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Cálculos guardados ({data.calculations.length})</Text>
          {data.calculations.length === 0 ? (
            <Text style={styles.emptyInline}>Aún no hay cálculos en este caso.</Text>
          ) : (
            data.calculations.map((c) => (
              <View key={c.calc_id} testID={`calc-item-${c.calc_id}`} style={styles.rowCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{c.label}</Text>
                  <Text style={styles.rowSummary}>{c.summary}</Text>
                </View>
                <Pressable testID={`delete-calc-${c.calc_id}`} onPress={() => deleteCalc(c.calc_id)} hitSlop={10}>
                  <Ionicons name="close-circle" size={22} color={colors.onSurfaceTertiary} />
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {tab === "notes" && (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.composer}>
              <TextInput
                testID="note-text-input"
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Escribe una nota del caso…"
                placeholderTextColor={colors.onSurfaceTertiary}
                multiline
                style={styles.noteInput}
              />
              <View style={styles.composerActions}>
                <View style={{ flex: 1 }} />
                <Button
                  testID="save-note-button"
                  label="Guardar nota"
                  onPress={saveNote}
                  loading={savingNote}
                  style={{ height: 44, paddingHorizontal: spacing.lg }}
                />
              </View>
            </View>

            <Text style={styles.sectionLabel}>Historial ({data.notes.length})</Text>
            {data.notes.length === 0 ? (
              <Text style={styles.emptyInline}>Aún no hay notas registradas.</Text>
            ) : (
              data.notes.map((n) => (
                <View key={n.note_id} testID={`note-item-${n.note_id}`} style={styles.noteCard}>
                  <View style={styles.noteHeader}>
                    <Text style={styles.noteDate}>{fmtDate(n.date)}</Text>
                    <Pressable testID={`delete-note-${n.note_id}`} onPress={() => deleteNote(n.note_id)} hitSlop={10}>
                      <Ionicons name="trash-outline" size={16} color={colors.onSurfaceTertiary} />
                    </Pressable>
                  </View>
                  {!!n.text && <Text style={styles.noteText}>{n.text}</Text>}
                </View>
              ))
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {tab === "report" && (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.reportCard}>
            <Ionicons name="document-text-outline" size={40} color={colors.onSurface} />
            <Text style={styles.reportTitle}>Reporte del caso</Text>
            <Text style={styles.reportSub}>
              Genera un PDF profesional o exporta los datos del caso ({data.calculations.length} cálculo(s) y{" "}
              {data.notes.length} nota(s)) para guardarlos donde prefieras.
            </Text>
            <Button
              testID="preview-report-button"
              label="Vista previa del reporte"
              icon="eye-outline"
              onPress={generateReport}
              style={{ marginTop: spacing.lg, alignSelf: "stretch" }}
            />
            <Button
              testID="export-data-button"
              label={Platform.OS === "web" ? "Descargar datos (JSON)" : "Exportar datos (JSON)"}
              icon="code-download-outline"
              variant="outline"
              onPress={exportData}
              loading={exporting}
              style={{ marginTop: spacing.md, alignSelf: "stretch" }}
            />
            <Text style={styles.exportHint}>
              Revisa el reporte antes de guardarlo; desde la vista previa podrás guardarlo en Archivos
              (iCloud/dispositivo), Google Drive, Dropbox, OneDrive y más.
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>{data.calculations.length}</Text>
              <Text style={styles.summaryLabel}>Cálculos</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>{data.notes.length}</Text>
              <Text style={styles.summaryLabel}>Notas</Text>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  emptyInline: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base, marginTop: spacing.xs },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
  },
  retryText: { color: colors.onSurface, fontFamily: font.semibold },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xl },
  headerSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm },
  archivedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 2,
  },
  archivedText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: fontSize.sm },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 4,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.sm + 2, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surfaceInverse },
  segmentText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.base },
  segmentTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 120 },
  sectionLabel: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.medium,
    fontSize: fontSize.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  calcGrid: { gap: spacing.md },
  wizardTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  wizardIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
  },
  wizardTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  wizardSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  calcTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  calcTileText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: fontSize.base },
  rowSummary: { color: colors.onSurfaceSecondary, fontFamily: font.mono, fontSize: fontSize.sm, marginTop: 2 },
  composer: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noteInput: {
    color: colors.onSurface,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    minHeight: 72,
    textAlignVertical: "top",
  },
  composerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  noteCard: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  noteDate: { color: colors.onSurfaceTertiary, fontFamily: font.mono, fontSize: fontSize.sm },
  noteText: { color: colors.onSurface, fontFamily: font.regular, fontSize: fontSize.base, lineHeight: 21 },
  reportCard: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    marginTop: spacing.md,
  },
  reportTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.xl, marginTop: spacing.md },
  reportSub: {
    color: colors.onSurfaceSecondary,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  exportHint: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.regular,
    fontSize: fontSize.sm,
    textAlign: "center",
    marginTop: spacing.md,
    lineHeight: 18,
  },
  summaryRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  summaryItem: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  summaryNum: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.xxl },
  summaryLabel: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
});
