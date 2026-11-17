import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { count } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Pool } from 'pg';
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
}

let dbContextPromise: Promise<DbContext> | null = null;

async function seedOrImportInitialGrids(db: AppDatabase, dataDir: string): Promise<void> {
  const [{ value: existingCount }] = await db.select({ value: count() }).from(schema.grids);
  if (existingCount > 0) return;

  const legacyFile = path.join(dataDir, 'grids.json');
  if (fsSync.existsSync(legacyFile)) {
    try {
      const raw = await fs.readFile(legacyFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const rows = parsed
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
        if (rows.length > 0) {
          await db.insert(schema.grids).values(rows).onConflictDoNothing();
          console.info(`Imported ${rows.length} grid(s) from legacy ${legacyFile}`);
        }
      }
      return;
    } catch (err) {
      console.error(`Failed to import legacy grids from ${legacyFile}:`, err);
    }
  }

  await db
    .insert(schema.grids)
    .values(
      DEFAULT_GRIDS.map((grid) => ({
        id: grid.id,
        name: grid.name,
        feeds: normalizeFeedsList(grid.feeds),
        createdAt: grid.createdAt,
        updatedAt: null
      }))
    )
    .onConflictDoNothing();
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
    await seedOrImportInitialGrids(db, dataDir);
    const target = redactDatabaseUrl(databaseUrl);
    console.info(`GridTube database ready (postgres: ${target})`);
    return { db, driver: 'postgres', target };
  }

  const pgDataDir = path.join(dataDir, 'pgdata');
  await fs.mkdir(pgDataDir, { recursive: true });
  const client = new PGlite(pgDataDir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  await seedOrImportInitialGrids(db, dataDir);
  console.info(`GridTube database ready (pglite: ${pgDataDir})`);
  return { db, driver: 'pglite', target: pgDataDir };
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
