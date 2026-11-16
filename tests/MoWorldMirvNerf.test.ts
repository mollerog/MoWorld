// MoWorld: MIRV com recarga de 5 minutos por jogador e preço que dobra a
// cada lançamento (25M, 50M, 100M, ...).
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { MirvExecution } from "@openfront/engine/execution/MIRVExecution";
import { MissileSiloExecution } from "@openfront/engine/execution/MissileSiloExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let attacker: Player;
let target: Player;

const mirvCost = (p: Player) => game.unitInfo(UnitType.MIRV).cost(game, p);

describe("MoWorld MIRV nerf", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true });
    game.addPlayer(
      new PlayerInfo("attacker", PlayerType.Human, null, "attacker_id"),
    );
    game.addPlayer(
      new PlayerInfo("target", PlayerType.Human, null, "target_id"),
    );
    attacker = game.player("attacker_id");
    target = game.player("target_id");
    for (let x = 5; x < 15; x++)
      for (let y = 5; y < 15; y++) attacker.conquer(game.ref(x, y));
    for (let x = 40; x < 60; x++)
      for (let y = 40; y < 60; y++) target.conquer(game.ref(x, y));
    attacker.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});
    game.addExecution(
      new MissileSiloExecution(attacker.units(UnitType.MissileSilo)[0]),
    );
    attacker.addGold(1_000_000_000n);
    while (game.inSpawnPhase()) game.executeNextTick();
  });

  test("preço dobra por jogador e recarga de 5 minutos", () => {
    const tile = game.ref(50, 50);
    expect(mirvCost(attacker)).toBe(25_000_000n);
    expect(attacker.canBuild(UnitType.MIRV, tile)).not.toBe(false);

    const before = attacker.gold();
    game.addExecution(new MirvExecution(attacker, tile));
    game.executeNextTick();
    game.executeNextTick();
    expect(attacker.unitsConstructed(UnitType.MIRV)).toBe(1);
    expect(before - attacker.gold()).toBeGreaterThanOrEqual(25_000_000n);

    // Segundo custa o dobro; o alvo, que não lançou nenhum, continua 25M.
    expect(mirvCost(attacker)).toBe(50_000_000n);
    expect(mirvCost(target)).toBe(25_000_000n);

    // Em recarga: não pode lançar, e a lista de construções diz quanto falta.
    expect(attacker.canBuild(UnitType.MIRV, tile)).toBe(false);
    const mirv = attacker
      .buildableUnits(tile)
      .find((u) => u.type === UnitType.MIRV)!;
    expect(mirv.canBuild).toBe(false);
    expect(mirv.cooldownTicks).toBeGreaterThan(2900);

    executeTicks(game, 3000);
    // O primeiro MIRV pode ter apagado o alvo: mira em terra que ainda é dele.
    const tile2 = Array.from(target.tiles())[0] ?? game.ref(20, 20);
    if (!target.isAlive()) target.conquer(tile2);
    expect(attacker.canBuild(UnitType.MIRV, tile2)).not.toBe(false);

    game.addExecution(new MirvExecution(attacker, tile2));
    game.executeNextTick();
    game.executeNextTick();
    expect(attacker.unitsConstructed(UnitType.MIRV)).toBe(2);
    expect(mirvCost(attacker)).toBe(100_000_000n);
  });
});
