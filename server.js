const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const GRIDS_FILE = path.join(DATA_DIR, 'grids.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const VERSION_FILE = path.join(__dirname, 'version.yml');

function loadAppVersion() {
  try {
    const raw = fsSync.readFileSync(VERSION_FILE, 'utf8');
    const match = raw.match(/^\s*version\s*:\s*["']?([^\r\n"']+?)["']?\s*$/m);
    return match && match[1] ? match[1].trim() : 'local';
  } catch {
    return 'local';
  }
}

const APP_VERSION = loadAppVersion();

const DEFAULT_GRIDS = [
  {
    id: 'choo-choos',
    name: 'choo-choos',
    feeds: [
      { url: 'https://www.youtube.com/watch?v=4XYbh4Pegzw', volume: 100, muted: false },
      { url: 'https://www.youtube.com/watch?v=9SLt3AT0rXk', volume: 100, muted: false },
      { url: 'https://www.youtube.com/watch?v=-lqCofAp-yI', volume: 100, muted: false },
      { url: '', volume: 100, muted: false }
    ],
    createdAt: new Date().toISOString()
  }
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function normalizeFeedEntry(entry) {
  if (typeof entry === 'string') {
    return { url: entry.trim(), volume: 100, muted: false };
  }
  if (entry && typeof entry === 'object') {
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    const rawVol = Number(entry.volume);
    const volume = Number.isFinite(rawVol)
      ? Math.max(0, Math.min(100, Math.round(rawVol)))
      : 100;
    const muted = Boolean(entry.muted);
    return { url, volume, muted };
  }
  return { url: '', volume: 100, muted: false };
}

function normalizeGrid(grid) {
  const rawFeeds = Array.isArray(grid?.feeds) ? grid.feeds : [];
  return {
    ...grid,
    feeds: [0, 1, 2, 3].map((i) => normalizeFeedEntry(rawFeeds[i]))
  };
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!fsSync.existsSync(GRIDS_FILE)) {
    await writeGrids(DEFAULT_GRIDS);
  }
}

async function readGrids() {
  await ensureDataFile();
  try {
    const raw = await fs.readFile(GRIDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeGrid) : [];
  } catch (err) {
    console.error('Failed to read grids.json, returning empty list:', err.message);
    return [];
  }
}

async function writeGrids(grids) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${GRIDS_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(grids, null, 2), 'utf8');
  await fs.rename(tmpFile, GRIDS_FILE);
}

function extractYouTubeId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return '';

  // Allow direct 11-char YouTube video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['embed', 'live', 'shorts', 'v'].includes(parts[0])) {
        const candidate = parts[1];
        if (/^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function validateGridPayload(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object.' };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return { error: 'Grid name is required.' };
  }
  if (name.length > 80) {
    return { error: 'Grid name must be 80 characters or fewer.' };
  }

  if (!Array.isArray(body.feeds) || body.feeds.length > 4) {
    return { error: 'Feeds must be an array of up to 4 URLs.' };
  }

  const normalizedFeeds = [0, 1, 2, 3].map((idx) => normalizeFeedEntry(body.feeds[idx]));

  for (let i = 0; i < 4; i++) {
    const { url } = normalizedFeeds[i];
    if (url !== '') {
      const videoId = extractYouTubeId(url);
      if (!videoId) {
        return { error: `Feed ${i + 1} is not a valid YouTube URL or 11-character video ID.` };
      }
    }
  }

  return { name, feeds: normalizedFeeds };
}

function sendJson(res, statusCode, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { status: 'ok', version: APP_VERSION, storage: GRIDS_FILE });
    }

    if (pathname === '/api/version' && req.method === 'GET') {
      return sendJson(res, 200, { version: APP_VERSION });
    }

    if (pathname === '/api/grids' && req.method === 'GET') {
      const grids = await readGrids();
      return sendJson(res, 200, grids);
    }

    if (pathname === '/api/grids' && req.method === 'POST') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const validated = validateGridPayload(body);
      if (validated.error) {
        return sendJson(res, 400, { error: validated.error });
      }

      const grids = await readGrids();
      const newGrid = {
        id: crypto.randomUUID(),
        name: validated.name,
        feeds: validated.feeds,
        createdAt: new Date().toISOString()
      };

      grids.push(newGrid);
      await writeGrids(grids);
      return sendJson(res, 201, newGrid);
    }

    if (pathname.startsWith('/api/grids/') && (req.method === 'DELETE' || req.method === 'PUT')) {
      const id = decodeURIComponent(pathname.slice('/api/grids/'.length));
      if (!id) {
        return sendJson(res, 400, { error: 'Grid ID is required.' });
      }

      const grids = await readGrids();
      const idx = grids.findIndex((g) => g.id === id);
      if (idx === -1) {
        return sendJson(res, 404, { error: 'Grid not found.' });
      }

      if (req.method === 'DELETE') {
        const [removed] = grids.splice(idx, 1);
        await writeGrids(grids);
        return sendJson(res, 200, { deleted: removed.id });
      }

      if (req.method === 'PUT') {
        let body;
        try {
          body = await parseJsonBody(req);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }

        const validated = validateGridPayload(body);
        if (validated.error) {
          return sendJson(res, 400, { error: validated.error });
        }

        grids[idx] = {
          ...grids[idx],
          name: validated.name,
          feeds: validated.feeds,
          updatedAt: new Date().toISOString()
        };
        await writeGrids(grids);
        return sendJson(res, 200, grids[idx]);
      }
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'API endpoint not found.' });
    }

    // Serve static files from PUBLIC_DIR or fallback to index.html for SPA routing
    let safeRelPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    let candidatePath = path.resolve(PUBLIC_DIR, safeRelPath);

    if (!candidatePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    let stat;
    try {
      stat = await fs.stat(candidatePath);
    } catch {
      stat = null;
    }

    if (!stat || !stat.isFile()) {
      candidatePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(candidatePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    let content = await fs.readFile(candidatePath);
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, must-revalidate'
    };

    if (path.basename(candidatePath) === 'index.html') {
      const v = encodeURIComponent(APP_VERSION);
      const html = content
        .toString('utf8')
        .replace(/href="\/(styles\.css|favicon\.svg)"/g, `href="/$1?v=${v}"`)
        .replace(/src="\/(app\.js)"/g, `src="/$1?v=${v}"`);
      content = Buffer.from(html, 'utf8');
    } else if (APP_VERSION !== 'local' && parsedUrl.searchParams.get('v') === APP_VERSION) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }

    res.writeHead(200, headers);
    res.end(content);
  } catch (err) {
    console.error('Unhandled request error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

ensureDataFile()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`GridTube listening on http://0.0.0.0:${PORT} (DATA_DIR=${DATA_DIR})`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize data storage:', err);
    process.exit(1);
  });
