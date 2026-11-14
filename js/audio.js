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

// The sound of the instrument is deliberately simple: one voice per phrase of
// ink, one filter, one envelope, one echo. A phrase is a continuous run across
// the paper, so the pitch steps on the grid without retriggering the note. The
// page can hold a hundred notes, so every extra oscillator would turn into fog.
// A gentle bus level keeps a single line and a full chord at the same loudness,
// and a soft clip at the very end is the only colour the mix gets.

let audioContext = null;
let previewGraph = null;
let liveVoice = null;

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

function softClipCurve(amount = 1.15) {
  const size = 2048;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export function buildGraph(ctx, state, destination = ctx.destination, options = {}) {
  const bus = ctx.createGain();
  bus.gain.value = 0.95;

  const preMaster = ctx.createGain();
  preMaster.gain.value = options.masterGain ?? 0.9;

  const soft = ctx.createWaveShaper();
  soft.curve = softClipCurve(options.drive ?? 1.1);
  soft.oversample = "2x";

  // A last, very gentle filter: removes rumble and takes the glass off the top
  // so dense drawings stay warm instead of fizzy.
  const air = ctx.createBiquadFilter();
  air.type = "lowpass";
  air.frequency.value = options.air ?? 11500;
  air.Q.value = 0.4;
  const floor = ctx.createBiquadFilter();
  floor.type = "highpass";
  floor.frequency.value = 32;

  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = options.delaySeconds ?? 0.28;
  const feedback = ctx.createGain();
  feedback.gain.value = options.feedback ?? 0.26;
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 2300;
  const clean = ctx.createBiquadFilter();
  clean.type = "highpass";
  clean.frequency.value = 210;
  const wet = ctx.createGain();
  wet.gain.value = options.wet ?? 0.16;

  bus.connect(preMaster);
  bus.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  delay.connect(clean);
  clean.connect(wet);
  wet.connect(preMaster);

  preMaster.connect(air);
  air.connect(floor);
  floor.connect(soft);
  soft.connect(destination);

  return { bus, preMaster, air, floor, soft, delay, feedback, damp, clean, wet };
}

// ---------- voice design ----------

const WAVES = {
  // Soft, round harmonics. A pure sine would be dull and a saw would be harsh;
  // a little second and third harmonic is what makes the ink sing.
  keys: [0, 1, 0.34, 0.12],
  bell: [0, 1, 0.26, 0.09, 0.05],
  marimba: [0, 1, 0.04, 0.02, 0.12],
  chime: [0, 1, 0.18, 0.05, 0.1, 0.02, 0.03],
  strings: [0, 1, 0, 0.1, 0, 0.035],
  bass: [0, 1, 0.18, 0.03],
};

const waveCache = new WeakMap();

function periodicWave(ctx, name) {
  const list = WAVES[name];
  if (!list) return null;
  let byName = waveCache.get(ctx);
  if (!byName) {
    byName = new Map();
    waveCache.set(ctx, byName);
  }
  if (byName.has(name)) return byName.get(name);
  const real = new Float32Array(list.length);
  const imag = new Float32Array(list.length);
  list.forEach((value, index) => { imag[index] = value; });
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  byName.set(name, wave);
  return wave;
}

// How loud a pitch feels. Low notes are quieter than their meters suggest, so
// the bass gets a lift and the very top is pulled back a hair.
function loudness(freq) {
  if (freq < 330) return Math.min(2.2, Math.pow(330 / Math.max(freq, 40), 0.45));
  if (freq > 1400) return Math.pow(1400 / freq, 0.12);
  return 1;
}

const VOICES = {
  keys: { wave: "keys", cutoff: 3400, gain: 1.2, attack: 0.008, decay: 0.9, struck: true },
  pluck: { wave: "triangle", cutoff: 1900, gain: 1.05, attack: 0.006, decay: 0.5, struck: true },
  bell: { wave: "bell", cutoff: 3000, gain: 1.0, attack: 0.006, decay: 1.3, struck: true },
  marimba: { wave: "marimba", cutoff: 2600, gain: 1.2, attack: 0.005, decay: 0.4, struck: true },
  flute: { wave: "sine", cutoff: 2600, gain: 1.05, attack: 0.08, release: 0.22, vibrato: 5.1, struck: false },
  strings: { wave: "strings", cutoff: 1800, gain: 1.1, attack: 0.14, release: 0.32, detune: 6, struck: false },
  chime: { wave: "chime", cutoff: 3600, gain: 0.9, attack: 0.005, decay: 1.0, struck: true },
  bass: { wave: "bass", cutoff: 1000, gain: 1.05, attack: 0.02, release: 0.18, struck: false },
  eightbit: { wave: "square", cutoff: 850, gain: 0.55, attack: 0.02, release: 0.12, struck: false },
};

function voiceFor(instrument) {
  return VOICES[instrument] || VOICES.keys;
}

function makeOscillator(ctx, voice, freq) {
  const osc = ctx.createOscillator();
  if (voice.wave === "triangle" || voice.wave === "square") {
    osc.type = voice.wave;
  } else {
    const wave = periodicWave(ctx, voice.wave);
    if (wave) osc.setPeriodicWave(wave);
    else osc.type = "sine";
  }
  osc.frequency.value = freq;
  return osc;
}

export function scheduleVoice(ctx, graph, note, when, state, options = {}) {
  const info = instrumentInfo(state, note.instrument);
  const voice = voiceFor(note.instrument);
  const freq = midiToFreq(note.midi, state.tune || note.tune || 0);
  if (!Number.isFinite(freq) || freq < 12 || freq > 14000) return null;

  const amp = (options.amp ?? 0.16) * voice.gain * loudness(freq) * (0.55 + (note.velocity ?? 0.8) * 0.55);
  const peak = Math.max(0.0002, amp);

  const out = ctx.createGain();
  out.gain.value = 0.0001;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(voice.cutoff, 9000);
  filter.Q.value = 0.6;

  const pan = ctx.createStereoPanner();
  pan.pan.value = clamp(info.pan ?? 0, -0.5, 0.5);

  filter.connect(out);
  out.connect(pan);
  pan.connect(graph.bus);

  const oscillators = [];
  const main = makeOscillator(ctx, voice, freq);
  main.connect(filter);
  oscillators.push(main);

  if (voice.detune) {
    const second = makeOscillator(ctx, voice, freq);
    second.detune.value = voice.detune;
    const secondGain = ctx.createGain();
    secondGain.gain.value = 0.55;
    second.connect(secondGain);
    secondGain.connect(filter);
    oscillators.push(second);
  }

  let lfo = null;
  if (voice.vibrato) {
    lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = voice.vibrato;
    const depth = ctx.createGain();
    depth.gain.value = Math.max(0.6, freq * 0.0035);
    lfo.connect(depth);
    depth.connect(main.frequency);
    lfo.start(when);
    lfo.stop(when + 30);
  }

  const duration = Math.max(0.05, Number(note.duration) || 0.25);
  let stopAt;
  if (voice.struck) {
    const end = when + voice.attack;
    const tail = clamp(voice.decay * 1.2, 0.3, 1.5);
    out.gain.cancelScheduledValues(when);
    out.gain.setValueAtTime(0.0001, when);
    out.gain.linearRampToValueAtTime(peak, end);
    out.gain.exponentialRampToValueAtTime(0.0001, end + tail);
    stopAt = end + tail + 0.05;
  } else {
    const end = Math.max(when + voice.attack + 0.02, when + duration);
    const release = voice.release ?? 0.2;
    out.gain.cancelScheduledValues(when);
    out.gain.setValueAtTime(0.0001, when);
    out.gain.linearRampToValueAtTime(peak, when + voice.attack);
    out.gain.setValueAtTime(peak, Math.max(when + voice.attack, end - 0.005));
    out.gain.exponentialRampToValueAtTime(0.0001, end + release);
    stopAt = end + release + 0.05;
  }

  oscillators.forEach((osc) => {
    osc.start(when);
    osc.stop(stopAt);
  });
  if (lfo) {
    try { lfo.stop(stopAt); } catch (err) { /* already stopped */ }
  }
  return out;
}

// ---------- events ----------

export function collectEvents(state) {
  const layers = state.layers || [];
  const soloed = layers.some((layer) => layer.solo);
  const events = [];
  for (const layer of layers) {
    if (layer.muted || (soloed && !layer.solo)) continue;
    for (const note of layer.notes || []) {
      events.push({
        time: note.time,
        midi: note.midi,
        duration: note.duration,
        velocity: note.velocity,
        instrument: note.instrument || state.instrument,
      });
    }
    for (const stroke of layer.strokes || []) {
      for (const event of strokeEvents(stroke, state)) {
        events.push({
          ...event,
          instrument: stroke.instrument || state.instrument,
          source: `${state.layers.indexOf(layer)}:${stroke.id ?? "s"}`,
        });
      }
    }
  }
  events.sort((a, b) => a.time - b.time || a.midi - b.midi);
  return events;
}

// A bus level that follows how many notes overlap. One line is allowed to sing
// out; a thick chord is tucked back in, so nothing ever clips or shouts.
export function busLevelFor(events) {
  if (!events.length) return 1;
  const loopBeats = events.reduce((max, event) => Math.max(max, event.time + event.duration), 0);
  let samples = 0;
  let sum = 0;
  for (let t = 0; t < loopBeats; t += 0.25) {
    let count = 0;
    for (const event of events) {
      const tail = Math.max(event.duration, 0.45);
      if (event.time <= t && t < event.time + tail) count += 1;
    }
    sum += count;
    samples += 1;
  }
  const average = samples ? sum / samples : 1;
  return clamp(1.12 / Math.sqrt(Math.max(1, average * 0.9)), 0.3, 1.2);
}

export function swingOffsetBeats(time, state) {
  const step = stepBeats(state);
  const index = Math.round(time / step);
  if (index % 2 === 1) return swingAmount(state) * step;
  return 0;
}

export function scheduleClick(ctx, graph, when, accent = false) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = accent ? 1600 : 1200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(accent ? 0.12 : 0.07, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  osc.connect(gain);
  gain.connect(graph.bus);
  osc.start(when);
  osc.stop(when + 0.07);
}

function playableEvents(events) {
  return events;
}

// Group the note runs of one lane into phrases: a phrase is a continuous line,
// so it is played by a single voice that steps through the pitches. This is the
// difference between a melody and a pile of separate notes.
export function buildPhrases(events) {
  const byKey = new Map();
  for (const event of events) {
    if (event.phrase == null) continue;
    const key = `${event.source ?? ""}|${event.lane ?? 0}|${event.phrase}`;
    let list = byKey.get(key);
    if (!list) {
      list = [];
      byKey.set(key, list);
    }
    list.push(event);
  }
  const phrases = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.time - b.time || a.midi - b.midi);
    phrases.push(list);
  }
  phrases.sort((a, b) => a[0].time - b[0].time);
  return phrases;
}

