// MoWorld: ligação direta entre dois aparelhos (WebRTC DataChannel).
//
// O Firestore só serve para os dois se acharem: quem cria a sala publica uma
// "oferta" num documento p2pTests/{código}; quem entra publica a "resposta".
// Depois disso tudo vai direto de um aparelho para o outro.
//
// Mensagens:
//   - controle (lobby, pausa, etc.): objetos JSON;
//   - jogo: bytes (o mesmo formato binário que o servidor oficial usa),
//     divididos em pedaços quando passam do limite do canal.
//
// Para testar sem Firebase (dois abas no mesmo navegador), a sinalização pode
// ser feita por BroadcastChannel: `?p2plocal` no endereço.
import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { currentUser, firestore } from "../Account";

const ICE: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
    },
  ],
};
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CHUNK = 60_000;
export const CONNECT_TIMEOUT_MS = 25_000;

export function randomRoomCode(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (b) => CODE_CHARS[b % CODE_CHARS.length],
  ).join("");
}

// ---------------------------------------------------------------- sinalização

export interface Signaling {
  publishOffer(code: string, sdp: string): Promise<void>;
  onAnswer(code: string, cb: (sdp: string) => void): () => void;
  readOffer(code: string): Promise<string | null>;
  publishAnswer(code: string, sdp: string): Promise<void>;
  remove(code: string): Promise<void>;
}

export function firestoreSignaling(): Signaling {
  const db = () => {
    const d = firestore();
    if (!d || !currentUser()) throw new Error("login");
    return d;
  };
  return {
    async publishOffer(code, sdp) {
      await setDoc(doc(db(), "p2pTests", code), {
        host: currentUser()!.uid,
        offer: sdp,
        createdAt: serverTimestamp(),
      });
    },
    onAnswer(code, cb) {
      return onSnapshot(doc(db(), "p2pTests", code), (snap) => {
        const a = snap.data()?.answer as string | undefined;
        if (a) cb(a);
      });
    },
    async readOffer(code) {
      const snap = await getDoc(doc(db(), "p2pTests", code));
      return (snap.data()?.offer as string | undefined) ?? null;
    },
    async publishAnswer(code, sdp) {
      await updateDoc(doc(db(), "p2pTests", code), {
        guest: currentUser()!.uid,
        answer: sdp,
      });
    },
    async remove(code) {
      await deleteDoc(doc(db(), "p2pTests", code)).catch(() => {});
    },
  };
}

/** Só para teste local: duas abas do mesmo navegador. */
export function broadcastSignaling(): Signaling {
  const bc = new BroadcastChannel("moworld-p2p-local");
  const offers = new Map<string, string>();
  const answers = new Map<string, string>();
  const listeners = new Map<string, (sdp: string) => void>();
  bc.onmessage = (e) => {
    const m = e.data as { t: string; code: string; sdp?: string };
    if (m.t === "offer" && m.sdp) offers.set(m.code, m.sdp);
    if (m.t === "ask" && offers.has(m.code))
      bc.postMessage({ t: "offer", code: m.code, sdp: offers.get(m.code) });
    if (m.t === "answer" && m.sdp) {
      answers.set(m.code, m.sdp);
      listeners.get(m.code)?.(m.sdp);
    }
  };
  return {
    async publishOffer(code, sdp) {
      offers.set(code, sdp);
      bc.postMessage({ t: "offer", code, sdp });
    },
    onAnswer(code, cb) {
      listeners.set(code, cb);
      return () => listeners.delete(code);
    },
    async readOffer(code) {
      bc.postMessage({ t: "ask", code });
      for (let i = 0; i < 30 && !offers.has(code); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return offers.get(code) ?? null;
    },
    async publishAnswer(code, sdp) {
      bc.postMessage({ t: "answer", code, sdp });
    },
    async remove() {},
  };
}

export function defaultSignaling(): Signaling {
  return new URLSearchParams(location.search).has("p2plocal")
    ? broadcastSignaling()
    : firestoreSignaling();
}

// ---------------------------------------------------------------- ligação

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", check);
    window.setTimeout(done, 5000);
  });
}

type JsonHandler = (msg: Record<string, unknown>) => void;
type BinHandler = (bytes: Uint8Array) => void;

export class PeerLink {
  private jsonHandlers = new Set<JsonHandler>();
  private binHandlers = new Set<BinHandler>();
  private binQueue: Uint8Array[] = [];
  private closeHandlers = new Set<() => void>();
  private pending: { id: number; n: number; parts: Uint8Array[] } | null = null;
  private nextId = 1;
  private closed = false;
  public rtt: number | null = null;
  private pingTimer = 0;

