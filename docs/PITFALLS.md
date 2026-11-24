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

---

## 7. A backgrounded browser window stalls a Cloudflare challenge (and 45 s was too tight)

**Symptom.** JannyAI "doesn't work" in the real app: a Chrome window appears, the page sits on
"Loading JannyAI…", then the UI reports a timeout. The same code passed in a script.

**Measured causes, both real:**
- The automation browser is parked offscreen (`--window-position=-32000,-32000`). Windows treats
  an unfocused/occluded window as background and throttles its timers, so Cloudflare's challenge
  script never finishes. A *visible, focused* window from a test script cleared it in 9–18 s.
- The challenge deadline was 45 s, while a truly cold profile measured ~42 s. Even without
  throttling that is a coin flip.

**Rules.**
1. Keep the automation window unthrottled: `--disable-backgrounding-occluded-windows`,
   `--disable-features=CalculateNativeWinOcclusion`, `--disable-background-timer-throttling`,
   `--disable-renderer-backgrounding` — and re-assert focus over CDP while waiting
   (`Page.bringToFront` + `Emulation.setFocusEmulationEnabled`).
2. Size the deadline from the worst measurement, not the typical one: cold 120 s, warm 30 s
   (a marker file records that this profile has already cleared once).
3. On failure, tear the session down. A half-solved page reused by the next request fails
   identically and looks like a permanent outage.
4. Never conclude "the site is broken" from a timeout you imposed.

**The wedge that actually hit the live server** (found after the fixes above): a launch that
exits **0** without ever writing `DevToolsActivePort` means Chrome handed the URL to an already
running instance of the same profile and quit. A leftover browser from an earlier run owns the
profile, and the stale-lock cleanup had already deleted the port file that would have allowed
adopting it — so every later request failed the same way, and it read as "Cloudflare never
clears". Two things were needed:
- reclaim the profile (kill only processes whose command line contains that profile folder),
  because the profile is exclusive to this feature;
- normalise `--user-data-dir` to an **absolute** path first. The server passed a relative one,
  so Chrome's own command line was relative and an absolute-path match found nothing — the
  reclaim ran, matched zero processes, and the wedge survived. Match on the profile folder's
  **basename**, and pass an absolute path.

---

## 8. The index's totals are capped, so "of 4000 results" is a lie

**Symptom.** Every filtered search reported `totalHits: 4000`, including a tag filter that
visibly returned only a few matching characters, while a nonsense query correctly reported 0.

**Cause.** Meilisearch caps paginated totals at the index's `maxTotalHits` (measured: exactly
4000 for this index). Anything matching more documents than the cap reports the cap.

**Rules.** Treat a total equal to the cap as unknown: report it as unavailable rather than as a
number the user can compare against a filtered list. For infinite scroll, trust a short page
(`hits.length < hitsPerPage`) over any total — that is the only reliable end-of-results signal.

---

## 9. Filter vocabulary must come from the source that will honour it

**Symptom.** After adding JannyAI, the filter sheet still offered NSFL, NSFW-only, AI rating,
minimum tag count, "with lorebooks / gallery images / custom prompt / example dialogues /
alternate greetings" and "recommended / verified". None of them do anything on JannyAI: its
index's filterable attributes are, verbatim from the API's own error message,
`createdAtStamp, isLowQuality, isNsfw, permanentToken, tagIds, totalToken` — tag *ids* only,
no tag names and none of chub's listing flags.

Also: JannyAI card lists painted **two** safety chips (`SFW` and `#SFW`), because the source
mapping added `'SFW'` to `tags` while the grid already derives a chip from `item.nsfw`.

**Rules.**
1. Ask the API what it can filter before designing a filter UI. Meilisearch answers that
   question explicitly when you request an unknown facet: it lists the filterable attributes.
2. Hide what the active source cannot honour, and keep the filter badge counting only visible,
   honoured filters — otherwise the badge is unexplainable.
3. Tag *names* are not in the index, so they are read from the site's own sidebar on a browse
   page (`/?query=…&tag_id=<id>` links carry the emoji label and a `title` description), cached
   for 7 days, with a measured fallback list. The site answers **500** for a one-character query
   (`?query=a`), so the home page is the primary catalogue URL.
4. Selection is stored as names (uniform with chub) and resolved to numeric ids server-side
   through that cache, so a saved selection survives a reload.

---

## 10. Hiding the automation window from the taskbar must not hide the window

**Symptom.** Every JannyAI session added a Chrome button to the taskbar (and to Alt-Tab) that the
user could not meaningfully enter — the window is parked offscreen, which is deliberate.

**Cause.** An offscreen window is still a normal visible window: the shell gives it a taskbar
button unless its extended style says otherwise. Chrome also sets `WS_EX_APPWINDOW`, which forces
a button even for windows that would normally not get one.

