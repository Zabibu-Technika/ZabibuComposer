import {
  beatsToSeconds,
  clamp,
  instrumentInfo,
  midiToFreq,
  scaleNotes,
  stepBeats,
  swingAmount,
} from "./config.js";
import { strokeEvents } from "./lines.js";

let audioContext = null;
let previewGraph = null;

export async function ensureContext() {
  if (!audioContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error("This browser does not support the Web Audio API.");
    audioContext = new Ctor({ latencyHint: "interactive" });
  }
  if (audioContext.state === "suspended") await audioContext.resume();
  return audioContext;
}

export function getContext() {
  return audioContext;
}

function makeNoise(ctx, seconds = 0.5) {
  if (!ctx.__zcNoise) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    ctx.__zcNoise = buffer;
  }
  return ctx.__zcNoise;
}

function makeImpulse(ctx, seconds = 3.2, decay = 2.5) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const reflections = [0.011, 0.019, 0.031, 0.047, 0.071, 0.103];
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      // A darker, tape-like tail: one-pole smoothing removes the fizzy top.
      smooth = smooth * 0.74 + (Math.random() * 2 - 1) * 0.26;
      data[i] = smooth * Math.pow(1 - t, decay);
    }
    reflections.forEach((time, index) => {
      const position = Math.floor(time * ctx.sampleRate * (1 + channel * 0.07));
      if (position < length) data[position] += (index % 2 === 0 ? 0.42 : -0.3) * (1 - index / reflections.length);
    });
    let peak = 0;
    for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) for (let i = 0; i < length; i += 1) data[i] /= peak;
  }
  return buffer;
}

function softClipCurve(amount = 1.4) {
  const size = 2048;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

function noiseBurst(ctx, out, when, { frequency = 2200, q = 1, amp = 0.07, duration = 0.035, type = "bandpass" } = {}) {
  const source = ctx.createBufferSource();
  source.buffer = makeNoise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(0.0001, amp), when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  source.start(when);
  source.stop(when + duration + 0.02);
}

function envelope(param, when, {
  attack = 0.005,
  decay = 0.18,
  sustain = 0.35,
  release = 0.35,
  duration = 0.5,
  peak = 0.2,
} = {}) {
  const t0 = when;
  const t1 = t0 + attack;
  const t2 = t1 + decay;
  const t3 = Math.max(t2, t0 + duration);
  const t4 = t3 + release;
  param.cancelScheduledValues(t0);
  param.setValueAtTime(0.0001, t0);
  param.linearRampToValueAtTime(Math.max(0.0001, peak), t1);
  param.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain), t2);
  param.setValueAtTime(Math.max(0.0001, peak * sustain), t3);
  param.exponentialRampToValueAtTime(0.0001, t4);
  return t4;
}

// Drawn lines slide: a run of ink carries a pitch ramp into the next run, so a
// diagonal reads as a glissando and a flat line holds still.
function glide(param, fromFreq, toMidi, when, duration, tune = 0, ratio = 1) {
  if (toMidi == null) return;
  const target = midiToFreq(toMidi, tune) * ratio;
  if (!Number.isFinite(target) || Math.abs(target - fromFreq) < 0.5) return;
  param.setValueAtTime(Math.max(8, fromFreq), when);
  param.exponentialRampToValueAtTime(Math.max(8, target), when + Math.max(0.04, Math.min(duration, 4)));
}

