import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { useAuth } from "@/src/context/AuthContext";
import { REFERENCE } from "@/src/data/reference";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { BrandBar } from "@/src/components/BrandLogo";

type Doc = { doc_id: string; title: string; filename: string; size: number; created_at: string; category?: string };
type Tab = "reference" | "catalog" | "documents";
type Cat = "ficha_tecnica" | "hoja_seguridad";

const CATS: { key: Cat; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "ficha_tecnica", label: "Fichas Técnicas", icon: "document-attach-outline" },
  { key: "hoja_seguridad", label: "Hojas de Seguridad", icon: "shield-checkmark-outline" },
];

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function readPickedPdf(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

async function openPdfBase64(base64: string, filename: string) {
  if (Platform.OS === "web") {
    const link = document.createElement("a");
    link.href = `data:application/pdf;base64,${base64}`;
    link.download = filename;
    link.click();
    return;
  }
  const uri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
  }
}

export default function Library() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;

  const [tab, setTab] = useState<Tab>("reference");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [catalog, setCatalog] = useState<Doc[]>([]);
  const [cat, setCat] = useState<Cat>("ficha_tecnica");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([
        api.get<{ documents: Doc[] }>("/library/documents"),
        api.get<{ documents: Doc[] }>("/catalog/documents"),
      ]);
      setDocs(d.documents);
      setCatalog(c.documents);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll]),
  );

  const uploadDoc = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      const base64 = await readPickedPdf(asset.uri);
      await api.post("/library/documents", {
        title: asset.name?.replace(/\.pdf$/i, "") || "Documento",
        filename: asset.name || "documento.pdf",
        pdf_base64: base64,
      });
      toast.show("Documento subido", "success");
      loadAll();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo subir el documento", "error");
    } finally {
      setUploading(false);
    }
  };

  const uploadCatalog = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      const base64 = await readPickedPdf(asset.uri);
      await api.post("/catalog/documents", {
        category: cat,
        title: asset.name?.replace(/\.pdf$/i, "") || "Documento",
        filename: asset.name || "documento.pdf",
        pdf_base64: base64,
      });
      toast.show("Documento publicado en el catálogo", "success");
      loadAll();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo publicar", "error");
    } finally {
      setUploading(false);
    }
  };

  const openDoc = async (docId: string, endpoint: string) => {
    setOpeningId(docId);
    try {
      const resp = await api.get<{ document: { pdf_base64: string; filename: string } }>(
        `${endpoint}/${docId}`,
      );
      await openPdfBase64(resp.document.pdf_base64, resp.document.filename);
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo abrir el documento", "error");
    } finally {
      setOpeningId(null);
    }
  };

  const deleteDoc = async (docId: string) => {
    await api.del(`/library/documents/${docId}`);
    loadAll();
  };
  const deleteCatalog = async (docId: string) => {
    await api.del(`/catalog/documents/${docId}`);
    loadAll();
  };

  const catalogFiltered = catalog.filter((d) => d.category === cat);

  const renderDocCard = (d: Doc, endpoint: string, onDelete?: (id: string) => void) => (
    <Pressable
      key={d.doc_id}
      testID={`doc-item-${d.doc_id}`}
      style={({ pressed }) => [styles.docCard, pressed && { opacity: 0.85 }]}
      onPress={() => openDoc(d.doc_id, endpoint)}
    >
      <View style={styles.docIcon}>
        {openingId === d.doc_id ? (
          <ActivityIndicator color={colors.error} />
        ) : (
          <Ionicons name="document-text" size={22} color={colors.error} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.refTitle} numberOfLines={1}>
          {d.title}
        </Text>
        <Text style={styles.refSummary}>{fmtSize(d.size)}</Text>
      </View>
      {onDelete && (
        <Pressable testID={`delete-doc-${d.doc_id}`} onPress={() => onDelete(d.doc_id)} hitSlop={10}>
          <Ionicons name="trash-outline" size={18} color={colors.onSurfaceTertiary} />
        </Pressable>
      )}
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <BrandBar />
      <View style={styles.header}>
        <Text style={styles.title}>Biblioteca</Text>
      </View>

      <View style={styles.segment}>
        {([
          { key: "reference", label: "Referencia" },
          { key: "catalog", label: "Catálogo" },
          { key: "documents", label: "Mis documentos" },
        ] as const).map((s) => (
          <Pressable
            key={s.key}
            testID={`lib-tab-${s.key}`}
            onPress={() => setTab(s.key)}
            style={[styles.segmentBtn, tab === s.key && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, tab === s.key && styles.segmentTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "reference" && (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {REFERENCE.map((a) => (
            <Pressable
              key={a.id}
              testID={`ref-article-${a.id}`}
              style={({ pressed }) => [styles.refCard, pressed && { opacity: 0.85 }]}
              onPress={() => router.push(`/library/${a.id}`)}
            >
              <View style={styles.refIcon}>
                <Ionicons name={a.icon} size={22} color={colors.onSurface} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.refTitle}>{a.title}</Text>
                <Text style={styles.refSummary} numberOfLines={2}>
                  {a.summary}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {tab === "catalog" && (
        <View style={styles.flex}>
          <View style={styles.chipRow}>
            {CATS.map((c) => (
              <Pressable
                key={c.key}
                testID={`cat-chip-${c.key}`}
                onPress={() => setCat(c.key)}
                style={[styles.chip, cat === c.key && styles.chipActive]}
              >
                <Ionicons
                  name={c.icon}
                  size={15}
                  color={cat === c.key ? colors.onSurfaceInverse : colors.onSurfaceSecondary}
                />
                <Text style={[styles.chipText, cat === c.key && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.onSurfaceSecondary} />
            </View>
          ) : catalogFiltered.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="folder-open-outline" size={44} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>Sin documentos</Text>
              <Text style={styles.emptySub}>
                {isAdmin
                  ? "Publica la primera ficha o hoja de seguridad para tu equipo."
                  : "Aún no hay documentos publicados en esta categoría."}
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {catalogFiltered.map((d) =>
                renderDocCard(d, "/catalog/documents", isAdmin ? deleteCatalog : undefined),
              )}
            </ScrollView>
          )}

          {isAdmin && (
            <Pressable
              testID="upload-catalog-button"
              onPress={uploadCatalog}
              style={({ pressed }) => [styles.fab, { bottom: spacing.lg }, pressed && { opacity: 0.85 }]}
            >
              {uploading ? (
                <ActivityIndicator color={colors.onSurfaceInverse} />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={22} color={colors.onSurfaceInverse} />
                  <Text style={styles.fabText}>Publicar PDF</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      )}

      {tab === "documents" && (
        <View style={styles.flex}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.onSurfaceSecondary} />
            </View>
          ) : docs.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="document-attach-outline" size={44} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>Sin documentos</Text>
              <Text style={styles.emptySub}>Sube tus guías o protocolos en PDF para tenerlos a mano.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {docs.map((d) => renderDocCard(d, "/library/documents", deleteDoc))}
            </ScrollView>
          )}

          <Pressable
            testID="upload-doc-button"
            onPress={uploadDoc}
            style={({ pressed }) => [styles.fab, { bottom: spacing.lg }, pressed && { opacity: 0.85 }]}
          >
            {uploading ? (
              <ActivityIndicator color={colors.onSurfaceInverse} />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={22} color={colors.onSurfaceInverse} />
                <Text style={styles.fabText}>Subir PDF</Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxxl },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 4,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.sm + 2, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surfaceInverse },
  segmentText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  segmentTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  chipRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  chipTextActive: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 120 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base, textAlign: "center" },
  refCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  refIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  refTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  refSummary: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  docIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.errorBg,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceInverse,
    paddingHorizontal: spacing.lg,
    height: 52,
    borderRadius: radius.pill,
    minWidth: 130,
    justifyContent: "center",
    elevation: 6,
  },
  fabText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.base },
});
