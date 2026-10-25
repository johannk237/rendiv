import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startServer } from '../dist/serve.js';

let dir;
let server;
const body = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rendiv-serve-'));
  await writeFile(path.join(dir, 'music.wav'), body);
  await writeFile(path.join(dir, 'voice.m4a'), body);
  server = await startServer(dir);
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const get = async (file, headers = {}, method = 'GET') => {
  const res = await fetch(`${server.url}/${file}`, { headers, method });
  return { res, data: Buffer.from(await res.arrayBuffer()) };
};

test('a whole file comes with its length and accepts byte ranges', async () => {
  const { res, data } = await get('music.wav');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), '1000');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(data, body);
});

test('a range is served as 206 with its Content-Range', async () => {
  const { res, data } = await get('music.wav', { Range: 'bytes=100-199' });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal(res.headers.get('content-length'), '100');
  assert.deepEqual(data, body.subarray(100, 200));
});

test('open and suffix ranges, and a range past the end, are cut to the file', async () => {
  const open = await get('music.wav', { Range: 'bytes=990-' });
  assert.equal(open.res.headers.get('content-range'), 'bytes 990-999/1000');
  assert.deepEqual(open.data, body.subarray(990));

  const suffix = await get('music.wav', { Range: 'bytes=-10' });
  assert.deepEqual(suffix.data, body.subarray(990));

  const past = await get('music.wav', { Range: 'bytes=900-5000' });
  assert.equal(past.res.headers.get('content-range'), 'bytes 900-999/1000');
  assert.equal(past.data.length, 100);
});

test('a range that starts past the end is refused with 416', async () => {
  const { res } = await get('music.wav', { Range: 'bytes=1000-' });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */1000');
});

test('HEAD gives the length without the body', async () => {
  const { res, data } = await get('music.wav', {}, 'HEAD');
  assert.equal(res.headers.get('content-length'), '1000');
  assert.equal(data.length, 0);
});

test('audio types the browser needs to play', async () => {
  const { res } = await get('voice.m4a');
  assert.equal(res.headers.get('content-type'), 'audio/mp4');
});
