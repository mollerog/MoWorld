import { GameMapType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import {
  CHALLENGES,
  challengeByID,
  challengeConfig,
  loadRecords,
  recordWin,
  starsFor,
  totalStars,
} from "../../../src/client/challenges/Challenges";

// MoWorld: desafios do solo.
const blitz = challengeByID("blitz-world")!;

describe("desafios", () => {
  beforeEach(() => localStorage.clear());

  test("ids únicos, mapas que existem e tempos coerentes", () => {
    const ids = CHALLENGES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHALLENGES) {
      expect(Object.values(GameMapType)).toContain(c.map);
      expect(c.threeStarsMin).toBeLessThan(c.twoStarsMin);
    }
  });

  test("estrelas pelo tempo de jogo", () => {
    expect(starsFor(blitz, 40 * 60)).toBe(1);
    expect(starsFor(blitz, 34 * 60)).toBe(2);
    expect(starsFor(blitz, 24 * 60)).toBe(3);
    // No limite exato, não ganha a estrela de cima.
    expect(starsFor(blitz, blitz.twoStarsMin * 60)).toBe(1);
  });

  test("o recorde guarda o melhor de cada coisa", () => {
    const first = recordWin(blitz, 30 * 60);
    expect(first).toMatchObject({ stars: 2, newBest: true, previous: null });
    // Mais lento: não é recorde, e não perde as estrelas que já tinha.
    expect(recordWin(blitz, 50 * 60)).toMatchObject({
      stars: 1,
      newBest: false,
    });
    expect(loadRecords()["blitz-world"]).toEqual({
      stars: 2,
      bestSeconds: 30 * 60,
    });
    expect(recordWin(blitz, 20 * 60).newBest).toBe(true);
    expect(loadRecords()["blitz-world"]).toEqual({
      stars: 3,
      bestSeconds: 20 * 60,
    });
    expect(totalStars()).toBe(3);
  });

  test("as regras vão na configuração da partida, e ela é válida", () => {
    const clean = challengeConfig(challengeByID("clean-war")!);
    expect(clean.disabledUnits).toEqual(
      expect.arrayContaining([
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
        UnitType.MIRV,
      ]),
    );
    const wolf = challengeConfig(challengeByID("lone-wolf")!);
    expect(wolf.customAllianceDuration).toBe(0);
    expect(challengeConfig(blitz).customAllianceDuration).toBeUndefined();
    for (const c of CHALLENGES) {
      const cfg = {
        gameMapSize: "Normal",
        gameType: "Singleplayer",
        gameMode: "Free For All",
        playerTeams: 2,
        bots: 400,
        infiniteGold: false,
        donateGold: false,
        donateTroops: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        nations: "default",
        ...challengeConfig(c),
      };
      const parsed = GameConfigSchema.safeParse(cfg);
      expect(parsed.success, `${c.id}: ${parsed.error}`).toBe(true);
      expect(parsed.data?.moworldChallenge).toBe(c.id);
    }
  });
});
