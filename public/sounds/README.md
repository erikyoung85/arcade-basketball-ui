# Game sounds

The game's audio is configured in
[`src/app/core/services/sound.service.ts`](../../src/app/core/services/sound.service.ts).

## Countdown sound (`SOUND_CONFIG.countdown`)

Plays once during the 3·2·1 pre-game countdown. Drop your clip at
`public/sounds/countdown.m4a` (Mario Kart countdown goes here), or change its
`src` to any public URL. Until a file is present, a synthesized beep plays.

## Background music (`BACKGROUND_MUSIC`)

A **pool** of tracks. When a game starts, one is chosen at random and looped
until the game ends. Add as many as you want:

1. Drop your audio files into `public/sounds/music/`.
2. List each one in the `BACKGROUND_MUSIC` array:

```ts
const BACKGROUND_MUSIC: BackgroundTrack[] = [
  { src: '/sounds/music/track-1.mp3', volume: 0.35, startSeconds: 0 },
  // Start 12s in and loop back at 48s (skips a long intro/outro):
  { src: '/sounds/music/track-2.mp3', volume: 0.35, startSeconds: 12, endSeconds: 48 },
  // A public URL works too:
  { src: 'https://example.com/track.mp3', volume: 0.4, startSeconds: 0 },
];
```

Each track field:

| Field          | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `src`          | Path under `public/` or a full public URL.                              |
| `volume`       | `0` (silent) – `1` (full). Music defaults to `0.35` to sit under play.  |
| `startSeconds` | Where playback begins within the file.                                  |
| `endSeconds`   | Optional. Loops back to `startSeconds` here. Omit to loop the whole file. |

If the list is empty, or a chosen file fails to load, a synthesized loop plays
instead — so there's always sound, even on a fresh Raspberry Pi.
