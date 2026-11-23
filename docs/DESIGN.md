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
| JannyAI | done (search + import) | Meilisearch `search.jannyai.com` (plain HTTP, token from settings or the public fallback); detail pages read inside a real Chrome session parked on the origin, exactly like Glaze's WebView proxy | none |
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
   **Blanking bug — found and fixed 2026-11-23 (commit `93d0618`)**: provenance is stamped with
   `POST /api/characters/edit`, which does **not** merge: it rebuilds the card through
   `charaFormatData(request.body)` and assigns every text field from the flat body fields
   (`description`, `first_mes`, `personality`, `scenario`, `mes_example`, `creator_notes`,
   `system_prompt`, `post_history_instructions`, `alternate_greetings`, `tags`, `creator`,
   `character_version`). A payload of `{ch_name, avatar_url, json_data}` therefore imported the
   card correctly and then erased its text. Measured on the Testing worktree (8010), same
   character: `desc 5213 first 1022 tags 5` → after `/edit` → `0 / 0 / 0`; after
   `/merge-attributes` → unchanged `5213 / 1022 / 5` **with** `vault_source=datacat` written.
   This is why DataCat's own extension produced full characters while the vault produced empty
   ones from an identical download and an identical import request — the extension performs no
   post-import write at all, so identical requests hid a diverging sequence. Stamping now goes
   through `stampVaultProvenance()` → `POST /api/characters/merge-attributes` (single mode:
   deepMerge, only the sent keys change) for **both** DataCat and chub; the chub lorebook link
   rides the same merge. Verified live after the fix: `datacat_live_with_a_teacher…` stamped and
   `description 830 / first_mes 4123`. Full write-up + the rules that prevent a repeat:
   `docs/PITFALLS.md` (entry 1), enforced by `tests/vault/provenance-stamp.test.js`.
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
6. **M6 — extras**: batch queue, favorites, JannyAI (implemented 2026-11-23), polish.
   **JannyAI** (`src/endpoints/weavers-vault-janny*.js`, routes `/api/weavers-vault/janny/*`).
   *Corrected 2026-11-23:* an earlier note here concluded detail scraping was impossible because
   `GET https://jannyai.com/characters/<id>` from Node answers `403 cf-mitigated: challenge`. That
   conclusion was wrong — it described our HTTP client, not the site. Glaze never uses HTTP for
   those pages; it uses a WebView (`janny_webview_proxy.dart`), and the same approach works for us.
   Measured facts:
   - **Search is plain HTTP.** `POST https://search.jannyai.com/multi-search` with
     `Authorization: Bearer <64-hex>` (settings value, else the public fallback) → 200. Index
     `janny-characters`, hits carry `avatar, createdAt, createdAtStamp, description (blurb HTML),
     id, isLowQuality, isNsfw, name, permanentToken, tagIds, totalToken` — no definition.
     `GET /indexes/janny-characters/documents/<id>` stays 403 `invalid_api_key`.
   - **Detail needs a real browser.** Cloudflare's managed challenge binds `cf_clearance` to the
     TLS fingerprint that solved it, so cookies replayed from Node never work. A real Chromium
     clears it by loading `https://jannyai.com/`, and a `fetch()` executed *inside that page*
     shares the fingerprint and cookie jar, so it returns 200. Measured: **headless Chrome is
     rejected (clearance cookie issued, interstitial persists); headful Chrome with a persistent
     profile passes.** Hence the offscreen window in `weavers-vault-janny-browser.js`.
   - The page embeds the character in an `astro-island` (`component-export="CharacterButtons"`)
     `props` attribute as Astro's `[type, data]` tuples: `personality` (the prompt body — becomes
     ST's `description`), `scenario`, `firstMessage`, `exampleDialogs`, `description` (the public
     blurb — becomes `creator_notes`), `tags` (real names), `creatorName`, `avatar`.
   - **The avatar CDN serves WebP** whatever `Accept` says, and it sends no CORS headers, so the
     bytes come from Node and are transcoded to PNG by the warm browser's canvas via a `data:` URL
     (untainted), capped at 768 px.
   - Measured round trip: cold start ≈ 42 s (launch + challenge), then 2.7 s warm, 0.7 s once the
     page session is hot; the session parks on the origin and is torn down after 60 s idle.
   - Import writes the card through `importCharacter` only — the PNG the server builds already
     carries `vault_source: 'janny'`, so nothing is stamped afterwards (see PITFALLS #1).
   Verified on the real UI (sandbox server, 2026-11-23): provider row → search → detail (author,
   tabs, prompt blocks) → import; the stored PNG decoded back at `description` 5276 chars,
   `first_mes` 1651 chars, `vault_source: janny`.
7. **v2 (separate effort)**: JanitorAI via Electron webview.

## Attribution & legal

- ATTRIBUTION note in extension README: ported from Glaze (AGPL-3.0); DataCat fallback informed
  by datacat-sillytavern-browser (AGPL-3.0). License headers preserved where code is translated.
- AGPL → AGPL is compatible; Loreweaver stays AGPL.
