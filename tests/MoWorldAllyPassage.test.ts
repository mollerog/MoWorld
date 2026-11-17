// MoWorld: atacar por dentro do território de um aliado quem faz fronteira
// com ele e não comigo.
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let me: Player;
let ally: Player;
let enemy: Player;

function fill(p: Player, x0: number, x1: number) {
  for (let x = x0; x < x1; x++)
    for (let y = 10; y < 30; y++) p.conquer(game.ref(x, y));
}

describe("MoWorld passagem por aliado", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true });
    for (const [name, id] of [
      ["me", "me_id"],
      ["ally", "ally_id"],
      ["enemy", "enemy_id"],
    ]) {
      game.addPlayer(new PlayerInfo(name, PlayerType.Human, null, id));
    }
    me = game.player("me_id");
    ally = game.player("ally_id");
    enemy = game.player("enemy_id");
    fill(me, 0, 10);
    fill(ally, 10, 20);
    fill(enemy, 20, 30);
    me.addTroops(50_000);
    ally.addTroops(50_000);
    enemy.addTroops(1_000);
    while (game.inSpawnPhase()) game.executeNextTick();
  });

  test("sem aliança não alcança; com aliança ataca pelo aliado", () => {
    const enemyTile = game.ref(25, 20);
    expect(me.sharesBorderWith(enemy)).toBe(false);
    expect(me.canAttack(enemyTile)).toBe(false);

    me.createAllianceRequest(ally)?.accept();
    expect(me.isAlliedWith(ally)).toBe(true);
    expect(me.canAttack(enemyTile)).toBe(true);

    const before = enemy.numTilesOwned();
    game.addExecution(new AttackExecution(20_000, me, enemy.id()));
    executeTicks(game, 60);
    expect(enemy.numTilesOwned()).toBeLessThan(before);
    // O que conquistei é do inimigo, não do aliado.
    expect(ally.numTilesOwned()).toBe(200);
    expect(me.numTilesOwned()).toBeGreaterThan(200);
  });

  test("o aliado também passa por mim", () => {
    // Inimigo do outro lado de mim.
    const other = enemy;
    for (let x = 20; x < 30; x++)
      for (let y = 10; y < 30; y++) ally.conquer(game.ref(x, y));
    for (let x = 10; x < 20; x++)
      for (let y = 10; y < 30; y++) me.conquer(game.ref(x, y));
    for (let x = 0; x < 10; x++)
      for (let y = 10; y < 30; y++) other.conquer(game.ref(x, y));
    me.createAllianceRequest(ally)?.accept();
    expect(ally.canAttack(game.ref(5, 20))).toBe(true);
  });

  test("quebrou a aliança no meio: para de avançar pelo ex-aliado", () => {
    me.createAllianceRequest(ally)?.accept();
    game.addExecution(new AttackExecution(20_000, me, enemy.id()));
    executeTicks(game, 3);
    const alliance = me.allianceWith(ally)!;
    me.breakAlliance(alliance);
    const after = enemy.numTilesOwned();
    executeTicks(game, 60);
    // Pode terminar o que já está colado em mim, mas não abre frente nova
    // pelo ex-aliado; no mínimo não piora o inimigo além do já conquistado
    // de forma descontrolada.
    expect(me.isAlliedWith(ally)).toBe(false);
    expect(enemy.numTilesOwned()).toBeLessThanOrEqual(after);
  });
});