export function buildGraph(ctx, state, destination = ctx.destination, options = {}) {
  const master = ctx.createGain();
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  eqLow.frequency.value = 140;
  eqLow.gain.value = 1.1;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  eqMid.frequency.value = 1250;
  eqMid.Q.value = 0.7;
  eqMid.gain.value = -0.6;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";
  eqHigh.frequency.value = 6200;
  eqHigh.gain.value = 1.4;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 20;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.008;
  comp.release.value = 0.26;

  const warmth = ctx.createWaveShaper();
  warmth.curve = softClipCurve(1.35);
  warmth.oversample = "2x";

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;

  master.gain.value = 0.86;
  master.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(comp);
  comp.connect(warmth);
  warmth.connect(limiter);
  limiter.connect(destination);

  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(master);

  const reverb = options.reverbSeconds === 0 ? ctx.createGain() : ctx.createConvolver();
  if (options.reverbSeconds === 0) reverb.gain.value = 0;
  else reverb.buffer = makeImpulse(ctx, options.reverbSeconds ?? 3.2, 2.2);
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = 0.27;
  reverb.connect(reverbGain);
  reverbGain.connect(bus);

  const delay = ctx.createDelay(2);
  delay.delayTime.value = (60 / Math.max(40, state.bpm || 110)) * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.22;
  delay.connect(feedback);
  feedback.connect(delay);

  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 2600;
  const delayGain = ctx.createGain();
  delayGain.gain.value = 0.13;
  delay.connect(delayFilter);
  delayFilter.connect(delayGain);
  delayGain.connect(bus);

  return { master, warmth, bus, reverb, reverbGain, delay, feedback, delayFilter, delayGain, comp, limiter };
}

function scheduleKeys(ctx, out, note, when, amp) {
  const freq = midiToFreq(note.midi, note.tune);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(Math.min(7600, freq * 9), when);
  filter.frequency.exponentialRampToValueAtTime(Math.max(650, freq * 2.4), when + 0.55);

  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.value = freq;
  body.connect(filter);

  const tine = ctx.createOscillator();
  tine.type = "sine";
  tine.frequency.value = freq * 2.004;
  const tineGain = ctx.createGain();
  tineGain.gain.value = 0.2;
  tine.connect(tineGain);
  tineGain.connect(filter);

  const warmth = ctx.createOscillator();
  warmth.type = "sawtooth";
  warmth.frequency.value = freq;
  warmth.detune.value = -6;
  const warmthGain = ctx.createGain();
  warmthGain.gain.value = 0.1;
  warmth.connect(warmthGain);
  warmthGain.connect(filter);

  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = freq / 2;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.14;
  sub.connect(subGain);
  subGain.connect(filter);

  glide(body.frequency, freq, note.pitchTo, when, note.duration, note.tune);
  glide(tine.frequency, freq * 2.004, note.pitchTo, when, note.duration, note.tune, 2.004);
  glide(warmth.frequency, freq, note.pitchTo, when, note.duration, note.tune);
  glide(sub.frequency, freq / 2, note.pitchTo, when, note.duration, note.tune, 0.5);

  filter.connect(out);
  envelope(out.gain, when, { attack: 0.004, decay: 0.3, sustain: 0.34, release: 0.55, duration: note.duration, peak: amp });
  noiseBurst(ctx, out, when, { frequency: 2900, q: 0.9, amp: amp * 0.16, duration: 0.02 });
  for (const osc of [body, tine, warmth, sub]) {
    osc.start(when);
    osc.stop(when + note.duration + 0.7);
  }
}

function schedulePluck(ctx, out, note, when, amp) {
  const freq = midiToFreq(note.midi, note.tune);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 3.4;
  filter.frequency.setValueAtTime(Math.min(9600, freq * 14), when);
  filter.frequency.exponentialRampToValueAtTime(Math.max(380, freq * 1.9), when + 0.26);

  [-5, 5].forEach((cents, index) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.detune.value = cents;
    glide(osc.frequency, freq, note.pitchTo, when, note.duration, note.tune);
    const gain = ctx.createGain();
    gain.gain.value = index === 0 ? 0.82 : 0.5;
    osc.connect(gain);
    gain.connect(filter);
    osc.start(when);
    osc.stop(when + note.duration + 0.4);
  });

  const pick = ctx.createOscillator();
  pick.type = "triangle";
  pick.frequency.value = freq * 2.006;
  glide(pick.frequency, freq * 2.006, note.pitchTo, when, note.duration, note.tune, 2.006);
  const pickGain = ctx.createGain();
  pickGain.gain.value = 0.12;
  pick.connect(pickGain);
  pickGain.connect(filter);
  pick.start(when);
  pick.stop(when + 0.3);

  filter.connect(out);
  envelope(out.gain, when, { attack: 0.002, decay: 0.18, sustain: 0.1, release: 0.26, duration: note.duration, peak: amp });
  noiseBurst(ctx, out, when, { frequency: 3400, q: 0.7, amp: amp * 0.22, duration: 0.018 });
}

