import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD_ENTRY = path.join(REPO_ROOT, 'build', 'index.js');

const PORT = 18940 + (process.pid % 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
let tmpDataDir;
let serverProc;
let adminInitialPassword;
let adminId;
let adminCookie;

function requestUrl(
  baseUrl,
  urlPath,
  { method = 'GET', body = null, cookie = '', headers: extraHeaders = {} } = {}
) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const headers = { ...extraHeaders };
    if (cookie) headers.Cookie = cookie;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    } else if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    const req = http.request(
      `${baseUrl}${urlPath}`,
      {
        method,
        agent: false,
        headers
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

function request(urlPath, opts = {}) {
  return requestUrl(BASE_URL, urlPath, opts);
}

function extractCookiePair(setCookieHeaders) {
  const list = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  const match = list.find((item) => item.startsWith('gridtube_session='));
  return match ? match.split(';')[0] : '';
}

async function loginAs(baseUrl, username, password) {
  const res = await requestUrl(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password }
  });
  return { res, cookie: extractCookiePair(res.headers['set-cookie']) };
}

async function startServer(port, dataDir) {
  const baseUrl = `http://127.0.0.1:${port}`;
  let logs = '';
  const proc = spawn(process.execPath, [BUILD_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await requestUrl(baseUrl, '/api/health');
      if (res.status === 200) {
        const pwMatch = /GRIDTUBE INITIAL ADMIN ACCOUNT CREATED[\s\S]*?Password\s*:\s*([A-Za-z0-9]+)/.exec(
          logs
        );
        return { proc, baseUrl, initialAdminPassword: pwMatch?.[1] ?? null, getLogs: () => logs };
      }
    } catch {
      // Wait for server startup + migrations
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  await stopProcess(proc);
  throw new Error(`Server failed to become ready on ${baseUrl}. Logs:\n${logs}`);
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

describe('GridTube SvelteKit + Drizzle + Auth Smoke Suite', () => {
  before(async () => {
    assert.ok(fs.existsSync(BUILD_ENTRY), 'Run "npm run build" before running smoke tests');
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridtube-smoke-'));
    const started = await startServer(PORT, tmpDataDir);
    serverProc = started.proc;
    adminInitialPassword = started.initialAdminPassword;
    assert.ok(adminInitialPassword, 'Initial admin password banner must be printed on first boot');

    const { res, cookie } = await loginAs(BASE_URL, 'admin', adminInitialPassword);
    assert.equal(res.status, 200);
    assert.equal(res.json.user.username, 'admin');
    assert.equal(res.json.user.role, 'admin');
    assert.ok(cookie.startsWith('gridtube_session='));
    const setCookieHeader = String(res.headers['set-cookie']);
    assert.match(setCookieHeader, /HttpOnly/i);
    assert.match(setCookieHeader, /Max-Age=604800/i);
    adminId = res.json.user.id;
    adminCookie = cookie;
  });

  after(async () => {
    await stopProcess(serverProc);
    if (tmpDataDir) {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });

  it('keeps health and version unauthenticated while protecting app and grid APIs', async () => {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');
    assert.equal(health.json.driver, 'pglite');

    const version = await request('/api/version');
    assert.equal(version.status, 200);
    assert.ok(typeof version.json.version === 'string' && version.json.version.length > 0);

    const anonGrids = await request('/api/grids');
    assert.equal(anonGrids.status, 401);

    const anonMe = await request('/api/auth/me');
    assert.equal(anonMe.status, 401);

    const badLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'wrong-password-123' }
    });
    assert.equal(badLogin.status, 401);

    const unknownLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'nobody', password: 'wrong-password-123' }
    });
    assert.equal(unknownLogin.status, 401);

    const anonLanding = await request('/');
    assert.equal(anonLanding.status, 200);
    assert.match(anonLanding.raw, /id="login-form"/);
    assert.doesNotMatch(anonLanding.raw, /choo-choos/);

    const evilNext = await request('/?next=//evil.com');
    assert.equal(evilNext.status, 200);
    assert.doesNotMatch(evilNext.raw, /evil\.com/);

    const anonDeepLink = await request('/grid/choo-choos');
    assert.equal(anonDeepLink.status, 302);
    assert.equal(anonDeepLink.headers.location, '/?next=%2Fgrid%2Fchoo-choos');

    const anonProfile = await request('/profile');
    assert.equal(anonProfile.status, 302);
    assert.equal(anonProfile.headers.location, '/?next=%2Fprofile');

    const anonAdmin = await request('/admin');
    assert.equal(anonAdmin.status, 302);
    assert.equal(anonAdmin.headers.location, '/?next=%2Fadmin');
  });

  it('serves authenticated SSR pages, Bearer auth, and header button order', async () => {
    const token = adminCookie.split('=')[1];
    const bearerMe = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(bearerMe.status, 200);
    assert.equal(bearerMe.json.user.id, adminId);

    const landing = await request('/', { cookie: adminCookie });
    assert.equal(landing.status, 200);
    assert.match(landing.raw, /GridTube/);
    assert.match(landing.raw, /choo-choos/);
    assert.match(landing.raw, /href="\/admin"/);
    assert.match(landing.raw, /href="\/profile"/);
    assert.match(landing.raw, /id="nav-profile-link"[^>]*>Profile<\/a>/);
    const newGridPos = landing.raw.indexOf('id="new-grid-btn"');
    const profilePos = landing.raw.indexOf('id="nav-profile-link"');
    assert.ok(newGridPos > 0 && profilePos > newGridPos, 'New Grid button precedes Profile link');

    const profilePage = await request('/profile', { cookie: adminCookie });
    assert.equal(profilePage.status, 200);
    assert.match(profilePage.raw, /Change Username/);
    assert.match(profilePage.raw, /Change Password/);

    const adminPage = await request('/admin', { cookie: adminCookie });
    assert.equal(adminPage.status, 200);
    assert.match(adminPage.raw, /Administration/);
    assert.match(adminPage.raw, /id="add-user-btn"/);

    const player = await request('/grid/choo-choos', { cookie: adminCookie });
    assert.equal(player.status, 200);
    assert.match(player.raw, /choo-choos/);

    const missing = await request('/grid/does-not-exist', { cookie: adminCookie });
    assert.equal(missing.status, 302);
    assert.equal(missing.headers.location, '/');
  });

  it('supports create, read, update, and delete on /api/grids with validation', async () => {
    const initial = await request('/api/grids', { cookie: adminCookie });
    assert.equal(initial.status, 200);
    assert.ok(Array.isArray(initial.json) && initial.json.length === 1);

    const bad = await request('/api/grids', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Bad Feed', feeds: ['https://example.com/not-youtube'] }
    });
    assert.equal(bad.status, 400);

    const created = await request('/api/grids', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        name: 'CI Test Grid',
        feeds: [{ url: 'https://www.youtube.com/watch?v=4XYbh4Pegzw', volume: 55, muted: false }]
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.feeds[0].volume, 55);

    const updated = await request(`/api/grids/${encodeURIComponent(created.json.id)}`, {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        name: 'CI Test Grid Updated',
        feeds: [{ url: 'https://www.youtube.com/watch?v=4XYbh4Pegzw', volume: 22, muted: true }]
      }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.feeds[0].volume, 22);
    assert.equal(updated.json.feeds[0].muted, true);

    const deleted = await request(`/api/grids/${encodeURIComponent(created.json.id)}`, {
      method: 'DELETE',
      cookie: adminCookie
    });
    assert.equal(deleted.status, 200);

    const missing = await request(`/api/grids/${encodeURIComponent(created.json.id)}`, {
      method: 'DELETE',
      cookie: adminCookie
    });
    assert.equal(missing.status, 404);
  });

  it('enforces admin RBAC, user CRUD, grid privacy, profile updates, and logout', async () => {
    // Admin self-modification guards on /api/users/:id
    const selfEdit = await request(`/api/users/${encodeURIComponent(adminId)}`, {
      method: 'PUT',
      cookie: adminCookie,
      body: { username: 'admin', role: 'user' }
    });
    assert.equal(selfEdit.status, 400);
    const selfDelete = await request(`/api/users/${encodeURIComponent(adminId)}`, {
      method: 'DELETE',
      cookie: adminCookie
    });
    assert.equal(selfDelete.status, 400);

    // Reject empty/control-char usernames and short passwords (<12 chars); accept 12+ lowercase
    const badUsername = await request('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: '   ', password: 'alllowercase', role: 'user' }
    });
    assert.equal(badUsername.status, 400);

    const tooShort = await request('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'Alice', password: 'shortpass', role: 'user' }
    });
    assert.equal(tooShort.status, 400);

    const createdUser = await request('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'Alice', password: 'alllowercase', role: 'user' }
    });
    assert.equal(createdUser.status, 201);
    const aliceId = createdUser.json.user.id;
    assert.ok(aliceId);

    // Case-insensitive username uniqueness
    const dupCase = await request('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: '  alice ', password: 'anotherpassword', role: 'user' }
    });
    assert.equal(dupCase.status, 409);

    // Admin list excludes self ('admin')
    const userList = await request('/api/users', { cookie: adminCookie });
    assert.equal(userList.status, 200);
    assert.equal(userList.json.users.length, 1);
    assert.equal(userList.json.users[0].username, 'Alice');

    // Login twice as Alice (case-insensitive username) to test secondary session revocation
    const { res: aliceLogin, cookie: aliceCookie } = await loginAs(
      BASE_URL,
      'alice',
      'alllowercase'
    );
    assert.equal(aliceLogin.status, 200);
    assert.equal(aliceLogin.json.user.role, 'user');
    const { cookie: aliceSecondCookie } = await loginAs(BASE_URL, 'Alice', 'alllowercase');

    // Non-admin blocked from /api/users and /admin, and grids are strictly private (read & write)
    const forbiddenApi = await request('/api/users', { cookie: aliceCookie });
    assert.equal(forbiddenApi.status, 403);
    const forbiddenPage = await request('/admin', { cookie: aliceCookie });
    assert.equal(forbiddenPage.status, 302);
    assert.equal(forbiddenPage.headers.location, '/');
    const aliceProfilePage = await request('/profile', { cookie: aliceCookie });
    assert.equal(aliceProfilePage.status, 200);

    const aliceGridsEmpty = await request('/api/grids', { cookie: aliceCookie });
    assert.equal(aliceGridsEmpty.status, 200);
    assert.equal(aliceGridsEmpty.json.length, 0);

    const adminGridByAlice = await request('/api/grids/choo-choos', { cookie: aliceCookie });
    assert.equal(adminGridByAlice.status, 404);
    const adminGridUpdateByAlice = await request('/api/grids/choo-choos', {
      method: 'PUT',
      cookie: aliceCookie,
      body: { name: 'Hijack', feeds: [] }
    });
    assert.equal(adminGridUpdateByAlice.status, 404);
    const adminGridDeleteByAlice = await request('/api/grids/choo-choos', {
      method: 'DELETE',
      cookie: aliceCookie
    });
    assert.equal(adminGridDeleteByAlice.status, 404);
    const adminGridPageByAlice = await request('/grid/choo-choos', { cookie: aliceCookie });
    assert.equal(adminGridPageByAlice.status, 302);
    assert.equal(adminGridPageByAlice.headers.location, '/');

    const aliceCreatedGrid = await request('/api/grids', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        name: 'Alice Grid',
        feeds: [{ url: 'https://www.youtube.com/watch?v=4XYbh4Pegzw', volume: 80, muted: false }]
      }
    });
    assert.equal(aliceCreatedGrid.status, 201);

    // Profile: username-only collision -> 409, username-only update -> 200, wrong current pw -> 403
    const dupProfileUsername = await request('/api/profile', {
      method: 'PUT',
      cookie: aliceCookie,
      body: { username: 'ADMIN' }
    });
    assert.equal(dupProfileUsername.status, 409);

    const usernameOnlyProfile = await request('/api/profile', {
      method: 'PUT',
      cookie: aliceCookie,
      body: { username: 'AliceRenamed' }
    });
    assert.equal(usernameOnlyProfile.status, 200);
    assert.equal(usernameOnlyProfile.json.user.username, 'AliceRenamed');

    const badProfilePw = await request('/api/profile', {
      method: 'PUT',
      cookie: aliceCookie,
      body: { currentPassword: 'wrongpassword', newPassword: 'newlowercasepw' }
    });
    assert.equal(badProfilePw.status, 403);

    // Password-only update keeps CURRENT session alive and revokes OTHER sessions for the same user
    const okProfile = await request('/api/profile', {
      method: 'PUT',
      cookie: aliceCookie,
      body: {
        currentPassword: 'alllowercase',
        newPassword: 'newlowercasepw'
      }
    });
    assert.equal(okProfile.status, 200);
    assert.equal((await request('/api/auth/me', { cookie: aliceCookie })).status, 200);
    assert.equal((await request('/api/auth/me', { cookie: aliceSecondCookie })).status, 401);

    // Admin edits Alice's role/password without needing current password -> revokes Alice's session
    const adminEdit = await request(`/api/users/${encodeURIComponent(aliceId)}`, {
      method: 'PUT',
      cookie: adminCookie,
      body: { username: 'AlicePromoted', role: 'admin', password: 'adminresetpw12' }
    });
    assert.equal(adminEdit.status, 200);
    assert.equal(adminEdit.json.user.role, 'admin');

    const revokedAfterEdit = await request('/api/grids', { cookie: aliceCookie });
    assert.equal(revokedAfterEdit.status, 401);

    // Login with admin-reset password works
    const { res: relogin, cookie: promotedCookie } = await loginAs(
      BASE_URL,
      'AlicePromoted',
      'adminresetpw12'
    );
    assert.equal(relogin.status, 200);
    assert.equal(relogin.json.user.role, 'admin');

    // Logout invalidates token
    const logout = await request('/api/auth/logout', { method: 'POST', cookie: promotedCookie });
    assert.equal(logout.status, 200);
    const afterLogout = await request('/api/grids', { cookie: promotedCookie });
    assert.equal(afterLogout.status, 401);

    // Admin deletes AlicePromoted -> cascades her grids too
    const delUser = await request(`/api/users/${encodeURIComponent(aliceId)}`, {
      method: 'DELETE',
      cookie: adminCookie
    });
    assert.equal(delUser.status, 200);
  });

  it('imports legacy DATA_DIR/grids.json on first boot and assigns to initial admin', async () => {
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

    const started = await startServer(legacyPort, legacyDir);
    try {
      assert.ok(started.initialAdminPassword);
      const { res: loginRes, cookie } = await loginAs(
        started.baseUrl,
        'admin',
        started.initialAdminPassword
      );
      assert.equal(loginRes.status, 200);

      const grids = await requestUrl(started.baseUrl, '/api/grids', { cookie });
      assert.equal(grids.status, 200);
      assert.equal(grids.json.length, 1);
      assert.equal(grids.json[0].id, 'legacy-import-1');
      assert.equal(grids.json[0].feeds[0].volume, 33);
    } finally {
      await stopProcess(started.proc);
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it('migrates 0000 -> 0002 (grids.feeds JSONB -> grid_urls + users ownership) cleanly', async () => {
    const upgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridtube-upgrade-test-'));
    const tmpMigrationsDir = path.join(upgradeDir, 'migrations0000');
    const upgradePort = PORT + 2;

    fs.mkdirSync(path.join(tmpMigrationsDir, 'meta'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'drizzle', '0000_bored_puck.sql'),
      path.join(tmpMigrationsDir, '0000_bored_puck.sql')
    );
    const fullJournal = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8')
    );
    fs.writeFileSync(
      path.join(tmpMigrationsDir, 'meta', '_journal.json'),
      JSON.stringify({ ...fullJournal, entries: [fullJournal.entries[0]] })
    );

    const pgDataPath = path.join(upgradeDir, 'pgdata');
    const pgInitial = new PGlite(pgDataPath);
    await migrate(drizzle(pgInitial), { migrationsFolder: tmpMigrationsDir });
    await pgInitial.query(
      `INSERT INTO "grids" ("id", "name", "feeds") VALUES
        ($1, $2, $3::jsonb),
        ($4, $5, $6::jsonb)`,
      [
        'upgrade-grid-1',
        'Upgrade Primary',
        JSON.stringify([
          { url: 'https://www.youtube.com/watch?v=4XYbh4Pegzw', muted: false, volume: 100 },
          { url: 'https://www.youtube.com/watch?v=9SLt3AT0rXk', muted: true, volume: 50 },
          { url: 'https://www.youtube.com/watch?v=-IqCofAp-yI', muted: false, volume: 25 },
          { url: 'https://www.youtube.com/watch?v=7xdHH9KMSVk', muted: false, volume: 75 }
        ]),
        'upgrade-grid-2',
        'Upgrade Cascade Target',
        JSON.stringify([{ url: 'https://www.youtube.com/watch?v=5qap5aO4i9A', muted: true, volume: 10 }])
      ]
    );
    await pgInitial.close();

    const started = await startServer(upgradePort, upgradeDir);
    try {
      assert.ok(started.initialAdminPassword);
      const { res: loginRes, cookie } = await loginAs(
        started.baseUrl,
        'admin',
        started.initialAdminPassword
      );
      assert.equal(loginRes.status, 200);

      const grids = await requestUrl(started.baseUrl, '/api/grids', { cookie });
      assert.equal(grids.status, 200);
      assert.equal(grids.json.length, 2);
      const first = grids.json.find((g) => g.id === 'upgrade-grid-1');
      assert.ok(first);
      assert.equal(first.feeds.length, 4);
      assert.deepEqual(first.feeds[1], {
        url: 'https://www.youtube.com/watch?v=9SLt3AT0rXk',
        volume: 50,
        muted: true
      });
      assert.equal(first.feeds[2].volume, 25);

      const del = await requestUrl(started.baseUrl, '/api/grids/upgrade-grid-2', {
        method: 'DELETE',
        cookie
      });
      assert.equal(del.status, 200);

      await stopProcess(started.proc);

      const pgAfter = new PGlite(pgDataPath);
      const userIdCol = await pgAfter.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'grids' AND column_name = 'user_id'`
      );
      assert.equal(userIdCol.rows.length, 1);
      assert.equal(userIdCol.rows[0].is_nullable, 'NO');

      const urlRows = await pgAfter.query(
        `SELECT grid_id, slot, url, volume, muted FROM grid_urls ORDER BY grid_id, slot`
      );
      assert.equal(urlRows.rows.length, 4);
      assert.deepEqual(
        urlRows.rows.map((r) => [r.grid_id, r.slot, r.volume, r.muted]),
        [
          ['upgrade-grid-1', 0, 100, false],
          ['upgrade-grid-1', 1, 50, true],
          ['upgrade-grid-1', 2, 25, false],
          ['upgrade-grid-1', 3, 75, false]
        ]
      );
      await pgAfter.close();
    } finally {
      await stopProcess(started.proc);
      fs.rmSync(upgradeDir, { recursive: true, force: true });
    }
  });

  it('verifies 7-day sliding session refresh, expired cleanup, and user delete cascade', async () => {
    const lifecycleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridtube-session-test-'));
    const lifecyclePort = PORT + 3;
    const pgDataPath = path.join(lifecycleDir, 'pgdata');

    let started = await startServer(lifecyclePort, lifecycleDir);
    try {
      const { res: loginRes, cookie } = await loginAs(
        started.baseUrl,
        'admin',
        started.initialAdminPassword
      );
      assert.equal(loginRes.status, 200);

      // Create user Bob with a grid, then delete Bob and verify DB cascade
      const bobRes = await requestUrl(started.baseUrl, '/api/users', {
        method: 'POST',
        cookie,
        body: { username: 'Bob', password: 'bobspassword12', role: 'user' }
      });
      assert.equal(bobRes.status, 201);
      const bobId = bobRes.json.user.id;
      const { cookie: bobCookie } = await loginAs(started.baseUrl, 'Bob', 'bobspassword12');

      const bobGridRes = await requestUrl(started.baseUrl, '/api/grids', {
        method: 'POST',
        cookie: bobCookie,
        body: {
          name: 'Bob Private Grid',
          feeds: [{ url: 'https://www.youtube.com/watch?v=4XYbh4Pegzw', volume: 50, muted: false }]
        }
      });
      assert.equal(bobGridRes.status, 201);
      const bobGridId = bobGridRes.json.id;

      const delBob = await requestUrl(started.baseUrl, `/api/users/${encodeURIComponent(bobId)}`, {
        method: 'DELETE',
        cookie
      });
      assert.equal(delBob.status, 200);

      await stopProcess(started.proc);

      // Verify Bob's grids and grid_urls cascaded, then backdate admin session to test sliding window
      const pgMid = new PGlite(pgDataPath);
      const bobGridsAfter = await pgMid.query(`SELECT id FROM grids WHERE id = $1`, [bobGridId]);
      assert.equal(bobGridsAfter.rows.length, 0);
      const bobUrlsAfter = await pgMid.query(`SELECT id FROM grid_urls WHERE grid_id = $1`, [bobGridId]);
      assert.equal(bobUrlsAfter.rows.length, 0);

      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const fiveDaysLater = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      await pgMid.query(`UPDATE user_sessions SET last_seen_at = $1, expires_at = $2`, [
        twoDaysAgo,
        fiveDaysLater
      ]);
      await pgMid.close();

      started = await startServer(lifecyclePort, lifecycleDir);
      const slideRes = await requestUrl(started.baseUrl, '/api/auth/me', { cookie });
      assert.equal(slideRes.status, 200);
      assert.match(String(slideRes.headers['set-cookie']), /gridtube_session=.*Max-Age=604800/i);

      await stopProcess(started.proc);

      const pgCheckSlide = new PGlite(pgDataPath);
      const slidRows = await pgCheckSlide.query(`SELECT expires_at FROM user_sessions LIMIT 1`);
      assert.equal(slidRows.rows.length, 1);
      assert.ok(new Date(slidRows.rows[0].expires_at).getTime() > Date.parse(fiveDaysLater));

      // Expire the session in DB and confirm rejection + row cleanup + cookie clearing
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await pgCheckSlide.query(`UPDATE user_sessions SET expires_at = $1`, [oneHourAgo]);
      await pgCheckSlide.close();

      started = await startServer(lifecyclePort, lifecycleDir);
      const expiredRes = await requestUrl(started.baseUrl, '/api/auth/me', { cookie });
      assert.equal(expiredRes.status, 401);
      const clearedCookieHeader = String(expiredRes.headers['set-cookie'] || '');
      assert.match(clearedCookieHeader, /gridtube_session=;/i);

      await stopProcess(started.proc);
      const pgAfterExpiry = new PGlite(pgDataPath);
      const remaining = await pgAfterExpiry.query(`SELECT id FROM user_sessions`);
      assert.equal(remaining.rows.length, 0);
      await pgAfterExpiry.close();
    } finally {
      await stopProcess(started.proc);
      fs.rmSync(lifecycleDir, { recursive: true, force: true });
    }
  });
});
