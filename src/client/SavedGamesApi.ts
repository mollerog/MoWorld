import {
  type SavedGame,
  SavedGameSchema,
} from "@openfront/shared/ApiSchemas";

// Saved singleplayer games. The API stores the gzipped bytes of a game
// snapshot (WorkerClient.snapshot()) as they are; it never decodes them.

// A late-game World snapshot is about 2.7 MB raw. A shared save is anyone's
// upload, so a download that inflates past this is a gzip bomb, not a game.
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export type SavedGameError =
  // No session, or the API refused it.
  | "unauthorized"
  // The player already has as many saves as the API keeps.
  | "limit"
  // The API refused the request as sent: a name it won't show on a shared
  // save, or a snapshot it won't store.
  | "rejected"
  | "not_found"
  | "request_failed";

// MoWorld: os saves ficam no próprio aparelho (IndexedDB), sem conta e sem
// servidor. As funções mantêm a mesma assinatura da versão online, então o
// resto do jogo (menu de salvar, painel de saves) funciona igual.
// Compartilhar saves exige servidor e fica desligado.

const DB_NAME = "moworld-saves";
const STORE_META = "meta";
const STORE_DATA = "data";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META))
        db.createObjectStore(STORE_META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_DATA))
        db.createObjectStore(STORE_DATA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const req = run(t);
      let result: T | undefined;
      if (req) req.onsuccess = () => (result = req.result);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

async function getMeta(id: string): Promise<SavedGame | undefined> {
  return tx<SavedGame>([STORE_META], "readonly", (t) =>
    t.objectStore(STORE_META).get(id),
  );
}

export async function listSavedGames(): Promise<SavedGame[] | false> {
  try {
    const all =
      (await tx<SavedGame[]>([STORE_META], "readonly", (t) =>
        t.objectStore(STORE_META).getAll(),
      )) ?? [];
    return all
      .filter((s) => SavedGameSchema.safeParse(s).success)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    console.warn("listSavedGames: IndexedDB failed", err);
    return false;
  }
}

/** Salva um snapshot (descomprimido) como um save novo no aparelho. */
export async function uploadSavedGame(
  snapshot: Uint8Array,
  meta: { name: string; map: string; tick: number },
): Promise<SavedGame | SavedGameError> {
  try {
    const data = await gzip(snapshot);
    const save: SavedGame = {
      id: newId(),
      name: meta.name.slice(0, 64),
      map: meta.map,
      tick: meta.tick,
      sizeBytes: data.byteLength,
      public: false,
      createdAt: new Date().toISOString(),
    };
    await tx([STORE_META, STORE_DATA], "readwrite", (t) => {
      t.objectStore(STORE_META).put(save);
      t.objectStore(STORE_DATA).put(data, save.id);
    });
    return save;
  } catch (err) {
    console.warn("uploadSavedGame: IndexedDB failed", err);
    return "request_failed";
  }
}

/** Renomeia um save. (Compartilhar não existe offline.) */
export async function updateSavedGame(
  id: string,
  update: { name?: string; public?: boolean },
): Promise<SavedGame | SavedGameError> {
  try {
    const save = await getMeta(id);
    if (!save) return "not_found";
    if (update.public) return "rejected";
    const next: SavedGame = {
      ...save,
      name: update.name !== undefined ? update.name.slice(0, 64) : save.name,
      public: false,
    };
    await tx([STORE_META], "readwrite", (t) => {
      t.objectStore(STORE_META).put(next);
    });
    return next;
  } catch (err) {
    console.warn("updateSavedGame: IndexedDB failed", err);
    return "request_failed";
  }
}

export async function deleteSavedGame(
  id: string,
): Promise<true | SavedGameError> {
  try {
    await tx([STORE_META, STORE_DATA], "readwrite", (t) => {
      t.objectStore(STORE_META).delete(id);
      t.objectStore(STORE_DATA).delete(id);
    });
    return true;
  } catch (err) {
    console.warn("deleteSavedGame: IndexedDB failed", err);
    return "request_failed";
  }
}

/** Saves compartilhados dependem de servidor: não existem offline. */
export async function fetchSharedSavedGame(
  _id: string,
): Promise<SavedGame | SavedGameError> {
  return "not_found";
}

/** O snapshot de um save, descomprimido e pronto para restaurar. */
export async function downloadSavedGame(
  id: string,
  shared: boolean,
): Promise<Uint8Array | SavedGameError> {
  if (shared) return "not_found";
  try {
    const data = await tx<Uint8Array>([STORE_DATA], "readonly", (t) =>
      t.objectStore(STORE_DATA).get(id),
    );
    if (!data) return "not_found";
    return await gunzip(new Uint8Array(data));
  } catch (err) {
    console.warn("downloadSavedGame: failed", err);
    return "request_failed";
  }
}

export async function gzip(
  bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  return readAll(
    streamOf(bytes).pipeThrough(new CompressionStream("gzip")),
    Infinity,
  );
}

/** Inflates gzip, refusing to go past `max` bytes. */
export async function gunzip(
  bytes: Uint8Array,
  max = MAX_SNAPSHOT_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  return readAll(
    streamOf(bytes).pipeThrough(new DecompressionStream("gzip")),
    max,
  );
}

function streamOf(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as BufferSource);
      controller.close();
    },
  });
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
  max: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new Error("Snapshot is too large");
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