function scheduleBell(ctx, out, note, when, amp) {
  const freq = midiToFreq(note.midi, note.tune);
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = freq * 3.51;
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(freq * 1.1, when);
  modGain.gain.exponentialRampToValueAtTime(1, when + 0.7);
  mod.connect(modGain);
  modGain.connect(carrier.frequency);
  const shimmer = ctx.createOscillator();
  shimmer.type = "sine";
  shimmer.frequency.value = freq * 2.01;
  const shimmerGain = ctx.createGain();
  shimmerGain.gain.value = 0.18;
  carrier.connect(out);
  shimmer.connect(shimmerGain);
  shimmerGain.connect(out);
  glide(carrier.frequency, freq, note.pitchTo, when, note.duration, note.tune);
  glide(shimmer.frequency, freq * 2.01, note.pitchTo, when, note.duration, note.tune, 2.01);
  glide(mod.frequency, freq * 3.51, note.pitchTo, when, note.duration, note.tune, 3.51);
  envelope(out.gain, when, { attack: 0.004, decay: 0.55, sustain: 0.18, release: 1.8, duration: Math.max(note.duration, 0.6), peak: amp });
  carrier.start(when);
  mod.start(when);
  shimmer.start(when);
  const stop = when + Math.max(note.duration, 0.6) + 2;
  carrier.stop(stop);
  mod.stop(stop);
  shimmer.stop(stop);
}

function scheduleMarimba(ctx, out, note, when, amp) {
  const freq = midiToFreq(note.midi, note.tune);
  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.value = freq;
  body.connect(out);

  const edge = ctx.createOscillator();
  edge.type = "triangle";
  edge.frequency.value = freq * 3.95;
  const edgeGain = ctx.createGain();
  edgeGain.gain.value = 0.14;
  edge.connect(edgeGain);
  edgeGain.connect(out);

  const wood = ctx.createOscillator();
  wood.type = "sine";
  wood.frequency.value = freq * 9.2;
  const woodGain = ctx.createGain();
  woodGain.gain.value = 0.05;
  wood.connect(woodGain);
  woodGain.connect(out);

  glide(body.frequency, freq, note.pitchTo, when, note.duration, note.tune);
  glide(edge.frequency, freq * 3.95, note.pitchTo, when, note.duration, note.tune, 3.95);
  glide(wood.frequency, freq * 9.2, note.pitchTo, when, note.duration, note.tune, 9.2);

  envelope(out.gain, when, { attack: 0.002, decay: 0.2, sustain: 0.06, release: 0.36, duration: Math.max(note.duration, 0.2), peak: amp });
  noiseBurst(ctx, out, when, { frequency: 1700, q: 1.2, amp: amp * 0.18, duration: 0.022 });
  for (const osc of [body, edge, wood]) {
    osc.start(when);
    osc.stop(when + Math.max(note.duration, 0.2) + 0.5);
  }
}

function scheduleFlute(ctx, out, note, when, amp) {
  const freq = midiToFreq(note.midi, note.tune);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  glide(osc.frequency, freq, note.pitchTo, when, note.duration, note.tune);
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 5.1;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 2.8;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoise(ctx);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = Math.min(6000, freq * 2.1);
  noiseFilter.Q.value = 1.1;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.055;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(out);
  osc.connect(out);
  envelope(out.gain, when, { attack: 0.08, decay: 0.12, sustain: 0.72, release: 0.35, duration: note.duration, peak: amp });
  osc.start(when);
  lfo.start(when);
  noise.start(when);
  const stop = when + note.duration + 0.6;
  osc.stop(stop);
  lfo.stop(stop);
  noise.stop(stop);
}