function schedulePhrase(ctx, graph, phrase, when, secondsPerBeat, state) {
  const first = phrase[0];
  const instrument = first.instrument || state.instrument;
  const voice = voiceFor(instrument);
  const info = instrumentInfo(state, instrument);
  const freq = midiToFreq(first.midi, state.tune || 0);
  if (!Number.isFinite(freq) || freq < 12 || freq > 14000) return null;

  const last = phrase[phrase.length - 1];
  const length = Math.max(0.08, (last.time + last.duration - first.time) * secondsPerBeat);
  const peak = Math.max(0.0004, (0.16 * voice.gain * loudness(freq)) * (0.6 + (first.velocity ?? 0.8) * 0.5));

  const out = ctx.createGain();
  out.gain.value = 0.0001;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(voice.cutoff, 9000);
  filter.Q.value = 0.6;
  const pan = ctx.createStereoPanner();
  pan.pan.value = clamp(info.pan ?? 0, -0.5, 0.5);
  filter.connect(out);
  out.connect(pan);
  pan.connect(graph.bus);

  const oscs = [];
  const main = makeOscillator(ctx, voice, freq);
  main.connect(filter);
  oscs.push(main);
  if (voice.detune) {
    const second = makeOscillator(ctx, voice, freq);
    second.detune.value = voice.detune;
    const secondGain = ctx.createGain();
    secondGain.gain.value = 0.55;
    second.connect(secondGain);
    secondGain.connect(filter);
    oscs.push(second);
  }

  const attack = Math.min(0.03, Math.max(0.006, voice.attack));
  const attackEnd = when + attack;
  const decayEnd = Math.min(when + length, attackEnd + Math.max(0.12, Math.min(0.85, voice.decay || 0.4)));
  const releaseEnd = Math.max(decayEnd + 0.02, when + length + (voice.struck ? 0.14 : 0.24));

  out.gain.setValueAtTime(0.0001, when);
  out.gain.linearRampToValueAtTime(peak, attackEnd);
  out.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * (voice.struck ? 0.42 : 0.86)), decayEnd);
  out.gain.setValueAtTime(Math.max(0.0002, peak * (voice.struck ? 0.42 : 0.86)), Math.max(decayEnd, releaseEnd - 0.12));
  out.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

  // Pitch steps, exactly on the grid, with the phase kept: no clicks.
  oscs.forEach((osc) => osc.frequency.setValueAtTime(freq, when));
  for (let i = 1; i < phrase.length; i += 1) {
    const segment = phrase[i];
    const at = Math.max(when, when + (segment.time - first.time) * secondsPerBeat);
    const nextFreq = midiToFreq(segment.midi, state.tune || 0);
    if (Number.isFinite(nextFreq) && nextFreq > 12 && nextFreq < 14000) {
      oscs.forEach((osc) => osc.frequency.setValueAtTime(nextFreq, at));
    }
  }

  const stopAt = releaseEnd + 0.05;
  oscs.forEach((osc) => {
    osc.start(when);
    osc.stop(stopAt);
  });
  return out;
}

