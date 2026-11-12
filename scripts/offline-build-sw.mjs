// OFFLINE: gera static/sw.js, um service worker que baixa e guarda TODOS os
// arquivos do build no primeiro acesso. Depois disso o jogo abre sem internet.
// Uso: npm run build-offline (roda depois do vite build e do corte de mapas).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "static");

// Arquivos que não precisam ir para o celular.
const SKIP = new Set(["sw.js", "news.json", "streams.json", "lemon-drizzle.md"]);

function walk(dir, base = "") {
  const files = [];
  for (const name of readdirSync(dir)) {
    const rel = base ? `${base}/${name}` : name;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full, rel));
    else if (!SKIP.has(rel)) files.push(rel);
  }
  return files;
}

const files = walk(outDir).sort();
const hash = createHash("sha256");
let totalBytes = 0;
for (const f of files) {
  const buf = readFileSync(path.join(outDir, f));
  totalBytes += buf.length;
  hash.update(f).update(buf);
}
const version = hash.digest("hex").slice(0, 12);
const urls = ["/", ...files.filter((f) => f !== "index.html").map((f) => "/" + f)];

const sw = `// Gerado por scripts/offline-build-sw.mjs. Não edite à mão.
const VERSION = ${JSON.stringify(version)};
const CACHE = "openfront-offline-" + VERSION;
const TOTAL_BYTES = ${totalBytes};
const URLS = ${JSON.stringify(urls)};
const BATCH = 8;

// Avisa a página do progresso do download (para mostrar uma barra).
async function report(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type: "offline-cache", ...msg });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      let done = 0;
      for (let i = 0; i < URLS.length; i += BATCH) {
        const batch = URLS.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (url) => {
            // Já guardado numa tentativa anterior? Pula.
            if (await cache.match(url)) return;
            const res = await fetch(url, { cache: "reload" });
            if (!res.ok) throw new Error("Falha ao baixar " + url + ": " + res.status);
            await cache.put(url, res);
          }),
        );
        done += batch.length;
        report({ done, total: URLS.length, totalBytes: TOTAL_BYTES });
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("openfront-offline-") && key !== CACHE) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
      report({ ready: true, version: VERSION });
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Navegação (abrir o app em qualquer caminho) sempre cai no index.html.
      if (req.mode === "navigate") {
        return (await cache.match("/")) ?? fetch(req);
      }
      const hit = await cache.match(url.pathname, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (e) {
        return new Response("offline", { status: 503 });
      }
    })(),
  );
});
`;

writeFileSync(path.join(outDir, "sw.js"), sw);
console.log(
  `sw.js gerado: ${urls.length} arquivos, ${(totalBytes / 1e6).toFixed(1)} MB, versão ${version}`,
);
