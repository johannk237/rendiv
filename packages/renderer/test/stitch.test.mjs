import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { stitchFramesToVideo } from '../dist/stitch-frames-to-video.js';

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
const FPS = 30;
const FRAMES = 60; // 2 s of video

const run = (args) => {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-y', ...args], { encoding: 'utf-8' });
  assert.equal(result.status, 0, result.stderr);
  return result;
};

let dir;
let framesDir;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rendiv-stitch-'));
  framesDir = path.join(dir, 'frames');
  spawnSync('mkdir', ['-p', framesDir]);
  run(['-f', 'lavfi', '-i', `color=c=black:s=64x64:r=${FPS}`, '-frames:v', String(FRAMES), path.join(framesDir, 'frame-%06d.png')]);
  // Half a second of tone, mono 22 kHz like many sound effects
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050:duration=0.5', path.join(dir, 'tone.wav')]);
  // A quarter second of tone, then a quarter second of silence
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050:duration=0.25', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono',
    '-filter_complex', '[1]atrim=duration=0.25[s];[0][s]concat=n=2:v=0:a=1', path.join(dir, 'tone-then-silence.wav')]);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const source = (overrides) => ({
  type: 'audio',
  src: '/tone.wav',
  startAtFrame: 0,
  durationInFrames: FRAMES,
  startFrom: 0,
  volume: 1,
  playbackRate: 1,
  ...overrides,
});

async function stitch(name, audioSources, extra = {}) {
  const outputPath = path.join(dir, `${name}.mp4`);
  await stitchFramesToVideo({ framesDir, outputPath, fps: FPS, imageFormat: 'png', audioSources, assetsDir: dir, ...extra });
  return outputPath;
}

/** RMS level (dBFS) of the soundtrack, per window of `windowSec`. */
function levels(file, windowSec = 0.1) {
  const raw = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 26 }).stdout;
  const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const w = Math.round(8000 * windowSec);
  const out = [];
  for (let i = 0; i + w <= samples.length; i += w) {
    let sum = 0;
    for (let j = i; j < i + w; j++) sum += samples[j] * samples[j];
    out.push(20 * Math.log10(Math.max(1, Math.sqrt(sum / w)) / 32768));
  }
  return out;
}

const audioStream = (file) => /Audio: [^\n]*/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf-8' }).stderr)?.[0] ?? '';
const SILENT = -60;
// The test tone peaks at 1/8 (-18 dBFS): its RMS, spread over two channels, is about -24 dBFS
const LOUD = -30;

test('the soundtrack is 48 kHz stereo, whatever the sources', async () => {
  const file = await stitch('format', [source()]);
  const stream = audioStream(file);
  assert.match(stream, /48000 Hz/);
  assert.match(stream, /stereo/);
});

const durationSec = (file) => {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf-8' }).stderr);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

test('a soundtrack shorter than the video does not shorten it', async () => {
  const file = await stitch('short-sound', [source({ durationInFrames: 6 })]);
  assert.ok(Math.abs(durationSec(file) - FRAMES / FPS) < 0.05, `duration: ${durationSec(file)}`);
});

test('without loop, a source stops at its end', async () => {
  const l = levels(await stitch('once', [source()]));
  assert.ok(l[2] > LOUD, `tone at 0.2 s: ${l[2]}`);
  assert.ok(l[12] < SILENT, `silence at 1.2 s: ${l[12]}`);
});

test('a loop over the whole file plays for the whole placement', async () => {
  const l = levels(await stitch('loop-file', [source({ loop: true })]));
  for (const i of [2, 7, 12, 17]) assert.ok(l[i] > LOUD, `window ${i}: ${l[i]}`);
});

test('a loop over a range repeats only that range', async () => {
  // Frames 0–7 of the file are the tone: repeated, they leave no gap; the whole file would leave one every half second
  const ranged = levels(await stitch('loop-range', [source({ src: '/tone-then-silence.wav', loop: true, endAt: 7 })]), 0.05);
  assert.ok(Math.min(...ranged.slice(1, -2)) > LOUD, `quietest window: ${Math.min(...ranged.slice(1, -2))}`);

  const whole = levels(await stitch('loop-whole', [source({ src: '/tone-then-silence.wav', loop: true })]), 0.05);
  assert.ok(whole[7] < SILENT, `gap of the whole file at 0.35 s: ${whole[7]}`);
});

test('a volume curve changes the level at the frames it says', async () => {
  const curve = Array.from({ length: FRAMES }, (_, f) => (f < 30 ? 0 : 1));
  const l = levels(await stitch('curve', [source({ loop: true, volumeCurve: curve })]));
  assert.ok(l[5] < SILENT, `muted first second: ${l[5]}`);
  assert.ok(l[15] > LOUD, `full second second: ${l[15]}`);
});

test('a placement starts at its frame', async () => {
  const l = levels(await stitch('delayed', [source({ startAtFrame: 30, durationInFrames: 15 })]));
  assert.ok(l[5] < SILENT, `before: ${l[5]}`);
  assert.ok(l[12] > LOUD, `after: ${l[12]}`);
});

test("a URL of the closed render server is read from the bundle's files", async () => {
  const l = levels(await stitch('origin', [source({ src: 'http://127.0.0.1:9/tone.wav' })], { assetsOrigin: 'http://127.0.0.1:9' }));
  assert.ok(l[2] > LOUD, `tone: ${l[2]}`);
});
