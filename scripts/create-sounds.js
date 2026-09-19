// Genera archivos WAV silenciosos de placeholder.
// Reemplazalos con sonidos reales cuando estén listos.
// Uso: node scripts/create-sounds.js

const fs = require('fs');
const path = require('path');

function silentWav(durationSec) {
  const sampleRate = 22050;
  const channels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * channels * (bitsPerSample / 8);
  const buf = Buffer.alloc(44 + dataSize, 0);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);               // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  return buf;
}

const dir = path.join(__dirname, '..', 'assets', 'sounds');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const files = [
  ['ambient.wav', 4],
  ['signal.wav', 1],
  ['gunshot.wav', 1],
];

for (const [name, dur] of files) {
  const dest = path.join(dir, name);
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, silentWav(dur));
    console.log(`✓ assets/sounds/${name} creado (${dur}s silencio)`);
  } else {
    console.log(`  assets/sounds/${name} ya existe, sin cambios`);
  }
}

console.log('\nReemplaza los WAV con sonidos reales cuando estén listos.');
