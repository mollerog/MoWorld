import type { WireGameStartInfo } from "@openfront/shared/WireSchemas";
import { broadcastSignaling } from "../../../src/client/peer/PeerLink";
import {
  clearCoopResume,
  readCoopResume,
  RESUME_TTL_MS,
  saveCoopResume,
} from "../../../src/client/peer/PeerSession";

// MoWorld: voltar à partida com amigos depois de fechar o app.
const record = {
  role: "guest" as const,
  code: "ABC234",
  gameID: "game1",
  partnerName: "Milena",
  gameStartInfo: {
    gameID: "game1",
    players: [],
  } as unknown as WireGameStartInfo,
};

describe("registro para voltar à partida", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  test("guarda, lê e apaga", () => {
    expect(readCoopResume()).toBeNull();
    saveCoopResume(record);
    expect(readCoopResume()).toMatchObject({
      code: "ABC234",
      role: "guest",
      partnerName: "Milena",
    });
    clearCoopResume();
    expect(readCoopResume()).toBeNull();
  });

  test("vence depois de algumas horas", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
    saveCoopResume(record);
    vi.setSystemTime(Date.now() + RESUME_TTL_MS - 1000);
    expect(readCoopResume()).not.toBeNull();
    vi.setSystemTime(Date.now() + 2000);
    expect(readCoopResume()).toBeNull();
  });
});

describe("sinalização local (duas abas)", () => {
  test("quem pergunta recebe a oferta nova da sala, não uma velha", async () => {
    // Uma instância antiga (ligação anterior) e a do anfitrião agora.
    const old = broadcastSignaling();
    await old.publishOffer("ROOM22", "oferta-velha");
    const host = broadcastSignaling();
    await host.publishOffer("ROOM22", "oferta-nova");
    await new Promise((r) => setTimeout(r, 20));
    const guest = broadcastSignaling();
    expect(await guest.readOffer("ROOM22")).toBe("oferta-nova");
  });
});
