import {
  GameMode,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "../../game/Game";
import { DonateGoldExecution } from "../DonateGoldExecution";
import { DonateTroopsExecution } from "../DonateTroopExecution";

/**
 * MoWorld: no todos-contra-todos, uma nação aliada e AMIGÁVEL ajuda o jogador
 * humano. Em partidas por equipe o jogo já tem a doação própria.
 *
 * - Tropas: quando o aliado está sendo atacado e com poucas tropas (< 30% do
 *   máximo), e a nação tem folga (> 50% do máximo dela). Manda 15% das tropas.
 * - Ouro: quando a nação tem ouro sobrando (≥ 1M e 4× o do aliado). Manda 10%.
 * - Espera de 3 minutos entre doações da mesma nação para o mesmo jogador.
 *
 * Vale mesmo com a doação entre jogadores desligada (solo): é ajuda da nação.
 * Sem sorteio, para não mexer na sequência aleatória das nações.
 */
export const ALLY_AID_COOLDOWN = 3 * 60 * 10;

export function maybeAidAllies(game: Game, nation: Player): boolean {
  const config = game.config();
  if (config.gameConfig().gameMode === GameMode.Team) return false;
  if (config.gameConfig().tutorial) return false;
  if (!nation.isAlive()) return false;

  for (const ally of nation.allies()) {
    if (ally.type() !== PlayerType.Human || !ally.isAlive()) continue;
    if (nation.relation(ally) < Relation.Friendly) continue;
    const last = nation.lastDonationTickTo(ally);
    if (last !== null && game.ticks() - last < ALLY_AID_COOLDOWN) continue;

    // Tropas para quem está apanhando.
    const allyMax = config.maxTroops(ally);
    const myMax = config.maxTroops(nation);
    if (
      ally.incomingAttacks().length > 0 &&
      ally.troops() < allyMax * 0.3 &&
      nation.troops() > myMax * 0.5 &&
      nation.canDonateTroops(ally)
    ) {
      const troops = Math.floor(nation.troops() * 0.15);
      if (troops > 0) {
        game.addExecution(new DonateTroopsExecution(nation, ally.id(), troops));
        return true;
      }
    }

    // Ouro que sobra.
    const gold = nation.gold();
    if (
      gold >= 1_000_000n &&
      gold >= ally.gold() * 4n &&
      nation.canDonateGold(ally)
    ) {
      game.addExecution(
        new DonateGoldExecution(nation, ally.id(), Number(gold / 10n)),
      );
      return true;
    }
  }
  return false;
}
