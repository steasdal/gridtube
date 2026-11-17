export interface FeedEntry {
  url: string;
  volume: number;
  muted: boolean;
}

export interface Grid {
  id: string;
  name: string;
  feeds: FeedEntry[];
  createdAt: string;
  updatedAt?: string | null;
}

export type ValidationResult =
  | { ok: true; name: string; feeds: FeedEntry[] }
  | { ok: false; error: string };
