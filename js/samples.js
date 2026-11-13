function line(x0, y0, x1, y1, steps = 48) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
  }
  return points;
}

function wave(x0, y, x1, amp, n, steps = 90) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push({ x: x0 + (x1 - x0) * t, y: y + Math.sin(t * n * Math.PI * 2) * amp });
  }
  return points;
}

function circle(cx, cy, r, steps = 72) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return points;
}

function arc(cx, cy, r, a0, a1, steps = 48) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + (a1 - a0) * (i / steps);
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return points;
}

function zig(x0, y, x1, amp, n) {
  const points = [];
  for (let i = 0; i <= n; i += 1) {
    points.push({ x: x0 + (x1 - x0) * (i / n), y: y + (i % 2 ? -amp : amp) });
  }
  return points;
}

function spiral(cx, cy, r, turns = 3, steps = 140) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const radius = r * t;
    points.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return points;
}

function heart() {
  const points = [];
  for (let i = 0; i <= 100; i += 1) {
    const t = (i / 100) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    points.push({ x: 0.5 + x / 38, y: 0.48 - y / 36 });
  }
  return points;
}

function star() {
  const points = [];
  for (let i = 0; i <= 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 0.34 : 0.15;
    points.push({ x: 0.5 + Math.cos(angle) * r, y: 0.48 + Math.sin(angle) * r });
  }
  return points;
}

function flower() {
  const points = [];
  for (let i = 0; i <= 180; i += 1) {
    const t = (i / 180) * Math.PI * 2;
    const r = 0.28 + 0.12 * Math.cos(5 * t);
    points.push({ x: 0.5 + Math.cos(t) * r, y: 0.48 + Math.sin(t) * r });
  }
  return points;
}

function infinity() {
  const points = [];
  for (let i = 0; i <= 140; i += 1) {
    const t = (i / 140) * Math.PI * 2;
    const scale = 0.33;
    points.push({
      x: 0.5 + (scale * Math.cos(t)) / (1 + Math.sin(t) * Math.sin(t)),
      y: 0.48 + (scale * Math.sin(t) * Math.cos(t)) / (1 + Math.sin(t) * Math.sin(t)),
    });
  }
  return points;
}

function lissajous() {
  const points = [];
  for (let i = 0; i <= 180; i += 1) {
    const t = (i / 180) * Math.PI * 2;
    points.push({ x: 0.5 + Math.sin(3 * t) * 0.35, y: 0.48 + Math.sin(2 * t + Math.PI / 4) * 0.3 });
  }
  return points;
}

function staircase() {
  const points = [];
  const steps = 7;
  for (let i = 0; i <= steps; i += 1) {
    const x = 0.1 + (i / steps) * 0.8;
    const y = 0.78 - (i / steps) * 0.56;
    points.push({ x, y });
    if (i < steps) points.push({ x: 0.1 + ((i + 1) / steps) * 0.8, y });
  }
  return points;
}

function orbit() {
  return [
    circle(0.5, 0.48, 0.14, 48),
    circle(0.5, 0.48, 0.3, 72),
    circle(0.72, 0.32, 0.045, 24),
  ];
}

function sunrise() {
  return [
    arc(0.5, 0.72, 0.25, Math.PI, Math.PI * 2, 48),
    line(0.08, 0.72, 0.92, 0.72, 24),
    ...Array.from({ length: 7 }, (_, i) => {
      const a = Math.PI + (i / 6) * Math.PI;
      return line(0.5 + Math.cos(a) * 0.2, 0.72 + Math.sin(a) * 0.2, 0.5 + Math.cos(a) * 0.32, 0.72 + Math.sin(a) * 0.32, 4);
    }),
  ];
}

export const SAMPLE_SHAPES = [
  { id: "line", name: "Line", note: "A single slide", paths: [line(0.08, 0.62, 0.92, 0.34)] },
  { id: "waves", name: "Two waves", note: "A gentle call and answer", paths: [wave(0.08, 0.46, 0.92, 0.12, 2), wave(0.08, 0.68, 0.92, 0.06, 4)] },
  { id: "circle", name: "Circle & line", note: "A loop with a floor", paths: [circle(0.5, 0.44, 0.22), line(0.2, 0.8, 0.8, 0.8)] },
  { id: "zigzag", name: "Zigzag", note: "A bright, bouncing line", paths: [zig(0.08, 0.55, 0.92, 0.16, 6), circle(0.76, 0.24, 0.07)] },
  { id: "arc", name: "Arc & line", note: "A rise and a settle", paths: [arc(0.5, 0.7, 0.33, Math.PI, Math.PI * 2), line(0.14, 0.72, 0.86, 0.72), circle(0.5, 0.28, 0.07)] },
  { id: "cross", name: "Cross", note: "A bold diagonal duet", paths: [line(0.1, 0.85, 0.9, 0.15), line(0.1, 0.15, 0.9, 0.85), circle(0.5, 0.5, 0.14)] },
  { id: "waves3", name: "Three waves", note: "A rolling chord", paths: [wave(0.05, 0.3, 0.95, 0.05, 3), wave(0.05, 0.52, 0.95, 0.08, 3), wave(0.05, 0.76, 0.95, 0.05, 3)] },
  { id: "spiral", name: "Spiral", note: "The original shape", paths: [spiral(0.5, 0.5, 0.34)] },
  { id: "heart", name: "Heart", note: "A warm, symmetrical phrase", paths: [heart()] },
  { id: "star", name: "Star", note: "A bright, pointed melody", paths: [star()] },
  { id: "flower", name: "Flower", note: "A five-petal loop", paths: [flower()] },
  { id: "infinity", name: "Infinity", note: "A figure-eight groove", paths: [infinity()] },
  { id: "lissajous", name: "Lissajous", note: "A woven, glassy line", paths: [lissajous()] },
  { id: "staircase", name: "Staircase", note: "A rising step pattern", paths: [staircase()] },
  { id: "orbit", name: "Orbit", note: "Two circles and a moon", paths: orbit() },
  { id: "sunrise", name: "Sunrise", note: "An arc with rays", paths: sunrise() },
];

export function sampleSvg(sample) {
  const parts = sample.paths.map((path) => {
    const d = path.map((point, i) => `${i === 0 ? "M" : "L"}${(point.x * 100).toFixed(1)} ${(point.y * 70).toFixed(1)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  return `<svg viewBox="0 0 100 70" role="img" aria-label="${sample.name} sample drawing">${parts.join("")}</svg>`;
}

export function randomSample(exceptId) {
  const pool = SAMPLE_SHAPES.filter((sample) => sample.id !== exceptId);
  return pool[Math.floor(Math.random() * pool.length)];
}
