import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique
} from 'drizzle-orm/pg-core';

export const grids = pgTable('grids', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
});

export const gridUrls = pgTable(
  'grid_urls',
  {
    id: text('id').primaryKey(),
    gridId: text('grid_id')
      .notNull()
      .references(() => grids.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    url: text('url').notNull().default(''),
    volume: integer('volume').notNull().default(100),
    muted: boolean('muted').notNull().default(false)
  },
  (table) => [unique('grid_urls_grid_id_slot_unique').on(table.gridId, table.slot)]
);

export type GridRow = typeof grids.$inferSelect;
export type NewGridRow = typeof grids.$inferInsert;
export type GridUrlRow = typeof gridUrls.$inferSelect;
export type NewGridUrlRow = typeof gridUrls.$inferInsert;