export async function renderMix(state, options = {}) {
  const sampleRate = options.sampleRate || 48000;
  const bpm = Math.max(40, state.bpm || 110);
  const loopBeats = (options.bars || state.loopBars || 4) * 4;
  const secPerBeat = 60 / bpm;
  const seconds = options.seconds
    ? Number(options.seconds)
    : beatsToSeconds(loopBeats, bpm) + (options.tail ?? 2.6);
  const length = Math.max(1, Math.ceil(seconds * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const graph = buildGraph(ctx, state, ctx.destination, options);

  const events = playableEvents(collectEvents(state));
  const phrases = buildPhrases(events);
  const loose = events.filter((event) => event.phrase == null);
  const repeats = options.repeat ? Math.ceil(seconds / (loopBeats * secPerBeat)) + 1 : 1;
  const busLevel = busLevelFor(events);
  graph.bus.gain.value = busLevel;
  graph.preMaster.gain.value = options.masterGain ?? 0.9;

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const phrase of phrases) {
      const start = phrase[0].time + repeat * loopBeats;
      const when = (start + swingOffsetBeats(phrase[0].time, state)) * secPerBeat;
      if (when >= seconds - 0.02 || when < 0) continue;
      schedulePhrase(ctx, graph, phrase, when, secPerBeat, state);
    }
    for (const event of loose) {
      const time = event.time + repeat * loopBeats;
      const when = (time + swingOffsetBeats(event.time, state)) * secPerBeat;
      if (when >= seconds - 0.02 || when < 0) continue;
      const duration = Math.min(
        Number(event.duration) || 0.25,
        Math.max(0.06, seconds - when)
      );
      scheduleVoice(ctx, graph, { ...event, duration }, when, state);
    }
  }

  const rendered = await ctx.startRendering();
  return normalizeBuffer(rendered, {
    target: 0.9,
    fadeIn: options.fadeIn ?? 0.008,
    fadeOut: options.fadeOut ?? 1.4,
  });
}

