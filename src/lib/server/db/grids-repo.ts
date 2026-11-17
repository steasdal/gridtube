import crypto from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FeedEntry, Grid } from '$lib/types';
import { normalizeFeedEntry, normalizeFeedsList } from '$lib/youtube';
import { getDb } from './index';
import { grids, gridUrls, type GridRow, type GridUrlRow } from './schema';

function assembleGrid(row: GridRow, urlRows: GridUrlRow[]): Grid {
  const slotMap = new Map<number, FeedEntry>();
  for (const urlRow of urlRows) {
    if (urlRow.slot >= 0 && urlRow.slot < 4) {
      slotMap.set(
        urlRow.slot,
        normalizeFeedEntry({
          url: urlRow.url,
          volume: urlRow.volume,
          muted: urlRow.muted
        })
      );
    }
  }

  const feeds: FeedEntry[] = [0, 1, 2, 3].map(
    (slot) => slotMap.get(slot) ?? { url: '', volume: 100, muted: false }
  );

  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    feeds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? undefined
  };
}

export async function listGrids(userId: string): Promise<Grid[]> {
  const db = await getDb();
  const gridRows = await db
    .select()
    .from(grids)
    .where(eq(grids.userId, userId))
    .orderBy(asc(grids.createdAt), asc(grids.id));

  if (gridRows.length === 0) return [];

  const gridIds = gridRows.map((row) => row.id);
  const allUrlRows = await db
    .select()
    .from(gridUrls)
    .where(inArray(gridUrls.gridId, gridIds))
    .orderBy(asc(gridUrls.slot));

  const urlsByGridId = new Map<string, GridUrlRow[]>();
  for (const urlRow of allUrlRows) {
    let bucket = urlsByGridId.get(urlRow.gridId);
    if (!bucket) {
      bucket = [];
      urlsByGridId.set(urlRow.gridId, bucket);
    }
    bucket.push(urlRow);
  }

  return gridRows.map((row) => assembleGrid(row, urlsByGridId.get(row.id) ?? []));
}

export async function getGridById(id: string, userId: string): Promise<Grid | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(grids)
    .where(and(eq(grids.id, id), eq(grids.userId, userId)))
    .limit(1);
  if (!row) return null;

  const urlRows = await db
    .select()
    .from(gridUrls)
    .where(eq(gridUrls.gridId, id))
    .orderBy(asc(gridUrls.slot));

  return assembleGrid(row, urlRows);
}

export async function createGrid(userId: string, name: string, feeds: FeedEntry[]): Promise<Grid> {
  const db = await getDb();
  const gridId = crypto.randomUUID();
  const normalized = normalizeFeedsList(feeds);

  const { insertedGrid, insertedUrls } = await db.transaction(async (tx) => {
    const [gridRow] = await tx
      .insert(grids)
      .values({
        id: gridId,
        userId,
        name,
        createdAt: new Date().toISOString()
      })
      .returning();

    const urlRows = await tx
      .insert(gridUrls)
      .values(
        normalized.map((feed, slot) => ({
          id: crypto.randomUUID(),
          gridId,
          slot,
          url: feed.url,
          volume: feed.volume,
          muted: feed.muted
        }))
      )
      .returning();

    return { insertedGrid: gridRow, insertedUrls: urlRows };
  });

  return assembleGrid(insertedGrid, insertedUrls);
}

export async function updateGrid(
  id: string,
  userId: string,
  name: string,
  feeds: FeedEntry[]
): Promise<Grid | null> {
  const db = await getDb();
  const normalized = normalizeFeedsList(feeds);

  const result = await db.transaction(async (tx) => {
    const [updatedGrid] = await tx
      .update(grids)
      .set({
        name,
        updatedAt: new Date().toISOString()
      })
      .where(and(eq(grids.id, id), eq(grids.userId, userId)))
      .returning();

    if (!updatedGrid) return null;

    const upsertedUrls = await tx
      .insert(gridUrls)
      .values(
        normalized.map((feed, slot) => ({
          id: crypto.randomUUID(),
          gridId: id,
          slot,
          url: feed.url,
          volume: feed.volume,
          muted: feed.muted
        }))
      )
      .onConflictDoUpdate({
        target: [gridUrls.gridId, gridUrls.slot],
        set: {
          url: sql`excluded.url`,
          volume: sql`excluded.volume`,
          muted: sql`excluded.muted`
        }
      })
      .returning();

    return { updatedGrid, upsertedUrls };
  });

  return result ? assembleGrid(result.updatedGrid, result.upsertedUrls) : null;
}

export async function deleteGrid(id: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const deleted = await db
    .delete(grids)
    .where(and(eq(grids.id, id), eq(grids.userId, userId)))
    .returning({ id: grids.id });
  return deleted.length > 0;
}
