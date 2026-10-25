import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { extractFrame } from './extract-frame.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mov': 'video/quicktime',
};

/** The byte range a `Range: bytes=…` header asks for, null when it asks for none, 'invalid' when it cannot be served. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Several ranges (multipart): serve the whole file instead
  if (!match) return header.includes(',') ? null : 'invalid';
  const [, from, to] = match;
  let start: number;
  let end: number;
  if (from === '') {
    // The last N bytes
    if (to === '') return 'invalid';
    start = Math.max(0, size - Number(to));
    end = size - 1;
  } else {
    start = Number(from);
    end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

/** LRU cache for extracted video frames. */
class FrameCache {
  private cache = new Map<string, { data: Buffer; lastAccessed: number }>();
  private currentBytes = 0;
  private maxBytes: number;

  constructor(maxBytes = 512 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  get(key: string): Buffer | null {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.data;
    }
    return null;
  }

  set(key: string, data: Buffer): void {
    while (this.currentBytes + data.length > this.maxBytes && this.cache.size > 0) {
      this.evictOldest();
    }
    this.cache.set(key, { data, lastAccessed: Date.now() });
    this.currentBytes += data.length;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const entry = this.cache.get(oldestKey)!;
      this.currentBytes -= entry.data.length;
      this.cache.delete(oldestKey);
    }
  }
}

export interface ServeResult {
  url: string;
  port: number;
  close: () => void;
}

export function startServer(rootDir: string, preferredPort = 0): Promise<ServeResult> {
  const frameCache = new FrameCache();
  const pendingExtractions = new Map<string, Promise<Buffer>>();

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsed = new URL(req.url ?? '/', `http://localhost`);

      // --- OffthreadVideo frame extraction endpoint ---
      if (parsed.pathname === '/__offthread_video__') {
        const src = parsed.searchParams.get('src');
        const timeStr = parsed.searchParams.get('time');

        if (!src || !timeStr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required params: src, time' }));
          return;
        }

        const timeInSeconds = parseFloat(timeStr);
        if (isNaN(timeInSeconds)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid time value' }));
          return;
        }

        // Path traversal protection
        const videoPath = path.resolve(rootDir, src.startsWith('/') ? src.slice(1) : src);
        if (!videoPath.startsWith(path.resolve(rootDir))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
          return;
        }

        if (!fs.existsSync(videoPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Video file not found: ${src}` }));
          return;
        }

        const formatParam = parsed.searchParams.get('format');
        const imageFormat: 'png' | 'jpeg' = formatParam === 'jpeg' ? 'jpeg' : 'png';
        const cacheKey = `${src}:${timeInSeconds.toFixed(6)}:${imageFormat}`;

        try {
          // Check cache
          let data = frameCache.get(cacheKey);

          if (!data) {
            // Deduplicate concurrent requests for the same frame
            let pending = pendingExtractions.get(cacheKey);
            if (!pending) {
              pending = extractFrame({ videoPath, timeInSeconds, imageFormat }).then((buf) => {
                frameCache.set(cacheKey, buf);
                pendingExtractions.delete(cacheKey);
                return buf;
              }).catch((err) => {
                pendingExtractions.delete(cacheKey);
                throw err;
              });
              pendingExtractions.set(cacheKey, pending);
            }
            data = await pending;
          }

          res.writeHead(200, {
            'Content-Type': imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
            'Content-Length': String(data.length),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000, immutable',
          });
          res.end(data);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      // --- Static file serving ---
      const urlPath = decodeURIComponent(parsed.pathname);
      let filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);

      // Try with .html extension if no extension
      if (!path.extname(filePath) && !fs.existsSync(filePath)) {
        filePath += '.html';
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // Content-Length and byte ranges: without them, the browser sees an audio or video file as a stream of unknown
      // length (duration Infinity) and cannot seek in it.
      const size = fs.statSync(filePath).size;
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
      };
      const range = parseRange(req.headers.range, size);
      if (range === 'invalid') {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }
      const { start, end } = range ?? { start: 0, end: size - 1 };
      res.writeHead(range ? 206 : 200, {
        ...headers,
        'Content-Length': String(size === 0 ? 0 : end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      });
      if (req.method === 'HEAD' || size === 0) {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });

    server.on('error', reject);

    server.listen(preferredPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => server.close(),
      });
    });
  });
}
