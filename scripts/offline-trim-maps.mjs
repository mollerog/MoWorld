// OFFLINE: apaga do build (static/maps) todo mapa que não é "featured" nem o
// mapa do tutorial, para o APK não carregar ~750 MB de mapas.
// Uso: npm run build-offline  (faz o vite build e depois roda este script)
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const gen = readFileSync(
  path.join(root, "packages/engine-api/src/game/Maps.gen.ts"),
  "utf8",
);

// GameMapType.X -> pasta do mapa (vem do comentário gerado no enum)
const dirOf = new Map(
  [
    ...gen.matchAll(
      /^\s+(\w+) = "[^"]+", \/\/ map-generator\/assets\/maps\/([^/]+)\/info\.json/gm,
    ),
  ].map((m) => [m[1], m[2]]),
);

const keep = new Set();
const list = gen.slice(gen.indexOf("export const maps"));
for (const block of list.split("\n  {\n").slice(1)) {
  const type = block.match(/type: GameMapType\.(\w+)/)?.[1];
  const categories = block.split("categories:")[1]?.split("]")[0] ?? "";
  if (type && (categories.includes('"featured"') || block.includes("hidden: true"))) {
    keep.add(dirOf.get(type));
  }
}

// build de dev: static/maps | build de produção: static/_assets/maps
const mapsDir = ["static/_assets/maps", "static/maps"]
  .map((d) => path.join(root, d))
  .find((d) => existsSync(d));
if (!mapsDir) throw new Error("Pasta de mapas não encontrada. Rode o build antes.");
let removed = 0;
for (const dir of readdirSync(mapsDir)) {
  if (!keep.has(dir)) {
    rmSync(path.join(mapsDir, dir), { recursive: true, force: true });
    removed++;
  }
}
console.log(`Mapas mantidos: ${[...keep].join(", ")} | removidos: ${removed}`);
