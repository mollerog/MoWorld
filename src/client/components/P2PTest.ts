// MoWorld: teste de conexão direta entre dois aparelhos (WebRTC).
//
// Primeiro passo do modo "jogar junto": antes de adaptar o jogo, confirmar
// que dois aparelhos conseguem conversar direto — na mesma Wi-Fi e pelo
// 4G/5G. O Firestore só apresenta um aparelho ao outro (troca de "oferta" e
// "resposta"); depois disso os dados vão direto de um para o outro.
//
// Abre pelo link "Jogar junto · teste de conexão" da tela inicial.
import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  accountStatus,
  currentUser,
  firestore,
  initAccount,
  onAccountChange,
} from "../Account";

const ICE: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CONNECT_TIMEOUT_MS = 25_000;

type Phase =
  | "idle"
  | "creating"
  | "waiting"
  | "joining"
  | "connecting"
  | "connected"
  | "failed";

type PairInfo = { local: string; remote: string; protocol: string };

const TYPE_NAMES: Record<string, string> = {
  host: "rede local",
  srflx: "internet (direto)",
  prflx: "internet (direto)",
  relay: "servidor intermediário",
};

@customElement("moworld-p2p-test")
export class P2PTest extends LitElement {
  @state() private phase: Phase = "idle";
  @state() private code = "";
  @state() private joinCode = "";
  @state() private message = "";
  @state() private rtt: number | null = null;
  @state() private rttAvg: number | null = null;
  @state() private pair: PairInfo | null = null;
  @state() private log: string[] = [];
  @state() private account = accountStatus();

  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private unsub: (() => void) | null = null;
  private offAccount: (() => void) | null = null;
  private pingTimer = 0;
  private timeout = 0;
  private rtts: number[] = [];
  private isHost = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.offAccount = onAccountChange(() => (this.account = accountStatus()));
    void initAccount().then(() => (this.account = accountStatus()));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.offAccount?.();
    void this.reset();
  }

  private say(line: string) {
    const t = new Date().toLocaleTimeString("pt-BR");
    this.log = [...this.log.slice(-11), `${t} ${line}`];
  }

  private async reset() {
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.timeout);
    this.unsub?.();
    this.unsub = null;
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pc = null;
    const db = firestore();
    if (this.isHost && this.code && db) {
      await deleteDoc(doc(db, "p2pTests", this.code)).catch(() => {});
    }
    this.isHost = false;
    this.rtts = [];
    this.rtt = this.rttAvg = null;
    this.pair = null;
  }

  // Junta todos os candidatos na própria oferta/resposta (sem "trickle"):
  // um documento só, uma escrita de cada lado.
  private waitForIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      pc.addEventListener("icegatheringstatechange", check);
      window.setTimeout(done, 5000);
    });
  }

  private newPeer(): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE);
    pc.addEventListener("connectionstatechange", () => {
      this.say(`conexão: ${pc.connectionState}`);
      if (pc.connectionState === "failed") this.fail();
    });
    this.pc = pc;
    return pc;
  }

  private wireChannel(ch: RTCDataChannel) {
    this.channel = ch;
    ch.addEventListener("open", () => {
      window.clearTimeout(this.timeout);
      this.phase = "connected";
      this.message =
        "Conectado! Os dados estão indo direto entre os aparelhos.";
      this.say("canal aberto");
      this.pingTimer = window.setInterval(() => this.ping(), 1000);
      void this.readPair();
    });
    ch.addEventListener("close", () => {
      if (this.phase === "connected") {
        this.phase = "failed";
        this.message = "O outro aparelho saiu.";
      }
    });
    ch.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data)) as {
        t: string;
        at?: number;
        text?: string;
      };
      if (m.t === "ping") ch.send(JSON.stringify({ t: "pong", at: m.at }));
      else if (m.t === "pong" && m.at) {
        const r = performance.now() - m.at;
        this.rtt = r;
        this.rtts = [...this.rtts.slice(-19), r];
        this.rttAvg = this.rtts.reduce((a, b) => a + b, 0) / this.rtts.length;
      } else if (m.t === "hi") this.say(`chegou: ${m.text}`);
    });
  }

  private ping() {
    if (this.channel?.readyState === "open") {
      this.channel.send(JSON.stringify({ t: "ping", at: performance.now() }));
    }
  }

  private async readPair() {
    if (!this.pc) return;
    const stats = await this.pc.getStats();
    let pairId: string | undefined;
    stats.forEach((s) => {
      if (s.type === "transport" && s.selectedCandidatePairId) {
        pairId = s.selectedCandidatePairId;
      }
    });
    stats.forEach((s) => {
      if (
        !pairId &&
        s.type === "candidate-pair" &&
        s.nominated &&
        s.state === "succeeded"
      ) {
        pairId = s.id;
      }
    });
    const p = pairId ? stats.get(pairId) : undefined;
    if (!p) return;
    const l = stats.get(p.localCandidateId);
    const r = stats.get(p.remoteCandidateId);
    this.pair = {
      local: l?.candidateType ?? "?",
      remote: r?.candidateType ?? "?",
      protocol: l?.protocol ?? "?",
    };
    this.say(
      `caminho: ${this.pair.local} ↔ ${this.pair.remote} (${this.pair.protocol})`,
    );
  }

  private armTimeout() {
    window.clearTimeout(this.timeout);
    this.timeout = window.setTimeout(() => {
      if (this.phase !== "connected") this.fail();
    }, CONNECT_TIMEOUT_MS);
  }

  private fail() {
    if (this.phase === "failed" || this.phase === "connected") return;
    window.clearTimeout(this.timeout);
    this.phase = "failed";
    this.message =
      "Não conectou. Se um dos dois está no 4G/5G, a operadora pode estar " +
      "bloqueando conexão direta — anote a rede de cada um e me conte.";
  }

  private async createRoom() {
    const db = firestore();
    const me = currentUser();
    if (!db || !me) return;
    await this.reset();
    this.phase = "creating";
    this.log = [];
    this.code = Array.from(
      crypto.getRandomValues(new Uint8Array(6)),
      (b) => CODE_CHARS[b % CODE_CHARS.length],
    ).join("");
    this.isHost = true;
    const pc = this.newPeer();
    this.wireChannel(pc.createDataChannel("moworld", { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await this.waitForIce(pc);
    const ref = doc(db, "p2pTests", this.code);
    await setDoc(ref, {
      host: me.uid,
      offer: pc.localDescription?.sdp ?? "",
      createdAt: serverTimestamp(),
    });
    this.phase = "waiting";
    this.message =
      "Sala criada. No outro aparelho, toque em Entrar e digite o código.";
    this.say("oferta publicada");
    this.unsub = onSnapshot(ref, (snap) => {
      const answer = snap.data()?.answer as string | undefined;
      if (answer && pc.signalingState === "have-local-offer") {
        this.phase = "connecting";
        this.say("resposta recebida");
        this.armTimeout();
        void pc.setRemoteDescription({ type: "answer", sdp: answer });
      }
    });
  }

  private async joinRoom() {
    const db = firestore();
    const me = currentUser();
    const code = this.joinCode.trim().toUpperCase();
    if (!db || !me || code.length !== 6) return;
    await this.reset();
    this.code = code;
    this.phase = "joining";
    this.log = [];
    const ref = doc(db, "p2pTests", code);
    const snap = await getDoc(ref).catch(() => null);
    const offer = snap?.data()?.offer as string | undefined;
    if (!offer) {
      this.phase = "failed";
      this.message = "Sala não encontrada. Confira o código.";
      return;
    }
    const pc = this.newPeer();
    pc.addEventListener("datachannel", (e) => this.wireChannel(e.channel));
    await pc.setRemoteDescription({ type: "offer", sdp: offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.waitForIce(pc);
    await updateDoc(ref, {
      guest: me.uid,
      answer: pc.localDescription?.sdp ?? "",
    });
    this.phase = "connecting";
    this.message = "Conectando…";
    this.say("resposta publicada");
    this.armTimeout();
  }

  private close() {
    void this.reset();
    this.remove();
  }

  private pathText(): string {
    if (!this.pair) return "…";
    const a = TYPE_NAMES[this.pair.local] ?? this.pair.local;
    const b = TYPE_NAMES[this.pair.remote] ?? this.pair.remote;
    return a === b ? a : `${a} / ${b}`;
  }

  render() {
    const card =
      "fixed inset-0 z-[20000] flex items-center justify-center bg-black/70 p-3";
    const btn =
      "rounded-xl px-4 py-3 font-extrabold disabled:opacity-40 active:translate-y-px";
    const signedIn = this.account === "signed-in";
    const busy = ["creating", "joining", "connecting", "waiting"].includes(
      this.phase,
    );
    return html`
      <div class=${card}>
        <div
          class="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-white shadow-2xl"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-extrabold">🔌 Teste de conexão</h2>
            <button
              class="text-white/60 text-xl px-2"
              @click=${() => this.close()}
            >
              ✕
            </button>
          </div>
          <p class="mt-1 text-xs text-white/55">
            Testa se dois aparelhos conseguem jogar juntos. Faça uma vez na
            mesma Wi-Fi e outra com um dos dois no 4G/5G.
          </p>

          ${
            !signedIn
              ? html`<p
                  class="mt-4 rounded-lg bg-amber-500/15 p-3 text-sm text-amber-200"
                >
                  Entre com Google (canto de cima da tela inicial) nos dois
                  aparelhos antes de testar.
                </p>`
              : html`
                  <div class="mt-4 grid grid-cols-2 gap-2">
                    <button
                      class="${btn} bg-amber-400 text-slate-900"
                      ?disabled=${busy}
                      @click=${() => this.createRoom()}
                    >
                      Criar sala
                    </button>
                    <div class="flex gap-1">
                      <input
                        class="min-w-0 flex-1 rounded-xl bg-white/10 px-3 text-center font-mono text-lg uppercase tracking-widest"
                        maxlength="6"
                        placeholder="CÓDIGO"
                        .value=${this.joinCode}
                        @input=${(e: Event) =>
                          (this.joinCode = (
                            e.target as HTMLInputElement
                          ).value)}
                      />
                      <button
                        class="${btn} bg-sky-500 px-3"
                        ?disabled=${busy || this.joinCode.trim().length !== 6}
                        @click=${() => this.joinRoom()}
                      >
                        Entrar
                      </button>
                    </div>
                  </div>
                `
          }
          ${
            this.code && this.isHost && this.phase !== "connected"
              ? html`<div class="mt-4 text-center">
                  <div class="text-xs text-white/55">Código da sala</div>
                  <div class="font-mono text-4xl font-black tracking-[0.3em]">
                    ${this.code}
                  </div>
                </div>`
              : nothing
          }
          ${
            this.message
              ? html`<p
                  class="mt-3 text-sm ${
                    this.phase === "failed"
                      ? "text-red-300"
                      : this.phase === "connected"
                        ? "text-emerald-300"
                        : "text-white/80"
                  }"
                >
                  ${this.message}
                </p>`
              : nothing
          }
          ${
            this.phase === "connected"
              ? html`<div class="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div class="rounded-lg bg-white/5 p-2">
                    <div class="text-[11px] uppercase text-white/50">
                      Atraso
                    </div>
                    <div class="text-2xl font-black">
                      ${this.rtt === null ? "…" : `${Math.round(this.rtt)} ms`}
                    </div>
                    <div class="text-[11px] text-white/50">
                      média
                      ${this.rttAvg === null ? "…" : Math.round(this.rttAvg)} ms
                    </div>
                  </div>
                  <div class="rounded-lg bg-white/5 p-2">
                    <div class="text-[11px] uppercase text-white/50">
                      Caminho
                    </div>
                    <div class="text-sm font-bold">${this.pathText()}</div>
                  </div>
                  <button
                    class="${btn} col-span-2 bg-white/10"
                    @click=${() => {
                      this.channel?.send(
                        JSON.stringify({
                          t: "hi",
                          text: `oi de ${currentUser()?.name ?? "?"}`,
                        }),
                      );
                      this.say("enviado: oi");
                    }}
                  >
                    👋 Mandar "oi"
                  </button>
                </div>`
              : nothing
          }
          ${
            this.log.length > 0
              ? html`<pre
                  class="mt-3 max-h-36 overflow-auto rounded-lg bg-black/40 p-2 text-[10px] leading-snug text-white/60"
                >
${this.log.join("\n")}</pre>`
              : nothing
          }
        </div>
      </div>
    `;
  }
}

/** Abre o teste de conexão por cima da tela inicial. */
export function openP2PTest() {
  if (!document.querySelector("moworld-p2p-test")) {
    document.body.appendChild(document.createElement("moworld-p2p-test"));
  }
}
