import {
  INSTRUMENTS,
  clamp,
  instrumentInfo,
  midiToName,
  scaleNotes,
} from "./config.js";
import { gridRows, midiRow, rowMidi } from "./lines.js";

// The page itself is almost blank. Ink, a playhead, and only the faintest rules
// when the grid is asked for. Everything else lives off the paper.

const CONTRAST_COLORS = ["#ffe600", "#00e5ff", "#ffffff", "#ff9e00", "#ff5edb", "#7dff6a", "#6ab7ff", "#d9d9d9", "#ffd0a8"];

function isDarkBackground(state) {
  return state.background === "dusk" || state.background === "sunset" || Boolean(state.backgroundImage);
}

function drawBackdrop(ctx, state, width, height, photo) {
  if (state.backgroundImage && photo && photo.complete && photo.naturalWidth) {
    const ratio = Math.max(width / photo.width, height / photo.height);
    const w = photo.width * ratio;
    const h = photo.height * ratio;
    ctx.drawImage(photo, (width - w) / 2, (height - h) / 2, w, h);
    ctx.fillStyle = "rgba(5, 5, 7, 0.2)";
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (state.background === "sky") {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#a9c4e2");
    gradient.addColorStop(0.62, "#c8daee");
    gradient.addColorStop(1, "#eef4f9");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (state.background === "sunset") {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#f3bd77");
    gradient.addColorStop(0.5, "#e0775f");
    gradient.addColorStop(1, "#4a304f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (state.background === "dusk") {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#131324");
    gradient.addColorStop(0.6, "#29223c");
    gradient.addColorStop(1, "#4c304d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  ctx.fillStyle = state.a11y?.contrast ? "#000000" : "#fffefb";
  ctx.fillRect(0, 0, width, height);
}

function hash(number) {
  let value = (Math.imul(number | 0, 2654435761) + 97) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function strokeSeed(stroke, index) {
  if (typeof stroke.id === "number") return stroke.id;
  const text = String(stroke.id || index);
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (Math.imul(value, 31) + text.charCodeAt(i)) >>> 0;
  return value;
}

function drawInk(ctx, points, color, width, height, alpha, seed, contrast) {
  if (!points || points.length < 1) return;
  const k = Math.min(1.35, Math.max(0.9, width / 620));
  const rand = hash(seed);
  const core = (2.1 + rand() * 0.7) * k;
  const path = new Path2D();
  let first = true;
  for (const point of points) {
    const x = point.x * width;
    const y = point.y * height;
    if (first || point.brk) {
      path.moveTo(x, y);
      first = false;
    } else {
      path.lineTo(x, y);
    }
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.setLineDash([]);
  ctx.lineWidth = core;
  ctx.stroke(path);

  if (!contrast) {
    ctx.globalAlpha = alpha * (0.32 + rand() * 0.18);
    ctx.lineWidth = core + (1.1 + rand() * 0.7) * k;
    ctx.setLineDash([(0.6 + rand() * 0.5) * k, (2.6 + rand() * 1.6) * k]);
    ctx.lineDashOffset = rand() * 10;
    ctx.stroke(path);

    ctx.globalAlpha = alpha * (0.16 + rand() * 0.13);
    ctx.lineWidth = core + (2.1 + rand() * 0.9) * k;
    ctx.setLineDash([(0.5 + rand() * 0.4) * k, (5.5 + rand() * 4) * k]);
    ctx.lineDashOffset = rand() * 10;
    ctx.stroke(path);
  }

  ctx.globalAlpha = alpha;
  ctx.setLineDash([]);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const prevConnected = i > 0 && !point.brk && points[i - 1].x !== point.x;
    const nextConnected = i + 1 < points.length && !points[i + 1].brk && points[i + 1].x !== point.x;
    if (!prevConnected && !nextConnected) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 2.6 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawShape(ctx, shape, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  if (shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.95, y + r * 0.72);
    ctx.lineTo(x - r * 0.95, y + r * 0.72);
    ctx.closePath();
    ctx.fill();
  } else if (shape === "square") {
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  } else if (shape === "diamond") {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.1);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r * 1.1);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
  } else if (shape === "ring") {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape === "line") {
    ctx.fillRect(x - r * 1.3, y - 1.3, r * 2.6, 2.6);
  } else if (shape === "star") {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const radius = i % 2 === 0 ? r * 1.1 : r * 0.43;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  } else if (shape === "bar") {
    ctx.fillRect(x - r * 1.5, y - 2, r * 3, 4);
  } else if (shape === "cross") {
    ctx.fillRect(x - r * 0.9, y - 1.8, r * 1.8, 3.6);
    ctx.fillRect(x - 1.8, y - r * 0.9, 3.6, r * 1.8);
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawScore(ctx, state, time, width, height, options = {}) {
  const loopBeats = Math.max(1, (state.loopBars || 4) * 4);
  const dark = options.dark ?? isDarkBackground(state);
  const contrast = state.a11y?.contrast;
  const showGrid = Boolean(state.grid);
  const showNames = showGrid && state.names !== false;
  const xForTime = (beat) => (clamp(beat, 0, loopBeats) / loopBeats) * width;
  const notes = scaleNotes(state);
  const rows = gridRows();
  const yForRow = (row) => height - ((row + 0.5) / rows) * height;
  const yForMidi = (midi) => yForRow(midiRow(state, midi));
  const strokeColor = (instrument) => {
    const info = instrumentInfo(state, instrument);
    if (!contrast) return info.color;
    const index = Math.max(0, INSTRUMENTS.findIndex((item) => item.id === instrument));
    return CONTRAST_COLORS[index % CONTRAST_COLORS.length];
  };

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  drawBackdrop(ctx, state, width, height, options.photo);

  if (showGrid) {
    // Pitch rows and beats. Roots a shade darker, bars darker still.
    const rowColor = contrast
      ? "rgba(255,230,0,.35)"
      : dark
        ? "rgba(255,255,255,.12)"
        : "rgba(138,135,126,.10)";
    const rootColor = contrast
      ? "rgba(255,230,0,.7)"
      : dark
        ? "rgba(255,255,255,.3)"
        : "rgba(138,135,126,.22)";
    const beatColor = contrast
      ? "rgba(255,230,0,.45)"
      : dark
        ? "rgba(255,255,255,.16)"
        : "rgba(138,135,126,.12)";
    const barColor = contrast
      ? "rgba(255,230,0,.8)"
      : dark
        ? "rgba(255,255,255,.4)"
        : "rgba(138,135,126,.32)";

    let lastMidi = null;
    for (let row = 0; row < rows; row += 1) {
      const midi = rowMidi(state, row);
      if (row > 0) {
        const isRoot = ((midi % 12) + 12) % 12 === ((state.key || 0) % 12);
        ctx.strokeStyle = isRoot ? rootColor : rowColor;
        ctx.lineWidth = 1;
        const y = Math.round(yForRow(row)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      if (showNames && midi !== lastMidi && row % 2 === 0) {
        ctx.fillStyle = contrast
          ? "rgba(255,230,0,.8)"
          : dark
            ? "rgba(255,255,255,.55)"
            : "rgba(26,25,22,.42)";
        ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(midiToName(midi), 6, yForRow(row));
      }
      lastMidi = midi;
    }

    const beats = Math.max(1, Math.round(loopBeats));
    for (let beat = 1; beat < beats; beat += 1) {
      const x = Math.round(xForTime(beat)) + 0.5;
      ctx.strokeStyle = beat % 4 === 0 ? barColor : beatColor;
      ctx.lineWidth = beat % 4 === 0 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  const soloed = state.layers.some((layer) => layer.solo);
  const activeIndex = state.activeLayer || 0;

  // Composed notes (arpeggios, the keyboard composer) are quiet dots under the
  // ink, not a second score.
  for (let layerIndex = 0; layerIndex < state.layers.length; layerIndex += 1) {
    const layer = state.layers[layerIndex];
    if (layer.muted || (soloed && !layer.solo)) continue;
    const active = layerIndex === activeIndex;
    for (const note of layer.notes || []) {
      const x = xForTime(note.time);
      const y = yForMidi(note.midi);
      const info = instrumentInfo(state, note.instrument);
      const color = contrast
        ? CONTRAST_COLORS[Math.max(0, INSTRUMENTS.findIndex((item) => item.id === note.instrument)) % CONTRAST_COLORS.length]
        : info.color;
      const radius = (active ? 3.2 : 2.4) + (note.velocity || 0.7) * 1.2;
      ctx.globalAlpha = active ? 0.72 : 0.28;
      if (state.shapes || state.a11y?.shapes) {
        drawShape(ctx, info.shape, x, y, radius + 1, color);
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  // Ink.
  for (let layerIndex = 0; layerIndex < state.layers.length; layerIndex += 1) {
    const layer = state.layers[layerIndex];
    if (layer.muted || (soloed && !layer.solo)) continue;
    const active = layerIndex === activeIndex;
    const alpha = active ? 1 : 0.26;
    (layer.strokes || []).forEach((stroke, index) => {
      if (!stroke.points || stroke.points.length < 1) return;
      drawInk(
        ctx,
        stroke.points,
        strokeColor(stroke.instrument),
        width,
        height,
        alpha,
        strokeSeed(stroke, index),
        contrast
      );
    });
  }

  if (options.liveStroke && options.liveStroke.points?.length) {
    drawInk(
      ctx,
      options.liveStroke.points,
      strokeColor(options.liveStroke.instrument),
      width,
      height,
      0.95,
      Date.now() & 0xffff,
      contrast
    );
  }

  // The playhead: a thin line, and a dark dot wherever it crosses the ink.
  if (time != null && (options.playing || time > 0.001)) {
    const x = xForTime(time);
    if (options.playing) {
      const nx = clamp(time / loopBeats, 0, 1);
      for (let layerIndex = 0; layerIndex < state.layers.length; layerIndex += 1) {
        const layer = state.layers[layerIndex];
        if (layer.muted || (soloed && !layer.solo)) continue;
        const active = layerIndex === activeIndex;
        for (const stroke of layer.strokes || []) {
          const points = stroke.points;
          if (!points || points.length < 2) continue;
          ctx.fillStyle = contrast ? "#ffe600" : dark ? "#fff" : "#1a1916";
          ctx.globalAlpha = active ? 1 : 0.4;
          let lastY = null;
          for (let i = 1; i < points.length; i += 1) {
            const a = points[i - 1];
            const b = points[i];
            if (b.brk) continue;
            if ((a.x - nx) * (b.x - nx) > 0 || a.x === b.x) continue;
            const t = (nx - a.x) / (b.x - a.x);
            const py = (a.y + (b.y - a.y) * t) * height;
            if (lastY === null || Math.abs(py - lastY) > 6) {
              ctx.beginPath();
              ctx.arc(x, py, 4.5, 0, Math.PI * 2);
              ctx.fill();
              lastY = py;
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = contrast ? "#ffe600" : dark ? "rgba(255,255,255,.75)" : "rgba(26,25,22,.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  if (options.cursor) {
    const x = xForTime(options.cursor.time);
    const y = yForMidi(options.cursor.midi);
    ctx.strokeStyle = contrast ? "#fff" : "#1a1916";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 13, y);
    ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x, y + 13);
    ctx.stroke();
  }

  ctx.restore();
}

export class ScoreRenderer {
  constructor(canvas, getState, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.getState = getState;
    this.options = options;
    this.photo = null;
    this.flashes = new Map();
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || 800);
    const height = Math.max(1, rect.height || 500);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setPhoto(image) {
    this.photo = image;
  }

  flash(note) {
    if (!note) return;
    if (this.flashes.size > 400) this.flashes.clear();
    this.flashes.set(note.id, performance.now() + 240);
  }

  layout() {
    return {
      state: this.getState(),
      width: this.width,
      height: this.height,
    };
  }

  timeToX(time) {
    const state = this.getState();
    const loopBeats = Math.max(1, (state.loopBars || 4) * 4);
    return (clamp(time, 0, loopBeats) / loopBeats) * this.width;
  }

  xToTime(x) {
    const state = this.getState();
    const loopBeats = Math.max(1, (state.loopBars || 4) * 4);
    return clamp((x / Math.max(1, this.width)) * loopBeats, 0, loopBeats);
  }

  normalizePoint(x, y) {
    return {
      x: clamp(x / Math.max(1, this.width), 0, 1),
      y: clamp(y / Math.max(1, this.height), 0, 1),
    };
  }

  midiToY(midi) {
    return this.height - ((midiRow(this.getState(), midi) + 0.5) / gridRows()) * this.height;
  }

  yToMidi(y) {
    const row = Math.round((1 - clamp(y / Math.max(1, this.height), 0, 1)) * (gridRows() - 1));
    return rowMidi(this.getState(), row);
  }

  pitchAtY(y) {
    return this.yToMidi(y);
  }

  hitTest(x, y, radius = 14) {
    const state = this.getState();
    const active = state.layers[state.activeLayer];
    if (!active) return null;
    let best = null;
    let bestDistance = radius * radius;
    for (const note of active.notes) {
      const dx = this.timeToX(note.time) - x;
      const dy = this.midiToY(note.midi) - y;
      const d = dx * dx + dy * dy;
      if (d <= bestDistance) {
        bestDistance = d;
        best = note;
      }
    }
    return best;
  }

  hitTestStroke(x, y, radius = 14) {
    const state = this.getState();
    const active = state.layers[state.activeLayer];
    if (!active || !active.strokes) return null;
    let best = null;
    let bestDistance = radius * radius;
    for (const stroke of active.strokes) {
      const points = stroke.points;
      if (!points || points.length < 2) continue;
      for (let i = 1; i < points.length; i += 1) {
        const ax = points[i - 1].x * this.width;
        const ay = points[i - 1].y * this.height;
        const bx = points[i].x * this.width;
        const by = points[i].y * this.height;
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / lengthSq, 0, 1) : 0;
        const px = ax + dx * t;
        const py = ay + dy * t;
        const distance = (x - px) * (x - px) + (y - py) * (y - py);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = stroke;
        }
      }
    }
    return best;
  }

  draw(playhead = 0, options = {}) {
    this.resize();
    const state = this.getState();
    drawScore(this.ctx, state, playhead, this.width, this.height, {
      photo: this.photo,
      flashes: this.flashes,
      now: performance.now(),
      playing: options.playing,
      cursor: options.cursor,
      liveStroke: options.liveStroke,
      dpr: this.dpr,
    });
  }
}

export function renderFrame(canvas, state, time, options = {}) {
  const ctx = canvas.getContext("2d");
  const width = options.width || canvas.width;
  const height = options.height || canvas.height;
  drawScore(ctx, state, time, width, height, options);
}
