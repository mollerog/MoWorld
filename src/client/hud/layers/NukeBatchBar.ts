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
  @state() private topPx = 0;
  @state() private coarse = true;
  /** MoWorld: aviso curto no lugar das instruções (some em 4 s). */
  @state() private note: string | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(NukeBatchChangedEvent, (e) => {
      this.tiles = e.tiles;
      this.type = e.unitType;
      if (e.note) {
        this.note = e.note;
        navigator.vibrate?.(40);
        if (this.noteTimer) clearTimeout(this.noteTimer);
        this.noteTimer = setTimeout(() => (this.note = null), 4000);
      }
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

  /**
   * Topo da barra de baixo, pelo que se vê dela: o painel e a fileira de
   * construções. A caixa da barra inteira já veio mais alta do que o desenho
   * (o pop-up ficava no meio da tela); a coluna fixa de construções do
   * celular em pé fica de fora, ela não está embaixo.
   */
  private bottomBarTop(): number | null {
    const bar = document.querySelector<HTMLElement>(".moworld-bar");
    if (!bar) return null;
    const box = bar.getBoundingClientRect();
    if (box.height <= 0) return null;
    const tops = [...bar.children]
      .filter((c) => getComputedStyle(c).position !== "fixed")
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.height > 0 && r.width > 0)
      .map((r) => r.top);
    if (tops.length === 0) return box.top;
    // A borda/preenchimento da barra fica uns pixels acima do conteúdo.
    return Math.max(box.top, Math.min(...tops) - 10);
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
    // Tudo em coordenadas de getBoundingClientRect (top), sem innerHeight:
    // com "bottom" a conta dependia da altura da janela e, em alguns PCs, o
    // pop-up ia parar no meio da tela.
    const barTop = this.bottomBarTop() ?? window.innerHeight - 110;
    const own = this.querySelector<HTMLElement>("[data-nuke-bar]");
    const h = own?.getBoundingClientRect().height || 56;
    const top = Math.round(Math.max(8, barTop - h - 8));
    if (top !== this.topPx) this.topPx = top;
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
        data-nuke-bar
        class="fixed left-1/2 -translate-x-1/2 z-[1000] w-[min(94vw,420px)] rounded-2xl border border-red-400/40 bg-slate-950/90 backdrop-blur-sm shadow-2xl px-3 py-2 flex items-center gap-2 text-white"
        style="top:${this.topPx}px; ${this.topPx === 0 ? "visibility:hidden" : ""}"
      >
        <div class="flex-1 min-w-0 leading-tight">
          <div class="text-sm font-extrabold truncate">
            🎯 ${NAMES[this.mode] ?? "Bomba"}
          </div>
          <div
            class="text-[11px] ${this.note ? "text-sky-300 font-bold" : "text-slate-400"}"
          >
            ${
              this.note
                ? this.note
                : n === 0
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
