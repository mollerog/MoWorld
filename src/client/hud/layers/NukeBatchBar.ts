// MoWorld: lote de bombas (celular e PC).
//
// Com uma bomba selecionada, cada toque no mapa marca um alvo (tocar de novo
// num alvo desmarca). Esta barra mostra quantos alvos há e lança todos de uma
// vez. O modo continua ativo até tocar de novo no botão da bomba.
import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Cell, UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import {
  NukeBatchChangedEvent,
  NukeBatchCommandEvent,
} from "../../controllers/BuildPreviewController";
import { TransformHandler } from "../../TransformHandler";
import { UIState } from "../../UIState";
import { GameView } from "../../view";

const NUKES = new Set<UnitType>([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
]);
const NAMES: Partial<Record<UnitType, string>> = {
  [UnitType.AtomBomb]: "Bomba atômica",
  [UnitType.HydrogenBomb]: "Bomba de hidrogênio",
  [UnitType.MIRV]: "MIRV",
};

@customElement("moworld-nuke-batch")
export class NukeBatchBar extends LitElement implements Controller {
  public game!: GameView;
  public eventBus!: EventBus;
  public transform!: TransformHandler;
  public uiState!: UIState;

  @state() private tiles: readonly TileRef[] = [];
  @state() private type: UnitType | null = null;
  @state() private mode: UnitType | null = null;
  @state() private bottomPx = 120;
  @state() private coarse = true;
  private raf = 0;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(NukeBatchChangedEvent, (e) => {
      this.tiles = e.tiles;
      this.type = e.unitType;
    });
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.raf);
  }

  private frame() {
    const g = this.uiState?.ghostStructure ?? null;
    const mode = g !== null && NUKES.has(g) ? g : null;
    this.coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    if (mode !== this.mode) {
      this.mode = mode;
      // Saiu do modo bomba (ou trocou de bomba): descarta os alvos marcados.
      if (this.tiles.length > 0 && mode !== this.type) {
        this.eventBus.emit(new NukeBatchCommandEvent(false));
      }
    }
    if (this.mode === null) return;
    let top = window.innerHeight - 110;
    const r = document.querySelector(".moworld-bar")?.getBoundingClientRect();
    if (r && r.height > 0) top = Math.min(top, r.top);
    const bottom = Math.max(8, window.innerHeight - top + 8);
    if (bottom !== this.bottomPx) this.bottomPx = bottom;
    // Marcadores seguem o mapa (arrastar/zoom) a cada quadro.
    const marks = this.querySelectorAll<HTMLElement>("[data-nuke-mark]");
    marks.forEach((el, i) => {
      const t = this.tiles[i];
      if (t === undefined) return;
      const p = this.transform.worldToScreenCoordinates(
        new Cell(this.game.x(t), this.game.y(t)),
      );
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    });
  }

  render() {
    if (this.mode === null) return nothing;
    const n = this.tiles.length;
    return html`
      ${this.tiles.map(
        (_t, i) =>
          html`<div
            data-nuke-mark
            class="fixed left-0 top-0 z-[30] pointer-events-none"
            style="transform: translate(-999px,-999px)"
          >
            <div
              class="-translate-x-1/2 -translate-y-1/2 size-7 rounded-full border-2 border-red-500 bg-red-500/25 flex items-center justify-center text-[11px] font-extrabold text-white shadow-[0_0_10px_rgba(239,68,68,0.8)]"
            >
              ${i + 1}
            </div>
          </div>`,
      )}
      <div
        class="fixed left-1/2 -translate-x-1/2 z-[1000] w-[min(94vw,420px)] rounded-2xl border border-red-400/40 bg-slate-950/90 backdrop-blur-sm shadow-2xl px-3 py-2 flex items-center gap-2 text-white"
        style="bottom:${this.bottomPx}px"
      >
        <div class="flex-1 min-w-0 leading-tight">
          <div class="text-sm font-extrabold truncate">
            🎯 ${NAMES[this.mode] ?? "Bomba"}
          </div>
          <div class="text-[11px] text-slate-400">
            ${
              n === 0
                ? this.coarse
                  ? "Toque nos alvos · tocar de novo desmarca"
                  : "Clique nos alvos · clicar de novo desmarca · Enter lança"
                : `${n} alvo${n > 1 ? "s" : ""} · lança só o que o ouro e os silos permitirem`
            }
          </div>
        </div>
        ${
          n > 0
            ? html`<button
                  type="button"
                  class="shrink-0 rounded-lg border border-white/15 px-2.5 py-2 text-xs font-bold text-slate-300 active:bg-white/10"
                  @click=${() =>
                    this.eventBus.emit(new NukeBatchCommandEvent(false))}
                >
                  Limpar
                </button>
                <button
                  type="button"
                  class="shrink-0 rounded-lg bg-red-500 px-3 py-2 text-sm font-extrabold text-white shadow-[0_3px_0_#991b1b] active:translate-y-px"
                  @click=${() =>
                    this.eventBus.emit(new NukeBatchCommandEvent(true))}
                >
                  🚀 LANÇAR ${n}
                </button>`
            : nothing
        }
      </div>
    `;
  }
}
