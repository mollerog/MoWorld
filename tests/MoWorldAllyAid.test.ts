// MoWorld: nação aliada e amigável ajuda o jogador no todos-contra-todos.
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  ALLY_AID_COOLDOWN,
  maybeAidAllies,
} from "@openfront/engine/execution/nation/NationAllyAid";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let human: Player;
let nation: Player;
let enemy: Player;

describe("MoWorld ajuda de aliado", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true });
    game.addPlayer(new PlayerInfo("human", PlayerType.Human, null, "h"));
    game.addPlayer(new PlayerInfo("nation", PlayerType.Nation, null, "n"));
    game.addPlayer(new PlayerInfo("enemy", PlayerType.Human, null, "e"));
    human = game.player("h");
    nation = game.player("n");
    enemy = game.player("e");
    for (let x = 0; x < 10; x++)
      for (let y = 0; y < 10; y++) human.conquer(game.ref(x, y));
    for (let x = 40; x < 50; x++)
      for (let y = 0; y < 10; y++) nation.conquer(game.ref(x, y));
    for (let x = 10; x < 20; x++)
      for (let y = 0; y < 10; y++) enemy.conquer(game.ref(x, y));
    while (game.inSpawnPhase()) game.executeNextTick();
    human.createAllianceRequest(nation)?.accept();
  });

  test("manda tropas para o aliado atacado e fraco, com espera", () => {
    nation.addTroops(game.config().maxTroops(nation));
    // Ataque chegando (o mapa de teste conquista rápido demais para um
    // ataque de verdade ficar rolando).
    vi.spyOn(human, "incomingAttacks").mockReturnValue([{} as never]);
    expect(human.isAlive()).toBe(true);
    // Poucas tropas.
    human.removeTroops(Math.max(0, human.troops() - 10));

    // Relação ainda não é amigável: não ajuda.
    expect(maybeAidAllies(game, nation)).toBe(false);

    nation.updateRelation(human, 100);
    const before = human.troops();
    expect(maybeAidAllies(game, nation)).toBe(true);
    executeTicks(game, 2);
    expect(human.troops()).toBeGreaterThan(before);

    // Espera de 3 minutos.
    expect(maybeAidAllies(game, nation)).toBe(false);
    executeTicks(game, ALLY_AID_COOLDOWN);
  });

  test("manda ouro quando sobra", () => {
    nation.updateRelation(human, 100);
    nation.addGold(10_000_000n);
    const before = human.gold();
    expect(maybeAidAllies(game, nation)).toBe(true);
    executeTicks(game, 2);
    expect(human.gold()).toBeGreaterThan(before);
  });

  test("não ajuda quem não é aliado", () => {
    const alliance = human.allianceWith(nation)!;
    human.breakAlliance(alliance);
    nation.updateRelation(human, 100);
    nation.addGold(10_000_000n);
    expect(maybeAidAllies(game, nation)).toBe(false);
  });
});
