// MoWorld: aviso grande quando alguém começa a te atacar.
//
// A lista de ataques do canto já mostra os ataques recebidos, mas é pequena e
// fácil de não ver. Quando aparece um ataque NOVO contra você (de nação ou
// jogador; tribos ficam só na lista), este aviso aparece no topo por alguns
// segundos. Tocar nele leva a câmera até o ataque.
import { renderTroops } from "@openfront/engine-lib/Format";
import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { AttackUpdate } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { GoToPlayerEvent, GoToPositionEvent } from "../../TransformHandler";
import { GameView, PlayerView } from "../../view";

const SHOW_MS = 6000;

@customElement("moworld-attack-alert")
export class AttackAlert extends LitElement implements Controller {
  public game!: GameView;
  public eventBus!: EventBus;

  @state() private attack: AttackUpdate | null = null;
  @state() private others = 0;
  private seen = new Set<string>();
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    const me = this.game.myPlayer();
    if (!me || !me.isAlive() || this.game.inSpawnPhase()) return;
    const incoming = me.incomingAttacks().filter((a) => {
      if (a.retreating) return false;
      const p = this.game.playerBySmallID(a.attackerID);
      return p instanceof PlayerView && p.type() !== PlayerType.Bot;
    });
    const fresh = incoming.filter((a) => !this.seen.has(a.id));
    for (const a of incoming) this.seen.add(a.id);
    if (fresh.length === 0) {
      // Mantém o número de troops atualizado enquanto o aviso está na tela.
      if (this.attack) {
        const cur = incoming.find((a) => a.id === this.attack!.id);
        if (cur) this.attack = cur;
      }
      return;
    }
    // O maior dos ataques novos é o que importa.
    fresh.sort((a, b) => b.troops - a.troops);
    this.attack = fresh[0];
    this.others = incoming.length - 1;
    navigator.vibrate?.([40, 60, 40]);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => (this.attack = null), SHOW_MS);
  }

  private async goTo(a: AttackUpdate) {
    const attacker = this.game.playerBySmallID(a.attackerID);
    this.attack = null;
    if (!(attacker instanceof PlayerView)) return;
    try {
      const clusters = await attacker.attackClusteredPositions(a.id);
      const pos = clusters[0]?.positions[0];
      if (pos) {
        this.eventBus.emit(new GoToPositionEvent(pos.x, pos.y));
        return;
      }
    } catch {
      /* cai no ir até o atacante */
    }
    this.eventBus.emit(new GoToPlayerEvent(attacker));
  }

  render() {
    const a = this.attack;
    if (!a) return nothing;
    const attacker = this.game.playerBySmallID(a.attackerID);
    const name =
      attacker instanceof PlayerView ? attacker.displayName() : "Alguém";
    return html`
      <button
        type="button"
        class="mw-headsup mw-attack-alert pointer-events-auto fixed top-[15%] left-1/2 -translate-x-1/2 z-[800] flex items-center gap-2 rounded-xl border border-red-400/60 bg-red-950/90 px-3 py-2 text-left text-white shadow-[0_6px_18px_rgb(0_0_0/0.5)] backdrop-blur-md ring-2 ring-red-500/40"
        data-moworld-attack-alert
        @click=${() => this.goTo(a)}
      >
        <span class="text-xl leading-none">⚠</span>
        <span class="min-w-0">
          <span class="block text-sm font-black whitespace-nowrap"
            >${name} está te atacando</span
          >
          <span class="block text-[11px] text-red-200 whitespace-nowrap"
            >${renderTroops(a.troops)}
            tropas${this.others > 0 ? ` · +${this.others} ataque(s)` : ""} ·
            toque para ver</span
          >
        </span>
      </button>
    `;
  }
}
