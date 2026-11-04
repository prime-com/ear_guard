import { blockDc, blockRmsDbfs } from "../core/calibration";

/** Opens a mic with all voice processing switched off and reports what the browser actually applied. */
export interface Mic {
  label: string;
  settings: MediaTrackSettings;
  /** performance.now() when the mic was opened; the analyser buffer is only full ~170 ms later. */
  openedAt: number;
  readDbfs(): number;
  readPeak(): number;
  /** DC offset of the last block read (fraction of full scale). */
  readDc(): number;
  close(): void;
}

export async function openMic(ctx: AudioContext, deviceId?: string): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  const track = stream.getAudioTracks()[0];
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192; // ~170 ms at 48 kHz
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  return {
    label: track.label,
    settings: track.getSettings(),
    openedAt: performance.now(),
    readDbfs() {
      analyser.getFloatTimeDomainData(buf);
      return blockRmsDbfs(buf);
    },
    readDc() {
      return blockDc(buf);
    },
    readPeak() {
      let p = 0;
      for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
      return p;
    },
    close() {
      src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
