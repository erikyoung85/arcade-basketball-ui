import { Injectable } from '@angular/core';

/**
 * A one-shot sound effect. Set `src` to swap the audio with your own:
 *  - drop a file in `public/sounds/` and point at it, e.g. 'sounds/countdown.m4a'
 *  - or paste any public URL, e.g. 'https://example.com/countdown.mp3'
 *  - or leave `src` empty ('') to use the built-in synthesized fallback so the
 *    game still has sound with no audio files present.
 *
 * Local paths must be RELATIVE (no leading slash) so they resolve against the
 * app's <base href> and work under any deployment base path (see resolveSrc).
 */
interface SoundSource {
  /** Relative path under `public/` (no leading slash) or a full public URL. */
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
  /** Relative path under `public/` (e.g. 'sounds/music/track-1.mp3') or a full URL. */
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
  countdown: { src: 'sounds/countdown.m4a', volume: 0.9, loop: false },
} satisfies Record<string, SoundSource>;

/**
 * Background-music pool. A random entry is picked each game and looped over
 * its [startSeconds, endSeconds] window. Add files to public/sounds/music/ and
 * list them here. If this list is empty (or a chosen file fails to load) a
 * synthesized loop plays instead.
 */
const BACKGROUND_MUSIC: BackgroundTrack[] = [
  { src: 'sounds/music/jump-up-super-star.m4a', volume: 0.15, startSeconds: 0 },
];

/**
 * The "10 seconds left" warning, played once when the clock reaches 0:10.
 *
 * By default it's spoken with the browser's free built-in text-to-speech
 * (Web Speech API) — no audio file needed. To use a recording instead, set
 * `src` to a file under `public/` or a public URL; that takes priority. If
 * neither TTS nor a file is available, a short alert beep plays.
 */
const TEN_SECOND_WARNING = {
  /** Spoken via the browser's free text-to-speech when `src` is empty. */
  text: '10 seconds left',
  /** Optional audio file/URL to play INSTEAD of text-to-speech. */
  src: '',
  /** Volume, 0–1. */
  volume: 1,
};

/**
 * The final "3 · 2 · 1" countdown, announced once per second over the last
 * three seconds of the game.
 *
 * By default each number is spoken with the browser's free text-to-speech.
 * To use recordings, add entries to `src` keyed by the number — e.g.
 * `{ 3: 'sounds/three.mp3', 2: 'sounds/two.mp3', 1: 'sounds/one.mp3' }`.
 * Any number without a recording falls back to speech, then to a beep.
 */
const END_COUNTDOWN = {
  /** Optional recordings keyed by the number being announced. */
  src: {} as Record<number, string>,
  /** Volume, 0–1. */
  volume: 1,
};

/**
 * The "Clutch Time" announcement, played once when a clutch-scoring mode
 * enters its final, higher-value window.
 *
 * Spoken with the browser's free text-to-speech by default. Set `src` to a
 * file under `public/` or a public URL to play a recording instead.
 */
const CLUTCH_TIME = {
  /** Spoken via the browser's free text-to-speech when `src` is empty. */
  text: 'Clutch time!',
  /** Optional audio file/URL to play INSTEAD of text-to-speech. */
  src: '',
  /** Volume, 0–1. */
  volume: 1,
};

/**
 * Spoken cues for the turn-based "back to back" modes. Each is spoken with the
 * browser's free text-to-speech by default; set `src` to a file under
 * `public/` (or a public URL) to play a recording instead. `turn` has no fixed
 * text — the active player's name is spoken at call time.
 */
const SHOT_MADE = { text: 'Score!', src: '', volume: 1 };
const SHOT_MISSED = { text: 'Miss!', src: '', volume: 1 };
const STRIKE = { text: 'Strike!', src: '', volume: 1 };
const TURN_CUE = { src: '', volume: 1 };

type SoundName =
  | 'countdown'
  | 'backgroundMusic'
  | 'tenSecondWarning'
  | 'endCountdown'
  | 'clutchTime'
  | 'turn'
  | 'shotMade'
  | 'shotMissed'
  | 'strike';

/**
 * How long to wait for any single audio file to buffer during preload before
 * giving up on it. A missing or slow file shouldn't hold the game hostage — the
 * synthesized fallbacks cover anything that isn't ready in time.
 */
