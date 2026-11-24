# JanitorAI source — implementation plan

Derived from the dossier in `docs/janitor-source/` (25 notes read from Glaze 0.10.1) plus live
measurements against janitorai.com on 2026-11-24. Every claim marked **measured** was observed; the
rest come from Glaze's source and are cited by note.

## 1. What this builds

A fifth vault source, `janitor`, that can browse JanitorAI, sign in once, and turn one character into
a real SillyTavern card — including the definition text that JanitorAI hides on most cards.

**Measured starting point.** The site's `/hampter/*` API answers `200 application/json` anonymously
with **no Cloudflare challenge**, but a `showdefinition: false` card returns `personality`,
`scenario`, `first_message`, `example_dialogs` and `scripts` as `null` with every token count zero —
only the HTML bio. Across 102 cards on three sorts, **0** had a visible definition. So reading alone
imports nothing: the `/generateAlpha` capture is the feature, not an extra.

### v1 (ship first)

| In | Out |
|---|---|
| Browse: grid, search, JanitorAI tags, sorts `trending24` / `trending` / `latest` / `popular` | No batch queue, no crawling, no polling |
| Sign in once in a visible window; session persists as profile cookies | No password stored anywhere, no credential fields |
| Single-card import: public definition **or** capture for closed ones | One card per action, user-initiated |
| Public and scripted-JS lorebooks → one World Info file each | Closed lorebooks (v2) |
| Bio → `creator_notes` through the `janitor2st` converter | Personality HTML (measured: none exists) |

### v2 (after v1 proves single-turn capture)

Multi-turn coverage — repeated user turns, diff each turn's assembled context, subtract entries
already seen, keep adding until every entry has fired — and closed lorebooks embedded into the card.

## 2. Decisions taken (and why), from the design interview

1. **Recovery is v1.** Public-only scope was measured to be empty (0/102). Keeping it would have
   shipped a catalog with no importable content.
2. **Capture is single-turn in v1.** Glaze's proven shape. Coverage is v2 because a coverage bug on
   top of an unproven capture bug is indistinguishable.
3. **Account mutation is accepted, but guarded** — pre-flight refuse, post-flight verify, explicit
   restore. Glaze restores only in `finally`; a killed process leaves a dummy preset selected,
   `source:'proxy'` and `context_length: 0`, which makes *every normal chat* contextless.
4. **Session, not credentials.** Glaze takes no password: it opens `https://janitorai.com/login` in a
   visible WebView and keeps the cookie jar. Our Google sign-in works the same way.
5. **One driver, two origins.** The existing janny driver's CDP/idle/taskbar/exit-state machinery is
   generic; only `ORIGIN`, three `jannyai.com` literals and `JANNY_BROWSER_PATH` are janny-specific.
6. **Field mapping follows Glaze exactly.** `personality` → card `description` (the body), listing
   `description` → `creator_notes`, `scenario` → `scenario`, `example_dialogs ?? mes_example` →
   `mes_example`, `first_message`/`first_messages[]` → greetings, emitted `personality` left empty.
   Importing the *bio* as the body is the blank-card failure by another route.
7. **Bio keeps its formatting** (your `janitor2st.py`), where Glaze discards it via `_htmlToText`.
   Plain text becomes the fallback only.
8. **Lorebooks are separate files.** One World Info file per book, named `<character> — <book>`, the
   list recorded in the card's `data.extensions`; closed books embed into the card (v2).
9. **Import contract is JannyAI's, unchanged**: the server builds the PNG with provenance inside the
   chara chunk; nothing re-stamps via `/api/characters/edit`; every import is verified by decoding the
   stored PNG, never by trusting the HTTP response.
10. **Unproxyable cards are refused early.** `is_proxy_enabled: false` covered 10–24 of every 34 cards
    (measured), and those captures can only end in a 403 after a two-minute browser dance.

## 3. Architecture and file map

