# Weaver's Vault

A character-library extension for [Loreweaver](https://github.com/EBASSAKarlGedeon/loreweaver)
(a SillyTavern fork): browse character-sharing sites, preview cards, and import into the native
character/worldbook systems — without leaving the app.

![status](https://img.shields.io/badge/status-v0.1%20(M2)-orange)

## Features (v0.1)

- **chub.ai browse**: search, sort (popular / trending week / 24h / latest / rating / updated),
  NSFW toggle, infinite scroll, poster grid with token/chat-count badges and tag chips.
- **Search-epoch guard**: stale responses are discarded on any filter change.
- **Import**: one-click native import via Loreweaver's own content pipeline
  (PNG card with avatar embedded); import-mode sheet when the card carries a lorebook.

## Install (Loreweaver / SillyTavern)

1. Extensions (cube icon) → **Install extension**.
2. Paste this repo URL, install for yourself.
3. Open via the wand menu → *Weaver's Vault*, or the floating 📚 launcher.

### Server dependency

The browse/import API lives server-side (`/api/weavers-vault/*` in Loreweaver's
`src/endpoints/weavers-vault.js`). On stock SillyTavern the extension will load but has no
backend; source adapters degrade gracefully. Source credentials (chub/DataCat/Saucepan keys)
are stored in the server's secret store, per device, never synced.

## Roadmap

- M3: detail preview popup + import modes + import ledger
- M4: Saucepan paste-URL extraction
- M5: DataCat (official API; iframe-bridge fallback)
- M6: batch queue, favorites, JannyAI search
- v2: JanitorAI + Janny-detail via Electron webview

## Attribution

Source-adapter logic is ported from [Glaze](https://github.com/hydall/Glaze) (AGPL-3.0);
see `docs/glaze-sources-survey.md` / `docs/glaze-ui-survey.md`. The DataCat fallback approach
was informed by [datacat-sillytavern-browser](https://github.com/datacat-run/datacat-sillytavern-browser)
(AGPL-3.0). This extension is AGPL-3.0 like its host project.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
