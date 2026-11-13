// MoWorld: histórico das últimas partidas, guardado no próprio aparelho
// (localStorage). O MatchHistoryRecorder acompanha a partida em andamento e
// atualiza o registro dela; a tela inicial mostra as 10 mais recentes.
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { Controller } from "./Controller";
import { translateText } from "./Utils";
import { GameView } from "./view";

const KEY = "moworld-match-history";
const MAX = 10;

export type MatchResult =
  | "playing" // em andamento (se ficar assim, foi interrompida)
  | "total" // eliminou todos os inimigos
  | "victory" // chegou à meta (80%)
  | "defeat" // outro venceu
  | "eliminated"; // perdeu todo o território

export type MatchRecord = {
  id: string;
  startedAt: string; // ISO
  map: string;
  difficulty: string;
  result: MatchResult;
  /** % da terra no fim (ou no momento mais recente). */
  share: number;
  /** maior % alcançada na partida */
  bestShare: number;
  seconds: number;
  resumed: boolean;
};

export function loadMatchHistory(): MatchRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as MatchRecord[]) : [];
    return Array.isArray(list) ? list.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function saveRecord(rec: MatchRecord) {
  try {
    const list = loadMatchHistory().filter((r) => r.id !== rec.id);
    list.unshift(rec);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch (err) {
    console.warn("MatchHistory: could not save", err);
  }
}

export function clearMatchHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function mapDisplayName(map: string): string {
  const key = "map." + map.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = translateText(key);
  return t && t !== key ? t : map;
}

export function difficultyDisplayName(d: string): string {
  return (
    {
      Easy: "Fácil",
      Medium: "Médio",
      Hard: "Difícil",
      Impossible: "Impossível",
    }[d] ?? d
  );
}

/** Acompanha a partida e mantém o registro dela atualizado. */
export class MatchHistoryRecorder implements Controller {
  private rec: MatchRecord | null = null;
  private lastSave = 0;

  constructor(private game: GameView) {}

  init() {
    // Fechou a aba/saiu no meio: guarda o estado mais recente.
    window.addEventListener("pagehide", () => this.persist(true));
  }

  tick() {
    const game = this.game;
    if (game.config().gameConfig().tutorial === true) return;
    const me = game.myPlayer();
    if (me === null || game.inSpawnPhase() || !me.hasSpawned()) return;

    const cfg = game.config().gameConfig();
    if (this.rec === null) {
      this.rec = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        startedAt: new Date().toISOString(),
        map: String(cfg.gameMap),
        difficulty: String(cfg.difficulty),
        result: "playing",
        share: 0,
        bestShare: 0,
        seconds: 0,
        resumed: game.resumedFromSave(),
      };
    }
    const rec = this.rec;
    const final = rec.result === "total" || rec.result === "eliminated";
    if (final) return;

    const land = Math.max(game.numLandTiles() - game.numTilesWithFallout(), 1);
    rec.share = (me.numTilesOwned() / land) * 100;
    rec.bestShare = Math.max(rec.bestShare, rec.share);
    rec.seconds = Math.floor(game.elapsedGameSeconds());

    let changed = false;
    // Vitória/derrota anunciada pelo jogo (meta de 80%).
    for (const wu of game.updatesSinceLastTick()?.[GameUpdateType.Win] ?? []) {
      if (rec.result !== "playing" || wu.winner === undefined) continue;
      const mine = wu.winner[0] === "player" && wu.winner[1] === me.clientID();
      rec.result = mine ? "victory" : "defeat";
      changed = true;
    }
    if (!me.isAlive()) {
      rec.result = "eliminated";
      changed = true;
    } else if (!game.players().some((p) => p.id() !== me.id() && p.isAlive())) {
      rec.result = "total";
      changed = true;
    }
    this.persist(changed);
  }

  private persist(force: boolean) {
    if (!this.rec) return;
    const now = Date.now();
    if (!force && now - this.lastSave < 5000) return;
    this.lastSave = now;
    saveRecord({ ...this.rec });
  }
}
