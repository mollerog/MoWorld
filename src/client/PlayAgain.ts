// MoWorld: "Jogar de novo" — nova partida solo com as mesmas configurações
// da última (mapa, dificuldade, bots, opções), sem passar pelo menu.
//
// A configuração fica guardada na aba (sessionStorage) quando uma partida
// solo começa. O botão volta para a tela inicial (que recarrega o jogo do
// zero) com um aviso; a tela inicial então começa a partida sozinha.
import { generateID } from "@openfront/shared/SharedUtil";
import type { WireGameStartInfo } from "@openfront/shared/WireSchemas";
import type { JoinLobbyEvent } from "./Main";
import { peerSession } from "./peer/PeerSession";
import type { UsernameInput } from "./UsernameInput";
import { homeHref } from "./Utils";

const CONFIG_KEY = "moworld-last-solo";
const FLAG_KEY = "moworld-play-again";

export function rememberSoloConfig(lobby: JoinLobbyEvent) {
  if (lobby.source !== "singleplayer" || lobby.peer) return;
  const info = lobby.gameStartInfo;
  if (!info || info.players.length !== 1) return;
  try {
    sessionStorage.setItem(CONFIG_KEY, JSON.stringify(info.config));
  } catch {
    /* sem armazenamento: o botão só não aparece */
  }
}

export function canPlayAgain(): boolean {
  if (peerSession()) return false;
  try {
    return sessionStorage.getItem(CONFIG_KEY) !== null;
  } catch {
    return false;
  }
}

export function requestPlayAgain() {
  try {
    sessionStorage.setItem(FLAG_KEY, "1");
  } catch {
    /* ignora */
  }
  window.location.href = homeHref();
}

/** Na tela inicial: se pediram "Jogar de novo", começa a partida. */
export function maybePlayAgain() {
  let raw: string | null = null;
  try {
    if (sessionStorage.getItem(FLAG_KEY) !== "1") return;
    sessionStorage.removeItem(FLAG_KEY);
    raw = sessionStorage.getItem(CONFIG_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  const config = JSON.parse(raw) as WireGameStartInfo["config"];
  // Espera a tela inicial terminar de montar (nome, conta, configurações).
  window.setTimeout(() => {
    const input = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    const gameID = generateID();
    const info = {
      gameID,
      players: [
        {
          clientID: generateID(),
          username: input?.getUsername?.() || "Jogador",
          clanTag: null,
        },
      ],
      config,
      lobbyCreatedAt: Date.now(),
    } as WireGameStartInfo;
    (
      document.querySelector("game-starting-modal") as {
        show?: () => void;
      } | null
    )?.show?.();
    const detail: JoinLobbyEvent = {
      gameID,
      gameStartInfo: info,
      source: "singleplayer",
    };
    document.body.dispatchEvent(
      new CustomEvent("join-lobby", { detail, bubbles: true, composed: true }),
    );
  }, 900);
}
