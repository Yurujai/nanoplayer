import type { Player } from '@nanoplayer/core';

/** A relative seek kept inside the content. */
export function seekBy(player: Player, delta: number): void {
  player.seek(Math.min(player.duration || 0, Math.max(0, player.currentTime + delta)));
}
