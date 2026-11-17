import crypto from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FeedEntry, Grid } from '$lib/types';
import { normalizeFeedsList } from '$lib/youtube';
import { getDb } from './index';
import { grids, type GridRow } from './schema';

function mapRowToGrid(row: GridRow): Grid {
  return {
    id: row.id,
    name: row.name,
    feeds: normalizeFeedsList(row.feeds),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? undefined
  };
}

export async function listGrids(): Promise<Grid[]> {
  const db = await getDb();
  const rows = await db.select().from(grids).orderBy(asc(grids.createdAt), asc(grids.id));
  return rows.map(mapRowToGrid);
}

export async function getGridById(id: string): Promise<Grid | null> {
  const db = await getDb();
  const [row] = await db.select().from(grids).where(eq(grids.id, id)).limit(1);
  return row ? mapRowToGrid(row) : null;
}

export async function createGrid(name: string, feeds: FeedEntry[]): Promise<Grid> {
  const db = await getDb();
  const [inserted] = await db
    .insert(grids)
    .values({
      id: crypto.randomUUID(),
      name,
      feeds: normalizeFeedsList(feeds),
      createdAt: new Date().toISOString()
    })
    .returning();
  return mapRowToGrid(inserted);
}

export async function updateGrid(
  id: string,
  name: string,
  feeds: FeedEntry[]
): Promise<Grid | null> {
  const db = await getDb();
  const [updated] = await db
    .update(grids)
    .set({
      name,
      feeds: normalizeFeedsList(feeds),
      updatedAt: new Date().toISOString()
    })
    .where(eq(grids.id, id))
    .returning();
  return updated ? mapRowToGrid(updated) : null;
}

export async function deleteGrid(id: string): Promise<boolean> {
  const db = await getDb();
  const deleted = await db.delete(grids).where(eq(grids.id, id)).returning({ id: grids.id });
  return deleted.length > 0;
}
