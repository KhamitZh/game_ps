const STORE_KEY = 'kh.muted';
let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
})();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(STORE_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
}

/** Must be called from a user gesture once, so mobile browsers allow sound. */
export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, delay = 0, slideTo?: number): void {
  if (muted) return;
  unlockAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  step: () => tone(140, 0.05, 'triangle', 0.025),
  beep: () => tone(520, 0.14),
  go: () => {
    tone(784, 0.12);
    tone(1046, 0.3, 'square', 0.06, 0.1);
  },
  key: () => [880, 1175, 1568].forEach((f, i) => tone(f, 0.14, 'square', 0.05, i * 0.07)),
  wrong: () => tone(260, 0.35, 'sawtooth', 0.05, 0, 90),
  unlock: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 'triangle', 0.06, i * 0.08)),
  fanfare: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.18, 'square', 0.05, i * 0.12)),
  open: () => tone(330, 0.08, 'triangle', 0.05, 0, 660),
};
