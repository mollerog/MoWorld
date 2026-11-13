// MoWorld: contador de controle no topo da partida (inspirado no Roblox).
//
// Mostra: tempo de posicionamento/proteção (enquanto houver), a sua % da
// terra numa barra até a meta de vitória (80%, ou menor com prorrogação), a
// sua posição no ranking e o principal rival (o 1º lugar, ou o 2º quando o
// 1º é você).
import { renderNumber } from "@openfront/engine-lib/Format";
import { html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { GameView, PlayerView } from "../../view";

type Snapshot = {
  myShare: number;
  myRank: number;
  myColor: string;
  goal: number;
  rival: { name: string; share: number; color: string; first: boolean } | null;
  chip: { icon: string; label: string; seconds: number } | null;
};

@customElement("moworld-control-bar")
export class ControlBar extends LitElement implements Controller {
  public game!: GameView;

  private snap: Snapshot | null = null;

  createRenderRoot() {
    return this;
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    const me = this.game.myPlayer();
    if (me === null || !me.isAlive()) {
      if (this.snap !== null) {
        this.snap = null;
        this.requestUpdate();
      }
      return;
    }
    const cfg = this.game.config();
    const land = Math.max(
      this.game.numLandTiles() - this.game.numTilesWithFallout(),
      1,
    );
    const players = this.game
      .players()
      .filter((p) => p.isAlive())
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    const myRank = players.findIndex((p) => p.id() === me.id()) + 1;
    const first = players[0];
    const rivalPlayer: PlayerView | undefined =
      first && first.id() !== me.id() ? first : players[1];

    // Posicionamento (fase inicial) e depois a proteção pós-nascimento.
    const ticks = this.game.ticks();
    const spawnTurns = cfg.numSpawnPhaseTurns();
    let chip: Snapshot["chip"] = null;
    if (this.game.inSpawnPhase()) {
      chip = {
        icon: "⏳",
        label: "Posicione",
        seconds: Math.max(0, (spawnTurns - ticks) / 10),
      };
    } else {
      const left = spawnTurns + cfg.spawnImmunityDuration() - ticks;
      if (left > 0) {
        chip = { icon: "🛡", label: "Proteção", seconds: left / 10 };
      }
    }

    this.snap = {
      myShare: (me.numTilesOwned() / land) * 100,
      myRank: myRank || players.length,
      myColor: me.territoryColor().toHex(),
      goal: cfg.percentageTilesOwnedToWin(this.game.elapsedGameSeconds()),
      rival: rivalPlayer
        ? {
            name: rivalPlayer.displayName(),
            share: (rivalPlayer.numTilesOwned() / land) * 100,
            color: rivalPlayer.territoryColor().toHex(),
            first: rivalPlayer === first,
          }
        : null,
      chip,
    };
    this.requestUpdate();
  }

  private pct(v: number): string {
    if (v > 0 && v < 0.01) return "<0.01%";
    return v < 10 ? `${v.toFixed(2)}%` : `${v.toFixed(1)}%`;
  }

  private clock(seconds: number): string {
    const s = Math.ceil(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  render() {
    const s = this.snap;
    if (!s) return nothing;
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    return html`
      <div
        class="moworld-control-bar pointer-events-none rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-1.5 text-white shadow-[0_10px_30px_rgb(0_0_0/0.4)] backdrop-blur-sm"
        translate="no"
      >
        <div class="flex items-center gap-2 text-[10px] font-extrabold tracking-wider">
          ${
            s.chip
              ? html`<span
                  class="flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-emerald-300 tabular-nums"
                  >${s.chip.icon} ${s.chip.label}
                  ${this.clock(s.chip.seconds)}</span
                >`
              : nothing
          }
          <span class="text-slate-400">CONTROLE</span>
          <span class="tabular-nums text-white"
            >#${renderNumber(s.myRank)} · ${this.pct(s.myShare)}</span
          >
          <span class="ml-auto text-amber-400 tabular-nums"
            >META ${s.goal}%</span
          >
        </div>
        <div class="relative mt-1 h-2 rounded-full bg-white/10">
          <div
            class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
            style="width:max(3px, ${clamp(s.myShare)}%); background:${s.myColor}"
          ></div>
          ${
            s.rival
              ? html`<div
                  class="absolute -inset-y-0.5 w-0.5 rounded-full"
                  style="left:${clamp(s.rival.share)}%; background:${s.rival.color}; box-shadow:0 0 0 1px rgb(2 6 23 / 0.9)"
                ></div>`
              : nothing
          }
          <div
            class="absolute -inset-y-1 w-0.5 rounded-full bg-amber-400"
            style="left:${clamp(s.goal)}%"
          ></div>
        </div>
        ${
          s.rival
            ? html`<div
                class="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-slate-300"
              >
                <span>${s.rival.first ? "👑" : "2º"}</span>
                <span
                  class="size-2 shrink-0 rounded-sm"
                  style="background:${s.rival.color}"
                ></span>
                <span class="truncate max-w-[12rem]">${s.rival.name}</span>
                <span class="tabular-nums text-white"
                  >${this.pct(s.rival.share)}</span
                >
              </div>`
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "moworld-control-bar": ControlBar;
  }
}
