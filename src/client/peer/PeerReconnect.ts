// MoWorld: reconexão da partida com amigos.
//
// Quando a ligação cai (rede, app em segundo plano, app fechado), os dois
// lados tentam se achar de novo pela mesma sala: o anfitrião reabre a sala
// com o mesmo código e espera; o convidado tenta entrar a cada RETRY_MS. Ao
// voltar, a ligação nova entra no lugar da antiga (PeerSession.onRelink) e
// quem estava fora recebe os turnos que perdeu.
import { defaultSignaling, PeerLink } from "./PeerLink";
import { emitPeerBack, emitPeerLost, PeerSession } from "./PeerSession";

const RETRY_MS = 2000;

export interface PeerWatchHooks {
  /** A ligação caiu (antes de começar a tentar de novo). */
  onLost?: () => void;
}

let watched: PeerSession | null = null;
let stopLoop: (() => void) | null = null;
let hooks: PeerWatchHooks = {};

/**
 * Passa a vigiar a ligação da sessão: se cair, avisa e reconecta sozinho,
 * quantas vezes for preciso, até `stopPeerWatch`.
 */
export function watchPeerLink(session: PeerSession, h: PeerWatchHooks = {}) {
  stopPeerWatch();
  watched = session;
  hooks = h;
  watchLink(session, session.link);
}

/** Para de vigiar (fim da partida ou saída do jogador). */
export function stopPeerWatch() {
  stopLoop?.();
  stopLoop = null;
  watched = null;
  hooks = {};
}

function watchLink(session: PeerSession, link: PeerLink) {
  link.onClose(() => {
    if (watched !== session || session.link !== link) return;
    hooks.onLost?.();
    emitPeerLost();
    stopLoop = reconnect(session, (fresh) => {
      stopLoop = null;
      if (watched !== session) {
        fresh.close();
        return;
      }
      session.link = fresh;
      session.onRelink?.(fresh);
      watchLink(session, fresh);
      emitPeerBack();
    });
  });
}

/**
 * Tenta refazer a ligação da sessão até conseguir. Devolve como desistir.
 * Usado também por quem volta depois de fechar o app (CoopResume).
 */
export function reconnect(
  session: Pick<PeerSession, "role" | "code">,
  done: (link: PeerLink) => void,
): () => void {
  let cancelled = false;
  let cancelRoom: (() => void) | null = null;
  const code = session.code;
  if (!code) return () => {};
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  void (async () => {
    while (!cancelled) {
      console.info(`peer: tentando reconectar (${session.role}, sala ${code})`);
      try {
        let link: PeerLink;
        if (session.role === "host") {
          const room = await PeerLink.host(defaultSignaling(), code);
          cancelRoom = room.cancel;
          if (cancelled) {
            room.cancel();
            return;
          }
          link = await room.ready;
          cancelRoom = null;
        } else {
          link = await PeerLink.join(defaultSignaling(), code);
        }
        if (cancelled) {
          link.close();
          return;
        }
        done(link);
        return;
      } catch (e) {
        console.info(
          `peer: reconexão (${session.role}) falhou: ${(e as Error).message}`,
        );
        cancelRoom?.();
        cancelRoom = null;
        await sleep(RETRY_MS);
      }
    }
  })();
  return () => {
    cancelled = true;
    cancelRoom?.();
  };
}
