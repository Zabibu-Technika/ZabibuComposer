import { clamp } from "./config.js";

// A drawn line is played as a line. The page is a picture of sound: time runs
// left to right, pitch runs bottom to top, and the playhead reads the ink at
// each moment. We scan the stroke into narrow columns, collect every pitch the
// ink touches in a column, and merge runs of the same pitch into single notes.
// A gentle diagonal becomes a glissando, a vertical stroke becomes a strum, and
// loops or spirals keep every crossing (the playhead meets the same ink twice).
//
// Pitch is continuous, not snapped to the scale: drawing is free. The scale
// still shapes arpeggios and the keyboard composer.
//
// Results are cached per stroke until the key, octave, range, or loop length
// changes.

const BEAT_RESOLUTION = 1 / 24;
const MIN_BINS = 96;
const MAX_BINS = 512;
const MIN_LENGTH = 0.04;
const MAX_EVENTS = 160;
const PITCH_STEP = 1; // semitone detail: fine enough to glide, sparse enough to breathe

const cache = new WeakMap();

function signature(state) {
  return `${state.key}|${state.octave}|${state.range}|${state.loopBars}`;
}

export function strokeEvents(stroke, state) {
  if (!stroke || !stroke.points || stroke.points.length < 2) return [];
  const key = signature(state);
  const cached = cache.get(stroke);
  if (cached && cached.key === key) return cached.events;

  const loopBeats = Math.max(1, (state.loopBars || 8) * 4);
  const base = 48 + (state.key || 0) + (state.octave || 0) * 12;
  const span = 12 * Math.max(1, state.range || 2);
  const bins = clamp(Math.round(loopBeats / BEAT_RESOLUTION), MIN_BINS, MAX_BINS);
  const pitchAt = (y) =>
    Math.round((base + clamp(1 - y, 0, 1) * span) / PITCH_STEP) * PITCH_STEP;
  const columns = Array.from({ length: bins }, () => new Set());

  const addAt = (x, y) => {
    const bin = clamp(Math.floor(clamp(x, 0, 1) * bins), 0, bins - 1);
    columns[bin].add(pitchAt(y));
  };

  // Rasterise each segment into the columns it crosses. Vertical segments fill
  // one column with every pitch they pass, which the playhead reads as a chord.
  const points = stroke.points;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) < 0.0002) {
      const steps = Math.max(1, Math.ceil(Math.abs(dy) / 0.012));
      for (let s = 0; s <= steps; s += 1) addAt(a.x, a.y + dy * (s / steps));
      continue;
    }
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const firstBin = clamp(Math.floor(clamp(left, 0, 1) * bins), 0, bins - 1);
    const lastBin = clamp(Math.floor(clamp(right, 0, 1) * bins), 0, bins - 1);
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
      const x = (bin + 0.5) / bins;
      if (x < left - 0.5 / bins || x > right + 0.5 / bins) continue;
      addAt(x, a.y + ((x - a.x) / dx) * dy);
    }
    // Keep the exact endpoints too, so short gestures survive rounding.
    addAt(a.x, a.y);
    addAt(b.x, b.y);
  }

  // Merge a pitch that is present in neighbouring columns into one held note.
  const active = new Map();
  const runs = [];
  const closeRun = (run, endBin) => {
    runs.push({
      midi: run.midi,
      startBin: run.startBin,
      endBin: Math.max(run.startBin, endBin),
    });
  };
  for (let bin = 0; bin < bins; bin += 1) {
    const pitches = columns[bin];
    for (const [midi, run] of active) {
      if (!pitches.has(midi)) {
        closeRun(run, bin - 1);
        active.delete(midi);
      }
    }
    for (const midi of pitches) {
      const run = active.get(midi);
      if (run) run.endBin = bin;
      else active.set(midi, { midi, startBin: bin, endBin: bin });
    }
  }
  for (const run of active.values()) closeRun(run, bins - 1);

  const beatFor = (bin) => (bin / bins) * loopBeats;
  const events = runs
    .map((run) => {
      const start = beatFor(run.startBin);
      const duration = beatFor(run.endBin - run.startBin + 1);
      const span = run.endBin - run.startBin + 1;
      return {
        time: Math.round(start * 1000) / 1000,
        midi: run.midi,
        duration: Math.round(clamp(duration, MIN_LENGTH, 8) * 1000) / 1000,
        velocity: clamp(0.56 + Math.min(span, 18) * 0.018, 0.52, 0.9),
        startBin: run.startBin,
        endBin: run.endBin,
      };
    })
    .sort((a, b) => a.time - b.time || a.midi - b.midi)
    .slice(0, MAX_EVENTS);

  events.forEach((event, index) => {
    const next = events[index + 1];
    const end = event.time + event.duration;
    event.pitchTo =
      next && next.time >= end - 0.001 && next.time - event.time > 0.02 ? next.midi : event.midi;
    delete event.startBin;
    delete event.endBin;
  });

  const frozen = events;
  cache.set(stroke, { key, events: frozen });
  return frozen;
}

export function strokeSummary(stroke, state) {
  const events = strokeEvents(stroke, state);
  if (!events.length) return null;
  const first = events[0];
  const last = events[events.length - 1];
  return {
    start: first.time,
    end: last.time + last.duration,
    notes: events.length,
    low: Math.round(Math.min(...events.map((event) => event.midi))),
    high: Math.round(Math.max(...events.map((event) => event.midi))),
  };
}

// Total line events per layer, for the screen-reader list and status lines.
export function layerLineCount(layer, state) {
  return (layer.strokes || []).reduce((sum, stroke) => sum + strokeEvents(stroke, state).length, 0);
}
