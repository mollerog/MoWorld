import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackIntentSchema } from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import {
  decodeClientMessage,
  encodeClientMessage,
} from "@openfront/shared/ZbinWire";
import { describe, expect, test } from "vitest";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { UseRealAttackLogic } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// MoWorld: ataque mirado numa construção (focusTile).
async function arena() {
  const g = await setup(
    "big_plains",
    {},
    [
      new PlayerInfo("me", PlayerType.Human, null, "me_id"),
      new PlayerInfo("them", PlayerType.Nation, null, "them_id"),
    ],
    undefined,
    UseRealAttackLogic,
  );
  const me = g.player("me_id");
  const them = g.player("them_id");
  for (let x = 0; x < 200; x++)
    for (let y = 0; y < 200; y++) {
      const t = g.ref(x, y);
      if (!g.isLand(t)) continue;
      (x < 20 ? me : them).conquer(t);
    }
  while (g.inSpawnPhase()) g.executeNextTick();
  me.addTroops(1_000_000 - me.troops());
  them.removeTroops(them.troops());
  them.addTroops(20_000);
  // Silo longe da frente e fora do eixo do meio.
  const siloTile = g.ref(120, 185);
  const silo = them.buildUnit(UnitType.MissileSilo, siloTile, {});
  g.addExecution(new PlayerExecution(them));
  g.addExecution(new PlayerExecution(me));
  executeTicks(g, 2);
  return { g, me, them, siloTile, silo };
}

function runUntil(g: Game, done: () => boolean, max: number): number {
  for (let i = 0; i < max; i++) {
    if (done()) return i;
    g.executeNextTick();
  }
  return -1;
}

function attack(
  g: Game,
  me: Player,
  them: Player,
  troops: number,
  focus: TileRef | null,
) {
  g.addExecution(new AttackExecution(troops, me, them.id(), null, true, focus));
  g.executeNextTick();
}

describe("MoWorld: ataque mirado", () => {
  test("a ponta de lança chega e captura o silo; o ataque normal não", async () => {
    const aimed = await arena();
    attack(aimed.g, aimed.me, aimed.them, 150_000, aimed.siloTile);
    const ticks = runUntil(
      aimed.g,
      () => aimed.silo.owner() === aimed.me,
      3000,
    );
    expect(ticks).toBeGreaterThan(0);
    expect(aimed.silo.isActive()).toBe(true);
    expect(aimed.silo.type()).toBe(UnitType.MissileSilo);

    const plain = await arena();
    attack(plain.g, plain.me, plain.them, 150_000, null);
    runUntil(plain.g, () => plain.me.outgoingAttacks().length === 0, 3000);
    expect(plain.silo.owner()).toBe(plain.them);
    // Mesmas tropas: o normal espalha a frente; o mirado chega lá.
    expect(plain.g.owner(plain.siloTile)).toBe(plain.them);
  });

  test("custa o mesmo por tile: mesma quantidade de terra pelo mesmo exército", async () => {
    const aimed = await arena();
    attack(aimed.g, aimed.me, aimed.them, 50_000, aimed.siloTile);
    const tilesBefore = aimed.me.numTilesOwned();
    runUntil(aimed.g, () => aimed.me.outgoingAttacks().length === 0, 3000);
    const aimedGain = aimed.me.numTilesOwned() - tilesBefore;

    const plain = await arena();
    attack(plain.g, plain.me, plain.them, 50_000, null);
    const plainBefore = plain.me.numTilesOwned();
    runUntil(plain.g, () => plain.me.outgoingAttacks().length === 0, 3000);
    const plainGain = plain.me.numTilesOwned() - plainBefore;

    // Mesmo orçamento → quantidade de terra parecida (±15%).
    expect(aimedGain).toBeGreaterThan(plainGain * 0.85);
    expect(aimedGain).toBeLessThan(plainGain * 1.15);
  });

  test("depois de tomar o alvo o ataque segue normal até acabar", async () => {
    const a = await arena();
    attack(a.g, a.me, a.them, 300_000, a.siloTile);
    expect(runUntil(a.g, () => a.silo.owner() === a.me, 3000)).toBeGreaterThan(
      0,
    );
    const atCapture = a.me.numTilesOwned();
    executeTicks(a.g, 50);
    expect(a.me.numTilesOwned()).toBeGreaterThan(atCapture);
  });

  test("mira em tile que não é do alvo é ignorada (ataque normal)", async () => {
    const a = await arena();
    // Tile meu: não pode ser foco.
    const exec = new AttackExecution(
      50_000,
      a.me,
      a.them.id(),
      null,
      true,
      a.g.ref(5, 5),
    );
    a.g.addExecution(exec);
    a.g.executeNextTick();
    expect(exec.focus()).toBeNull();
    expect(a.me.outgoingAttacks().length).toBe(1);
  });

  test("intent aceita focusTile opcional", () => {
    expect(
      AttackIntentSchema.safeParse({
        type: "attack",
        targetID: null,
        troops: 10,
        focusTile: 123,
      }).success,
    ).toBe(true);
    expect(
      AttackIntentSchema.safeParse({
        type: "attack",
        targetID: null,
        troops: 10,
      }).success,
    ).toBe(true);
  });

  test("focusTile passa pelo fio (zbin) com e sem valor", () => {
    for (const intent of [
      { type: "attack" as const, targetID: null, troops: 10, focusTile: 4242 },
      { type: "attack" as const, targetID: null, troops: 10 },
    ]) {
      const msg = { type: "intent" as const, intent };
      const back = decodeClientMessage(
        encodeClientMessage(msg, undefined),
        undefined,
      );
      expect(back).toEqual(msg);
    }
  });

  test("save/load no meio do ataque mirado continua igual", async () => {
    const a = await arena();
    attack(a.g, a.me, a.them, 150_000, a.siloTile);
    executeTicks(a.g, 2);
    expect(a.me.outgoingAttacks().length).toBe(1);
    await expectSnapshotRoundTrip(a.g, "big_plains", 30);
  });
});
