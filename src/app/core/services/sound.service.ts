import { Injectable } from '@angular/core';

/**
 * A one-shot sound effect. Set `src` to swap the audio with your own:
 *  - drop a file in `public/sounds/` and point at it, e.g. '/sounds/countdown.m4a'
 *  - or paste any public URL, e.g. 'https://example.com/countdown.mp3'
 *  - or leave `src` empty ('') to use the built-in synthesized fallback so the
 *    game still has sound with no audio files present.
 */
interface SoundSource {
  /** Path under `public/` or a full public URL. Empty = synth fallback. */
  src: string;
  /** Playback volume, 0–1. */
  volume: number;
  /** Whether the sound loops. */
  loop: boolean;
}

/**
 * One background-music option. When a game starts, one of these is chosen at
 * random and looped (between `startSeconds` and `endSeconds`) until the game
 * ends. Add as many as you like — see `public/sounds/README.md`.
 */
interface BackgroundTrack {
  /** Path under `public/` (e.g. '/sounds/music/track-1.mp3') or a full URL. */
  src: string;
  /** Playback volume, 0–1. */
  volume: number;
  /** Where to start playback within the file, in seconds. */
  startSeconds: number;
  /**
   * Where to loop back to `startSeconds`, in seconds. Leave undefined (or 0)
   * to loop the whole file from `startSeconds` to its natural end.
   */
  endSeconds?: number;
}

/**
 * --- EDIT THIS to change the game's audio ---------------------------------
 *
 * countdown — plays once during the 3·2·1 pre-game countdown. The user wants
 *             the "Mario Kart" 3-second countdown here; drop that clip at
 *             public/sounds/countdown.m4a. Until then a beep plays.
 */
const SOUND_CONFIG = {
  countdown: { src: '/sounds/countdown.m4a', volume: 0.9, loop: false },
} satisfies Record<string, SoundSource>;

/**
 * Background-music pool. A random entry is picked each game and looped over
 * its [startSeconds, endSeconds] window. Add files to public/sounds/music/ and
 * list them here. If this list is empty (or a chosen file fails to load) a
 * synthesized loop plays instead.
 */
const BACKGROUND_MUSIC: BackgroundTrack[] = [
  { src: '/sounds/music/jump-up-super-star.mp3', volume: 0.35, startSeconds: 30 },
];

type SoundName = 'countdown' | 'backgroundMusic';

