import {
  Difficulty,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { SetAutoExpandExecution } from "@openfront/engine/execution/SetAutoExpandExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// MoWorld: trégua do começo e expansão automática.
let game: Game;
let me: Player;
let nation: Player;

async function start(
  difficulty: Difficulty,
  gameType: GameType = GameType.Singleplayer,
) {
  game = await setup("plains", { difficulty, gameType, humanTruce: true }, [
    new PlayerInfo("me", PlayerType.Human, null, "me_id"),
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  ]);
  me = game.player("me_id");
  nation = game.player("nation_id");
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 10; x++) me.conquer(game.ref(x, y));
    for (let x = 10; x < 20; x++) nation.conquer(game.ref(x, y));
  }
  nation.addTroops(100_000);
  while (game.inSpawnPhase()) game.executeNextTick();
}

describe("MoWorld trégua do começo", () => {
  test.each([
    [Difficulty.Easy, 300],
    [Difficulty.Medium, 180],
    [Difficulty.Hard, 60],
    [Difficulty.Impossible, 0],
  ])("%s: %i s", async (difficulty, seconds) => {
    await start(difficulty);
    expect(game.config().humanTruceSeconds()).toBe(seconds);
    expect(nation.canAttackPlayer(me)).toBe(seconds === 0);
    if (seconds > 0) {
      executeTicks(game, seconds * 10 + 5);
      expect(nation.canAttackPlayer(me)).toBe(true);
    }
  });

  test("na trégua, o ataque da nação não acontece", async () => {
    await start(Difficulty.Medium);
    const before = me.numTilesOwned();
    game.addExecution(new AttackExecution(50_000, nation, me.id()));
    executeTicks(game, 30);
    expect(me.numTilesOwned()).toBe(before);
  });

  test("quem é atacado pelo humano na trégua pode revidar", async () => {
    await start(Difficulty.Medium);
    me.addTroops(20_000);
    game.addExecution(new AttackExecution(10_000, me, nation.id()));
    executeTicks(game, 2);
    expect(nation.truceBrokenBy(me)).toBe(true);
    expect(nation.canAttackPlayer(me)).toBe(true);
  });

  test("sem pedir a trégua (motor original), não há trégua", async () => {
    game = await setup("plains", { difficulty: Difficulty.Medium }, [
      new PlayerInfo("me", PlayerType.Human, null, "me_id"),
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
    ]);
    expect(game.config().humanTruceSeconds()).toBe(0);
  });

  test("a trégua não vale entre nações nem fora do solo", async () => {
    await start(Difficulty.Medium, GameType.Public);
    expect(game.config().humanTruceSeconds()).toBe(0);
    expect(nation.canAttackPlayer(me)).toBe(true);
  });
});

describe("MoWorld expansão automática", () => {
  async function lonely() {
    game = await setup("plains", { gameType: GameType.Singleplayer }, [
      new PlayerInfo("me", PlayerType.Human, null, "me_id"),
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
      new PlayerInfo("tribe", PlayerType.Bot, null, "tribe_id"),
    ]);
    me = game.player("me_id");
    nation = game.player("nation_id");
    for (let x = 40; x < 45; x++)
      for (let y = 40; y < 45; y++) me.conquer(game.ref(x, y));
    while (game.inSpawnPhase()) game.executeNextTick();
    game.addExecution(new PlayerExecution(me));
    me.addTroops(game.config().maxTroops(me) * 0.6 - me.troops());
  }

  test("desligada, não expande; ligada, cresce para a terra livre", async () => {
    await lonely();
    const before = me.numTilesOwned();
    executeTicks(game, 60);
    expect(me.numTilesOwned()).toBe(before);
    game.addExecution(new SetAutoExpandExecution(me, true));
    executeTicks(game, 60);
    expect(me.autoExpand()).toBe(true);
    expect(me.numTilesOwned()).toBeGreaterThan(before + 20);
    game.addExecution(new SetAutoExpandExecution(me, false));
    executeTicks(game, 1);
    expect(me.autoExpand()).toBe(false);
  });

  test("sem terra livre, ataca a tribo vizinha, nunca a nação", async () => {
    await lonely();
    const tribe = game.player("tribe_id");
    // Cerca: tribo à esquerda, nação à direita, sem terra livre por perto.
    for (let x = 0; x < game.width(); x++)
      for (let y = 0; y < game.height(); y++) {
        const t = game.ref(x, y);
        if (!game.isLand(t) || game.owner(t) === me) continue;
        (x < 42 ? tribe : nation).conquer(t);
      }
    tribe.addTroops(500);
    const nationTiles = nation.numTilesOwned();
    const tribeTiles = tribe.numTilesOwned();
    game.addExecution(new SetAutoExpandExecution(me, true));
    executeTicks(game, 80);
    expect(tribe.numTilesOwned()).toBeLessThan(tribeTiles);
    expect(nation.numTilesOwned()).toBe(nationTiles);
  });
});
