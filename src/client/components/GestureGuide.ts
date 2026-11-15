// MoWorld: guia rápido dos controles próprios do MoWorld (o tutorial
// original não cobre nada disto). Aparece sozinho na primeira partida solo e
// pode ser aberto de novo pelo menu de configurações da partida.
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

const SEEN_KEY = "moworld-guide-seen";

type Card = { icon: string; title: string; lines: string[] };

function cards(touch: boolean): Card[] {
  const tap = touch ? "Toque" : "Clique";
  const tapL = touch ? "toque" : "clique";
  const hold = touch ? "Segure o dedo" : "Clique com o botão direito";
  return [
    {
      icon: "📍",
      title: "Começando",
      lines: [
        `${tap} no mapa onde quer nascer.`,
        "Você tem 10 segundos para trocar de lugar antes da partida começar.",
        "A meta é dominar 80% da terra.",
      ],
    },
    {
      icon: "⚔️",
      title: "Atacar",
      lines: [
        `${tap} numa nação, tribo ou terra livre: o cartão no canto mostra as tropas dela e se o seu ataque é forte, equilibrado ou fraco.`,
        `${tap} de novo no mesmo lugar para atacar. Em ilha ou outro continente vai de barco (máx. 3 no mar).`,
        "A % na barra de baixo define quantas tropas vão em cada ataque.",
      ],
    },
    {
      icon: "🏗️",
      title: "Construir e bombas",
      lines: [
        `${tap} num ícone de construção (fica com borda dourada): cada ${tapL} no seu território constrói. ${tap} no ícone de novo para parar.`,
        "Bombas: marque vários alvos e aperte LANÇAR para soltar todas juntas.",
      ],
    },
    {
      icon: "🤝",
      title: "Alianças",
      lines: [
        `${hold} numa nação para abrir o menu circular: aliança, doar e mais.`,
        "No cartão de um aliado aparecem Doar tropas e Doar ouro.",
      ],
    },
    {
      icon: "💡",
      title: "Dicas",
      lines: [
        "🎯 no canto de cima volta a câmera para o seu território.",
        `Aviso vermelho no topo = alguém está te atacando. ${tap} nele para ver onde.`,
        "A partida salva sozinha a cada 2 minutos: se o app fechar, use CONTINUAR.",
      ],
    },
  ];
}

@customElement("moworld-gesture-guide")
export class GestureGuide extends LitElement {
  @state() private page = 0;

  createRenderRoot() {
    return this;
  }

  private close() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignora */
    }
    this.remove();
  }

  render() {
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const all = cards(touch);
    const c = all[this.page];
    const last = this.page === all.length - 1;
    return html`
      <div
        class="fixed inset-0 z-[20000] flex items-center justify-center bg-black/60 p-3"
        @pointerdown=${(e: Event) => e.stopPropagation()}
      >
        <div
          class="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-white shadow-2xl"
          data-moworld-guide
        >
          <div class="flex items-center justify-between">
            <div
              class="text-[11px] font-bold uppercase tracking-wider text-amber-300"
            >
              Como jogar · ${this.page + 1}/${all.length}
            </div>
            <button
              class="px-2 text-sm text-white/50"
              @click=${() => this.close()}
            >
              Pular
            </button>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <span class="text-3xl leading-none">${c.icon}</span>
            <h2 class="text-xl font-black">${c.title}</h2>
          </div>
          <ul class="mt-3 space-y-2 text-sm text-white/85">
            ${c.lines.map(
              (l) =>
                html`<li class="flex gap-2">
                  <span class="text-amber-300">•</span><span>${l}</span>
                </li>`,
            )}
          </ul>
          <div class="mt-4 flex items-center gap-2">
            <div class="flex flex-1 gap-1">
              ${all.map(
                (_c, i) =>
                  html`<span
                    class="h-1.5 flex-1 rounded-full ${
                      i <= this.page ? "bg-amber-400" : "bg-white/15"
                    }"
                  ></span>`,
              )}
            </div>
            ${
              this.page > 0
                ? html`<button
                    class="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold"
                    @click=${() => this.page--}
                  >
                    Voltar
                  </button>`
                : nothing
            }
            <button
              class="rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-slate-900"
              data-moworld-guide-next
              @click=${() => (last ? this.close() : this.page++)}
            >
              ${last ? "Entendi" : "Próximo"}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

export function openGestureGuide() {
  if (!document.querySelector("moworld-gesture-guide")) {
    document.body.appendChild(document.createElement("moworld-gesture-guide"));
  }
}

/** Na primeira partida solo, abre o guia sozinho. */
export function maybeShowGestureGuide() {
  try {
    if (localStorage.getItem(SEEN_KEY) === "1") return;
  } catch {
    return;
  }
  openGestureGuide();
}
