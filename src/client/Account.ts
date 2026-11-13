// MoWorld: conta opcional com login Google (Firebase Auth + Firestore).
//
// - Sem login o jogo funciona igual (histórico só no aparelho).
// - A configuração do Firebase vem do próprio Firebase Hosting
//   (/__/firebase/init.json) e fica guardada no aparelho para funcionar
//   offline. Fora do Hosting (ex.: build local) a conta fica indisponível.
// - O Firestore usa cache persistente: gravações feitas offline sobem
//   sozinhas quando a internet volta.
import { FirebaseApp, initializeApp } from "firebase/app";
import {
  Auth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import {
  Firestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

export type AccountUser = {
  uid: string;
  name: string;
  email: string | null;
  photoURL: string | null;
};

export type AccountStatus =
  "loading" | "unavailable" | "signed-out" | "signed-in";

const CONFIG_KEY = "moworld-firebase-config";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let status: AccountStatus = "loading";
let user: AccountUser | null = null;
const listeners = new Set<() => void>();
let ready: Promise<void> | null = null;

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch (err) {
      console.warn("Account listener failed", err);
    }
  }
}

async function loadConfig(): Promise<Record<string, string> | null> {
  try {
    const res = await fetch("/__/firebase/init.json", { cache: "no-store" });
    if (res.ok) {
      const cfg = (await res.json()) as Record<string, string>;
      if (cfg?.apiKey && cfg?.projectId) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
        return cfg;
      }
    }
  } catch {
    // offline: usa a cópia guardada
  }
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

/** Inicia o Firebase (uma vez). Seguro chamar várias vezes. */
export function initAccount(): Promise<void> {
  ready ??= (async () => {
    const cfg = await loadConfig();
    if (!cfg) {
      status = "unavailable";
      notify();
      return;
    }
    // No próprio domínio do Hosting o login por redirecionamento funciona
    // sem cookies de terceiros (importante no celular e no app instalado).
    const host = location.hostname;
    const authDomain =
      host.endsWith(".web.app") || host.endsWith(".firebaseapp.com")
        ? host
        : cfg.authDomain;
    try {
      app = initializeApp({ ...cfg, authDomain });
      auth = initializeAuth(app, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence],
        popupRedirectResolver: browserPopupRedirectResolver,
      });
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch (err) {
      console.warn("Account: Firebase init failed", err);
      status = "unavailable";
      notify();
      return;
    }
    getRedirectResult(auth).catch((err) =>
      console.warn("Account: redirect sign-in failed", err),
    );
    await new Promise<void>((resolve) => {
      onAuthStateChanged(auth!, (u) => {
        user = u
          ? {
              uid: u.uid,
              name: u.displayName ?? u.email ?? "Jogador",
              email: u.email,
              photoURL: u.photoURL,
            }
          : null;
        status = u ? "signed-in" : "signed-out";
        notify();
        resolve();
      });
    });
  })();
  return ready;
}

export function accountStatus(): AccountStatus {
  return status;
}

export function currentUser(): AccountUser | null {
  return user;
}

export function firestore(): Firestore | null {
  return db;
}

/** Avisa quando o login muda. Devolve a função para cancelar. */
export function onAccountChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function preferRedirect(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(pointer: coarse)").matches
  );
}

export async function signInWithGoogle(): Promise<void> {
  await initAccount();
  if (!auth) throw new Error("Conta indisponível");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  if (preferRedirect()) {
    await signInWithRedirect(auth, provider);
    return;
  }
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (
      code === "auth/popup-blocked" ||
      code === "auth/operation-not-supported-in-this-environment"
    ) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

export async function signOutAccount(): Promise<void> {
  if (auth) await signOut(auth);
}
