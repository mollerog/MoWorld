import {
  GameMode,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { BreakAllianceExecution } from "@openfront/engine/execution/alliance/BreakAllianceExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { SoloSpawnCountdownExecution } from "@openfront/engine/execution/SoloSpawnCountdownExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// MoWorld: a "Dupla" da sala com amigos (engine-lib/game/CoopDuo.ts).
async function duoGame(coopDuo: boolean) {
  const game = await setup("plains", {
    instantBuild: true,
    gameMode: GameMode.FFA,
    coopDuo,
  });
  for (const [id, type] of [
    ["a", PlayerType.Human],
    ["b", PlayerType.Human],
    ["n", PlayerType.Nation],
  ] as const) {
    game.addPlayer(new PlayerInfo(id, type, null, id));
  }
  const [a, b, n] = ["a", "b", "n"].map((id) => game.player(id));
  // a | b | n em faixas verticais: a e b fazem fronteira, n fica à direita.
  for (let x = 0; x < game.width(); x++)
    for (let y = 0; y < game.height(); y++) {
      const t = game.ref(x, y);
      if (!game.isLand(t)) continue;
      (x < 10 ? a : x < 20 ? b : n).conquer(t);
    }
  for (const p of [a, b, n]) p.addTroops(1_000);
  while (game.inSpawnPhase()) game.executeNextTick();
  for (const p of [a, b, n]) game.addExecution(new PlayerExecution(p));
  return { game, a, b, n };
}

function tilesOf(game: Game, p: Player, count: number, from: Player) {
  // Passa `count` tiles de `from` para `p`.
  let moved = 0;
  for (const t of from.tiles()) {
    if (moved >= count) break;
    p.conquer(t);
    moved++;
  }
  void game;
}

describe("MoWorld dupla", () => {
  test("a dupla começa aliada e a aliança não acaba", async () => {
    const { game, a, b, n } = await duoGame(true);
    executeTicks(game, 2);
    expect(a.isAlliedWith(b)).toBe(true);
    expect(a.isAlliedWith(n)).toBe(false);
    // Bem mais que a duração de uma aliança.
    executeTicks(game, game.config().allianceDuration() * 2 + 50);
    expect(a.isAlliedWith(b)).toBe(true);
  });

  test("a aliança da dupla não pode ser rompida", async () => {
    const { game, a, b } = await duoGame(true);
    executeTicks(game, 2);
    game.addExecution(new BreakAllianceExecution(a, b.id()));
    executeTicks(game, 2);
    expect(a.isAlliedWith(b)).toBe(true);
    expect(a.isTraitor()).toBe(false);
  });

  test("sem a dupla, nada muda", async () => {
    const { game, a, b } = await duoGame(false);
    executeTicks(game, 5);
    expect(a.isAlliedWith(b)).toBe(false);
  });

  test("a dupla vence com a soma das terras", async () => {
    const { game, a, b, n } = await duoGame(true);
    executeTicks(game, 2);
    // Cada um com menos de 80%, os dois juntos com mais.
    const land = game.numLandTiles();
    tilesOf(game, a, Math.floor(land * 0.3), n);
    tilesOf(game, b, n.numTilesOwned() - Math.floor(land * 0.1), n);
    expect(a.numTilesOwned() / land).toBeLessThan(0.8);
    expect(b.numTilesOwned() / land).toBeLessThan(0.8);
    const win = new WinCheckExecution();
    win.init(game, game.ticks());
    win.checkWinnerFFA();
    const winner = game.getWinner() as Player | null;
    expect(winner === a || winner === b).toBe(true);
  });

  test("fora da dupla, a soma não vale", async () => {
    const { game, a, b, n } = await duoGame(false);
    const land = game.numLandTiles();
    tilesOf(game, a, Math.floor(land * 0.3), n);
    tilesOf(game, b, n.numTilesOwned() - Math.floor(land * 0.1), n);
    const win = new WinCheckExecution();
    win.init(game, game.ticks());
    win.checkWinnerFFA();
    expect(game.getWinner()).toBeNull();
  });
});

describe("MoWorld: quem não escolhe onde nascer", () => {
  async function spawnDistance(coopDuo: boolean) {
    const game = await setup(
      "big_plains",
      { instantBuild: true, gameMode: GameMode.FFA, coopDuo },
      [],
      undefined,
      undefined,
      false,
    );
    for (const id of ["a", "b"])
      game.addPlayer(new PlayerInfo(id, PlayerType.Human, null, id));
    const a = game.player("a");
    const b = game.player("b");
    expect(game.inSpawnPhase()).toBe(true);
    const home = game.ref(100, 100);
    game.addExecution(new SpawnExecution("g", a.info(), home));
    game.addExecution(
      new SoloSpawnCountdownExecution(game.ticks() + 3, "g", true),
    );
    while (game.inSpawnPhase()) game.executeNextTick();
    const tile = b.spawnTile();
    expect(tile).toBeDefined();
    return game.manhattanDist(home, tile!);
  }

  test("na dupla, nasce perto do parceiro", async () => {
    const d = await spawnDistance(true);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(100);
  });

  test("cada um por si, nasce longe", async () => {
    expect(await spawnDistance(false)).toBeGreaterThan(120);
  });
});