  private constructor(
    private pc: RTCPeerConnection,
    private ch: RTCDataChannel,
  ) {
    ch.binaryType = "arraybuffer";
    ch.addEventListener("message", (e) => this.onRaw(e.data));
    ch.addEventListener("close", () => this.markClosed());
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.markClosed();
      }
    });
    this.pingTimer = window.setInterval(() => {
      this.sendJson({ k: "_ping", at: performance.now() });
    }, 2000);
  }

  /** Cria a sala. `ready` resolve quando o outro aparelho conectar. */
  static async host(
    signaling: Signaling,
  ): Promise<{ code: string; ready: Promise<PeerLink>; cancel: () => void }> {
    const code = randomRoomCode();
    const pc = new RTCPeerConnection(ICE);
    const ch = pc.createDataChannel("moworld", { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    await signaling.publishOffer(code, pc.localDescription?.sdp ?? "");
    let stop: () => void = () => {};
    const ready = new Promise<PeerLink>((resolve, reject) => {
      stop = signaling.onAnswer(code, (sdp) => {
        if (pc.signalingState !== "have-local-offer") return;
        void pc.setRemoteDescription({ type: "answer", sdp });
        const t = window.setTimeout(
          () => reject(new Error("timeout")),
          CONNECT_TIMEOUT_MS,
        );
        ch.addEventListener("open", () => {
          window.clearTimeout(t);
          stop();
          void signaling.remove(code);
          resolve(new PeerLink(pc, ch));
        });
      });
    });
    return {
      code,
      ready,
      cancel: () => {
        stop();
        void signaling.remove(code);
        pc.close();
      },
    };
  }

  /** Entra na sala com o código. */
  static async join(signaling: Signaling, code: string): Promise<PeerLink> {
    const offer = await signaling.readOffer(code);
    if (!offer) throw new Error("not_found");
    const pc = new RTCPeerConnection(ICE);
    const chP = new Promise<RTCDataChannel>((resolve, reject) => {
      pc.addEventListener("datachannel", (e) => {
        const ch = e.channel;
        if (ch.readyState === "open") resolve(ch);
        else ch.addEventListener("open", () => resolve(ch));
      });
      window.setTimeout(() => reject(new Error("timeout")), CONNECT_TIMEOUT_MS);
    });
    await pc.setRemoteDescription({ type: "offer", sdp: offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);
    await signaling.publishAnswer(code, pc.localDescription?.sdp ?? "");
    const ch = await chP;
    return new PeerLink(pc, ch);
  }

  get isOpen(): boolean {
    return !this.closed && this.ch.readyState === "open";
  }

  onJson(h: JsonHandler): () => void {
    this.jsonHandlers.add(h);
    return () => this.jsonHandlers.delete(h);
  }
  onBinary(h: BinHandler): () => void {
    this.binHandlers.add(h);
    // Entrega o que chegou antes de alguém estar ouvindo (o outro lado pode
    // ser mais rápido para abrir a partida).
    const queued = this.binQueue.splice(0);
    for (const b of queued) h(b);
    return () => this.binHandlers.delete(h);
  }
  onClose(h: () => void): () => void {
    if (this.closed) h();
    this.closeHandlers.add(h);
    return () => this.closeHandlers.delete(h);
  }

  sendJson(msg: Record<string, unknown>) {
    if (!this.isOpen) return;
    this.ch.send(JSON.stringify(msg));
  }

  sendBinary(bytes: Uint8Array<ArrayBuffer>) {
    if (!this.isOpen) return;
    if (bytes.byteLength <= CHUNK) {
      this.ch.send(bytes);
      return;
    }
    const n = Math.ceil(bytes.byteLength / CHUNK);
    this.ch.send(JSON.stringify({ k: "_big", id: this.nextId++, n }));
    for (let i = 0; i < n; i++) {
      this.ch.send(bytes.slice(i * CHUNK, (i + 1) * CHUNK));
    }
  }

  close() {
    this.markClosed();
    try {
      this.ch.close();
      this.pc.close();
    } catch {
      /* já fechado */
    }
  }

  private markClosed() {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.pingTimer);
    for (const h of this.closeHandlers) h();
  }

  private onRaw(data: unknown) {
    if (typeof data === "string") {
      const msg = JSON.parse(data) as Record<string, unknown>;
      if (msg.k === "_ping") {
        this.sendJson({ k: "_pong", at: msg.at });
        return;
      }
      if (msg.k === "_pong") {
        this.rtt = performance.now() - Number(msg.at);
        return;
      }
      if (msg.k === "_big") {
        this.pending = { id: Number(msg.id), n: Number(msg.n), parts: [] };
        return;
      }
      for (const h of this.jsonHandlers) h(msg);
      return;
    }
    const bytes = new Uint8Array(data as ArrayBuffer);
    if (this.pending) {
      this.pending.parts.push(bytes);
      if (this.pending.parts.length < this.pending.n) return;
      const total = this.pending.parts.reduce((a, p) => a + p.byteLength, 0);
      const all = new Uint8Array(total);
      let off = 0;
      for (const p of this.pending.parts) {
        all.set(p, off);
        off += p.byteLength;
      }
      this.pending = null;
      this.deliverBinary(all);
      return;
    }
    this.deliverBinary(bytes);
  }

  private deliverBinary(bytes: Uint8Array) {
    if (this.binHandlers.size === 0) {
      this.binQueue.push(bytes);
      return;
    }
    for (const h of this.binHandlers) h(bytes);
  }
}
