import { renderMix, renderRingtone } from "./audio.js";
import { renderFrame } from "./render.js";
import { midiToName } from "./config.js";

const PPQ = 480;

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function slugify(value) {
  return String(value || "zabibu-composer")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "zabibu-composer";
}

export function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

export function bufferToWav(buffer, bitDepth = 24) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const data = [];
  for (let channel = 0; channel < channels; channel += 1) data.push(buffer.getChannelData(channel));
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data[channel][i]));
      if (bitDepth === 16) {
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      } else {
        const value = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, (value >> 16) & 0xff);
        offset += 3;
      }
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function floatToInt16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

export async function encodeMp3(buffer, kbps = 320, onProgress) {
  await loadScript("vendor/lame.min.js");
  if (!window.lamejs) throw new Error("The MP3 encoder could not load.");
  const channels = buffer.numberOfChannels;
  const encoder = new window.lamejs.Mp3Encoder(channels, buffer.sampleRate, kbps);
  const left = floatToInt16(buffer.getChannelData(0));
  const right = channels > 1 ? floatToInt16(buffer.getChannelData(1)) : left;
  const blockSize = 1152;
  const data = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right.subarray(i, i + blockSize);
    const chunk = channels > 1 ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
    if (chunk.length) data.push(new Int8Array(chunk));
    // Yield often so the page keeps painting and the progress bar moves.
    if ((i / blockSize) % 12 === 0) {
      onProgress?.(i / left.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  const end = encoder.flush();
  if (end.length) data.push(new Int8Array(end));
  onProgress?.(1);

  return new Blob(data, { type: "audio/mpeg" });
}

function splitAudioBuffer(buffer, chunkFrames = 1024) {
  const chunks = [];
  const frames = buffer.length;
  const channels = buffer.numberOfChannels;
  for (let offset = 0; offset < frames; offset += chunkFrames) {
    const length = Math.min(chunkFrames, frames - offset);
    const data = new Float32Array(length * channels);
    for (let channel = 0; channel < channels; channel += 1) {
      data.set(buffer.getChannelData(channel).subarray(offset, offset + length), channel * length);
    }
    chunks.push({
      data,
      timestamp: Math.round((offset / buffer.sampleRate) * 1_000_000),
      duration: Math.round((length / buffer.sampleRate) * 1_000_000),
      frames: length,
    });
  }
  return chunks;
}

async function encodeAudioChunks(buffer, muxer, onProgress) {
  if (!("AudioEncoder" in window)) throw new Error("This browser does not support AAC audio encoding.");
  const config = {
    codec: "mp4a.40.2",
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    bitrate: 192000,
  };
  const support = await window.AudioEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error("AAC audio encoding is not available in this browser.");

  let error = null;
  const encoder = new window.AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (err) => { error = err; },
  });
  encoder.configure(config);
  const chunks = splitAudioBuffer(buffer);
  let count = 0;
  for (const chunk of chunks) {
    if (error) throw error;
    const audioData = new window.AudioData({
      format: "f32-planar",
      sampleRate: buffer.sampleRate,
      numberOfFrames: chunk.frames,
      numberOfChannels: buffer.numberOfChannels,
      timestamp: chunk.timestamp,
      data: chunk.data,
    });
    encoder.encode(audioData);
    audioData.close();
    count += 1;
    if (count % 12 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      onProgress?.(count / chunks.length);
    }
  }
  await encoder.flush();
  encoder.close();
  if (error) throw error;
}

export async function encodeM4R(buffer, onProgress) {
  const { Muxer, ArrayBufferTarget } = await import("../vendor/mp4-muxer.mjs");
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    audio: {
      codec: "aac",
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    },
    fastStart: "in-memory",
  });
  await encodeAudioChunks(buffer, muxer, onProgress);
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: "audio/mp4" });
}

export async function exportWav(state, options = {}) {
  const buffer = await renderMix(state, { bars: state.loopBars, tail: 2.2 });
  const blob = bufferToWav(buffer, 24);
  downloadBlob(blob, `${slugify(state.title)}-${timestamp()}.wav`);
  return blob;
}