function scheduleStrings(ctx, out, note, when, amp) {
  const freq = midiToFreq(note.midi, note.tune);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(4200, freq * 5);
  [-7, 0, 7].forEach((cents, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.detune.value = cents;
    const g = ctx.createGain();
    g.gain.value = i === 1 ? 0.24 : 0.14;
    osc.connect(g);
    g.connect(filter);
    glide(osc.frequency, freq, note.pitchTo, when, note.duration, note.tune);
    osc.start(when);
    osc.stop(when + note.duration + 0.9);
  });
  const octave = ctx.createOscillator();
  octave.type = "triangle";
  octave.frequency.value = freq / 2;
  glide(octave.frequency, freq / 2, note.pitchTo, when, note.duration, note.tune, 0.5);
  const octaveGain = ctx.createGain();
  octaveGain.gain.value = 0.08;
  octave.connect(octaveGain);
  octaveGain.connect(filter);
  octave.start(when);
  octave.stop(when + note.duration + 0.9);
  filter.connect(out);
  envelope(out.gain, when, { attack: 0.12, decay: 0.18, sustain: 0.62, release: 0.7, duration: note.duration, peak: amp });
}

function scheduleChime(ctx, out, note, when, amp) {
  const freq = midiToFreq(note.midi, note.tune);
  [1, 2.01, 3.9, 5.2].forEach((ratio, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    glide(osc.frequency, freq * ratio, note.pitchTo, when, note.duration, note.tune, ratio);
    const g = ctx.createGain();
    g.gain.value = [0.55, 0.2, 0.12, 0.06][i];
    osc.connect(g);
    g.connect(out);
    osc.start(when);
    osc.stop(when + note.duration + 2.6);
  });
  envelope(out.gain, when, { attack: 0.003, decay: 0.6, sustain: 0.12, release: 2.2, duration: Math.max(note.duration, 0.7), peak: amp });
}

function scheduleBass(ctx, out, note, when, amp) {
  const freq = midiToFreq(note.midi, note.tune);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(1100, when);
  filter.frequency.exponentialRampToValueAtTime(320, when + 0.18);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(filter);

  const sub = ctx.createOscillator();
  sub.type = "triangle";
  sub.frequency.value = freq / 2;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.3;
  sub.connect(subGain);
  subGain.connect(filter);

  const harmonic = ctx.createOscillator();
  harmonic.type = "sine";
  harmonic.frequency.value = freq * 2;
  const harmonicGain = ctx.createGain();
  harmonicGain.gain.value = 0.1;
  harmonic.connect(harmonicGain);
  harmonicGain.connect(filter);

  glide(osc.frequency, freq, note.pitchTo, when, note.duration, note.tune);
  glide(sub.frequency, freq / 2, note.pitchTo, when, note.duration, note.tune, 0.5);
  glide(harmonic.frequency, freq * 2, note.pitchTo, when, note.duration, note.tune, 2);

  filter.connect(out);
  envelope(out.gain, when, { attack: 0.004, decay: 0.16, sustain: 0.5, release: 0.28, duration: note.duration, peak: amp * 1.15 });
  noiseBurst(ctx, out, when, { frequency: 280, q: 0.8, amp: amp * 0.1, duration: 0.016, type: "lowpass" });
  for (const voice of [osc, sub, harmonic]) {
    voice.start(when);
    voice.stop(when + note.duration + 0.45);
  }
}

function scheduleEightBit(ctx, out, note, when, amp) {
  const freq = midiToFreq(note.midi, note.tune);
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.value = freq;
  glide(osc.frequency, freq, note.pitchTo, when, note.duration, note.tune);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(4800, freq * 7);
  osc.connect(filter);
  filter.connect(out);
  envelope(out.gain, when, { attack: 0.002, decay: 0.08, sustain: 0.4, release: 0.12, duration: note.duration, peak: amp * 0.7 });
  osc.start(when);
  osc.stop(when + note.duration + 0.2);
}

const SYNTHS = {
  keys: scheduleKeys,
  pluck: schedulePluck,
  bell: scheduleBell,
  marimba: scheduleMarimba,
  flute: scheduleFlute,
  strings: scheduleStrings,
  chime: scheduleChime,
  bass: scheduleBass,
  eightbit: scheduleEightBit,
};

