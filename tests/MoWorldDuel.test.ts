import {
  Cell,
  Difficulty,
  GameType,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { expect, test } from "vitest";
import { setup } from "./util/Setup";
const K = (n: number) => Math.round(n / 1000) / 10 + "K"; // como a tela (÷10)

async function duel(difficulty: Difficulty, ratio: number, ai: boolean) {
  const gameID = "duel";
  const wallN = new PlayerInfo("Muralha", PlayerType.Human, null, "wall");
  const nation = new Nation(
    new Cell(1500, 350),
    new PlayerInfo("Nacao", PlayerType.Nation, null, "nation_id"),
  );
  const g = await setup(
    "world",
    { difficulty, gameType: GameType.Singleplayer },
    [],
    undefined,
    EngineConfig,
    false,
    [nation],
  );
  const me = new PlayerInfo("Voce", PlayerType.Human, null, "you");
  g.addExecution(new SpawnExecution(gameID, me, g.ref(1400, 350)));
  g.addExecution(new SpawnExecution(gameID, wallN, g.ref(300, 300)));
  if (ai) g.addExecution(new NationExecution(gameID, nation));
  else
    g.addExecution(
      new SpawnExecution(gameID, nation.playerInfo, g.ref(1500, 350)),
    );
  for (let i = 0; i < 100 && g.allPlayers().some((p) => !p.hasSpawned()); i++)
    g.executeNextTick();
  g.endSpawnPhase();
  const you = g.player("you"),
    them = g.player("nation_id"),
    wall = g.player("wall");
  // Resto do mundo: um "muro" parado e fortíssimo — sem terra livre para crescer.
  g.forEachTile?.((t: number) => {
    if (g.isLand(t)) wall.conquer(t);
  });
  // Territórios iguais e encostados (10k pedaços cada), 40K de tropas cada.
  let a = 0,
    b = 0;
  for (let x = 1300; x < 1700; x++)
    for (let y = 250; y < 450; y++) {
      const t = g.ref(x, y);
      if (!g.isLand(t)) continue;
      if (a < 10000) {
        you.conquer(t);
        a++;
      } else if (b < 10000) {
        them.conquer(t);
        b++;
      }
    }
  for (let i = 0; i < 400; i++) g.executeNextTick(); // passa imunidade
  you.removeTroops(you.troops());
  you.addTroops(400_000);
  them.removeTroops(them.troops());
  them.addTroops(400_000);
  wall.addTroops(1e9);
  const log: string[] = [];
  let sent = 0;
  for (let s = 0; s < 180; s++) {
    // A cada 10 s você manda `ratio` das tropas contra ela.
    if (s % 10 === 0 && them.isAlive() && you.isAlive()) {
      const n = you.troops() * ratio;
      sent += n;
      g.addExecution(new AttackExecution(n, you, them.id()));
    }
    for (let t = 0; t < 10; t++) g.executeNextTick();
    if (s % 20 === 19)
      log.push(
        `${s + 1}s voce ${K(you.troops())}/${you.numTilesOwned()}pd nacao ${K(them.troops())}/${them.numTilesOwned()}pd`,
      );
    if (!them.isAlive() || !you.isAlive()) {
      log.push(
        `${s + 1}s FIM: ${them.isAlive() ? "você morreu" : "nação eliminada"}`,
      );
      break;
    }
  }
  return { eliminated: !them.isAlive(), youAlive: you.isAlive(), sent, log };
}
// MoWorld: o jogador mandando 50% das tropas a cada 10 s contra uma nação do
// mesmo tamanho (com a IA do Difícil revidando) precisa conseguir vencê-la.
// Antes do teto MAX_TROOP_RATIO, cada ataque menor que o exército inteiro
// dela pagava até 2× por pedaço, e a nação nunca caía (ver o comentário de MAX_TROOP_RATIO em
// EngineConfig).
test("duelo 1×1 no Difícil: 50% a cada 10 s elimina uma nação igual", async () => {
  const r = await duel(Difficulty.Hard, 0.5, true);
  expect(r.youAlive).toBe(true);
  expect(r.eliminated).toBe(true);
}, 600_000);