export async function exportMp3(state, options = {}) {
  options.onProgress?.(0.05);
  const buffer = await renderMix(state, { bars: state.loopBars, tail: 2.2 });
  options.onProgress?.(0.18);
  const blob = await encodeMp3(buffer, options.kbps || 320, (value) => {
    options.onProgress?.(0.18 + value * 0.8);
  });
  downloadBlob(blob, `${slugify(state.title)}-${timestamp()}.mp3`);
  return blob;
}

export async function exportRingtone(state, options = {}) {
  options.onProgress?.(0.04);
  const buffer = await renderRingtone(state, options.seconds || 30);
  options.onProgress?.(0.16);
  if (options.m4r) {
    try {
      const blob = await encodeM4R(buffer, options.onProgress);
      downloadBlob(blob, `${slugify(state.title)}-ringtone-${timestamp()}.m4r`);
      return blob;
    } catch (err) {
      /* fall through to MP3 */
    }
  }
  const blob = await encodeMp3(buffer, 192, (value) => {
    options.onProgress?.(0.16 + value * 0.82);
  });
  downloadBlob(blob, `${slugify(state.title)}-ringtone-${timestamp()}.mp3`);
  return blob;
}

export async function exportM4R(state, options = {}) {
  options.onProgress?.(0.04);
  const buffer = await renderRingtone(state, 30);
  options.onProgress?.(0.16);
  const blob = await encodeM4R(buffer, (value) => options.onProgress?.(0.16 + value * 0.82));
  downloadBlob(blob, `${slugify(state.title)}-ringtone-${timestamp()}.m4r`);
  return blob;
}

export async function exportMidi(state) {
  const trackCount = 1 + state.layers.length;
  const tracks = [];

  const tempo = Math.round(60000000 / Math.max(40, state.bpm || 110));
  const meta = [];
  meta.push(...textEvent(0x03, "Zabibu Composer"));
  meta.push(0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff);
  meta.push(0xff, 0x58, 0x04, 4, 2, 24, 8);
  meta.push(0xff, 0x2f, 0x00);
  tracks.push(meta);

  const programByInstrument = {
    keys: 0, pluck: 24, bell: 14, marimba: 12, flute: 73,
    strings: 48, chime: 14, bass: 32, eightbit: 80,
  };

  state.layers.forEach((layer, layerIndex) => {
    const events = [];
    for (const note of layer.notes) {
      const start = Math.round(note.time * PPQ);
      const end = Math.max(start + 1, Math.round((note.time + note.duration) * PPQ));
      const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
      events.push({ tick: start, type: "on", note: note.midi, velocity });
      events.push({ tick: end, type: "off", note: note.midi, velocity: 0 });
    }
    events.sort((a, b) => a.tick - b.tick || (a.type === "off" ? -1 : 1));
    const bytes = [];
    bytes.push(...textEvent(0x03, layer.name || `Layer ${layerIndex + 1}`));
    const instrument = layer.notes[0]?.instrument || state.instrument;
    bytes.push(0x00, 0xc0 | layerIndex, programByInstrument[instrument] ?? 0);
    let lastTick = 0;
    for (const event of events) {
      const delta = Math.max(0, event.tick - lastTick);
      lastTick = event.tick;
      bytes.push(...vlq(delta));
      if (event.type === "on") {
        bytes.push(0x90 | layerIndex, event.note & 0x7f, event.velocity & 0x7f);
      } else {
        bytes.push(0x80 | layerIndex, event.note & 0x7f, 0);
      }
    }
    bytes.push(0xff, 0x2f, 0x00);
    tracks.push(bytes);
  });

  const chunks = [];
  chunks.push(...ascii("MThd"), u32(6), u16(1), u16(trackCount), u16(PPQ));
  for (const track of tracks) {
    chunks.push(...ascii("MTrk"), u32(track.length), ...track);
  }
  const blob = new Blob([new Uint8Array(chunks)], { type: "audio/midi" });
  downloadBlob(blob, `${slugify(state.title)}-${timestamp()}.mid`);
  return blob;
}

