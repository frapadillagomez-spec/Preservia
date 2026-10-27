import { useRef, useState } from "react";
import { LayoutChangeEvent, Modal, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { nowMxParts } from "@/src/utils/mxtime";

export type Signature = { strokes: number[][][]; w: number; h: number; signed_at: string };

const toPath = (stroke: number[][]) =>
  stroke.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ") + (stroke.length === 1 ? " l0.1 0" : "");

/** Vista de una firma guardada, recortada al área firmada. */
export function SignaturePreview({ sig, height = 90 }: { sig: Signature; height?: number }) {
  const pts = sig.strokes.flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = 6;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(Math.max(...xs) - minX + pad, 1);
  const h = Math.max(Math.max(...ys) - minY + pad, 1);
  return (
    <Svg width="100%" height={height} viewBox={`${minX} ${minY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      {sig.strokes.map((s, i) => (
        <Path key={i} d={toPath(s)} stroke={colors.onSurface} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

type ModalProps = { visible: boolean; title: string; onClose: () => void; onSave: (sig: Signature) => void };

/** Panel para firmar con el dedo. */
export function SignatureModal({ visible, title, onClose, onSave }: ModalProps) {
  const insets = useSafeAreaInsets();
  const [strokes, setStrokes] = useState<number[][][]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const current = useRef<number[][]>([]);

  const point = (e: any) => [Math.round(e.nativeEvent.locationX), Math.round(e.nativeEvent.locationY)];

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        current.current = [point(e)];
        setStrokes((s) => [...s, current.current]);
      },
      onPanResponderMove: (e) => {
        current.current = [...current.current, point(e)];
        const stroke = current.current;
        setStrokes((s) => [...s.slice(0, -1), stroke]);
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });

  const close = () => {
    setStrokes([]);
    onClose();
  };

  const save = () => {
    const [d, t] = nowMxParts();
    onSave({ strokes, w: size.w, h: size.h, signed_at: `${d} ${t}` });
    setStrokes([]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable testID="signature-close" onPress={close} hitSlop={12}>
            <Ionicons name="close" size={26} color={colors.onSurface} />
          </Pressable>
        </View>
        <Text style={styles.hint}>Firma con el dedo dentro del recuadro.</Text>
        <View testID="signature-pad" style={styles.pad} onLayout={onLayout} {...pan.panHandlers}>
          <Svg width="100%" height="100%" pointerEvents="none">
            {strokes.map((s, i) => (
              <Path key={i} d={toPath(s)} stroke={colors.onSurface} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </Svg>
          <View pointerEvents="none" style={styles.baseline} />
        </View>
        <View style={styles.actions}>
          <Button testID="signature-clear" label="Limpiar" variant="outline" icon="refresh-outline" onPress={() => setStrokes([])} style={{ flex: 1 }} />
          <Button testID="signature-save" label="Guardar firma" icon="checkmark" onPress={save} disabled={!strokes.length} style={{ flex: 2 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xl, flex: 1 },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: spacing.xs, marginBottom: spacing.md },
  pad: {
    flex: 1,
    maxHeight: 320,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    overflow: "hidden",
  },
  baseline: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 56, height: 1, backgroundColor: colors.border },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
});
