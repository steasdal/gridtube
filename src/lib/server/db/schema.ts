import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  usernameLower: text('username_lower').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
});

export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
  },
  (table) => [index('user_sessions_user_id_idx').on(table.userId)]
);

export const grids = pgTable(
  'grids',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
  },
  (table) => [index('grids_user_id_idx').on(table.userId)]
);

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

export const publicGrids = pgTable(
  'public_grids',
  {
    id: text('id').primaryKey(),
    gridId: text('grid_id')
      .notNull()
      .unique()
      .references(() => grids.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
  },
  (table) => [index('public_grids_user_id_idx').on(table.userId)]
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserSessionRow = typeof userSessions.$inferSelect;
export type NewUserSessionRow = typeof userSessions.$inferInsert;
export type GridRow = typeof grids.$inferSelect;
export type NewGridRow = typeof grids.$inferInsert;
export type GridUrlRow = typeof gridUrls.$inferSelect;
export type NewGridUrlRow = typeof gridUrls.$inferInsert;
export type PublicGridRow = typeof publicGrids.$inferSelect;
export type NewPublicGridRow = typeof publicGrids.$inferInsert;
