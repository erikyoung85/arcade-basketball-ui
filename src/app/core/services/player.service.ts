import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../supabase/supabase.client';
import { Player } from '../models/player.model';

/** Accent colours assigned round-robin to new players. */
const PLAYER_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // amber
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

/**
 * Loads and creates players.
 *
 * Backed by the Supabase `players` table when configured; otherwise keeps an
 * in-memory roster so the UI is fully usable during early development.
 */
@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly supabase = inject(SupabaseService);

  /** The full roster, kept in a signal so views update reactively. */
  readonly players = signal<Player[]>([]);
  readonly loading = signal<boolean>(false);

  constructor() {
    void this.refresh();
  }

  /** Reload the roster from Supabase (no-op for the in-memory fallback). */
  async refresh(): Promise<void> {
    const client = this.supabase.client;
    if (!client) {
      return;
    }

    this.loading.set(true);
    const { data, error } = await client
      .from('players')
      .select('*')
      .order('name', { ascending: true });
    this.loading.set(false);

    if (error) {
      console.error('Failed to load players from Supabase:', error.message);
      return;
    }
    this.players.set((data ?? []).map(toPlayer));
  }

  /** Create a player, persisting to Supabase when configured. */
  async addPlayer(name: string): Promise<Player> {
    const trimmed = name.trim();
    const color = PLAYER_COLORS[this.players().length % PLAYER_COLORS.length];
    const client = this.supabase.client;

    if (!client) {
      const player: Player = {
        id: crypto.randomUUID(),
        name: trimmed,
        color,
        createdAt: new Date().toISOString(),
      };
      this.players.update((list) => sortByName([...list, player]));
      return player;
    }

    const { data, error } = await client
      .from('players')
      .insert({ name: trimmed, color })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to create player');
    }
    const player = toPlayer(data);
    this.players.update((list) => sortByName([...list, player]));
    return player;
  }
}

function toPlayer(row: {
  id: string;
  name: string;
  color: string;
  created_at: string;
}): Player {
  return { id: row.id, name: row.name, color: row.color, createdAt: row.created_at };
}

function sortByName(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.name.localeCompare(b.name));
}
