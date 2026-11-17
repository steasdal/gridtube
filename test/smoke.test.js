import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD_ENTRY = path.join(REPO_ROOT, 'build', 'index.js');

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
        agent: false,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : method !== 'GET'
            ? { 'Content-Type': 'application/json' }
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
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await request('/api/health');
      if (res.status === 200) return;
    } catch {
      // Wait for server startup + PGlite migration
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server failed to become ready within 5 seconds');
}

function stopProcess(proc) {
  if (!proc || proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore if already exited
      }
      resolve();
    }, 500);
    proc.once('exit', () => {
      clearTimeout(forceTimer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

describe('GridTube SvelteKit + Drizzle (PGlite) Smoke Suite', () => {
  before(async () => {
    assert.ok(fs.existsSync(BUILD_ENTRY), 'Run "npm run build" before running smoke tests');
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridtube-smoke-'));
    serverProc = spawn(process.execPath, [BUILD_ENTRY], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(PORT), DATA_DIR: tmpDataDir },
      stdio: 'ignore'
    });
    await waitForServerReady();
  });

  after(async () => {
    await stopProcess(serverProc);
    if (tmpDataDir) {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });

  it('runs migrations cleanly on PGlite and exposes health & version', async () => {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');
    assert.equal(health.json.driver, 'pglite');

    const version = await request('/api/version');
    assert.equal(version.status, 200);
    assert.ok(typeof version.json.version === 'string' && version.json.version.length > 0);
  });

  it('serves SSR pages and redirects unknown grid IDs to /', async () => {
    const landing = await request('/');
    assert.equal(landing.status, 200);
    assert.match(landing.raw, /GridTube/);
    assert.match(landing.raw, /choo-choos/);

    const player = await request('/grid/choo-choos');
    assert.equal(player.status, 200);
    assert.match(player.raw, /choo-choos/);

    const missing = await request('/grid/does-not-exist');
    assert.equal(missing.status, 302);
    assert.equal(missing.headers.location, '/');
  });

  it('supports create, read, update, and delete on /api/grids with validation', async () => {
    const initial = await request('/api/grids');
    assert.equal(initial.status, 200);
    assert.ok(Array.isArray(initial.json) && initial.json.length === 1);

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

  it('imports legacy DATA_DIR/grids.json on first boot when table is empty', async () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridtube-legacy-test-'));
    const legacyPort = PORT + 1;
    fs.writeFileSync(
      path.join(legacyDir, 'grids.json'),
      JSON.stringify([
        {
          id: 'legacy-import-1',
          name: 'Legacy Import Grid',
          feeds: [{ url: 'https://www.youtube.com/watch?v=4XYbh4Pegzw', volume: 33, muted: false }],
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ])
    );

    const legacyProc = spawn(process.execPath, [BUILD_ENTRY], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(legacyPort), DATA_DIR: legacyDir },
      stdio: 'ignore'
    });

    try {
      for (let i = 0; i < 50; i++) {
        try {
          const ok = await new Promise((resolve) => {
            http
              .get(`http://127.0.0.1:${legacyPort}/api/health`, { agent: false }, (res) => {
                res.resume();
                resolve(res.statusCode === 200);
              })
              .on('error', () => resolve(false));
          });
          if (ok) break;
        } catch {
          // Wait
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      const grids = await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${legacyPort}/api/grids`, { agent: false }, (res) => {
            let raw = '';
            res.on('data', (c) => (raw += c));
            res.on('end', () => resolve(JSON.parse(raw)));
          })
          .on('error', reject);
      });

      assert.equal(grids.length, 1);
      assert.equal(grids[0].id, 'legacy-import-1');
      assert.equal(grids[0].feeds[0].volume, 33);
    } finally {
      await stopProcess(legacyProc);
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
