import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import { findAttackAim } from "../../src/client/AimedAttack";

type FakeUnit = { type: UnitType; tile: number; owner: object; d: number };

function fakeGame(units: FakeUnit[], friendly = false) {
  const me = { isFriendly: () => friendly };
  return {
    myPlayer: () => me,
    owner: (t: number) => units.find((u) => u.tile === t)?.owner,
    nearbyUnits: () =>
      units.map((u) => ({
        distSquared: u.d * u.d,
        unit: {
          type: () => u.type,
          tile: () => u.tile,
          owner: () => u.owner,
          isActive: () => true,
        },
      })),
  } as never;
}

describe("findAttackAim", () => {
  const enemy = {};
  test("pega a construção do alvo mais perto do toque", () => {
    const g = fakeGame([
      { type: UnitType.City, tile: 1, owner: enemy, d: 6 },
      { type: UnitType.Port, tile: 2, owner: enemy, d: 2 },
    ]);
    expect(findAttackAim(g, 0, enemy as never)?.tile).toBe(2);
  });
  test("silo/SAM ganham de outra construção um pouco mais perto", () => {
    const g = fakeGame([
      { type: UnitType.City, tile: 1, owner: enemy, d: 2 },
      { type: UnitType.MissileSilo, tile: 2, owner: enemy, d: 4 },
    ]);
    const aim = findAttackAim(g, 0, enemy as never);
    expect(aim?.tile).toBe(2);
    expect(aim?.name).toBe("Silo de Míssil");
  });
  test("ignora construção de outro dono e não mira em aliado", () => {
    const other = {};
    expect(
      findAttackAim(
        fakeGame([{ type: UnitType.City, tile: 1, owner: other, d: 1 }]),
        0,
        enemy as never,
      ),
    ).toBeNull();
    expect(
      findAttackAim(
        fakeGame([{ type: UnitType.City, tile: 1, owner: enemy, d: 1 }], true),
        0,
        enemy as never,
      ),
    ).toBeNull();
    expect(findAttackAim(fakeGame([]), 0, null)).toBeNull();
  });
});
