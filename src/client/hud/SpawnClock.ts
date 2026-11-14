// MoWorld: quanto falta para acabar a fase de posicionamento, no modo sem
// servidor (solo ou jogando junto). Espelha SoloSpawnCountdownExecution:
// - solo: 10 s depois da primeira escolha;
// - jogando junto: 30 s desde o começo, encurtando para 10 s depois que
//   todos escolheram.
import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameView } from "../view";

export class SpawnClock {
  private firstSpawnTick: number | null = null;
  private allSpawnedTick: number | null = null;

  /** Segundos restantes, ou null quando não há contagem para mostrar. */
  secondsLeft(game: GameView): number | null {
    if (!game.inSpawnPhase()) return null;
    const cfg = game.config();
    const ticks = game.ticks();
    const humans = game.players().filter((p) => p.type() === PlayerType.Human);
    let end: number;
    if (humans.length > 1) {
      end = cfg.coopSpawnTurns();
      if (humans.every((p) => p.hasSpawned())) {
        this.allSpawnedTick ??= ticks;
        end = Math.min(end, this.allSpawnedTick + cfg.soloSpawnConfirmTurns());
      }
    } else {
      if (!game.myPlayer()?.hasSpawned()) return null;
      this.firstSpawnTick ??= ticks;
      end = this.firstSpawnTick + cfg.soloSpawnConfirmTurns();
    }
    return Math.max(0, Math.ceil((end - ticks) / 10));
  }

  isCoop(game: GameView): boolean {
    return (
      game.players().filter((p) => p.type() === PlayerType.Human).length > 1
    );
  }
}
