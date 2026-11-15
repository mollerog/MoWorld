// MoWorld: pop-up de alvo (compacto, canto de cima à esquerda).
//
// Toque num inimigo, tribo ou terra livre abre este cartão: nome, tropas,
// % do território, quanto você envia e se o ataque é forte/equilibrado/fraco,
// com Atacar (ou Barco) e Aliança. Segundo toque no mesmo alvo ataca e fecha.
// Segurar o dedo continua abrindo o menu circular.
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
  @state() private topPx = 64;
  @state() private leftPx = 8;
  @state() private widthPx = 250;

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

    this.place();

    // Segundo toque no mesmo alvo (mesma tribo/nação/jogador, ou terra livre
    // de novo): ataca direto e fecha o pop-up — o ataque já foi a resposta.
    const key = owner?.id() ?? null;
    const cur = this.target;
    if (
      cur !== null &&
      (cur.owner?.id() ?? null) === key &&
      (cur.actions.canAttack || this.canBoat(cur.actions))
    ) {
      this.attackAndClose(cur);
      return;
    }
    // Toque duplo rápido: o primeiro ainda nem abriu o pop-up. Marca a
    // consulta em andamento para atacar assim que ela voltar, sem abrir.
    const pending = this.request as {
      key: string | null;
      auto?: boolean;
    } | null;
    if (cur === null && pending !== null && pending.key === key) {
      pending.auto = true;
      return;
    }

    const request: { key: string | null; auto?: boolean } = { key };
    this.request = request;
    me.actions(tile)
      .then((actions) => {
        if (this.request !== request) return;
        const target = { tile, owner, actions };
        if (request.auto && (actions.canAttack || this.canBoat(actions))) {
          this.attackAndClose(target);
          return;
        }
        this.target = target;
      })
      .catch((err) => console.warn("TargetPopup: actions failed", err));
  }

  private attackAndClose(t: Target) {
    this.target = t;
    if (t.actions.canAttack) this.attack();
    else this.boat();
    this.close();
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

  /**
   * Fica no canto de cima à esquerda, logo abaixo do painel com os botões
   * de visão/placar (e abaixo do card de status se ele estiver por cima).
   */
  private place() {
    const left = document
      .querySelector("game-left-sidebar .bg-gray-800\\/92")
      ?.getBoundingClientRect();
    let top = left && left.height > 0 ? left.bottom : 56;
    const leftX = left && left.width > 0 ? left.left : 8;
    const bar = document
      .querySelector("moworld-control-bar > div")
      ?.getBoundingClientRect();
    // Se o card de status estiver na mesma faixa, o pop-up encolhe para
    // caber ao lado dele; sem espaço, desce para baixo do card.
    let width = 250;
    if (bar && bar.height > 0 && bar.top < top + 8 + 90) {
      const avail = Math.floor(bar.left - 6 - leftX);
      if (avail >= 190) width = Math.min(250, avail);
      else top = Math.max(top, bar.bottom);
    }
    this.widthPx = width;
    this.topPx = Math.round(top + 8);
    this.leftPx = Math.round(leftX);
  }

  private ally() {
    const me = this.game.myPlayer();
    const t = this.target;
    if (!me || !t?.owner) return;
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
    const color = owner ? owner.territoryColor().toHex() : "#94a3b8";
    const theirs = owner?.troops() ?? 0;
    // Força do ataque: tropas enviadas contra as tropas deles.
    const ratio = theirs > 0 ? sending / theirs : Infinity;
    const strength =
      owner === null
        ? ["sem resistência", "text-emerald-300"]
        : ratio >= 1.5
          ? ["ataque forte", "text-emerald-300"]
          : ratio >= 0.8
            ? ["ataque equilibrado", "text-amber-300"]
            : ["ataque fraco", "text-red-300"];

    const btn =
      "flex-1 flex items-center justify-center gap-1 h-8 rounded-lg bg-amber-400 text-slate-900 text-xs font-black shadow-[0_2px_0_#b45309] active:translate-y-px disabled:opacity-40 disabled:pointer-events-none";

    return html`
      <div
        class="fixed z-[300] max-w-[calc(100vw-1rem)] rounded-xl border border-white/10 bg-slate-950/90 px-2.5 py-2 text-white shadow-[0_6px_18px_rgb(0_0_0/0.45)] backdrop-blur-md"
        style="top:${this.topPx}px; left:${this.leftPx}px; width:${this.widthPx}px; border-left: 3px solid ${color};"
        data-moworld-target-popup
        @pointerdown=${(e: Event) => e.stopPropagation()}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div class="flex items-center gap-1.5">
          <span class="min-w-0 flex-1 truncate text-sm font-black"
            >${owner ? owner.displayName() : "Terra livre"}</span
          >
          ${
            allied
              ? html`<span
                  class="shrink-0 rounded-full bg-green-500/15 px-1.5 text-[9px] font-extrabold text-green-300"
                  >ALIADO</span
                >`
              : traitor
                ? html`<span
                    class="shrink-0 rounded-full bg-red-500/15 px-1.5 text-[9px] font-extrabold text-red-300"
                    >TRAIDOR</span
                  >`
                : nothing
          }
          <button
            type="button"
            aria-label="Fechar"
            class="-mr-1 flex size-6 shrink-0 items-center justify-center rounded text-xs text-white/50 hover:bg-white/10 hover:text-white"
            @click=${() => this.close()}
          >
            ✕
          </button>
        </div>
        <div class="text-[11px] text-slate-400">
          ${this.typeLabel(owner)}${
            owner
              ? html` ·
                  <span class="font-bold text-white"
                    >${renderTroops(theirs)}</span
                  >
                  tropas · ${share < 0.01 ? "<0.01" : share.toFixed(2)}%`
              : nothing
          }
        </div>
        ${
          !allied && (canAttack || canBoat)
            ? html`<div class="mt-0.5 text-[11px] ${strength[1]}">
                Você envia
                <span class="font-bold">${renderTroops(sending)}</span>
                · ${strength[0]}
              </div>`
            : nothing
        }
        <div class="mt-1.5 flex gap-1.5">
          ${
            allied
              ? html`<div class="flex-1 text-[11px] text-slate-400">
                  Segure no mapa para doar tropas ou ouro.
                </div>`
              : canAttack
                ? html`<button
                    type="button"
                    class=${btn}
                    data-moworld-attack
                    @click=${() => this.attack()}
                  >
                    ⚔ ${owner ? "Atacar" : "Expandir"}
                  </button>`
                : canBoat
                  ? html`<button
                      type="button"
                      class=${btn}
                      data-moworld-boat
                      @click=${() => this.boat()}
                    >
                      ⛵ Barco
                    </button>`
                  : html`<button type="button" class=${btn} disabled>
                      Fora de alcance
                    </button>`
          }
          ${
            canAlly
              ? html`<button
                  type="button"
                  class="flex h-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-2 text-xs font-bold active:bg-white/10"
                  data-moworld-ally
                  title="Pedir aliança"
                  @click=${() => this.ally()}
                >
                  🤝
                </button>`
              : nothing
          }
        </div>
        ${
          this.feedback
            ? html`<div
                class="mt-1 text-center text-[10px] font-bold text-green-400"
              >
                ${this.feedback}
              </div>`
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "moworld-target-popup": TargetPopup;
  }
}
