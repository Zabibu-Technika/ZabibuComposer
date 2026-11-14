import { clamp, scaleNotes, stepBeats } from "./config.js";

// Drawing is free; sound is ruled.
//
// The page is a piece of ruled paper. Time runs left to right in equal steps and
// pitch runs bottom to top in scale rows. A stroke is read into that lattice:
// every step the ink crosses, every pitch row it touches. Contiguous rows in one
// step are a chord; a row that stays lit for several steps is one held note.
//
// This is what makes the instrument sound clean: the ear hears a quantized
// melody, never a continuous slide. The eye still sees the ink as it was drawn.

const ROWS = 32;
const MAX_LANES = 3;
const MAX_EVENTS = 480;
const cache = new WeakMap();

function signature(state) {
  return [
    state.key ?? 0,
    state.scale || "",
    state.range ?? 2,
    state.octave ?? 0,
    state.quantize || "",
    state.loopBars ?? 4,
  ].join("|");
}

export function gridRows() {
  return ROWS;
}

export function rowMidi(state, row) {
  const notes = scaleNotes(state);
  const index = Math.floor((clamp(row, 0, ROWS - 1) / ROWS) * notes.length);
  return notes[Math.min(notes.length - 1, Math.max(0, index))];
}

export function midiRow(state, midi) {
  const notes = scaleNotes(state);
  let best = 0;
  let distance = Infinity;
  for (let row = 0; row < ROWS; row += 1) {
    const value = rowMidi(state, row);
    const d = Math.abs(value - midi);
    if (d < distance) {
      distance = d;
      best = row;
    }
  }
  return best;
}

function clusters(mask) {
  const out = [];
  let remaining = mask;
  let guard = 0;
  while (remaining !== 0n && out.length < MAX_LANES && guard < 64) {
    guard += 1;
    let start = 0;
    while (start < 64 && ((remaining >> BigInt(start)) & 1n) === 0n) start += 1;
    if (start >= 64) break;
    let end = start;
    while (end + 1 < 64 && ((remaining >> BigInt(end + 1)) & 1n) !== 0n) end += 1;
    out.push(Math.floor((start + end) / 2));
    const length = BigInt(end - start + 1);
    remaining &= ~(((1n << length) - 1n) << BigInt(start));
  }
  return out;
}

function rowMasks(points, steps) {
  const masks = new Array(steps).fill(0n);
  if (!points || points.length < 1) return masks;
  let previous = null;
  const edge = 0.5 / steps;

  for (const point of points) {
    const x = clamp(Number(point.x) || 0, 0, 1);
    const y = clamp(Number(point.y) || 0, 0, 1);
    const step = Math.min(steps - 1, Math.max(0, Math.floor(x * steps)));
    const row = Math.round((1 - y) * (ROWS - 1));

    masks[step] |= 1n << BigInt(row);
    // A note held at either edge is felt at the loop boundary too.
    if (x <= edge) masks[0] |= 1n << BigInt(row);
    if (x >= 1 - edge) masks[steps - 1] |= 1n << BigInt(row);

    if (previous && Math.abs(step - previous.step) > 1) {
      const low = Math.min(previous.step, step);
      const high = Math.max(previous.step, step);
      for (let s = low + 1; s < high; s += 1) {
        const t = (s - previous.step) / (step - previous.step);
        const r = Math.round(previous.row + t * (row - previous.row));
        masks[s] |= 1n << BigInt(Math.max(0, Math.min(ROWS - 1, r)));
      }
    }
    previous = { step, row };
  }
  return masks;
}

export function strokeEvents(stroke, state) {
  if (!stroke || !stroke.points || stroke.points.length < 2) return [];
  const key = signature(state);
  const cached = cache.get(stroke);
  if (cached && cached.key === key) return cached.events;

  const loopBeats = Math.max(1, (state.loopBars || 4) * 4);
  const step = Math.max(1 / 32, stepBeats(state));
  const steps = clamp(Math.round(loopBeats / step), 4, 512);
  const masks = rowMasks(stroke.points, steps);
  const lanes = [[], [], []];

  for (let s = 0; s < steps; s += 1) {
    if (masks[s] === 0n) continue;
    const centers = clusters(masks[s]);
    for (let lane = 0; lane < centers.length; lane += 1) {
      lanes[lane].push({ step: s, midi: rowMidi(state, centers[lane]) });
    }
  }

  const events = [];
  const noteStep = loopBeats / steps;

  lanes.forEach((lane, laneIndex) => {
    let run = null;
    let phrase = 0;
    let previousEnd = -2;
    const close = () => {
      if (!run) return;
      events.push({
        time: Math.round(run.start * noteStep * 1000) / 1000,
        midi: run.midi,
        duration: Math.round((run.end - run.start + 1) * noteStep * 1000) / 1000,
        velocity: run.velocity,
        lane: laneIndex,
        phrase: run.phrase,
      });
      previousEnd = run.end;
      run = null;
    };
    lane.forEach((cell, index) => {
      if (run && cell.midi === run.midi && cell.step === lane[index - 1].step + 1) {
        run.end = cell.step;
        return;
      }
      // A gap starts a new phrase (a new breath); a pitch change inside a
      // continuous line stays in the same phrase, so one voice can step
      // through the melody instead of restriking every note.
      if (run && run.end < cell.step - 1) phrase += 1;
      else if (!run && previousEnd >= 0 && cell.step > previousEnd + 1) phrase += 1;
      close();
      run = { midi: cell.midi, start: cell.step, end: cell.step, velocity: 0.82, phrase };
    });
    close();
  });

  events.sort((a, b) => a.time - b.time || a.midi - b.midi);
  const frozen = events.slice(0, MAX_EVENTS);
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

export function layerLineCount(layer, state) {
  return (layer.strokes || []).reduce(
    (sum, stroke) => sum + strokeEvents(stroke, state).length,
    0
  );
}
