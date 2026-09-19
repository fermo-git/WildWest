const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// rooms: Map<code, { players: [{id}], drawTimes: {id: ms}, playAgain: Set<id> }>
const rooms = new Map();

const CALIB_MS = 3000;
const MIN_WAIT_MS = 3000;
const MAX_WAIT_MS = 10000;
const RESULT_TIMEOUT_MS = 5000; // espera máx al segundo jugador antes de declarar ganador

function getOrCreate(code) {
  if (!rooms.has(code)) rooms.set(code, { players: [], drawTimes: {}, playAgain: new Set(), roundTimer: null });
  return rooms.get(code);
}

function leaveRoom(socket, code) {
  const room = rooms.get(code);
  if (!room) return;
  room.players = room.players.filter(p => p.id !== socket.id);
  if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
  if (room.players.length === 0) {
    rooms.delete(code);
  } else {
    io.to(code).emit('opponent_left');
    room.drawTimes = {};
    room.playAgain.clear();
  }
}

function startRound(code) {
  const room = rooms.get(code);
  if (!room || room.players.length < 2) return;
  room.drawTimes = {};
  room.playAgain.clear();

  // signalAt es un timestamp absoluto del servidor.
  // Ambos clientes lo convierten a su hora local usando su offset medido,
  // así la señal suena al mismo instante real en los dos teléfonos.
  const now = Date.now();
  const calibEndAt = now + CALIB_MS;
  const signalAt = calibEndAt + MIN_WAIT_MS + Math.floor(Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS));
  const waitMs = signalAt - now;
  io.to(code).emit('round_start', { signalAt, calibEndAt });

  room.roundTimer = setTimeout(() => {
    const r = rooms.get(code);
    if (!r) return;
    const ids = r.players.map(p => p.id);
    const drew = ids.filter(id => r.drawTimes[id] !== undefined);
    if (drew.length > 0 && drew.length < ids.length) {
      io.to(code).emit('round_result', { winnerId: drew[0], times: r.drawTimes });
    } else if (drew.length === 0) {
      io.to(code).emit('round_result', { winnerId: null, times: {} });
    }
    r.drawTimes = {};
  }, waitMs + RESULT_TIMEOUT_MS);
}

io.on('connection', (socket) => {
  let currentRoom = null;

  // Ping para medir el offset de reloj cliente↔servidor (tipo NTP simplificado)
  socket.on('ping_time', ({ t0 }) => {
    socket.emit('pong_time', { t0, t1: Date.now() });
  });

  socket.on('join_room', ({ roomCode }) => {
    if (currentRoom) leaveRoom(socket, currentRoom);
    currentRoom = roomCode;
    socket.join(roomCode);

    const room = getOrCreate(roomCode);
    if (!room.players.find(p => p.id === socket.id)) {
      room.players.push({ id: socket.id });
    }

    io.to(roomCode).emit('room_update', { count: room.players.length });

    if (room.players.length === 2) {
      startRound(roomCode);
    }
  });

  socket.on('drew', ({ roomCode, timeMs }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.drawTimes[socket.id] = timeMs;

    // Notifica a todos del tiempo de este jugador
    io.to(roomCode).emit('player_drew', { playerId: socket.id, timeMs });

    const ids = room.players.map(p => p.id);
    if (ids.every(id => room.drawTimes[id] !== undefined)) {
      if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
      const [p1, p2] = ids;
      const t1 = room.drawTimes[p1], t2 = room.drawTimes[p2];
      const winnerId = t1 <= t2 ? p1 : p2;
      io.to(roomCode).emit('round_result', { winnerId, times: room.drawTimes });
      room.drawTimes = {};
    }
  });

  socket.on('false_start', ({ roomCode }) => {
    io.to(roomCode).emit('player_false_start', { playerId: socket.id });
  });

  socket.on('play_again', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.playAgain.add(socket.id);
    const ids = room.players.map(p => p.id);
    if (ids.every(id => room.playAgain.has(id))) {
      startRound(roomCode);
    } else {
      socket.emit('waiting_play_again');
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) leaveRoom(socket, currentRoom);
  });
});

httpServer.listen(3001, '0.0.0.0', () => {
  console.log('🤠 Wild West server en puerto 3001');
  console.log('   Tu IP local (busca "Dirección IPv4" en ipconfig):');
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   → http://${net.address}:3001`);
      }
    }
  }
});
