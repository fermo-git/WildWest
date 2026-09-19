import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { DeviceMotion } from 'expo-sensors';
import { useCalibration } from '../hooks/useCalibration';

const UPDATE_MS = 33;
const HISTORY_LEN = 40;
const MAX_MAG = 30;

export default function CalibrationScreen() {
  const { data, update, clear, loaded } = useCalibration();

  const [liveMag, setLiveMag] = useState(0);
  const [liveAngle, setLiveAngle] = useState(0);
  const [history, setHistory] = useState<number[]>(Array(HISTORY_LEN).fill(0));
  const [running, setRunning] = useState(false);

  const liveMagRef = useRef(0);
  const liveAngleRef = useRef(0);

  useEffect(() => { liveMagRef.current = liveMag; }, [liveMag]);
  useEffect(() => { liveAngleRef.current = liveAngle; }, [liveAngle]);

  useEffect(() => {
    if (!running) return;
    DeviceMotion.setUpdateInterval(UPDATE_MS);
    const sub = DeviceMotion.addListener((d) => {
      const g = d.accelerationIncludingGravity;
      const r = d.rotation;
      if (!g || !r) return;
      const mag = Math.sqrt(g.x ** 2 + g.y ** 2 + g.z ** 2);
      const ang = (r.beta * 180) / Math.PI;
      setLiveMag(mag);
      setLiveAngle(ang);
      setHistory(prev => [...prev.slice(1), mag]);
    });
    return () => sub.remove();
  }, [running]);

  function Stepper({ label, value, unit, step, onChange }: {
    label: string; value: number; unit: string; step: number; onChange: (v: number) => void;
  }) {
    return (
      <View style={s.stepRow}>
        <Text style={s.stepLabel}>{label}</Text>
        <View style={s.stepControls}>
          <Pressable style={s.stepBtn} onPress={() => onChange(Math.max(0, value - step))}>
            <Text style={s.stepBtnText}>−</Text>
          </Pressable>
          <Text style={s.stepVal}>{value.toFixed(step < 1 ? 1 : 0)} {unit}</Text>
          <Pressable style={s.stepBtn} onPress={() => onChange(value + step)}>
            <Text style={s.stepBtnText}>+</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Pressable onPress={() => router.back()} style={s.back}>
        <Text style={s.backText}>← Volver</Text>
      </Pressable>

      <Text style={s.title}>Calibración</Text>
      {!loaded && <Text style={s.hint}>Cargando…</Text>}

      {/* Opción por dispositivo: usar calibración guardada y saltarse los 3s en partida */}
      <View style={s.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.toggleLabel}>Calibración en partida</Text>
          <Text style={s.toggleSub}>
            {data.skipAutoCalibration
              ? 'Usa los valores guardados abajo. Se salta los 3s de calibración al inicio de cada ronda.'
              : 'Se calibra automáticamente los primeros 3s de cada ronda (recomendado si el bolsillo varía).'}
          </Text>
        </View>
        <Pressable
          style={[s.toggleBtn, { backgroundColor: data.skipAutoCalibration ? '#e0a63e' : '#1e2530' }]}
          onPress={() => update({ skipAutoCalibration: !data.skipAutoCalibration })}
        >
          <Text style={[s.toggleBtnText, { color: data.skipAutoCalibration ? '#0d1117' : '#4a5160' }]}>
            {data.skipAutoCalibration ? 'Guardada' : 'Automática'}
          </Text>
        </Pressable>
      </View>

      <Pressable
        style={[s.bigBtn, { backgroundColor: running ? '#e05353' : '#3ecf6a' }]}
        onPress={() => setRunning(r => !r)}
      >
        <Text style={s.bigBtnText}>{running ? 'Detener sensores' : 'Iniciar sensores'}</Text>
      </Pressable>

      {/* Lecturas en vivo */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Lecturas en vivo</Text>
        <Text style={s.readout}>Magnitud: <Text style={s.val}>{liveMag.toFixed(2)} m/s²</Text></Text>
        <Text style={s.readout}>Ángulo (beta): <Text style={s.val}>{liveAngle.toFixed(1)}°</Text></Text>
      </View>

      {/* Gráfica */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Magnitud reciente</Text>
        <View style={s.chart}>
          {history.map((v, i) => (
            <View
              key={i}
              style={[s.bar, {
                height: Math.max(2, Math.min(v / MAX_MAG, 1) * 80),
                backgroundColor: v > data.threshold ? '#e0a63e' : '#3a4250',
              }]}
            />
          ))}
        </View>
        <Text style={s.hint}>Naranja = sobre umbral ({data.threshold.toFixed(1)} m/s²)</Text>
      </View>

      {/* Calibración de posición */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Posición</Text>
        <Text style={s.hint}>
          Teléfono en el bolsillo → Calibrar reposo.{'\n'}
          Teléfono apuntando al frente → Calibrar objetivo.
        </Text>

        <View style={s.row}>
          <Pressable style={s.calibBtn} onPress={() => update({ restAngle: liveAngle })}>
            <Text style={s.smallBtnText}>Calibrar reposo</Text>
          </Pressable>
          <Text style={s.val}>
            {data.restAngle !== null ? `${data.restAngle.toFixed(1)}°` : '—'}
          </Text>
        </View>

        <View style={s.row}>
          <Pressable style={s.calibBtn} onPress={() => update({ targetAngle: liveAngle })}>
            <Text style={s.smallBtnText}>Calibrar objetivo</Text>
          </Pressable>
          <Text style={s.val}>
            {data.targetAngle !== null ? `${data.targetAngle.toFixed(1)}°` : '—'}
          </Text>
        </View>

        <Pressable onPress={clear} style={{ marginTop: 14 }}>
          <Text style={{ color: '#e05353', fontSize: 12, fontWeight: '600' }}>
            Borrar calibración guardada
          </Text>
        </Pressable>
      </View>

      {/* Umbrales */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Umbrales</Text>
        <Stepper label="Umbral de movimiento" value={data.threshold} unit="m/s²" step={0.5}
          onChange={v => update({ threshold: v })} />
        <Stepper label="Ventana de tiempo" value={data.timeWindowMs} unit="ms" step={50}
          onChange={v => update({ timeWindowMs: v })} />
        <Stepper label="Tolerancia ángulo objetivo" value={data.angleTolerance} unit="°" step={5}
          onChange={v => update({ angleTolerance: v })} />
        <Stepper label="Tolerancia ángulo de reposo" value={data.restTolerance} unit="°" step={5}
          onChange={v => update({ restTolerance: v })} />
      </View>

      <Text style={s.footer}>Los valores se guardan automáticamente en este teléfono.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60, gap: 14 },
  back: { marginBottom: 8 },
  backText: { color: '#4a5160', fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', color: '#f2e9dc' },
  hint: { color: '#4a5160', fontSize: 12 },
  bigBtn: { paddingVertical: 16, borderRadius: 10, alignItems: 'center' },
  bigBtnText: { color: '#0d1117', fontWeight: '800', fontSize: 15 },
  card: { backgroundColor: '#12171f', borderRadius: 12, padding: 16, gap: 8 },
  cardTitle: { color: '#f2e9dc', fontWeight: '700', fontSize: 14, marginBottom: 4 },
  readout: { color: '#4a5160', fontSize: 14 },
  val: { color: '#f2e9dc', fontWeight: '700' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 84, gap: 2 },
  bar: { flex: 1, borderRadius: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  calibBtn: { backgroundColor: '#1e2530', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  smallBtnText: { color: '#8b93a1', fontWeight: '600', fontSize: 13 },
  stepRow: { marginTop: 8 },
  stepLabel: { color: '#4a5160', fontSize: 13, marginBottom: 4 },
  stepControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#1e2530', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: '#f2e9dc', fontSize: 20, fontWeight: '700' },
  stepVal: { color: '#f2e9dc', fontWeight: '700', minWidth: 80, textAlign: 'center' },
  footer: { color: '#2a3040', fontSize: 11, textAlign: 'center', marginTop: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#12171f', borderRadius: 12, padding: 16 },
  toggleLabel: { color: '#f2e9dc', fontWeight: '700', fontSize: 14 },
  toggleSub: { color: '#4a5160', fontSize: 12, marginTop: 4 },
  toggleBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  toggleBtnText: { fontWeight: '700', fontSize: 13 },
});
