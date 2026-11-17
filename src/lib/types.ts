export type UserRole = 'admin' | 'user';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface FeedEntry {
  url: string;
  volume: number;
  muted: boolean;
}

export interface Grid {
  id: string;
  userId?: string;
  name: string;
  feeds: FeedEntry[];
  createdAt: string;
  updatedAt?: string | null;
}

export type ValidationResult =
  | { ok: true; name: string; feeds: FeedEntry[] }
  | { ok: false; error: string };
