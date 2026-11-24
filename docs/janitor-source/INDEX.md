# JanitorAI source dossier (Glaze 0.10.1)

Reference notes for porting the **JanitorAI** source into Weaver's Vault, written from the shipped
Flutter source rather than from the live site or from memory.

- **Read from:** `C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/` (+ `lib/shared/widgets/`,
  `assets/translations/en.json` where the code points there)
- **Files covered:** 25 (the 19 requested, plus 6 the reading showed are load-bearing:
  `janitor_provider`, `janitor_public_lorebook`, `janitor_lorebook_rebuilder`, `janitor_field_diff`,
  `janitor_lore_budget`, `janitor_build_widgets`)
- **Total:** ~11.2k Dart lines → 25 notes, ~50 800 words
- **Method:** six readers worked through the files in parallel (the account allows two at a time, so
  four groups were queued). Each was required to read every line in chunks, quote literals
  verbatim, and mark anything inferred `(inferred)` or unknown `UNKNOWN — not determined from this file`.

## How to read this set

Each note follows one structure: Purpose → Behaviour walkthrough (function by function, real
identifiers) → Data shapes → Network / WebView contract → Selectors, regexes and string literals →
State machine, retries, timings → Errors and user-visible messages → Persistence → Porting notes →
Open questions.

**Only backticked values are quoted from the source.** Three traps found while checking the notes,
worth knowing before trusting a literal:

1. **Filter and UI labels are translation keys, not English.** `catalog_filter_sheet.dart:303` calls
   `'catalog_filter_min_ai_rating'.tr()`, and the English text lives in
   `assets/translations/en.json` (`'Minimum AI rating'`). Grepping the Dart for `Minimum AI rating`
   finds nothing — that is correct, not a missing feature.
2. **Many URLs are built from constants**, e.g. `'$_hampterUrl?$params'` with
   `_hampterUrl = 'https://janitorai.com/hampter/characters'` (`janitor_provider.dart:92`). Grep for a
   full URL and you get nothing even though the endpoint is right there.
3. **Some quotes are emphasis, not copy.** A note may write "back one step" as shorthand for a
   behaviour; that string is not in the UI. Where a note claims text is user-visible it says so and
   the value is in backticks.

## Files

