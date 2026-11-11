export const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export const SCALES = {
  majorPentatonic: { name: "Major pentatonic", intervals: [0, 2, 4, 7, 9] },
  minorPentatonic: { name: "Minor pentatonic", intervals: [0, 3, 5, 7, 10] },
  major: { name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: "Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { name: "Harmonic minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  blues: { name: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
};

export const INSTRUMENTS = [
  { id: "keys", name: "Keys", color: "#138a72", shape: "circle", pan: 0.0, reverb: 0.22, delay: 0.08 },
  { id: "pluck", name: "Pluck", color: "#d85a30", shape: "triangle", pan: -0.18, reverb: 0.16, delay: 0.14 },
  { id: "bell", name: "Bell", color: "#6b5bd6", shape: "diamond", pan: 0.22, reverb: 0.36, delay: 0.12 },
  { id: "marimba", name: "Marimba", color: "#d98f1f", shape: "square", pan: -0.08, reverb: 0.18, delay: 0.06 },
  { id: "flute", name: "Flute", color: "#2b5bd7", shape: "ring", pan: 0.12, reverb: 0.3, delay: 0.1 },
  { id: "strings", name: "Strings", color: "#c94a86", shape: "line", pan: -0.26, reverb: 0.42, delay: 0.08 },
  { id: "chime", name: "Chime", color: "#4f9fc9", shape: "star", pan: 0.3, reverb: 0.45, delay: 0.2 },
  { id: "bass", name: "Bass", color: "#22201c", shape: "bar", pan: 0.0, reverb: 0.06, delay: 0.0 },
  { id: "eightbit", name: "8-bit", color: "#e8a879", shape: "cross", pan: 0.16, reverb: 0.08, delay: 0.1 },
];

export const INSTRUMENT_BY_ID = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

export const DEFAULT_COLORS = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i.color]));

export const QUANTIZE = {
  "1/4": { label: "1/4", beats: 1 },
  "1/8": { label: "1/8", beats: 0.5 },
  "1/8 triplet": { label: "1/8 triplet", beats: 1 / 3 },
  "1/16": { label: "1/16", beats: 0.25 },
  "1/16 triplet": { label: "1/16 triplet", beats: 1 / 6 },
  "1/32": { label: "1/32", beats: 0.125 },
};

export const SWINGS = {
  off: { label: "Off", amount: 0 },
  light: { label: "Light", amount: 0.09 },
  medium: { label: "Medium", amount: 0.18 },
  hard: { label: "Hard", amount: 0.28 },
};

export const RANGES = [1, 2, 3];
export const LOOP_BARS = [4, 8, 16];

export const BACKGROUNDS = [
  { id: "paper", name: "Paper" },
  { id: "sky", name: "Sky" },
  { id: "sunset", name: "Sunset" },
  { id: "dusk", name: "Dusk" },
  { id: "photo", name: "Your photo" },
];

export const STORAGE_KEY = "zabibu-composer-autosave-v1";
export const SAVES_KEY = "zabibu-composer-saves-v1";
export const VISITED_KEY = "zabibu-composer-visited-v1";

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function uid(prefix = "n") {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function midiToFreq(midi, tune = 0) {
  return 440 * Math.pow(2, (midi - 69 + tune / 100) / 12);
}

export function midiToName(midi) {
  const name = KEYS[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export function scaleNotes(state) {
  const scale = (SCALES[state.scale] || SCALES.minorPentatonic).intervals;
  const base = 48 + (state.key || 0) + (state.octave || 0) * 12;
  const notes = [];
  for (let oct = 0; oct < (state.range || 2); oct += 1) {
    for (const interval of scale) notes.push(base + oct * 12 + interval);
  }
  notes.push(base + (state.range || 2) * 12);
  return notes;
}

export function stepBeats(state) {
  return (QUANTIZE[state.quantize] || QUANTIZE["1/16"]).beats;
}

export function swingAmount(state) {
  return (SWINGS[state.swing] || SWINGS.off).amount;
}

export function beatsToSeconds(beats, bpm) {
  return (beats * 60) / Math.max(30, bpm || 110);
}

export function instrumentInfo(state, id) {
  const base = INSTRUMENT_BY_ID[id] || INSTRUMENTS[0];
  return {
    ...base,
    color: state.colors?.[id] || base.color,
  };
}
