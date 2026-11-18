#!/usr/bin/env node
// MoWorld: simulação de equilíbrio. Roda várias partidas só de nações no
// mapa-múndi (tests/balance/SoloBalance.test.ts), em paralelo, e resume:
// em que minuto alguém vence, quantas nações sobram e quanto o líder domina.
//
//   node scripts/balance.mjs                      # 6 partidas × 30 min, Médio
//   node scripts/balance.mjs --games 6 --minutes 30 --difficulties Easy,Medium,Hard --jobs 2
//   node scripts/balance.mjs --summary-only --difficulties Easy,Medium,Hard --minutes 30
//
// O resumo sai no terminal e em <out>/summary.md; os dados brutos ficam em
// <out>/*.json. Rode antes e depois de mexer numa regra e compare.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const games = Number(arg("games", 6));
const minutes = Number(arg("minutes", 30));
const difficulties = arg("difficulties", "Medium").split(",");
const jobs = Number(arg("jobs", Math.max(1, os.cpus().length)));
const out = arg("out", "/tmp/moworld-balance");
if (!process.argv.includes("--summary-only")) {
  fs.rmSync(out, { recursive: true, force: true });
}
fs.mkdirSync(out, { recursive: true });

// Fila de trabalhos: cada um é uma partida (dificuldade + semente).
const queue = [];
for (const d of difficulties)
  for (let s = 1; s <= games; s++) queue.push({ d, seed: String(s) });

function run({ d, seed }) {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["vitest", "run", "tests/balance/SoloBalance.test.ts"],
      {
        env: {
          ...process.env,
          MOWORLD_BALANCE: "1",
          MOWORLD_BALANCE_SEEDS: seed,
          MOWORLD_BALANCE_MINUTES: String(minutes),
          MOWORLD_BALANCE_DIFFICULTY: d,
          MOWORLD_BALANCE_OUT: out,
        },
        stdio: "ignore",
      },
    );
    child.on("exit", (code) => {
      console.log(`${d} #${seed}: ${code === 0 ? "ok" : `falhou (${code})`}`);
      resolve();
    });
  });
}

const started = Date.now();
// --summary-only: só refaz o resumo com os .json que já estão em <out>.
if (process.argv.includes("--summary-only")) queue.length = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (queue.length > 0) await run(queue.shift());
  }),
);

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 10) / 10;
};
const range = (xs) =>
  xs.length === 0
    ? "—"
    : `${median(xs)} (${Math.min(...xs)}–${Math.max(...xs)})`;

const results = fs
  .readdirSync(out)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")));
const marks = [5, 10, 20, 30, 45, 60].filter((m) => m <= minutes);
const lines = [
  `# Equilíbrio do MoWorld — ${results.length} partidas, ${minutes} min, mapa-múndi, só nações`,
  "",
  "Mediana (mín–máx) entre as partidas.",
  "",
];
for (const d of difficulties) {
  const rs = results.filter((r) => r.difficulty === d);
  if (rs.length === 0) continue;
  const won = rs.filter((r) => r.winMinute !== null).map((r) => r.winMinute);
  lines.push(`## ${d} (${rs.length} partidas, ${rs[0].nations} nações)`, "");
  lines.push(
    `- Alguém passou da meta em ${won.length} de ${rs.length}; minuto: ${range(won)}`,
    "",
  );
  lines.push("| minuto | nações vivas | líder (% da terra) | 3 maiores (%) |");
  lines.push("|---|---|---|---|");
  for (const m of marks) {
    const at = rs.map((r) => r.samples[m - 1]).filter(Boolean);
    lines.push(
      `| ${m} | ${range(at.map((s) => s.alive))} | ${range(at.map((s) => s.leaderShare))} | ${range(at.map((s) => s.top3Share))} |`,
    );
  }
  lines.push("");
}
lines.push(
  `_Rodou em ${Math.round((Date.now() - started) / 60000)} min. Sem jogador humano e sem tribos: mede a dinâmica das nações._`,
);
const summary = lines.join("\n");
fs.writeFileSync(path.join(out, "summary.md"), summary + "\n");
console.log("\n" + summary);
