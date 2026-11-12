import {
  INSTRUMENTS,
  clamp,
  instrumentInfo,
  midiToName,
  scaleNotes,
} from "./config.js";

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const CONTRAST_COLORS = ["#ffe600", "#00e5ff", "#ffffff", "#ff9e00", "#ff5edb", "#7dff6a", "#6ab7ff", "#d9d9d9", "#ffd0a8"];

function isDarkBackground(state) {
  return state.background === "dusk" || state.background === "sunset" || Boolean(state.backgroundImage);
}

const backdropCache = new Map();
const photoCache = new WeakMap();

function paintBackground(ctx, state, width, height, photo) {
  const dark = isDarkBackground(state);
  if (state.backgroundImage && photo && photo.complete) {
    const ratio = Math.max(width / photo.width, height / photo.height);
    const w = photo.width * ratio;
    const h = photo.height * ratio;
    ctx.drawImage(photo, (width - w) / 2, (height - h) / 2, w, h);
    ctx.fillStyle = "rgba(5, 5, 7, 0.22)";
    ctx.fillRect(0, 0, width, height);
    return dark;
  }

  if (state.background === "sky") {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#93b6df");
    gradient.addColorStop(0.6, "#b9cde8");
    gradient.addColorStop(1, "#e9f1f8");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    const sun = ctx.createRadialGradient(width * 0.82, height * 0.16, 0, width * 0.82, height * 0.16, height * 0.36);
    sun.addColorStop(0, "rgba(255,255,255,.95)");
    sun.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, width, height);
    return dark;
  }

  if (state.background === "sunset") {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#f6c177");
    gradient.addColorStop(0.45, "#e2725b");
    gradient.addColorStop(1, "#472d4f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    const sun = ctx.createRadialGradient(width * 0.7, height * 0.36, 0, width * 0.7, height * 0.36, height * 0.32);
    sun.addColorStop(0, "rgba(255,240,190,.85)");
    sun.addColorStop(1, "rgba(255,240,190,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, width, height);
    return dark;
  }

  if (state.background === "dusk") {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#141425");
    gradient.addColorStop(0.55, "#2a223d");
    gradient.addColorStop(1, "#50314f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,.5)";
    for (let i = 0; i < 60; i += 1) {
      const x = (i * 137.5) % width;
      const y = (i * 89.7) % height;
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    return dark;
  }

  ctx.fillStyle = state.a11y?.contrast ? "#000000" : "#f3efe6";
  ctx.fillRect(0, 0, width, height);
  if (!state.a11y?.contrast) {
    ctx.fillStyle = "rgba(107, 94, 72, 0.12)";
    for (let y = 8; y < height; y += 11) {
      for (let x = (y % 22 === 0 ? 0 : 5); x < width; x += 13) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return dark;
}

function drawBackground(ctx, state, width, height, photo, dpr = 1) {
  const dark = isDarkBackground(state);
  const scale = Math.min(2, Math.max(1, dpr));

  if (state.backgroundImage && photo) {
    if (photo.complete && photo.naturalWidth) {
      const cached = photoCache.get(photo);
      if (cached && cached.width === Math.round(width * scale) && cached.height === Math.round(height * scale)) {
        ctx.drawImage(cached.canvas, 0, 0, width, height);
        return dark;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const offscreen = canvas.getContext("2d");
      if (offscreen) {
        offscreen.setTransform(scale, 0, 0, scale, 0, 0);
        paintBackground(offscreen, state, width, height, photo);
        photoCache.set(photo, { canvas, width: canvas.width, height: canvas.height });
        ctx.drawImage(canvas, 0, 0, width, height);
        return dark;
      }
    }
    paintBackground(ctx, state, width, height, photo);
    return dark;
  }

  const key = `${state.background}|${state.a11y?.contrast ? "c" : "n"}|${Math.round(width)}x${Math.round(height)}x${scale}`;
  let canvas = backdropCache.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const offscreen = canvas.getContext("2d");
    if (!offscreen) return paintBackground(ctx, state, width, height, photo);
    offscreen.setTransform(scale, 0, 0, scale, 0, 0);
    paintBackground(offscreen, state, width, height, photo);
    if (backdropCache.size > 6) backdropCache.clear();
    backdropCache.set(key, canvas);
  }
  ctx.drawImage(canvas, 0, 0, width, height);
  return dark;
}

function drawShape(ctx, shape, x, y, r, color, fill = true) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  if (shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.95, y + r * 0.72);
    ctx.lineTo(x - r * 0.95, y + r * 0.72);
    ctx.closePath();
    fill ? ctx.fill() : ctx.stroke();
  } else if (shape === "square") {
    fill ? ctx.fillRect(x - r, y - r, r * 2, r * 2) : ctx.strokeRect(x - r, y - r, r * 2, r * 2);
  } else if (shape === "diamond") {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.1);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r * 1.1);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    fill ? ctx.fill() : ctx.stroke();
  } else if (shape === "ring") {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape === "line") {
    ctx.fillRect(x - r * 1.4, y - 1.5, r * 2.8, 3);
  } else if (shape === "star") {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const radius = i % 2 === 0 ? r * 1.15 : r * 0.45;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    fill ? ctx.fill() : ctx.stroke();
  } else if (shape === "bar") {
    roundedRect(ctx, x - r * 1.6, y - 2.5, r * 3.2, 5, 2.5);
    fill ? ctx.fill() : ctx.stroke();
  } else if (shape === "cross") {
    ctx.fillRect(x - r * 0.9, y - 2, r * 1.8, 4);
    ctx.fillRect(x - 2, y - r * 0.9, 4, r * 1.8);
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    fill ? ctx.fill() : ctx.stroke();
  }
  ctx.restore();
}

export function drawScore(ctx, state, time, width, height, options = {}) {
  const loopBeats = Math.max(1, (state.loopBars || 8) * 4);
  const notes = scaleNotes(state);
  const dark = options.dark ?? isDarkBackground(state);
  const contrast = state.a11y?.contrast;
  const pad = {
    l: width < 560 ? 20 : 38,
    r: 16,
    t: 24,
    b: width < 560 ? 20 : 30,
  };
  const innerW = Math.max(20, width - pad.l - pad.r);
  const innerH = Math.max(20, height - pad.t - pad.b);
  const xForTime = (beat) => pad.l + (Math.max(0, Math.min(loopBeats, beat)) / loopBeats) * innerW;
  const yForIndex = (index) =>
    pad.t + (1 - index / Math.max(1, notes.length - 1)) * innerH;
  const indexForMidi = (midi) => {
    let best = 0;
    let distance = Infinity;
    for (let i = 0; i < notes.length; i += 1) {
      const d = Math.abs(notes[i] - midi);
      if (d < distance) {
        distance = d;
        best = i;
      }
    }
    return best;
  };
  const yForMidi = (midi) => yForIndex(indexForMidi(midi));

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  drawBackground(ctx, state, width, height, options.photo, options.dpr || 1);

  const lineColor = contrast ? "#ffe600" : dark ? "rgba(255,255,255,.22)" : "rgba(26,24,21,.16)";
  const strongColor = contrast ? "#ffe600" : dark ? "rgba(255,255,255,.5)" : "rgba(26,24,21,.32)";
  const labelColor = contrast ? "#ffe600" : dark ? "rgba(255,255,255,.7)" : "rgba(26,24,21,.55)";
  const textColor = contrast ? "#ffe600" : dark ? "rgba(255,255,255,.72)" : "rgba(26,24,21,.6)";
  const axisFont = width < 560 ? "8px ui-monospace, monospace" : "9px ui-monospace, monospace";
  const noteFont = width < 560 ? "7px ui-monospace, monospace" : "8px ui-monospace, monospace";

  if (state.grid !== false) {
    for (let bar = 0; bar <= state.loopBars; bar += 1) {
      const x = xForTime(bar * 4);
      ctx.strokeStyle = bar % 4 === 0 ? strongColor : lineColor;
      ctx.lineWidth = bar % 4 === 0 ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + innerH);
      ctx.stroke();
      if (bar < state.loopBars) {
        ctx.fillStyle = labelColor;
        ctx.font = axisFont;
        ctx.textAlign = "left";
        ctx.fillText(String(bar + 1), x + 4, pad.t - 8);
      }
    }
    for (let beat = 0; beat <= loopBeats; beat += 1) {
      if (beat % 4 === 0) continue;
      const x = xForTime(beat);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + innerH);
      ctx.stroke();
    }
    const step = Math.max(1, Math.floor(notes.length / (height < 420 ? 8 : 14)));
    for (let i = 0; i < notes.length; i += step) {
      const y = yForIndex(i);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + innerW, y);
      ctx.stroke();
      if (state.names !== false) {
        ctx.fillStyle = textColor;
        ctx.font = axisFont;
        ctx.textAlign = "right";
        ctx.fillText(midiToName(notes[i]), pad.l - 6, y + 3);
      }
    }
  }

  const soloed = state.layers.some((layer) => layer.solo);
  const activeIndex = state.activeLayer || 0;
  const flashes = options.flashes || new Map();
  const now = options.now || performance.now();

  const strokeColor = (instrument) => {
    const info = instrumentInfo(state, instrument);
    if (!contrast) return info.color;
    const index = Math.max(0, INSTRUMENTS.findIndex((item) => item.id === instrument));
    return CONTRAST_COLORS[index % CONTRAST_COLORS.length];
  };

  for (let layerIndex = 0; layerIndex < state.layers.length; layerIndex += 1) {
    const layer = state.layers[layerIndex];
    if (layer.muted) continue;
    if (soloed && !layer.solo) continue;
    const active = layerIndex === activeIndex;
    ctx.globalAlpha = active ? 0.72 : 0.2;
    for (const stroke of layer.strokes || []) {
      if (!stroke.points || stroke.points.length < 2) continue;
      const color = strokeColor(stroke.instrument);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const px = pad.l + point.x * innerW;
        const py = pad.t + point.y * innerH;
        index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.globalAlpha = active ? 0.16 : 0.06;
      ctx.lineWidth = active ? 7 : 4.5;
      ctx.stroke();
      ctx.globalAlpha = active ? 0.92 : 0.24;
      ctx.strokeStyle = color;
      ctx.lineWidth = active ? 2.1 : 1.3;
      ctx.stroke();
    }
  }

  if (options.liveStroke && options.liveStroke.points?.length > 1) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = strokeColor(options.liveStroke.instrument);
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    options.liveStroke.points.forEach((point, index) => {
      const px = pad.l + point.x * innerW;
      const py = pad.t + point.y * innerH;
      index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (let layerIndex = 0; layerIndex < state.layers.length; layerIndex += 1) {
    const layer = state.layers[layerIndex];
    if (layer.muted) continue;
    if (soloed && !layer.solo) continue;
    const active = layerIndex === activeIndex;
    const opacity = active ? 1 : 0.34;
    for (const note of layer.notes) {
      const x = xForTime(note.time);
      const y = yForMidi(note.midi);
      const info = instrumentInfo(state, note.instrument);
      const color = contrast
        ? CONTRAST_COLORS[Math.max(0, INSTRUMENTS.findIndex((i) => i.id === note.instrument)) % CONTRAST_COLORS.length]
        : info.color;
      const radius = (active ? 6.5 : 5) + note.velocity * 2.2;
      ctx.globalAlpha = opacity;
      if (state.shapes || state.a11y?.shapes) {
        drawShape(ctx, info.shape, x, y, radius, color);
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      if (state.names !== false && active) {
        ctx.fillStyle = contrast ? "#ffe600" : dark ? "rgba(255,255,255,.88)" : "rgba(0,0,0,.72)";
        ctx.font = noteFont;
        ctx.textAlign = "center";
        ctx.fillText(midiToName(note.midi), x, y - radius - 3);
      }
      const flash = flashes.get(note.id);
      if (flash && flash > now) {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = contrast ? "#fff" : "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  if (time != null && (options.playing || time > 0.001)) {
    const x = xForTime(time);
    ctx.strokeStyle = contrast ? "#ffe600" : "#e8402a";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, pad.t - 4);
    ctx.lineTo(x, pad.t + innerH + 4);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(x, pad.t - 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (options.cursor) {
    const x = xForTime(options.cursor.time);
    const y = yForMidi(options.cursor.midi);
    ctx.strokeStyle = contrast ? "#fff" : "#e8402a";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x, y + 14);
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
    const state = this.getState();
    const notes = scaleNotes(state);
    const width = this.width;
    const height = this.height;
    const pad = {
      l: width < 560 ? 20 : 38,
      r: 16,
      t: 24,
      b: width < 560 ? 20 : 30,
    };
    const innerW = Math.max(20, width - pad.l - pad.r);
    const innerH = Math.max(20, height - pad.t - pad.b);
    return { state, notes, width, height, pad, innerW, innerH };
  }

  timeToX(time) {
    const { state, pad, innerW } = this.layout();
    const loopBeats = Math.max(1, (state.loopBars || 8) * 4);
    return pad.l + (Math.max(0, Math.min(loopBeats, time)) / loopBeats) * innerW;
  }

  xToTime(x) {
    const { pad, innerW } = this.layout();
    const state = this.getState();
    const loopBeats = Math.max(1, (state.loopBars || 8) * 4);
    return Math.max(0, Math.min(loopBeats, ((x - pad.l) / innerW) * loopBeats));
  }

  normalizePoint(x, y) {
    const { pad, innerW, innerH } = this.layout();
    return {
      x: clamp((x - pad.l) / innerW, 0, 1),
      y: clamp((y - pad.t) / innerH, 0, 1),
    };
  }

  midiToY(midi) {
    const { notes, pad, innerH } = this.layout();
    let index = 0;
    let distance = Infinity;
    for (let i = 0; i < notes.length; i += 1) {
      const d = Math.abs(notes[i] - midi);
      if (d < distance) {
        distance = d;
        index = i;
      }
    }
    return pad.t + (1 - index / Math.max(1, notes.length - 1)) * innerH;
  }

  yToMidi(y) {
    const { notes, pad, innerH } = this.layout();
    const norm = 1 - (y - pad.t) / innerH;
    const index = Math.round(Math.max(0, Math.min(1, norm)) * (notes.length - 1));
    return notes[index];
  }

  pitchAtY(y) {
    const { state, pad, innerH } = this.layout();
    const norm = clamp(1 - (y - pad.t) / innerH, 0, 1);
    const base = 48 + (state.key || 0) + (state.octave || 0) * 12;
    return Math.round(base + norm * 12 * Math.max(1, state.range || 2));
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
    const { state, pad, innerW, innerH } = this.layout();
    const active = state.layers[state.activeLayer];
    if (!active || !active.strokes) return null;
    let best = null;
    let bestDistance = radius * radius;
    for (const stroke of active.strokes) {
      const points = stroke.points;
      if (!points || points.length < 2) continue;
      for (let i = 1; i < points.length; i += 1) {
        const ax = pad.l + points[i - 1].x * innerW;
        const ay = pad.t + points[i - 1].y * innerH;
        const bx = pad.l + points[i].x * innerW;
        const by = pad.t + points[i].y * innerH;
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
