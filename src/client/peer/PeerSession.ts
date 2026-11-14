// MoWorld: a partida "jogando junto" em andamento (um anfitrião + um
// convidado ligados por PeerLink).
//
// O anfitrião roda o "servidor" do jogo no próprio aparelho (LocalServer) e
// repassa os turnos para o convidado. Pausar e despausar exigem que os dois
// aceitem: quem pede fica aguardando, o outro vê o pedido.
import { PeerLink } from "./PeerLink";

export type PeerRole = "host" | "guest";

export interface PeerSession {
  role: PeerRole;
  link: PeerLink;
  partnerName: string;
  /** Só no anfitrião: quem é o convidado na partida. */
  guestClientID?: string;
  /** Só no anfitrião: o servidor local registra aqui a resposta da votação. */
  answerVote?: (accept: boolean) => void;
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