// A ringtone is the loop played back-to-back. Render one loop and lay it down
// repeatedly; the release tail of each pass carries into the next.
export async function renderRingtone(state, seconds = 30) {
  const bpm = Math.max(40, state.bpm || 110);
  const loopSeconds = beatsToSeconds((state.loopBars || 4) * 4, bpm);

  if (loopSeconds >= seconds - 0.5) {
    return renderMix(state, {
      seconds,
      repeat: true,
      fadeIn: 0.5,
      fadeOut: 1.6,
      tail: 0,
    });
  }

  const tail = 2.6;
  const loop = await renderMix(state, {
    bars: state.loopBars || 4,
    tail,
    fadeIn: 0,
    fadeOut: 0.02,
  });
  return tileLoop(loop, loopSeconds, seconds, { fadeIn: 0.5, fadeOut: 1.6 });
}

function tileLoop(loop, loopSeconds, seconds, options = {}) {
  const sampleRate = loop.sampleRate;
  const loopLength = Math.max(1, Math.min(loop.length, Math.round(loopSeconds * sampleRate)));
  const overlap = Math.max(0, Math.min(loop.length - loopLength, Math.round(1.8 * sampleRate)));
  const total = Math.round(seconds * sampleRate);
  const out = new AudioBuffer({ length: total, numberOfChannels: loop.numberOfChannels, sampleRate });

  for (let channel = 0; channel < loop.numberOfChannels; channel += 1) {
    const source = loop.getChannelData(channel);
    const target = out.getChannelData(channel);
    for (let offset = 0; offset < total; offset += loopLength) {
      const copy = Math.min(loopLength, total - offset);
      target.set(source.subarray(0, copy), offset);
      const tailStart = loopLength;
      const tailCopy = Math.min(overlap, total - offset - loopLength);
      for (let i = 0; i < tailCopy; i += 1) target[offset + loopLength + i] += source[tailStart + i];
    }
  }

  return normalizeBuffer(out, {
    target: 0.9,
    fadeIn: options.fadeIn ?? 0.5,
    fadeOut: options.fadeOut ?? 1.6,
  });
}

