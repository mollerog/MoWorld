// MoWorld: lista de desafios do solo, com as estrelas e o melhor tempo de
// cada um. "Jogar" começa a partida pelo modal do solo (startChallenge).
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  CHALLENGES,
  ChallengeDef,
  formatMinutes,
  loadRecords,
  totalStars,
} from "../challenges/Challenges";
import { whenModalLoaded } from "../LazyModals";
import type { SinglePlayerModal } from "../SinglePlayerModal";

const DIFFICULTY_PT: Record<string, string> = {
  Easy: "Fácil",
  Medium: "Médio",
  Hard: "Difícil",
  Impossible: "Impossível",
};

function stars(n: number) {
  return html`<span class="tracking-tight" aria-label="${n} de 3 estrelas"
    >${[1, 2, 3].map((i) =>
      i <= n
        ? html`<span class="text-amber-300">★</span>`
        : html`<span class="text-white/20">★</span>`,
    )}</span
  >`;
}

@customElement("moworld-challenges")
export class ChallengesModal extends LitElement {
  @state() private records = loadRecords();

  createRenderRoot() {
    return this;
  }

  private close() {
    this.remove();
  }

  private play(def: ChallengeDef) {
    this.close();
    whenModalLoaded("single-player-modal", () => {
      const modal = document.querySelector(
        "single-player-modal",
      ) as SinglePlayerModal | null;
      void modal?.startChallenge(def);
    });
  }

  render() {
    const total = totalStars(this.records);
    return html`
      <div
        class="fixed inset-0 z-[20000] flex items-center justify-center bg-black/70 p-3"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div
          class="flex max-h-[92vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-white shadow-2xl"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-extrabold">🏆 Desafios</h2>
            <div class="flex items-center gap-3">
              <span class="text-sm font-bold text-amber-300" data-total-stars
                >★ ${total} / ${CHALLENGES.length * 3}</span
              >
              <button
                class="px-2 text-xl text-white/60"
                @click=${() => this.close()}
              >
                ✕
              </button>
            </div>
          </div>
          <p class="mt-1 text-xs text-white/55">
            Regras e opções fixas. Vencer vale ★; vencer rápido (em tempo de
            jogo) vale ★★ e ★★★.
          </p>
          <div class="mt-3 flex flex-col gap-2 overflow-y-auto">
            ${CHALLENGES.map((c) => {
              const r = this.records[c.id];
              return html`<div
                class="rounded-xl border border-white/10 bg-white/5 p-3"
                data-challenge=${c.id}
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="font-extrabold">${c.emoji} ${c.title}</div>
                    <div class="mt-0.5 text-xs text-white/65">${c.rule}</div>
                  </div>
                  <div class="shrink-0 text-lg leading-none">
                    ${stars(r?.stars ?? 0)}
                  </div>
                </div>
                <div class="mt-2 flex items-center justify-between gap-2">
                  <div class="text-[11px] text-white/50">
                    ${DIFFICULTY_PT[c.difficulty] ?? c.difficulty} · ★★ &lt;
                    ${c.twoStarsMin} min · ★★★ &lt; ${c.threeStarsMin} min
                    ${
                      r
                        ? html`<br />Melhor:
                            <span class="font-bold text-white/80"
                              >${formatMinutes(r.bestSeconds)}</span
                            >`
                        : nothing
                    }
                  </div>
                  <button
                    class="shrink-0 rounded-xl bg-amber-400 px-4 py-2 text-sm font-extrabold text-slate-900 active:translate-y-px"
                    data-challenge-play=${c.id}
                    @click=${() => this.play(c)}
                  >
                    Jogar
                  </button>
                </div>
              </div>`;
            })}
          </div>
        </div>
      </div>
    `;
  }
}

export function openChallenges() {
  if (!document.querySelector("moworld-challenges")) {
    document.body.appendChild(document.createElement("moworld-challenges"));
  }
}
