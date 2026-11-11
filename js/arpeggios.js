import { SCALES, clamp } from "./config.js";

export const GENRES = ["Zouk", "Soukous", "Rhumba", "Afrobeat", "Afrohouse", "Pop", "Lo-fi", "Cinematic"];

export const ARPEGGIOS = [
  // Zouk
  { id: "zouk-lanmou", genre: "Zouk", name: "Zouk Lanmou", description: "A lilting 8th-note groove with a soft landing.", bpm: 96, key: 0, scale: "minor", progression: [0, 5, 3, 4], pattern: "updown", steps: 8, instrument: "pluck", pad: "strings", swing: "light", octave: 0 },
  { id: "zouk-sunset", genre: "Zouk", name: "Zouk Sunset", description: "Warm marimba, wide chords, slow golden hour.", bpm: 88, key: 5, scale: "major", progression: [0, 4, 5, 3], pattern: "broken", steps: 8, instrument: "marimba", pad: "flute", swing: "off", octave: 0 },
  { id: "zouk-night", genre: "Zouk", name: "Zouk Night", description: "A bell melody for the after-party.", bpm: 100, key: 7, scale: "minor", progression: [0, 3, 4, 5], pattern: "up", steps: 16, instrument: "bell", pad: "strings", swing: "medium", octave: 0 },

  // Soukous
  { id: "sebene-roll", genre: "Soukous", name: "Sebene Roll", description: "Fast, rolling sebene guitar energy.", bpm: 128, key: 0, scale: "major", progression: [0, 4, 5, 3], pattern: "updown", steps: 16, instrument: "pluck", pad: "strings", swing: "off", octave: 0 },
  { id: "soukous-drive", genre: "Soukous", name: "Soukous Drive", description: "A driving 16th-note marimba line.", bpm: 132, key: 2, scale: "major", progression: [0, 4, 1, 5], pattern: "broken", steps: 16, instrument: "marimba", pad: "strings", swing: "light", octave: 0 },
  { id: "soukous-bounce", genre: "Soukous", name: "Soukous Bounce", description: "A playful 8-bit bounce with a pedal tone.", bpm: 124, key: 7, scale: "mixolydian", progression: [0, 4, 5, 3], pattern: "pedal", steps: 8, instrument: "eightbit", pad: "strings", swing: "off", octave: 0 },

  // Rhumba
  { id: "rhumba-classic", genre: "Rhumba", name: "Rhumba Classic", description: "Strings, space, and a slow continental sway.", bpm: 100, key: 0, scale: "major", progression: [0, 4, 5, 3], pattern: "updown", steps: 8, instrument: "strings", pad: "strings", swing: "off", octave: 0 },
  { id: "rhumba-triste", genre: "Rhumba", name: "Rhumba Triste", description: "A minor-key flute line with a heavy heart.", bpm: 92, key: 9, scale: "minor", progression: [0, 5, 3, 4], pattern: "broken", steps: 8, instrument: "flute", pad: "strings", swing: "light", octave: 0 },
  { id: "rhumba-nairobi", genre: "Rhumba", name: "Rhumba Nairobi", description: "Dorian marimba, city lights, a walking bass.", bpm: 104, key: 2, scale: "dorian", progression: [0, 3, 4, 5], pattern: "up", steps: 16, instrument: "marimba", pad: "strings", swing: "off", octave: 0 },

  // Afrobeat
  { id: "lagos-groove", genre: "Afrobeat", name: "Lagos Groove", description: "A syncopated pluck groove with a deep pocket.", bpm: 108, key: 0, scale: "minor", progression: [0, 3, 4, 5], pattern: "broken", steps: 16, instrument: "pluck", pad: "strings", swing: "light", octave: 0 },
  { id: "afrobeat-horns", genre: "Afrobeat", name: "Afrobeat Horns", description: "Bright bell stabs over a major progression.", bpm: 112, key: 5, scale: "major", progression: [0, 4, 5, 3], pattern: "updown", steps: 8, instrument: "bell", pad: "strings", swing: "off", octave: 0 },
  { id: "afrobeat-night", genre: "Afrobeat", name: "Afrobeat Night", description: "Dorian keys, a pedal tone, and a late-night strut.", bpm: 100, key: 2, scale: "dorian", progression: [0, 5, 3, 4], pattern: "pedal", steps: 16, instrument: "keys", pad: "strings", swing: "medium", octave: 0 },

  // Afrohouse
  { id: "deep-log-drum", genre: "Afrohouse", name: "Deep Log Drum", description: "A rolling minor arpeggio built for the log drum.", bpm: 120, key: 0, scale: "minor", progression: [0, 5, 3, 4], pattern: "up", steps: 16, instrument: "pluck", pad: "strings", swing: "off", octave: 0 },
  { id: "afrohouse-sunrise", genre: "Afrohouse", name: "Afrohouse Sunrise", description: "Major marimba, open chords, first light.", bpm: 122, key: 5, scale: "major", progression: [0, 4, 5, 3], pattern: "updown", steps: 16, instrument: "marimba", pad: "strings", swing: "off", octave: 0 },
  { id: "afrohouse-pulse", genre: "Afrohouse", name: "Afrohouse Pulse", description: "A glassy broken chord with forward motion.", bpm: 124, key: 2, scale: "dorian", progression: [0, 3, 4, 5], pattern: "broken", steps: 16, instrument: "chime", pad: "strings", swing: "light", octave: 0 },

  // Pop
  { id: "bright-pop", genre: "Pop", name: "Bright Pop", description: "A clean major up-down for a sunny hook.", bpm: 112, key: 0, scale: "major", progression: [0, 4, 5, 3], pattern: "updown", steps: 8, instrument: "keys", pad: "strings", swing: "off", octave: 0 },
  { id: "minor-pop", genre: "Pop", name: "Minor Pop", description: "A moody 16th-note broken chord.", bpm: 108, key: 9, scale: "minor", progression: [0, 5, 3, 4], pattern: "broken", steps: 16, instrument: "marimba", pad: "strings", swing: "off", octave: 0 },
  { id: "neon-pop", genre: "Pop", name: "Neon Pop", description: "Bell arpeggios with a neon-lit lift.", bpm: 120, key: 5, scale: "major", progression: [0, 4, 1, 5], pattern: "up", steps: 16, instrument: "bell", pad: "strings", swing: "off", octave: 0 },

  // Lo-fi
  { id: "rainy-room", genre: "Lo-fi", name: "Rainy Room", description: "Dusty keys, soft swing, a window full of rain.", bpm: 82, key: 0, scale: "minor", progression: [0, 5, 3, 4], pattern: "broken", steps: 8, instrument: "keys", pad: "strings", swing: "medium", octave: 0 },
  { id: "tape-hiss", genre: "Lo-fi", name: "Tape Hiss", description: "A Dorian pluck loop with a worn-in pocket.", bpm: 86, key: 2, scale: "dorian", progression: [0, 3, 4, 5], pattern: "updown", steps: 8, instrument: "pluck", pad: "strings", swing: "light", octave: 0 },
  { id: "late-bus", genre: "Lo-fi", name: "Late Bus", description: "A slow pedal tone for the last ride home.", bpm: 78, key: 7, scale: "minor", progression: [0, 5, 3, 4], pattern: "pedal", steps: 16, instrument: "keys", pad: "flute", swing: "medium", octave: 0 },

  // Cinematic
  { id: "wide-horizon", genre: "Cinematic", name: "Wide Horizon", description: "A slow minor ascent with a wide screen.", bpm: 70, key: 0, scale: "minor", progression: [0, 5, 3, 4], pattern: "up", steps: 8, instrument: "strings", pad: "strings", swing: "off", octave: 0 },
  { id: "rise", genre: "Cinematic", name: "Rise", description: "Chimes over a major build.", bpm: 76, key: 5, scale: "major", progression: [0, 4, 5, 3], pattern: "updown", steps: 8, instrument: "chime", pad: "strings", swing: "off", octave: 0 },
  { id: "nightfall", genre: "Cinematic", name: "Nightfall", description: "A broken minor flute line at the edge of night.", bpm: 72, key: 9, scale: "minor", progression: [0, 3, 4, 5], pattern: "broken", steps: 8, instrument: "flute", pad: "strings", swing: "light", octave: 0 },
];

