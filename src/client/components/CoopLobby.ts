// MoWorld: "Jogar com amigos" — sala por código, ligação direta entre os
// dois aparelhos (sem servidor). Quem cria a sala é o anfitrião: escolhe a
// dificuldade e começa a partida; o jogo roda no aparelho dele e as jogadas
// vão e voltam pela ligação.
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "@openfront/engine-api/game/GameTypes";
import { generateID } from "@openfront/shared/SharedUtil";
import type { WireGameStartInfo } from "@openfront/shared/WireSchemas";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { accountStatus, initAccount, onAccountChange } from "../Account";
import { ClientEnv } from "../ClientEnv";
import type { JoinLobbyEvent } from "../Main";
import { defaultSignaling, PeerLink } from "../peer/PeerLink";
import { setPeerSession } from "../peer/PeerSession";
import type { UsernameInput } from "../UsernameInput";
import { validateUsername } from "../validations/username";

type Phase =
  | "idle"
  | "creating"
  | "waiting"
  | "joining"
  | "host-ready"
  | "guest-ready"
  | "starting"
  | "error";

const DIFFS: [Difficulty, string][] = [
  [Difficulty.Easy, "Fácil"],
  [Difficulty.Medium, "Médio"],
  [Difficulty.Hard, "Difícil"],
];

function myName(): string {
  const input = document.querySelector(
    "username-input",
  ) as UsernameInput | null;
  const name = input?.getUsername?.() ?? "";
  return validateUsername(name).isValid ? name : "Jogador";
}

function build(): string {
  try {
    return ClientEnv.gitCommit();
  } catch {
    return "dev";
  }
}

@customElement("moworld-coop-lobby")
export class CoopLobby extends LitElement {
  @state() private phase: Phase = "idle";
  @state() private code = "";
  @state() private joinCode = "";
  @state() private error = "";
  @state() private partner = "";
  @state() private difficulty: Difficulty = Difficulty.Easy;
  @state() private account = accountStatus();
  @state() private rtt: number | null = null;

  private link: PeerLink | null = null;
  private cancelHost: (() => void) | null = null;
  private offAccount: (() => void) | null = null;
  private rttTimer = 0;
  private handedOff = false;

  createRenderRoot() {
    return this;
  }

  private get localTest() {
    return new URLSearchParams(location.search).has("p2plocal");
  }