const PRELOAD_TIMEOUT_MS = 15_000;

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

  /**
   * Downloaded audio files held in memory as blob object-URLs, keyed by their
   * configured `src`. Because the service is app-wide (`providedIn: 'root'`)
   * this map outlives any single game, so a file fetched for the first game is
   * reused by every later one — no re-downloading. Playing a cached source
   * creates an <audio> backed by this in-memory blob, so it starts instantly.
   */
  private readonly cache = new Map<string, string>();

  /**
   * Fully-decoded, ready-to-play `<audio>` elements keyed by their configured
   * `src`. A blob in memory (see `cache`) still has to be decoded by an audio
   * element before `play()` will start, and that decode is what delayed the
   * countdown on a new game. Preloading these elements to `canplaythrough` and
   * reusing them means playback begins the instant it's requested. Like the
   * blob cache, this is app-wide and outlives any single game.
   */
  private readonly prepared = new Map<string, HTMLAudioElement>();

  /** Lazily-created Web Audio context for the synthesized fallbacks. */
  private audioContext: AudioContext | null = null;
  /** Active synth nodes per sound, so a looping synth can be stopped. */
  private readonly synthStops = new Map<SoundName, () => void>();

  /** Force initialization of speech synthesis for mobile safari browsers */
  initSpeechSynthesis(): void {
    const synth = window.speechSynthesis;

    console.log(synth.getVoices());
    synth.speak(new SpeechSynthesisUtterance(' '));
  }

  /**
   * Download every audio file the game will need so playback isn't delayed by a
   * slow connection mid-game. Resolves once each file is fully downloaded into
   * memory (or has errored/timed out — the synth fallbacks cover failures, so a
   * missing or slow file never blocks the game forever). The game waits on this
   * before the 3·2·1 countdown, so sounds are ready to play the instant they're
   * needed.
   *
   * Each file is fetched once and held as an in-memory blob (see `cache`);
   * sources already downloaded by an earlier game are skipped, so subsequent
   * games start without re-downloading anything. Text-to-speech announcements
   * need no preloading and are skipped.
   */
  async preload(): Promise<void> {
    await Promise.all(this.fileSources().map((src) => this.cacheOne(src)));
    // The 3·2·1 countdown is the first sound a game plays — the instant the
    // countdown starts — so beyond downloading its bytes, decode it now into a
    // ready-to-play element so play() starts immediately rather than waiting on
    // a decode mid-game. (The blob is already in memory from cacheOne above.)
    await this.prepareOne(SOUND_CONFIG.countdown.src);
  }

  /** Distinct local/remote audio file sources the game uses (TTS excluded). */
  private fileSources(): string[] {
    const srcs = [
      SOUND_CONFIG.countdown.src,
      ...BACKGROUND_MUSIC.map((track) => track.src),
      TEN_SECOND_WARNING.src,
      CLUTCH_TIME.src,
      ...Object.values(END_COUNTDOWN.src),
    ];
    return [...new Set(srcs.filter((src) => !!src))];
  }

  /**
   * Download one audio file into the in-memory blob cache, resolving when it's
   * ready or has given up (already cached → instant; timeout/error/abort →
   * left uncached so the synth fallback covers it). Caching the whole blob —
   * rather than relying on the HTTP cache — guarantees later playback is served
   * straight from memory and never re-downloads across games.
   */
  private async cacheOne(src: string): Promise<void> {
    if (this.cache.has(src)) return; // already downloaded in an earlier game

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PRELOAD_TIMEOUT_MS);
    try {
      const response = await fetch(this.resolveSrc(src), { signal: controller.signal });
      if (!response.ok) return;
      const blob = await response.blob();
      this.cache.set(src, URL.createObjectURL(blob));
    } catch {
      // Network error, 404, or timeout/abort — leave it uncached. Playback
      // falls back to the network URL and ultimately the synth version.
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Decode a (already-downloaded) source into an `<audio>` element that's fully
   * buffered and ready to play with no further loading, then remember it in
   * `prepared` for reuse. Resolves once the element reports it can play through
   * — or on error/timeout, in which case nothing is cached and the caller's
   * fallbacks (network URL, then synth) cover it. This is what removes the
   * decode-on-first-play delay: `play()` on the prepared element starts at once.
   */
  private async prepareOne(src: string): Promise<void> {
    if (!src || this.prepared.has(src)) return;

    const audio = this.audioFor(src);
    audio.preload = 'auto';
    const ready = await new Promise<boolean>((resolve) => {
      const finish = (ok: boolean): void => {
        clearTimeout(timer);
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
        resolve(ok);
      };
      const onReady = (): void => finish(true);
      const onError = (): void => finish(false);
      const timer = setTimeout(() => finish(false), PRELOAD_TIMEOUT_MS);
      if (audio.readyState >= 4 /* HAVE_ENOUGH_DATA */) return finish(true);
      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.load();
    });

    if (ready) this.prepared.set(src, audio);
  }

  /**
   * A ready-to-play <audio> for a configured `src`: the element prepared (fully
   * decoded) during preload when available (instant), otherwise one backed by
   * the in-memory blob, otherwise pointed at the resolved network URL.
   */
  private audioFor(src: string): HTMLAudioElement {
    return this.prepared.get(src) ?? new Audio(this.cache.get(src) ?? this.resolveSrc(src));
  }

  /** Play the pre-game countdown sound once. */
  playCountdown(): void {
    const config = SOUND_CONFIG.countdown;
    if (!config.src) {
      this.playSynth('countdown', config.volume);
      return;
    }
    this.stop('countdown');
    const audio = this.audioFor(config.src);
    // The prepared element is reused across games, so rewind it and use a
    // single (overwriting) error handler rather than stacking one per game.
    audio.currentTime = 0;
    audio.volume = config.volume;
    audio.loop = config.loop;
    this.elements.set('countdown', audio);
    audio.onerror = () => this.fallbackToSynth('countdown', config.volume);
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

    const audio = this.audioFor(track.src);
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

  /** Speak/play the one-shot "10 seconds left" warning. */
  playTenSecondWarning(): void {
    const config = TEN_SECOND_WARNING;
    this.announce('tenSecondWarning', config.text, config.src, config.volume);
  }

  /** Announce the start of clutch time, when baskets become worth more. */
  playClutchTime(): void {
    this.announce('clutchTime', CLUTCH_TIME.text, CLUTCH_TIME.src, CLUTCH_TIME.volume);
  }

  /** Announce one number of the final 3·2·1 countdown. */
  playEndCountdown(n: number): void {
    this.announce('endCountdown', String(n), END_COUNTDOWN.src[n] ?? '', END_COUNTDOWN.volume);
  }

  /** Stop the (looping or one-shot) pre-game / shot-clock countdown sound. */
  stopCountdown(): void {
    this.stop('countdown');
  }

  /**
   * Announce whose turn it is in a back-to-back game (speaks the player's name).
   * When `practice` is true the round has already been decided by a strike, so
   * the cue makes clear this shot is just for practice.
   */
  playTurnCue(playerName: string, practice = false): void {
    const text = practice
      ? `${playerName}, you're up. This one is just a practice shot.`
      : `${playerName}, you're up`;
    this.announce('turn', text, TURN_CUE.src, TURN_CUE.volume);
  }

  /** Announce a made shot in a back-to-back game. */
  playShotMade(): void {
    this.announce('shotMade', SHOT_MADE.text, SHOT_MADE.src, SHOT_MADE.volume);
  }

  /** Announce a missed shot in a back-to-back game. */
  playShotMissed(): void {
    this.announce('shotMissed', SHOT_MISSED.text, SHOT_MISSED.src, SHOT_MISSED.volume);
  }

  /** Announce a strike in a back-to-back game. */
  playStrike(): void {
    this.announce('strike', STRIKE.text, STRIKE.src, STRIKE.volume);
  }

  /**
   * Play a spoken announcement: a recording if `src` is given, otherwise the
   * browser's free text-to-speech, otherwise a synthesized beep.
   */
  private announce(name: SoundName, text: string, src: string, volume: number): void {
    // A recording was provided — it takes priority over text-to-speech.
    if (src) {
      this.stop(name);
      const audio = this.audioFor(src);
      audio.volume = volume;
      this.elements.set(name, audio);
      audio.addEventListener('error', () => this.fallbackToSynth(name, volume));
      audio.play().catch(() => this.fallbackToSynth(name, volume));
      return;
    }

    // Free, file-less text-to-speech via the Web Speech API.
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (synth && typeof SpeechSynthesisUtterance !== 'undefined') {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = volume;
      synth.speak(utterance);
      return;
    }

    // No TTS available (e.g. a bare Chromium with no voices) — beep instead.
    this.playSynth(name, volume);
  }

  /** Stop every sound. Call when leaving the game screen. */
  stopAll(): void {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    for (const name of [...this.elements.keys()]) this.stop(name);
    for (const name of [...this.synthStops.keys()]) this.stop(name);
  }

  // --- internals -----------------------------------------------------------

  /**
   * Resolve a configured `src` against the app's `<base href>` so audio loads
   * correctly under any deployment base path — dev ('/') and the Raspberry Pi
   * production build ('/arcadebasketball/', set via `--base-href`). Relative
   * paths (e.g. 'sounds/x.mp3') pick up the base; full URLs are left unchanged.
   */
  private resolveSrc(src: string): string {
    return new URL(src, document.baseURI).href;
  }

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
    let stop: () => void;
    switch (name) {
      case 'countdown':
        stop = this.synthCountdown(volume);
        break;
      case 'backgroundMusic':
        stop = this.synthMusic(volume);
        break;
      case 'tenSecondWarning':
        stop = this.synthAlert(volume, [0, 0.22]); // two beeps
        break;
      case 'clutchTime':
        stop = this.synthAlert(volume, [0, 0.18, 0.36]); // three rising-urgency beeps
        break;
      default: // endCountdown — a single beep per number
        stop = this.synthAlert(volume, [0]);
        break;
    }
    this.synthStops.set(name, stop);
  }

  /** Short high beep(s) — fallback alert at each given offset (seconds). */
  private synthAlert(volume: number, offsets: number[]): () => void {
    const ctx = this.ctx();
    const start = ctx.currentTime;
    const oscs = offsets.map((at) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1175;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(volume, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + at);
      osc.stop(start + at + 0.2);
      return osc;
    });
    return () => oscs.forEach((o) => o.stop());
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
