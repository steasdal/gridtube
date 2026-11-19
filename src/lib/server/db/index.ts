import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { asc, count, gt, isNull, sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Pool } from 'pg';
import { logger } from '$lib/server/logger';
import { generateInitialAdminPassword, hashPassword } from '$lib/server/password';
import type { Grid } from '$lib/types';
import { normalizeFeedsList } from '$lib/youtube';
import * as schema from './schema';

export type AppDatabase = PgliteDatabase<typeof schema>;

const DEFAULT_GRIDS: Grid[] = [
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

function getDataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
}

function getMigrationsFolder(): string {
  return path.resolve(process.env.MIGRATIONS_DIR || path.join(process.cwd(), 'drizzle'));
}

function redactDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return 'postgres://***';
  }
}

interface DbContext {
  db: AppDatabase;
  driver: 'postgres' | 'pglite';
  target: string;
  pool: Pool | null;
}

export interface DbMetricsSnapshot {
  driver: 'postgres' | 'pglite';
  up: boolean;
  pool: {
    total: number;
    idle: number;
    waiting: number;
  } | null;
  counts: {
    adminUsers: number;
    standardUsers: number;
    activeSessions: number;
    grids: number;
    publicGrids: number;
  } | null;
}

let dbContextPromise: Promise<DbContext> | null = null;

async function ensureInitialAdminUser(db: AppDatabase): Promise<string> {
  const existingAdmins = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .orderBy(asc(schema.users.createdAt));

  if (existingAdmins.length > 0) {
    const admin = existingAdmins.find((u) => u.role === 'admin') ?? existingAdmins[0];
    return admin.id;
  }

  const adminId = crypto.randomUUID();
  const initialPassword = generateInitialAdminPassword(16);
  const passwordHash = await hashPassword(initialPassword);

  await db.insert(schema.users).values({
    id: adminId,
    username: 'admin',
    usernameLower: 'admin',
    passwordHash,
    role: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: null
  });

  console.info(
    [
      '',
      '========================================================================',
      '  GRIDTUBE INITIAL ADMIN ACCOUNT CREATED',
      '  --------------------------------------------------------------------',
      '  Username : admin',
      `  Password : ${initialPassword}`,
      '  (Save or change this password after logging in at /profile.)',
      '========================================================================',
      ''
    ].join('\n')
  );

  return adminId;
}

async function insertGridsWithUrls(db: AppDatabase, items: Grid[], ownerUserId: string): Promise<void> {
  if (items.length === 0) return;

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.grids)
      .values(
        items.map((grid) => ({
          id: grid.id,
          userId: grid.userId || ownerUserId,
          name: grid.name,
          createdAt: grid.createdAt,
          updatedAt: grid.updatedAt ?? null
        }))
      )
      .onConflictDoNothing();

    const urlRows = items.flatMap((grid) =>
      normalizeFeedsList(grid.feeds).map((feed, slot) => ({
        id: crypto.randomUUID(),
        gridId: grid.id,
        slot,
        url: feed.url,
        volume: feed.volume,
        muted: feed.muted
      }))
    );

    if (urlRows.length > 0) {
      await tx.insert(schema.gridUrls).values(urlRows).onConflictDoNothing();
    }
  });
}

async function seedOrImportInitialGrids(
  db: AppDatabase,
  dataDir: string,
  ownerUserId: string
): Promise<void> {
  const [{ value: existingCount }] = await db.select({ value: count() }).from(schema.grids);
  if (existingCount > 0) return;

  const legacyFile = path.join(dataDir, 'grids.json');
  if (fsSync.existsSync(legacyFile)) {
    try {
      const raw = await fs.readFile(legacyFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const items: Grid[] = parsed
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : crypto.randomUUID(),
            name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Untitled Grid',
            feeds: normalizeFeedsList(item.feeds),
            createdAt:
              typeof item.createdAt === 'string' && item.createdAt
                ? item.createdAt
                : new Date().toISOString(),
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null
          }));
        if (items.length > 0) {
          await insertGridsWithUrls(db, items, ownerUserId);
          logger.info('db.legacy_import.completed', { count: items.length, legacyFile });
        }
      }
      return;
    } catch (err) {
      logger.error('db.legacy_import.failed', { legacyFile, err });
    }
  }

  await insertGridsWithUrls(db, DEFAULT_GRIDS, ownerUserId);
}

