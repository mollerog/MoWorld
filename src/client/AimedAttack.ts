import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameView, PlayerView } from "./view";

/**
 * MoWorld: ataque mirado. Tocar numa construção inimiga (ou bem perto dela)
 * faz o ataque abrir caminho até ela primeiro; tomar o tile dela captura a
 * construção (posto de defesa é destruído).
 */
export const AIMABLE_STRUCTURES: readonly UnitType[] = [
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.DefensePost,
];

/** Distância (em tiles) do toque até a construção para valer como mira. */
export const AIM_RADIUS = 10;

const NAMES: Partial<Record<UnitType, string>> = {
  [UnitType.MissileSilo]: "Silo de Míssil",
  [UnitType.SAMLauncher]: "Lançador de SAM",
  [UnitType.City]: "Cidade",
  [UnitType.Port]: "Porto",
  [UnitType.Factory]: "Indústria",
  [UnitType.DefensePost]: "Posto de Defesa",
};

export interface AttackAim {
  tile: TileRef;
  type: UnitType;
  name: string;
}

/**
 * A construção de `owner` mais perto do toque, até AIM_RADIUS tiles; null se
 * não houver (ataque normal). Silo e SAM ganham de qualquer outra a até 3
 * tiles de diferença, porque são o motivo de mirar.
 */
export function findAttackAim(
  game: GameView,
  tile: TileRef,
  owner: PlayerView | null,
): AttackAim | null {
  if (owner === null) return null;
  const me = game.myPlayer();
  if (me !== null && me.isFriendly(owner)) return null;
  const found = game.nearbyUnits(tile, AIM_RADIUS, AIMABLE_STRUCTURES);
  let best: { unit: (typeof found)[number]["unit"]; score: number } | null =
    null;
  for (const { unit, distSquared } of found) {
    // Só conta se o tile da construção ainda é do dono (não capturada).
    if (unit.owner() !== owner || !unit.isActive()) continue;
    if (game.owner(unit.tile()) !== owner) continue;
    const priority =
      unit.type() === UnitType.MissileSilo ||
      unit.type() === UnitType.SAMLauncher
        ? 3
        : 0;
    const score = Math.sqrt(distSquared) - priority;
    if (best === null || score < best.score) best = { unit, score };
  }
  if (best === null) return null;
  const type = best.unit.type();
  return { tile: best.unit.tile(), type, name: NAMES[type] ?? String(type) };
}
