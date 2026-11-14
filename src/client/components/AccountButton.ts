// MoWorld: botão de conta na tela inicial (login Google opcional).
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  accountStatus,
  AccountStatus,
  currentUser,
  initAccount,
  onAccountChange,
  signInWithGoogle,
  signOutAccount,
} from "../Account";

@customElement("moworld-account-button")
export class AccountButton extends LitElement {
  /** Versão da barra do topo: sem a dica embaixo, menu alinhado à esquerda. */
  @property({ type: Boolean }) compact = false;
  @state() private status: AccountStatus = accountStatus();
  @state() private busy = false;
  @state() private menuOpen = false;
  @state() private error: string | null = null;
  private off: (() => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.off = onAccountChange(() => {
      this.status = accountStatus();
      this.busy = false;
    });
    void initAccount().then(() => (this.status = accountStatus()));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.off?.();
  }

  private async signIn() {
    this.error = null;
    this.busy = true;
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      this.error =
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
          ? null
          : navigator.onLine
            ? "Não foi possível entrar. Tente de novo."
            : "Sem internet: o login precisa de conexão.";
    } finally {
      this.busy = false;
    }
  }

  private googleLogo() {
    return html`<svg class="size-4" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>`;
  }

  render() {
    const pill =
      "inline-flex items-center gap-2 h-9 rounded-full border border-white/15 bg-slate-950/70 px-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-slate-900/90 disabled:opacity-60";
    if (this.status === "loading") return nothing;
    if (this.status === "unavailable") {
      return html`<span
        class="text-[11px] text-white/40 whitespace-nowrap"
        title="Conta indisponível sem internet"
        >${this.compact ? "☁ Sem conexão" : "Conta indisponível sem internet"}</span
      >`;
    }
    if (this.status === "signed-out") {
      if (this.compact) {
        return html`<button
          type="button"
          class=${pill}
          data-moworld-sign-in
          title=${this.error ?? "Opcional · guarda seu histórico na nuvem"}
          ?disabled=${this.busy}
          @click=${() => this.signIn()}
        >
          ${this.googleLogo()} ${this.busy ? "Entrando…" : "Entrar com Google"}
        </button>`;
      }
      return html`<div class="flex flex-col items-center gap-1">
        <button
          type="button"
          class=${pill}
          data-moworld-sign-in
          ?disabled=${this.busy}
          @click=${() => this.signIn()}
        >
          ${this.googleLogo()} ${this.busy ? "Entrando…" : "Entrar com Google"}
        </button>
        <span class="text-[11px] text-white/45"
          >${this.error ?? "Opcional · guarda seu histórico na nuvem"}</span
        >
      </div>`;
    }
    const u = currentUser();
    if (!u) return nothing;
    const first = u.name.split(" ")[0];
    return html`<div
      class="relative flex flex-col ${this.compact ? "items-start" : "items-center"}"
    >
      <button
        type="button"
        class=${pill}
        data-moworld-account
        @click=${() => (this.menuOpen = !this.menuOpen)}
      >
        ${
          u.photoURL
            ? html`<img
                src=${u.photoURL}
                alt=""
                referrerpolicy="no-referrer"
                class="size-6 rounded-full"
              />`
            : html`<span
                class="flex size-6 items-center justify-center rounded-full bg-amber-400 text-xs font-black text-slate-900"
                >${first.charAt(0).toUpperCase()}</span
              >`
        }
        <span>${first}</span>
        <span class="text-[11px] text-emerald-300">☁</span>
      </button>
      ${
        this.menuOpen
          ? html`<div
              class="absolute top-11 ${this.compact ? "left-0" : ""} z-[100] w-56 rounded-xl border border-white/10 bg-slate-950/95 p-2 text-left shadow-2xl"
            >
              <div class="px-2 py-1 text-xs text-white/55 truncate">
                ${u.email ?? u.name}
              </div>
              <button
                type="button"
                data-moworld-sign-out
                class="mt-1 w-full rounded-lg px-2 py-2 text-left text-sm font-semibold text-red-300 hover:bg-white/10"
                @click=${async () => {
                  this.menuOpen = false;
                  await signOutAccount();
                }}
              >
                Sair da conta
              </button>
            </div>`
          : nothing
      }
    </div>`;
  }
}
