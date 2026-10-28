import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { Button } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { pickJsonFile, saveJsonFile } from "@/src/utils/files";
import { nowMxParts } from "@/src/utils/mxtime";

/** Respaldo completo: exporta todos los casos y catálogos a un archivo, y los restaura. */
export function BackupCard() {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const exportAll = async () => {
    setExporting(true);
    try {
      const data = await api.get("/backup");
      const [d] = nowMxParts();
      await saveJsonFile(`Preservia_respaldo_${d}.json`, JSON.stringify(data, null, 2));
      toast.show(`Respaldo listo: ${data.cases.length} caso(s)`, "success");
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo crear el respaldo", "error");
    } finally {
      setExporting(false);
    }
  };

  const restore = async () => {
    try {
      const payload = await pickJsonFile();
      if (!payload) return;
      setRestoring(true);
      const r = await api.post("/backup/restore", payload);
      toast.show(`Restaurados ${r.restored} caso(s)${r.skipped ? `, ${r.skipped} ya existían` : ""}`, "success");
    } catch (e: any) {
      toast.show(e?.detail || "Archivo de respaldo inválido", "error");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <View testID="backup-card" style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="archive-outline" size={20} color={colors.onSurface} />
        <Text style={styles.title}>Respaldo de datos</Text>
      </View>
      <Text style={styles.sub}>
        Incluye todos tus casos (hoja, firma, cálculos, notas y bitácora) y tus catálogos de co-inyectores y fluidos. Las fotos y documentos adjuntos no se incluyen.
      </Text>
      <Button testID="backup-export" label="Exportar respaldo" icon="download-outline" onPress={exportAll} loading={exporting} />
      <View style={{ height: spacing.sm }} />
      <Button testID="backup-restore" label="Restaurar respaldo" variant="outline" icon="cloud-upload-outline" onPress={restore} loading={restoring} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: "stretch", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, lineHeight: 18, marginTop: spacing.sm, marginBottom: spacing.md },
});