  connectedCallback() {
    super.connectedCallback();
    this.offAccount = onAccountChange(() => (this.account = accountStatus()));
    void initAccount().then(() => (this.account = accountStatus()));
    this.rttTimer = window.setInterval(() => {
      this.rtt = this.link?.rtt ?? null;
    }, 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.offAccount?.();
    window.clearInterval(this.rttTimer);
    if (!this.handedOff) {
      this.cancelHost?.();
      this.link?.close();
    }
  }

  private fail(msg: string) {
    this.phase = "error";
    this.error = msg;
  }

  private async create() {
    this.error = "";
    this.phase = "creating";
    try {
      const room = await PeerLink.host(defaultSignaling());
      this.cancelHost = room.cancel;
      this.code = room.code;
      this.phase = "waiting";
      const link = await room.ready;
      this.cancelHost = null;
      this.attach(link, "host");
    } catch (e) {
      const m = (e as Error).message;
      this.fail(
        m === "timeout"
          ? "Não conectou. Tente de novo (ou os dois na mesma Wi-Fi)."
          : "Não foi possível criar a sala.",
      );
    }
  }

  private async join() {
    const code = this.joinCode.trim().toUpperCase();
    if (code.length !== 6) return;
    this.error = "";
    this.phase = "joining";
    try {
      const link = await PeerLink.join(defaultSignaling(), code);
      this.code = code;
      this.attach(link, "guest");
    } catch (e) {
      const m = (e as Error).message;
      this.fail(
        m === "not_found"
          ? "Sala não encontrada. Confira o código."
          : m === "timeout"
            ? "Não conectou. Tente de novo."
            : "Não foi possível entrar.",
      );
    }
  }

  private attach(link: PeerLink, role: "host" | "guest") {
    this.link = link;
    link.onClose(() => {
      if (!this.handedOff) this.fail("A conexão caiu.");
    });
    link.onJson((m) => {
      if (m.k === "hello" && role === "host") {
        if (m.build !== build()) {
          link.sendJson({ k: "bad-build" });
          this.fail(
            "Versões diferentes do jogo. Fechem e abram o MoWorld nos dois aparelhos.",
          );
          return;
        }
        this.partner = String(m.name ?? "Convidado");
        link.sendJson({ k: "welcome", name: myName() });
        this.phase = "host-ready";
      }
      if (m.k === "welcome" && role === "guest") {
        this.partner = String(m.name ?? "Anfitrião");
        this.phase = "guest-ready";
      }
      if (m.k === "bad-build" && role === "guest") {
        this.fail(
          "Versões diferentes do jogo. Fechem e abram o MoWorld nos dois aparelhos.",
        );
      }
      if (m.k === "start" && role === "guest") {
        this.startAsGuest(m.info as WireGameStartInfo);
      }
    });
    if (role === "guest") {
      link.sendJson({ k: "hello", name: myName(), build: build() });
    }
  }

  private dispatchJoin(detail: JoinLobbyEvent) {
    this.handedOff = true;
    (
      document.querySelector("game-starting-modal") as {
        show?: () => void;
      } | null
    )?.show?.();
    this.dispatchEvent(
      new CustomEvent("join-lobby", { detail, bubbles: true, composed: true }),
    );
    this.remove();
  }

  private startAsHost() {
    const link = this.link;
    if (!link) return;
    this.phase = "starting";
    const gameID = generateID();
    const hostID = generateID();
    const guestID = generateID();
    const info: WireGameStartInfo = {
      gameID,
      players: [
        { clientID: hostID, username: myName(), clanTag: null },
        {
          clientID: guestID,
          username: this.partner || "Convidado",
          clanTag: null,
        },
      ],
      config: {
        gameMap: GameMapType.World,
        gameMapSize: GameMapSize.Normal,
        gameType: GameType.Singleplayer,
        gameMode: GameMode.FFA,
        playerTeams: 2,
        difficulty: this.difficulty,
        bots: 400,
        infiniteGold: false,
        donateGold: true,
        donateTroops: true,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        disabledUnits: [],
        nations: "default",
      },
      lobbyCreatedAt: Date.now(),
    } as WireGameStartInfo;
    const session = {
      role: "host" as const,
      link,
      partnerName: this.partner,
      guestClientID: guestID,
    };
    setPeerSession(session);
    link.sendJson({ k: "start", info });
    this.dispatchJoin({
      gameID,
      gameStartInfo: info,
      source: "singleplayer",
      peer: session,
    });
  }

  private startAsGuest(info: WireGameStartInfo) {
    const link = this.link;
    if (!link) return;
    const session = { role: "guest" as const, link, partnerName: this.partner };
    setPeerSession(session);
    this.dispatchJoin({
      gameID: info.gameID,
      gameStartInfo: info,
      source: "singleplayer",
      peer: session,
    });
  }

  private close() {
    this.remove();
  }

  render() {
    const btn =
      "rounded-xl px-4 py-3 font-extrabold disabled:opacity-40 active:translate-y-px";
    const needLogin = !this.localTest && this.account !== "signed-in";
    const idle = this.phase === "idle" || this.phase === "error";
    return html`
      <div
        class="fixed inset-0 z-[20000] flex items-center justify-center bg-black/70 p-3"
      >
        <div
          class="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-white shadow-2xl"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-extrabold">🤝 Jogar com amigos</h2>
            <button
              class="px-2 text-xl text-white/60"
              @click=${() => this.close()}
            >
              ✕
            </button>
          </div>
          <p class="mt-1 text-xs text-white/55">
            Um cria a sala e passa o código; o outro entra. O jogo roda no
            aparelho de quem criou.
          </p>

          ${
            needLogin
              ? html`<p
                  class="mt-4 rounded-lg bg-amber-500/15 p-3 text-sm text-amber-200"
                >
                  Entre com Google (canto de cima da tela inicial) nos dois
                  aparelhos para usar salas.
                </p>`
              : idle
                ? html`<div class="mt-4 grid grid-cols-2 gap-2">
                    <button
                      class="${btn} bg-amber-400 text-slate-900"
                      data-coop-create
                      @click=${() => this.create()}
                    >
                      Criar sala
                    </button>
                    <div class="flex gap-1">
                      <input
                        class="min-w-0 flex-1 rounded-xl bg-white/10 px-2 text-center font-mono text-lg uppercase tracking-widest"
                        maxlength="6"
                        placeholder="CÓDIGO"
                        data-coop-code
                        .value=${this.joinCode}
                        @input=${(e: Event) =>
                          (this.joinCode = (
                            e.target as HTMLInputElement
                          ).value)}
                      />
                      <button
                        class="${btn} bg-sky-500 px-3"
                        data-coop-join
                        ?disabled=${this.joinCode.trim().length !== 6}
                        @click=${() => this.join()}
                      >
                        Entrar
                      </button>
                    </div>
                  </div>`
                : nothing
          }
          ${
            this.phase === "creating" || this.phase === "joining"
              ? html`<p class="mt-4 text-sm text-white/70">Conectando…</p>`
              : nothing
          }
          ${
            this.phase === "waiting"
              ? html`<div class="mt-4 text-center">
                  <div class="text-xs text-white/55">
                    Código da sala — passe para a outra pessoa
                  </div>
                  <div
                    class="font-mono text-4xl font-black tracking-[0.3em]"
                    data-coop-room
                  >
                    ${this.code}
                  </div>
                  <div class="mt-2 text-sm text-white/60">
                    Aguardando alguém entrar…
                  </div>
                </div>`
              : nothing
          }
          ${
            this.phase === "host-ready"
              ? html`<div class="mt-4">
                  <div
                    class="rounded-lg bg-emerald-500/15 p-3 text-sm text-emerald-200"
                  >
                    ✓ ${this.partner} entrou na sala
                    ${this.rtt !== null ? html`· ${Math.round(this.rtt)} ms` : nothing}
                  </div>
                  <div class="mt-3 text-xs uppercase text-white/50">
                    Dificuldade das nações
                  </div>
                  <div class="mt-1 grid grid-cols-3 gap-1">
                    ${DIFFS.map(
                      ([d, label]) =>
                        html`<button
                          class="rounded-lg px-2 py-2 text-sm font-bold ${
                            this.difficulty === d
                              ? "bg-amber-400 text-slate-900"
                              : "bg-white/10"
                          }"
                          @click=${() => (this.difficulty = d)}
                        >
                          ${label}
                        </button>`,
                    )}
                  </div>
                  <div class="mt-2 text-xs text-white/50">
                    Mapa: Mundo · cada um por si (dá para fazer aliança e doar
                    tropas/ouro um para o outro)
                  </div>
                  <button
                    class="${btn} mt-3 w-full bg-amber-400 text-lg text-slate-900"
                    data-coop-start
                    @click=${() => this.startAsHost()}
                  >
                    ▶ COMEÇAR PARTIDA
                  </button>
                </div>`
              : nothing
          }
          ${
            this.phase === "guest-ready"
              ? html`<div
                  class="mt-4 rounded-lg bg-emerald-500/15 p-3 text-sm text-emerald-200"
                  data-coop-guest-ready
                >
                  ✓ Conectado à sala de ${this.partner}. Aguardando começar…
                  ${this.rtt !== null ? html`· ${Math.round(this.rtt)} ms` : nothing}
                </div>`
              : nothing
          }
          ${
            this.phase === "starting"
              ? html`<p class="mt-4 text-sm text-white/70">Começando…</p>`
              : nothing
          }
          ${
            this.error
              ? html`<p class="mt-3 text-sm text-red-300">${this.error}</p>`
              : nothing
          }
        </div>
      </div>
    `;
  }
}

export function openCoopLobby() {
  if (!document.querySelector("moworld-coop-lobby")) {
    document.body.appendChild(document.createElement("moworld-coop-lobby"));
  }
}
