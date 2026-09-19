# Wild West — Duelo Multijugador

Juego de duelos del viejo oeste para dos jugadores en tiempo real. Cada jugador pone su teléfono en el bolsillo, espera la señal de disparo y saca el teléfono lo más rápido posible — el más rápido gana.

## Requisitos

- Node.js 18+
- Expo Go instalado en dos teléfonos físicos (iOS o Android)
- Ambos teléfonos y la laptop en la **misma red WiFi**

## Cómo correrlo

**1. Instalar dependencias:**

```bash
npm install
cd server && npm install && cd ..
```

**2. Iniciar el servidor local** (en una terminal):

```bash
cd server
node index.js
```

El servidor imprime su IP local al arrancar, por ejemplo `http://192.168.1.x:3001`.

**3. Configurar la IP en el cliente:**

Edita `src/config.ts` y pon la IP que imprimió el servidor:

```ts
export const SERVER_URL = 'http://192.168.1.x:3001';
```

**4. Iniciar la app** (en otra terminal):

```bash
npx expo start
```

Escanea el QR con Expo Go en ambos teléfonos. Los sensores **no funcionan en emulador**, se necesita dispositivo físico.

## Cómo jugar

1. Ambos jugadores tocan **JUGAR** e ingresan el mismo código de sala.
2. Se realiza una calibración automática de 3 segundos (el teléfono debe estar en el bolsillo).
3. Comienza el stare-off con sonido ambiente. En algún momento entre 3 y 10 segundos suena la señal.
4. Al escuchar la señal, saca el teléfono rápidamente hasta dejarlo perpendicular.
5. La pantalla muestra quién ganó y el tiempo de reacción de cada jugador.

## Calibración

Desde el menú principal → **Calibrar**:

- **Calibración automática** (por defecto): el juego calibra el ángulo de reposo al inicio de cada ronda. Recomendado si el bolsillo cambia entre partidas.
- **Calibración guardada**: captura los ángulos manualmente una vez y los reutiliza. Actívala con el toggle en la parte superior de la pantalla de calibración para saltarse los 3 segundos de calibración al inicio de cada ronda.

Los valores se guardan en el dispositivo con AsyncStorage.

## Arquitectura

```
wildwest/
├── src/
│   ├── app/
│   │   ├── _layout.tsx       # Stack navigator
│   │   ├── index.tsx         # Menú principal
│   │   ├── game.tsx          # Pantalla de juego (lógica principal)
│   │   └── calibration.tsx   # Pantalla de calibración
│   ├── hooks/
│   │   └── useCalibration.ts # Persistencia de calibración (AsyncStorage)
│   └── config.ts             # URL del servidor
├── server/
│   └── index.js              # Servidor Express + Socket.io
└── assets/sounds/            # Sonidos del juego (ambient, signal, gunshot)
```

### Sincronización de tiempo

Para que la señal suene al mismo instante en ambos teléfonos se usa un ajuste de reloj estilo NTP: el cliente mide la diferencia entre su reloj y el del servidor con 7 pings y selecciona la muestra de menor latencia. El servidor envía `signalAt` y `calibEndAt` como timestamps absolutos; cada cliente los convierte a su hora local con el offset medido.

### Detección de gesto

Un único listener de `DeviceMotion` entrega aceleración y rotación a ~30Hz. La máquina de estados (`idle → calibrating → standby → draw → result`) corre sobre refs, no sobre estado de React, para evitar closures obsoletos en el callback del sensor.
