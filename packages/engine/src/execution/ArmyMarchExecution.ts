import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerID,
  TerraNullius,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRef,
  zTiles,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { AttackExecution } from "./AttackExecution";

/** Tiles por tick; o barco anda 1. */
const TICKS_PER_MOVE = 1;
/** Perda ao recuar, igual ao barco (TransportShipExecution). */
const RETREAT_MALUS = 0.25;
/** Limite da busca de caminho (tiles visitados). */
const MAX_SEARCH = 400_000;

/**
 * MoWorld: ataque por dentro do território de um aliado.
 *
 * As tropas viram uma unidade (Exército) que anda por terra — pelo seu
 * território e pelo do aliado — até a fronteira do alvo. Só quando chega
 * ela "desembarca" (conquista o primeiro tile) e o ataque começa dali,
 * como o barco na praia.
 *
 * - Aliado rompeu no caminho: o exército ataca o ex-aliado de onde estiver.
 * - Alvo morreu ou virou aliado: as tropas voltam para você.
 * - O caminho foi cortado: procura outro; sem caminho, as tropas voltam.
 */
export class ArmyMarchExecution implements Execution {
  private active = true;
  private mg: Game | undefined;
  private army: Unit | undefined;
  private path: TileRef[] = [];
  private step = 0;
  private motionPlanId = 1;
  /** Já começou a voltar (o plano de movimento de volta foi gravado). */
  private retreating = false;

  constructor(
    private attacker: Player,
    private targetID: PlayerID,
    private troops: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.targetID)) {
      this.giveBack();
      return;
    }
    const target = mg.player(this.targetID);
    const path = findArmyPath(mg, this.attacker, target, null);
    if (path === null || path.length < 2) {
      this.giveBack();
      return;
    }
    this.path = path;
    this.step = 0;
    // As tropas já saíram (AttackExecution); buildUnit tira de novo.
    this.attacker.addTroops(this.troops);
    this.army = this.attacker.buildUnit(UnitType.Army, path[0], {
      troops: this.troops,
      targetTile: path[path.length - 1],
    });
    this.recordPlan(ticks);
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    const army = this.army;
    if (army === undefined || !army.isActive()) {
      this.active = false;
      return;
    }
    if (!this.attacker.isAlive()) {
      army.delete(false);
      this.active = false;
      return;
    }
    const here = army.tile();
    const hereOwner = mg.owner(here);

    // Cancelado pelo jogador: volta pelo mesmo caminho.
    if (army.transportShipState().isRetreating) {
      this.retreatStep(ticks, here, hereOwner);
      return;
    }

    const target = mg.player(this.targetID);
    if (!target.isAlive() || this.attacker.isFriendly(target)) {
      this.giveBack();
      return;
    }

    // Parado dentro de quem deixou de ser aliado: ataca ele daqui.
    if (
      hereOwner.isPlayer() &&
      hereOwner !== this.attacker &&
      !this.attacker.isFriendly(hereOwner)
    ) {
      this.landAndAttack(here, hereOwner);
      return;
    }

    const next = this.path[this.step + 1];
    if (next === undefined) {
      this.repath(ticks, target);
      return;
    }
    const nextOwner = mg.owner(next);
    const isLast = this.step + 1 === this.path.length - 1;

    if (nextOwner === target) {
      if (isLast || !this.attacker.isFriendly(target)) {
        // Chegou na fronteira do alvo.
        this.landAndAttack(next, target);
        return;
      }
    }
    if (
      nextOwner.isPlayer() &&
      nextOwner !== this.attacker &&
      !this.attacker.isFriendly(nextOwner)
    ) {
      // Alguém hostil no caminho (aliado rompeu ou um terceiro tomou o
      // caminho): o ataque passa a ser nele.
      if (hereOwner === this.attacker) {
        mg.addExecution(
          new AttackExecution(
            this.troops,
            this.attacker,
            nextOwner.id(),
            null,
            false,
          ),
        );
        army.delete(false);
        this.active = false;
      } else {
        this.landAndAttack(next, nextOwner);
      }
      return;
    }
    if (
      !mg.isLand(next) ||
      mg.isImpassable(next) ||
      !nextOwner.isPlayer() ||
      isLast
    ) {
      // Caminho mudou (terra de ninguém, ou o fim já não é do alvo).
      this.repath(ticks, target);
      return;
    }

    if (ticks % TICKS_PER_MOVE !== 0) return;
    army.move(next);
    this.step++;
  }

  private retreatStep(
    ticks: number,
    here: TileRef,
    hereOwner: Player | TerraNullius,
  ) {
    const army = this.army!;
    if (hereOwner === this.attacker || this.step <= 0) {
      // Chegou em casa: devolve as tropas, com a perda do recuo.
      const troops = army.troops();
      this.attacker.addTroops(Math.floor(troops * (1 - RETREAT_MALUS)));
      army.delete(false);
      this.active = false;
      return;
    }
    if (!this.retreating) {
      this.retreating = true;
      this.motionPlanId++;
      this.mg!.recordMotionPlan({
        kind: "grid",
        unitId: army.id(),
        planId: this.motionPlanId,
        startTick: ticks + TICKS_PER_MOVE,
        ticksPerStep: TICKS_PER_MOVE,
        path: this.path.slice(0, this.step + 1).reverse(),
      });
    }
    this.step--;
    army.move(this.path[this.step]);
  }

  private landAndAttack(tile: TileRef, enemy: Player) {
    const mg = this.mg!;
    this.attacker.conquer(tile);
    mg.addExecution(
      new AttackExecution(this.troops, this.attacker, enemy.id(), tile, false),
    );
    this.army?.delete(false);
    this.active = false;
  }

  private repath(ticks: number, target: Player) {
    const mg = this.mg!;
    const path = findArmyPath(mg, this.attacker, target, this.army!.tile());
    if (path === null || path.length < 2) {
      this.giveBack();
      return;
    }
    this.path = path;
    this.step = 0;
    this.army!.setTargetTile(path[path.length - 1]);
    this.recordPlan(ticks);
  }

  private recordPlan(ticks: number) {
    if (this.army === undefined) return;
    this.motionPlanId++;
    this.mg!.recordMotionPlan({
      kind: "grid",
      unitId: this.army.id(),
      planId: this.motionPlanId,
      startTick: ticks + TICKS_PER_MOVE,
      ticksPerStep: TICKS_PER_MOVE,
      // O último tile é do alvo: o exército para antes e "desembarca".
      path: this.path.slice(this.step, this.path.length - 1),
    });
  }

  private giveBack() {
    this.attacker.addTroops(this.troops);
    this.army?.delete(false);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ArmyMarchExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      attacker: w.player(this.attacker),
      targetID: this.targetID,
      troops: this.troops,
      army: this.army === undefined ? undefined : w.unit(this.army),
      path: Uint32Array.from(this.path),
      step: this.step,
      motionPlanId: this.motionPlanId,
      retreating: this.retreating,
    });
  }

  restoreSnapshot(s: ArmyMarchExecutionState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.attacker = r.player(s.attacker);
    this.targetID = s.targetID;
    this.troops = s.troops;
    if (s.army !== undefined) this.army = r.unit(s.army);
    this.path = Array.from(s.path);
    this.step = s.step;
    this.motionPlanId = s.motionPlanId;
    this.retreating = s.retreating ?? false;
  }
}