/**
 * Plays the game's sound effects and background music.
 *
 * Sounds play via a plain `<audio>` element; if a file is missing (or its
 * `src` is empty) we fall back to a Web Audio synthesized version so the arcade
 * always makes noise — handy on a freshly-flashed Raspberry Pi with no audio
 * files copied over yet.
 *
 * Provided in root so a single instance owns playback across the app.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  /** Live <audio> elements, keyed by sound, so we can stop/replace them. */
  private readonly elements = new Map<SoundName, HTMLAudioElement>();

  /** Lazily-created Web Audio context for the synthesized fallbacks. */
  private audioContext: AudioContext | null = null;
  /** Active synth nodes per sound, so a looping synth can be stopped. */
  private readonly synthStops = new Map<SoundName, () => void>();

  /** Play the pre-game countdown sound once. */
  playCountdown(): void {
    const config = SOUND_CONFIG.countdown;
    if (!config.src) {
      this.playSynth('countdown', config.volume);
      return;
    }
    this.stop('countdown');
    const audio = new Audio(config.src);
    audio.volume = config.volume;
    audio.loop = config.loop;
    this.elements.set('countdown', audio);
    audio.addEventListener('error', () => this.fallbackToSynth('countdown', config.volume));
    audio.play().catch(() => this.fallbackToSynth('countdown', config.volume));
  }

  /** Pick a random background track and loop it until stopped. */
  startBackgroundMusic(): void {
    this.stop('backgroundMusic');

    if (BACKGROUND_MUSIC.length === 0) {
      this.playSynth('backgroundMusic', 0.35);
      return;
    }

    const track = BACKGROUND_MUSIC[Math.floor(Math.random() * BACKGROUND_MUSIC.length)];
    const start = track.startSeconds || 0;
    const end = track.endSeconds && track.endSeconds > start ? track.endSeconds : null;

    const audio = new Audio(track.src);
    audio.volume = track.volume;
    this.elements.set('backgroundMusic', audio);

    if (end !== null) {
      // Loop just the [start, end] window ourselves.
      audio.loop = false;
      audio.addEventListener('timeupdate', () => {
        if (audio.currentTime >= end) audio.currentTime = start;
      });
    } else {
      // Loop the whole file (from `start` onward).
      audio.loop = true;
    }

    const begin = (): void => {
      if (start > 0) audio.currentTime = start;
      audio.play().catch(() => this.fallbackToSynth('backgroundMusic', track.volume));
    };
    // currentTime is only reliable once the file's metadata has loaded.
    if (audio.readyState >= 1 /* HAVE_METADATA */) begin();
    else audio.addEventListener('loadedmetadata', begin, { once: true });

    audio.addEventListener('error', () => this.fallbackToSynth('backgroundMusic', track.volume));
  }

  /** Stop the background music. */
  stopBackgroundMusic(): void {
    this.stop('backgroundMusic');
  }

  /** Stop every sound. Call when leaving the game screen. */
  stopAll(): void {
    for (const name of [...this.elements.keys()]) this.stop(name);
    for (const name of [...this.synthStops.keys()]) this.stop(name);
  }

  // --- internals -----------------------------------------------------------

  private stop(name: SoundName): void {
    const audio = this.elements.get(name);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      this.elements.delete(name);
    }
    const stopSynth = this.synthStops.get(name);
    if (stopSynth) {
      stopSynth();
      this.synthStops.delete(name);
    }
  }

  /** Drop a failed <audio> element and replace it with the synth fallback. */
  private fallbackToSynth(name: SoundName, volume: number): void {
    this.elements.delete(name);
    this.playSynth(name, volume);
  }

  // --- synthesized fallbacks ----------------------------------------------

  private ctx(): AudioContext {
    this.audioContext ??= new AudioContext();
    // Browsers start the context suspended until a user gesture; the game is
    // always reached by tapping through the setup screen, so this resolves.
    if (this.audioContext.state === 'suspended') void this.audioContext.resume();
    return this.audioContext;
  }

  private playSynth(name: SoundName, volume: number): void {
    this.stop(name);
    const stop = name === 'countdown' ? this.synthCountdown(volume) : this.synthMusic(volume);
    this.synthStops.set(name, stop);
  }

  /** Mario-Kart-style countdown: three low beeps then a higher "GO". */
  private synthCountdown(volume: number): () => void {
    const ctx = this.ctx();
    const start = ctx.currentTime;
    const beep = (at: number, freq: number, length: number): OscillatorNode => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(volume, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + at);
      osc.stop(start + at + length + 0.05);
      return osc;
    };
    // 3 · 2 · 1 (low beeps, one per second) then GO (higher, longer).
    const oscs = [beep(0, 660, 0.18), beep(1, 660, 0.18), beep(2, 660, 0.18), beep(3, 990, 0.5)];
    return () => oscs.forEach((o) => o.stop());
  }

  /** Light, looping arcade arpeggio used until a music file is supplied. */
  private synthMusic(volume: number): () => void {
    const ctx = this.ctx();
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    // A simple cheerful loop (C major pentatonic), one note every 200ms.
    const notes = [523.25, 659.25, 783.99, 659.25, 587.33, 783.99, 880.0, 783.99];
    let step = 0;
    const intervalId = setInterval(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = 'triangle';
      osc.frequency.value = notes[step % notes.length];
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.6, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain).connect(master);
      osc.start(now);
      osc.stop(now + 0.2);
      step++;
    }, 200);

    return () => {
      clearInterval(intervalId);
      master.disconnect();
    };
  }
}
