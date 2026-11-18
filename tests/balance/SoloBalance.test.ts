/**
 * MoWorld: simulação de equilíbrio (opcional, fora da bateria normal).
 *
 * Roda partidas só de nações no mapa-múndi com a configuração real do motor
 * (EngineConfig, as mesmas NationExecution do jogo) e mede como a partida
 * evolui: quantas nações sobram, quanto o líder domina e em que minuto
 * alguém passa da meta de vitória. Serve para ver o efeito de uma mudança
 * de regra no equilíbrio antes de jogar.
 *
 * Limitações: não há jogador humano (a IA não joga por você) nem tribos;
 * mede a dinâmica das nações, que é o que decide o ritmo de uma partida.
 *
 * Use pelo script: `node scripts/balance.mjs` (ver o cabeçalho dele).
 * Variáveis: MOWORLD_BALANCE_SEEDS="1,2", MOWORLD_BALANCE_MINUTES=30,
 * MOWORLD_BALANCE_DIFFICULTY=Medium, MOWORLD_BALANCE_OUT=/tmp/balance.
 */
import {
  Cell,
  Difficulty,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { RecomputeRailClusterExecution } from "@openfront/engine/execution/RecomputeRailClusterExecution";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { setup } from "../util/Setup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TICKS_PER_MINUTE = 600;
const ENABLED = process.env.MOWORLD_BALANCE !== undefined;
const SEEDS = (process.env.MOWORLD_BALANCE_SEEDS ?? "1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MINUTES = Number(process.env.MOWORLD_BALANCE_MINUTES ?? 30);
const DIFFICULTY = (process.env.MOWORLD_BALANCE_DIFFICULTY ??
  "Medium") as keyof typeof Difficulty;
const OUT = process.env.MOWORLD_BALANCE_OUT ?? "/tmp/moworld-balance";

function loadWorldNations(): Nation[] {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../testdata/maps/world/manifest.json"),
      "utf8",
    ),
  ) as { nations: { coordinates: [number, number]; name: string }[] };
  return manifest.nations.map(
    (n) =>
      new Nation(
        new Cell(n.coordinates[0], n.coordinates[1]),
        new PlayerInfo(n.name, PlayerType.Nation, null, n.name),
      ),
  );
}

export interface BalanceSample {
  minute: number;
  alive: number;
  /** % da terra (sem fallout) do líder e dos três maiores. */
  leaderShare: number;
  top3Share: number;
}

export interface BalanceResult {
  seed: string;
  difficulty: string;
  nations: number;
  /** Minuto em que o líder passou da meta de vitória (null: ninguém). */
  winMinute: number | null;
  samples: BalanceSample[];
}

async function runGame(seed: string): Promise<BalanceResult> {
  const nations = loadWorldNations();
  const gameID = `balance-${seed}`;
  const game = await setup(
    "world",
    { difficulty: Difficulty[DIFFICULTY] },
    [],
    undefined,
    EngineConfig,
    false,
    nations,
  );
  for (const nation of nations) {
    game.addExecution(new NationExecution(gameID, nation));
  }
  game.addExecution(new RecomputeRailClusterExecution(game.railNetwork()));
  for (
    let i = 0;
    i < 100 && game.allPlayers().some((p) => !p.hasSpawned());
    i++
  ) {
    game.executeNextTick();
  }
  game.endSpawnPhase();

  const samples: BalanceSample[] = [];
  let winMinute: number | null = null;
  for (let minute = 1; minute <= MINUTES; minute++) {
    for (let t = 0; t < TICKS_PER_MINUTE; t++) game.executeNextTick();
    const land = game.numLandTiles() - game.numTilesWithFallout();
    const sizes = game
      .players()
      .map((p) => p.numTilesOwned())
      .sort((a, b) => b - a);
    const share = (n: number) => Math.round((n / land) * 1000) / 10;
    const leader = sizes[0] ?? 0;
    const needTenths = game
      .config()
      .percentageTilesOwnedToWinTenths(game.elapsedGameSeconds());
    if (winMinute === null && leader * 1000 > land * needTenths) {
      winMinute = minute;
    }
    samples.push({
      minute,
      alive: sizes.length,
      leaderShare: share(leader),
      top3Share: share(sizes.slice(0, 3).reduce((a, b) => a + b, 0)),
    });
  }
  return {
    seed,
    difficulty: DIFFICULTY,
    nations: nations.length,
    winMinute,
    samples,
  };
}

describe.skipIf(!ENABLED)("MoWorld: simulação de equilíbrio", () => {
  for (const seed of SEEDS) {
    test(`partida ${seed} (${DIFFICULTY}, ${MINUTES} min)`, async () => {
      const result = await runGame(seed);
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(
        path.join(OUT, `${DIFFICULTY}-${seed}.json`),
        JSON.stringify(result),
      );
      expect(result.samples).toHaveLength(MINUTES);
    }, 3_600_000);
  }
});