/**
 * Caminho por terra: do seu território (ou de `from`), passando só por você
 * e por aliados, até encostar no alvo. O último tile é o primeiro do alvo.
 */
export function findArmyPath(
  mg: Game,
  attacker: Player,
  target: Player,
  from: TileRef | null,
): TileRef[] | null {
  const passable = (t: TileRef): boolean => {
    if (!mg.isLand(t) || mg.isImpassable(t)) return false;
    const o = mg.owner(t);
    if (!o.isPlayer() || o === target) return false;
    return o === attacker || attacker.isFriendly(o);
  };

  const prev = new Map<TileRef, TileRef>();
  const queue: TileRef[] = [];
  if (from !== null) {
    prev.set(from, from);
    queue.push(from);
  } else {
    // Começa na sua fronteira com aliados.
    attacker.borderTiles().forEach((t) => {
      for (const n of mg.neighbors(t)) {
        const o = mg.owner(n);
        if (o.isPlayer() && o !== attacker && attacker.isFriendly(o)) {
          if (!prev.has(t)) {
            prev.set(t, t);
            queue.push(t);
          }
          break;
        }
      }
    });
  }

  for (let head = 0; head < queue.length; head++) {
    if (prev.size > MAX_SEARCH) return null;
    const t = queue[head];
    for (const n of mg.neighbors(t)) {
      if (prev.has(n)) continue;
      if (mg.isLand(n) && !mg.isImpassable(n) && mg.owner(n) === target) {
        // Chegou: reconstrói o caminho.
        const path: TileRef[] = [n];
        let cur = t;
        for (;;) {
          path.push(cur);
          const p = prev.get(cur)!;
          if (p === cur) break;
          cur = p;
        }
        path.reverse();
        return path;
      }
      if (!passable(n)) continue;
      prev.set(n, t);
      queue.push(n);
    }
  }
  return null;
}

const ArmyMarchExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  attacker: zPlayerRef(),
  targetID: z.string(),
  troops: zNum(),
  army: zRef().optional(),
  path: zTiles(),
  step: zInt(),
  motionPlanId: zInt(),
  retreating: z.boolean().optional(),
});
type ArmyMarchExecutionState = z.infer<typeof ArmyMarchExecutionStateSchema>;

export const ArmyMarchExecutionSnapshot = execSnapshotType({
  name: "ArmyMarch",
  version: 1,
  schema: ArmyMarchExecutionStateSchema,
  cls: () => ArmyMarchExecution,
});
