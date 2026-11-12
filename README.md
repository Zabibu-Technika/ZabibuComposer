# Zabibu Composer

A visual music instrument for drawing notes, loading African arpeggios, and exporting a finished mix or ringtone.

**Live:** <https://zabibucomposer.vercel.app>
**Source:** <https://github.com/Zabibu-Technika/ZabibuComposer>

## What it does

- **Draw music.** The canvas maps left-to-right to time and top-to-bottom to pitch. Pick one of nine instruments, draw a line, and press play.
- **Three layers.** Build an arpeggio, a bassline, and a pad on separate layers; mute or solo each one.
- **Quick creation.** Load a full groove from the arpeggio library or draw one of 16 sample shapes, including the spiral.
- **African arpeggios.** Zouk, Soukous, Rhumba, Afrobeat, and Afrohouse, with three variations each, plus Pop, Lo-fi, and Cinematic.
- **Export.** WAV (24-bit), MP3 (320 kbps), MP4 (H.264/AAC, 1280×720), MIDI, a 30-second MP3 ringtone, and an iPhone `.m4r` ringtone.
- **Automatic mix and master.** Every export runs through EQ, compression, a limiter, reverb/delay sends, and peak normalization at 48 kHz.
- **Offline-first.** A service worker caches the app, the sounds, and the encoders. After the first load it runs without a network.
- **Accessible.** Keyboard composer, speech announcements, voice commands, high contrast, large controls, reduced motion, shape-coded notes, and a screen-reader note list.
- **Custom stages.** Paper, sky, sunset, dusk, or your own photo as the background.

## Run locally

There is no build step.

```bash
cd ZabibuComposer
python -m http.server 8140
```

Open <http://127.0.0.1:8140>.

## Offline

Open the site once with a connection. The service worker caches the studio and says "Saved for offline use", and from then on drawing, playback, and every export work with no network. The browser's Install button keeps it as an app.

When you change an app file, bump `CACHE` in `sw.js` so returning visitors get the new version.

## Deploy

```bash
cd ZabibuComposer
vercel deploy --prod --yes --project zabibucomposer
```

## Browser support

- WAV, MP3, MIDI, and ringtone export work in current Chrome, Edge, Firefox, and Safari.
- MP4 export uses WebCodecs (H.264 + AAC) and works in current Chrome and Edge. If it is unavailable, use WAV or MP3.
- Voice commands use the Web Speech API and are available in Chromium-based browsers. The keyboard composer works everywhere.

## Credits

Designed and built by **Tehillah Kachila** in Nairobi, Kenya. **Zabibu Composer is a Zabibu Technika product.** The **Zabibu Technika Ring Tune** was made with Zabibu Composer.

This is an original, clean-room implementation: original code, synthesized sounds, sample drawings, and arpeggio patterns. It is inspired by the visual-instrument idea; it is not affiliated with play_music_theory.

## Vendored libraries

- `vendor/lame.min.js` — LAME MP3 encoder (LGPL). See `vendor/LICENSES.md`.
- `vendor/mp4-muxer.mjs` — MP4 muxer (MIT). See `vendor/LICENSES.md`.

No other runtime dependencies. The app uses system fonts, so it works offline and does not call a font CDN.