export function scheduleVoice(ctx, graph, note, when, state, options = {}) {
  const info = instrumentInfo(state, note.instrument);
  const out = ctx.createGain();
  const pan = ctx.createStereoPanner();
  pan.pan.value = info.pan;
  out.connect(pan);
  const sendReverb = ctx.createGain();
  sendReverb.gain.value = info.reverb;
  pan.connect(sendReverb);
  sendReverb.connect(graph.reverb);
  const sendDelay = ctx.createGain();
  sendDelay.gain.value = info.delay;
  pan.connect(sendDelay);
  sendDelay.connect(graph.delay);
  pan.connect(graph.bus);

  const amp = (options.amp ?? 0.22) * (0.55 + note.velocity * 0.55);
  const synth = SYNTHS[note.instrument] || SYNTHS.keys;
  synth(ctx, out, { ...note, tune: state.tune || 0 }, when, amp);
  return out;
}

export function scheduleClick(ctx, graph, when, accent = false) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = accent ? 1500 : 1100;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(accent ? 0.16 : 0.09, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  osc.connect(gain);
  gain.connect(graph.bus);
  osc.start(when);
  osc.stop(when + 0.08);
}

export async function previewNote(midi, instrument, options = {}) {
  const ctx = await ensureContext();
  if (!previewGraph) previewGraph = buildGraph(ctx, { bpm: 110 });
  const when = ctx.currentTime + 0.02;
  scheduleVoice(ctx, previewGraph, {
    midi,
    instrument: instrument || "keys",
    velocity: options.velocity ?? 0.8,
    duration: options.duration ?? 0.5,
  }, when, { tune: options.tune || 0 });
}

export function swingOffsetBeats(time, state) {
  const step = stepBeats(state);
  const index = Math.round(time / step);
  if (index % 2 === 1) return swingAmount(state) * step;
  return 0;
}

function playableLayers(state) {
  const layers = state.layers || [];
  const soloed = layers.some((layer) => layer.solo);
  return layers.filter((layer) => !layer.muted && (!soloed || layer.solo));
}

export async function renderMix(state, options = {}) {
  const sampleRate = options.sampleRate || 48000;
  const bpm = Math.max(40, state.bpm || 110);
  const loopBeats = (options.bars || state.loopBars || 8) * 4;
  const secPerBeat = 60 / bpm;
  const seconds = options.seconds
    ? Number(options.seconds)
    : beatsToSeconds(loopBeats, bpm) + (options.tail ?? 2.2);
  const length = Math.max(1, Math.ceil(seconds * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const graph = buildGraph(ctx, state, ctx.destination, { reverbSeconds: options.reverbSeconds });
  graph.delay.delayTime.value = secPerBeat * 0.75;

  const layers = playableLayers(state);
  const notes = layers.flatMap((layer) =>
    layer.notes.map((note) => ({ ...note, layer: layer.id }))
  );
  const strokes = layers.flatMap((layer) =>
    (layer.strokes || []).map((stroke) => ({ stroke, layer: layer.id }))
  );

  const repeats = options.repeat ? Math.ceil(seconds / (loopBeats * secPerBeat)) + 1 : 1;

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const note of notes) {
      const time = note.time + repeat * loopBeats;
      const when = (time + swingOffsetBeats(note.time, state)) * secPerBeat;
      if (when >= seconds - 0.02) continue;
      if (when < 0) continue;
      const duration = Math.min(
        Number(note.duration) || 0.25,
        Math.max(0.08, seconds - when)
      );
      scheduleVoice(ctx, graph, { ...note, duration }, when, state);
    }
    for (const { stroke } of strokes) {
      for (const event of strokeEvents(stroke, state)) {
        const time = event.time + repeat * loopBeats;
        const when = (time + swingOffsetBeats(event.time, state)) * secPerBeat;
        if (when >= seconds - 0.02 || when < 0) continue;
        const duration = Math.min(event.duration, Math.max(0.08, seconds - when));
        scheduleVoice(ctx, graph, { ...event, duration, instrument: stroke.instrument }, when, state);
      }
    }
  }

  const rendered = await ctx.startRendering();
  return normalizeBuffer(rendered, {
    target: 0.92,
    fadeIn: options.fadeIn ?? 0.01,
    fadeOut: options.fadeOut ?? 1.2,
  });
}