export function normalizeBuffer(buffer, options = {}) {
  const target = options.target ?? 0.9;
  const fadeIn = options.fadeIn ?? 0.008;
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

// ---------- live drawing voice ----------

export async function startLive(instrument, midi) {
  const ctx = await ensureContext();
  if (!previewGraph) previewGraph = buildGraph(ctx, { bpm: 120 });
  if (liveVoice) stopLive();
  const voice = voiceFor(instrument);
  const freq = midiToFreq(midi);
  const osc = makeOscillator(ctx, voice, freq);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(voice.cutoff, 5200);
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(previewGraph.bus);

  // One gentle tone follows the pen. It glides between rows instead of
  // restriking, so drawing sounds like a voice, not a machine gun.
  const now = ctx.currentTime;
  const peak = Math.min(0.17, 0.1 * voice.gain * loudness(freq));
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.035);
  osc.start(now);

  liveVoice = { ctx, osc, gain, filter, voice, midi, peak, startedAt: now };
  return liveVoice;
}

export function setLiveMidi(midi) {
  if (!liveVoice) return;
  const { ctx, osc, gain, voice, peak } = liveVoice;
  if (midi === liveVoice.midi) return;
  liveVoice.midi = midi;
  const freq = midiToFreq(midi);
  const now = ctx.currentTime;
  osc.frequency.setTargetAtTime(freq, now, 0.02);
  const nextPeak = Math.min(0.17, 0.1 * voice.gain * loudness(freq));
  if (Math.abs(nextPeak - peak) > 0.002) {
    gain.gain.setTargetAtTime(nextPeak, now, 0.06);
    liveVoice.peak = nextPeak;
  }
}

export function stopLive() {
  if (!liveVoice) return;
  const { ctx, osc, gain } = liveVoice;
  const now = ctx.currentTime;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.stop(now + 0.16);
  } catch (err) {
    /* voice already ended */
  }
  liveVoice = null;
}

export async function previewNote(midi, instrument, options = {}) {
  const ctx = await ensureContext();
  if (!previewGraph) previewGraph = buildGraph(ctx, { bpm: 120 });
  const when = ctx.currentTime + 0.02;
  scheduleVoice(ctx, previewGraph, {
    midi,
    instrument: instrument || "keys",
    velocity: options.velocity ?? 0.75,
    duration: options.duration ?? 0.45,
  }, when, { tune: options.tune || 0 });
}

// ---------- transport ----------

export class Transport {
  constructor(getState, callbacks = {}) {
    this.getState = getState;
    this.callbacks = callbacks;
    this.ctx = null;
    this.graph = null;
    this.events = [];
    this.phrases = [];
    this.loose = [];
    this.pending = null;
    this.timer = 0;
    this.playing = false;
    this.startAt = 0;
    this.loopIndex = 0;
    this.phraseIndex = 0;
    this.looseIndex = 0;
    this.loopBeats = 0;
    this.secPerBeat = 0;
    this.latency = 0;
    this.stopAt = 0;
    this.clickBeat = 0;
    this.finishing = false;
  }

  async play(startBeat = 0) {
    if (this.playing) return;
    this.ctx = await ensureContext();
    const state = this.getState();
    this.graph = buildGraph(this.ctx, state);
    this.events = collectEvents(state);
    this.phrases = buildPhrases(this.events);
    this.loose = this.events.filter((event) => event.phrase == null);
    this.graph.bus.gain.value = busLevelFor(this.events);
    this.secPerBeat = 60 / Math.max(40, state.bpm || 110);
    this.loopBeats = (state.loopBars || 4) * 4;
    this.startAt = this.ctx.currentTime + 0.12 - Math.max(0, Math.min(startBeat, this.loopBeats - 0.01)) * this.secPerBeat;
    this.loopIndex = 0;
    this.phraseIndex = 0;
    this.looseIndex = 0;
    this.clickBeat = 0;
    this.stopAt = 0;
    this.finishing = false;
    this.pending = null;
    this.latency = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    this.playing = true;
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
    this.callbacks.onPlay?.();
  }

