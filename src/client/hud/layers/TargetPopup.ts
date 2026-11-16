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
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
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
  /** Dá para chegar nesse pedaço por terra (ataque comum) ou só de barco. */
  byLand: boolean;
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
    if (cur !== null && (cur.owner?.id() ?? null) === key) {
      // Aliado: o segundo toque não ataca; o pop-up mostra as doações.
      if (cur.owner && me.isFriendly(cur.owner)) return;
      // Pode ser outra ilha da mesma nação: vale o lugar do segundo toque.
      const byLand = this.byLand(tile);
      if (byLand || tile === cur.tile) {
        this.attackAndClose({ ...cur, tile, byLand });
        return;
      }
      // Outro pedaço (ilha) da mesma nação: as ações do primeiro toque são
      // do continente (lá o barco nem sempre vale). Pergunta de novo para
      // este lugar, senão o barco não sai enquanto o ataque por terra roda.
      const request: { key: string | null; auto?: boolean } = {
        key,
        auto: true,
      };
      this.request = request;
      me.actions(tile)
        .then((actions) => {
          if (this.request !== request) return;
          this.attackAndClose({ tile, owner, actions, byLand });
        })
        .catch((err) => console.warn("TargetPopup: actions failed", err));
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
        const target = { tile, owner, actions, byLand: this.byLand(tile) };
        if (request.auto) {
          this.attackAndClose(target);
          return;
        }
        this.target = target;
      })
      .catch((err) => console.warn("TargetPopup: actions failed", err));
  }

  private attackAndClose(t: Target) {
    const me = this.game.myPlayer();
    const sent = this.sendTroops();
    const canBoat = this.canBoat(t.actions);
    if (this.useLand(t)) {
      this.target = t;
      this.attack();
      this.close();
      this.toast(`⚔ ${renderTroops(sent)} tropas enviadas`, "ok");
      return;
    }
    if (canBoat) {
      this.target = t;
      this.boat();
      this.close();
      this.toast(`⛵ ${renderTroops(sent)} tropas a caminho`, "ok");
      return;
    }
    // Não deu: diz o porquê em vez de não fazer nada.
    this.close();
    const max = 3; // boatMaxNumber() do motor (EngineConfig)
    const boats = me ? me.units(UnitType.TransportShip).length : 0;
    if (!t.byLand && boats >= max) {
      this.toast(
        `⛵ Limite de ${max} barcos no mar — espere um chegar`,
        "warn",
      );
    } else {
      this.toast("Fora de alcance", "warn");
    }
  }

  // ---- aviso curto depois do toque duplo (o pop-up já fechou) ----
  @state() private toastText: string | null = null;
  @state() private toastKind: "ok" | "warn" = "ok";
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toast(text: string, kind: "ok" | "warn") {
    this.toastText = text;
    this.toastKind = kind;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => (this.toastText = null),
      kind === "ok" ? 1300 : 2200,
    );
    if (kind === "ok") navigator.vibrate?.(12);
  }

  private renderToast() {
    if (!this.toastText) return nothing;
    return html`<div
      class="pointer-events-none fixed z-[300] rounded-lg border px-2.5 py-1.5 text-xs font-bold shadow-lg backdrop-blur-md ${
        this.toastKind === "ok"
          ? "border-emerald-400/30 bg-slate-950/90 text-emerald-300"
          : "border-amber-400/40 bg-slate-950/90 text-amber-300"
      }"
      style="top:${this.topPx}px; left:${this.leftPx}px;"
      data-moworld-tap-toast
    >
      ${this.toastText}
    </div>`;
  }

  /** Ataque por terra só quando esse pedaço encosta no seu território. */
  private useLand(t: Target): boolean {
    return t.actions.canAttack && t.byLand;
  }

  /**
   * O pedaço tocado (terras contínuas do mesmo dono) encosta no meu
   * território? Se não, é ilha/outro continente: precisa de barco — atacar
   * "por terra" só avançaria pela fronteira que já existe em outro lugar.
   */
  private byLand(tile: TileRef): boolean {
    const me = this.game.myPlayer();
    if (!me) return false;
    const g = this.game;
    const owner = g.owner(tile);
    const ownerId = owner.isPlayer() ? owner.id() : null;
    const same = (t: TileRef) => {
      if (!g.isLand(t)) return false;
      const o = g.owner(t);
      return (o.isPlayer() ? o.id() : null) === ownerId;
    };
    const seen = new Set<TileRef>([tile]);
    const queue: TileRef[] = [tile];
    // Limite para continentes grandes: aí com certeza é ataque por terra
    // se você já faz fronteira (o jogo decide pela fronteira).
    while (queue.length > 0 && seen.size < 40_000) {
      const t = queue.pop()!;
      for (const n of g.neighbors(t)) {
        if (seen.has(n)) continue;
        const o = g.owner(n);
        if (o.isPlayer() && o.id() === me.id()) return true;
        if (same(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen.size >= 40_000;
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

  // Aliado: doar tropas (a % de ataque escolhida) ou 1/3 do ouro.
  private donateTroops() {
    const t = this.target;
    if (!t?.owner) return;
    const amount = this.sendTroops();
    this.handler.handleDonateTroops(t.owner, amount);
    this.close();
    this.toast(`🪖 ${renderTroops(amount)} tropas doadas`, "ok");
  }

  private donateGold() {
    const me = this.game.myPlayer();
    const t = this.target;
    if (!me || !t?.owner) return;
    const amount = me.gold() / 3n;
    this.handler.handleDonateGold(t.owner);
    this.close();
    this.toast(`💰 ${renderNumber(amount)} de ouro doado`, "ok");
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
    if (!t) return this.renderToast();
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
    // Ilha/outro pedaço sem fronteira com você: o botão vira Barco.
    const canAttack = this.useLand(t);
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
              ? html`<button
                    type="button"
                    class="flex-1 flex items-center justify-center gap-1 h-8 rounded-lg bg-sky-500 text-white text-xs font-black shadow-[0_2px_0_#075985] active:translate-y-px disabled:opacity-40"
                    data-moworld-donate-troops
                    ?disabled=${!(t.actions.interaction?.canDonateTroops ?? false)}
                    @click=${() => this.donateTroops()}
                  >
                    🪖 Doar ${renderTroops(sending)}
                  </button>
                  <button
                    type="button"
                    class="flex-1 flex items-center justify-center gap-1 h-8 rounded-lg bg-amber-400 text-slate-900 text-xs font-black shadow-[0_2px_0_#b45309] active:translate-y-px disabled:opacity-40"
                    data-moworld-donate-gold
                    title="Doa 1/3 do seu ouro"
                    ?disabled=${!(t.actions.interaction?.canDonateGold ?? false)}
                    @click=${() => this.donateGold()}
                  >
                    💰 Doar ${renderNumber(me.gold() / 3n)}
                  </button>`
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