// A ringtone is the loop played back-to-back. Rendering 30 s of dense notes at
// once is the slowest possible path, so render one loop (plus its reverb tail)
// and lay it down repeatedly instead. The tail of each pass overlaps the start
// of the next one, which is exactly what the notes would have done anyway.
export async function renderRingtone(state, seconds = 30) {
  const bpm = Math.max(40, state.bpm || 110);
  const loopSeconds = beatsToSeconds((state.loopBars || 4) * 4, bpm);

  if (loopSeconds >= seconds - 0.5) {
    return renderMix(state, {
      seconds,
      repeat: true,
      fadeIn: 0.6,
      fadeOut: 1.6,
      tail: 0,
    });
  }

  const tail = 2.2;
  const loop = await renderMix(state, {
    bars: state.loopBars || 4,
    tail,
    fadeIn: 0,
    fadeOut: 0.02,
  });
  return tileLoop(loop, loopSeconds, seconds, { fadeIn: 0.6, fadeOut: 1.6 });
}

function tileLoop(loop, loopSeconds, seconds, options = {}) {
  const sampleRate = loop.sampleRate;
  const loopLength = Math.max(1, Math.min(loop.length, Math.round(loopSeconds * sampleRate)));
  const overlap = Math.max(0, Math.min(loop.length - loopLength, Math.round(1.5 * sampleRate)));
  const total = Math.round(seconds * sampleRate);
  const out = new AudioBuffer({ length: total, numberOfChannels: loop.numberOfChannels, sampleRate });

  for (let channel = 0; channel < loop.numberOfChannels; channel += 1) {
    const source = loop.getChannelData(channel);
    const target = out.getChannelData(channel);
    for (let offset = 0; offset < total; offset += loopLength) {
      const copy = Math.min(loopLength, total - offset);
      target.set(source.subarray(0, copy), offset);
      // Carry the reverb/release tail into the next repetition.
      const tailStart = loopLength;
      const tailCopy = Math.min(loop.length - tailStart, total - offset - loopLength);
      if (tailCopy > 0) {
        for (let i = 0; i < tailCopy; i += 1) target[offset + loopLength + i] += source[tailStart + i];
      }
    }
  }

  return normalizeBuffer(out, {
    target: 0.92,
    fadeIn: options.fadeIn ?? 0.6,
    fadeOut: options.fadeOut ?? 1.6,
  });
}

export function normalizeBuffer(buffer, options = {}) {
  const target = options.target ?? 0.92;
  const fadeIn = options.fadeIn ?? 0.01;
  const fadeOut = options.fadeOut ?? 1.2;
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
  }
  const gain = peak > 0 ? Math.min(4, target / peak) : 1;
  const length = buffer.length;
  const fadeInSamples = Math.max(1, Math.floor(fadeIn * buffer.sampleRate));
  const fadeOutSamples = Math.max(1, Math.floor(fadeOut * buffer.sampleRate));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      let value = data[i] * gain;
      if (i < fadeInSamples) value *= i / fadeInSamples;
      const tail = length - i;
      if (tail < fadeOutSamples) value *= tail / fadeOutSamples;
      data[i] = clamp(value, -1, 1);
    }
  }
  return buffer;
}

export class Transport {
  constructor(getState, callbacks = {}) {
    this.getState = getState;
    this.callbacks = callbacks;
    this.ctx = null;
    this.graph = null;
    this.timer = 0;
    this.playing = false;
    this.startTime = 0;
    this.nextTime = 0;
    this.beat = 0;
    this.loopLength = 0;
  }