```
src/endpoints/
  weavers-vault-browser.js          NEW  shared headful-Chrome driver, parameterised by {host, origin, profileDir, chromePath, envVar}
  weavers-vault-janny-browser.js    EDIT becomes a thin instance over the shared driver (behaviour identical)
  weavers-vault-janitor.js          NEW  pure logic: field mapping, sort whitelist, public/closed/unproxyable
                                         classification, error classification, script classification
  weavers-vault-janitor-tags.js     NEW  7-day tag cache, like weavers-vault-janny-tags.js
  weavers-vault.js                  EDIT mount /janitor/* routes beside /janny/*
  weavers-vault-janitor-capture.js  NEW  the /generateAlpha capture: snapshot, drive, extract, restore, verify
public/scripts/extensions/weavers-vault/
  janitor-html.js                   NEW  browser-side port of janitor2st.py (bio sanitiser)
  index.js                          EDIT SOURCE_META += janitor; source menu row; grid; detail; sign-in row; import wiring
  style.css                         EDIT only what the new rows need
tests/vault/janitor.test.js         NEW  pure-logic tests
```

Routes (all under `/api/weavers-vault`, same auth/CSRF as the others):

| Route | Purpose |
|---|---|
| `GET /janitor/status` | driver state, signed-in account name, profile dir |
| `GET /janitor/tags` | cached catalogue (measured: bare array of 53, `{id,name,slug}`) |
| `GET /janitor/search` | `page`, `sort` (whitelist), `search`, `tag_id[]`, `custom_tags[]` |
| `POST /janitor/card` | one character → classification + card, or a stated refusal |
| `POST /janitor/browser/focus` | reveal the window for sign-in or a challenge |
| `POST /janitor/browser/close` | dispose the session |
| `POST /janitor/account/restore` | snapshot diff → put preset/source/context_length back |

## 4. Stages, each with an acceptance test

**S1 — Driver generalisation.** Extract the shared driver; janny becomes an instance.
*Accept:* `/janny/card` still returns a card (measured warm 1.0–1.1 s); `/janny/tags` still cached;
taskbar hidden; 0 chrome processes after 30 s idle; `tests/vault/janny.test.js` unchanged and green.
Also fix the existing bug where the singleton is replaced without disposing.

**S2 — Sign-in.** Reveal the window at `/janitorai.com/login`, poll for the signed-in state, read the
name from `/hampter/profiles/mine`, persist nothing but cookies.
*Accept:* sign in with Google once; close the browser; reopen and `/janitor/status` reports the same
account name **without** any login step; deleting the profile returns it to signed-out.

**S3 — Reads.** `tags`, `search`, `card` classification with no capture.
*Accept:* search returns 34 rows per page for all four sorts; `sort=all` is rejected by our whitelist
rather than forwarded; a `showdefinition:false` card is classified `closed`, an
`is_proxy_enabled:false` card `unproxyable`, a public one `public`.

**S4 — Paste-to-import, public card.** One URL → fields → PNG → import.
*Accept:* import a public card; decode the stored PNG and read back non-empty `description`,
`first_mes`, `creator_notes` and `vault_source: 'janitor'`, `vault_url` = canonical URL. Provenance
cleanup removes exactly one file.

**S5 — Capture.** For a closed card: pre-flight, drive, extract, restore, verify.
*Accept:* import a closed card and read back a body > 1 000 chars that is not the bio; afterwards the
account's preset, source and `context_length` equal the pre-flight values; the chat is deleted; the
persona is gone. Then the **kill test**: kill the server mid-capture, restart, and `/janitor/status`
reports the account dirty with the exact diff, and `POST /janitor/account/restore` puts it back.

*Status: DONE and verified in real use (2026-11-24).* Built: the drive, the durable account snapshot
with restore, the `janitor_separate.dart` port, the vendored capture page script, and the closed-card
**Recover definition** button with elapsed-time status.

