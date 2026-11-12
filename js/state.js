import {
  DEFAULT_COLORS,
  STORAGE_KEY,
  SAVES_KEY,
  deepClone,
  uid,
  clamp,
  scaleNotes,
} from "./config.js";

const listeners = new Set();

export function createDefaultState() {
  return {
    version: 1,
    title: "Untitled piece",
    bpm: 110,
    key: 0,
    scale: "minorPentatonic",
    range: 2,
    octave: 0,
    tune: 0,
    quantize: "1/16",
    swing: "off",
    loopBars: 8,
    activeLayer: 0,
    instrument: "keys",
    tool: "draw",
    colors: { ...DEFAULT_COLORS },
    layers: [0, 1, 2].map((i) => ({
      id: `L${i + 1}`,
      name: `Layer ${i + 1}`,
      notes: [],
      strokes: [],
      muted: false,
      solo: false,
    })),
    background: "paper",
    backgroundImage: null,
    grid: true,
    names: true,
    shapes: false,
    metronome: false,
    loop: true,
    a11y: {
      speak: false,
      contrast: false,
      large: false,
      motion: false,
      names: true,
      shapes: false,
    },
  };
}

function mergeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== "object") return base;
  const next = { ...base, ...raw };
  next.a11y = { ...base.a11y, ...(raw.a11y || {}) };
  next.colors = { ...base.colors, ...(raw.colors || {}) };
  next.layers = [0, 1, 2].map((i) => {
    const incoming = raw.layers?.[i] || {};
    return {
      ...base.layers[i],
      ...incoming,
      notes: Array.isArray(incoming.notes) ? incoming.notes : [],
      strokes: Array.isArray(incoming.strokes)
        ? incoming.strokes.map((stroke) => ({ ...stroke, id: stroke.id || uid("s") }))
        : [],
    };
  });
  next.activeLayer = clamp(Number(next.activeLayer) || 0, 0, 2);
  next.bpm = clamp(Number(next.bpm) || 110, 40, 220);
  next.range = clamp(Number(next.range) || 2, 1, 3);
  next.loopBars = [4, 8, 16].includes(Number(next.loopBars)) ? Number(next.loopBars) : 8;
  return next;
}

function readAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? mergeState(JSON.parse(raw)) : null;
  } catch (err) {
    return null;
  }
}

export const state = readAutosave() || createDefaultState();

const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 60;

let saveTimer = 0;

export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(reason = "change") {
  listeners.forEach((fn) => {
    try {
      fn(reason);
    } catch (err) {
      console.error(err);
    }
  });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAutosave, 500);
}

export function saveAutosave() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    /* storage may be unavailable */
  }
}

function snapshot() {
  undoStack.push(deepClone(state.layers));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(deepClone(state.layers));
  const previous = undoStack.pop();
  state.layers = previous;
  emit("undo");
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(deepClone(state.layers));
  const next = redoStack.pop();
  state.layers = next;
  emit("redo");
  return true;
}

export function activeLayer() {
  return state.layers[state.activeLayer] || state.layers[0];
}

export function allPlayableNotes() {
  const soloed = state.layers.some((layer) => layer.solo);
  return state.layers.flatMap((layer) => {
    if (layer.muted) return [];
    if (soloed && !layer.solo) return [];
    return layer.notes.map((note) => ({ ...note, layer: layer.id }));
  });
}

export function addNote(note, options = {}) {
  const layer = state.layers[note.layerIndex ?? state.activeLayer] || state.layers[0];
  const target = {
    id: note.id || uid(),
    time: Math.max(0, Number(note.time) || 0),
    midi: Math.round(Number(note.midi) || 60),
    duration: Math.max(0.05, Number(note.duration) || 0.25),
    velocity: clamp(Number(note.velocity) || 0.8, 0.05, 1),
    instrument: note.instrument || state.instrument,
  };

  const existing = layer.notes.find(
    (item) =>
      Math.abs(item.time - target.time) < 0.01 &&
      item.midi === target.midi
  );
  if (existing) {
    existing.duration = target.duration;
    existing.velocity = target.velocity;
    existing.instrument = target.instrument;
  } else {
    if (options.record !== false) snapshot();
    layer.notes.push(target);
    layer.notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  }
  if (options.emit !== false) emit("note-add");
  return target;
}

export function removeNote(noteId, options = {}) {
  const layer = state.layers[state.activeLayer];
  const index = layer.notes.findIndex((note) => note.id === noteId);
  if (index === -1) return false;
  if (options.record !== false) snapshot();
  layer.notes.splice(index, 1);
  if (options.emit !== false) emit("note-remove");
  return true;
}

export function removeNotesInArea(layerIndex, time, midi, timeRadius, midiRadius) {
  const layer = state.layers[layerIndex];
  if (!layer) return 0;
  const before = layer.notes.length;
  layer.notes = layer.notes.filter(
    (note) => !(Math.abs(note.time - time) <= timeRadius && Math.abs(note.midi - midi) <= midiRadius)
  );
  const removed = before - layer.notes.length;
  if (removed) emit("note-erase");
  return removed;
}

