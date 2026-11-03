/** Test-signal generators (all made in code, no audio files / licensing). */

export type SignalKind = "sine" | "pink" | "sweep";

const dbfsToPeak = (dbfs: number) => 10 ** (dbfs / 20);

export interface PlayingSignal {
  stop(): void;
  setLevel(dbfs: number): void;
}

/** Pink noise buffer (Paul Kellet filter) normalised so its RMS equals `dbfs` (AES17). */
function pinkBuffer(ctx: BaseAudioContext, seconds = 4): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    sum += d[i] * d[i];
  }
  // Normalise to RMS = 1/√2 (i.e. 0 dBFS AES17); gain node then sets the level.
  const scale = Math.SQRT1_2 / Math.sqrt(sum / n);
  for (let i = 0; i < n; i++) d[i] *= scale;
  return buf;
}

export function playSignal(ctx: AudioContext, kind: SignalKind, dbfs: number, freq = 1000): PlayingSignal {
  const gain = ctx.createGain();
  gain.gain.value = dbfsToPeak(dbfs);
  gain.connect(ctx.destination);
  let src: AudioScheduledSourceNode;

  if (kind === "pink") {
    const s = ctx.createBufferSource();
    s.buffer = pinkBuffer(ctx);
    s.loop = true;
    src = s;
  } else {
    const o = ctx.createOscillator();
    o.type = "sine";
    if (kind === "sweep") {
      const t = ctx.currentTime;
      o.frequency.setValueAtTime(100, t);
      o.frequency.exponentialRampToValueAtTime(10000, t + 5);
      o.stop(t + 5);
    } else {
      o.frequency.value = freq;
    }
    src = o;
  }
  src.connect(gain);
  src.start();
  return {
    stop() {
      try { src.stop(); } catch { /* already stopped */ }
      gain.disconnect();
    },
    setLevel(db: number) {
      gain.gain.setTargetAtTime(dbfsToPeak(db), ctx.currentTime, 0.02);
    },
  };
}
