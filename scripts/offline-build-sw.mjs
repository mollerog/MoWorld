// OFFLINE: gera static/sw.js, o service worker que guarda o jogo no aparelho.
//
// - Primeiro acesso: baixa todos os arquivos do build e o jogo passa a abrir
//   sem internet.
// - Atualização: cada arquivo vai com um hash do conteúdo, e só os arquivos
//   que mudaram são baixados (não os 116 MB de novo).
// - A versão nova fica "esperando" até a página mandar aplicar (o index.html
//   aplica sozinho fora da partida, ou quando o jogador toca no aviso), para
//   nunca trocar arquivos debaixo de uma partida em andamento.
//
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
const all = createHash("sha256");
const entries = {}; // url -> [hash, bytes]
let totalBytes = 0;
for (const f of files) {
  const buf = readFileSync(path.join(outDir, f));
  const h = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  // Mesma forma que o navegador usa (acentos/espaços codificados como %XX),
  // senão arquivos como bandeiras "Côte d'Ivoire" não batem com o cache.
  const url = f === "index.html" ? "/" : new URL(f, "http://x/").pathname;
  entries[url] = [h, buf.length];
  totalBytes += buf.length;
  all.update(url).update(h);
}
const version = all.digest("hex").slice(0, 12);

const sw = `// Gerado por scripts/offline-build-sw.mjs. Não edite à mão.
const VERSION = ${JSON.stringify(version)};
// Um cache só, que dura entre versões. A chave de cada arquivo leva o hash
// do conteúdo, então um arquivo que não mudou não é baixado de novo.
const CACHE = "moworld-files";
const FILES = ${JSON.stringify(entries)};
const BATCH = 8;

const keyOf = (url) => url + "?h=" + FILES[url][0];
const keyFromRequest = (req) => {
  const u = new URL(req.url);
  return u.pathname + u.search;
};

async function report(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type: "moworld-sw", version: VERSION, ...msg });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const update = !!self.registration.active;
      const cache = await caches.open(CACHE);
      const have = new Set((await cache.keys()).map(keyFromRequest));
      const todo = Object.keys(FILES).filter((u) => !have.has(keyOf(u)));
      let done = 0;
      if (todo.length) report({ phase: "progress", update, done, total: todo.length });
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (url) => {
            const res = await fetch(url, { cache: "reload" });
            if (!res.ok) throw new Error("Falha ao baixar " + url + ": " + res.status);
            await cache.put(keyOf(url), res);
          }),
        );
        done += batch.length;
        report({ phase: "progress", update, done, total: todo.length });
      }
      // Primeira instalação: assume na hora. Atualização: espera a página.
      // Exceção: vindo do sw antigo (cache "openfront-offline-*"), cuja página
      // não sabe mandar "skip-waiting", assume na hora também (só uma vez).
      const legacy = (await caches.keys()).some((k) => k.startsWith("openfront-offline-"));
      if (!update || legacy) await self.skipWaiting();
      report({ phase: "installed", update });
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Caches de versões antigas do sw e arquivos que saíram do build.
      for (const key of await caches.keys()) {
        if (key !== CACHE && (key.startsWith("openfront-offline-") || key.startsWith("moworld-"))) {
          await caches.delete(key);
        }
      }
      const cache = await caches.open(CACHE);
      const keep = new Set(Object.keys(FILES).map(keyOf));
      for (const req of await cache.keys()) {
        if (!keep.has(keyFromRequest(req))) await cache.delete(req);
      }
      await self.clients.claim();
      report({ phase: "active" });
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Páginas reservadas do Firebase (/__/auth/handler, /__/auth/iframe,
  // /__/firebase/init.json) precisam vir da rede, senão o login não conclui.
  if (url.pathname.startsWith("/__/")) return;
  const path = req.mode === "navigate" ? "/" : url.pathname;
  if (!FILES[path]) return; // fora do build: deixa o navegador resolver

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(keyOf(path));
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
  `sw.js gerado: ${files.length} arquivos, ${(totalBytes / 1e6).toFixed(1)} MB, versão ${version}`,
);
