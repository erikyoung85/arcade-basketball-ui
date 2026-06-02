/** A person who can play on a hoop. Persisted in the `players` table. */
export interface Player {
  id: string;
  name: string;
  /** Hex accent colour used for the player's badge/avatar. */
  color: string;
  createdAt: string;
}