Verified end to end, three times:
- `POST /janitor/capture` → `recovered: true`, phases through `sending probe`, `sending trigger`,
  `separating`, `deleting chat`, `restored`; `restored: {restored: true, problems: [], diff: []}`.
- The **stored card** was decoded, not the response trusted: `chara` (v2) + `ccv3` (v3) chunks,
  `description` 741 chars (the card's personality, emitted as `personality: ""`), `first_mes` 25,
  `scenario` 263, provenance (`vault_source: janitor`, canonical `vault_url`) inside the PNG.
  The probe's system content was 1 129 chars, which is the ceiling a card this small can yield.
- UI pass on the live server: closed card → "Recover definition" → `Recovering… Ns` → "Recovered and
  imported: 741 characters of definition, 263 of scenario, 0 hidden lore entries." in 24 s, no page
  errors. The test import was then deleted by provenance (1 match, then 0).
- **Kill test**: server killed during `opening chat` → `data/_vault-janitor-account.json` left at
  `phase: capturing` with the preset id and the pre-flight snapshot. After restart
  `/janitor/status` reports `dirty: true` ("An import was interrupted…"), and
  `POST /janitor/account/restore` answers `restored: true, problems: [], diff: []`, clears the state
  file, and status reads clean.

Eight defects were found by measurement and are written up in `PITFALLS.md` #18–#23:
`Page.enable` before injecting a page script (#18); the ported WebView send cannot work under CDP, so
input is trusted CDP input (#19); "the composer is empty" was a vacuous check that read a covered
textarea (#20); a fresh account cannot generate at all — JanitorAI demands a persona (#21); a snapshot
field that was null could never read clean (#22); and a status poll could close the window a human was
filling (#23).

**S6 — Bio converter.** Port `janitor2st.py` to `src/endpoints/weavers-vault-janitor-html.js`: `{user}`→`{{user}}`
(never touching existing `{{…}}`), relative→absolute links, `/external-link?to=` decoding, `oklab()`→hex, dark
`<mark>`→white text, `text: center`→`text-align`, `align=""`, `width:Npx`→`max-width:min(Npx,100%)`,
`height:auto`, `border-radius:8px`, strip empty `<p>`, strip svg/style/lightbox attrs, credit line.
Drop the page-CSS class inlining — our HTML comes from the API, not a pasted page, so there is no
stylesheet to inline (this also retires the `div.css-ly0sg4` heuristic).

*Status: IMPLEMENTED and covered, one real-bio sample still owed.* The port is a dependency-free
parser + the Python's pipeline in its order (no jsdom, no BeautifulSoup: the same module runs in Node
and could run in a browser). 55 tests in `tests/vault/janitor-html.test.js`, and the oklab expectations
were produced by running the Python itself, so they are cross-implementation checks.
`creator_notes` now keeps the bio's formatting for both the public and the capture path, instead of the
old `janitorHtmlToText` flattening.

Three defects in the **Python** were found by measuring it, all written up in `PITFALLS.md` #24–#26:
`/external-link?to=…` never decoded (its regex needs a second `?`/`&`), a colour that is the first style
declaration invisible to the light-theme scan, and `&nbsp;`-only paragraphs surviving the empty-strip
because a string-level port does not decode entities. Two decisions of ours are recorded too: the output
is **sanitised** (#27) because it now feeds `innerHTML` and a stored card, and the module lives in `src/`
(#28) because the extension tree is gitignored in the main repo.

Client side: the closed card's sheet renders the server's `bioHtml` — verified in a real browser with an
intercepted payload (bold kept, `{{macros}}`, `min(350px, 100%)`, white `<mark>`, oklab→hex, decoded link,
no handler, no class, no escaped tags, no page errors).

**S7 — Browse UI.** Source entry, grid, search box, tag chips from the cached catalogue, sort menu.
*Accept:* at 1500×950 and 390×844: grid renders 2-up on phone, chub-only filter rows stay hidden,
search + tag filter return filtered results, detail opens, no console errors.

*Status: DONE and verified on the live site (2026-11-24).* The listing is a GET with a query string;
the sheet's tag **names** are resolved to the site's numeric `tag_id[]`s server-side through the cached
catalogue, so the sheet stays source-agnostic. Filter rows this source cannot honour are hidden rather
than offered (no token range, no "match any tag", no must-include), and the sort menu offers exactly the
site's four sorts.

Measured on the live site:
- 34 cards on `sort=latest`, real tag chips, `@creator`, token counts, chat badges, avatars from
  `ella.janitorai.com`; `hasMore` true so the sentinel pages.
- **Tag filter proven by comparison**: the same sort with `⚔️ Enemies to Lovers` returned a completely
  different set — 0 of 34 ids shared with the unfiltered page, and all 34 carried the tag.
- Phrase search ("demon lord") returns 34 themed results, top hit "Veriel, the Demon Lord".
- Detail opens from the grid (`POST /janitor/card`, sheet 8 338 chars, no error) and offers Recover.
- Paging: the sentinel loaded pages 2 and 3 (34 → 68 → 102 cards). The site's live sort shifts while
  you page — measured: page 2 shared **19 of 34** ids with page 1 — so appended items are de-duplicated
  by id (68 cards, 65 unique *names*: three different cards share a name, ids are the key).
- Phone 390×844: **2 columns** (card width 173 px), toolbar fits, sheet fits (8…382 of 390, height 776),
  24 tag chips, chub-only rows hidden. No page errors from the vault.

Two defects, both written up in `PITFALLS.md`:
- the persisted S4 paste-URL leaked in as a search phrase, so the first grid showed "No results"
  while the box looked empty (#29);
- the row normalizer declared `tags` and never filled it, so every card was chipless (#30);
- the token-range row is a `.wv-rangerow`, not a `.wv-mrow`, so the rule that hides it found nothing
  and the phone sheet kept offering a filter JanitorAI cannot run (#31).

The 7 px horizontal overflow at 390 px is **not ours**: measured with the vault closed, it comes from
`div.drawer.datacat-browser-topbar-slot` (the DataCat extension's topbar button) at `right: 397`.

**S8 — Lorebooks (public + scripted).** `scripts[]` → classify public / scripted / closed; public
downloads convert directly to World Info; scripted needs an LLM rebuild (reuse the vault's existing
LLM path, not a new one); each becomes `<character> — <book>`; card records the list.
*Accept:* import a character with two public books, get two World Info files, and the card's
`data.extensions.vault_lorebooks` lists both. A transport failure is reported as a **failure**, never
as "closed" (Glaze's `!accessible && !isJs` swallows errors — do not inherit that).

*Measured 2026-11-26 — 15 requests total (6 + 5 + 3 + 1), no loops, nothing written.*

A `scripts[]` entry (card details; the **listing** rows do not carry `scripts`):

```json
{"type":"lorebook","id":"47c1eed5-f087-4777-a8ed-e37f0c3990b5",
 "title":"Heroes and Villains","description":"Information about heroes and Villains in this RPG",
 "theme":"red","user_id":"…","user_name":"1Reika2","is_public":true,
 "updated_at":"2026-08-08T18:57:45.762+00:00","message_count":51336}
```

`GET /hampter/script/{id}` on a public book answers **200** (19 645 bytes) with record keys
`type,id,user_id,user_name,user_verified,user_plusbadge,user_display_prefs,title,description,theme,depth,
is_public,is_code_public,is_comment_allowed,script,draft,settings,engine_version,created_at,updated_at,
original_script,characters,message_count`, and `script` is **a JSON array inside a string**. Entry keys:
`category,content,enabled,id,key,keysRaw,minMessages,priority,probability,insertion_order,keywordsRaw,constant`.
Entry ids are UUIDs; keys arrive both as an array (`key`) and a comma string (`keysRaw`).

What this settles:

1. **`is_public:false` is authoritative and free.** Those books answer
   `404 {"message":"script not found","statusCode":404}` (47 bytes), so they are classified `closed`
   with **no request spent**. A missing route answers Express's `Cannot GET …` (85 bytes) instead —
   the two 404s are distinguishable, and a **public** ref that 404s is a `failed`/`script-denied`,
   never `closed`.
2. **There is no script catalogue**: `GET /hampter/scripts` → `Cannot GET`. Books can only be
   discovered from a card's detail, one request per card.
3. **The ref already carries the description**, so Glaze's extra fetch of `/scripts/{id}` (and its
   double-decoded `window.mbxM` store) is unnecessary here: one request per book, not two.
4. **The scripted/JS shape is still UNMEASURED** — every `script` seen parsed as JSON. The detection
   (non-JSON ⇒ source) is implemented defensively and must not be described as verified.

Conversion target: the normalizer emits a **characterBook-shaped** book and the client pipes it through
the host's own `convertCharacterBook` → `saveWorldInfo` (the chub path). SillyTavern's entry template
stays the single source of truth; `saveWorldInfo` writes `data` to `/api/worldinfo/edit` as-is, so an
entry hand-built from Glaze's field list would silently miss whatever ST adds next.

*Status: pure logic DONE* (`janitorLorebookRefs`, `janitorScriptEntries`, `classifyJanitorLorebook`,
`janitorScriptToCharacterBook`, `janitorLorebookName` in `src/endpoints/weavers-vault-janitor.js`;
38 tests in `tests/vault/janitor-lorebook.test.js`, suite at 259). Route `POST /janitor/lorebooks`,
client wiring and the on-disk import verification remain.

**S9 — Ledger and errors.** Every import lands in the existing `ledger`; every failure states a
reason (`unproxyable`, `closed-capture-failed`, `challenge`, `signed-out`, `rate-limited`).

## 5. Test matrix

| Area | Method |
|---|---|
| Pure logic | `tests/vault/janitor.test.js`: mapping, classification, sort whitelist, script classification, converter rules |
| Import + capture | only in `../Loreweaver-testing` (git-tracked data), provenance-based cleanup (`vault_source==='janitor' && vault_url===exact`), 0 or ≠1 matches ⇒ delete nothing |
| Verification | decode the stored PNG (`chara`/`ccv3`), assert text lengths, never trust the response |
| Restore | deliberate kill mid-capture, then the restore route |
| Regression | full `tests/vault` suite (91 tests today) + a janny end-to-end check after S1 |

## 6. Risks

1. **Account damage is the main one.** Mitigated by pre-flight, post-flight, explicit restore, and a
   kill test. If the restore cannot be proven, capture does not ship.
2. **Capture is slow** — Glaze budgets 60 s for the probe and 120 s per trigger send, plus 700 ms
   polling. Expect 1–3 minutes per card; the UI must say so rather than look hung.
3. **Rate limits are unmeasured.** We issued ~20 requests total while probing. v1 stays
   user-initiated; nothing loops.
4. **`context_length: 0` may not be honoured** (dossier: UNKNOWN). If the server ignores it, the
   assembled prompt may be truncated and entries silently missing — the acceptance test in S5 must
   compare against a known-length card.
5. **Tag ids are the site's**, so the cached catalogue can drift; the vault already handles that for
   JannyAI (refresh + drop unknown selections).

## 7. Unknowns to settle during build, not by guessing

- Whether `context_length: 0` is honoured (S5 acceptance covers the observable consequence).
- Whether the captured definition contains any HTML at all (you say it never does; the converter must
  still be a no-op on tag-free text, which S6 asserts).
- Whether scripted-JS books are common enough to justify S8's LLM path *now*, or whether S8 should
  ship public-only first.
