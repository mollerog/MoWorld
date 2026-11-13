// MoWorld: "Vitória total".
//
// A vitória normal acontece ao chegar a 80% da terra, e o jogo deixa continuar.
// Quando não sobra nenhum adversário vivo (nações, tribos ou jogadores), não há
// mais nada a fazer: esta tela pausa a partida e a encerra, com um resumo e o
// botão para voltar ao início.
import { html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "@openfront/shared/EventBus";
import { Controller } from "../../Controller";
import { PauseGameIntentEvent } from "../../Transport";
import { homeHref } from "../../Utils";
import { GameView } from "../../view";

@customElement("moworld-total-victory")
export class TotalVictory extends LitElement implements Controller {
  public game!: GameView;
  public eventBus!: EventBus;

  private shown = false;
  private summary: { minutes: number; seconds: number; share: number } | null =
    null;

  createRenderRoot() {
    return this;
  }

  getTickIntervalMs() {
    return 500;
  }

  tick() {
    if (this.shown || this.game.inSpawnPhase()) return;
    const me = this.game.myPlayer();
    if (me === null || !me.isAlive()) return;
    const enemiesAlive = this.game
      .players()
      .some((p) => p.id() !== me.id() && p.isAlive());
    if (!enemiesAlive) this.showVictory();
  }

  /** Encerra a partida mostrando a vitória total. */
  public showVictory() {
    if (this.shown) return;
    this.shown = true;
    const me = this.game.myPlayer();
    const land = Math.max(
      this.game.numLandTiles() - this.game.numTilesWithFallout(),
      1,
    );
    const elapsed = Math.floor(this.game.elapsedGameSeconds());
    this.summary = {
      minutes: Math.floor(elapsed / 60),
      seconds: elapsed % 60,
      share: me ? (me.numTilesOwned() / land) * 100 : 100,
    };
    // Para o jogo e tira a tela de vitória comum (80%) da frente.
    this.eventBus.emit(new PauseGameIntentEvent(true));
    (
      document.querySelector("win-modal") as { hide?: () => void } | null
    )?.hide?.();
    this.requestUpdate();
  }

  render() {
    if (!this.shown || !this.summary) return nothing;
    const s = this.summary;
    return html`
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
        data-moworld-total-victory
      >
        <div
          class="w-[min(420px,100%)] rounded-3xl border border-white/10 bg-slate-950/95 px-6 pt-7 pb-5 text-center text-white shadow-2xl"
        >
          <div class="text-5xl" aria-hidden="true">🏆</div>
          <div class="moworld-title mt-2" style="font-size:2.4rem">
            VITÓRIA TOTAL
          </div>
          <p class="mt-3 text-sm text-white/80">
            Você eliminou todos os inimigos e conquistou o mundo. Não há mais
            nada a conquistar — partida encerrada.
          </p>
          <div class="mt-5 grid grid-cols-2 gap-2 text-left">
            <div class="rounded-xl border border-white/10 bg-white/5 p-3">
              <div
                class="text-[10px] font-extrabold tracking-wider text-slate-400"
              >
                TEMPO
              </div>
              <div class="text-lg font-black tabular-nums">
                ${s.minutes}:${String(s.seconds).padStart(2, "0")}
              </div>
            </div>
            <div class="rounded-xl border border-white/10 bg-white/5 p-3">
              <div
                class="text-[10px] font-extrabold tracking-wider text-slate-400"
              >
                TERRITÓRIO
              </div>
              <div class="text-lg font-black tabular-nums text-amber-400">
                ${s.share >= 99.95 ? "100" : s.share.toFixed(1)}%
              </div>
            </div>
          </div>
          <button
            type="button"
            data-moworld-total-victory-home
            class="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-amber-400 text-base font-black tracking-wider text-slate-900 shadow-[0_4px_0_#b45309] active:translate-y-0.5 active:shadow-[0_2px_0_#b45309]"
            @click=${() => (window.location.href = homeHref())}
          >
            VOLTAR AO INÍCIO
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "moworld-total-victory": TotalVictory;
  }
}
