// MoWorld: atacar por dentro do território de um aliado quem faz fronteira
// com ele e não comigo.
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { BoatRetreatExecution } from "@openfront/engine/execution/BoatRetreatExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
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

  test("as tropas marcham pelo aliado e só atacam quando chegam", () => {
    me.createAllianceRequest(ally)?.accept();
    const before = enemy.numTilesOwned();
    game.addExecution(new AttackExecution(20_000, me, enemy.id()));
    executeTicks(game, 2);
    const armies = me.units(UnitType.Army);
    expect(armies).toHaveLength(1);
    expect(armies[0].troops()).toBe(20_000);
    // Ainda marchando: o inimigo não perdeu nada.
    expect(enemy.numTilesOwned()).toBe(before);
    executeTicks(game, 40);
    expect(me.units(UnitType.Army)).toHaveLength(0);
    expect(enemy.numTilesOwned()).toBeLessThan(before);
  });

  test("aliado rompeu no caminho: o ataque passa a ser nele", () => {
    me.createAllianceRequest(ally)?.accept();
    game.addExecution(new AttackExecution(20_000, me, enemy.id()));
    executeTicks(game, 4);
    expect(me.units(UnitType.Army)).toHaveLength(1);
    const enemyBefore = enemy.numTilesOwned();
    ally.breakAlliance(ally.allianceWith(me)!);
    executeTicks(game, 30);
    expect(me.units(UnitType.Army)).toHaveLength(0);
    expect(ally.numTilesOwned()).toBeLessThan(200);
    expect(enemy.numTilesOwned()).toBe(enemyBefore);
  });

  test("alvo morreu no caminho: as tropas voltam", () => {
    me.createAllianceRequest(ally)?.accept();
    const troops = me.troops();
    game.addExecution(new AttackExecution(20_000, me, enemy.id()));
    executeTicks(game, 3);
    expect(me.troops()).toBeLessThan(troops);
    // O aliado toma tudo do alvo antes de o exército chegar.
    for (let x = 20; x < 30; x++)
      for (let y = 10; y < 30; y++) ally.conquer(game.ref(x, y));
    expect(enemy.isAlive()).toBe(false);
    executeTicks(game, 2);
    expect(me.units(UnitType.Army)).toHaveLength(0);
    expect(me.troops()).toBeGreaterThanOrEqual(troops - 1_000);
  });

  test("save no meio da marcha continua igual", async () => {
    me.createAllianceRequest(ally)?.accept();
    game.addExecution(new AttackExecution(20_000, me, enemy.id()));
    executeTicks(game, 4);
    expect(me.units(UnitType.Army)).toHaveLength(1);
    await expectSnapshotRoundTrip(game, "plains", 30);
  });

  test("cancelar: o exército volta e devolve as tropas (menos 25%)", () => {
    me.createAllianceRequest(ally)?.accept();
    const troops = me.troops();
    game.addExecution(new AttackExecution(20_000, me, enemy.id()));
    executeTicks(game, 5);
    const army = me.units(UnitType.Army)[0];
    expect(army).toBeDefined();
    const enemyBefore = enemy.numTilesOwned();
    game.addExecution(new BoatRetreatExecution(me, army.id()));
    executeTicks(game, 20);
    expect(me.units(UnitType.Army)).toHaveLength(0);
    expect(enemy.numTilesOwned()).toBe(enemyBefore);
    const back = me.troops() - (troops - 20_000);
    expect(back).toBeGreaterThanOrEqual(15_000);
    expect(back).toBeLessThan(20_000 + 2_000);
  });

  test("a marcha não deixa um ataque parado na lista", () => {
    me.createAllianceRequest(ally)?.accept();
    game.addExecution(new AttackExecution(20_000, me, enemy.id()));
    executeTicks(game, 2);
    expect(me.units(UnitType.Army)).toHaveLength(1);
    expect(me.outgoingAttacks()).toHaveLength(0);
    expect(enemy.incomingAttacks()).toHaveLength(0);
  });

  test("longe da borda do mapa, a cabeça de ponte não é anexada", () => {
    // Tudo ocupado e longe da borda: o tile em que o exército desembarca
    // fica cercado pelo inimigo e pelo aliado. Antes, a regra de enclave
    // engolia esse tile e o ataque voltava sozinho.
    for (let x = 0; x < game.width(); x++)
      for (let y = 0; y < game.height(); y++) {
        const t = game.ref(x, y);
        if (!game.isLand(t)) continue;
        if (x < 10) me.conquer(t);
        else if (x < 20 && y >= 15 && y < 25) ally.conquer(t);
        else enemy.conquer(t);
      }
    // Um terceiro neutro ocupa o resto do meio: só se chega pelo aliado.
    game.addPlayer(new PlayerInfo("mid", PlayerType.Human, null, "mid_id"));
    const mid = game.player("mid_id");
    for (let x = 10; x < 20; x++)
      for (let y = 0; y < game.height(); y++) {
        if (y >= 15 && y < 25) continue;
        const t = game.ref(x, y);
        if (game.isLand(t)) mid.conquer(t);
      }
    expect(me.sharesBorderWith(enemy)).toBe(false);
    for (const p of [me, ally, enemy, mid])
      game.addExecution(new PlayerExecution(p));
    me.createAllianceRequest(ally)?.accept();
    const before = enemy.numTilesOwned();
    game.addExecution(new AttackExecution(20_000, me, enemy.id()));
    executeTicks(game, 80);
    expect(me.units(UnitType.Army)).toHaveLength(0);
    expect(enemy.numTilesOwned()).toBeLessThan(before - 20);
  });
});

describe("MoWorld enclaves", () => {
  test("bolsão comum junto de aliado continua sendo anexado", async () => {
    // Regra original: um pedaço meu cercado pelo inimigo e pelo aliado, que
    // não veio de uma passagem, é anexado.
    game = await setup("plains", { instantBuild: true });
    for (const id of ["me_id", "ally_id", "enemy_id"])
      game.addPlayer(new PlayerInfo(id, PlayerType.Human, null, id));
    me = game.player("me_id");
    ally = game.player("ally_id");
    enemy = game.player("enemy_id");
    for (let x = 0; x < game.width(); x++)
      for (let y = 0; y < game.height(); y++) {
        const t = game.ref(x, y);
        if (!game.isLand(t)) continue;
        if (x < 10) me.conquer(t);
        else if (x < 20) ally.conquer(t);
        else enemy.conquer(t);
      }
    for (const p of [me, ally, enemy]) p.addTroops(1_000);
    while (game.inSpawnPhase()) game.executeNextTick();
    for (const p of [me, ally, enemy])
      game.addExecution(new PlayerExecution(p));
    // A checagem de enclaves começa até 20 ticks depois (varia pelo id) e só
    // roda quando o território muda: o bolsão nasce depois disso.
    executeTicks(game, 25);
    me.createAllianceRequest(ally)?.accept();
    const pocket = game.ref(25, 20);
    ally.conquer(game.ref(24, 20));
    me.conquer(pocket);
    executeTicks(game, 60);
    expect(game.owner(pocket)).toBe(enemy);
  });
});
