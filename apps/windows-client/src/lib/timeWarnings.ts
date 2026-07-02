let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(ctx: AudioContext, frequency: number, start: number, duration: number, volume = 0.18) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

/** Short tone pattern when time is running low. */
export function playWarningTone(level: '5min' | '1min'): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const t = ctx.currentTime;
  if (level === '5min') {
    beep(ctx, 523, t, 0.2);
    beep(ctx, 523, t + 0.35, 0.2);
  } else {
    beep(ctx, 784, t, 0.12, 0.22);
    beep(ctx, 784, t + 0.18, 0.12, 0.22);
    beep(ctx, 784, t + 0.36, 0.12, 0.22);
  }
}

export const LOW_TIME_WARN_5_MIN = 5 * 60;
export const LOW_TIME_WARN_1_MIN = 60;

export type LowTimeLevel = 'none' | '5min' | '1min';

export function lowTimeLevel(remainingSeconds: number): LowTimeLevel {
  if (remainingSeconds <= 0) return 'none';
  if (remainingSeconds <= LOW_TIME_WARN_1_MIN) return '1min';
  if (remainingSeconds <= LOW_TIME_WARN_5_MIN) return '5min';
  return 'none';
}

export function lowTimeMessage(level: LowTimeLevel): string {
  if (level === '1min') return '1 minute left — ask staff to add more time!';
  if (level === '5min') return '5 minutes left — ask staff to add more time.';
  return '';
}
