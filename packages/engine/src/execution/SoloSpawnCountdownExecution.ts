import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { zNum } from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";
import { SpawnExecution } from "./SpawnExecution";
import { getSpawnTiles } from "./Util";

/**
 * MoWorld: fim da fase de posicionamento no modo sem servidor.
 *
 * - Solo: termina alguns segundos depois de o jogador escolher onde nascer
 *   (dá tempo de trocar).
 * - Jogando junto (mais de um humano): todos têm um prazo desde o começo;
 *   quando todos escolhem, o prazo encurta para a mesma folga do solo. Quem
 *   não escolheu até o fim é colocado num lugar aleatório longe dos outros
 *   humanos.
 */
export class SoloSpawnCountdownExecution implements Execution {
  private mg: Game | undefined;

  constructor(
    private endTick: number,
    private gameID: string = "",
    private autoSpawn: boolean = false,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  /** Tick em que a fase termina (para a interface mostrar a contagem). */
  public end(): number {
    return this.endTick;
  }

  tick(): void {
    const mg = this.mg;
    if (!mg) return;
    const humans = mg.allPlayers().filter((p) => p.type() === PlayerType.Human);
    if (
      this.autoSpawn &&
      humans.length > 0 &&
      humans.every((p) => p.hasSpawned())
    ) {
      this.endTick = Math.min(
        this.endTick,
        mg.ticks() + mg.config().soloSpawnConfirmTurns(),
      );
    }
    if (mg.ticks() < this.endTick) return;
    if (this.autoSpawn) {
      for (const p of humans) {
        if (p.hasSpawned()) continue;
        const tile = this.farTile(mg, p, humans);
        if (tile !== null) {
          // Roda já neste tick, ainda dentro da fase de posicionamento.
          const exec = new SpawnExecution(this.gameID, p.info(), tile);
          exec.init(mg, mg.ticks());
          exec.tick(mg.ticks());
        }
      }
    }
    mg.endSpawnPhase();
  }

  /** Um lugar livre entre os mais distantes dos outros humanos. */
  private farTile(mg: Game, me: Player, humans: Player[]): TileRef | null {
    const random = new PseudoRandom(
      simpleHash(this.gameID) + simpleHash(me.id()) + mg.ticks(),
    );
    const others = humans
      .filter((h) => h !== me)
      .map((h) => h.spawnTile())
      .filter((t): t is TileRef => t !== undefined);
    const found: { tile: TileRef; score: number }[] = [];
    for (let i = 0; i < 1500 && found.length < 80; i++) {
      const tile = mg.ref(
        random.nextInt(0, mg.width()),
        random.nextInt(0, mg.height()),
      );
      if (!mg.isLand(tile) || mg.hasOwner(tile) || mg.isBorder(tile)) continue;
      if (!getSpawnTiles(mg, tile, true)) continue;
      const score =
        others.length === 0
          ? random.nextInt(0, 1000)
          : Math.min(...others.map((o) => mg.manhattanDist(o, tile)));
      found.push({ tile, score });
    }
    if (found.length === 0) return null;
    // "Longe, não necessariamente o mais longe": sorteia entre o quarto mais
    // distante dos candidatos.
    found.sort((a, b) => b.score - a.score);
    const top = Math.max(1, Math.ceil(found.length / 4));
    return found[random.nextInt(0, top)].tile;
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
      gameID: this.gameID,
      autoSpawn: this.autoSpawn,
    });
  }

  restoreSnapshot(s: SoloSpawnCountdownState, r: SnapshotReader): void {
    this.endTick = s.endTick;
    this.gameID = s.gameID ?? "";
    this.autoSpawn = s.autoSpawn ?? false;
    if (s.initialized) this.mg = r.game;
  }
}

const SoloSpawnCountdownStateSchema = z.object({
  initialized: z.boolean(),
  endTick: zNum(),
  gameID: z.string().optional(),
  autoSpawn: z.boolean().optional(),
});
type SoloSpawnCountdownState = z.infer<typeof SoloSpawnCountdownStateSchema>;

export const SoloSpawnCountdownExecutionSnapshot = execSnapshotType({
  name: "SoloSpawnCountdown",
  version: 1,
  schema: SoloSpawnCountdownStateSchema,
  cls: () => SoloSpawnCountdownExecution,
});
