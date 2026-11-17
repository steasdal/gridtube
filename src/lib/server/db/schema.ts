import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import type { FeedEntry } from '$lib/types';

export const grids = pgTable('grids', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  feeds: jsonb('feeds').$type<FeedEntry[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
});

export type GridRow = typeof grids.$inferSelect;
export type NewGridRow = typeof grids.$inferInsert;