**Rule.** Mark the browser's top-level windows as tool windows —
`WS_EX_TOOLWINDOW (0x80)` on, `WS_EX_APPWINDOW (0x40000)` off, then
`SetWindowPos(..., SWP_FRAMECHANGED)` — never `SW_HIDE`. A hidden window stops painting, and the
challenge needs frames; the same measurement that rules out `--headless` rules out hiding.
The style is per window, so it has to be (re)applied after the window exists: once when the page
attaches, again when it becomes interactive (Chrome can restore a window on a crash).
Best effort only — a failure here is cosmetic and must never fail the request.

---

## 11. Killing the automation browser puts "Restore pages?" in the user's face

**Symptom.** An occasional Chrome dialog reading "Restore pages? Chrome didn't shut down correctly",
with a Restore button — shown to the user, on top of the vault.

**Cause.** The idle teardown killed the browser (`child.kill()`), so Chrome recorded an unclean
exit: the profile's `Default/Preferences` read `profile.exit_type: "Crashed"` (measured). On the
next launch Chrome treats that as a crash, offers to restore, and — this is why it was *visible* —
that prompt is browser UI, not something the offscreen window position controls.

Second, smaller trap: `Browser.log`-style politeness is not enough on its own. Even after a
graceful close Chrome leaves `exit_type: "Crashed"` in the file while `exited_cleanly: true`;
it writes "Crashed" while running and does not reliably flush the clean value on the way out
(measured right after a polite `Browser.close`).

**Rules.**
1. Close through the browser, not the process: send `Browser.close` on the browser endpoint and
   wait for the process to exit; only then force it. This is also what makes a *hot* profile
   reusable, since the shutdown flushes the session.
2. Do not trust the file to be right in either direction: repair it before every launch
   (`exit_type: Normal`, `exited_cleanly: true`) and record the same state after our own orderly
   close. The repair also covers a wedge or a crash we did not cause.
3. Add `--hide-crash-restore-bubble` as the last line of defence.
4. A browser-UI dialog cannot be hidden by positioning or window styles, so it must never be
   allowed to appear; assume any such prompt will land in the middle of the user's screen.

---

## 12. `position: fixed; inset: 0` collapses when SillyTavern's `html` has height 0

**Symptom.** At phone width the vault "opened" but showed only a 14 px strip at the top of the
screen; the filter sheet's close button sat outside the viewport and could not be clicked. At
desktop width everything was perfect.

**Measured cause.** On SillyTavern's small-screen layout `document.documentElement` computes to
`height: 0px` (body is `position: fixed` with the real height). A fixed element is positioned
against that box, so `inset: 0` produced `height: 0` for `#wv-root` (the shell then painted a
14 px sliver), and for every full-screen layer inside it — the filter sheet centred its 776 px
body in a 0 px box and landed at **y = −388**, i.e. its header off-screen. Setting
`height: 100dvh` on the root measured 844 px immediately, which confirmed the mechanism.

**Rules.**
1. Never size a full-screen overlay with `inset: 0` alone when the host page is not yours: give
   it explicit viewport units (`height: 100vh` then `height: 100dvh`) and keep the width from
   left/right so a desktop scrollbar cannot push `100vw` past the edge.
2. Apply it to *every* full-screen fixed layer (sheet, detail, sub-sheet, mode overlay), not just
   the outermost one — each one resolves against the same zero-height box.
3. A flex child that must scroll needs `min-height: 0`; without it the sheet grows past the
   viewport instead of scrolling, and `max-height: calc(100dvh - 24px)` does the rest.
4. Test at 390 px against the real SillyTavern UI. This class of bug cannot appear in a screenshot
   of the extension served on its own.

---

## 13. A provider's tag vocabulary is not another provider's

**Symptom.** Two silent no-ops found in the same pass:
- After switching provider, the filter sheet still listed the *previous* provider's tags. They go
  to the server as names, resolve to nothing for the new source, and the search quietly ignores
  them.
- The JannyAI "tag list is old / built-in" note never appeared, even with a six-day-old cache.

**Measured causes.** `setSource()` reset the query, filters and sort, but kept `state.tagCloud`;
and the note compared ages with `Date.parse(fetchedAt)` where the server sends epoch
**milliseconds as a number** — `Date.parse()` wants a string and returns `NaN`, so the age test was
always false and the note stayed hidden.

**Rules.**
1. Clear per-provider caches (`tagCloud`, `tagSuggestions`, `tagMeta`, tag query) in `setSource()`
   next to the other per-provider state. A vocabulary is part of the provider contract.
2. Check the wire type before parsing: numbers stay numbers (`typeof x === 'number' ? x : Date.parse(x)`).
   A "condition never true" bug looks exactly like a missing feature.
3. Verify a note/indicator by making it appear: age the cache to six days (inside the seven-day
   TTL, so it is not auto-refreshed) and confirm the text *and* its Refresh action, then confirm
   it disappears after a refresh.
4. Also: revealing the automation window for a manual Cloudflare check re-adds its taskbar button
   even though `WS_EX_TOOLWINDOW` is still set — the shell re-evaluates when the window is shown.
   Toggling the bit off and on (with `SWP_FRAMECHANGED` each time) removes the button again while
   the window stays visible and clickable.

## 14. A window born offscreen shows blank white when you try to give it to the user

