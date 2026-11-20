// MoWorld: desafios do solo.
//
// Cada desafio é uma partida solo com mapa, dificuldade e regras fixas. A
// regra é imposta pela configuração (bombas ou alianças desligadas), não
// vigiada: não há como quebrá-la sem querer, e uma partida continuada a
// partir do save segue sendo o mesmo desafio (o id vai em
// GameConfig.moworldChallenge). As estrelas só dependem de vencer e do
// tempo de jogo: 1 por vencer, 2 e 3 por vencer abaixo dos tempos.
import {
  Difficulty,
  GameMapType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";

export interface ChallengeDef {
  id: string;
  emoji: string;
  title: string;
  /** A regra, em uma linha. */
  rule: string;
  map: GameMapType;
  difficulty: Difficulty;
  /** Minutos de jogo para 2 e 3 estrelas. */
  twoStarsMin: number;
  threeStarsMin: number;
  disabledUnits?: UnitType[];
  noAlliances?: boolean;
}

const NUKES = [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV];

export const CHALLENGES: readonly ChallengeDef[] = [
  {
    id: "blitz-world",
    emoji: "⚡",
    title: "Blitz no Mundo",
    rule: "Vença no Mundo, no Médio.",
    map: GameMapType.World,
    difficulty: Difficulty.Medium,
    twoStarsMin: 35,
    threeStarsMin: 25,
  },
  {
    id: "clean-war",
    emoji: "🕊️",
    title: "Guerra limpa",
    rule: "Vença no Mundo sem bombas nucleares (para ninguém).",
    map: GameMapType.World,
    difficulty: Difficulty.Medium,
    twoStarsMin: 40,
    threeStarsMin: 30,
    disabledUnits: NUKES,
  },
  {
    id: "lone-wolf",
    emoji: "🐺",
    title: "Lobo solitário",
    rule: "Vença no Mundo sem alianças (ninguém se alia).",
    map: GameMapType.World,
    difficulty: Difficulty.Medium,
    twoStarsMin: 35,
    threeStarsMin: 25,
    noAlliances: true,
  },
  {
    id: "europe-rush",
    emoji: "🏰",
    title: "Corrida na Europa",
    rule: "Vença na Europa, no Médio.",
    map: GameMapType.Europe,
    difficulty: Difficulty.Medium,
    twoStarsMin: 25,
    threeStarsMin: 18,
  },
  {
    id: "giant-world",
    emoji: "🌍",
    title: "Mundo Gigante",
    rule: "Vença no Mapa-múndi Gigante, no Médio.",
    map: GameMapType.GiantWorldMap,
    difficulty: Difficulty.Medium,
    twoStarsMin: 70,
    threeStarsMin: 55,
  },
  {
    id: "hard-world",
    emoji: "🔥",
    title: "Difícil",
    rule: "Vença no Mundo, no Difícil.",
    map: GameMapType.World,
    difficulty: Difficulty.Hard,
    twoStarsMin: 40,
    threeStarsMin: 30,
  },
  {
    id: "impossible-world",
    emoji: "💀",
    title: "Impossível",
    rule: "Vença no Mundo, no Impossível.",
    map: GameMapType.World,
    difficulty: Difficulty.Impossible,
    twoStarsMin: 45,
    threeStarsMin: 35,
  },
];

export function challengeByID(id: string | undefined): ChallengeDef | null {
  return CHALLENGES.find((c) => c.id === id) ?? null;
}

/** Estrelas de uma vitória com `seconds` de jogo. */
export function starsFor(def: ChallengeDef, seconds: number): 1 | 2 | 3 {
  const min = seconds / 60;
  if (min < def.threeStarsMin) return 3;
  if (min < def.twoStarsMin) return 2;
  return 1;
}

/** O que a partida do desafio muda na configuração do solo. */
export function challengeConfig(
  def: ChallengeDef,
): Pick<
  GameConfig,
  | "gameMap"
  | "difficulty"
  | "disabledUnits"
  | "moworldChallenge"
  | "customAllianceDuration"
> {
  return {
    gameMap: def.map,
    difficulty: def.difficulty,
    disabledUnits: def.disabledUnits ?? [],
    moworldChallenge: def.id,
    ...(def.noAlliances ? { customAllianceDuration: 0 } : {}),
  };
}

// -------------------------------------------------------------- recordes

export interface ChallengeRecord {
  stars: number;
  /** Menor tempo de vitória, em segundos de jogo. */
  bestSeconds: number;
}

const KEY = "moworld.challenges";

export function loadRecords(): Record<string, ChallengeRecord> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<
      string,
      ChallengeRecord
    >;
  } catch {
    return {};
  }
}

export interface ChallengeResult {
  stars: 1 | 2 | 3;
  seconds: number;
  /** Melhorou as estrelas ou o tempo. */
  newBest: boolean;
  previous: ChallengeRecord | null;
}

/** Registra uma vitória no desafio e devolve o resultado. */
export function recordWin(def: ChallengeDef, seconds: number): ChallengeResult {
  const records = loadRecords();
  const previous = records[def.id] ?? null;
  const stars = starsFor(def, seconds);
  const next: ChallengeRecord = {
    stars: Math.max(stars, previous?.stars ?? 0),
    bestSeconds: Math.min(seconds, previous?.bestSeconds ?? Infinity),
  };
  const newBest =
    previous === null ||
    next.stars > previous.stars ||
    next.bestSeconds < previous.bestSeconds;
  records[def.id] = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* sem armazenamento: só não guarda o recorde */
  }
  return { stars, seconds, newBest, previous };
}

export function totalStars(records = loadRecords()): number {
  return CHALLENGES.reduce((sum, c) => sum + (records[c.id]?.stars ?? 0), 0);
}

export function formatMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
