// MoWorld: "Dupla" — os dois jogadores humanos de uma sala com amigos jogam
// juntos no todos-contra-todos. A aliança entre eles nunca acaba e não pode
// ser rompida, e eles vencem juntos quando a soma das terras chega à meta.
// As nações jogam como sempre (inclusive entre si).
import { GameMode, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { PlayerLike } from "@openfront/engine-api/game/ReadViews";
import type { GameConfig } from "@openfront/engine-api/Schemas";

export function isCoopDuo(config: GameConfig): boolean {
  return config.coopDuo === true && config.gameMode === GameMode.FFA;
}

/** Os dois são a dupla desta partida (humanos diferentes num jogo de dupla). */
export function areCoopPartners(
  config: GameConfig,
  a: PlayerLike,
  b: PlayerLike,
): boolean {
  return (
    isCoopDuo(config) &&
    a.id() !== b.id() &&
    a.type() === PlayerType.Human &&
    b.type() === PlayerType.Human
  );
}
