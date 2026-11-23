# Pitfalls — Weaver's Vault

Every entry here cost real time once. Each one records the **symptom**, the **measured cause**,
the **rule** that prevents it, and the **check** that proves the rule is being followed.
Add an entry whenever a bug survives a "the requests look identical" comparison.

---

## 1. Never use `POST /api/characters/edit` to update an imported character

**Symptom.** An import returns HTTP 200, the download/prepare response is full, the character
appears in the library — with an empty description, empty `first_mes`, no tags, no
`creator_notes`. Network traffic looks identical to a working flow (DataCat's own extension
imports the same card fine). Every vault-stamped character in the library had
`description` length 0.

**Cause (measured).** `/api/characters/edit` (`src/endpoints/characters.js`) does not merge.
It rebuilds the whole card through `charaFormatData(request.body)`, which assigns each field
from the **flat request-body field** and refuses to fall back to the card that is already on
disk:

```js
const char = tryParse(data.json_data) || {};          // foreign keys survive
_.set(char, 'description', data.description || '');   // ...but everything here is overwritten
_.set(char, 'personality', data.personality || '');
_.set(char, 'scenario', data.scenario || '');
_.set(char, 'first_mes', data.first_mes || '');
_.set(char, 'mes_example', data.mes_example || '');
_.set(char, 'creatorcomment', data.creator_notes || '');
_.set(char, 'tags', ...data.tags || []);
_.set(char, 'data.creator_notes', data.creator_notes || '');
_.set(char, 'data.system_prompt', data.system_prompt || '');
_.set(char, 'data.post_history_instructions', data.post_history_instructions || '');
_.set(char, 'data.alternate_greetings', getAlternateGreetings(data));
_.set(char, 'data.creator', data.creator || '');
_.set(char, 'data.character_version', data.character_version || '');
```

Sending `{ ch_name, avatar_url, json_data }` therefore keeps `json_data`'s foreign keys and
blanks every text field. The import writes the correct card; the follow-up call erases it.
A/B on the Testing worktree (server 8010), same character, same session:

```
BEFORE  desc=5213 first=1022 tags=5
POST /api/characters/edit             -> 200   AFTER desc=0    first=0    tags=0
POST /api/characters/merge-attributes -> 200   AFTER desc=5213 first=1022 tags=5
                                               STAMP vault_source=datacat
```

**Rule.** Any post-import write to a character uses
`POST /api/characters/merge-attributes` (single mode). It reads the card, `deepMerge`s the
payload and writes it back, so only the keys actually sent change. The vault wraps this in
`stampVaultProvenance(avatar, extensions)`; both the DataCat and chub paths use it, and the
chub lorebook link rides the same merge.

**Check.** `tests/vault/provenance-stamp.test.js` fails if the extension ever fetches
`/api/characters/edit` again, and requires `stampVaultProvenance` to stay on `merge-attributes`.

---

## 2. Verify an import on disk, never from the network response

**Symptom.** "The download response has the full description, the import returned 200, so the
import is fine" — while the stored card is empty.

**Cause.** The response of the import step describes the import, not the final state. Anything
that runs afterwards (stamping, lorebook linking, a later edit) can still destroy the data.
Comparing the import request with the official extension's request also fails to expose it:
the extension's flow has **no post-import write** at all, so identical requests can hide a
diverging sequence.

**Rule.** After touching an import path, decode the stored PNG and read the text lengths back:

```bash
node -e "…tEXt chara/ccv3 → data.description.length / first_mes.length / tags.length…"
```

Compare the same three numbers before and after every write the flow performs. Invariants:
`description` and `first_mes` must not shrink; a provenance stamp must be present.

**Check.** The DataCat path warns (console) when a stamped card ends up with an empty
description, and this file is the place to look when it does.

---

## 3. A hypothesis is not a root cause until the last write is measured

Two published-ish theories for the DataCat empty-card bug were wrong, and both had looked
convincing:

- *"The site serves a name-only card because the bridge omits `definitionSource`."*
  Disproven with the official extension's own request in DevTools:
  `/api/characters/<id>/download?t=…&downloadFormat=png&variant=janitor_core&sourceKind=janitor`
  carries **no** `definitionSource` and still returns a **full** card.
