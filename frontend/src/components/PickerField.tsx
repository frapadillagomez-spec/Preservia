import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { nowMxParts } from "@/src/utils/mxtime";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
const pad = (n: number) => String(n).padStart(2, "0");

type Props = {
  mode: "date" | "time";
  label?: string;
  value: string; // "AAAA-MM-DD" o "HH:MM"
  onChange: (v: string) => void;
  testID?: string;
  placeholder?: string;
};

/** Campo con calendario desplegable (fecha) o reloj (hora y minutos). Funciona igual en iOS, Android y web. */
export function PickerField({ mode, label, value, onChange, testID, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <Pressable testID={testID} onPress={() => setOpen(true)} style={styles.input}>
        <Ionicons name={mode === "date" ? "calendar-outline" : "time-outline"} size={18} color={colors.onSurfaceSecondary} />
        <Text style={[styles.value, !value && { color: colors.onSurfaceTertiary }]} numberOfLines={1}>
          {value ? (mode === "date" ? fmtDate(value) : value) : placeholder || (mode === "date" ? "Elegir fecha" : "Elegir hora")}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {mode === "date" ? (
              <Calendar value={value} testID={testID} onPick={(v) => { onChange(v); setOpen(false); }} />
            ) : (
              <Clock value={value} testID={testID} onPick={(v) => { onChange(v); setOpen(false); }} />
            )}
            <View style={styles.footer}>
              <Pressable testID={`${testID}-clear`} onPress={() => { onChange(""); setOpen(false); }} style={styles.footBtn}>
                <Text style={styles.footText}>Borrar</Text>
              </Pressable>
              <Pressable
                testID={`${testID}-now`}
                onPress={() => { const [d, t] = nowMxParts(); onChange(mode === "date" ? d : t); setOpen(false); }}
                style={styles.footBtn}
              >
                <Text style={styles.footText}>{mode === "date" ? "Hoy" : "Ahora"}</Text>
              </Pressable>
              <Pressable testID={`${testID}-cancel`} onPress={() => setOpen(false)} style={styles.footBtn}>
                <Text style={styles.footText}>Cancelar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function fmtDate(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

function Calendar({ value, onPick, testID }: { value: string; onPick: (v: string) => void; testID?: string }) {
  const init = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) || /^(\d{4})-(\d{2})-(\d{2})$/.exec(nowMxParts()[0])!;
  const [y, setY] = useState(Number(init[1]));
  const [m, setM] = useState(Number(init[2]) - 1);
  const cells = useMemo(() => {
    const first = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // lunes = 0
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  }, [y, m]);
  const move = (d: number) => {
    const nm = m + d;
    setY(y + Math.floor(nm / 12));
    setM(((nm % 12) + 12) % 12);
  };
  return (
    <View>
      <View style={styles.calHead}>
        <Pressable testID={`${testID}-prev`} onPress={() => move(-1)} hitSlop={10} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.calTitle}>{MONTHS[m]} {y}</Text>
        <Pressable testID={`${testID}-next`} onPress={() => move(1)} hitSlop={10} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={22} color={colors.onSurface} />
        </Pressable>
      </View>
      <View style={styles.grid}>
        {DAYS.map((d, i) => (
          <Text key={`h${i}`} style={styles.dow}>{d}</Text>
        ))}
        {cells.map((d, i) => {
          const v = d ? `${y}-${pad(m + 1)}-${pad(d)}` : "";
          const sel = v === value;
          return (
            <Pressable key={i} disabled={!d} testID={d ? `${testID}-day-${d}` : undefined} onPress={() => onPick(v)} style={[styles.day, sel && styles.daySel]}>
              <Text style={[styles.dayText, sel && styles.daySelText]}>{d ?? ""}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Clock({ value, onPick, testID }: { value: string; onPick: (v: string) => void; testID?: string }) {
  const init = /^(\d{1,2}):(\d{2})$/.exec(value) || /^(\d{1,2}):(\d{2})$/.exec(nowMxParts()[1])!;
  const [h, setH] = useState(Number(init[1]));
  const [mi, setMi] = useState(Number(init[2]));
  return (
    <View>
      <Text style={styles.calTitle}>{pad(h)}:{pad(mi)}</Text>
      <View style={styles.clockRow}>
        <View style={styles.clockCol}>
          <Text style={styles.dow}>Hora</Text>
          <ScrollView style={styles.clockList} contentContainerStyle={styles.clockGrid}>
            {Array.from({ length: 24 }, (_, i) => (
              <Pressable key={i} testID={`${testID}-h-${i}`} onPress={() => setH(i)} style={[styles.tick, h === i && styles.daySel]}>
                <Text style={[styles.dayText, h === i && styles.daySelText]}>{pad(i)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={styles.clockCol}>
          <Text style={styles.dow}>Minutos</Text>
          <ScrollView style={styles.clockList} contentContainerStyle={styles.clockGrid}>
            {Array.from({ length: 60 }, (_, i) => (
              <Pressable key={i} testID={`${testID}-m-${i}`} onPress={() => setMi(i)} style={[styles.tick, mi === i && styles.daySel]}>
                <Text style={[styles.dayText, mi === i && styles.daySelText]}>{pad(i)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
      <Pressable testID={`${testID}-ok`} onPress={() => onPick(`${pad(h)}:${pad(mi)}`)} style={styles.okBtn}>
        <Text style={styles.okText}>Aceptar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm, marginBottom: spacing.xs },
  input: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    marginBottom: spacing.md,
  },
  value: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: fontSize.base },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, maxWidth: 420, width: "100%", alignSelf: "center" },
  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  navBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  calTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dow: { width: `${100 / 7}%`, textAlign: "center", color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: fontSize.sm, paddingVertical: spacing.xs },
  day: { width: `${100 / 7}%`, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  daySel: { backgroundColor: colors.surfaceInverse },
  dayText: { color: colors.onSurface, fontFamily: font.medium, fontSize: fontSize.base },
  daySelText: { color: colors.onSurfaceInverse, fontFamily: font.semibold },
  clockRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  clockCol: { flex: 1 },
  clockList: { maxHeight: 220 },
  clockGrid: { flexDirection: "row", flexWrap: "wrap" },
  tick: { width: "25%", height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  okBtn: { marginTop: spacing.md, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.surfaceInverse, alignItems: "center", justifyContent: "center" },
  okText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.base },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md },
  footBtn: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: "center" },
  footText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
});
