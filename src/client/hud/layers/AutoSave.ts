// MoWorld: salvamento automático da partida solo.
//
// No celular o navegador pode ser fechado em segundo plano sem aviso (uma
// ligação, abrir outro app). Para a partida não se perder, ela é salva
// sozinha a cada 2 minutos e sempre que o jogo vai para segundo plano, num
// save fixo ("Automático") que aparece em CONTINUAR. Quando a partida acaba
// (vitória de alguém ou você eliminado), o save automático é apagado.
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { ClientEnv } from "../../ClientEnv";
import { Controller } from "../../Controller";
import { peerSession } from "../../peer/PeerSession";
import { deleteAutosave, writeAutosave } from "../../SavedGamesApi";
import { getMapName } from "../../Utils";
import { GameView } from "../../view";

const EVERY_MS = 2 * 60 * 1000;

export class AutoSave implements Controller {
  private lastSave = Date.now();
  private saving = false;
  private finished = false;
  private wasAlive = false;
  private onHidden = () => {
    if (document.visibilityState === "hidden") void this.save();
  };

  constructor(private game: GameView) {}

  init() {
    if (!this.enabled()) return;
    document.addEventListener("visibilitychange", this.onHidden);
    window.addEventListener("pagehide", this.onHidden);
  }

  private enabled(): boolean {
    const cfg = this.game.config();
    const gc = cfg.gameConfig();
    return (
      gc.gameType === GameType.Singleplayer &&
      gc.tutorial !== true &&
      !cfg.isReplay() &&
      peerSession() === null
    );
  }

  tick() {
    if (this.finished || !this.enabled()) return;
    const me = this.game.myPlayer();
    if (me?.isAlive()) this.wasAlive = true;
    const won =
      (this.game.updatesSinceLastTick()?.[GameUpdateType.Win] ?? []).length > 0;
    if (won || (this.wasAlive && me && !me.isAlive())) {
      this.finished = true;
      document.removeEventListener("visibilitychange", this.onHidden);
      window.removeEventListener("pagehide", this.onHidden);
      void deleteAutosave();
      return;
    }
    if (Date.now() - this.lastSave >= EVERY_MS) void this.save();
  }

  private async save() {
    if (this.saving || this.finished) return;
    const me = this.game.myPlayer();
    if (!me?.isAlive() || this.game.inSpawnPhase()) return;
    this.saving = true;
    this.lastSave = Date.now();
    try {
      const snapshot = await this.game.worker.snapshot(ClientEnv.gitCommit());
      const map = this.game.config().gameConfig().gameMap;
      const at = new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      await writeAutosave(snapshot, {
        name: `⟳ Automático · ${getMapName(map) ?? map} · ${at}`,
        map,
        tick: this.game.ticks(),
      });
    } catch (err) {
      console.warn("autosave falhou", err);
    } finally {
      this.saving = false;
    }
  }
}
