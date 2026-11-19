import {
  GameMode,
  PlayerInfo,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import {
  ASK_RELATION_COST,
  ASK_TOO_SOON_COST,
  AskAllyAidExecution,
  decideAllyAid,
} from "@openfront/engine/execution/AskAllyAidExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// MoWorld: pedir tropas ou ouro a uma nação aliada.
let game: Game;
let me: Player;
let nation: Player;

async function start(gameMode = GameMode.FFA) {
  game = await setup("plains", { gameMode }, [
    new PlayerInfo("me", PlayerType.Human, null, "me_id"),
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  ]);
  me = game.player("me_id");
  nation = game.player("nation_id");
  for (let x = 0; x < 10; x++)
    for (let y = 0; y < 10; y++) me.conquer(game.ref(x, y));
  for (let x = 20; x < 30; x++)
    for (let y = 0; y < 10; y++) nation.conquer(game.ref(x, y));
  while (game.inSpawnPhase()) game.executeNextTick();
  me.createAllianceRequest(nation)?.accept();
  nation.updateRelation(me, 70);
  nation.addTroops(game.config().maxTroops(nation) - nation.troops());
  nation.addGold(2_000_000n);
}

const ask = (kind: "troops" | "gold") => {
  game.addExecution(new AskAllyAidExecution(me, nation.id(), kind));
  executeTicks(game, 3);
};
const relationValue = () =>
  (nation as unknown as { relations: Map<Player, number> }).relations.get(me);

describe("MoWorld: pedir ajuda à nação aliada", () => {
  test("amiga e com folga, manda tropas e a amizade cai um pouco", async () => {
    await start();
    const before = me.troops();
    const nationTroops = nation.troops();
    const rel = relationValue()!;
    ask("troops");
    expect(me.troops()).toBeGreaterThan(before + nationTroops * 0.1);
    expect(relationValue()).toBe(rel - ASK_RELATION_COST);
  });

  test("manda ouro", async () => {
    await start();
    const before = me.gold();
    ask("gold");
    expect(me.gold()).toBeGreaterThan(before + 100_000n);
  });

  test("pedir de novo cedo demais é recusado e esfria a amizade", async () => {
    await start();
    ask("troops");
    const troops = me.troops();
    const rel = relationValue()!;
    ask("gold");
    expect(me.gold()).toBeLessThan(1_000_000n);
    expect(me.troops()).toBeLessThanOrEqual(troops + 1000);
    expect(relationValue()).toBe(rel - ASK_TOO_SOON_COST);
  });

  test("depois da espera, aceita de novo", async () => {
    await start();
    ask("troops");
    executeTicks(game, game.config().allyAidCooldown());
    nation.updateRelation(me, 30);
    expect(decideAllyAid(game, nation, me, "gold").ok).toBe(true);
  });

  test("sem amizade, recusa sem custo", async () => {
    await start();
    nation.updateRelation(me, -40);
    expect(nation.relation(me)).toBeLessThan(Relation.Friendly);
    const rel = relationValue();
    const before = me.troops();
    ask("troops");
    expect(me.troops()).toBeLessThanOrEqual(before + 1000);
    expect(relationValue()).toBe(rel);
    expect(decideAllyAid(game, nation, me, "troops")).toEqual({
      ok: false,
      reason: "relation",
    });
  });

  test("sem folga, recusa", async () => {
    await start();
    nation.removeTroops(nation.troops() - 10);
    nation.removeGold(nation.gold());
    expect(decideAllyAid(game, nation, me, "troops")).toEqual({
      ok: false,
      reason: "no_troops",
    });
    expect(decideAllyAid(game, nation, me, "gold")).toEqual({
      ok: false,
      reason: "no_gold",
    });
  });

  test("sem aliança, nada acontece", async () => {
    await start();
    me.allianceWith(nation)?.expire();
    const before = me.troops();
    ask("troops");
    expect(me.troops()).toBeLessThanOrEqual(before + 1000);
  });
});
