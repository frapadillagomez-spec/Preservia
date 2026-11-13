import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { colors, font, fontSize, spacing } from "@/src/theme";

type Sheet = { filename: string; pdf_base64: string; text: string };

/** Hoja de mezcla del último Cálculo de inyección: PDF de una página, texto por WhatsApp y confirmación. */
export function MixSheet({
  caseId,
  hasMix,
  confirmed,
  canUndo,
  fluidName,
  onConfirmed,
}: {
  caseId: string;
  hasMix: boolean;
  confirmed: boolean;
  canUndo: boolean;
  fluidName?: string;
  onConfirmed: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"pdf" | "text" | "confirm" | "undo" | null>(null);
  const [lots, setLots] = useState<{ lot_id: string; lot: string; stock: number }[]>([]);
  const [lotId, setLotId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasMix || confirmed || !fluidName) return;
    api
      .get<{ items: { name: string; lots?: { lot_id: string; lot: string; stock: number }[] }[] }>("/fluids")
      .then((r) => {
        const f = (r.items || []).find((x) => x.name.toLowerCase() === fluidName.toLowerCase());
        const ls = f?.lots || [];
        setLots(ls);
        setLotId((ls.find((l) => l.stock > 0) || ls[0])?.lot_id ?? null);
      })
      .catch(() => {});
  }, [hasMix, confirmed, fluidName]);

  const ask = (title: string, msg: string, ok: string, fn: () => void) => {
    if (Platform.OS === "web") {
      if (window.confirm(msg)) fn();
      return;
    }
    Alert.alert(title, msg, [
      { text: "Cancelar", style: "cancel" },
      { text: ok, style: "destructive", onPress: fn },
    ]);
  };

  const undo = () =>
    ask(
      "Anular mezcla",
      "Se devolverán las botellas al inventario y se quitarán de la Bitácora el arterial y el agua de esta mezcla.",
      "Anular",
      doUndo,
    );

  const doUndo = async () => {
    setBusy("undo");
    try {
      const r = await api.post<{ bottles: number; stock: number | null }>(`/cases/${caseId}/mix-undo`, {});
      toast.show(r.stock !== null ? `Mezcla anulada: +${r.bottles} botellas, ahora ${r.stock}` : "Mezcla anulada", "success");
      onConfirmed();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const confirm = () =>
    ask(
      "Confirmar mezcla",
      "Se registrarán el arterial y el agua en la Bitácora y se descontarán las botellas del inventario. Podrás anularla después.",
      "Confirmar",
      doConfirm,
    );

  const doConfirm = async () => {
    setBusy("confirm");
    try {
      const r = await api.post<{ bottles: number; fluid: string | null; stock_left: number | null }>(`/cases/${caseId}/mix-confirm`, { lot_id: lotId });
      toast.show(
        r.fluid
          ? `Mezcla registrada en la Bitácora. ${r.fluid}: −${r.bottles} botellas, quedan ${r.stock_left}`
          : "Mezcla registrada en la Bitácora (el arterial no está en tu inventario)",
        "success",
      );
      onConfirmed();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

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
      {hasMix && (
        <View style={{ marginTop: spacing.sm }}>
          {confirmed ? (
            <Text testID="mix-confirmed" style={styles.done}>✓ Mezcla confirmada: registrada en la Bitácora y descontada del inventario</Text>
          ) : (
            <>
              {lots.length > 0 && (
                <View style={styles.lots}>
                  <Text style={styles.sub}>Lote del arterial a descontar:</Text>
                  <View style={styles.row}>
                    {lots.map((l) => (
                      <Pressable key={l.lot_id} testID={`mix-lot-${l.lot_id}`} onPress={() => setLotId(l.lot_id)} style={[styles.chip, lotId === l.lot_id && styles.chipOn]}>
                        <Text style={[styles.chipText, lotId === l.lot_id && styles.chipTextOn]}>{l.lot} · {l.stock}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              <Button testID="mix-confirm" label="Confirmar mezcla" icon="checkmark-done-outline" onPress={confirm} loading={busy === "confirm"} disabled={!!busy} />
            </>
          )}
          {canUndo && (
            <Button
              testID="mix-undo"
              label="Anular última mezcla confirmada"
              icon="arrow-undo-outline"
              variant="ghost"
              onPress={undo}
              loading={busy === "undo"}
              disabled={!!busy}
              style={{ marginTop: spacing.xs }}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: "stretch", marginTop: spacing.lg },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2, marginBottom: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm },
  done: { color: colors.success, fontFamily: font.medium, fontSize: fontSize.sm },
  lots: { marginBottom: spacing.sm },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, flexWrap: "wrap" },
  chipOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  chipTextOn: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
});
