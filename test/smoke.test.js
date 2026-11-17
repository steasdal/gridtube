const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 18940 + (process.pid % 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
let tmpDataDir;
let serverProc;

function request(urlPath, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const req = http.request(
      `${BASE_URL}${urlPath}`,
      {
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : {}
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          if ((res.headers['content-type'] || '').includes('application/json')) {
            json = JSON.parse(raw);
          }
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServerReady() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await request('/api/health');
      if (res.status === 200) return;
    } catch {
      // Wait for server startup
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server failed to become ready within 4 seconds');
}

describe('GridTube HTTP API & Static Assets', () => {
  before(async () => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridtube-smoke-'));
    serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT), DATA_DIR: tmpDataDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForServerReady();
  });

  after(() => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill();
    }
    if (tmpDataDir) {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });

  it('serves health and version endpoints', async () => {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');

    const version = await request('/api/version');
    assert.equal(version.status, 200);
    assert.ok(typeof version.json.version === 'string' && version.json.version.length > 0);
  });

  it('serves index.html with no-cache headers and versioned assets', async () => {
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'] || '', /no-cache/);
    assert.match(res.raw, /GridTube/);
    assert.match(res.raw, /app\.js\?v=/);
  });

  it('supports create, read, update, and delete on /api/grids with validation', async () => {
    const initial = await request('/api/grids');
    assert.equal(initial.status, 200);
    assert.ok(Array.isArray(initial.json) && initial.json.length >= 1);

    const bad = await request('/api/grids', {
      method: 'POST',
      body: { name: 'Bad Feed', feeds: ['https://example.com/not-youtube'] }
    });
    assert.equal(bad.status, 400);

    const created = await request('/api/grids', {
      method: 'POST',
      body: {
        name: 'CI Test Grid',
        feeds: [{ url: 'https://www.youtube.com/watch?v=4XYbh4Pegzw', volume: 55, muted: false }]
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.feeds[0].volume, 55);

    const updated = await request(`/api/grids/${encodeURIComponent(created.json.id)}`, {
      method: 'PUT',
      body: {
        name: 'CI Test Grid Updated',
        feeds: [{ url: 'https://www.youtube.com/watch?v=4XYbh4Pegzw', volume: 22, muted: true }]
      }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.feeds[0].volume, 22);
    assert.equal(updated.json.feeds[0].muted, true);

    const deleted = await request(`/api/grids/${encodeURIComponent(created.json.id)}`, {
      method: 'DELETE'
    });
    assert.equal(deleted.status, 200);

    const missing = await request(`/api/grids/${encodeURIComponent(created.json.id)}`, {
      method: 'DELETE'
    });
    assert.equal(missing.status, 404);
  });
});