| Group | Note | Words | Role |
|---|---|---|---|
| browser | [janitor_webview_proxy](janitor_webview_proxy.md) | 2755 | Persistent offscreen Chromium that runs all `janitorai.com` calls in-page (keeping Cloudflare's TLS-bound `cf_clearance` valid) and drives the `/generateAlpha` capture |
| browser | [cf_challenge_service](cf_challenge_service.md) | 1802 | Broker for the Turnstile challenge: parks the request, shows a visible WebView, returns `cf_clearance` + the UA it was minted under |
| browser | [janitor_waiting_room](janitor_waiting_room.md) | 1474 | WebView-free recogniser for Cloudflare's Waiting Room page → `JanitorWaitingRoom` (refresh interval, site's own wait estimate) |
| extraction | [janitor_extractor](janitor_extractor.md) | 2448 | Two-phase orchestrator: capture → card fields + isolated lorebook text; then write character (+ optional rebuilt lorebook) to the DB |
| extraction | [janitor_separate](janitor_separate.md) | 1626 | Pure core that isolates the injected lorebook text from one payload, plus the text-cleaning primitives |
| extraction | [janitor_session](janitor_session.md) | 1795 | Five pure predicates: which cookies survive, cookie expiry, JWT spent, and which 401s may be retried anonymously |
| extraction | [janitor_account_provider](janitor_account_provider.md) | 1147 | Last-known display name in `shared_preferences` for "Logged in as …" without booting the WebView |
| capture UI | [janitor_lorebook_capture_sheet](janitor_lorebook_capture_sheet.md) | 3355 | Whole lorebooks import surface (JAR `#tabLorebook` port): 4-stage state machine, both six-source context selections, public-book convert/bulk-save, `.txt` + World Info export |
| lorebook data | [janitor_provider](janitor_provider.md) | 2175 | Every `/hampter/...` read endpoint + mapping of raw rows to `CatalogItem` / `DownloadedCharacter` |
| lorebook data | [janitor_public_lorebook](janitor_public_lorebook.md) | 2302 | Discovers a character's `scripts`, downloads public ones, classifies plain-JSON / scripted-JS / closed, converts to `Lorebook` or ST World Info JSON |
| lorebook data | [janitor_lorebook_rebuilder](janitor_lorebook_rebuilder.md) | 2876 | Turns captured text (or a scripted book's JS) into keyed entries via the user's LLM: prompts, token-budget chunking, part caching, per-part failures |
| lorebook data | [janitor_field_diff](janitor_field_diff.md) | 2002 | Recovers lorebook text injected *inside* prompt fields by diffing AFTER vs probe BEFORE vs the public definition |
| lorebook data | [janitor_lore_budget](janitor_lore_budget.md) | 1664 | Measures injected lore in `cl100k` tokens, decides whether the capture hit the lore cap, splits an over-firing trigger in half |
| widgets | [catalog_filter_sheet](catalog_filter_sheet.md) | 2377 | The one filter sheet for all four sources: per-provider vocabulary, Chub's eleven flags, tag picker, JanitorAI block list; commits by diffing on `dispose()` |
| widgets | [janitor_blocked_content_section](janitor_blocked_content_section.md) | 1818 | Account block-list editor: one search field resolving to a curated tag id or a free-text keyword |
| widgets | [janitor_session_expired_state](janitor_session_expired_state.md) | 1936 | Full-pane 401 state that survives refresh + anonymous retry, with its one-shot illustration |
| widgets | [janitor_lorebooks_tab](janitor_lorebooks_tab.md) | 1812 | Read-only Lorebooks tab on the catalog preview; classifies public / scripted / closed, offers no action |
| widgets | [janitor_build_widgets](janitor_build_widgets.md) | 1942 | Four building blocks: `ContextSourceTile`, `DisclosureRow`, `ContentPane`, `ActionTile` |
| widgets | [janitor_extract_sheet](janitor_extract_sheet.md) | 1967 | Dev-tool sheet: one character URL → capture/separate/preview → Save commits card + LLM-rebuilt closed lorebook |
| widgets | [janitor_login_sheet](janitor_login_sheet.md) | 2467 | The account UX: menu sheet (log out / cancel) + full-height WebView on `https://janitorai.com/login` that detects sign-in, persists the name, flushes cookies, closes |
| widgets | [janitor_source_settings](janitor_source_settings.md) | 1574 | The `local` vs `datacat` "where do cards come from" choice, exported as reusable menu items |
| widgets | [janitor_refused_sheet](janitor_refused_sheet.md) | 1973 | Two explanatory sheets (refused character / expired session) each returning whether to continue |
| widgets | [janitor_extraction_settings_sheet](janitor_extraction_settings_sheet.md) | 1692 | Host for the three lorebook-build settings groups: LLM connection, request splitting, system prompts |
| widgets | [janitor_phase_label](janitor_phase_label.md) | 1719 | Maps raw English phase ids to localized step labels, passing through unknowns |
| widgets | [third_party_providers_screen](third_party_providers_screen.md) | 2057 | The "Content providers" screen: enable/disable each source, JanitorAI account row, extraction-source selector |

## Findings that change how we build

1. **`cf_clearance` is bound to the solving client's TLS/JA3 fingerprint**, so a cookie obtained
   elsewhere answers 403 even with the identical cookie and User-Agent (`janitor_webview_proxy.md`).
   This is the same constraint that forced JannyAI's `fetch()`-inside-the-page design; expect it for
   JanitorAI too. Headless is not an option for the same reason.
2. **Anonymous retry is an allowlist, and that is a safety rule, not a nicety.** Retrying an
   account-bound read without a token does not fail — it succeeds and returns someone else's data, or
   an empty block list that would then be written back over the real one
   (`janitor_session.md`, `janitorReadIsPublic`). GET-only, and `…/characters/mine` would slip through
   the structural check (flagged inferred in that note).
3. **The capture mutates the account** — preset, generation settings, a chat, a persona are set and
   restored, and a failure mid-run can strand them (`janitor_lorebook_capture_sheet.md`,
   `janitor_extractor.md`). Any port must restore, not just abandon.
4. **`_tavernEntry` is already a World Info entry mapping**: `addMemo: true`, `groupWeight: 100`,
   `useProbability: true`, `selective: !constant`, `characterFilter: {isExclude, names, tags}`
   (`janitor_public_lorebook.dart:538-563`). Close to copy-paste for our import path.
5. **Lorebook class matters before import**: public / scripted-JS / closed each take a different path
   (download+convert, LLM-rebuild from JS, capture+subtract+rebuild).
6. **Cookie restoration has a platform bug baked in**: WebView cookie expiry read-back can be
   milliseconds-vs-seconds wrong, so a "400 day" cookie reads as ~9 hours; Glaze keeps a read-back
   expiry only if it is ≥ 2 days out, else stamps `now + 400 days` (`janitor_session.md`).
7. **Waiting Room is a distinct failure mode** from a challenge: `refreshInterval` defaults to
   `20 s`, the settle window is `refreshInterval + 6 s`, and the queue has its own exception.

## Confidence and what is not verified

- Every note was checked against the Dart source by sampling: URLs, endpoint constants, timeouts,
  exception strings, and translation keys. All resolved to real code — including
  `'Janitor.AI session expired (401)'` (`janitor_webview_proxy.dart:570`), `'$label: $message'`
  (`catalog_error_labels.dart:21`), `#tabLorebook`, `_hasFlow`, `isJs`, `_waitLimit = 20 min`
  (`:739`), JS `4000`/`15000`/`30000` ms deadlines (`:373`/`:447`/`:472`), `_rawFetch` 25 s (`:2321`),
  and the URL constants in `janitor_provider.dart:38/66/76/92/230/358/444`.
- **Not verified:** the narrative walkthroughs in full. Sampling catches invented literals and wrong
  constants; it would not catch a subtly wrong ordering of steps. Treat any step order as
  "as reported by the reader" until the specific behaviour is exercised.
- Unknowns are marked in place rather than smoothed over; each names the file that would settle it.
  Open ones include whether `/hampter/tags` and `/hampter/characters/tags/suggest` are truly
  anonymous-readable (asserted in a doc comment, not provable from code), and how the chunked
  `sb-*-auth-token` cookie is assembled.

## Live probe, 2026-11-24 (SillyTavern side, not Glaze)

Run before planning, because the dossier alone could not settle whether JanitorAI is reachable, what
an anonymous read returns, or how common a recoverable card is. Method: one persistent Chrome
profile, same-origin `fetch()` from `https://janitorai.com/`, ~15 requests total, no loops, no batch.

| Measurement | Result |
|---|---|
| Cloudflare wall on `/hampter/*` | **None observed** — `GET /hampter/tags`, `GET /hampter/characters?...` and `GET /hampter/characters/{id}` all answered `200 application/json` anonymously, no challenge page |
| Listing shape | `{"data": [ … ]}`; 34 rows per page; row keys include `id, name, avatar, description, showdefinition, is_proxy_enabled, is_public, tags[], custom_tags[], stats.total_tokens, creator_*` |
| Detail (`showdefinition: false`) | `personality`, `scenario`, `first_message`, `first_messages`, `example_dialogs`, `scripts` all **`null`**; every `token_counts.*` = 0; only `description` populated (2 044 chars of HTML bio) |
| Recoverable cards | **0 of 102** (`sort=trending24`, `latest`, `trending`; 34 each) had `showdefinition: true` |
| `is_proxy_enabled: false` | 10 / 24 / 13 of 34 per sort — i.e. a capture can only 403 for that share of cards |
| `allow_proxy` on the opened card | `true` |

Consequence for the plan: a "import only public definitions" v1 has nothing to import. Every card
needs the `/generateAlpha` capture path (or an equivalent), so definition recovery is v1 work, and
`is_proxy_enabled: false` must be detected before any capture is attempted rather than discovered as
a 403 after the browser dance.

This section supersedes the "works without an account is asserted in a doc comment" caveat above for
the three endpoints measured: they do answer anonymously. It does **not** prove they answer
identically for every card, and it says nothing about rate limits.

### Added 2026-11-24 (second probe, 5 requests)

- `GET /hampter/tags` returns a **bare JSON array** (not `{data:[…]}`) of **53** tags with keys
  `created_at, description, id, name, slug`; names carry emoji (`"👨 Male"`, slug `male`).
- Sorts: `trending24`, `trending`, `latest`, and **`popular`** (= the site's "Popular all time",
  `200`, 34 rows). `sort=all` is a `400` — the whitelist must reject it rather than forward it.

## Added 2026-11-24 (third probe — signed in, 4 requests)

Signed in as a real account, in the vault's own persistent profile. Everything
here was measured, not inferred.

- **The API ignores cookies.** `/hampter/profiles/mine` answers `401
  {"message":"Unauthorized","statusCode":401}` from inside the page with the
  `sb-<ref>-auth-token.*` cookies present, and `200` with the profile once
  `Authorization: Bearer <access_token>` is added. The access token is not in
  `localStorage`; it is inside the chunked `sb-<ref>-auth-token.0/.1` cookies
  (3 180 + 1 763 bytes), raw JSON here, `base64-` prefixed in the other known
  form. Anonymous reads (tags, listing, detail) keep working, so a token-less
  read succeeds while being a different (anonymous) view.
- **A public card exists.** The first row of `sort=trending24` while signed in
  returned `showdefinition: true` with `personality`, `scenario`,
  `first_message` (3 989 chars), `example_dialogs` and `scripts` populated.
  The earlier anonymous sample (0 of 102) is therefore not proof that public
  definitions are rare — it is proof that anonymous reads hide them.
- **Detail payload shape.** `token_counts = {example_dialog_tokens,
  first_message_tokens, personality_tokens, scenario_tokens, total_tokens}`;
  the flat `total_tokens` is absent on a detail payload (2742 for that card).
  `first_messages` had 6 entries against `first_message` + 5 alternates.
- **Tag objects on a card** are the same shape as `/hampter/tags`
  (`{created_at, description, id, name, slug}`), and `custom_tags` is a bare
  array of strings. `name` keeps the emoji, e.g. `"👨 Male"`.
- **Account config is a live preset**: `/hampter/profiles/mine` carries
  `config.api`, `config.openAiModel`, `config.open_ai_mode: "proxy"`. That is the
  object the `/generateAlpha` capture mutates, which is why S5 refuses to run on
  a dirty profile and verifies afterwards.
