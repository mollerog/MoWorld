// MoWorld: pop-up de alvo para toque rápido no celular.
//
// Toque rápido num inimigo, tribo ou terra livre abre este cartão (nome, tipo,
// tropas, % do território e os botões Atacar / Barco / Aliança). Segurar o
// dedo continua abrindo o menu circular com todas as opções.
import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerActions,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderTroops } from "@openfront/engine-lib/Format";
import { EventBus, GameEvent } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { CloseViewEvent, ContextMenuEvent } from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import { UIState } from "../../UIState";
import { GameView, PlayerView } from "../../view";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { CloseRadialMenuEvent } from "./RadialMenu";

/** Toque rápido (sem segurar) num ponto do mapa que não é seu. */
export class TapTargetEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

type Target = {
  tile: TileRef;
  owner: PlayerView | null; // null = terra livre
  actions: PlayerActions;
};

@customElement("moworld-target-popup")
export class TargetPopup extends LitElement implements Controller {
  public game!: GameView;
  public eventBus!: EventBus;
  public transform!: TransformHandler;
  public uiState!: UIState;

  private handler!: PlayerActionHandler;
  private request: object | null = null;

  @state() private target: Target | null = null;
  @state() private bottomPx = 120;

  createRenderRoot() {
    return this;
  }

  init() {
    this.handler = new PlayerActionHandler(this.eventBus, this.uiState);
    this.eventBus.on(TapTargetEvent, (e) => this.open(e.x, e.y));
    this.eventBus.on(ContextMenuEvent, () => this.close());
    this.eventBus.on(CloseViewEvent, () => this.close());
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    const t = this.target;
    if (!t) return;
    const me = this.game.myPlayer();
    const owner = this.game.owner(t.tile);
    // Conquistou o alvo (ou morreu): fecha.
    if (
      me === null ||
      !me.isAlive() ||
      (owner.isPlayer() && (owner as PlayerView).id() === me.id())
    ) {
      this.close();
      return;
    }
    this.requestUpdate(); // números (tropas, %) mudam a cada tick
  }

  private open(x: number, y: number) {
    const me = this.game.myPlayer();
    if (me === null) return;
    const cell = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const tile = this.game.ref(cell.x, cell.y);
    const ownerRaw = this.game.owner(tile);
    const owner = ownerRaw.isPlayer() ? (ownerRaw as PlayerView) : null;

    // Fica logo acima da barra de baixo, seja qual for o layout.
    // (e acima da lista de ataques em andamento, se houver).
    let top = window.innerHeight - 110;
    for (const sel of [".moworld-bar", "attacks-display"]) {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      if (r && r.height > 0) top = Math.min(top, r.top);
    }
    this.bottomPx = Math.max(8, window.innerHeight - top + 8);

    // Segundo toque no mesmo alvo (mesma tribo/nação/jogador, ou terra livre
    // de novo) com o pop-up aberto: ataca direto e mantém o pop-up.
    const cur = this.target;
    if (
      cur !== null &&
      (cur.owner?.id() ?? null) === (owner?.id() ?? null) &&
      (cur.actions.canAttack || this.canBoat(cur.actions))
    ) {
      if (cur.actions.canAttack) this.attack();
      else this.boat();
      return;
    }

    const request = {};
    this.request = request;
    me.actions(tile)
      .then((actions) => {
        if (this.request !== request) return;
        this.target = { tile, owner, actions };
      })
      .catch((err) => console.warn("TargetPopup: actions failed", err));
  }

  private close() {
    this.request = null;
    this.target = null;
    this.feedback = null;
  }

  private sendTroops(): number {
    const me = this.game.myPlayer();
    return me ? Math.floor(me.troops() * this.uiState.attackRatio) : 0;
  }

  private attack() {
    const t = this.target;
    const me = this.game.myPlayer();
    if (!t || !me) return;
    const sent = this.sendTroops();
    this.handler.handleAttack(me, t.owner?.id() ?? null);
    this.eventBus.emit(new CloseRadialMenuEvent());
    this.flash(`✓ ${renderTroops(sent)} tropas enviadas`);
  }

  private canBoat(actions: PlayerActions): boolean {
    return actions.buildableUnits.some(
      (u) => u.type === UnitType.TransportShip && u.canBuild,
    );
  }

