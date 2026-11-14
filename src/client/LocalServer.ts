import {
  AllPlayersStats,
  ClientID,
  StampedIntent,
  Turn,
} from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import {
  createPartialGameRecord,
  decompressGameRecord,
  replacer,
} from "@openfront/shared/SharedUtil";
import {
  ClientMessage,
  ClientSendWinnerMessage,
  PartialGameRecord,
  PartialGameRecordSchema,
  PlayerRecord,
  ServerMessage,
  ServerStartGameMessage,
} from "@openfront/shared/WireSchemas";
import {
  decodeClientMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import { ClientEnv } from "src/client/ClientEnv";
import { z } from "zod";
import { getApiBase } from "./Api";
import { getAuthHeader, getPersistentID } from "./Auth";
import { LobbyConfig } from "./ClientGameRunner";
import {
  GameSpeedDownIntentEvent,
  GameSpeedUpIntentEvent,
  ReplaySpeedChangeEvent,
} from "./InputHandler";
import { emitPauseVote, emitPeerLost } from "./peer/PeerSession";
import { startSingleplayerHeartbeat } from "./SingleplayerHeartbeat";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "./utilities/ReplaySpeedMultiplier";

// Order: 0.5, 1, 2, max (same as ReplayPanel)
const SPEED_ORDER: ReplaySpeedMultiplier[] = [
  ReplaySpeedMultiplier.slow,
  ReplaySpeedMultiplier.normal,
  ReplaySpeedMultiplier.fast,
  ReplaySpeedMultiplier.fastest,
];

// build a small backlog so MAX can catch up.
const MAX_REPLAY_BACKLOG_TURNS = 60;

export class LocalServer {
  // All turns from the game record on replay.
  private replayTurns: Turn[] = [];

  private turns: Turn[] = [];

  private intents: StampedIntent[] = [];
  private startedAt: number;

  private paused = false;
  private replaySpeedMultiplier = defaultReplaySpeedMultiplier;

  private clientID: ClientID | undefined;
  private winner: ClientSendWinnerMessage | null = null;
  private allPlayersStats: AllPlayersStats = {};
  // Set only once an upload got a 2xx, so endGame() retries failed or
  // skipped win-time uploads during teardown.
  private archived = false;
  private archiveInFlight = false;

  private turnsExecuted = 0;
  private turnStartTime = 0;

  private turnCheckInterval: NodeJS.Timeout;
  private stopHeartbeat: (() => void) | null = null;
  private clientConnect: () => void;
  private clientMessage: (message: ServerMessage) => void;

  // MoWorld: jogando junto — votação de pausa pendente (quem pediu).
  private vote: { from: ClientID; paused: boolean } | null = null;
  // O convidado só recebe turnos depois de entrar (os anteriores vão no
  // "start" que ele recebe ao entrar).
  private guestJoined = false;

  constructor(
    private lobbyConfig: LobbyConfig,
    private isReplay: boolean,
    private eventBus: EventBus,
  ) {}

  public updateCallback(
    clientConnect: () => void,
    clientMessage: (message: ServerMessage) => void,
  ) {
    this.clientConnect = clientConnect;
    this.clientMessage = clientMessage;
  }

  start() {
    console.log("local server starting");
    this.turnCheckInterval = setInterval(() => {
      const turnIntervalMs =
        ClientEnv.turnIntervalMs() * this.replaySpeedMultiplier;
      const backlog = Math.max(0, this.turns.length - this.turnsExecuted);
      const allowReplayBacklog =
        this.replaySpeedMultiplier === ReplaySpeedMultiplier.fastest &&
        this.lobbyConfig.gameRecord !== undefined;
      const maxBacklog = allowReplayBacklog ? MAX_REPLAY_BACKLOG_TURNS : 0;

      const canQueueNextTurn =
        backlog === 0 || (maxBacklog > 0 && backlog < maxBacklog);
      if (
        canQueueNextTurn &&
        Date.now() > this.turnStartTime + turnIntervalMs
      ) {
        this.turnStartTime = Date.now();
        // "Ending" the turn hands it to the client, which starts processing it.
        this.endTurn();
      }
    }, 5);

    this.eventBus.on(ReplaySpeedChangeEvent, (event) => {
      this.replaySpeedMultiplier = event.replaySpeedMultiplier;
    });

    if (!this.isReplay) {
      this.eventBus.on(GameSpeedUpIntentEvent, () => {
        const idx = SPEED_ORDER.indexOf(this.replaySpeedMultiplier);
        if (idx < 0 || idx >= SPEED_ORDER.length - 1) return;
        this.replaySpeedMultiplier = SPEED_ORDER[idx + 1];
        this.eventBus.emit(
          new ReplaySpeedChangeEvent(this.replaySpeedMultiplier),
        );
      });

      this.eventBus.on(GameSpeedDownIntentEvent, () => {
        const idx = SPEED_ORDER.indexOf(this.replaySpeedMultiplier);
        if (idx <= 0) return;
        this.replaySpeedMultiplier = SPEED_ORDER[idx - 1];
        this.eventBus.emit(
          new ReplaySpeedChangeEvent(this.replaySpeedMultiplier),
        );
      });
    }

    this.startedAt = Date.now();
    this.clientConnect();
    if (this.lobbyConfig.gameRecord) {
      this.replayTurns = decompressGameRecord(
        this.lobbyConfig.gameRecord,
      ).turns;
    }
    if (this.lobbyConfig.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    this.clientID = this.lobbyConfig.gameStartInfo.players[0]?.clientID;
    if (!this.clientID) {
      throw new Error("missing clientID");
    }
    this.clientMessage({
      type: "start",
      gameStartInfo: this.lobbyConfig.gameStartInfo,
      turns: [],
      lobbyCreatedAt: this.lobbyConfig.gameStartInfo.lobbyCreatedAt,
      // Don't send myClientID for replays — viewer has no player identity.
      myClientID: this.lobbyConfig.gameRecord ? undefined : this.clientID,
    } satisfies ServerStartGameMessage);
    this.wirePeerGuest();
    // A resumed game opens paused, so the player can get their bearings. The
    // pause turn is also the tick that brings the view up to the save.
    if (this.lobbyConfig.snapshot !== undefined) {
      this.onMessage({
        type: "intent",
        intent: { type: "toggle_pause", paused: true },
      });
    }
    // Last, so a start() that throws above leaves no interval behind.
    if (!this.isReplay) {
      this.stopHeartbeat = startSingleplayerHeartbeat(
        this.lobbyConfig.gameStartInfo.gameID,
      );
    }
  }

  onMessage(clientMsg: ClientMessage) {
    if (clientMsg.type === "rejoin") {
      if (!this.clientID) {
        throw new Error("missing clientID");
      }
      this.clientMessage({
        type: "start",
        gameStartInfo: this.lobbyConfig.gameStartInfo!,
        turns: this.turns,
        lobbyCreatedAt: this.lobbyConfig.gameStartInfo!.lobbyCreatedAt,
        myClientID: this.lobbyConfig.gameRecord ? undefined : this.clientID,
      } satisfies ServerStartGameMessage);
    }
    if (clientMsg.type === "intent") {
      // Server stamps clientID - client doesn't send it
      const stampedIntent = {
        ...clientMsg.intent,
        clientID: this.clientID!,
      };
      if (stampedIntent.type === "toggle_pause" && this.peerHost()) {
        this.requestPause(this.clientID!, stampedIntent.paused);
        return;
      }
      if (stampedIntent.type === "toggle_pause") {
        if (stampedIntent.paused) {
          // Pausing: add intent and end turn before pause takes effect
          this.intents.push(stampedIntent);
          this.endTurn();
          this.paused = true;
        } else {
          // Unpausing: clear pause flag before adding intent so next turn can execute
          this.paused = false;
          this.intents.push(stampedIntent);
          this.endTurn();
        }
        return;
      }
      // Don't process non-pause intents during replays or while paused
      if (this.lobbyConfig.gameRecord || this.paused) {
        return;
      }

      this.intents.push(stampedIntent);
    }
    if (clientMsg.type === "hash") {
      if (!this.lobbyConfig.gameRecord) {
        if (clientMsg.turnNumber % 100 === 0) {
          // In singleplayer, only store hash every 100 turns to reduce size of game record.
          const turn = this.turns[clientMsg.turnNumber];
          if (turn) {
            turn.hash = clientMsg.hash;
          }
        }
        return;
      }
      // If we are replaying a game then verify hash.
      const archivedHash = this.replayTurns[clientMsg.turnNumber].hash;
      if (!archivedHash) {
        console.warn(
          `no archived hash found for turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}`,
        );
        return;
      }
      if (archivedHash !== clientMsg.hash) {
        console.error(
          `desync detected on turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}, server hash: ${archivedHash}`,
        );
        this.clientMessage({
          type: "desync",
          turn: clientMsg.turnNumber,
          correctHash: archivedHash,
          clientsWithCorrectHash: 0,
          totalActiveClients: 1,
          yourHash: clientMsg.hash,
        });
      } else {
        console.log(
          `hash verified on turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}, server hash: ${archivedHash}`,
        );
      }
    }
    if (clientMsg.type === "winner") {
      this.winner = clientMsg;
      this.allPlayersStats = clientMsg.allPlayersStats;
      if (!this.isReplay) {
        // Archive as soon as the game is decided: endGame() only runs during
        // page teardown, where the auth refresh and upload race document
        // destruction and can silently lose the record (#4931).
        this.archiveGameRecord(false);
      }
    }
  }

  // ------------------------------------------------ MoWorld: jogando junto

  private peerHost() {
    const p = this.lobbyConfig.peer;
    return p && p.role === "host" && p.guestClientID ? p : null;
  }

  private sendToGuest(msg: ServerMessage) {
    const p = this.peerHost();
    if (!p) return;
    if (msg.type === "turn" && !this.guestJoined) return;
    p.link.sendBinary(encodeServerMessage(msg, undefined));
  }

  private wirePeerGuest() {
    const p = this.peerHost();
    if (!p) return;
    p.link.onClose(() => emitPeerLost());
    const guestID = p.guestClientID!;
    p.answerVote = (accept) => this.answerVote(this.clientID!, accept);
    p.link.onJson((m) => {
      if (m.k === "pause-answer") this.answerVote(guestID, m.accept === true);
    });
    p.link.onBinary((bytes) => {
      let msg: ClientMessage;
      try {
        msg = decodeClientMessage(bytes, undefined);
      } catch (e) {
        console.warn("peer: mensagem inválida do convidado", e);
        return;
      }
      this.onGuestMessage(guestID, msg);
    });
  }

  private onGuestMessage(guestID: ClientID, msg: ClientMessage) {
    if (msg.type === "join" || msg.type === "rejoin") {
      this.guestJoined = true;
      this.sendToGuest({
        type: "start",
        gameStartInfo: this.lobbyConfig.gameStartInfo!,
        turns: this.turns,
        lobbyCreatedAt: this.lobbyConfig.gameStartInfo!.lobbyCreatedAt,
        myClientID: guestID,
      } satisfies ServerStartGameMessage);
      return;
    }
    if (msg.type === "intent") {
      const stamped = { ...msg.intent, clientID: guestID } as StampedIntent;
      if (stamped.type === "toggle_pause") {
        this.requestPause(guestID, stamped.paused);
        return;
      }
      if (this.paused) return;
      this.intents.push(stamped);
      return;
    }
    if (msg.type === "hash") {
      const mine = this.turns[msg.turnNumber]?.hash;
      if (mine !== undefined && mine !== null && mine !== msg.hash) {
        console.error(
          `peer: dessincronizou no turno ${msg.turnNumber} (anfitrião ${mine}, convidado ${msg.hash})`,
        );
      }
    }
  }

  /** Pedido de pausa/despausa: só vale quando o outro jogador aceita. */
  private requestPause(from: ClientID, paused: boolean) {
    const p = this.peerHost();
    if (!p) return;
    if (this.vote !== null || paused === this.paused) return;
    this.vote = { from, paused };
    const hostAsked = from === this.clientID;
    const hostName = this.lobbyConfig.playerName;
    emitPauseVote(
      hostAsked
        ? { state: "waiting", paused }
        : { state: "ask", paused, from: p.partnerName },
    );
    p.link.sendJson({
      k: "pause-vote",
      v: hostAsked
        ? { state: "ask", paused, from: hostName }
        : { state: "waiting", paused },
    });
  }

  private answerVote(answerer: ClientID, accept: boolean) {
    const p = this.peerHost();
    const vote = this.vote;
    if (!p || vote === null || answerer === vote.from) return;
    this.vote = null;
    if (accept) {
      const intent = {
        type: "toggle_pause",
        paused: vote.paused,
        clientID: vote.from,
      } as StampedIntent;
      if (vote.paused) {
        this.intents.push(intent);
        this.endTurn();
        this.paused = true;
      } else {
        this.paused = false;
        this.intents.push(intent);
        this.endTurn();
      }
      emitPauseVote({ state: "accepted", paused: vote.paused });
      p.link.sendJson({
        k: "pause-vote",
        v: { state: "accepted", paused: vote.paused },
      });
      return;
    }
    const by =
      answerer === this.clientID ? this.lobbyConfig.playerName : p.partnerName;
    emitPauseVote({ state: "refused", paused: vote.paused, by });
    p.link.sendJson({
      k: "pause-vote",
      v: { state: "refused", paused: vote.paused, by },
    });
  }

  // This is so the client can tell us when it finished processing the turn.
  public turnComplete() {
    this.turnsExecuted++;
  }

  // endTurn in this context means the server has collected all the intents
  // and will send the turn to the client.
  private endTurn() {
    if (this.paused) {
      return;
    }
    if (this.replayTurns.length > 0) {
      if (this.turns.length >= this.replayTurns.length) {
        this.endGame();
        return;
      }
      this.intents = this.replayTurns[this.turns.length].intents;
    }
    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];
    this.clientMessage({
      type: "turn",
      turn: pastTurn,
    });
    this.sendToGuest({ type: "turn", turn: pastTurn });
  }

  public endGame() {
    console.log("local server ending game");
    this.lobbyConfig.peer?.link.close();
    clearInterval(this.turnCheckInterval);
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    if (this.isReplay) {
      return;
    }
    // Fallback for games that end without a winner (e.g. quitting early);
    // decided games were already archived at win time.
    this.archiveGameRecord(true);
  }

  private archiveGameRecord(unloading: boolean) {
    if (this.archived || this.archiveInFlight) {
      return;
    }
    // A game resumed from a save is never archived: its turns start mid-game,
    // so the record could not replay, and archiving is what awards XP and
    // achievements, which a shared save one move from victory would farm.
    if (this.lobbyConfig.snapshot !== undefined) {
      return;
    }
    const players: PlayerRecord[] = [
      {
        persistentID: getPersistentID(),
        username: this.lobbyConfig.playerName,
        clanTag: this.lobbyConfig.playerClanTag ?? null,
        clientID: this.clientID!,
        stats: this.allPlayersStats[this.clientID!],
        cosmetics: this.lobbyConfig.gameStartInfo?.players[0].cosmetics,
      },
    ];
    if (this.lobbyConfig.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    const record = createPartialGameRecord(
      this.lobbyConfig.gameStartInfo.gameID,
      this.lobbyConfig.gameStartInfo.config,
      players,
      this.turns,
      this.startedAt,
      Date.now(),
      this.winner?.winner,
    );

    const result = PartialGameRecordSchema.safeParse(record);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing game record", error);
      return;
    }

    void this.archiveGame(result.data, unloading);
  }

  private async archiveGame(
    record: PartialGameRecord,
    unloading: boolean,
  ): Promise<void> {
    this.archiveInFlight = true;
    try {
      const authHeader = await getAuthHeader();
      if (authHeader === "") {
        // The archive API requires a session. Guests have one too, so this
        // only trips when none could be established (e.g. API unreachable).
        return;
      }
      // Replays refuse to load unless the archived commit matches the client
      // build, and the API worker can't stamp it (it has a different build).
      const jsonString = JSON.stringify(
        { ...record, gitCommit: ClientEnv.gitCommit() },
        replacer,
      );
      const compressedData = await compress(jsonString);
      const response = await fetch(
        `${getApiBase()}/archive_singleplayer_game`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
            Authorization: authHeader,
          },
          body: compressedData,
          // keepalive lets the request outlive page teardown but caps the body
          // at 64 KiB, so only set it when the page is actually unloading.
          keepalive: unloading,
        },
      );
      if (response.ok) {
        this.archived = true;
      } else {
        console.error(
          `Failed to archive singleplayer game: ${response.status}`,
        );
      }
    } catch (error) {
      console.warn("Failed to archive singleplayer game:", error);
    } finally {
      this.archiveInFlight = false;
    }
  }
}

async function compress(data: string): Promise<ArrayBuffer> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  // Write the data to the compression stream
  void writer.write(new TextEncoder().encode(data));
  void writer.close();

  // Read the compressed data
  const chunks: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      chunks.push(value);
    }
  }

  // Combine all chunks into a single Uint8Array
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const compressedData = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressedData.set(chunk, offset);
    offset += chunk.length;
  }

  return compressedData.buffer;
}
