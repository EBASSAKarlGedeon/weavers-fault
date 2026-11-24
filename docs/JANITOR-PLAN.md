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

*Status (in progress, nothing committed yet).* Built and measured: the account snapshot/restore with
durable pre-flight state, the `janitor_separate.dart` port, the vendored capture page script, and the
drive. Six defects were found by measurement, each written up in `PITFALLS.md`:
`__glazeSend` never installed because `Page.enable` was missing (#18); the ported WebView send cannot
work under CDP, so input is now trusted CDP input (#19); "the composer is empty" was a vacuous check
that read the wrong textarea (#20); a fresh account cannot chat at all — JanitorAI wants a persona
(#21); and a snapshot with null fields could never read clean (#22). Verified so far: the drive opens
the chat, reloads for the preset, types and sends a **trusted** message (Send button goes
`disabled` → enabled), and restores the account to `restored: true, diff: []` with the chat deleted.
**Blocked on one human step:** the account in use has no persona, so the site refuses to generate; the
capture answers `409 janitor_profile_required` and opens the window.

**S6 — Bio converter.** Port `janitor2st.py` to `janitor-html.js`: `{user}`→`{{user}}` (never touching
existing `{{…}}`), relative→absolute links, `/external-link?to=` decoding, `oklab()`→hex, dark
`<mark>`→white text, `text: center`→`text-align`, `align=""`, `width:Npx`→`max-width:min(Npx,100%)`,
`height:auto`, `border-radius:8px`, strip empty `<p>`, strip svg/style/lightbox attrs, credit line.
Drop the page-CSS class inlining — our HTML comes from the API, not a pasted page, so there is no
stylesheet to inline (this also retires the `div.css-ly0sg4` heuristic).
*Accept:* run over a real bio: macro conversion count > 0, no `class=` survives, no `oklab(` survives,
credit line present, and the plain-text fallback produces identical text for a tag-free input.

**S7 — Browse UI.** Source entry, grid, search box, tag chips from the cached catalogue, sort menu.
*Accept:* at 1500×950 and 390×844: grid renders 2-up on phone, chub-only filter rows stay hidden,
search + tag filter return filtered results, detail opens, no console errors.

**S8 — Lorebooks (public + scripted).** `scripts[]` → classify public / scripted / closed; public
downloads convert directly to World Info; scripted needs an LLM rebuild (reuse the vault's existing
LLM path, not a new one); each becomes `<character> — <book>`; card records the list.
*Accept:* import a character with two public books, get two World Info files, and the card's
`data.extensions.vault_lorebooks` lists both. A transport failure is reported as a **failure**, never
as "closed" (Glaze's `!accessible && !isJs` swallows errors — do not inherit that).

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
