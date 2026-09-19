# Wild West — Duelo (Parte 1: Sensores)

Prototipo educativo para experimentar con los sensores de movimiento del
teléfono, como base del juego de duelos del viejo oeste.

Esta primera parte cubre solo el trabajo de la **Persona 1**: detectar el
gesto de "desenfunde" (sacar el teléfono del bolsillo y dejarlo perpendicular)
usando el acelerómetro y el giroscopio, con una pantalla de depuración que
muestra las lecturas en vivo.

## Cómo correrlo

```bash
npm install
npx expo start
```

Escanea el QR con la app **Expo Go** en tu teléfono. Los sensores **no
funcionan en el emulador/simulador**, hace falta un dispositivo físico.

## Qué hace esta pantalla

- Lee `DeviceMotion` (aceleración + rotación) a ~30Hz.
- Calcula la magnitud del vector de aceleración (incluye gravedad, en reposo
  ronda ~9.8 m/s²) para detectar el "golpe" de sacar el teléfono.
- Calcula el ángulo de inclinación (`rotation.beta`, convertido a grados)
  para saber si el teléfono llegó a la posición "perpendicular".
- Trae una **máquina de estados** simple: `reposo → movimiento → completado`
  (o `fallido` si no se llega a tiempo), con el tiempo de reacción en
  milisegundos.
- Incluye **calibración manual**: toca "Calibrar reposo" con el teléfono en
  la posición de bolsillo, y "Calibrar objetivo" con el teléfono apuntando al
  frente. Cada persona/bolsillo es distinto, así que esto es clave para que
  la detección tenga sentido.
- Umbrales ajustables en vivo (magnitud, ventana de tiempo, tolerancia de
  ángulo) para poder experimentar sin tocar código.
- Gráfica de barras simple con el historial de magnitud reciente, para
  visualizar el pico del movimiento.

## Siguientes partes (no incluidas aún)

- **Persona 2**: backend/salas para conectar dos teléfonos en tiempo real y
  sincronizar el inicio del duelo.
- **Persona 3**: UI final, audio ambiente y sonido de inicio, integración de
  las dos piezas anteriores.
