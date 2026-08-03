import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Calc = { calc_id: string; label: string; summary: string; inputs: Record<string, any>; created_at: string };
type Note = { note_id: string; text: string; date: string; photos: string[]; created_at: string };
type Attachment = { att_id: string; label: string; filename: string; size: number; created_at: string; kind?: string };
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

const ATT_LABELS = ["Certificado de Defunción", "Hoja de Autorización", "Etiquetas de Identificación"];

type Tab = "calc" | "notes" | "docs" | "report";

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

  // attachments (scanned documents)
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [addModal, setAddModal] = useState(false);
  const [attLabel, setAttLabel] = useState(ATT_LABELS[0]);
  const [addingAtt, setAddingAtt] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(false);
      const resp = await api.get<{ case: CaseData }>(`/cases/${id}`);
      setData(resp.case);
      const at = await api.get<{ attachments: Attachment[] }>(`/cases/${id}/attachments`);
      setAttachments(at.attachments);
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

  // ---------- attachments (scan documents) ----------
  const ensurePermission = async (kind: "camera" | "media") => {
    const get = kind === "camera" ? ImagePicker.getCameraPermissionsAsync : ImagePicker.getMediaLibraryPermissionsAsync;
    const req = kind === "camera" ? ImagePicker.requestCameraPermissionsAsync : ImagePicker.requestMediaLibraryPermissionsAsync;
    const cur = await get();
    if (cur.granted) return true;
    const res = await req();
    if (res.granted) return true;
    if (!res.canAskAgain) {
      Alert.alert(
        kind === "camera" ? "Permiso de cámara" : "Permiso de galería",
        "Habilítalo en Ajustes para adjuntar documentos al caso.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Abrir Ajustes", onPress: () => Linking.openSettings() },
        ],
      );
    } else {
      toast.show(kind === "camera" ? "Permiso de cámara denegado" : "Permiso de galería denegado", "error");
    }
    return false;
  };

  const uploadPicked = async (res: ImagePicker.ImagePickerResult) => {
    if (res.canceled) return;
    setAddingAtt(true);
    try {
      for (const asset of res.assets) {
        if (!asset.base64) continue;
        await api.post(`/cases/${id}/attachments`, {
          label: attLabel,
          filename: asset.fileName || "documento.jpg",
          kind: "image",
          data_base64: asset.base64,
        });
      }
      toast.show("Documento adjuntado", "success");
      setAddModal(false);
      load();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo adjuntar el documento", "error");
    } finally {
      setAddingAtt(false);
    }
  };

  const addFromCamera = async () => {
    if (!(await ensurePermission("camera"))) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true, allowsEditing: true });
    await uploadPicked(res);
  };

  const addFromGallery = async () => {
    if (!(await ensurePermission("media"))) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      base64: true,
      allowsMultipleSelection: true,
    });
    await uploadPicked(res);
  };

  const addFromPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setAddingAtt(true);
    try {
      const b64 =
        Platform.OS === "web"
          ? await new Promise<string>((resolve, reject) => {
              fetch(asset.uri)
                .then((r) => r.blob())
                .then((blob) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result).split(",")[1]);
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                })
                .catch(reject);
            })
          : await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      await api.post(`/cases/${id}/attachments`, {
        label: attLabel,
        filename: asset.name || "documento.pdf",
        kind: "pdf",
        data_base64: b64,
      });
      toast.show("Documento adjuntado", "success");
      setAddModal(false);
      load();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo adjuntar el PDF", "error");
    } finally {
      setAddingAtt(false);
    }
  };

  const openAttachment = async (att: Attachment) => {
    if (att.kind === "pdf") {
      router.push({ pathname: "/viewer", params: { scope: "attachment", id: att.att_id, title: att.label } });
      return;
    }
    try {
      const resp = await api.get<{ attachment: { data_base64: string } }>(`/attachments/${att.att_id}`);
      setPreviewUri(`data:image/*;base64,${resp.attachment.data_base64}`);
    } catch {
      toast.show("No se pudo abrir el documento", "error");
    }
  };

  const deleteAttachment = async (attId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await api.del(`/attachments/${attId}`);
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
          { key: "docs", label: "Docs" },
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

      {tab === "docs" && (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.docsIntro}>
              Escanea o adjunta documentos del caso (Certificado de Defunción, Hoja de Autorización, Etiquetas de
              Identificación). Se incluirán al final del reporte PDF.
            </Text>
            {attachments.length === 0 ? (
              <View style={styles.docsEmpty}>
                <Ionicons name="scan-outline" size={40} color={colors.onSurfaceTertiary} />
                <Text style={styles.emptyInline}>Aún no hay documentos adjuntos.</Text>
              </View>
            ) : (
              attachments.map((a) => (
                <Pressable
                  key={a.att_id}
                  testID={`attachment-${a.att_id}`}
                  style={styles.attRow}
                  onPress={() => openAttachment(a)}
                >
                  <View style={styles.attIcon}>
                    <Ionicons
                      name={a.kind === "pdf" ? "document-text-outline" : "image-outline"}
                      size={20}
                      color={colors.onSurface}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attLabel} numberOfLines={1}>{a.label}</Text>
                    <Text style={styles.attSub} numberOfLines={1}>{a.filename}</Text>
                  </View>
                  <Pressable
                    testID={`attachment-delete-${a.att_id}`}
                    onPress={() => deleteAttachment(a.att_id)}
                    hitSlop={10}
                    style={{ padding: spacing.xs }}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.error} />
                  </Pressable>
                </Pressable>
              ))
            )}
          </ScrollView>
          <Pressable
            testID="scan-doc-button"
            onPress={() => setAddModal(true)}
            style={({ pressed }) => [styles.fab, { bottom: spacing.lg }, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="scan-outline" size={22} color={colors.onSurfaceInverse} />
            <Text style={styles.fabText}>Escanear documento</Text>
          </Pressable>
        </View>
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

      {/* Add attachment modal */}
      <Modal visible={addModal} transparent animationType="fade" onRequestClose={() => setAddModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => !addingAtt && setAddModal(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Adjuntar documento</Text>
            <Text style={styles.modalSub}>Tipo de documento</Text>
            <View style={styles.labelWrap}>
              {ATT_LABELS.map((l) => (
                <Pressable
                  key={l}
                  testID={`att-label-${l}`}
                  onPress={() => setAttLabel(l)}
                  style={[styles.labelChip, attLabel === l && styles.labelChipActive]}
                >
                  <Text style={[styles.labelChipText, attLabel === l && styles.labelChipTextActive]}>{l}</Text>
                </Pressable>
              ))}
            </View>
            {addingAtt ? (
              <View style={{ paddingVertical: spacing.lg }}>
                <ActivityIndicator color={colors.onSurface} />
              </View>
            ) : (
              <>
                <Button
                  testID="att-camera"
                  label="Tomar foto"
                  icon="camera-outline"
                  onPress={addFromCamera}
                  style={{ marginTop: spacing.md, alignSelf: "stretch" }}
                />
                <Button
                  testID="att-gallery"
                  label="Elegir de galería"
                  icon="images-outline"
                  variant="outline"
                  onPress={addFromGallery}
                  style={{ marginTop: spacing.sm, alignSelf: "stretch" }}
                />
                <Button
                  testID="att-pdf"
                  label="Subir PDF"
                  icon="document-outline"
                  variant="outline"
                  onPress={addFromPdf}
                  style={{ marginTop: spacing.sm, alignSelf: "stretch" }}
                />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Image preview modal */}
      <Modal visible={!!previewUri} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreviewUri(null)}>
          <Pressable testID="att-preview-close" style={styles.previewClose} onPress={() => setPreviewUri(null)} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {previewUri && <Image source={previewUri} style={styles.previewImg} contentFit="contain" />}
        </Pressable>
      </Modal>
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
  docsIntro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.base, lineHeight: 21, marginBottom: spacing.lg },
  docsEmpty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl * 1.5 },
  attRow: {
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
  attIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  attLabel: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  attSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceInverse,
    paddingHorizontal: spacing.lg,
    height: 52,
    borderRadius: radius.pill,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fabText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.base },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  modalTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xl },
  modalSub: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: fontSize.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  labelWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  labelChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  labelChipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  labelChipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  labelChipTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  previewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  previewClose: { position: "absolute", top: 48, right: 24, zIndex: 2 },
  previewImg: { width: "92%", height: "80%" },
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
