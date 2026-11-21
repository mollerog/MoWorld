import { PlayerType, TerrainType } from "@openfront/engine-api/game/GameTypes";
import {
  AttackLogicInput,
  mapCombatScale,
  REFERENCE_LAND_TILES,
} from "@openfront/engine/configuration/EngineConfig";
import { describe, expect, test } from "vitest";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";

// MoWorld: mapas maiores que o World lutam como o World (World 4000 ≈ 4×).
function input(over: Partial<AttackLogicInput> = {}): AttackLogicInput {
  return {
    terrain: TerrainType.Plains,
    attackTroops: 100_000,
    attacker: { type: PlayerType.Human, numTiles: 50_000 },
    defender: {
      type: PlayerType.Nation,
      numTiles: 60_000,
      troops: 120_000,
      isTraitor: false,
      isDisconnectedTeammate: false,
    },
    defenderHasDefensePost: false,
    falloutRatio: null,
    borderSize: 200,
    ...over,
  };
}

describe("MoWorld: escala de combate pelo tamanho do mapa", () => {
  test("World e mapas menores: nada muda", async () => {
    const g = await setup("plains", {}, [], undefined, UseRealAttackLogic);
    const cfg = g.config();
    for (const land of [undefined, 10_000, REFERENCE_LAND_TILES, 651_761]) {
      expect(mapCombatScale(land)).toBe(1);
      expect(cfg.attackLogic(input({ mapLandTiles: land }))).toEqual(
        cfg.attackLogic(input()),
      );
    }
  });

  test("World 4000: guerra no ritmo do World", async () => {
    const g = await setup("plains", {}, [], undefined, UseRealAttackLogic);
    const cfg = g.config();
    const s = 4;
    const land = REFERENCE_LAND_TILES * s;
    expect(mapCombatScale(land)).toBeCloseTo(s);
    // Mesmo cenário em escala: 4× pedaços, mesmas tropas.
    const world = cfg.attackLogic(input());
    const big = cfg.attackLogic(
      input({
        mapLandTiles: land,
        attacker: { type: PlayerType.Human, numTiles: 50_000 * s },
        defender: {
          type: PlayerType.Nation,
          numTiles: 60_000 * s,
          troops: 120_000,
          isTraitor: false,
          isDisconnectedTeammate: false,
        },
        borderSize: 200 * 2,
      }),
    );
    // Defensor: perde tropas por pedaço → 4 pedaços = 1 do World.
    expect(big.defenderTroopLoss * s).toBeCloseTo(world.defenderTroopLoss, 6);
    // Atacante: os exércitos lá são ~4^0.6 maiores, então o pedaço custa
    // 1/4^0.4 do World — mais barato que no World, mais caro que 1/4.
    expect(big.attackerTroopLoss).toBeLessThan(world.attackerTroopLoss / 1.6);
    expect(big.attackerTroopLoss).toBeGreaterThan(world.attackerTroopLoss / 4);
    // Frente 2× maior e √4 mais rápida: 4 pedaços no tempo de 1 do World.
    expect(big.tickFraction * s).toBeCloseTo(world.tickFraction, 6);
  });

  test("World 4000: expansão em terra livre também fica mais barata e mais rápida", async () => {
    const g = await setup("plains", {}, [], undefined, UseRealAttackLogic);
    const cfg = g.config();
    const world = cfg.attackLogic(input({ defender: null }));
    const big = cfg.attackLogic(
      input({
        defender: null,
        mapLandTiles: REFERENCE_LAND_TILES * 4,
        borderSize: 400,
      }),
    );
    expect(big.attackerTroopLoss * 4 ** 0.4).toBeCloseTo(
      world.attackerTroopLoss,
      6,
    );
    expect(big.tickFraction * 4).toBeCloseTo(world.tickFraction, 6);
  });
});
