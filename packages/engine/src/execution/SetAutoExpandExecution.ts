// MoWorld: liga ou desliga a expansão automática do jogador
// (PlayerExecution.autoExpandStep).
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export class SetAutoExpandExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private enabled: boolean,
  ) {}

  init(_mg: Game): void {
    this.player.setAutoExpand(this.enabled);
    this.active = false;
  }

  tick(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return SetAutoExpandExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      enabled: this.enabled,
    });
  }

  restoreSnapshot(s: SetAutoExpandState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.enabled = s.enabled;
  }
}

const SetAutoExpandStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  enabled: z.boolean(),
});
type SetAutoExpandState = z.infer<typeof SetAutoExpandStateSchema>;

export const SetAutoExpandExecutionSnapshot = execSnapshotType({
  name: "SetAutoExpand",
  version: 1,
  schema: SetAutoExpandStateSchema,
  cls: () => SetAutoExpandExecution,
});