function ascii(value) {
  return [...value].map((char) => char.charCodeAt(0));
}

function u16(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value) {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function vlq(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function textEvent(type, text) {
  const data = [...text].map((char) => char.charCodeAt(0) & 0x7f);
  return [0xff, type, ...vlq(data.length), ...data];
}

export async function exportVideo(state, options = {}) {
  const { Muxer, ArrayBufferTarget } = await import("../vendor/mp4-muxer.mjs");
  if (!("VideoEncoder" in window) || !("AudioEncoder" in window)) {
    throw new Error("MP4 export needs WebCodecs. Use a recent Chrome or Edge.");
  }

  const width = options.width || 1280;
  const height = options.height || 720;
  const fps = options.fps || 30;
  const onProgress = options.onProgress || (() => {});

  onProgress(0.02);
  const audio = await renderMix(state, {
    bars: state.loopBars,
    tail: 1.2,
    fadeIn: 0.02,
    fadeOut: 0.8,
  });
  const duration = audio.length / audio.sampleRate;
  const totalFrames = Math.ceil(duration * fps);
  const secPerBeat = 60 / Math.max(40, state.bpm || 110);
  const loopBeats = (state.loopBars || 8) * 4;

  const videoConfig = {
    codec: "avc1.42001f",
    width,
    height,
    bitrate: 5_000_000,
    framerate: fps,
    latencyMode: "quality",
    avc: { format: "avc" },
  };
  const videoSupport = await window.VideoEncoder.isConfigSupported(videoConfig);
  if (!videoSupport.supported) {
    throw new Error("H.264 video encoding is not available in this browser.");
  }

  const audioConfig = {
    codec: "mp4a.40.2",
    sampleRate: audio.sampleRate,
    numberOfChannels: audio.numberOfChannels,
    bitrate: 192000,
  };
  const audioSupport = await window.AudioEncoder.isConfigSupported(audioConfig);
  if (!audioSupport.supported) {
    throw new Error("AAC audio encoding is not available. Export MP3 instead.");
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    audio: { codec: "aac", numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate },
    fastStart: "in-memory",
  });

  let encodeError = null;
  const videoEncoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { encodeError = err; },
  });
  videoEncoder.configure(videoConfig);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let photo = null;
  if (state.backgroundImage) {
    photo = new Image();
    photo.src = state.backgroundImage;
    await new Promise((resolve) => {
      photo.onload = resolve;
      photo.onerror = resolve;
    });
  }

  for (let i = 0; i < totalFrames; i += 1) {
    if (encodeError) throw encodeError;
    const t = i / fps;
    const beat = ((t / secPerBeat) % loopBeats + loopBeats) % loopBeats;
    renderFrame(canvas, state, beat, {
      width,
      height,
      playing: true,
      photo,
      flashes: new Map(),
    });
    const frame = new window.VideoFrame(canvas, {
      timestamp: Math.round((i / fps) * 1_000_000),
      duration: Math.round((1 / fps) * 1_000_000),
    });
    videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (i % 30 === 0) {
      onProgress(0.05 + (i / totalFrames) * 0.55);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (i % 90 === 0) await videoEncoder.flush();
  }
  await videoEncoder.flush();
  videoEncoder.close();

  onProgress(0.62);
  await encodeAudioChunks(audio, muxer, (value) => onProgress(0.62 + value * 0.33));
  muxer.finalize();
  onProgress(1);
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  downloadBlob(blob, `${slugify(state.title)}-${timestamp()}.mp4`);
  return blob;
}

export function projectJson(state) {
  return JSON.stringify(state, null, 2);
}

export function downloadProject(state, serialized) {
  const blob = new Blob([serialized || projectJson(state)], { type: "application/json" });
  downloadBlob(blob, `${slugify(state.title)}-${timestamp()}.zabibu.json`);
  return blob;
}

export { midiToName };