**Symptom.** The JanitorAI sign-in window appeared on screen as a plain white rectangle. Nothing in it, no page, and no way to use it — the user had to open Task Manager and kill Chrome. The import path was fine; only the human-facing window was broken.

**Measured cause — four separate faults stacked on top of each other.**

1. *The page was never the problem.* Attaching to the same tab over CDP reported `readyState: complete`, `title: "janitor - Login"`, 303 characters of body text, 98 nodes, `first-paint` and `first-contentful-paint` both recorded, and `Page.captureScreenshot` returned a 44 795-byte frame showing the full login form. The renderer had painted. The **window** had not.
2. *A stale compositor surface.* Our windows are created at `--window-position=-32000,-32000`. Moving such a window with `SetWindowPos` does not give it a fresh surface: the window stays unpainted while the renderer keeps drawing into a surface nobody displays. Our own `revealProfileWindows` used exactly that approach.
3. *We raised the wrong window.* `reveal()` reported `revealed: 10` — it moved and raised every visible window belonging to the profile's processes, including Chrome's untitled helper windows. The topmost window after that sequence can be a blank helper, which is precisely what "a plain white rectangle" looks like.
4. *It did not look or behave like an app window.* The tool-window style we apply to keep sessions out of the taskbar (`WS_EX_TOOLWINDOW`) gives no taskbar button and no Alt-Tab entry. For an unattended session that is the point; for a window the user must type into it reads as a broken, unclosable window. On top of that Chrome displayed its "You are using an unsupported command-line flag" infobar, because `--disable-blink-features=AutomationControlled` is a flag it complains about.

**Rule.**
- **Place human-facing windows through Chrome itself:** `Browser.getWindowForTarget` → `Browser.setWindowBounds({ windowState: 'normal' })` → `setWindowBounds({ left, top, width, height })`. Never `SetWindowPos` a window that was born offscreen. Follow with a one-pixel resize and back, which forces the compositor to reallocate its output.
- **Raise only titled windows.** Skip any window whose `GetWindowTextW` is empty — that is a helper. `SetForegroundWindow` is refused when the caller is not the foreground app, so attach the input queues first (`AttachThreadInput(fgThread, myThread, true) … false`).
- **A window a human must use is a normal window:** clear `WS_EX_TOOLWINDOW`, set `WS_EX_APPWINDOW`, then re-hide it (`park()`) once the step is done. Do not leave a stray normal window on the desktop.
- **Hold the session while a human is working.** The 30 s idle teardown closed the sign-in window before it could be used — measured: 0 processes at +38 s, 11 at +42 s with `hold()`.
- **Suppress the flag infobar** with `--test-type` when `--disable-blink-features` is in use.

**Check.** After any `reveal()`, screenshot the window itself with `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)`, not the desktop — the desktop grab only tells you what is on top, and the user may be looking at something else. A correct reveal shows browser chrome, the address bar, the page, and no infobar.

## 15. JanitorAI ignores its own cookies — a signed-in session reads as signed out

**Symptom.** The user signed in successfully (Google, in the revealed window), the page moved from `/login` to the feed, and `GET /api/weavers-vault/janitor/account` still answered `{"signedIn":false,"status":401}`.

**Measured cause.** The site authenticates its API with a bearer token, not with the cookie session. On the *same* browser, on the *same* page, with the auth cookie present in the jar:

| Request | Result |
|---|---|
| `fetch('/hampter/profiles/mine', {credentials:'include'})` | `401 {"message":"Unauthorized","statusCode":401}` |
| same call + `Authorization: Bearer <access_token>` | `200` with the profile (`id`, `name`, `user_name`, `config`, …) |

The token is **not** in `localStorage`. It is inside the chunked Supabase cookies `sb-<ref>-auth-token.0`, `.1`, … (measured: 3 180 + 1 763 bytes), either as raw JSON or as `base64-` + base64url JSON — both forms occur. Reading cookies alone therefore proves nothing, and `document.cookie` shows the cookie names while the API still refuses.

**Rule.**
- Authenticated JanitorAI reads carry `Authorization: Bearer <access_token>` decoded from the chunked `sb-*-auth-token.N` cookies in-page, ordered by the numeric suffix. Cookies alone are never enough.
- Anonymous reads do work (tags, listing, detail all answered 200 anonymously), so a missing token degrades to anonymous — it does not fail. That is exactly why this cannot be detected by "does it return 200".
- A parked page's token can expire unnoticed. Reload once to let the site's own client refresh it, rather than trying to mint a token ourselves.
- Never trust a `200` as "signed in": only the account endpoint with an identity in it counts.

**Check.** `GET /api/weavers-vault/janitor/account` must return `signedIn: true` with a name — measured `{"signedIn":true,"name":"Yang","id":"7bc4e46f-…","status":200}`.

**Related trap, same session.** `browser.evaluate` does not exist: `evaluate` lives on the page connection (`CdpPage`), not on `VaultBrowser`. Calling it threw `browser.evaluate is not a function`, which surfaced as the very same 401. `VaultBrowser.evaluateInPage()` now exists for in-page expressions and enqueues like a fetch.
