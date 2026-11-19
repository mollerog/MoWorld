// MoWorld: a partida "jogando junto" em andamento (um anfitrião + um
// convidado ligados por PeerLink).
//
// O anfitrião roda o "servidor" do jogo no próprio aparelho (LocalServer) e
// repassa os turnos para o convidado. Pausar e despausar exigem que os dois
// aceitem: quem pede fica aguardando, o outro vê o pedido.
import type { WireGameStartInfo } from "@openfront/shared/WireSchemas";
import { PeerLink } from "./PeerLink";

export type PeerRole = "host" | "guest";

export interface PeerSession {
  role: PeerRole;
  link: PeerLink;
  partnerName: string;
  /** Código da sala: a reconexão reabre a mesma (PeerReconnect). */
  code?: string;
  /** Só no anfitrião: quem é o convidado na partida. */
  guestClientID?: string;
  /** Só no anfitrião: o servidor local registra aqui a resposta da votação. */
  answerVote?: (accept: boolean) => void;
  /**
   * Quem usa a ligação (LocalServer no anfitrião, Transport no convidado)
   * se registra aqui para passar a usar a ligação nova depois de uma queda.
   */
  onRelink?: (link: PeerLink) => void;
  /**
   * O jogo em andamento registra aqui como tirar um save dele (para quem
   * fechou o app e voltou continuar do mesmo ponto). `tick` = turnos já
   * executados.
   */
  takeSnapshot?: () => Promise<{ bytes: Uint8Array; tick: number }>;
  /** Só no anfitrião: voltar a jogar enquanto espera o outro reconectar. */
  continueAlone?: () => void;
}

let current: PeerSession | null = null;

export function setPeerSession(s: PeerSession | null) {
  current = s;
}
export function peerSession(): PeerSession | null {
  return current;
}

// ------------------------------------------------------------ votação de pausa

export type PauseVoteState =
  | { state: "ask"; paused: boolean; from: string } // o outro pediu
  | { state: "waiting"; paused: boolean } // eu pedi
  | { state: "accepted"; paused: boolean }
  | { state: "refused"; paused: boolean; by: string };

export const PAUSE_VOTE_EVENT = "moworld-pause-vote";

export function emitPauseVote(v: PauseVoteState) {
  window.dispatchEvent(new CustomEvent(PAUSE_VOTE_EVENT, { detail: v }));
}

/** Responde ao pedido de pausa/despausa do outro jogador. */
export function answerPauseVote(accept: boolean) {
  const s = current;
  if (!s) return;
  if (s.role === "host") s.answerVote?.(accept);
  else s.link.sendJson({ k: "pause-answer", accept });
}

// ------------------------------------------------------------ queda da ligação

export const PEER_LOST_EVENT = "moworld-peer-lost";
export function emitPeerLost() {
  window.dispatchEvent(new CustomEvent(PEER_LOST_EVENT));
}

/** A ligação voltou depois de uma queda. */
export const PEER_BACK_EVENT = "moworld-peer-back";
export function emitPeerBack() {
  window.dispatchEvent(new CustomEvent(PEER_BACK_EVENT));
}

// ------------------------------------------------- voltar depois de fechar o app

/**
 * O que um aparelho guarda da partida com amigos em andamento, para voltar
 * a ela se o app fechar (ver CoopResume). Vale por RESUME_TTL_MS.
 */
export interface CoopResumeRecord {
  role: PeerRole;
  code: string;
  gameID: string;
  partnerName: string;
  gameStartInfo: WireGameStartInfo;
  savedAt: number;
}

// No teste com duas abas (`?p2plocal&slot=a`) cada aba guarda o seu.
const RESUME_KEY = (() => {
  const q = new URLSearchParams(location.search);
  const slot = q.has("p2plocal") ? q.get("slot") : null;
  return slot ? `moworld.coopResume.${slot}` : "moworld.coopResume";
})();
export const RESUME_TTL_MS = 3 * 60 * 60 * 1000;

export function saveCoopResume(r: Omit<CoopResumeRecord, "savedAt">) {
  try {
    localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({ ...r, savedAt: Date.now() }),
    );
  } catch {
    /* sem armazenamento: só não dá para voltar */
  }
}

export function readCoopResume(): CoopResumeRecord | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as CoopResumeRecord;
    if (Date.now() - r.savedAt > RESUME_TTL_MS) {
      localStorage.removeItem(RESUME_KEY);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

/** A partida acabou (ou o jogador saiu de vez): nada para voltar. */
export function clearCoopResume() {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    /* nada */
  }
}
