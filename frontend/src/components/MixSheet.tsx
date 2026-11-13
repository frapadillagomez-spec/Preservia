import { useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { colors, font, fontSize, spacing } from "@/src/theme";

type Sheet = { filename: string; pdf_base64: string; text: string };

/** Hoja de mezcla del último Cálculo de inyección: PDF de una página o texto corto por WhatsApp. */
export function MixSheet({ caseId }: { caseId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"pdf" | "text" | null>(null);

  const load = () => api.get<Sheet>(`/cases/${caseId}/mix-sheet`);
  const fail = (e: any) =>
    toast.show(e?.status === 0 ? "Sin conexión: la hoja de mezcla necesita internet" : e?.detail || "No se pudo preparar la hoja de mezcla", "error");

  const sharePdf = async () => {
    setBusy("pdf");
    try {
      const s = await load();
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = `data:application/pdf;base64,${s.pdf_base64}`;
        a.download = s.filename;
        a.click();
        return;
      }
      const uri = FileSystem.cacheDirectory + s.filename;
      await FileSystem.writeAsStringAsync(uri, s.pdf_base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Imprimir o compartir hoja de mezcla" });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const sendText = async () => {
    setBusy("text");
    try {
      const s = await load();
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(s.text)}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View testID="mix-sheet" style={styles.box}>
      <Text style={styles.title}>Hoja de mezcla</Text>
      <Text style={styles.sub}>Usa el último Cálculo de inyección guardado. PDF de una página o texto corto por WhatsApp.</Text>
      <View style={styles.row}>
        <Button testID="mix-pdf" label="PDF" icon="print-outline" variant="outline" onPress={sharePdf} loading={busy === "pdf"} disabled={!!busy} style={{ flex: 1 }} />
        <Button testID="mix-whatsapp" label="WhatsApp" icon="logo-whatsapp" variant="outline" onPress={sendText} loading={busy === "text"} disabled={!!busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: "stretch", marginTop: spacing.lg },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2, marginBottom: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm },
});
