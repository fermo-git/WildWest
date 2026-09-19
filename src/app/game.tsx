import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { DeviceMotion } from 'expo-sensors';
import { io, Socket } from 'socket.io-client';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { useCalibration } from '../hooks/useCalibration';
import { SERVER_URL } from '../config';

// ────────────────────────────────────────────────────────────────
// Máquina de estados del duelo:
//
//  idle → connecting → waiting → calibrating → standby → draw → waiting_result
//                                                                      ↓
//                                                                   result
//
// false_start / opponent_false_start son estados terminales de ronda.
// ────────────────────────────────────────────────────────────────

type GS =
  | 'idle' | 'connecting' | 'waiting'
  | 'calibrating' | 'standby' | 'draw'
  | 'waiting_result' | 'result'
  | 'false_start' | 'opponent_false_start';

type RoundResult = {
  outcome: 'won' | 'lost' | 'tie' | 'nobody';
  myTime: number | null;
  opponentTime: number | null;
};

const UPDATE_MS = 33;
const CALIB_MS = 3000;
const MIN_CALIB_SAMPLES = 5;

export default function GameScreen() {
  const { data: cal } = useCalibration();

  const [gs, setGs] = useState<GS>('idle');
  const [roomCode, setRoomCode] = useState('');
  const [serverUrl, setServerUrl] = useState(SERVER_URL);
  const [playerCount, setPlayerCount] = useState(0);
  const [calibProg, setCalibProg] = useState(0);
  const [reactionMs, setReactionMs] = useState<number | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [waitingPlayAgain, setWaitingPlayAgain] = useState(false);

  // Refs para acceso en callbacks sin stale closures
  const gsRef = useRef<GS>('idle');
  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef('');

  const calibSamples = useRef<number[]>([]);
  const drawStartRef = useRef<number | null>(null);
  const phaseRef = useRef<'reposo' | 'movimiento'>('reposo');
  const myDrawTimeRef = useRef<number | null>(null);
  const opponentDrawTimeRef = useRef<number | null>(null);

  const calRef = useRef(cal);
  useEffect(() => { calRef.current = cal; }, [cal]);

  // Offset reloj servidor: serverTime = Date.now() + serverOffsetRef.current
  // Se mide con varios pings al conectar para compensar latencia asimétrica.
  const serverOffsetRef = useRef(0);

  // Timers
  const calibTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preSignalTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // para parar ambient antes de la señal
  const resultTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sonidos con expo-audio (disponible en Expo Go SDK 57+)
  const players = useRef<{ ambient: AudioPlayer | null; signal: AudioPlayer | null; gunshot: AudioPlayer | null }>({
    ambient: null, signal: null, gunshot: null,
  });

  useEffect(() => {
    try {
      setAudioModeAsync({ playsInSilentMode: true });
      players.current.ambient = createAudioPlayer(require('../../assets/sounds/ambient.wav'));
      players.current.signal  = createAudioPlayer(require('../../assets/sounds/signal.wav'));
      players.current.gunshot = createAudioPlayer(require('../../assets/sounds/gunshot.wav'));
    } catch {}
    return () => {
      try { players.current.ambient?.remove(); } catch {}
      try { players.current.signal?.remove(); } catch {}
      try { players.current.gunshot?.remove(); } catch {}
    };
  }, []);

  const playSound = useCallback((key: 'ambient' | 'signal' | 'gunshot', loop = false) => {
    try {
      const p = players.current[key];
      if (!p) return;
      p.loop = loop;
      p.seekTo(0);
      p.play();
    } catch {}
  }, []);

  const stopSound = useCallback((key: 'ambient' | 'signal' | 'gunshot') => {
    try { players.current[key]?.pause(); } catch {}
  }, []);

  function clearTimers() {
    if (calibTimer.current)    { clearTimeout(calibTimer.current);    calibTimer.current = null; }
    if (signalTimer.current)   { clearTimeout(signalTimer.current);   signalTimer.current = null; }
    if (preSignalTimer.current){ clearTimeout(preSignalTimer.current); preSignalTimer.current = null; }
    if (resultTimer.current)   { clearTimeout(resultTimer.current);   resultTimer.current = null; }
    if (progressInterval.current) { clearInterval(progressInterval.current); progressInterval.current = null; }
  }

  function setState(s: GS) {
    gsRef.current = s;
    setGs(s);
  }

  // ── Lógica de resultado ──
  const showResult = useCallback((myTime: number | null, opponentTime: number | null) => {
    clearTimers();
    stopSound('ambient');
    let outcome: RoundResult['outcome'];
    if (myTime === null && opponentTime === null) outcome = 'nobody';
    else if (myTime === null) outcome = 'lost';
    else if (opponentTime === null) outcome = 'won';
    else outcome = myTime < opponentTime ? 'won' : myTime > opponentTime ? 'lost' : 'tie';
    setRoundResult({ outcome, myTime, opponentTime });
    setState('result');
  }, [stopSound]);

  const showResultRef = useRef(showResult);
  useEffect(() => { showResultRef.current = showResult; }, [showResult]);

  // ── Sincronización de reloj con el servidor (NTP simplificado) ──
  // offset = serverTime - clientTime
  // Se hacen 5 pings y se toma la mediana para descartar outliers.
  const measureServerOffset = useCallback((socket: Socket): Promise<number> => {
    return new Promise(resolve => {
      const fallback = setTimeout(() => {
        socket.off('pong_time');
        resolve(0);
      }, 3000);

      const samples: Array<{ offset: number; rtt: number }> = [];
      let pending = 7; // más muestras → mejor estimación

      const onPong = ({ t0: sentT0, t1 }: { t0: number; t1: number }) => {
        const t2 = Date.now();
        const rtt = t2 - sentT0;
        const offset = t1 - (sentT0 + t2) / 2;
        samples.push({ offset, rtt });
        pending--;
        if (pending > 0) {
          setTimeout(doPing, 20);
        } else {
          clearTimeout(fallback);
          // Min-RTT: el ping más simétrico da el offset más preciso
          const best = samples.reduce((a, b) => (a.rtt < b.rtt ? a : b));
          resolve(best.offset);
        }
      };

      const doPing = () => {
        const t0 = Date.now();
        socket.emit('ping_time', { t0 });
        socket.once('pong_time', onPong);
      };
      doPing();
    });
  }, []);

  // ── Conexión ──
  const connect = useCallback(() => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    roomRef.current = code;
    setState('connecting');

    const socket = io(serverUrl, { transports: ['websocket'], timeout: 5000 });
    socketRef.current = socket;

    socket.on('connect', async () => {
      // Medir offset antes de unirse, para tenerlo listo cuando llegue round_start
      serverOffsetRef.current = await measureServerOffset(socket);
      socket.emit('join_room', { roomCode: code });
      setState('waiting');
    });

    socket.on('connect_error', () => {
      socket.disconnect();
      socketRef.current = null;
      setState('idle');
    });

    socket.on('room_update', ({ count }: { count: number }) => setPlayerCount(count));

    socket.on('round_start', ({ signalAt, calibEndAt }: { signalAt: number; calibEndAt: number }) => {
      myDrawTimeRef.current = null;
      opponentDrawTimeRef.current = null;
      phaseRef.current = 'reposo';
      calibSamples.current = [];
      drawStartRef.current = null;
      setCalibProg(0);
      setReactionMs(null);
      setWaitingPlayAgain(false);

      // Convertir timestamps del servidor a hora local de este dispositivo
      const offset = serverOffsetRef.current;
      const localCalibEnd  = calibEndAt - offset;
      const localSignalTime = signalAt  - offset;

      const enterStandby = () => {
        playSound('ambient', true);
        setState('standby');

        const remaining = Math.max(0, localSignalTime - Date.now());

        // Parar el ambient 80ms antes de la señal para que el sistema de audio
        // no tenga que procesar stop+play en el mismo instante.
        const preStopMs = Math.max(0, remaining - 80);
        preSignalTimer.current = setTimeout(() => {
          stopSound('ambient');
        }, preStopMs);

        signalTimer.current = setTimeout(() => {
          // playSound hace seekTo(0) + play() atómicamente — no se pre-seek
          // fuera del timer porque seekTo puede reactivar playback en expo-audio.
          playSound('signal', false);
          phaseRef.current = 'reposo';
          drawStartRef.current = null;
          setState('draw');
        }, remaining);
      };

      // Ambos dispositivos pasan siempre por 'calibrating' hasta localCalibEnd.
      // Esto garantiza que ninguno tenga detección de salida en falso durante
      // la ventana de calibración del otro, sin importar su configuración.
      setState('calibrating');
      const calibDuration = Math.max(200, localCalibEnd - Date.now());

      // Barra de progreso en ambos modos (en skip muestra "esperando al otro")
      const calibStart = Date.now();
      progressInterval.current = setInterval(() => {
        setCalibProg(Math.min(1, (Date.now() - calibStart) / calibDuration));
      }, 100);

      calibTimer.current = setTimeout(() => {
        if (progressInterval.current) { clearInterval(progressInterval.current); progressInterval.current = null; }
        setCalibProg(1);
        if (!calRef.current.skipAutoCalibration) {
          const samples = calibSamples.current;
          if (samples.length >= MIN_CALIB_SAMPLES) {
            calRef.current = { ...calRef.current, restAngle: samples.reduce((a, b) => a + b, 0) / samples.length };
          }
        }
        enterStandby();
      }, calibDuration);
    });

    socket.on('player_drew', ({ playerId, timeMs }: { playerId: string; timeMs: number }) => {
      if (playerId === socket.id) return;
      opponentDrawTimeRef.current = timeMs;
      const mine = myDrawTimeRef.current;
      if (mine !== null) {
        showResultRef.current(mine, timeMs);
      } else if (gsRef.current === 'waiting_result') {
        showResultRef.current(null, timeMs);
      }
      // Si aún estamos en draw, cuando completemos el gesto compararemos
    });

    socket.on('player_false_start', ({ playerId }: { playerId: string }) => {
      if (playerId === socket.id) return;
      clearTimers();
      stopSound('ambient');
      setState('opponent_false_start');
    });

    socket.on('round_result', ({ winnerId, times }: { winnerId: string | null; times: Record<string, number> }) => {
      const myTime = socket.id ? (times[socket.id] ?? null) : null;
      const opponentId = Object.keys(times).find(id => id !== socket.id);
      const opponentTime = opponentId !== undefined ? (times as Record<string, number>)[opponentId] : null;
      showResultRef.current(myTime, opponentTime);
    });

    socket.on('waiting_play_again', () => setWaitingPlayAgain(true));

    socket.on('opponent_left', () => {
      clearTimers();
      stopSound('ambient');
      setPlayerCount(0);
      setState('waiting');
    });
  }, [roomCode, serverUrl, playSound, stopSound]);

  const disconnect = useCallback(() => {
    clearTimers();
    stopSound('ambient');
    socketRef.current?.disconnect();
    socketRef.current = null;
    setState('idle');
    setPlayerCount(0);
    setRoundResult(null);
    setReactionMs(null);
    setWaitingPlayAgain(false);
  }, [stopSound]);

  const handleDraw = useCallback((elapsed: number) => {
    myDrawTimeRef.current = elapsed;
    setReactionMs(elapsed);
    playSound('gunshot', false);
    socketRef.current?.emit('drew', { roomCode: roomRef.current, timeMs: elapsed });
    setState('waiting_result');

    const opponentTime = opponentDrawTimeRef.current;
    if (opponentTime !== null) {
      showResultRef.current(elapsed, opponentTime);
    } else {
      // Esperamos respuesta del oponente con timeout de seguridad
      resultTimer.current = setTimeout(() => {
        showResultRef.current(elapsed, null);
      }, 5000);
    }
  }, [playSound]);

  const handleFalseStart = useCallback(() => {
    clearTimers();
    stopSound('ambient');
    socketRef.current?.emit('false_start', { roomCode: roomRef.current });
    setState('false_start');
  }, [stopSound]);

  const handleDrawRef = useRef(handleDraw);
  const handleFalseStartRef = useRef(handleFalseStart);
  useEffect(() => { handleDrawRef.current = handleDraw; }, [handleDraw]);
  useEffect(() => { handleFalseStartRef.current = handleFalseStart; }, [handleFalseStart]);

  // ── Suscripción al sensor ──
  const sensorActive = ['calibrating', 'standby', 'draw'].includes(gs);

  useEffect(() => {
    if (!sensorActive) return;
    DeviceMotion.setUpdateInterval(UPDATE_MS);
    const sub = DeviceMotion.addListener((d) => {
      const g = d.accelerationIncludingGravity;
      const rot = d.rotation;
      if (!g || !rot) return;
      const mag = Math.sqrt(g.x ** 2 + g.y ** 2 + g.z ** 2);
      const ang = (rot.beta * 180) / Math.PI;
      const c = calRef.current;
      const state = gsRef.current;

      if (state === 'calibrating') {
        // Nunca hay salida en falso durante la ventana de calibración,
        // sin importar si este dispositivo calibra o usa la guardada.
        if (!calRef.current.skipAutoCalibration) calibSamples.current.push(ang);
        return;
      }

      if (state === 'standby') {
        if (mag > c.threshold) handleFalseStartRef.current();
        return;
      }

      if (state === 'draw') {
        const now = Date.now();

        if (phaseRef.current === 'reposo') {
          if (mag <= c.threshold) return;
          const rest = c.restAngle;
          const inZone = rest === null || Math.abs(ang - rest) <= c.restTolerance;
          if (inZone) {
            drawStartRef.current = now;
            phaseRef.current = 'movimiento';
          }
          return;
        }

        if (phaseRef.current === 'movimiento') {
          const start = drawStartRef.current ?? now;
          const elapsed = now - start;
          const target = c.targetAngle;
          const reached = target !== null && Math.abs(ang - target) <= c.angleTolerance;

          if (reached) {
            phaseRef.current = 'reposo'; // evitar re-trigger
            handleDrawRef.current(elapsed);
          } else if (elapsed > c.timeWindowMs) {
            // Falló la ventana de gesto, resetear y dejar intentar de nuevo
            phaseRef.current = 'reposo';
            drawStartRef.current = null;
          }
        }
      }
    });
    return () => sub.remove();
  }, [sensorActive]);

  // Cleanup al desmontar
  useEffect(() => () => {
    clearTimers();
    socketRef.current?.disconnect();
    stopSound('ambient');
  }, [stopSound]);

  const playAgain = () => {
    setRoundResult(null);
    setReactionMs(null);
    socketRef.current?.emit('play_again', { roomCode: roomRef.current });
  };

  // ──────────────────── RENDER ────────────────────

  if (gs === 'idle' || gs === 'connecting') {
    return (
      <View style={st.container}>
        <Pressable style={st.back} onPress={() => router.back()}>
          <Text style={st.backText}>← Volver</Text>
        </Pressable>
        <View style={st.center}>
          <Text style={st.screenTitle}>Unirse a sala</Text>
          <Text style={st.hint}>Ambos jugadores escriben el mismo código</Text>
          <TextInput
            style={st.codeInput}
            value={roomCode}
            onChangeText={t => setRoomCode(t.toUpperCase())}
            placeholder="Ej: DUELO"
            placeholderTextColor="#2a3040"
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Text style={st.hint}>URL del servidor</Text>
          <TextInput
            style={[st.codeInput, { fontSize: 13 }]}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[st.actionBtn, { backgroundColor: roomCode.trim() ? '#e0a63e' : '#1e2530' }]}
            onPress={connect}
            disabled={!roomCode.trim() || gs === 'connecting'}
          >
            <Text style={st.actionText}>
              {gs === 'connecting' ? 'Conectando…' : 'Unirse'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (gs === 'waiting') {
    return (
      <View style={st.container}>
        <View style={st.center}>
          <Text style={[st.codeDisplay]}>{roomRef.current}</Text>
          <Text style={st.phaseLabel}>
            {playerCount < 2 ? 'Esperando al oponente…' : 'Preparando ronda…'}
          </Text>
          <Text style={st.hint}>{playerCount}/2 jugadores</Text>
          {waitingPlayAgain && <Text style={st.hint}>Esperando que el oponente confirme…</Text>}
          <Pressable style={st.secondaryBtn} onPress={disconnect}>
            <Text style={st.secondaryText}>Salir de la sala</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (gs === 'calibrating') {
    const skipping = cal.skipAutoCalibration;
    return (
      <View style={st.container}>
        <View style={st.center}>
          <Text style={st.phaseLabel}>{skipping ? 'Listo…' : 'Calibrando…'}</Text>
          <Text style={st.hint}>
            {skipping
              ? 'Esperando que el otro dispositivo calibre…'
              : 'Quieto, con el teléfono en el bolsillo'}
          </Text>
          <View style={st.progressTrack}>
            <View style={[st.progressFill, { width: `${calibProg * 100}%` }]} />
          </View>
        </View>
      </View>
    );
  }

  if (gs === 'standby') {
    return (
      <View style={[st.container, { backgroundColor: '#0a0c10' }]}>
        <View style={st.center}>
          <Text style={{ fontSize: 48, color: '#1e2530', fontWeight: '900' }}>• • •</Text>
          <Text style={st.hint}>No te muevas. Espera la señal.</Text>
        </View>
      </View>
    );
  }

  if (gs === 'draw') {
    return (
      <View style={[st.container, { backgroundColor: '#1a0800' }]}>
        <View style={st.center}>
          <Text style={st.drawText}>¡DESENFUNDA!</Text>
        </View>
      </View>
    );
  }

  if (gs === 'waiting_result') {
    return (
      <View style={st.container}>
        <View style={st.center}>
          <Text style={st.phaseLabel}>{reactionMs} ms</Text>
          <Text style={st.hint}>Esperando resultado del oponente…</Text>
        </View>
      </View>
    );
  }

  if (gs === 'false_start') {
    return (
      <View style={[st.container, { backgroundColor: '#150000' }]}>
        <View style={st.center}>
          <Text style={st.falseText}>SALIDA EN FALSO</Text>
          <Text style={st.hint}>Te moviste antes de la señal</Text>
          <Pressable style={st.actionBtn} onPress={() => { setState('waiting'); setWaitingPlayAgain(false); }}>
            <Text style={st.actionText}>Reintentar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (gs === 'opponent_false_start') {
    return (
      <View style={[st.container, { backgroundColor: '#001200' }]}>
        <View style={st.center}>
          <Text style={st.wonText}>¡GANASTE!</Text>
          <Text style={st.hint}>El oponente hizo salida en falso</Text>
          <Pressable style={st.actionBtn} onPress={playAgain}>
            <Text style={st.actionText}>Jugar de nuevo</Text>
          </Pressable>
          <Pressable style={st.secondaryBtn} onPress={disconnect}>
            <Text style={st.secondaryText}>Salir</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (gs === 'result' && roundResult) {
    const { outcome, myTime, opponentTime } = roundResult;
    const won = outcome === 'won';
    return (
      <View style={[st.container, { backgroundColor: won ? '#001200' : '#150000' }]}>
        <View style={st.center}>
          <Text style={won ? st.wonText : st.lostText}>
            {outcome === 'won' ? '¡GANASTE!'
              : outcome === 'lost' ? 'PERDISTE'
              : outcome === 'tie' ? 'EMPATE'
              : 'NINGUNO DESENFUNDÓ'}
          </Text>
          {myTime !== null && (
            <Text style={st.timeText}>Tu tiempo: <Text style={{ fontWeight: '900' }}>{myTime} ms</Text></Text>
          )}
          {opponentTime !== null && (
            <Text style={st.opponentTimeText}>Oponente: {opponentTime} ms</Text>
          )}
          <View style={st.resultBtns}>
            <Pressable style={st.actionBtn} onPress={playAgain}>
              <Text style={st.actionText}>Jugar de nuevo</Text>
            </Pressable>
            <Pressable style={st.secondaryBtn} onPress={disconnect}>
              <Text style={st.secondaryText}>Salir</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return null;
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  back: { position: 'absolute', top: 60, left: 24, zIndex: 10 },
  backText: { color: '#4a5160', fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 16 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#f2e9dc', marginBottom: 8 },
  hint: { color: '#4a5160', fontSize: 13, textAlign: 'center' },
  codeInput: {
    width: '100%', backgroundColor: '#12171f', borderRadius: 10,
    padding: 16, fontSize: 20, fontWeight: '700', color: '#f2e9dc',
    textAlign: 'center', letterSpacing: 4, marginBottom: 4,
  },
  actionBtn: {
    width: '100%', backgroundColor: '#e0a63e', paddingVertical: 18,
    borderRadius: 12, alignItems: 'center',
  },
  actionText: { fontSize: 17, fontWeight: '800', color: '#0d1117' },
  secondaryBtn: { paddingVertical: 12, paddingHorizontal: 24 },
  secondaryText: { color: '#4a5160', fontWeight: '600' },
  codeDisplay: { fontSize: 32, fontWeight: '900', color: '#e0a63e', letterSpacing: 8 },
  phaseLabel: { fontSize: 20, fontWeight: '700', color: '#f2e9dc', textAlign: 'center' },
  progressTrack: { width: '80%', height: 8, borderRadius: 4, backgroundColor: '#1e2530', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#e0a63e' },
  drawText: { fontSize: 42, fontWeight: '900', color: '#e0a63e', letterSpacing: 4, textAlign: 'center' },
  falseText: { fontSize: 28, fontWeight: '900', color: '#e05353', textAlign: 'center' },
  wonText: { fontSize: 36, fontWeight: '900', color: '#3ecf6a', textAlign: 'center' },
  lostText: { fontSize: 36, fontWeight: '900', color: '#e05353', textAlign: 'center' },
  timeText: { fontSize: 20, color: '#f2e9dc', textAlign: 'center' },
  opponentTimeText: { fontSize: 15, color: '#4a5160', textAlign: 'center' },
  resultBtns: { width: '100%', gap: 10, marginTop: 16 },
});
