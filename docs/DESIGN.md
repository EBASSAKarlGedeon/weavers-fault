# Weaver's Vault — Design Spec

> Character Library extension for Loreweaver. Status: DESIGN AGREED 2026-11-24 (grilling session,
> 14 decisions). No code written yet. Attribution: source-adapter logic ported from **Glaze**
> (AGPL-3.0, github.com/hydall/Glaze) — surveys in `glaze-sources-survey.md` / `glaze-ui-survey.md`;
> DataCat fallback path studies `datacat-sillytavern-browser` (DataCat's own extension, AGPL-3.0).

## What it is

A pure drawer extension (top-bar, like other Loreweaver extensions; **zero core edits**) that
browses character-sharing sites, previews cards, and one-click imports into Loreweaver's NATIVE
systems (characters list, worldbooks). No duplicate library DB. Name: **Weaver's Vault**.

## v1 sources (decided Q5/Q13)

| Source | v1 | Mechanism | Auth |
|---|---|---|---|
| chub.ai | YES | REST `api.chub.ai` (search/tags/detail), field remap to ST V2 | optional key (secrets) |
| DataCat | YES, lights up when key arrives | Official `api/client/v1` REST; device-flow token; hosted verification lease | client id (settings field) + user token |
| DataCat fallback | if client-id path fails | Embed `datacat.run` in sandboxed iframe + postMessage bridge (PREPARE/CARD → PNG → `/api/characters/import`), like the official extension | client-link (hosted) |
| Saucepan | YES | URL-driven extraction (`/api/v1/companion/definition`), decoy-fragment reassembly (FNV-1a proof, `key ^ mask` sort, 32-bit math → `Math.imul`) | paste-only bearer token (Q14) |
| JannyAI | search-only if it ports in ~1 day, else dropped | Meilisearch `search.jannyai.com` (plain HTTP, anonymous token scraped from JS bundle + hardcoded fallback); detail pages need CF-cleared browser → skip in v1 | none |
| JanitorAI | **v2** | Mandatory webview (CF binds clearance to TLS fingerprint). v2 plan: Electron webview in packaged app (Q6a) | Supabase cookies |

## Architecture (Q7/Q8)

- **Server module** `src/endpoints/weavers-vault.js` (name TBD in code): all Tier-A HTTP
  (Chrome UA spoofing per Glaze's `catalog_http` pattern, brief response caching, rate-limit
  politeness, secrets read server-side). Browser extension code stays thin: UI + calls.
- **Extension** `public/scripts/extensions/weavers-vault/`: manifest, drawer UI, adapter client,
  import pipeline calling existing native import endpoints (reuse `content-manager.js` chub
  download helpers where they overlap).
- **Secrets**: ST secret store, per-device, NOT synced (chub key, datacat token, saucepan token).
- **Settings/ledger**: extension settings → auto-synced to phone via Phase 2 (NSFW toggle,
  filters, favorites, import ledger, open-after-import).

## UI (Q2/Q9/Q10, Loreweaver-native, steal Glaze mechanics)

- Drawer: search box (400 ms debounce), source picker chip, filter button with applicable-only
  badge, active-filter chips row, sort chip, NSFW toggle (own, default SFW, Q7-of-round-1),
  result grid (2:3 posters, tag chips, token/message badges, NSFW blur + reveal), infinite
  scroll, "End of results", result count hidden when source reports no total.
- **Search-epoch guard**: any filter/sort/source/query change bumps epoch; stale responses dropped.
- Detail popup (Vault-native, not core reuse): bio, creator note, tags, stats, prompt blocks,
  alternate greetings, embedded/attached lorebook inventory, sample messages, "open on source
  site" link, creator link.
- Paste-URL import (Saucepan/DataCat) with phase-labeled progress; "finished empty" ≠ timeout.
- Per-source persisted filter profiles.

## Import (Q3/Q11/Q12 + Q4)

- Modes (sheet shown when lorebook exists): **Character only / Character + lorebooks /
  Lorebooks only**. Lorebook failure NEVER blocks character import.
- Extras (all): a) all greetings imported, b) avatar images (bytes ride along when
  credential-bound), c) tags into Loreweaver tag system, d) import history + source link,
  e) batch import queue (background downloads) — *beyond Glaze*.
- Provenance: source URL stamped in character `extensions`; toast; setting "open after import"
  (default on).
- **Import ledger** (Q4): every import recorded (name, source, source id, date) in synced
  settings; duplicate warning before re-import; update-check later.
- Party-labeled errors (source / provider / Vault) with actionable escapes.

## Milestones (proposal, small focused commits)

1. **M1 — server module + chub**: `src/endpoints/weavers-vault.js` (UA spoof, cache, secrets),
   chub search/tags/detail port; curl tests.
2. **M2 — extension skeleton + browse UI**: manifest, drawer, chub search grid, filters, epoch
   guard, NSFW toggle. Screenshot-verified (rpge-heavy convention).