- *"Our bridge imported the character full"* — disproven by the file itself: it had no
  `vault_*` stamp, so the official extension had imported it.

**Rule.** Trace the data to its final storage, at the last step that writes it, before stating
a cause. When a flow has `import → stamp → refresh`, the bug is at least as likely in the
stamp as in the import. Record measurements (numbers, request bodies), not narratives; and
when a past conclusion is overturned, mark it **retracted** in DESIGN.md instead of quietly
rewriting history.

---

## 4. Cross-origin iframe traffic is invisible to the tab-level recorder

**Symptom.** A chrome-network-mcp recording of the Loreweaver tab contains the vault's own
`/api/characters/*` calls but none of datacat.run's `/api/characters/<id>/download` calls,
even though the import clearly worked.

**Cause.** The site runs in a cross-origin, out-of-process iframe; the extension attaches a
debugger to the tab and does not receive that frame's network events.

**Rule.** To capture the site side, either record a standalone datacat.run tab (in which case
the site's own buttons/Download path appear) or use Chrome DevTools → Network on the
Loreweaver tab. Absence of those requests in a tab recording is a tool limitation, not
evidence that they did not happen.

---

## 5. "The site blocks HTTP, so the data is unreachable" — a 403 describes the client, not the site

**Symptom.** JannyAI character pages answer `403 cf-mitigated: challenge` from Node. The
conclusion recorded in DESIGN.md was "detail scraping is impossible; the definition only
exists behind the challenge", and the provider was queued for dropping.

**Why that was wrong.** The site is not unreadable — *our HTTP client* is. Cloudflare's
managed challenge solves once, in a real browser, and binds the resulting `cf_clearance`
cookie to the TLS/JA3 fingerprint of whoever solved it. Cookies copied into Node
therefore still fail. Glaze's own implementation never used HTTP for these pages: it
opens a WebView, lets it solve the challenge, and then runs `fetch()` **inside that
page** so the request inherits the fingerprint and cookie jar.

**Measured, 2026-11-23 (same machine, same minute):**
- headless Chrome: `cf_clearance` cookie is issued, interstitial persists, in-page fetch
  still `403`, `challenged: true`.
- headful Chrome with a persistent profile: challenge clears, in-page fetch `200`,
  100 951 bytes, Astro `props` parse yields `personality` 8353 / `firstMessage` 1181.
- Detail round trip: ~42 s cold (browser launch + challenge), 2.7 s warm, 0.7 s hot.

**Rules.**
1. Before declaring a source unreachable, reproduce the client that *does* reach it
   (here: the reference app's WebView). A 403 is evidence about the requester.
2. Check *where* the fetch runs. The same URL can be blocked from Node, blocked from an
   in-page `fetch` (no CORS on the CDN), and fine from a `data:`-URL image decode. We
   fetch CDN bytes in Node and transcode them in the browser canvas for exactly this
   reason.
3. Headless and headful browsers are different clients to a bot filter. Do not assume a
   headless pass implies the headful path works, or vice versa.
4. When a previous conclusion is overturned by measurement, rewrite the DESIGN.md entry
   with the measurement that overturned it — do not silently delete the old claim.

---

## 6. A new source must satisfy the item contract the grid already expects

**Symptom.** JannyAI cards appeared in the grid, but clicking one opened the detail window
and immediately showed "JannyAI failed — A JannyAI character id is required."

**Cause.** `normalizeJannyHit` returned `id`, while every existing source and every
consumer (detail fetch, kebab "open source site", import ledger, `ledgerCheck`) keys items
by `fullPath`. The click passed `undefined` to the server.

**Rule.** Before wiring a new provider, read the *renders* (grid card, detail, ledger) and
list the fields they touch — not just the search route's response. Here the grid needed
`name, avatarUrl, tokens, description, tags, creator, nsfw`, and the click paths needed
`fullPath` and `source`. A provider that only matches the search response shape will
render and then fail on the first interaction.
