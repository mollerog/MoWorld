// MoWorld: o jogador pede tropas ou ouro a uma nação aliada.
//
// A nação decide sem sorteio (a sequência aleatória das nações fica igual):
// aceita se a relação com quem pede for AMIGÁVEL e ela tiver folga, e manda
// 15% das tropas ou 10% do ouro (as mesmas quantias da ajuda automática,
// NationAllyAid). Pedir de novo antes da espera (a mesma da ajuda
// automática, Config.allyAidCooldown) é recusado e esfria a amizade.
import {
  GameMode,
  MessageType,
  PlayerID,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { DonateGoldExecution } from "./DonateGoldExecution";
import { DonateTroopsExecution } from "./DonateTroopExecution";

export type AllyAidKind = "troops" | "gold";

export type AllyAidRefusal = "relation" | "cooldown" | "no_troops" | "no_gold";

export type AllyAidDecision =
  | { ok: true; amount: number }
  | { ok: false; reason: AllyAidRefusal };

/** Folga mínima: tropas acima de 30% do máximo, ou 200 mil de ouro. */
export const ASK_MIN_TROOPS_SHARE = 0.3;
export const ASK_MIN_GOLD = 200_000n;
/** Quanto a amizade cai: ao aceitar e ao pedir cedo demais. */
export const ASK_RELATION_COST = 10;
export const ASK_TOO_SOON_COST = 15;

/** Dá para pedir ajuda a esta nação? (Mostra ou não os botões.) */
export function canAskAllyAid(game: Game, asker: Player, nation: Player) {
  const cfg = game.config().gameConfig();
  return (
    cfg.gameMode !== GameMode.Team &&
    !cfg.tutorial &&
    asker.type() === PlayerType.Human &&
    nation.type() === PlayerType.Nation &&
    nation.isAlive() &&
    asker.isAlive() &&
    asker.isAlliedWith(nation)
  );
}

export function decideAllyAid(
  game: Game,
  nation: Player,
  asker: Player,
  kind: AllyAidKind,
): AllyAidDecision {
  const last = nation.lastDonationTickTo(asker);
  if (last !== null && game.ticks() - last < game.config().allyAidCooldown()) {
    return { ok: false, reason: "cooldown" };
  }
  if (nation.relation(asker) < Relation.Friendly) {
    return { ok: false, reason: "relation" };
  }
  if (kind === "troops") {
    const max = game.config().maxTroops(nation);
    if (
      nation.troops() <= max * ASK_MIN_TROOPS_SHARE ||
      !nation.canDonateTroops(asker)
    ) {
      return { ok: false, reason: "no_troops" };
    }
    return { ok: true, amount: Math.floor(nation.troops() * 0.15) };
  }
  if (nation.gold() < ASK_MIN_GOLD || !nation.canDonateGold(asker)) {
    return { ok: false, reason: "no_gold" };
  }
  return { ok: true, amount: Number(nation.gold() / 10n) };
}

export class AskAllyAidExecution implements Execution {
  private active = true;

  constructor(
    private asker: Player,
    private nationID: PlayerID,
    private kind: AllyAidKind,
  ) {}

  init(mg: Game): void {
    if (!mg.hasPlayer(this.nationID)) {
      this.active = false;
      return;
    }
    const nation = mg.player(this.nationID);
    this.active = false;
    if (!canAskAllyAid(mg, this.asker, nation)) return;

    const decision = decideAllyAid(mg, nation, this.asker, this.kind);
    if (decision.ok) {
      nation.updateRelation(this.asker, -ASK_RELATION_COST);
      mg.addExecution(
        this.kind === "troops"
          ? new DonateTroopsExecution(nation, this.asker.id(), decision.amount)
          : new DonateGoldExecution(nation, this.asker.id(), decision.amount),
      );
      return;
    }
    if (decision.reason === "cooldown") {
      nation.updateRelation(this.asker, -ASK_TOO_SOON_COST);
    }
    mg.displayMessage(
      `events_display.ally_aid_refused_${decision.reason}`,
      MessageType.ALLIANCE_REJECTED,
      this.asker.id(),
      undefined,
      { name: nation.displayName() },
    );
  }

  tick(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AskAllyAidExecutionSnapshot.write({
      active: this.active,
      asker: w.player(this.asker),
      nationID: this.nationID,
      kind: this.kind,
    });
  }

  restoreSnapshot(s: AskAllyAidState, r: SnapshotReader): void {
    this.active = s.active;
    this.asker = r.player(s.asker);
    this.nationID = s.nationID;
    this.kind = s.kind;
  }
}

const AskAllyAidStateSchema = z.object({
  active: z.boolean(),
  asker: zPlayerRef(),
  nationID: z.string(),
  kind: z.enum(["troops", "gold"]),
});
type AskAllyAidState = z.infer<typeof AskAllyAidStateSchema>;

export const AskAllyAidExecutionSnapshot = execSnapshotType({
  name: "AskAllyAid",
  version: 1,
  schema: AskAllyAidStateSchema,
  cls: () => AskAllyAidExecution,
});
