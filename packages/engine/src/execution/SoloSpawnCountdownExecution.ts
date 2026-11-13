import { zNum } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";

/**
 * MoWorld: no solo a fase de posicionamento termina alguns segundos depois
 * de o jogador escolher onde nascer (não na hora), para dar tempo de trocar.
 */
export class SoloSpawnCountdownExecution implements Execution {
  private mg: Game | undefined;

  constructor(private endTick: number) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(): void {
    if (this.mg && this.mg.ticks() >= this.endTick) {
      this.mg.endSpawnPhase();
    }
  }

  isActive(): boolean {
    return this.mg === undefined || this.mg.inSpawnPhase();
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  snapshot(): ExecRecord {
    return SoloSpawnCountdownExecutionSnapshot.write({
      initialized: this.mg !== undefined,
      endTick: this.endTick,
    });
  }

  restoreSnapshot(s: SoloSpawnCountdownState, r: SnapshotReader): void {
    this.endTick = s.endTick;
    if (s.initialized) this.mg = r.game;
  }
}

const SoloSpawnCountdownStateSchema = z.object({
  initialized: z.boolean(),
  endTick: zNum(),
});
type SoloSpawnCountdownState = z.infer<typeof SoloSpawnCountdownStateSchema>;

export const SoloSpawnCountdownExecutionSnapshot = execSnapshotType({
  name: "SoloSpawnCountdown",
  version: 1,
  schema: SoloSpawnCountdownStateSchema,
  cls: () => SoloSpawnCountdownExecution,
});