  async play() {
    if (this.playing) return;
    this.ctx = await ensureContext();
    const state = this.getState();
    this.graph = buildGraph(this.ctx, state);
    this.graph.delay.delayTime.value = (60 / Math.max(40, state.bpm || 110)) * 0.75;
    this.startTime = this.ctx.currentTime + 0.08;
    this.nextTime = this.startTime;
    this.beat = 0;
    this.loopLength = (state.loopBars || 8) * 4;
    this.playing = true;
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
    this.callbacks.onPlay?.();
  }

  tick() {
    if (!this.playing) return;
    const state = this.getState();
    const step = stepBeats(state);
    const secPerBeat = 60 / Math.max(40, state.bpm || 110);
    const lookahead = this.ctx.currentTime + 0.14;

    while (this.nextTime < lookahead) {
      const beat = this.beat;
      const when = this.nextTime;
      this.scheduleStep(beat, when, state, step, secPerBeat);
      this.nextTime += step * secPerBeat;
      this.beat += step;
      if (this.beat >= this.loopLength - 0.0001) {
        if (!state.loop) {
          const stopAt = this.nextTime + 0.4;
          window.setTimeout(() => this.stop(), Math.max(0, (stopAt - this.ctx.currentTime) * 1000));
          this.beat = this.loopLength;
          break;
        }
        this.beat = 0;
        this.callbacks.onLoop?.();
      }
    }
  }

  scheduleStep(beat, when, state, step, secPerBeat) {
    const layers = state.layers || [];
    const soloed = layers.some((layer) => layer.solo);
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
      const layer = layers[layerIndex];
      if (layer.muted || (soloed && !layer.solo)) continue;
      for (const note of layer.notes) {
        if (note.time >= beat - 0.0001 && note.time < beat + step - 0.0001) {
          const swing = swingOffsetBeats(note.time, state) * secPerBeat;
          scheduleVoice(this.ctx, this.graph, note, when + swing, state);
          this.callbacks.onNote?.(note, when + swing);
        }
      }
      // Drawn lines play as lines: each run of equal pitch in the ink becomes
      // one voice, so a curve glides and a vertical stroke strums.
      for (const stroke of layer.strokes || []) {
        for (const event of strokeEvents(stroke, state)) {
          if (event.time >= beat - 0.0001 && event.time < beat + step - 0.0001) {
            const swing = swingOffsetBeats(event.time, state) * secPerBeat;
            const at = when + Math.max(0, event.time - beat) * secPerBeat + swing;
            scheduleVoice(this.ctx, this.graph, { ...event, instrument: stroke.instrument }, at, state);
            this.callbacks.onNote?.({ ...event, instrument: stroke.instrument }, at);
          }
        }
      }
    }
    if (state.metronome) {
      const rounded = Math.round(beat);
      if (Math.abs(beat - rounded) < 0.001) {
        scheduleClick(this.ctx, this.graph, when, rounded % 4 === 0);
      }
    }
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    window.clearInterval(this.timer);
    this.timer = 0;
    if (this.graph) {
      const now = this.ctx.currentTime;
      this.graph.master.gain.cancelScheduledValues(now);
      this.graph.master.gain.setValueAtTime(this.graph.master.gain.value, now);
      this.graph.master.gain.linearRampToValueAtTime(0.0001, now + 0.05);
      window.setTimeout(() => {
        try { this.graph?.master.disconnect(); } catch (err) { /* already gone */ }
      }, 120);
    }
    this.callbacks.onStop?.();
  }

  toggle() {
    if (this.playing) this.stop();
    else this.play();
  }

  rewind() {
    if (this.playing) {
      this.stop();
      this.play();
    }
  }

  position() {
    if (!this.playing || !this.ctx) return 0;
    const state = this.getState();
    const secPerBeat = 60 / Math.max(40, state.bpm || 110);
    const beats = (this.ctx.currentTime - this.startTime) / secPerBeat;
    const loop = (state.loopBars || 8) * 4;
    if (beats < 0) return 0;
    return beats % loop;
  }

  isPlaying() {
    return this.playing;
  }
}

export function bufferDuration(buffer) {
  return buffer.length / buffer.sampleRate;
}

export function notesInScale(state) {
  return scaleNotes(state);
}
