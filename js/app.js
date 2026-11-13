import {
  BACKGROUNDS,
  DEFAULT_COLORS,
  INSTRUMENTS,
  INSTRUMENT_BY_ID,
  KEYS,
  QUANTIZE,
  RANGES,
  SCALES,
  SWINGS,
  VISITED_KEY,
  clamp,
  instrumentInfo,
  midiToName,
  scaleNotes,
  stepBeats,
} from "./config.js";
import * as store from "./state.js";
import { ensureContext, previewNote, Transport } from "./audio.js";
import { ScoreRenderer } from "./render.js";
import { layerLineCount, strokeSummary } from "./lines.js";
import { SAMPLE_SHAPES, sampleSvg, randomSample } from "./samples.js";
import {
  ARPEGGIOS,
  GENRES,
  RINGTUNE,
  arpeggiosByGenre,
  buildArpeggio,
  randomArpeggio,
} from "./arpeggios.js";
import {
  downloadProject,
  exportM4R,
  exportMidi,
  exportMp3,
  exportRingtone,
  exportVideo,
  exportWav,
} from "./export.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = store.state;

let renderer = null;
let transport = null;
let cursor = { time: 0, midi: 60, duration: 0.25 };
let cursorActive = false;
let drawing = false;
let liveStroke = null;
let lastPreviewMidi = -1;
let lastPreviewAt = 0;
let exportBusy = false;
let currentGenre = "Zouk";
let tapTimes = [];
let voiceRecognition = null;
let voiceOn = false;
let toastTimer = 0;

/* ---------- small helpers ---------- */

function toast(message, isError = false) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("is-show");
  el.classList.toggle("is-error", isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-show"), 3200);
}

function announce(message) {
  const el = $("#sr-status");
  if (el) el.textContent = message;
  speak(message);
}

