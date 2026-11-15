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

  private selectedAt = 0;

  tick() {
    const t = this.target;
    if (!t) return;
    // Marcação vence: o segundo toque precisa vir logo depois do primeiro.
    if (Date.now() - this.selectedAt > 6000) {
      this.close();
      return;
    }
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
        this.selectedAt = Date.now();
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

  render() {
    return nothing;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    "moworld-target-popup": TargetPopup;
  }
}