export function arpeggiosByGenre(genre) {
  return ARPEGGIOS.filter((arp) => arp.genre === genre);
}

export function randomArpeggio() {
  return ARPEGGIOS[Math.floor(Math.random() * ARPEGGIOS.length)];
}

export const RINGTUNE = {
  id: "zabibu-ring-tune",
  genre: "Zabibu",
  name: "Zabibu Ring Tune",
  description: "The Zabibu Technika ring tune, made with Zabibu Composer.",
  bpm: 120,
  key: 0,
  scale: "major",
  progression: [0, 4, 5, 3],
  pattern: "updown",
  steps: 16,
  instrument: "bell",
  pad: "strings",
  swing: "off",
  octave: 1,
};

function patternFor(name, count) {
  const base = {
    up: [0, 1, 2, 3],
    down: [3, 2, 1, 0],
    updown: [0, 1, 2, 3, 2, 1],
    broken: [0, 2, 1, 3],
    pedal: [0, 1, 0, 2, 0, 3],
    random: [0, 2, 3, 1],
  }[name] || [0, 1, 2, 3];
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(base[i % base.length]);
  return out;
}

export function buildArpeggio(arp, baseState) {
  const bpm = clamp(arp.bpm || 110, 40, 220);
  const key = clamp(arp.key ?? baseState.key ?? 0, 0, 11);
  const scaleDef = SCALES[arp.scale] || SCALES.minor;
  const intervals = scaleDef.intervals;
  const length = intervals.length;
  const base = 48 + key;

  const degreeToMidi = (degree, octave = 0) => {
    const oct = Math.floor(degree / length) + octave;
    const interval = intervals[((degree % length) + length) % length];
    return base + oct * 12 + interval;
  };

  const arpNotes = [];
  const bassNotes = [];
  const padNotes = [];
  const bars = 4;
  const steps = arp.steps === 16 ? 16 : 8;
  const pattern = patternFor(arp.pattern, steps);

  for (let bar = 0; bar < bars; bar += 1) {
    const root = arp.progression[bar % arp.progression.length];
    const barStart = bar * 4;

    const chord = [0, 2, 4, 7].map((offset) => degreeToMidi(root + offset, arp.octave || 0));
    padNotes.push(...chord.map((midi) => ({
      time: barStart,
      midi,
      duration: 3.85,
      velocity: 0.32,
      instrument: arp.pad || "strings",
    })));

    bassNotes.push({
      time: barStart,
      midi: degreeToMidi(root, -1),
      duration: 1.8,
      velocity: 0.82,
      instrument: "bass",
    });
    bassNotes.push({
      time: barStart + 2,
      midi: degreeToMidi(root + 4, -1),
      duration: 1.7,
      velocity: 0.72,
      instrument: "bass",
    });

    for (let step = 0; step < steps; step += 1) {
      const time = barStart + (step / steps) * 4;
      const chordIndex = pattern[step] % 4;
      let degree = root + [0, 2, 4, 7][chordIndex];
      if (arp.pattern === "random" && step % 3 === 0) degree += 2;
      const midi = degreeToMidi(degree, arp.octave || 0);
      arpNotes.push({
        time,
        midi,
        duration: (4 / steps) * 0.86,
        velocity: 0.66 + (step % 4 === 0 ? 0.18 : 0.04),
        instrument: arp.instrument || "pluck",
      });
    }
  }

  return {
    layers: [arpNotes, bassNotes, padNotes],
    meta: {
      title: arp.name,
      bpm,
      key,
      scale: arp.scale,
      swing: arp.swing || "off",
      loopBars: 4,
      instrument: arp.instrument,
    },
  };
}
