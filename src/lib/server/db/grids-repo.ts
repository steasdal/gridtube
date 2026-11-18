import crypto from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FeedEntry, Grid, PublicGrid } from '$lib/types';
import { normalizeFeedEntry, normalizeFeedsList } from '$lib/youtube';
import { getDb } from './index';
import { grids, gridUrls, publicGrids, users, type GridRow, type GridUrlRow } from './schema';

function assembleGrid(row: GridRow, urlRows: GridUrlRow[], isPublic = false): Grid {
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
    isPublic,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? undefined
  };
}

function groupUrlsByGridId(allUrlRows: GridUrlRow[]): Map<string, GridUrlRow[]> {
  const urlsByGridId = new Map<string, GridUrlRow[]>();
  for (const urlRow of allUrlRows) {
    let bucket = urlsByGridId.get(urlRow.gridId);
    if (!bucket) {
      bucket = [];
      urlsByGridId.set(urlRow.gridId, bucket);
    }
    bucket.push(urlRow);
  }
  return urlsByGridId;
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
  const [allUrlRows, publicRows] = await Promise.all([
    db.select().from(gridUrls).where(inArray(gridUrls.gridId, gridIds)).orderBy(asc(gridUrls.slot)),
    db.select({ gridId: publicGrids.gridId }).from(publicGrids).where(inArray(publicGrids.gridId, gridIds))
  ]);

  const urlsByGridId = groupUrlsByGridId(allUrlRows);
  const publicSet = new Set(publicRows.map((r) => r.gridId));

  return gridRows.map((row) => assembleGrid(row, urlsByGridId.get(row.id) ?? [], publicSet.has(row.id)));
}

export async function getGridById(id: string, userId: string): Promise<Grid | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(grids)
    .where(and(eq(grids.id, id), eq(grids.userId, userId)))
    .limit(1);
  if (!row) return null;

  const [urlRows, publicRows] = await Promise.all([
    db.select().from(gridUrls).where(eq(gridUrls.gridId, id)).orderBy(asc(gridUrls.slot)),
    db.select({ gridId: publicGrids.gridId }).from(publicGrids).where(eq(publicGrids.gridId, id)).limit(1)
  ]);

  return assembleGrid(row, urlRows, publicRows.length > 0);
}

export async function listPublicGrids(): Promise<PublicGrid[]> {
  const db = await getDb();
  const rows = await db
    .select({
      grid: grids,
      ownerUsername: users.username
    })
    .from(publicGrids)
    .innerJoin(grids, eq(publicGrids.gridId, grids.id))
    .innerJoin(users, eq(publicGrids.userId, users.id))
    .where(eq(users.role, 'admin'))
    .orderBy(asc(grids.createdAt), asc(grids.id));

  if (rows.length === 0) return [];

  const gridIds = rows.map((r) => r.grid.id);
  const allUrlRows = await db
    .select()
    .from(gridUrls)
    .where(inArray(gridUrls.gridId, gridIds))
    .orderBy(asc(gridUrls.slot));

  const urlsByGridId = groupUrlsByGridId(allUrlRows);

  return rows.map(({ grid, ownerUsername }) => ({
    ...assembleGrid(grid, urlsByGridId.get(grid.id) ?? [], true),
    isPublic: true,
    ownerUsername
  }));
}

export async function getPublicGridById(id: string): Promise<PublicGrid | null> {
  const db = await getDb();
  const [match] = await db
    .select({
      grid: grids,
      ownerUsername: users.username
    })
    .from(publicGrids)
    .innerJoin(grids, eq(publicGrids.gridId, grids.id))
    .innerJoin(users, eq(publicGrids.userId, users.id))
    .where(and(eq(publicGrids.gridId, id), eq(users.role, 'admin')))
    .limit(1);

  if (!match) return null;

  const urlRows = await db
    .select()
    .from(gridUrls)
    .where(eq(gridUrls.gridId, id))
    .orderBy(asc(gridUrls.slot));

  return {
    ...assembleGrid(match.grid, urlRows, true),
    isPublic: true,
    ownerUsername: match.ownerUsername
  };
}

export async function createGrid(
  userId: string,
  name: string,
  feeds: FeedEntry[],
  isPublic = false
): Promise<Grid> {
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

    if (isPublic) {
      await tx.insert(publicGrids).values({
        id: crypto.randomUUID(),
        gridId,
        userId
      });
    }

    return { insertedGrid: gridRow, insertedUrls: urlRows };
  });

  return assembleGrid(insertedGrid, insertedUrls, isPublic);
}

export async function updateGrid(
  id: string,
  userId: string,
  name: string,
  feeds: FeedEntry[],
  isPublic?: boolean
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

    let nextIsPublic: boolean;
    if (isPublic === true) {
      await tx
        .insert(publicGrids)
        .values({ id: crypto.randomUUID(), gridId: id, userId })
        .onConflictDoNothing();
      nextIsPublic = true;
    } else if (isPublic === false) {
      await tx
        .delete(publicGrids)
        .where(and(eq(publicGrids.gridId, id), eq(publicGrids.userId, userId)));
      nextIsPublic = false;
    } else {
      const existingPub = await tx
        .select({ gridId: publicGrids.gridId })
        .from(publicGrids)
        .where(eq(publicGrids.gridId, id))
        .limit(1);
      nextIsPublic = existingPub.length > 0;
    }

    return { updatedGrid, upsertedUrls, isPublic: nextIsPublic };
  });

  return result ? assembleGrid(result.updatedGrid, result.upsertedUrls, result.isPublic) : null;
}

export async function setGridPublic(
  id: string,
  userId: string,
  isPublic: boolean
): Promise<Grid | null> {
  const db = await getDb();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(grids)
      .where(and(eq(grids.id, id), eq(grids.userId, userId)))
      .limit(1);

    if (!row) return null;

    if (isPublic) {
      await tx
        .insert(publicGrids)
        .values({ id: crypto.randomUUID(), gridId: id, userId })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(publicGrids)
        .where(and(eq(publicGrids.gridId, id), eq(publicGrids.userId, userId)));
    }

    const urlRows = await tx
      .select()
      .from(gridUrls)
      .where(eq(gridUrls.gridId, id))
      .orderBy(asc(gridUrls.slot));

    return assembleGrid(row, urlRows, isPublic);
  });

  return updated;
}

export async function deleteGrid(id: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const deleted = await db
    .delete(grids)
    .where(and(eq(grids.id, id), eq(grids.userId, userId)))
    .returning({ id: grids.id });
  return deleted.length > 0;
}
