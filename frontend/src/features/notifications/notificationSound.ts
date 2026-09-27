const MUTE_STORAGE_KEY = 'internal-ops-notification-sound-muted';

let audioContext: AudioContext | null = null;

export function isSoundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export const SOUND_PREFERENCE_EVENT = 'internal-ops-sound-preference';

export function setSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
  } catch {
    // Preference just won't persist.
  }
  // Lets every open control (bell, settings) show the same value.
  window.dispatchEvent(new Event(SOUND_PREFERENCE_EVENT));
}

// Soft two-note chime synthesised with the Web Audio API, so no audio file is needed.
export function playNotificationChime(): void {
  try {
    audioContext ??= new AudioContext();
    // Browsers suspend audio until the user has interacted with the page; signing in counts.
    void audioContext.resume();

    const start = audioContext.currentTime;
    playTone(audioContext, 880, start, 0.18);
    playTone(audioContext, 1318.5, start + 0.14, 0.32);
  } catch {
    // Audio unavailable (unsupported browser or blocked); the badge still shows the notification.
  }
}

function playTone(context: AudioContext, frequency: number, startAt: number, duration: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.05);
}