function speak(message) {
  if (!state.a11y.speak || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1.05;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    /* speech may be unavailable */
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function barsToPosition(beats) {
  const bar = Math.floor(beats / 4) + 1;
  const beat = Math.floor(beats % 4) + 1;
  return `${bar}.${beat}`;
}

function noteLabel(note, layerIndex = null) {
  const bar = Math.floor(note.time / 4) + 1;
  const beat = Math.floor((note.time % 4)) + 1;
  const instrument = INSTRUMENT_BY_ID[note.instrument]?.name || note.instrument;
  return `Bar ${bar}, beat ${beat}: ${midiToName(note.midi)}, ${instrument}${layerIndex != null ? `, layer ${layerIndex + 1}` : ""}`;
}

function openDialog(id) {
  const dialogIds = {
    arpeggios: "arpeggio-dialog",
    samples: "samples-dialog",
    gallery: "gallery-dialog",
    about: "about-dialog",
    access: "access-dialog",
    background: "background-dialog",
    recolor: "recolor-dialog",
    help: "help-dialog",
  };
  $$("dialog[open]").forEach((dialog) => dialog.close());
  const dialog = document.getElementById(dialogIds[id] || `${id}-dialog`);
  if (!dialog) return;
  if (id === "arpeggios") renderArpCards();
  if (id === "samples") renderSampleCards();
  if (id === "gallery") renderGallery();
  if (id === "background") renderBackgrounds();
  if (id === "recolor") renderRecolor();
  if (!dialog.open) dialog.showModal();
}

function closeDialog(button) {
  const dialog = button.closest("dialog");
  if (dialog) dialog.close();
}

/* ---------- controls ---------- */

function fillSelect(select, entries, value) {
  select.innerHTML = entries
    .map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`)
    .join("");
  select.value = value;
}

function initControls() {
  fillSelect($("#key"), KEYS.map((name, i) => [i, name]), String(state.key));
  fillSelect($("#scale"), Object.entries(SCALES).map(([id, scale]) => [id, scale.name]), state.scale);
  fillSelect($("#range"), RANGES.map((n) => [n, `${n} octave${n > 1 ? "s" : ""}`]), String(state.range));
  fillSelect($("#quantize"), Object.entries(QUANTIZE).map(([id, q]) => [id, q.label]), state.quantize);
  fillSelect($("#swing"), Object.entries(SWINGS).map(([id, s]) => [id, s.label]), state.swing);
  fillSelect($("#loop-bars"), [[4, "4 bars"], [8, "8 bars"], [16, "16 bars"]], String(state.loopBars));
  $("#bpm").value = state.bpm;
  $("#tune").value = state.tune;

  $("#key").addEventListener("change", (event) => store.setSetting("key", Number(event.target.value)));
  $("#scale").addEventListener("change", (event) => store.setSetting("scale", event.target.value));
  $("#range").addEventListener("change", (event) => store.setSetting("range", Number(event.target.value)));
  $("#quantize").addEventListener("change", (event) => store.setSetting("quantize", event.target.value));
  $("#swing").addEventListener("change", (event) => store.setSetting("swing", event.target.value));
  $("#loop-bars").addEventListener("change", (event) => {
    store.setSetting("loopBars", Number(event.target.value));
    cursor.time = Math.min(cursor.time, state.loopBars * 4);
  });
  $("#bpm").addEventListener("change", (event) => {
    const value = clamp(Number(event.target.value) || 110, 40, 220);
    event.target.value = value;
    store.setSetting("bpm", value);
  });
  $("#tune").addEventListener("change", (event) => {
    const value = clamp(Number(event.target.value) || 0, -50, 50);
    event.target.value = value;
    store.setSetting("tune", value);
  });
  $("#oct-down").addEventListener("click", () => {
    store.setSetting("octave", clamp(state.octave - 1, -3, 3));
    ensureContext().then(() => previewNote(scaleNotes(state)[Math.floor(scaleNotes(state).length / 2)], state.instrument));
  });
  $("#oct-up").addEventListener("click", () => {
    store.setSetting("octave", clamp(state.octave + 1, -3, 3));
    ensureContext().then(() => previewNote(scaleNotes(state)[Math.floor(scaleNotes(state).length / 2)], state.instrument));
  });

  $("#grid-toggle").addEventListener("click", () => {
    store.setSetting("grid", !state.grid);
    $("#grid-toggle").setAttribute("aria-pressed", String(state.grid));
    $("#grid-toggle").classList.toggle("is-on", state.grid);
  });
  $("#names-toggle").addEventListener("click", () => {
    store.setSetting("names", !state.names);
    state.a11y.names = state.names;
    $("#names-toggle").setAttribute("aria-pressed", String(state.names));
    $("#names-toggle").classList.toggle("is-on", state.names);
  });
  $("#shapes-toggle").addEventListener("click", () => {
    store.setSetting("shapes", !state.shapes);
    state.a11y.shapes = state.shapes;
    $("#shapes-toggle").setAttribute("aria-pressed", String(state.shapes));
    $("#shapes-toggle").classList.toggle("is-on", state.shapes);
  });
}

function buildInstruments() {
  const list = $("#instrument-list");
  list.innerHTML = INSTRUMENTS.map((instrument, index) => {
    const color = state.colors[instrument.id] || instrument.color;
    return `<button class="swatch" data-instrument="${instrument.id}" aria-pressed="false" title="${escapeHtml(instrument.name)} (${index + 1})">
      <span class="dot" style="--swatch:${color}"></span>
      <span class="swatch-name">${escapeHtml(instrument.name)}</span>
      <span class="swatch-key">${index + 1}</span>
    </button>`;
  }).join("");

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-instrument]");
    if (!button) return;
    chooseInstrument(button.dataset.instrument);
  });

  buildPalette();
}

function buildPalette() {
  const palette = $("#paper-palette");
  if (!palette) return;
  palette.innerHTML = INSTRUMENTS.map((instrument, index) => {
    const color = state.colors[instrument.id] || instrument.color;
    return `<button class="pswatch" data-instrument="${instrument.id}" style="--swatch:${color}" aria-pressed="false" aria-label="${escapeHtml(instrument.name)}" title="${escapeHtml(instrument.name)} (${index + 1})"></button>`;
  }).join("");
  palette.addEventListener("click", (event) => {
    const button = event.target.closest("[data-instrument]");
    if (!button) return;
    chooseInstrument(button.dataset.instrument);
  });
}

function chooseInstrument(id) {
  store.setInstrument(id);
  const note = scaleNotes(state)[Math.floor(scaleNotes(state).length / 2)];
  ensureContext()
    .then(() => previewNote(note, id))
    .catch(() => {});
  announce(`${INSTRUMENT_BY_ID[id]?.name || id} selected.`);
}

function clearActiveLayer() {
  const layer = state.layers[state.activeLayer];
  if (!layer.notes.length && !layer.strokes.length) {
    toast("This layer is already empty.");
    return;
  }
  store.clearActiveLayer();
  toast("Layer cleared.");
  announce(`Layer ${state.activeLayer + 1} cleared.`);
}

function buildTools() {
  $$(".tool[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      store.setTool(button.dataset.tool);
    });
  });
  $$("#paper-tools [data-ptool]").forEach((button) => {
    button.addEventListener("click", () => {
      store.setTool(button.dataset.ptool);
      announce(`${button.dataset.ptool === "erase" ? "Erase" : "Draw"} tool.`);
    });
  });
  $("#undo").addEventListener("click", () => {
    if (store.undo()) {
      toast("Undone");
      announce("Undone.");
    }
  });
  $("#paper-undo").addEventListener("click", () => {
    if (store.undo()) {
      toast("Undone");
      announce("Undone.");
    }
  });
  $("#redo").addEventListener("click", () => {
    if (store.redo()) {
      toast("Redone");
      announce("Redone.");
    }
  });
  $("#clear-layer").addEventListener("click", () => {
    clearActiveLayer();
  });
  $("#paper-surprise").addEventListener("click", () => surprise());
  $("#shuffle").addEventListener("click", () => surprise());
}

function buildLayers() {
  const tabs = $$(".layer-tabs [data-layer]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      store.setActiveLayer(Number(tab.dataset.layer));
      announce(`Layer ${Number(tab.dataset.layer) + 1} selected.`);
    });
  });

  const list = $("#layer-list");
  list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-layer-row]");
    if (!row) return;
    const index = Number(row.dataset.layerRow);
    if (event.target.closest("[data-layer-mute]")) {
      store.setLayerFlag(index, "muted", !state.layers[index].muted);
      return;
    }
    if (event.target.closest("[data-layer-solo]")) {
      store.setLayerFlag(index, "solo", !state.layers[index].solo);
      return;
    }
    if (event.target.closest("[data-layer-clear]")) {
      store.setActiveLayer(index);
      store.clearActiveLayer();
      return;
    }
    store.setActiveLayer(index);
  });
}

function renderLayers() {
  const tabs = $$(".layer-tabs [data-layer]");
  tabs.forEach((tab, index) => {
    const active = index === state.activeLayer;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });

  $("#layer-list").innerHTML = state.layers.map((layer, index) => `
    <div class="layer-row ${index === state.activeLayer ? "is-active" : ""}" data-layer-row="${index}">
      <span class="num">${index + 1}</span>
      <span class="name">${escapeHtml(layer.name)}</span>
      <button data-layer-mute="${index}" class="${layer.muted ? "is-on" : ""}" aria-pressed="${layer.muted}" aria-label="Mute layer ${index + 1}">M</button>
      <button data-layer-solo="${index}" class="${layer.solo ? "is-on" : ""}" aria-pressed="${layer.solo}" aria-label="Solo layer ${index + 1}">S</button>
      <button data-layer-clear="${index}" aria-label="Clear layer ${index + 1}">×</button>
    </div>
  `).join("");
}

/* ---------- paper mode ---------- */

const PAPER_KEY = "zabibu-composer-paper-v1";
let paperMode = true;

function initPaperMode() {
  let stored = null;
  try { stored = localStorage.getItem(PAPER_KEY); } catch (err) { stored = null; }
  paperMode = stored === null ? true : stored === "1";
  applyPaperMode(false);
  $("#mode-btn").addEventListener("click", () => {
    paperMode = !paperMode;
    applyPaperMode(true);
  });
  window.addEventListener("resize", () => {
    if (!renderer) return;
    renderer.resize();
    renderer.draw(transport?.isPlaying() ? transport.position() : 0, {
      playing: transport?.isPlaying(),
      cursor: cursorActive ? cursor : null,
    });
  });
}

function applyPaperMode(announceChange) {
  $("#studio").classList.toggle("is-paper", paperMode);
  document.body.classList.toggle("paper-mode", paperMode);
  const button = $("#mode-btn");
  if (button) {
    button.setAttribute("aria-pressed", String(paperMode));
    button.textContent = paperMode ? "Studio" : "Paper";
    button.setAttribute("aria-label", paperMode ? "Open the full studio layout" : "Switch to the paper layout");
  }
  try { localStorage.setItem(PAPER_KEY, paperMode ? "1" : "0"); } catch (err) { /* storage may be blocked */ }
  if (renderer) {
    requestAnimationFrame(() => {
      renderer.resize();
      renderer.draw(transport?.isPlaying() ? transport.position() : 0, {
        playing: transport?.isPlaying(),
        cursor: cursorActive ? cursor : null,
        liveStroke,
      });
    });
  }
  if (announceChange) {
    announce(paperMode ? "Paper mode. The big page is ready to draw on." : "Studio mode. Every control is visible.");
  }
}

/* ---------- canvas ---------- */

function initCanvas() {
  const canvas = $("#score");
  renderer = new ScoreRenderer(canvas, () => state);
  const observer = new ResizeObserver(() => {
    renderer.resize();
    renderer.draw(transport?.isPlaying() ? transport.position() : 0, {
      playing: transport?.isPlaying(),
      cursor: cursorActive ? cursor : null,
    });
  });
  observer.observe($("#canvas-wrap"));

  const pointerPosition = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      nx: (event.clientX - rect.left) / rect.width,
      ny: (event.clientY - rect.top) / rect.height,
    };
  };

  const drawAt = (event) => {
    const { x, y } = pointerPosition(event);
    if (state.tool === "erase") {
      const stroke = renderer.hitTestStroke(x, y, 18);
      if (stroke) {
        store.removeStroke(stroke.id);
        return;
      }
      const hit = renderer.hitTest(x, y, 22);
      if (hit) {
        store.removeNote(hit.id);
        renderer.flash(hit);
      }
      return;
    }
    if (!liveStroke) return;
    const { x: px, y: py } = renderer.normalizePoint(x, y);
    const last = liveStroke.points[liveStroke.points.length - 1];
    if (!last || Math.hypot((px - last.x) * renderer.width, (py - last.y) * renderer.height) > 1.2) {
      liveStroke.points.push({ x: px, y: py });
    }
    // The ink is the score: drawing sounds the pitch under the pen right away.
    const previewMidi = renderer.pitchAtY(y);
    const midi = renderer.yToMidi(y);
    const now = performance.now();
    if (previewMidi !== lastPreviewMidi && now - lastPreviewAt > 32) {
      lastPreviewMidi = previewMidi;
      lastPreviewAt = now;
      ensureContext()
        .then(() => previewNote(previewMidi, state.instrument, { velocity: 0.6, duration: 0.16 }))
        .catch(() => {});
    }
    cursor = { time: renderer.xToTime(x), midi, duration: stepBeats(state) };
    renderer.draw(transport?.isPlaying() ? transport.position() : 0, {
      playing: transport?.isPlaying(),
      cursor: cursorActive ? cursor : null,
      liveStroke,
    });
    $("#canvas-hint").classList.add("is-hidden");
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    ensureContext().catch(() => {});
    drawing = true;
    lastPreviewMidi = -1;
    lastPreviewAt = 0;
    liveStroke = state.tool === "erase" ? null : { instrument: state.instrument, points: [] };
    canvas.setPointerCapture?.(event.pointerId);
    drawAt(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    event.preventDefault();
    drawAt(event);
  });
  const endDraw = () => {
    if (!drawing) return;
    drawing = false;
    if (liveStroke && liveStroke.points.length > 1) {
      store.addStroke(liveStroke);
      const lines = layerLineCount(state.layers[state.activeLayer], state);
      announce(`Line drawn. ${lines} ${lines === 1 ? "note" : "notes"} on layer ${state.activeLayer + 1}.`);
    }
    liveStroke = null;
    renderer.draw(transport?.isPlaying() ? transport.position() : 0, {
      playing: transport?.isPlaying(),
      cursor: cursorActive ? cursor : null,
    });
  };
  canvas.addEventListener("pointerup", endDraw);
  canvas.addEventListener("pointercancel", endDraw);
  canvas.addEventListener("pointerleave", () => {
    if (!drawing) return;
  });

  canvas.addEventListener("focus", () => {
    cursorActive = true;
    if (!cursor.duration) cursor.duration = stepBeats(state) * 0.9;
    renderer.draw(transport?.isPlaying() ? transport.position() : 0, { playing: transport?.isPlaying(), cursor });
    announce("Canvas focused. Arrow keys move the cursor. Enter adds a note. Space plays or stops.");
  });
  canvas.addEventListener("blur", () => {
    cursorActive = false;
    renderer.draw(transport?.isPlaying() ? transport.position() : 0, { playing: transport?.isPlaying(), cursor: null });
  });

  canvas.addEventListener("keydown", (event) => {
    const notes = scaleNotes(state);
    let changed = false;
    if (event.key === "ArrowLeft") {
      cursor.time = Math.max(0, cursor.time - stepBeats(state));
      changed = true;
    } else if (event.key === "ArrowRight") {
      cursor.time = Math.min(state.loopBars * 4 - 0.001, cursor.time + stepBeats(state));
      changed = true;
    } else if (event.key === "ArrowUp") {
      let index = notes.findIndex((midi) => midi >= cursor.midi);
      if (index < 0) index = notes.length - 1;
      cursor.midi = notes[Math.min(notes.length - 1, index + 1)];
      changed = true;
    } else if (event.key === "ArrowDown") {
      let index = notes.findIndex((midi) => midi >= cursor.midi);
      if (index < 0) index = 0;
      cursor.midi = notes[Math.max(0, index - 1)];
      changed = true;
    } else if (event.key === "Enter" || event.key === " ") {
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
        return;
      }
      event.preventDefault();
      store.addNote({
        time: cursor.time,
        midi: cursor.midi,
        duration: cursor.duration || stepBeats(state) * 0.9,
        velocity: 0.8,
        instrument: state.instrument,
      });
      const note = store.currentNotes().find((n) => Math.abs(n.time - cursor.time) < 0.01 && n.midi === cursor.midi);
      if (note) renderer.flash(note);
      ensureContext().then(() => previewNote(cursor.midi, state.instrument)).catch(() => {});
      announce(`Added ${midiToName(cursor.midi)} at bar ${Math.floor(cursor.time / 4) + 1}, beat ${Math.floor(cursor.time % 4) + 1}.`);
      changed = true;
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const hit = renderer.hitTest(renderer.timeToX(cursor.time), renderer.midiToY(cursor.midi), 22);
      if (hit) {
        store.removeNote(hit.id);
        announce("Note removed.");
      }
      changed = true;
    } else if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      const step = stepBeats(state);
      cursor.duration = clamp((cursor.duration || step) + (event.key === "]" ? step : -step), step * 0.5, 4);
      announce(`Note length ${cursor.duration.toFixed(2)} beats.`);
      changed = true;
    } else if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      chooseInstrument(INSTRUMENTS[Number(event.key) - 1].id);
      return;
    } else if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      togglePlay();
      return;
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      transport?.rewind();
      return;
    }
    if (changed) {
      event.preventDefault();
      renderer.draw(transport?.isPlaying() ? transport.position() : 0, {
        playing: transport?.isPlaying(),
        cursor,
      });
      const bar = Math.floor(cursor.time / 4) + 1;
      const beat = Math.floor(cursor.time % 4) + 1;
      announce(`${midiToName(cursor.midi)}, bar ${bar}, beat ${beat}, ${INSTRUMENT_BY_ID[state.instrument]?.name || state.instrument}.`);
    }
  });

  $("#canvas-hint").addEventListener("click", () => openDialog("help"));
}

/* ---------- transport ---------- */

function initTransport() {
  transport = new Transport(() => state, {
    onPlay: () => {
      syncTransport();
      announce("Playing.");
    },
    onStop: () => {
      syncTransport();
      renderer?.draw(0, { playing: false, cursor: cursorActive ? cursor : null });
      announce("Stopped.");
    },
    onNote: (note) => renderer?.flash(note),
  });

  $("#play").addEventListener("click", () => togglePlay());
  $("#rewind").addEventListener("click", () => {
    if (transport.isPlaying()) {
      transport.stop();
      setTimeout(() => transport.play(), 40);
    } else {
      renderer?.draw(0, { playing: false, cursor: cursorActive ? cursor : null });
      $("#position").textContent = "1.1";
    }
  });
  $("#metronome").addEventListener("click", () => {
    store.setSetting("metronome", !state.metronome);
    $("#metronome").setAttribute("aria-pressed", String(state.metronome));
    $("#metronome").classList.toggle("is-on", state.metronome);
  });
  $("#loop").addEventListener("click", () => {
    store.setSetting("loop", !state.loop);
    $("#loop").setAttribute("aria-pressed", String(state.loop));
    $("#loop").classList.toggle("is-on", state.loop);
  });
  $("#tap").addEventListener("click", () => {
    const now = performance.now();
    tapTimes = tapTimes.filter((t) => now - t < 5000);
    tapTimes.push(now);
    if (tapTimes.length > 4) tapTimes.shift();
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i += 1) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const average = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = clamp(Math.round(60000 / average), 40, 220);
      store.setSetting("bpm", bpm);
      toast(`${bpm} BPM`);
    }
  });
  $("#bpm").addEventListener("input", (event) => {
    if (event.target.value === "") return;
    const value = clamp(Number(event.target.value) || 110, 40, 220);
    state.bpm = value;
  });
  $("#bpm").addEventListener("blur", (event) => {
    const value = clamp(Number(event.target.value) || 110, 40, 220);
    event.target.value = value;
    store.setSetting("bpm", value);
  });

  requestAnimationFrame(frame);
}

function togglePlay() {
  if (transport.isPlaying()) {
    transport.stop();
    return;
  }
  const hasContent = state.layers.some((layer) => layer.notes.length || (layer.strokes && layer.strokes.length));
  if (!hasContent && !state.metronome) {
    toast("Draw a line or load a groove first.");
    return;
  }
  ensureContext()
    .then(() => transport.play())
    .catch((err) => toast(err.message || "Audio could not start.", true));
}

let lastFrameAt = 0;

function frame(now) {
  if (transport?.isPlaying()) {
    if (!lastFrameAt || now - lastFrameAt >= 30) {
      lastFrameAt = now;
      const position = transport.position();
      $("#position").textContent = barsToPosition(position);
      renderer?.draw(position, {
        playing: true,
        cursor: cursorActive ? cursor : null,
        liveStroke,
      });
    }
  } else {
    lastFrameAt = 0;
  }
  requestAnimationFrame(frame);
}

function syncTransport() {
  const playing = transport?.isPlaying();
  $("#play").textContent = playing ? "■" : "▶";
  $("#play").setAttribute("aria-label", playing ? "Stop" : "Play");
  $("#rec-dot").hidden = true;
  if (!playing) $("#position").textContent = "1.1";
}

/* ---------- UI sync ---------- */

function syncUI(reason = "change") {
  $("#piece-title").textContent = state.title || "Untitled piece";
  const scaleName = SCALES[state.scale]?.name || state.scale;
  $("#piece-sub").textContent = `${state.loopBars} bars · ${KEYS[state.key]} ${scaleName} · ${state.bpm} BPM`;

  $("#bpm").value = state.bpm;
  $("#tune").value = state.tune;
  $("#key").value = String(state.key);
  $("#scale").value = state.scale;
  $("#range").value = String(state.range);
  $("#quantize").value = state.quantize;
  $("#swing").value = state.swing;
  $("#loop-bars").value = String(state.loopBars);
  $("#octave").textContent = state.octave > 0 ? `+${state.octave}` : String(state.octave);

  renderLayers();
  $$("[data-instrument]").forEach((button) => {
    const active = button.dataset.instrument === state.instrument;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$("#paper-palette [data-instrument]").forEach((button) => {
    button.style.setProperty("--swatch", state.colors[button.dataset.instrument] || INSTRUMENT_BY_ID[button.dataset.instrument]?.color || "#888");
  });
  $$(".tool[data-tool], #paper-tools [data-ptool]").forEach((button) => {
    const active = (button.dataset.tool || button.dataset.ptool) === state.tool;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#grid-toggle").classList.toggle("is-on", state.grid);
  $("#grid-toggle").setAttribute("aria-pressed", String(state.grid));
  $("#names-toggle").classList.toggle("is-on", state.names);
  $("#names-toggle").setAttribute("aria-pressed", String(state.names));
  $("#shapes-toggle").classList.toggle("is-on", state.shapes);
  $("#shapes-toggle").setAttribute("aria-pressed", String(state.shapes));
  $("#metronome").classList.toggle("is-on", state.metronome);
  $("#metronome").setAttribute("aria-pressed", String(state.metronome));
  $("#loop").classList.toggle("is-on", state.loop);
  $("#loop").setAttribute("aria-pressed", String(state.loop));
  syncTransport();
  updateNoteList();
  applyA11y();
  if (renderer) {
    renderer.draw(transport?.isPlaying() ? transport.position() : 0, {
      playing: transport?.isPlaying(),
      cursor: cursorActive ? cursor : null,
      liveStroke,
    });
  }
}

function updateNoteList() {
  const list = $("#note-list");
  if (!list) return;
  const layer = state.layers[state.activeLayer];
  const notes = [...layer.notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const lines = (layer.strokes || [])
    .map((stroke, index) => ({ stroke, index, summary: strokeSummary(stroke, state) }))
    .filter((item) => item.summary)
    .sort((a, b) => a.summary.start - b.summary.start);
  const items = [];
  for (const { stroke, index, summary } of lines.slice(0, 24)) {
    const instrument = INSTRUMENT_BY_ID[stroke.instrument]?.name || stroke.instrument;
    const from = barsToPosition(summary.start);
    const to = barsToPosition(summary.end);
    items.push(
      `<li>Line ${index + 1}: ${escapeHtml(instrument)}, ${summary.notes} ${summary.notes === 1 ? "note" : "notes"}, ${midiToName(summary.low)}–${midiToName(summary.high)}, ${from} to ${to}</li>`
    );
  }
  for (const note of notes.slice(0, 24 - Math.min(items.length, 24))) {
    items.push(`<li>${escapeHtml(noteLabel(note))}</li>`);
  }
  if (lines.length > 24) items.push(`<li>Plus ${lines.length - 24} more lines.</li>`);
  list.innerHTML = items.length ? items.join("") : "<li>No lines on this layer yet. Draw on the paper to make music.</li>";
}

/* ---------- arpeggios ---------- */

function initArpeggios() {
  const chips = $("#genre-chips");
  chips.innerHTML = GENRES.map((genre) => `<button class="genre-chip" data-genre="${genre}" aria-pressed="false">${genre}</button>`).join("");
  chips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-genre]");
    if (!button) return;
    currentGenre = button.dataset.genre;
    renderGenreChips();
    renderArpCards();
  });
  renderGenreChips();
  renderArpCards();

  $("#arp-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-arp]");
    if (!card) return;
    const arp = ARPEGGIOS.find((item) => item.id === card.dataset.arp);
    if (arp) loadArpeggio(arp);
  });
  $("#arp-random").addEventListener("click", () => loadArpeggio(randomArpeggio()));
}

function renderGenreChips() {
  $$("#genre-chips [data-genre]").forEach((button) => {
    const active = button.dataset.genre === currentGenre;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderArpCards() {
  const grid = $("#arp-grid");
  grid.innerHTML = arpeggiosByGenre(currentGenre).map((arp) => `
    <button class="arp-card" data-arp="${arp.id}">
      <h3>${escapeHtml(arp.name)}</h3>
      <p>${escapeHtml(arp.description)}</p>
      <span class="tags">
        <span>${arp.bpm} BPM</span>
        <span>${KEYS[arp.key]}</span>
        <span>${SCALES[arp.scale]?.name || arp.scale}</span>
        <span>${arp.steps === 16 ? "16th" : "8th"}</span>
      </span>
    </button>
  `).join("");
}

function loadArpeggio(arp) {
  const { layers, meta } = buildArpeggio(arp, state);
  store.replaceLayers(layers, meta);
  store.setInstrument(meta.instrument || "pluck");
  store.setActiveLayer(0);
  cursor = { time: 0, midi: scaleNotes(state)[Math.floor(scaleNotes(state).length / 2)], duration: stepBeats(state) };
  closeDialog($("#arpeggio-dialog"));
  toast(`Loaded ${arp.name}`);
  announce(`${arp.name} loaded. ${meta.bpm} beats per minute.`);
  if (transport.isPlaying()) {
    transport.stop();
    setTimeout(() => transport.play(), 60);
  } else if (store.noteCount()) {
    setTimeout(() => transport.play(), 80);
  }
}

/* ---------- samples ---------- */

function initSamples() {
  renderSampleCards();
  $("#sample-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-sample]");
    if (!card) return;
    const sample = SAMPLE_SHAPES.find((item) => item.id === card.dataset.sample);
    if (sample) loadSample(sample);
  });
  $("#sample-random").addEventListener("click", () => loadSample(randomSample()));
}

function renderSampleCards() {
  $("#sample-grid").innerHTML = SAMPLE_SHAPES.map((sample) => `
    <button class="sample-card" data-sample="${sample.id}">
      <span class="sample-preview">${sampleSvg(sample)}</span>
      <h3>${escapeHtml(sample.name)}</h3>
      <p>${escapeHtml(sample.note)}</p>
    </button>
  `).join("");
}

function loadSample(sample, options = {}) {
  const strokes = sample.paths.map((path) => ({
    instrument: state.instrument,
    points: path.map((point) => ({ x: point.x, y: point.y })),
  }));
  store.setLayerContent(state.activeLayer, [], strokes);
  store.setSetting("title", sample.name);
  const lines = layerLineCount(state.layers[state.activeLayer], state);
  closeDialog($("#samples-dialog"));
  toast(`${sample.name} drawn — ${lines} ${lines === 1 ? "note" : "notes"}`);
  announce(`${sample.name} loaded with ${lines} ${lines === 1 ? "note" : "notes"}.`);
  if (!transport.isPlaying() && lines) {
    setTimeout(() => togglePlay(), 100);
  }
}

function surprise() {
  if (Math.random() < 0.35) {
    loadSample(randomSample(), { cycle: true });
  } else {
    loadArpeggio(randomArpeggio());
  }
}

/* ---------- gallery ---------- */

const BUILTINS = [
  { id: "builtin-spiral", kind: "sample", sampleId: "spiral", name: "Spiral", note: "The original sample" },
  { id: "builtin-tidal", kind: "sample", sampleId: "waves3", name: "Tidal", note: "Three waves" },
  { id: "builtin-heart", kind: "sample", sampleId: "heart", name: "Heartbeat", note: "A warm phrase" },
  { id: "builtin-sunrise", kind: "arp", arpId: "afrohouse-sunrise", name: "Afrohouse Sunrise", note: "122 BPM · major" },
  { id: "builtin-rhumba", kind: "arp", arpId: "rhumba-triste", name: "Rhumba Triste", note: "92 BPM · minor" },
  { id: "builtin-ringtune", kind: "ringtune", name: "Zabibu Ring Tune", note: "Made with Composer" },
];

function renderGallery() {
  const builtin = $("#builtin-gallery");
  builtin.innerHTML = BUILTINS.map((item) => `
    <div class="gallery-card">
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.note)}</p>
      <button class="btn btn-ghost" data-builtin="${item.id}">Open</button>
    </div>
  `).join("");

  const saved = $("#saved-gallery");
  const entries = store.listSaved();
  saved.innerHTML = entries.length
    ? entries.map((entry) => `
      <div class="gallery-card">
        <h3>${escapeHtml(entry.name)}</h3>
        <p>${new Date(entry.savedAt).toLocaleString()}</p>
        <div class="gallery-actions">
          <button class="btn btn-ghost" data-saved="${entry.id}">Open</button>
          <button class="btn btn-ghost" data-delete="${entry.id}">Delete</button>
        </div>
      </div>
    `).join("")
    : `<p class="dialog-lead">Nothing saved yet. Use “Save to gallery”.</p>`;
}

function initGallery() {
  $("#builtin-gallery").addEventListener("click", (event) => {
    const button = event.target.closest("[data-builtin]");
    if (!button) return;
    const item = BUILTINS.find((entry) => entry.id === button.dataset.builtin);
    if (!item) return;
    closeDialog($("#gallery-dialog"));
    if (item.kind === "sample") {
      const sample = SAMPLE_SHAPES.find((entry) => entry.id === item.sampleId);
      if (sample) loadSample(sample);
    } else if (item.kind === "arp") {
      const arp = ARPEGGIOS.find((entry) => entry.id === item.arpId);
      if (arp) loadArpeggio(arp);
    } else if (item.kind === "ringtune") {
      loadRingtune();
    }
  });
  $("#saved-gallery").addEventListener("click", (event) => {
    const open = event.target.closest("[data-saved]");
    const del = event.target.closest("[data-delete]");
    if (open) {
      if (store.loadNamed(open.dataset.saved)) {
        closeDialog($("#gallery-dialog"));
        toast("Project opened");
        setTimeout(() => applyBackgroundFromState(), 30);
      }
    } else if (del) {
      store.deleteNamed(del.dataset.delete);
      renderGallery();
    }
  });
}

function loadRingtune() {
  const { layers, meta } = buildArpeggio(RINGTUNE, state);
  store.replaceLayers(layers, meta);
  store.setInstrument(meta.instrument);
  store.setActiveLayer(0);
  closeDialog($("#about-dialog"));
  toast("Playing the Zabibu Technika Ring Tune.");
  announce("Playing the Zabibu Technika Ring Tune.");
  ensureContext().then(() => {
    if (transport.isPlaying()) transport.stop();
    setTimeout(() => transport.play(), 60);
  }).catch(() => {});
}

/* ---------- backgrounds / recolor ---------- */

function initBackgrounds() {
  renderBackgrounds();
  $("#bg-grid").addEventListener("click", (event) => {
    const tile = event.target.closest("[data-bg]");
    if (!tile) return;
    state.background = tile.dataset.bg;
    store.emit("background");
    renderBackgrounds();
    if (state.background === "photo" && state.backgroundImage) applyBackgroundFromState();
  });
  $("#bg-file").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.background = "photo";
      state.backgroundImage = String(reader.result);
      store.emit("background");
      applyBackgroundFromState();
      renderBackgrounds();
      toast("Photo background set.");
    };
    reader.readAsDataURL(file);
  });
}

function renderBackgrounds() {
  const grid = $("#bg-grid");
  grid.innerHTML = BACKGROUNDS.map((background) => {
    const style = background.id === "photo" && state.backgroundImage
      ? `style="background-image:url('${state.backgroundImage}');background-size:cover;background-position:center"`
      : "";
    return `<button class="bg-tile ${state.background === background.id ? "is-active" : ""}" data-bg="${background.id}">
      <span class="bg-swatch bg-${background.id}" ${style}></span>
      <span>${escapeHtml(background.name)}</span>
    </button>`;
  }).join("");
}

function applyBackgroundFromState() {
  if (!state.backgroundImage) {
    renderer?.setPhoto(null);
    return;
  }
  const image = new Image();
  image.onload = () => {
    renderer?.setPhoto(image);
    renderer?.draw(transport?.isPlaying() ? transport.position() : 0, {
      playing: transport?.isPlaying(),
      cursor: cursorActive ? cursor : null,
    });
  };
  image.src = state.backgroundImage;
}

function initRecolor() {
  renderRecolor();
  $("#recolor-grid").addEventListener("input", (event) => {
    const input = event.target.closest("[data-color]");
    if (!input) return;
    state.colors[input.dataset.color] = input.value;
    store.emit("colors");
  });
  $("#recolor-reset").addEventListener("click", () => {
    state.colors = { ...DEFAULT_COLORS };
    store.emit("colors");
    renderRecolor();
  });
}

function renderRecolor() {
  $("#recolor-grid").innerHTML = INSTRUMENTS.map((instrument) => `
    <label class="recolor-row">
      <input type="color" value="${state.colors[instrument.id] || instrument.color}" data-color="${instrument.id}" aria-label="${instrument.name} color">
      <span>${instrument.name}</span>
    </label>
  `).join("");
}

/* ---------- accessibility ---------- */

function initAccessibility() {
  $("#a-speak").addEventListener("change", (event) => {
    store.setA11y("speak", event.target.checked);
    if (event.target.checked) speak("Speech is on.");
  });
  $("#a-contrast").addEventListener("change", (event) => store.setA11y("contrast", event.target.checked));
  $("#a-large").addEventListener("change", (event) => store.setA11y("large", event.target.checked));
  $("#a-motion").addEventListener("change", (event) => store.setA11y("motion", event.target.checked));
  $("#a-names").addEventListener("change", (event) => {
    store.setA11y("names", event.target.checked);
    store.setSetting("names", event.target.checked);
  });
  $("#a-shapes").addEventListener("change", (event) => {
    store.setA11y("shapes", event.target.checked);
    store.setSetting("shapes", event.target.checked);
  });
  $("#voice-start").addEventListener("click", startVoice);
  $("#voice-stop").addEventListener("click", stopVoice);
  applyA11y();
}

function applyA11y() {
  const root = document.documentElement;
  root.classList.toggle("a11y-contrast", Boolean(state.a11y.contrast));
  root.classList.toggle("a11y-large", Boolean(state.a11y.large));
  root.classList.toggle("a11y-motion", Boolean(state.a11y.motion));
  const set = (id, value) => {
    const el = $(id);
    if (el && el.checked !== Boolean(value)) el.checked = Boolean(value);
  };
  set("#a-speak", state.a11y.speak);
  set("#a-contrast", state.a11y.contrast);
  set("#a-large", state.a11y.large);
  set("#a-motion", state.a11y.motion);
  set("#a-names", state.names);
  set("#a-shapes", state.shapes);
}

function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const status = $("#voice-status");
  if (!SpeechRecognition) {
    status.textContent = "Voice commands are not supported in this browser. The keyboard composer still works.";
    return;
  }
  if (voiceOn) return;
  try {
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = false;
    voiceRecognition.lang = "en-US";
    voiceRecognition.onresult = (event) => {
      const transcript = [...event.results].map((result) => result[0].transcript).join(" ");
      status.textContent = `Heard: “${transcript}”`;
      handleVoice(transcript);
    };
    voiceRecognition.onerror = (event) => {
      status.textContent = `Voice error: ${event.error}`;
    };
    voiceRecognition.onend = () => {
      voiceOn = false;
      $("#voice-start").hidden = false;
      $("#voice-stop").hidden = true;
    };
    voiceRecognition.start();
    voiceOn = true;
    $("#voice-start").hidden = true;
    $("#voice-stop").hidden = false;
    status.textContent = "Listening…";
    toast("Voice commands on. Say “play” or “surprise me”.");
  } catch (err) {
    status.textContent = "Voice commands could not start.";
  }
}

function stopVoice() {
  if (voiceRecognition) {
    try { voiceRecognition.stop(); } catch (err) { /* noop */ }
  }
  voiceOn = false;
  $("#voice-start").hidden = false;
  $("#voice-stop").hidden = true;
  $("#voice-status").textContent = "Voice commands off.";
}

function handleVoice(text) {
  const command = text.toLowerCase();
  if (/stop|pause/.test(command)) {
    transport?.stop();
    announce("Stopped.");
  } else if (/play|start/.test(command)) {
    togglePlay();
    announce("Playing.");
  } else if (/add note/.test(command)) {
    store.addNote({
      time: cursor.time,
      midi: cursor.midi,
      duration: cursor.duration || stepBeats(state) * 0.9,
      velocity: 0.8,
      instrument: state.instrument,
    });
    announce(`Added ${midiToName(cursor.midi)}.`);
  } else if (/erase|delete note/.test(command)) {
    const hit = renderer?.hitTest(renderer.timeToX(cursor.time), renderer.midiToY(cursor.midi), 22);
    if (hit) store.removeNote(hit.id);
    announce("Note removed.");
  } else if (/clear/.test(command)) {
    store.clearActiveLayer();
    announce("Layer cleared.");
  } else if (/next instrument/.test(command)) {
    const index = INSTRUMENTS.findIndex((instrument) => instrument.id === state.instrument);
    chooseInstrument(INSTRUMENTS[(index + 1) % INSTRUMENTS.length].id);
  } else if (/previous instrument/.test(command)) {
    const index = INSTRUMENTS.findIndex((instrument) => instrument.id === state.instrument);
    chooseInstrument(INSTRUMENTS[(index - 1 + INSTRUMENTS.length) % INSTRUMENTS.length].id);
  } else if (/surprise|random/.test(command)) {
    surprise();
  } else if (/arpeggio/.test(command)) {
    loadArpeggio(randomArpeggio());
  } else if (/sample|shape/.test(command)) {
    loadSample(randomSample());
  } else if (/undo/.test(command)) {
    store.undo();
    announce("Undone.");
  } else if (/export mp3/.test(command)) {
    runExport("mp3");
  } else if (/export wav/.test(command)) {
    runExport("wav");
  } else if (/ringtone/.test(command)) {
    runExport("ring");
  } else if (/high contrast/.test(command)) {
    store.setA11y("contrast", !state.a11y.contrast);
  } else if (/large/.test(command)) {
    store.setA11y("large", !state.a11y.large);
  } else {
    toast(`Voice command not recognised: “${text}”`);
  }
}

/* ---------- project / export ---------- */

function initProject() {
  $("#save-gallery").addEventListener("click", () => {
    const name = window.prompt("Name this piece", state.title || "Untitled piece");
    if (name === null) return;
    store.saveNamed(name);
    toast("Saved to the gallery.");
    announce("Piece saved to the gallery.");
  });
  $("#open-project").addEventListener("click", () => $("#project-file").click());
  $("#project-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const project = JSON.parse(text);
      store.loadProject(project);
      applyBackgroundFromState();
      toast("Project opened.");
      announce("Project opened.");
    } catch (err) {
      toast("That file could not be opened.", true);
    } finally {
      event.target.value = "";
    }
  });

  $$("[data-export]").forEach((button) => {
    button.addEventListener("click", () => runExport(button.dataset.export));
  });
  $("#export-m4r").addEventListener("click", async () => {
    if (exportBusy) return;
    exportBusy = true;
    setExportBusy(true);
    const wasPlaying = Boolean(transport?.isPlaying());
    if (wasPlaying) transport.stop();
    try {
      await exportM4R(state, {
        onProgress: (value) => {
          setProgress(value);
          setExportStatus(`Rendering iPhone ringtone… ${Math.round(value * 100)}%`);
        },
      });
      setExportStatus("iPhone ringtone downloaded (.m4r).");
      toast("iPhone ringtone downloaded.");
    } catch (err) {
      setExportStatus(err.message || "M4R export is not available.", true);
      toast("M4R export is not available. Try the MP3 ringtone.", true);
    } finally {
      exportBusy = false;
      setExportBusy(false);
      if (wasPlaying) {
        setTimeout(() => {
          try { transport.play(); } catch (err) { /* audio may be blocked */ }
        }, 250);
      }
    }
  });
}

function setExportBusy(busy) {
  $$("[data-export]").forEach((button) => { button.disabled = busy; });
  $("#export-m4r").disabled = busy;
  $("#export-progress").hidden = !busy;
  if (busy) setProgress(0.04);
}

function setProgress(value) {
  const bar = $("#export-progress span");
  if (bar) bar.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
}

function setExportStatus(message, isError = false) {
  const el = $("#export-status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}

async function runExport(kind) {
  if (exportBusy) return;
  exportBusy = true;
  setExportBusy(true);
  const wasPlaying = Boolean(transport?.isPlaying());
  if (wasPlaying) transport.stop();
  const label = { wav: "WAV", mp3: "MP3", mp4: "MP4", ring: "ringtone", midi: "MIDI", project: "project" }[kind] || kind;
  setExportStatus(`Preparing ${label}…`);
  const report = (value, message) => {
    setProgress(value);
    if (message) setExportStatus(message);
  };
  try {
    if (kind === "project") {
      downloadProject(state, JSON.stringify(store.serializeProject()));
    } else {
      report(0.06);
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (kind === "wav") await exportWav(state);
      if (kind === "mp3") {
        await exportMp3(state, {
          onProgress: (value) => report(value, `Encoding MP3… ${Math.round(value * 100)}%`),
        });
      }
      if (kind === "midi") await exportMidi(state);
      if (kind === "ring") {
        await exportRingtone(state, {
          seconds: 30,
          onProgress: (value) => report(value, `Building 30-second ringtone… ${Math.round(value * 100)}%`),
        });
      }
      if (kind === "mp4") {
        await exportVideo(state, {
          onProgress: (value) => {
            report(value, `Rendering MP4… ${Math.round(value * 100)}%`);
          },
        });
      }
      report(1);
    }
    setExportStatus(`${label} downloaded.`);
    toast(`${label} downloaded.`);
    announce(`${label} downloaded.`);
  } catch (err) {
    console.error(err);
    const message = err?.message || `Could not export ${label}.`;
    setExportStatus(message, true);
    toast(message, true);
    announce(message);
  } finally {
    exportBusy = false;
    setExportBusy(false);
    if (wasPlaying) {
      setTimeout(() => {
        try { transport.play(); } catch (err) { /* audio may be blocked */ }
      }, 250);
    }
  }
}

/* ---------- dialogs / help / about ---------- */

function initDialogs() {
  document.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open]");
    if (open) {
      event.preventDefault();
      if (open.hasAttribute("data-close-first")) {
        const current = open.closest("dialog");
        if (current) current.close();
      }
      openDialog(open.dataset.open);
      return;
    }
    const close = event.target.closest("[data-close]");
    if (close) {
      event.preventDefault();
      closeDialog(close);
    }
  });
  $$("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  $("#help-btn").addEventListener("click", () => openDialog("help"));
  $("#background-btn").addEventListener("click", () => openDialog("background"));
  $("#recolor-btn").addEventListener("click", () => openDialog("recolor"));
  $("#access-btn").addEventListener("click", () => openDialog("access"));
  $("#about-start").addEventListener("click", () => {
    closeDialog($("#about-dialog"));
    $("#score").focus();
  });
  $("#play-ringtune").addEventListener("click", loadRingtune);
}

function maybeShowHelp() {
  try {
    if (localStorage.getItem(VISITED_KEY)) return;
    localStorage.setItem(VISITED_KEY, "1");
    if (!store.noteCount()) {
      setTimeout(() => openDialog("help"), 700);
    }
  } catch (err) {
    /* storage unavailable */
  }
}

/* ---------- keyboard shortcuts ---------- */

function initShortcuts() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isField = target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");
    if (isField) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? store.redo() : store.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      store.redo();
      return;
    }
    if (event.key === " " && target?.id !== "score") {
      event.preventDefault();
      togglePlay();
    }
    if (event.key.toLowerCase() === "p" && target?.id !== "score") {
      event.preventDefault();
      togglePlay();
    }
  });
}

/* ---------- service worker ---------- */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  navigator.serviceWorker
    .register("sw.js")
    .then(() => {
      const key = "zabibu-composer-offline-hint-v1";
      const seen = (() => {
        try { return Boolean(localStorage.getItem(key)); } catch (err) { return true; }
      })();
      if (seen) return;
      navigator.serviceWorker.ready.then(() => {
        try { localStorage.setItem(key, "1"); } catch (err) { /* storage may be blocked */ }
        toast("Saved for offline use. The whole studio now works without a connection.");
        announce("Saved for offline use. Zabibu Composer now works without a connection.");
      });
    })
    .catch(() => {});
}

/* ---------- boot ---------- */

function boot() {
  initControls();
  buildInstruments();
  buildTools();
  buildLayers();
  initArpeggios();
  initSamples();
  initGallery();
  initBackgrounds();
  initRecolor();
  initProject();
  initAccessibility();
  initDialogs();
  initShortcuts();
  initCanvas();
  initTransport();
  initPaperMode();
  applyBackgroundFromState();
  store.on((reason) => {
    syncUI(reason);
    if (reason === "project-load") applyBackgroundFromState();
  });
  syncUI("boot");
  maybeShowHelp();
  registerServiceWorker();
  const visited = (() => {
    try { return Boolean(localStorage.getItem(VISITED_KEY)); } catch (err) { return false; }
  })();
  if (visited) $("#canvas-hint").classList.add("is-hidden");
}

boot();
