// MoWorld: testes das regras do Firestore (firestore.rules), rodados no
// emulador pelo GitHub Actions antes de publicar.
//   npx firebase emulators:exec --only firestore "node --test <este arquivo>"
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

const rulesPath = process.env.RULES_PATH ?? new URL("../../firestore.rules", import.meta.url).pathname;
let env;

const match = (id, extra = {}) => ({
  id,
  startedAt: "2026-11-13T10:00:00.000Z",
  map: "World",
  difficulty: "Medium",
  result: "victory",
  share: 80.2,
  bestShare: 80.2,
  seconds: 1800,
  resumed: false,
  ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "moworld-rules-test",
    firestore: { rules: readFileSync(rulesPath, "utf8") },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

const gabriel = () => env.authenticatedContext("gabriel").firestore();
const milena = () => env.authenticatedContext("milena").firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("dono grava, lê, lista e apaga as próprias partidas", async () => {
  const db = gabriel();
  const ref = doc(db, "users/gabriel/matches/m1");
  await assertSucceeds(setDoc(ref, match("m1")));
  await assertSucceeds(setDoc(ref, match("m1", { result: "total", share: 100, bestShare: 100 })));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(collection(db, "users/gabriel/matches")));
  await assertSucceeds(deleteDoc(ref));
});

test("outra conta não lê nem grava no histórico alheio", async () => {
  await assertSucceeds(setDoc(doc(gabriel(), "users/gabriel/matches/m1"), match("m1")));
  const db = milena();
  await assertFails(getDoc(doc(db, "users/gabriel/matches/m1")));
  await assertFails(getDocs(collection(db, "users/gabriel/matches")));
  await assertFails(setDoc(doc(db, "users/gabriel/matches/m2"), match("m2")));
  await assertFails(deleteDoc(doc(db, "users/gabriel/matches/m1")));
});

test("sem login não lê nem grava nada", async () => {
  const db = anon();
  await assertFails(getDoc(doc(db, "users/gabriel/matches/m1")));
  await assertFails(setDoc(doc(db, "users/gabriel/matches/m1"), match("m1")));
});

test("rejeita dados inválidos", async () => {
  const db = gabriel();
  const bad = [
    match("x1", { result: "hack" }),
    match("x2", { share: 150 }),
    match("x3", { seconds: -5 }),
    match("x4", { seconds: 1.5 }),
    match("x5", { extra: "campo a mais" }),
    match("outro-id"),
    match("x7", { map: "M".repeat(200) }),
  ];
  const ids = ["x1", "x2", "x3", "x4", "x5", "x6", "x7"];
  for (let i = 0; i < bad.length; i++) {
    await assertFails(setDoc(doc(db, `users/gabriel/matches/${ids[i]}`), bad[i]));
  }
});

test("nada fora de users/{uid}/matches é acessível", async () => {
  const db = gabriel();
  await assertFails(setDoc(doc(db, "users/gabriel"), { a: 1 }));
  await assertFails(setDoc(doc(db, "outra/coisa"), { a: 1 }));
  await assertFails(getDoc(doc(db, "users/gabriel")));
});

// ---- Teste de conexão (#p2p) ----
const room = (host) => ({ host, offer: "v=0 oferta", createdAt: serverTimestamp() });

test("p2p: logado cria sala com o próprio uid; outro responde uma vez", async () => {
  await assertSucceeds(setDoc(doc(gabriel(), "p2pTests/ABC234"), room("gabriel")));
  await assertSucceeds(getDoc(doc(milena(), "p2pTests/ABC234")));
  await assertSucceeds(
    updateDoc(doc(milena(), "p2pTests/ABC234"), { guest: "milena", answer: "v=0 resposta" }),
  );
  // Segunda resposta (sequestro da sala) é negada.
  const intruso = env.authenticatedContext("intruso").firestore();
  await assertFails(
    updateDoc(doc(intruso, "p2pTests/ABC234"), { guest: "intruso", answer: "x" }),
  );
  await assertFails(deleteDoc(doc(milena(), "p2pTests/ABC234")));
  await assertSucceeds(deleteDoc(doc(gabriel(), "p2pTests/ABC234")));
});

test("p2p: regras negam sala inválida, sem login ou trocando a oferta", async () => {
  await assertFails(setDoc(doc(anon(), "p2pTests/ABC234"), room("gabriel")));
  await assertFails(setDoc(doc(gabriel(), "p2pTests/ABC234"), room("milena")));
  await assertFails(setDoc(doc(gabriel(), "p2pTests/abc"), room("gabriel")));
  await assertFails(
    setDoc(doc(gabriel(), "p2pTests/ABC235"), { ...room("gabriel"), extra: 1 }),
  );
  await assertSucceeds(setDoc(doc(gabriel(), "p2pTests/ABC236"), room("gabriel")));
  await assertFails(updateDoc(doc(milena(), "p2pTests/ABC236"), { offer: "trocada" }));
  await assertFails(
    updateDoc(doc(gabriel(), "p2pTests/ABC236"), { guest: "gabriel", answer: "x" }),
  );
  await assertFails(getDoc(doc(anon(), "p2pTests/ABC236")));
});
