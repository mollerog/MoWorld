import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  composeVersionDisplay,
  desktopVersion,
  isSteamShell,
} from "../DesktopShell";
import { currentGameVersion } from "../GameVersion";
import "./SteamWishlistButton";

@customElement("page-footer")
export class Footer extends LitElement {
  // Per instance, not at module scope: currentGameVersion reads
  // BOOTSTRAP_CONFIG, which the server injects into the page and which is not
  // guaranteed to exist at the moment this module is first imported.
  private readonly gameVersion = currentGameVersion();

  // Starts as the game version alone and gains the shell version once the
  // bridge answers, so the line is never blank while that call is in flight.
  @state() private versionLabel = this.gameVersion;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // desktopVersion() resolves null off the desktop shell and on its own
    // timeout, so this can only ever leave the label as-is or extend it.
    void desktopVersion().then((shellVersion) => {
      this.versionLabel = composeVersionDisplay(this.gameVersion, shellVersion);
    });
  }

  render() {
    // Scaled to 3/4 on compact screens (styles.css), like the nav bar, from sm
    // up so phones keep their full-size footer.
    return html`
      <footer
        class="[.in-game_&]:hidden min-h-[3.75rem] bg-zinc-900/90 backdrop-blur-md flex flex-col items-center justify-center gap-1 pt-1 pb-3 text-white/50 w-full border-t border-white/10 shrink-0 relative z-50 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-0 sm:compact:[zoom:0.75]"
      >
        <!-- Icons and legal links stay centred on the bar; on desktop they
             share it with the Steam promo, which gets its own grid column so
             the two can never overlap however wide a translation runs. -->
        <div
          class="flex w-full flex-col items-center gap-1 lg:col-start-2 lg:w-auto"
        >
          <!-- Steam build only. The nav bar shows the game version alone so it
               reads the same across web and Steam; the full string, shell
               version included, lives down here where a player can quote it
               in a bug report. -->
          ${
            isSteamShell()
              ? html`<div
                  class="footer-version text-xs mt-1 lg:mt-2 text-center px-4"
                >
                  ${this.versionLabel}
                </div>`
              : nothing
          }
          <div
            class="text-[11px] sm:text-xs mt-2 lg:mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 pl-4 pr-16 sm:px-4"
          >
            <!-- MoWorld: links do próprio projeto. O crédito ao OpenFront fica
                 (exigido pela AGPL / CC BY-SA). -->
            <a
              href="https://github.com/mollerog/MoWorld"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-white transition-colors whitespace-nowrap"
              >Código-fonte</a
            >
            <!-- Celular: o crédito ocupa a primeira linha inteira; os dois
                 links ficam juntos na segunda, longe da bandeira. -->
            <span
              class="order-first w-full text-center whitespace-nowrap sm:order-none sm:w-auto"
              data-i18n="main.copyright"
            ></span>
            <a
              href="https://github.com/mollerog/MoWorld/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-white transition-colors whitespace-nowrap"
              >Licença AGPL-3.0</a
            >
          </div>
        </div>

        <!-- Phones keep the full store widget on the play page instead; there
             is no room for it here. -->
        <div
          class="hidden lg:flex lg:col-start-3 lg:items-center lg:justify-end lg:pt-2 lg:pr-20"
        >
          <steam-wishlist-button
            campaign="home_desktop"
            class="min-w-0 flex-1 max-w-[544px]"
          ></steam-wishlist-button>
        </div>

        <!-- Single instance: translateText() resolves the active language via
             document.querySelector("lang-selector"), so a second one would
             shadow it. -->
        <lang-selector
          class="absolute right-4 top-3 lg:top-1/2 lg:-translate-y-1/2"
        ></lang-selector>
      </footer>
    `;
  }
}