export function clearActiveLayer() {
  const layer = state.layers[state.activeLayer];
  if (!layer || (!layer.notes.length && !layer.strokes.length)) return;
  snapshot();
  layer.notes = [];
  layer.strokes = [];
  emit("layer-clear");
}

export function addStroke(stroke, options = {}) {
  const layer = state.layers[options.layerIndex ?? state.activeLayer] || state.layers[0];
  if (!stroke || !stroke.points || stroke.points.length < 2) return null;
  if (options.record !== false) snapshot();
  const entry = {
    id: stroke.id || uid(),
    instrument: stroke.instrument || state.instrument,
    points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
  };
  layer.strokes.push(entry);
  if (options.emit !== false) emit("stroke-add");
  return entry;
}

export function removeStroke(strokeId, options = {}) {
  const layer = state.layers[options.layerIndex ?? state.activeLayer];
  if (!layer) return false;
  const index = layer.strokes.findIndex((stroke) => stroke.id === strokeId);
  if (index === -1) return false;
  if (options.record !== false) snapshot();
  layer.strokes.splice(index, 1);
  if (options.emit !== false) emit("stroke-remove");
  return true;
}

export function setLayerContent(index, notes, strokes = [], options = {}) {
  const layer = state.layers[index];
  if (!layer) return;
  if (options.record !== false) snapshot();
  layer.notes = notes || [];
  layer.strokes = (strokes || []).map((stroke) => ({ ...stroke, id: stroke.id || uid("s") }));
  emit("layer-content");
}

export function setActiveLayer(index) {
  state.activeLayer = clamp(Number(index) || 0, 0, 2);
  emit("active-layer");
}

export function setLayerFlag(index, flag, value) {
  const layer = state.layers[index];
  if (!layer || !["muted", "solo"].includes(flag)) return;
  layer[flag] = Boolean(value);
  emit("layer-flag");
}

export function setSetting(key, value) {
  if (!(key in state)) return;
  state[key] = value;
  emit("setting");
}

export function setInstrument(id) {
  state.instrument = id;
  emit("instrument");
}

export function setTool(tool) {
  state.tool = tool;
  emit("tool");
}

export function replaceLayers(layers, meta = {}) {
  snapshot();
  state.layers = [0, 1, 2].map((i) => ({
    ...state.layers[i],
    notes: layers[i] || [],
    strokes: [],
  }));
  if (meta.title) state.title = meta.title;
  if (meta.bpm) state.bpm = clamp(meta.bpm, 40, 220);
  if (meta.key != null) state.key = clamp(meta.key, 0, 11);
  if (meta.scale) state.scale = meta.scale;
  if (meta.swing) state.swing = meta.swing;
  if (meta.loopBars) state.loopBars = meta.loopBars;
  emit("layers-replace");
}

export function setA11y(key, value) {
  state.a11y[key] = Boolean(value);
  if (key === "names") state.names = Boolean(value);
  if (key === "shapes") state.shapes = Boolean(value);
  emit("a11y");
}

export function serializeProject() {
  return deepClone({
    version: state.version,
    title: state.title,
    bpm: state.bpm,
    key: state.key,
    scale: state.scale,
    range: state.range,
    octave: state.octave,
    tune: state.tune,
    quantize: state.quantize,
    swing: state.swing,
    loopBars: state.loopBars,
    instrument: state.instrument,
    colors: state.colors,
    layers: state.layers,
    background: state.background,
    backgroundImage: state.backgroundImage,
    grid: state.grid,
    names: state.names,
    shapes: state.shapes,
    metronome: state.metronome,
    loop: state.loop,
    a11y: state.a11y,
  });
}

export function loadProject(project) {
  const next = mergeState(project);
  Object.assign(state, next);
  undoStack.length = 0;
  redoStack.length = 0;
  emit("project-load");
}

export function listSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVES_KEY) || "[]");
  } catch (err) {
    return [];
  }
}

export function saveNamed(name) {
  const saved = listSaved();
  const clean = String(name || state.title || "Untitled").trim() || "Untitled";
  const entry = {
    id: uid("p"),
    name: clean,
    savedAt: new Date().toISOString(),
    project: serializeProject(),
  };
  const next = [entry, ...saved.filter((item) => item.name !== clean)].slice(0, 20);
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(next));
  } catch (err) {
    /* storage unavailable */
  }
  state.title = clean;
  emit("project-save");
  return entry;
}

export function loadNamed(id) {
  const entry = listSaved().find((item) => item.id === id);
  if (!entry) return false;
  loadProject(entry.project);
  return true;
}

export function deleteNamed(id) {
  const next = listSaved().filter((item) => item.id !== id);
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(next));
  } catch (err) {
    /* storage unavailable */
  }
  emit("project-delete");
}

export function noteCount() {
  return state.layers.reduce((sum, layer) => sum + layer.notes.length, 0);
}

export function currentNotes() {
  return activeLayer().notes || [];
}

export function scaleRange() {
  const notes = scaleNotes(state);
  return { notes, min: notes[0], max: notes[notes.length - 1] };
}