async function bootstrapDatabaseState(db: AppDatabase, dataDir: string): Promise<void> {
  const adminUserId = await ensureInitialAdminUser(db);

  // Assign any pre-auth grids (where user_id is NULL after 0002 migration) to initial admin,
  // then enforce NOT NULL on grids.user_id.
  await db.update(schema.grids).set({ userId: adminUserId }).where(isNull(schema.grids.userId));
  await db.execute(sql`ALTER TABLE "grids" ALTER COLUMN "user_id" SET NOT NULL`);

  await seedOrImportInitialGrids(db, dataDir, adminUserId);
}

async function createDbContext(): Promise<DbContext> {
  const dataDir = getDataDir();
  const migrationsFolder = getMigrationsFolder();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    const pgDb = drizzlePg(pool, { schema });
    await migratePg(pgDb, { migrationsFolder });
    const db = pgDb as unknown as AppDatabase;
    await bootstrapDatabaseState(db, dataDir);
    const target = redactDatabaseUrl(databaseUrl);
    logger.info('db.ready', { driver: 'postgres', target });
    return { db, driver: 'postgres', target, pool };
  }

  const pgDataDir = path.join(dataDir, 'pgdata');
  await fs.mkdir(pgDataDir, { recursive: true });
  const client = new PGlite(pgDataDir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  await bootstrapDatabaseState(db, dataDir);
  logger.info('db.ready', { driver: 'pglite', target: pgDataDir });
  return { db, driver: 'pglite', target: pgDataDir, pool: null };
}

export async function initDatabase(): Promise<DbContext> {
  if (!dbContextPromise) {
    dbContextPromise = createDbContext().catch((err) => {
      dbContextPromise = null;
      throw err;
    });
  }
  return dbContextPromise;
}

export async function getDb(): Promise<AppDatabase> {
  const ctx = await initDatabase();
  return ctx.db;
}

export async function getDatabaseHealth(): Promise<{ driver: 'postgres' | 'pglite'; target: string }> {
  const ctx = await initDatabase();
  return { driver: ctx.driver, target: ctx.target };
}

export async function getDbMetricsSnapshot(): Promise<DbMetricsSnapshot> {
  const ctx = await initDatabase();
  const poolStats = ctx.pool
    ? {
        total: ctx.pool.totalCount,
        idle: ctx.pool.idleCount,
        waiting: ctx.pool.waitingCount
      }
    : null;

  try {
    const nowIso = new Date().toISOString();
    const [userRoleRows, sessionRows, gridRows, publicGridRows] = await Promise.all([
      ctx.db
        .select({ role: schema.users.role, value: count() })
        .from(schema.users)
        .groupBy(schema.users.role),
      ctx.db
        .select({ value: count() })
        .from(schema.userSessions)
        .where(gt(schema.userSessions.expiresAt, nowIso)),
      ctx.db.select({ value: count() }).from(schema.grids),
      ctx.db.select({ value: count() }).from(schema.publicGrids)
    ]);

    let adminUsers = 0;
    let standardUsers = 0;
    for (const row of userRoleRows) {
      if (row.role === 'admin') {
        adminUsers = Number(row.value);
      } else {
        standardUsers += Number(row.value);
      }
    }

    return {
      driver: ctx.driver,
      up: true,
      pool: poolStats,
      counts: {
        adminUsers,
        standardUsers,
        activeSessions: Number(sessionRows[0]?.value ?? 0),
        grids: Number(gridRows[0]?.value ?? 0),
        publicGrids: Number(publicGridRows[0]?.value ?? 0)
      }
    };
  } catch (err) {
    logger.error('metrics.db_snapshot.failed', { err });
    return {
      driver: ctx.driver,
      up: false,
      pool: poolStats,
      counts: null
    };
  }
}
