// MoWorld: histórico das últimas partidas.
//
// - Sem login: guardado no próprio aparelho (localStorage).
// - Com login Google: guardado no Firestore em users/{uid}/matches/{id}
//   (com cache offline). No primeiro login, o histórico do aparelho sobe para
//   a conta e sai do aparelho.
// O MatchHistoryRecorder acompanha a partida em andamento e atualiza o
// registro dela; a tela inicial mostra as 10 mais recentes.
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import {
  currentUser,
  firestore,
  initAccount,
  onAccountChange,
} from "./Account";
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

/** Histórico só deste aparelho (usado sem login). */
export function loadMatchHistory(): MatchRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as MatchRecord[]) : [];
    return Array.isArray(list) ? list.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function clearMatchHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

function saveLocal(rec: MatchRecord) {
  try {
    const list = loadMatchHistory().filter((r) => r.id !== rec.id);
    list.unshift(rec);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch (err) {
    console.warn("MatchHistory: could not save", err);
  }
}

function matchesOf(uid: string) {
  const db = firestore();
  return db ? collection(db, "users", uid, "matches") : null;
}

/** Grava (ou atualiza) uma partida: na conta se logado, senão no aparelho. */
function saveRecord(rec: MatchRecord) {
  const u = currentUser();
  const col = u ? matchesOf(u.uid) : null;
  if (u && col) {
    // Sem await: com cache offline a gravação fica na fila e sobe depois.
    setDoc(doc(col, rec.id), rec).catch((err) =>
      console.warn("MatchHistory: cloud save failed", err),
    );
    return;
  }
  saveLocal(rec);
}

/** As 10 partidas mais recentes: da conta (se logado) ou do aparelho. */
export async function loadHistory(): Promise<MatchRecord[]> {
  await initAccount();
  const u = currentUser();
  const col = u ? matchesOf(u.uid) : null;
  if (!u || !col) return loadMatchHistory();
  try {
    const snap = await getDocs(
      query(col, orderBy("startedAt", "desc"), limit(MAX)),
    );
    return snap.docs.map((d) => d.data() as MatchRecord);
  } catch (err) {
    console.warn("MatchHistory: cloud load failed", err);
    return [];
  }
}

export async function clearHistory(): Promise<void> {
  const u = currentUser();
  const col = u ? matchesOf(u.uid) : null;
  if (!u || !col) {
    clearMatchHistory();
    return;
  }
  const snap = await getDocs(col);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

/**
 * Primeiro login neste aparelho: sobe o histórico local para a conta e
 * limpa o local (para não subir de novo nem misturar com outra conta).
 */
async function migrateLocalToAccount() {
  const u = currentUser();
  const db = firestore();
  const col = u ? matchesOf(u.uid) : null;
  const local = loadMatchHistory();
  if (!u || !db || !col || local.length === 0) return;
  try {
    const batch = writeBatch(db);
    for (const rec of local) batch.set(doc(col, rec.id), rec);
    await batch.commit();
    clearMatchHistory();
    console.log(`MatchHistory: ${local.length} partidas enviadas para a conta`);
  } catch (err) {
    console.warn("MatchHistory: migration failed (tenta de novo depois)", err);
  }
}

let syncStarted = false;
/** Liga a conta e a migração. Chamado na abertura do app. */
export function startMatchHistorySync() {
  if (syncStarted) return;
  syncStarted = true;
  onAccountChange(() => {
    if (currentUser()) void migrateLocalToAccount();
  });
  void initAccount();
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
