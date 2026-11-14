// MoWorld: avisos da partida "jogando junto" — pedido de pausa/despausa do
// outro jogador (aceitar/recusar), "aguardando" para quem pediu, recusa e
// queda da ligação.
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { homeHref } from "../Utils";
import {
  answerPauseVote,
  PAUSE_VOTE_EVENT,
  PauseVoteState,
  PEER_LOST_EVENT,
  peerSession,
} from "../peer/PeerSession";

@customElement("moworld-coop-overlay")
export class CoopOverlay extends LitElement {
  @state() private vote: PauseVoteState | null = null;
  @state() private lost = false;
  private hideTimer = 0;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(PAUSE_VOTE_EVENT, this.onVote);
    window.addEventListener(PEER_LOST_EVENT, this.onLost);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(PAUSE_VOTE_EVENT, this.onVote);
    window.removeEventListener(PEER_LOST_EVENT, this.onLost);
  }

  private onVote = (e: Event) => {
    const v = (e as CustomEvent<PauseVoteState>).detail;
    window.clearTimeout(this.hideTimer);
    this.vote = v;
    if (v.state === "accepted" || v.state === "refused") {
      this.hideTimer = window.setTimeout(() => (this.vote = null), 2500);
    }
  };

  private onLost = () => {
    if (!document.body.classList.contains("in-game")) return;
    this.lost = true;
  };

  private answer(accept: boolean) {
    answerPauseVote(accept);
    this.vote = null;
  }

  render() {
    const partner = peerSession()?.partnerName ?? "o outro jogador";
    const box =
      "fixed left-1/2 -translate-x-1/2 z-[10050] w-[min(92vw,380px)] rounded-2xl border border-white/15 bg-slate-950/95 p-3 text-white shadow-2xl backdrop-blur-md";
    if (this.lost) {
      return html`<div class="${box} top-1/3" data-coop-lost>
        <div class="text-base font-extrabold">📡 A conexão caiu</div>
        <div class="mt-1 text-sm text-white/70">
          A ligação com ${partner} foi perdida.
          ${
            peerSession()?.role === "host"
              ? "Você pode continuar sozinho; a nação dele(a) fica parada."
              : "Sem o aparelho de quem criou a sala, a partida não continua."
          }
        </div>
        <div class="mt-3 flex gap-2">
          ${
            peerSession()?.role === "host"
              ? html`<button
                  class="flex-1 rounded-xl bg-white/10 px-3 py-2 font-bold"
                  @click=${() => (this.lost = false)}
                >
                  Continuar
                </button>`
              : nothing
          }
          <a
            class="flex-1 rounded-xl bg-amber-400 px-3 py-2 text-center font-extrabold text-slate-900"
            href=${homeHref()}
            >Voltar ao início</a
          >
        </div>
      </div>`;
    }
    const v = this.vote;
    if (!v) return nothing;
    const what = v.paused ? "pausar" : "continuar";
    if (v.state === "ask") {
      return html`<div class="${box} top-24" data-coop-vote>
        <div class="text-base font-extrabold">
          ${v.paused ? "⏸" : "▶"} ${v.from} quer ${what} o jogo
        </div>
        <div class="mt-3 flex gap-2">
          <button
            class="flex-1 rounded-xl bg-white/10 px-3 py-2 font-bold"
            data-coop-vote-no
            @click=${() => this.answer(false)}
          >
            Recusar
          </button>
          <button
            class="flex-1 rounded-xl bg-amber-400 px-3 py-2 font-extrabold text-slate-900"
            data-coop-vote-yes
            @click=${() => this.answer(true)}
          >
            Aceitar
          </button>
        </div>
      </div>`;
    }
    const text =
      v.state === "waiting"
        ? `Aguardando ${partner} aceitar ${v.paused ? "a pausa" : "continuar"}…`
        : v.state === "accepted"
          ? v.paused
            ? "Jogo pausado pelos dois"
            : "Jogo retomado"
          : `${v.by} recusou ${v.paused ? "pausar" : "continuar"}`;
    return html`<div
      class="${box} top-24 text-center text-sm font-bold"
      data-coop-vote-info
    >
      ${text}
    </div>`;
  }
}