3. **M3 — detail popup + chub import**: preview, ST V2 assembly, native import (card PNG/JSON +
   embedded book), provenance, ledger, open-after-import.
4. **M4 — Saucepan** (COMPLETE 2026-11-22): paste-URL extraction + fragment reassembly port + URL
   import dialog. Pure logic in `src/endpoints/weavers-vault-saucepan.js` (FNV-1a proof scheme
   ported from saucepan_extractor.dart, Math.imul >>>0 32-bit math), 13 jest tests incl. an
   independent BigInt reference hash. Routes: paste-token (Q14), status, extract → card PNG.
   Extension: Providers popup (chub/saucepan/datacat), paste-URL auto-import, token sheet,
   source-aware detail/FAB/ledger. Live-verified: routes + providers menu + token-sheet flow.
   A real end-to-end extraction needs the user's saucepan.ai bearer token (upstream answered
   401 Invalid token to a fake one — request format confirmed).
5. **M5 — DataCat** (COMPLETE 2026-11-22): **embedded-browser bridge**, not the client-API
   path. DataCat's own SillyTavern browser extension (v0.1.9, AGPL-3.0) does not call a
   REST endpoint at all: it loads `datacat.run` in an iframe (`dc_embed=st`,
   `dc_auth_mode=client-link`, nonce-bound) and receives a finished PNG card over
   `postMessage`. That is the only route that works with **no account and no client id** —
   verified live (handshake `ready` from datacat.run; the site's own Discover grid, filters
   and age gate render inside the vault panel).
   Ported parent side: `init`/`ready`, `prepare` → `need-card`, `card` → import →
   `processing`/`ok` acks (which the site renders as *Check local copy → Import PNG →
   Refresh library*), UUID character-id validation, request-id validation, PNG signature +
   32 MB cap, duplicate-import guard, completed-ack replay, `vault_source=datacat`
   provenance. The frame is created once and hidden rather than detached: detaching an
   iframe destroys its browsing context (the official extension parks its frame for the
   same reason). While browsing, the panel hides the grid's furniture; this also exposed
   that row rules outrank the UA `[hidden]` rule, now root-fixed with
   `#wv-root [hidden] { display: none !important }`.
   **Name-only cards (investigated 2026-11-23; measured, not inferred)**: some imports
   arrive with the name and artwork but no description. Measured evidence:
   - Static reading of the site's bridge (`st-bridge-v14`) and the three-subagent audit:
     the bridge calls `api.buildPngPayload(id, name, creator, variant, sourceKind)` with
     exactly 5 args and never mentions `definitionSource`, so the Open-in-SillyTavern
     download request omits that param. Verified live in DevTools on the **official
     extension**: `GET /api/characters/70031113…/download?t=…&downloadFormat=png&
     variant=janitor_core&sourceKind=janitor` → **200 with a FULL card** (Lena,
     description ~7.4k, first_mes, 9 tags) → then `POST /api/characters/import` → 200.
   - Recorded with chrome-network-mcp on a standalone datacat.run tab: the site's own
     **Download** button sends `&definitionSource=source` and also gets a full card
     (Hana, description 7,061).
   - Therefore **a missing `definitionSource` does NOT by itself produce a name-only
     card**. The earlier hypothesis that it did (commit `e4f9aa7`) is **retracted**: the
     official extension omits the param and still receives full cards.
   What survives: DataCat can answer with an empty definition for a character whose
   mirrored retrieval has not completed (the site's own `public_only_partial` state), and
   the site normalizes/embeds it without validation. No protocol lever exists for a
   third-party parent (iframe URL params, init and acks cannot change the card).
   On *our* side the remaining unknown is whether the vault's own import path is still
   affected: every vault-stamped DataCat import on disk (3, all 11-23 01:55–02:22) is
   empty, and all of them predate a browser reload after the `e702868` contract fixes, so
   none of them exercises the current code. That clean test still has to be run. The
   empty-card guard stays either way — it refuses to create a blank character and its
   message now states only what is measured (empty definition on DataCat's side) plus the
   workaround (press Download, import that PNG).
   Kept as an optional path: `src/endpoints/weavers-vault-datacat.js` +
   `weavers-vault-datacat-routes.js` port Glaze's `api/client/v1` adapter (40 jest tests:
   installation-id body contract, device-flow bodies, two-window `/fresh` query shaping,
   sort/window resolution, lease store, error classification). Glaze ships with **no**
   client id (`--dart-define`, default empty) and DataCat must approve an integration id,
   so this path cannot be exercised here; nothing in the UI depends on it.
6. **M6 — extras**: batch queue, favorites, JannyAI-search decision (1-day timebox), polish.
7. **v2 (separate effort)**: JanitorAI + Janny-detail via Electron webview.

## Attribution & legal

- ATTRIBUTION note in extension README: ported from Glaze (AGPL-3.0); DataCat fallback informed
  by datacat-sillytavern-browser (AGPL-3.0). License headers preserved where code is translated.
- AGPL → AGPL is compatible; Loreweaver stays AGPL.