  // Edits arrive mid-loop. Rather than doubling notes already scheduled, the
  // new take is queued and lands on the next downbeat.
  refresh() {
    if (!this.playing) return;
    const events = collectEvents(this.getState());
    this.pending = {
      events,
      phrases: buildPhrases(events),
      loose: events.filter((event) => event.phrase == null),
    };
  }

  applyPending() {
    if (!this.pending) return;
    this.events = this.pending.events;
    this.phrases = this.pending.phrases;
    this.loose = this.pending.loose;
    this.pending = null;
    this.graph?.bus.gain.setTargetAtTime(busLevelFor(this.events), this.ctx.currentTime, 0.15);
  }

  tick() {
    if (!this.playing) return;
    const state = this.getState();
    const now = this.ctx.currentTime;
    const lookahead = now + 0.22;
    const loopSeconds = this.loopBeats * this.secPerBeat;

    if (this.stopAt && now >= this.stopAt) {
      this.stop();
      return;
    }
    if (this.finishing) return;

    const loopStart = this.startAt + this.loopIndex * loopSeconds;

    let guard = 0;
    while (guard < 1200 && this.phraseIndex < this.phrases.length) {
      guard += 1;
      const phrase = this.phrases[this.phraseIndex];
      const when = loopStart
        + (phrase[0].time + swingOffsetBeats(phrase[0].time, state)) * this.secPerBeat;
      if (when > lookahead) break;
      if (when >= now - 0.08) {
        schedulePhrase(this.ctx, this.graph, phrase, when, this.secPerBeat, state);
        this.callbacks.onNote?.(phrase[phrase.length - 1], when);
      }
      this.phraseIndex += 1;
    }

    while (guard < 1600 && this.looseIndex < this.loose.length) {
      guard += 1;
      const event = this.loose[this.looseIndex];
      const when = loopStart
        + (event.time + swingOffsetBeats(event.time, state)) * this.secPerBeat;
      if (when > lookahead) break;
      if (when >= now - 0.08) {
        scheduleVoice(this.ctx, this.graph, event, when, state);
        this.callbacks.onNote?.(event, when);
      }
      this.looseIndex += 1;
    }

    if (this.phraseIndex >= this.phrases.length && this.looseIndex >= this.loose.length) {
      if (loopStart + loopSeconds <= lookahead) {
        if (!state.loop) {
          this.stopAt = this.startAt + (this.loopIndex + 1) * loopSeconds + 0.6;
          this.finishing = true;
        } else {
          this.loopIndex += 1;
          this.phraseIndex = 0;
          this.looseIndex = 0;
          this.applyPending();
          this.callbacks.onLoop?.();
        }
      }
    }

    if (state.metronome) {
      let guardClicks = 0;
      while (guardClicks < 64 && this.startAt + this.clickBeat * this.secPerBeat <= lookahead) {
        guardClicks += 1;
        const when = this.startAt + this.clickBeat * this.secPerBeat;
        if (when >= now - 0.02) {
          scheduleClick(this.ctx, this.graph, when, this.clickBeat % 4 === 0);
        }
        this.clickBeat += 1;
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
      this.graph.preMaster.gain.cancelScheduledValues(now);
      this.graph.preMaster.gain.setValueAtTime(this.graph.preMaster.gain.value, now);
      this.graph.preMaster.gain.linearRampToValueAtTime(0.0001, now + 0.06);
      window.setTimeout(() => {
        try { this.graph?.preMaster.disconnect(); } catch (err) { /* already gone */ }
      }, 140);
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
      window.setTimeout(() => this.play(), 40);
    }
  }

  position() {
    if (!this.playing || !this.ctx) return 0;
    const state = this.getState();
    const loopBeats = (state.loopBars || 4) * 4;
    const elapsed = (this.ctx.currentTime - this.startAt - this.latency) / this.secPerBeat;
    if (elapsed < 0) return 0;
    if (!state.loop) return Math.min(loopBeats, elapsed);
    return elapsed % loopBeats;
  }

  beat() {
    const state = this.getState();
    return (state.loopBars || 4) * 4;
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
