import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TEST_WAIT } from "@openfront/engine-lib/configuration/Config";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// MoWorld: modo de teste do solo (Config.isMoWorldTest).
async function game(moworldTest: boolean) {
  const g = await setup(
    "plains",
    {
      instantBuild: false,
      infiniteGold: false,
      infiniteTroops: false,
      moworldTest,
    },
    [
      new PlayerInfo("me", PlayerType.Human, null, "me"),
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
    ],
  );
  const me = g.player("me");
  const nation = g.player("nation");
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) {
      me.conquer(g.ref(x, y));
      nation.conquer(g.ref(x + 20, y));
    }
  return { g, me, nation };
}

function buildCity(g: Game, p: Player, x: number, y: number) {
  p.addGold(g.unitInfo(UnitType.City).cost(g, p));
  g.addExecution(new ConstructionExecution(p, UnitType.City, g.ref(x, y)));
  executeTicks(g, 3);
  return p.units(UnitType.City)[0];
}

describe("MoWorld modo de teste", () => {
  test("só quem joga tem as vantagens", async () => {
    const { g, me, nation } = await game(true);
    expect(g.unitInfo(UnitType.City).cost(g, me)).toBe(0n);
    expect(g.unitInfo(UnitType.City).cost(g, nation)).toBeGreaterThan(0n);
    expect(g.config().maxTroops(me)).toBeGreaterThan(
      g.config().maxTroops(nation) * 100,
    );
  });

  test("quem joga constrói na hora; a nação espera", async () => {
    const { g, me, nation } = await game(true);
    expect(buildCity(g, me, 5, 5)?.isUnderConstruction()).toBe(false);
    expect(buildCity(g, nation, 25, 5)?.isUnderConstruction()).toBe(true);
  });

  test("as esperas do MoWorld caem para 30 s", async () => {
    const { g } = await game(true);
    expect(g.config().mirvCooldown()).toBe(TEST_WAIT);
    expect(g.config().mirvShield()).toBe(TEST_WAIT);
    expect(g.config().allyAidCooldown()).toBe(TEST_WAIT);
  });

  test("fora do modo de teste, nada muda", async () => {
    const { g, me } = await game(false);
    expect(g.unitInfo(UnitType.City).cost(g, me)).toBeGreaterThan(0n);
    expect(buildCity(g, me, 5, 5)?.isUnderConstruction()).toBe(true);
    expect(g.config().mirvCooldown()).toBe(5 * 60 * 10);
    expect(g.config().allyAidCooldown()).toBe(3 * 60 * 10);
  });
});