  /** Mensagem curta no rodapé do pop-up (ex.: tropas enviadas). */
  private feedback: string | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private flash(text: string) {
    this.feedback = text;
    this.requestUpdate();
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => {
      this.feedback = null;
      this.requestUpdate();
    }, 1600);
  }

  private boat() {
    const t = this.target;
    const me = this.game.myPlayer();
    if (!t || !me) return;
    const sent = this.sendTroops();
    this.handler.handleBoatAttack(me, t.tile);
    this.flash(`⛵ ${renderTroops(sent)} tropas a caminho`);
  }

  private ally() {
    const t = this.target;
    const me = this.game.myPlayer();
    if (!t?.owner || !me) return;
    this.handler.handleAllianceRequest(me, t.owner);
    this.close();
  }

  private typeLabel(owner: PlayerView | null): string {
    if (owner === null) return "Terra livre";
    switch (owner.type()) {
      case PlayerType.Bot:
        return "Tribo";
      case PlayerType.Nation:
        return "Nação";
      default:
        return "Jogador";
    }
  }

  render() {
    const t = this.target;
    if (!t) return nothing;
    const me = this.game.myPlayer();
    if (!me) return nothing;
    const owner = t.owner;
    const sending = this.sendTroops();
    const land = Math.max(
      this.game.numLandTiles() - this.game.numTilesWithFallout(),
      1,
    );
    const share = owner ? (owner.numTilesOwned() / land) * 100 : 0;
    const allied = owner !== null && me.isFriendly(owner);
    const traitor = owner?.isTraitor() ?? false;
    const canAttack = t.actions.canAttack;
    const canBoat = this.canBoat(t.actions);
    const canAlly =
      owner !== null &&
      !allied &&
      (t.actions.interaction?.canSendAllianceRequest ?? false);
    const outnumbered = owner !== null && owner.troops() > sending;
    const color = owner ? owner.territoryColor().toHex() : "#94a3b8";

    const badge = allied
      ? ["ALIADO", "bg-green-500/15 text-green-300 border-green-400/30"]
      : traitor
        ? ["TRAIDOR", "bg-red-500/15 text-red-300 border-red-400/30"]
        : owner === null
          ? ["LIVRE", "bg-white/5 text-slate-300 border-white/15"]
          : ["NEUTRO", "bg-white/5 text-slate-300 border-white/15"];

    const primary =
      "flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-amber-400 text-slate-900 font-black tracking-wider shadow-[0_4px_0_#b45309] active:translate-y-0.5 active:shadow-[0_2px_0_#b45309] disabled:opacity-40 disabled:pointer-events-none";
    const secondary =
      "flex items-center justify-center gap-2 h-12 px-4 rounded-xl border border-white/15 bg-white/5 text-white font-bold active:bg-white/10";

    return html`
      <div
        class="fixed left-2 z-[300] w-[min(360px,calc(100vw-1rem))] rounded-2xl border border-white/10 bg-slate-950/90 p-3 text-white shadow-[0_10px_30px_rgb(0_0_0/0.45)] backdrop-blur-md"
        style="bottom:${this.bottomPx}px; border-left: 4px solid ${color};"
        data-moworld-target-popup
        @pointerdown=${(e: Event) => e.stopPropagation()}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div class="flex items-center gap-2">
          <span
            class="size-3 shrink-0 rounded-sm"
            style="background:${color}"
          ></span>
          <span class="min-w-0 flex-1 truncate text-lg font-black"
            >${owner ? owner.displayName() : "Terra livre"}</span
          >
          <span
            class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-extrabold tracking-wider ${badge[1]}"
            >${badge[0]}</span
          >
          <button
            type="button"
            aria-label="Fechar"
            class="ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
            @click=${() => this.close()}
          >
            ✕
          </button>
        </div>
        <div class="mt-1 text-sm text-slate-300">
          ${owner ? this.typeLabel(owner) : "Sem dono · expandir não tem resistência"}${
            owner
              ? html` · ${renderTroops(owner.troops())} tropas ·
                  ${share < 0.01 ? "<0.01" : share.toFixed(2)}% território`
              : nothing
          }
        </div>
        ${
          outnumbered && !allied && canAttack
            ? html`<div class="mt-1 text-sm font-semibold text-orange-400">
                Eles têm mais tropas que as ${renderTroops(sending)} que você
                enviaria
              </div>`
            : nothing
        }
        <div class="mt-3 flex gap-2">
          ${
            allied
              ? html`<div
                  class="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300"
                >
                  Aliado. Segure no mapa para doar tropas ou ouro.
                </div>`
              : canAttack
                ? html`<button
                    type="button"
                    class=${primary}
                    data-moworld-attack
                    @click=${() => this.attack()}
                  >
                    ⚔ ${owner ? "Atacar" : "Expandir"} ·
                    ${renderTroops(sending)}
                  </button>`
                : canBoat
                  ? html`<button
                      type="button"
                      class=${primary}
                      data-moworld-boat
                      @click=${() => this.boat()}
                    >
                      ⛵ Barco · ${renderTroops(sending)}
                    </button>`
                  : html`<button type="button" class=${primary} disabled>
                      Fora de alcance
                    </button>`
          }
          ${
            canAlly
              ? html`<button
                  type="button"
                  class=${secondary}
                  data-moworld-ally
                  @click=${() => this.ally()}
                >
                  🤝 Aliança
                </button>`
              : nothing
          }
        </div>
        <div
          class="mt-2 text-center text-[11px] ${
            this.feedback ? "font-bold text-green-400" : "text-white/40"
          }"
        >
          ${this.feedback ?? "Toque de novo no alvo para atacar · segure para mais opções"}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "moworld-target-popup": TargetPopup;
  }
}
