// Web Audio Synthesizer for retail counter sound effects
// 100% zero external audio files, zero network latency, and works offline.

let audioCtx: AudioContext | null = null;
let soundEnabled = true;

export function setCounterSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  try {
    localStorage.setItem("ds_counter_sound_enabled", enabled ? "true" : "false");
  } catch {}
}

export function isCounterSoundEnabled(): boolean {
  try {
    const saved = localStorage.getItem("ds_counter_sound_enabled");
    if (saved !== null) return saved === "true";
  } catch {}
  return soundEnabled;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Clean 1760Hz POS barcode gun pip (like Honeywell / Zebra scanner beep)
 */
export function playScanPip() {
  if (!isCounterSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1760, ctx.currentTime);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (e) {
    console.debug("Audio playScanPip skipped", e);
  }
}

/**
 * Paytm / PhonePe Soundbox style melodious 4-note ascending chord
 * + Optional Indian voice announcement: "₹[amount] received!"
 */
export function playPaymentChime(amount?: number) {
  if (!isCounterSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    // 4 harmonic frequencies: C5 (523Hz), E5 (659Hz), G5 (784Hz), C6 (1046Hz)
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const startTime = ctx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.09);

      gain.gain.setValueAtTime(0.15, startTime + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + idx * 0.09 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + idx * 0.09);
      osc.stop(startTime + idx * 0.09 + 0.36);
    });

    // Optional voice prompt if amount is provided and SpeechSynthesis is available
    if (amount && amount > 0 && typeof window !== "undefined" && "speechSynthesis" in window) {
      setTimeout(() => {
        try {
          const utterance = new SpeechSynthesisUtterance(`Payment received, ₹${Math.round(amount)} rupees`);
          utterance.rate = 1.05;
          utterance.pitch = 1.1;
          window.speechSynthesis.speak(utterance);
        } catch {}
      }, 500);
    }
  } catch (e) {
    console.debug("Audio playPaymentChime skipped", e);
  }
}

/**
 * Soft dual latch tone for Hold/Park cart action
 */
export function playHoldTone() {
  if (!isCounterSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch (e) {}
}

/**
 * Two-tone warning beep for low stock or rejected actions
 */
export function playAlertTone() {
  if (!isCounterSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(330, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.23);
  } catch (e) {}
}
