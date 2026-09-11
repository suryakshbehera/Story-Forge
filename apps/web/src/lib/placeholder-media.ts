import zlib from "zlib";

// Hand-rolled, dependency-free encoders for the demo project's placeholder
// assets — no image/audio library exists anywhere in this monorepo, and
// pulling one in just to draw a flat-color square or a short tone would be
// disproportionate. Node's built-in `zlib` covers PNG's IDAT compression;
// WAV needs no compression at all.

// Standard reflected CRC-32 (poly 0xEDB88320) — the algorithm PNG/zlib/gzip
// all use for chunk checksums.
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

// A flat-color placeholder image — one shot "image" for the demo project.
export function makePlaceholderPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// A short, quiet sine-wave tone — one narration "audio take" for the demo
// project. Audible (not silent) so scrubbing the player visibly shows
// waveform/playback, without needing real narration content.
export function makePlaceholderWav(durationSeconds: number, freqHz = 440): Buffer {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2; // 16-bit mono

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  const data = Buffer.alloc(dataSize);
  // Fade in/out over the first/last 10% to avoid an audible click at the
  // clip boundaries.
  const fadeSamples = Math.floor(numSamples * 0.1);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let amplitude = 0.15;
    if (i < fadeSamples) amplitude *= i / fadeSamples;
    else if (i > numSamples - fadeSamples) amplitude *= (numSamples - i) / fadeSamples;
    const sample = Math.sin(2 * Math.PI * freqHz * t) * amplitude * 32767;
    data.writeInt16LE(Math.round(sample), i * 2);
  }

  return Buffer.concat([header, data]);
}
