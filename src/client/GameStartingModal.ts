import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "./Utils";

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  createRenderRoot() {
    return this;
  }

  render() {
    const isVisible = this.isVisible;
    return html`
      <div
        class="fixed inset-0 bg-black/30 backdrop-blur-[4px] z-[9998] transition-all duration-300 ${
          isVisible ? "opacity-100 visible" : "opacity-0 invisible"
        }"
      ></div>
      <!-- MoWorld: tela de carregamento no visual do app. O crédito ao
           OpenFront e o aviso de licença ficam (exigidos pela AGPL-3.0). -->
      <div
        class="fixed top-1/2 left-1/2 z-[9999] w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 rounded-3xl border border-white/10 bg-slate-950/85 px-6 pt-7 pb-5 text-center text-white shadow-2xl backdrop-blur-md transition-all duration-300 ${
          isVisible
            ? "opacity-100 visible -translate-y-1/2"
            : "opacity-0 invisible -translate-y-[48%]"
        }"
      >
        <div class="moworld-title" style="font-size:2.6rem">MOWORLD</div>
        <div
          class="mt-1 text-[10px] font-bold tracking-[0.4em] text-white/60"
        >
          CONQUISTE O MUNDO REAL
        </div>
        <div class="my-6 flex justify-center" aria-hidden="true">
          <div
            class="size-12 rounded-full border-4 border-white/10 border-t-amber-400 animate-spin"
          ></div>
        </div>
        <p class="text-base font-bold tracking-wide text-white/90">
          Preparando a partida…
        </p>
        <div
          class="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-white/40"
        >
          <span>${translateText("main.copyright")}</span>
          <span aria-hidden="true">·</span>
          <a
            href="https://github.com/mollerog/MoWorld/blob/main/CREDITS.md"
            target="_blank"
            rel="noopener noreferrer"
            class="underline-offset-2 hover:text-white hover:underline"
            >${translateText("game_starting_modal.credits")}</a
          >
          <span aria-hidden="true">·</span>
          <span>${translateText("game_starting_modal.code_license")}</span>
        </div>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}
