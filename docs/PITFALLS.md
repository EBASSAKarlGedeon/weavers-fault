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

## 16. A payload's `avatar` is a CDN key, not a URL

**Symptom.** Every imported JanitorAI card arrived with the default five.png avatar, and no error was logged that a user would ever see.

**Measured cause.** The detail payload carries `avatar: "fP9hArYdWUi1ML3cb7IqN.webp"` — a bare key. The import path did `fetch(avatarUrl)` on it, which throws (relative URL, no scheme), and the catch fell through to the default avatar. Nothing failed loudly, so the card looked merely plain.

**Rule.** Resolve a source's image before fetching it, using that source's own contract. JanitorAI's is Glaze's `resolveJanitorAvatar`: `http…` unchanged, leading `/` under `https://ella.janitorai.com`, a bare key under `/bot-avatars/`, anything else under the CDN root, all with `?width=400`. Measured result after the fix: the card PNG went from 312 695 bytes (the default avatar) to 422 974 bytes (the real one).

**Check.** `normalizeJanitorRow(...).avatar` must start with `https://`, and the built card must not be byte-identical to `public/img/five.png`.

## 17. One derived value, two writers

**Symptom.** Switching to JanitorAI showed the chip "JanitorAI" but the search box still said "Search characters...", advertising a search the source did not do yet.

**Measured cause.** Both `hydrateSourceChip()` and `applySourceLayout()` set `search.placeholder`, and the layout pass unconditionally wrote the generic string — so whichever ran last won. Saucepan looked correct only because its layout pass never touched the placeholder.

**Rule.** A value derived from the active source gets **one** producer. `searchPlaceholder()` now answers for every source and both callers ask it. The same shape of bug is what produced the tag-vocabulary leak in `setSource()` (PITFALLS #13) — per-source state written in more than one place drifts.

**Check.** For every provider, read the chip label and the placeholder together; they must describe the same source (verified: chub/saucepan/janitor each correct).

## 18. `Page.addScriptToEvaluateOnNewDocument` does nothing unless `Page.enable` came first

**Symptom.** The capture reached "sending probe" and died with `TypeError: window.__glazeSend is not a function`; a second run waited the full 60 s composer budget and reported "the composer never appeared". The page itself was fine and the script file parsed.

**Measured cause.** The driver wrapped `Page.addScriptToEvaluateOnNewDocument` and got an identifier back — `{"identifier":"1"}` — so the call looked successful, but the script was never applied to the new document. On the same browser, same page, same script:

| Call order | After `Page.reload()` |
|---|---|
| `addScriptToEvaluateOnNewDocument` alone | `typeof window.__glazeSend === "undefined"` |
| `Page.enable`, then the same call | `__glazeHooked === true`, `typeof window.__glazeSend === "function"` |

A trivial `window.__probe = 1` behaves identically, so this is the mechanism, not the vendored script. The CDP command is accepted either way — there is no error to notice.

**Rule.** `VaultBrowser.addInitScript()` sends `Page.enable` before adding a script, every time (it is idempotent and cheap). "The call returned an identifier" is not evidence that the script will run.

**Check.** After the next navigation, assert the script's own marker: `typeof window.__glazeSend === 'function'`. Never assume an injected script is live because the injection call resolved.

## 19. A WebView-ported send is the wrong send under CDP

**Symptom.** The message was typed into the composer (visible in a screenshot), the Send button never enabled, nothing was sent, and the capture waited out its full budget for a `/generateAlpha` request.

**Measured cause.** Glaze's `_captureUserScript` types by calling `HTMLTextAreaElement.prototype`'s value setter and dispatching a synthetic `input` event, then clicks with `element.click()`. Inside a Flutter WebView that is the only option. Under CDP it is the wrong one: JanitorAI's editor never registers the edit, so `button[aria-label="Send"]` stayed `disabled=""` and the click was a no-op. Measured on the live chat page: after `Input.insertText` (a *trusted* insertion) the same button reads `disabled: false`.

**Rule.** Use trusted input for anything a human would do: `Input.dispatchMouseEvent` for clicks and focus, `Input.insertText` for text, `Input.dispatchKeyEvent` for Enter. Keep the ported script only for what CDP cannot do from outside the page — hooking `fetch`/`XHR` to read the assembled prompt. `VaultBrowser` exposes `clickPoint`, `insertText`, `pressKey` for exactly this.

**Check.** Type, then require two separate proofs: the text is in the field, and the Send button is enabled and its centre is hit by `elementFromPoint` before clicking.

## 20. "The composer is empty" proves nothing — and reads the wrong composer

**Symptom.** A capture reported the probe as sent, then timed out with "No /generateAlpha request left the page", while the failure screenshot showed the text still sitting in the composer.

**Measured cause.** Three separate mistakes in one check, each of which alone makes the check vacuous:
1. It verified "the last visible textarea is empty" — true before typing, so an untyped field passed.
2. It picked the composer with `.pop()`. Measured on a live chat: two textareas are visible, and the last one is a 670×32 field at `y=0` whose centre is covered by `div._menuWrapper_*`, so `elementFromPoint` returns the menu. The real composer is `textarea._chatTextarea_*` at `(302,670)`, placeholder "Enter to send. Shift+Enter for linebreak."
3. After a modal opens, the "last textarea" is the *modal's* empty field, so "cleared" was satisfied by the wrong element.

**Rule.** Tag the exact element you typed into (`data-wv-composer="1"`), and read *that* back by attribute — never re-resolve "a composer" for verification. Prove the text arrived before sending, and prove it left after. A check that passes on an untouched page is not a check.

**Check.** Walk the failure path deliberately: the diag must report the leftover character count of the tagged element, or `the composer disappeared`, never a bare "ok".

## 21. A fresh JanitorAI account cannot chat at all

**Symptom.** After the send worked, the page showed a **"Complete your profile"** modal (Persona Name + Appearance) over the chat, the message stayed in the composer, and no generation request of any kind left the page — only `POST /dustpan/v1/track → 202`.

**Measured cause.** JanitorAI refuses to generate until the account has a persona. The account measured here had never set one (its `/hampter/api-settings` was empty too: `selected_proxy_config_id: null`, `source: null`, `generation_settings: null`). This is a site-side setup wall, not a capture defect, and it cannot be worked around by retrying. Glaze's persona endpoint (`/hampter/personas`) answers 404 on the current site, so there is no API to create one either.

**Rule.** Detect the wall, do not retry it: visible `Complete your profile` text (or a `persona name` field) ⇒ the capture fails with `janitor_profile_required`, and the route **reveals the browser and holds it** so the human can fill the form. Filling it silently would mutate the user's account identity, which is theirs to choose.

**Check.** With an account that has no persona, `POST /janitor/capture` must answer `409 janitor_profile_required` within seconds, with the window on screen, and leave `dirty: false` and no snapshot.

## 22. A field the pre-flight snapshot never had can never read dirty

**Symptom.** After capturing with a fresh account, `POST /janitor/account/restore` answered `restored: false` with `diff: [{"field":"source","expected":null,"actual":"janitor"},{"field":"generation_settings.context_length","expected":null,"actual":0}]`, and every later restore stayed dirty.

**Measured cause.** The snapshot records what the account had. A fresh account has `source: null`, no selection and no `generation_settings` at all, so:
- the diff compared `null` against the restored `'janitor'` and never matched;
- the restore plan only patched `generation_settings` when a snapshot object existed, so a contextless account kept `context_length: 0` — the exact damage the restore exists to undo.

**Rule.** Compare only what the snapshot actually recorded (`!== null`), and when there is no generation settings object at all, the restore target is `{ context_length: 4096 }` — "original plus a sane context" with no original. A `404` from deleting a capture preset means it is already gone, which is success.

**Check.** `janitorAccountDiff(snapshot, api-settings)` for a fresh account must be `[]` after restore, and `janitorRestorePlan(...)` must carry `context_length: JANITOR_DEFAULT_CONTEXT_LENGTH` even with no snapshot settings.

## 23. A status poll can close the window a human is filling

**Symptom.** The capture answered `409 janitor_profile_required` and revealed the JanitorAI window on the "Complete your profile" form. Within half a minute the window was gone, mid-form.

**Measured cause.** `GET /janitor/account` calls `browser.release()` when it finds a signed-in session — correct for the sign-in flow (hold while the login page is up, release when it worked), wrong here: a status poll arrived while a human was typing, cancelled the hold, and the 30 s idle teardown closed the browser. The reveal itself was fine; the hold was not durable against other requests.

**Rule.** A hold taken for a human mid-task is *sticky*: `hold(ttlMs, { sticky: true })` can only be ended by its own deadline, and `release()` is a no-op while it lasts. The persona wall uses a sticky 20-minute hold.

**Check.** Reveal the persona form, call `/janitor/account` twice, wait 40 s: the browser must still be running (measured: 0 chrome processes before the fix, alive after).

## 24. The user's own converter never decoded `/external-link?to=…`

**Symptom.** After porting `janitor2st.py`, bio links still pointed at JanitorAI — `href="https://janitorai.com/external-link?to=https%3A%2F%2Fexample.com"` — instead of at the creator's actual link.

**Measured cause.** The Python's regex is `^(?:https?://janitorai\.com)?/external-link\?.*?[?&]to=([^&\s]+)`. Run against the shapes the site emits:

| href | Python's match |
|---|---|
| `/external-link?to=https%3A%2F%2Fexample.com%2Fa` | **none** |
| `/external-link?x=1&to=https%3A%2F%2Fexample.com%2Fa` | `https%3A%2F%2Fexample.com%2Fa` |
| `https://janitorai.com/external-link?to=…` | **none** |
| `/external-link?to=a%3Fb%3D1` | **none** |

`.*?[?&]to=` needs a second `?`/`&` before `to=`, so the form the site actually uses (`to=` first) never matched — it fell through to the "relative link" branch and became a redirect kept *through* JanitorAI. The port reads the `to` parameter with `URLSearchParams` when the path is `/external-link`, and keeps the regex for the odd shape.

**Rule.** When porting a script, port its *intent*, and measure the inputs: a regex that only ever matched one of four shapes passed for years because the other three still produced a working-looking link.

**Check.** `convertJanitorBio('<a href="/external-link?to=https%3A%2F%2Fexample.com%2Fa">')` must contain `href="https://example.com/a"` and the log must say `Decoded 1 JanitorAI redirect link(s)`.

## 25. A colour as the first style declaration was invisible to the review scan

**Symptom.** A bio whose only styling was `style="color: #ffffff"` produced no dark-theme warning, so a white-text bio went into a light theme and disappeared.

**Measured cause.** The Python matches `(?:^|[;\s])(color|background-color|background)\s*:` — but in serialized HTML the declaration is preceded by a quote (`style="color: #ffffff"`), which is neither `;` nor whitespace. Colours that followed another declaration (`text-align: center; color: #fff`) matched, which is why the gap survived.

**Rule.** Scan serialized HTML with the serialization's own boundaries: quotes are part of an attribute's syntax. The port's boundary class is `[;\s"']`.

**Check.** `convertJanitorBio('<p style="color: #ffffff">x</p>').log` must contain the light-colour warning.

## 26. Entity decoding decides whether a paragraph is empty

**Symptom.** `<p>&nbsp;</p>` — the most common spacer in a JanitorAI bio — survived the empty-paragraph strip and rendered as a gap.

**Measured cause.** BeautifulSoup decodes entities, so the Python sees a `\xa0`, replaces it with a space, and removes the paragraph. A string-level port that keeps `&nbsp;` as six characters sees content and keeps it.

**Rule.** Decode entities when building the tree (`&amp; &lt; &gt; &quot; &#39; &nbsp;` + numeric forms), and escape again on output. Unknown named entities are left alone so they survive instead of becoming `&amp;name;`.

**Check.** `<p>a</p><p>&nbsp;</p><p>b</p>` must yield two paragraphs and a `Removed 1 empty spacer paragraphs` log line.

## 27. A converter that feeds `innerHTML` must sanitise

**Symptom.** Not yet observed — and it must stay that way. The converter's output is now rendered in the vault sheet *and* stored in a card, automatically, from third-party HTML.

**Measured cause.** `janitor2st.py` only drops `<svg>` and `<style>`. That is defensible for a tool whose output a human pastes into SillyTavern (they can see what landed). Ours is neither inspected by a human nor inert: `renderDetailClosed` sets it with `innerHTML`, so `<img onerror=…>`, `<script>` or `href="javascript:…"` would execute in the Loreweaver origin.

**Rule.** Strip `<script> <style> <svg> <iframe> <object> <embed> <form> <input> <button> <meta> <link>`, every `on*` attribute and every `javascript:` URL, and log `[SAFE] Removed N executable attribute(s)`. The bio is untrusted text about a character, never markup we authored.

**Check.** `<p onclick="steal()">` loses its handler; `<iframe>` and `<script>` vanish; a `https:` link keeps its href.

## 28. The extension tree is gitignored in the main repo, so the server must not import from it

**Symptom.** Caught before it shipped: moving the bio converter into `public/scripts/extensions/weavers-vault/` and importing it from `src/endpoints/` worked locally, because that directory exists on this machine.

**Measured cause.** `.gitignore:70` ignores `public/scripts/extensions/weavers-vault/` in the **main** repo — it is a separate clone with its own remote (`weavers-fault`). A fresh clone of Loreweaver therefore has no such file, and the server would fail at module load, not at request time. `git ls-files` shows zero tracked files under that path.

**Rule.** Server code may not import from `public/scripts/extensions/**`. Shared logic lives in `src/` and the client receives it as data (here: the server converts the bio and returns `bioHtml`). One implementation, no second copy in the extension.

**Check.** `git ls-files src/endpoints | grep janitor-html` finds the module, and `grep -rn "public/scripts/extensions" src/` finds no import.

## 29. A pasted link is not a search phrase

**Symptom.** JanitorAI's new browse grid rendered "No results" on first open, with a search box that looked empty.

**Measured cause.** `state.query` is persisted in settings, and on this install it still held the URL pasted during the S4 import (`https://janitorai.com/characters/57077881-…_sobo-gym-guy`). Two things then compounded:
- `setSource()` only cleared the query when the source *changed*, so re-opening the same source kept it;
- the search request sent it as `search=<that URL>`, and the site matched nothing.

The box looked empty because the placeholder had been rewritten for browsing while the value came from a restore path that does not touch the input.

**Rule.** A browser-backed source's query is either a phrase or a paste-URL, never both. The search request skips a query that parses as that source's character URL, and entering the source drops a persisted paste-URL. Any provider that both browses and accepts links needs this in its request builder, not in its UI.

**Check.** Persist a URL as `query`, reload, switch to JanitorAI: the box is empty, one unfiltered listing request goes out, and cards render.

## 30. The row normalizer never filled `tags`

**Symptom.** Every JanitorAI grid card showed only its SFW/NSFW chip — no tag chips at all — while the same card's detail sheet listed five tags.

**Measured cause.** `normalizeJanitorRow` declared `const cardTags = []` and never populated it, though the site sends full tag objects (`{"id":1,"name":"👨 Male","slug":"male"}`); only `tagIds` was derived. The grid draws `item.tags`, so the array was always empty. The detail sheet was unaffected because it reads names from the raw payload.

**Rule.** A normalizer must fill every field it declares. When the payload shape is known (objects, not ids), map it — and let the UI pass read the chips, because "the field exists" is not "the field has content".

**Check.** `normalizeJanitorHit(row).tags` equals `['Male']` for a row with one tag object, and every grid card shows its tag chips.

## 31. Hiding a filter row by its assumed class hid nothing

**Symptom.** The phone filter sheet still offered "Token Range" for JanitorAI, whose listing has no token parameter at all.

**Measured cause.** The rule hid `.wv-mintok`'s `closest('.wv-mrow')`. Measured in the live DOM, the token range is not a `.wv-mrow` at all:

```
div.wv-tinput > div.wv-range > div.wv-rangerow > section.wv-mcard > div.wv-sheetbody
```

`closest('.wv-mrow')` returned `null`, so nothing was hidden and the sheet advertised a filter that could never run. The neighbouring numeric fields (AI rating, tag count) *are* `.wv-mrow`s, which is why the same pattern worked one row down.

**Rule.** When a rule hides UI by class, assert the class exists in the live DOM first — a `null` from `closest()` is silent. And prefer hiding the smallest honest unit: here the `.wv-rangerow` *and* its Card section, which afterwards holds only chub-only rows.

**Check.** On a phone-width sheet for JanitorAI: "Token Range", "Minimum AI rating", "Minimum tag count" are all absent, while Content and Tags remain.

## 32. A classification carried in `code` is lost the moment it crosses a boundary

**Symptom.** S9's ledger recorded `{"what":"blocked","reason":"janitor_missing"}` for a paste of a
non-existent character, while the toast said "JanitorAI has no character with that id." The route
had answered `{"code":"janitor_missing","reason":"missing"}` — measured, the reason was there and
was then dropped.

**Measured cause.** `failureReason()` prefers `source.reason ?? source.code`, but the paste path
does not throw the payload — it throws the error it built:

```js
if (!r.ok) throw vaultError(payload?.error || `…`, payload?.code, r.status);   // code only
…
} catch (error) { ledgerFail(item, 'blocked', failureReason(error, error.status)); }
```

`vaultError` stored `code` and `status` but not `reason`, so the ledger fell through to the
transport code. Nothing failed loudly: the ledger simply recorded a word that means nothing to a
reader, and the vocabulary the plan asks for (`missing`, `challenge`, `signed-out`, …) never
reached it.

**Rule.** When a value is deliberately translated at a boundary (transport code → phenomenon), the
translated value must travel *on the thing that crosses the boundary*. `vaultError` now takes a
fourth argument and stores `reason`, and every janitor throw passes `payload.reason`. Never
re-derive a user-facing reason from a code at the consumer when the producer already sent one.

**Check.** Paste `https://janitorai.com/characters/00000000-0000-4000-8000-000000000001`: the new
ledger line must read `"reason":"missing"`, not `"reason":"janitor_missing"`. Measured after the
fix: `{"source":"janitor","id":"00000000-…-000000000001","what":"blocked","reason":"missing"}`.

## 33. A filter the UI shows but the request never sends is not a filter

**Symptom.** With the filter sheet's "Show NSFW" switch off, the JanitorAI grid filled with
NSFW-rated cards. The same switch worked for chub, janny and datacat, so it looked like a site
problem.

**Measured cause.** The switch is only ever a value in `state.filters`; each provider turns it into
its own parameter. chub and datacat put `nsfw: f.nsfw` in a JSON body, but the janitor branch of
`searchRequest()` built the query string from `page`, `sort`, `search` and `tags[]` only, while the
server route *did* accept `mode` (`/janitor/search` → `janitorSearchUrl({ mode })`, `'sfw'` vs
`'all'`). Measured through the page's own fetch recorder, every request read
`…&mode=all&…` regardless of the switch, and the site obligingly returned 34 cards, all NSFW.

**Rule.** A filter is only real when the request carries it. When a provider has its own switch
name (`mode=sfw`), the provider branch that builds the request owns that translation, and the
route's whitelist must have a test proving the value survives. Guard the *rendering* too: "Show
NSFW off" is a promise about what is on screen, so `renderGrid()` drops `item.nsfw` rows for every
source instead of trusting each provider's filter (a site's "SFW mode" can still list NSFW-rated
bots).

**Check.** With the switch off, the recorded URL must contain `mode=sfw` and the grid must contain
zero `.wv-c-nsfw` chips; with it on, the same search must read `mode=all` and the rows must come
back. Measured 2026-11-26: off → `mode=sfw`, 6 cards / 0 NSFW; on → `mode=all`, 34 cards / 34 NSFW.

## 34. A control character written into a regex compiles and never matches

**Symptom.** A JanitorAI card's bio in the detail window showed literal `<p>` tags and stick-together
paragraphs, while the same text rendered correctly elsewhere. Nothing threw.

**Measured cause.** The guard that decides "this string is HTML" was

```js
/^<(div|p|h[1-6]|ul|ol|blockquote)\b/i.test(bioText)
```

with `\b` written as a raw `0x08` byte (a backspace) instead of the two characters `\` `b`. A
literal backspace never follows `>` in the converted bio, so `isHtml` was always `false` and the
text took the escape-only branch. `node --check` is happy: it is a valid regex.

**Rule.** `\b`, `\t`, `\n` inside a *regex literal* are two characters on purpose; never let a
`\x08`/`\x0b` reach a source file through a heredoc or a tool that interprets escapes. When a
boolean guard "never fires", measure the guard's own value in the page before reading the branch
below it.

**Check.** `grep -c $'\x08' index.js` must be `0`; a janitor card's Description drawer must contain
real `<p>` elements (`wv-biohtml` + `strong` count > 0), not escaped tags.

## 35. A revealed window keeps the taskbar button that reveal() was supposed to remove

**Symptom.** A Chrome icon sat in the Windows taskbar for minutes "while using JanitorAI" in the
vault, even though the automation window was supposed to be invisible. Closing the vault made it
disappear, which is why it kept being reported as "still not patched".

**Measured cause.** `start()` applies `WS_EX_TOOLWINDOW` and clears `WS_EX_APPWINDOW`, which is
what removes the taskbar button. `reveal()` — the human step for sign-in and the persona wall —
deliberately reverses that so the window behaves like a normal one, and sets `taskbarHidden =
false`. The only code that ever put the style back was `release() → park()`, and `release()` returns
early while a **sticky** hold is live (the persona wall holds for 20 minutes). Measured on the live
window: idle `ex=0x00200180` (`tool=True app=False`), after `POST /janitor/browser/focus`
`ex=0x00240100` (`tool=False app=True`) — a taskbar button, with nothing to remove it until the hold
expired.

**Rule.** The window being on screen and the window having a taskbar button are separate concerns;
`reveal()` must satisfy only the first. `hideWindow()` restyles without moving or hiding, so call it
at the end of every reveal (and once more ~1.5 s later, because the shell can add the button a beat
after the window is shown). A human-facing window stays usable: it is placed, raised and focused, it
is simply not in the taskbar.

**Check.** `POST /api/weavers-vault/janitor/browser/focus`, then read the window's `GWL_EXSTYLE`:
`tool=True app=False vis=True`. The window must still paint — a desktop capture must show the site,
not a blank surface (`WS_EX_APPWINDOW`/`SetWindowPos` frame changes can strand a stale surface, which
is why the check includes looking at it, not just the bit).

## 36. A tab strip sized for a scrolling list of tabs clips a three-tab window

**Symptom.** The detail window showed "Info" and "Prompt Blocks" and then a sliver of the Images
icon at the right edge, with no visible way to reach it.

**Measured cause.** `PillTabStrip` came from a design with more tabs and a deliberate "2.35 tabs
visible, the rest scrolls" budget; with exactly three tabs it split the strip into 42.6% segments.
Measured in the live window: `scrollWidth 751` against `clientWidth 594` — the third tab started at
501 px and ended past the strip, and `overflow-x: auto` had its scrollbar hidden
(`scrollbar-width: none`), so the clip looked like a rendering bug.

**Rule.** A tab strip may overflow only when the tab count is unbounded. Ours is three, fixed, so
each segment is a third (`flex: 1 1 0`, indicator `calc((100% - 6px) / 3)`) and the whole strip is
reachable without scrolling.

**Check.** With any card open, `.wv-dtabs` must report `scrollWidth === clientWidth`, and all three
labels must be inside its box; clicking the third must move the pill to the third segment (measured:
tabs at 338–536 / 536–734 / 734–932, indicator 730–926).

## 37. Adoption skipped the step that hides the window

**Symptom.** "The Chrome window appears and disappears after like 30 seconds." Sometimes with a taskbar
button, sometimes without, always for a moment, and never reproducible by just browsing.

**Measured cause.** Two holes in the same place, both in the *reuse* path:

- `adoptExisting()` — which every request after the first takes, because the session stays alive between
  requests — attached the page and returned. It applied neither `hideWindow()` nor `park()`. Whatever a
  previous human step (sign-in, persona wall, "Show the browser window") left on the desktop therefore
  stayed on the desktop for the rest of the session, instead of being put back the moment the next
  request arrived.
- `park()` began with `if (!this.page || !this.windowId) return;`, and `windowId` is only set by
  `placeWindowOnScreen()` — i.e. by a *reveal*. A window that was never revealed had no id, so `park()`
  silently did nothing, and `start()`'s `--window-position=-32000,-32000` is not a guarantee either:
  Chrome restores the placement it saved for the profile (measured: a reveal writes `40,40` into
  `Preferences.window.browser.window_placement`, and the next session is born there).

So a single reveal could leave the window on screen for the whole session, and the 30 s idle teardown
was the thing that finally removed it. The taskbar fix (#35) was real but answered a different
question: the window could be *on screen* and out of the taskbar at the same time.

**Rule.** Every path that attaches to an existing page must re-assert the window's state, not only the
fresh-start path. `park()` must fetch the window id itself when it does not have one. `reveal()` must
take its own hold (3 min, non-sticky) so the idle teardown cannot close a window a human is looking at
— a revealed window without a hold lived exactly as long as the idle TTL.

**Check.** Measure the window rectangle, not the flags: `(-26214,-26214)` when parked, `(40,40)` after a
reveal. After the fix: fresh start parked, reveal `(40,40)` with `tool=True app=False` (no taskbar, no
Alt-Tab entry), `park()` brings it back offscreen even when it was never revealed.

## 38. The card's badge is the message count, not the chat count

**Symptom.** A card showed `26.7k` in the vault grid and `991k` on janitorai.com — the number the site
prints under the chat bubble.

**Measured cause.** The listing row carries both `stats.chat` and `stats.message`; the grid was mapped
to `stats.chat`. Measured on "The Bracelet Stays On": `chat = 26,787`, `message = 994,892`, site badge
`991k` — so the site's "chats" badge is the *message* total. One request through the route after the
fix returned `chatCount: 996,977` for the same card, matching the site as it grows.

**Rule.** A badge must show the number the source puts in the same place; field names are not evidence
(`pp-cc-chats-count` is fed by `stats.message`). `normalizeJanitorHit()` now maps `chatCount` to
`messages` and keeps `chats` available for anything that needs the real chat count.

**Check.** `normalizeJanitorHit({ stats: { chat: 26787, message: 994892 } }).chatCount === 994892`, and
the card's badge must read the same `NNNk` the site shows for it.

## 39. A module-level constant left behind when code moves

**Symptom.** Right after the engine was split out of `weavers-vault-browser.js` into
`weavers-vault-chrome-backend.js` (EMBEDDED-ENGINE-PLAN Phase 1), the first real request died with
`ReferenceError: BROWSER_CANDIDATES is not defined` inside `findBrowserBinary()` — i.e. the vault could
not find a browser at all, on a suite that was green at that moment.

**Measured cause.** The move was done by slicing the old file into fragments, and one slice ended at the
*docblock above* `BROWSER_CANDIDATES` instead of after the array: the helper moved, the list it reads
did not. Nothing in the unit suite starts a browser — the seam tests build a session and stub the
backend, and the route tests never call `start()` — so the only code that reads that constant ran for the
first time in the smoke test (2.5 s in, at `findBrowserBinary`).

**Rule.** When code moves between modules, move the module-level state it closes over in the same
commit, and prove the move with something that *executes* the moved path. A green suite says the move is
syntactically consistent, not that it is complete: `node --check` cannot see a missing binding either.
The cheap end-to-end proof is a local origin — `host: '127.0.0.1'`, `origin: 'http://127.0.0.1:8000/'`
needs no site traffic and exercises spawn → attach → wait → fetch → reveal → park → dispose.

**Check.** A session must start against a local origin, and
`tests/vault/vault-client-contracts.test.js` pins that `BROWSER_CANDIDATES` is declared and read by
`findBrowserBinary()` so the list cannot be left behind again.

## 40. The window a human had to sign in through had no taskbar button

**Symptom.** During a sign-in the Chrome window was on screen, but it was missing from the
taskbar and from Alt-Tab, so leaving it and coming back meant hunting for it — reported as "I
cannot get back to that window".

**Measured cause.** `reveal()` ended by calling `hideWindow()` (and a second time from a 1.5 s
timer), which applies `WS_EX_TOOLWINDOW`. That is precisely the style that removes a window from
the taskbar and from Alt-Tab, added in #35 on purpose — for the *parked* automation window. Applied
to the one window a human must find and type into, it made that window reachable only by minimising
everything else. The reasoning behind it ("a taskbar button would leave a stray Chrome icon while
using the vault") only holds for a window nobody needs.

**Rule.** Hiding is scoped to the modes where nobody needs the window. The tool style belongs on the
parked window and must be *off* while a human step is in progress: `reveal()` calls
`normalizeProfileWindows()`, sets `taskbarHidden = false` and does not re-hide, then `release()` →
`park()` puts the style back. A window with neither a taskbar button nor an Alt-Tab entry is not
"less intrusive", it is unreachable — and it is the same window a Cloudflare challenge may need a
human to click in.

**Check.** Sample the extended style across one reveal/release cycle (native sampler, 10 ms):
revealed window `0x240100` (APPWINDOW, tool off) at `(40,40)`; after `park()` `0x200180`
(TOOLWINDOW, app off) at `(-26214,-26214)`. The `window hygiene` tests in `tests/vault/vault-browser-backend.test.js` pin that
`reveal()` never calls `hideWindow()` again, and that `start()` parks before it waits.

## 41. The taskbar button exists before any of our code can reach it

**Symptom.** "Chrome flashes open and shut" at the start of a vault request: a Chrome button appears
in the taskbar (and in Alt-Tab) for a moment, with no window visible anywhere.

**Measured cause.** `hideProfileWindows()` can only run after the browser answers on its debugging
port, and each call boots a fresh `powershell.exe` and compiles its P/Invoke helper. Measured
2026-11-25 with a native 10 ms sampler on the browser PID: the window carried a taskbar button for
**1054 ms** with a warm PowerShell and **6896 ms** cold, on every launch. The window itself never
appeared — it is born at `-26214,-26214` and stayed there — so the button was the only thing the user
could perceive.

**Rule.** Apply the style from a watcher that is already running before the browser spawns:
`startTaskbarWatch()` is called at the top of `start()` (its `Add-Type` compiles while Chrome boots),
polls the profile's windows every 50 ms and restyles any window the moment it exists. The later
`hideWindow()` calls stay as the fallback for a machine where PowerShell cannot start. The watcher
also repairs what Chrome itself undoes: every `Browser.setWindowBounds` rebuilds the window and drops
the custom style, which is why `park()` must come *before* the challenge wait and why the watcher
must outlive it. It is stopped in `reveal()` (a running watcher would strip the human's button again)
and in `dispose()`.

**Check.** With the sampler on the browser PID: the first observation after birth is already
`0x200180` (0 ms of button at 10 ms resolution), and the two times Chrome rebuilds the window during
start the style comes back 17 ms and 85 ms later. Before the watcher: 1054–6896 ms.

## 42. A headless browser that describes itself is blocked, not challenged

**Symptom.** A `--headless=new` vault browser gets the firewall's block page on janitorai.com: title
"Access Restricted", body "Your access has been blocked by our firewall", **status 200**, no Cloudflare
interstitial, nothing to click, and a retry that fails identically. The same profile in a visible Chrome
loads the same URL fine.

**Measured cause.** The first headless build copied the identity from *the headless page itself*, so the
UA it sent was `...HeadlessChrome/158.0.8127.37...` (2026-11-25). The firewall reads the request, not the
renderer: it answers a self-identifying headless browser with a block, not a challenge, so none of the
challenge handling (reload, `_cf_chl_opt`, `cf-mitigated`) ever applies. Two further identity traps were
measured the same day: `navigator.userAgentData` is **empty on `about:blank`** (brands `[]`, which no real
Chrome reports), and headless reports `outerWidth/Height` 800x600 whatever the window bounds say, i.e.
`outer < inner` — impossible for a real window. The block page is also **200 OK**, so a status check sees
a perfectly good page and 710 KB of "your access has been blocked" reaches the parsers (hence the
`needsHuman()` and `readyExpression()` guards).

**Rule.** Never let the headless browser describe the machine. Measure the identity once with a **real
headful Chrome** on the same machine — `ChromeBackend.measureIdentity()`: a throwaway profile, a local
`file://` page (a secure context, so `getHighEntropyValues()` answers in full), parked and taskbar-hidden,
**no network at all** — cache it in `headless-identity.json` beside the profile (keyed by Chrome major
version, 7-day TTL), and have it in place **before the first request**: `Emulation.setUserAgentOverride`
(UA verbatim; `Chrome/<major>.0.0.0` is what a desktop Chrome sends), `Emulation.setDeviceMetricsOverride`
(measured screen and DPR, outer size never smaller than the viewport), and, when headless,
`--user-agent=` on the command line (see #43). Refuse to start headless if no usable identity was
measured — a guess is a different fingerprint, not a fix.

**Check.** `node scripts/smoke-headless-backend.mjs` (local origin, no site traffic): `brands:
[Chromium/158, Not.A/Brand/24, Google Chrome/158]`, `saysHeadless: false`, the machine screen (1536x864,
dpr 1.25), `outer > inner`, `osWindows: 0`. Measured 2026-11-25: 6.7–9.8 s for the first run (measuring
launch + headless launch), 8 processes, 0 windows. Then, only with a go-ahead, one real page load
(`scripts/probe-headless-site.mjs`): title "JanitorAI - Build, share, and explore", signed in, in-page
fetch 200.

## 43. The first navigation is the one that gets judged

**Symptom.** The page-side identity is verifiably correct — `navigator.userAgent` has no `Headless`, the
brands are the Chrome ones, the screen is right — and the site *still* serves the block page. A fetch
issued from that same page afterwards is clean.

**Measured cause.** `--headless=new` sends `HeadlessChrome/<version>` on the **first navigation**, which
happens before any CDP session exists to override it: over CDP the identity is applied after attach, and
the request that decides the answer has already left. A local server that prints what arrived
(`scripts/probe-request-headers.mjs`) shows it plainly: the document request carried
`HeadlessChrome/158.0.0.0`, the next fetch from the same page carried `Chrome/158.0.0.0`. Everything else
on the wire — `Sec-CH-UA*`, `Sec-Fetch-*`, `Accept-Language`, encodings, header set — was already
identical to the headful browser, which is why the page-side fingerprint diff looked perfect while the
block stayed.

**Rule.** Anything the server reads *per request* belongs to the launch configuration, not to post-attach
setup: pass `--user-agent=<measured UA>` when launching headless, and keep the CDP override for the
high-entropy metadata it also sets. Verify identity by reading the request, never the page — a page can
report a corrected UA while the request that fetched it said something else.

**Check.** `node scripts/probe-request-headers.mjs` (local server, no site traffic): the `user-agent` rows
for the document **and** the fetch must be identical between headless and headful. Measured 2026-11-25:
before the flag, the headless document request said `HeadlessChrome/158.0.0.0` while its own fetch said
`Chrome/158.0.0.0`; after it, both say `Chrome/158.0.0.0`.



## 44. An open accordion body with a pixel cap hides the rest of the description

**Symptom.** In the character detail sheet, an open Description (or any Prompt Blocks section) stops
mid-sentence at a fixed point: no scrollbar inside the box, no ellipsis, and the sheet's own scrollbar
reaches its end at that line. Everything after it is unreachable. Short descriptions look perfect,
which is why it survived the layout pass.

**Measured cause.** `style.css` opened the accordion with `max-height: 2000px` and `overflow: hidden`
(the closed 96px state animated up to that figure). `overflow: hidden` on a box that is not a scroll
container clips the remainder outright, and 2000px was a stand-in for "tall enough", not a measurement.
Measured 2026-11-26 in a stylesheet harness (the shipped CSS, a 90-line body at 640px wide): the body
held 5665px of content, painted 1956px, and the sheet's scroll area ended at **2511px** — about 3.5k
pixels of text behind an invisible wall. The scroll container (`.wv-dscroll`) was never the problem.

**Rule.** A box that must show everything gets `max-height: none`, never a pixel guess. Keep the
expansion animation by measuring instead of guessing: on open set the inline `max-height` to
`scrollHeight`, then release it to `none` on `transitionend` (and pin `scrollHeight` before closing, or
the animation snaps from `none`). One scroll container per sheet — the sheet — never a nested scroll
box inside it.

**Check.** `tests/vault/vault-client-contracts.test.js` pins the contract: the open rule matches
`max-height: none` and carries no pixel value, the closed rule keeps its clamp, and the toggle reads
`scrollHeight` and releases to `none`. Measured after the fix in the same harness: scroll area
**6160px**, body painted 5495px of its 5665px content — the last line sits inside the scrollable sheet.

## 45. A height-capped flex sheet squeezes the fields instead of scrolling

**Symptom.** The rebuild sheet looked right in the screenshot that had no height cap, and wrong in the
app: text inputs were 18px tall with the placeholder touching the border, the select was 2px taller than
the inputs beside it, and the body showed no scrollbar because nothing overflowed — the fields had
shrunk to fit instead. The footer stayed visible, which made it look intentional.

**Measured cause.** `.wv-rbsheet` is a flex column with `max-height: 86vh`. Flex items default to
`flex-shrink: 1`, so when the content was taller than the cap the browser shrank *every* child, including
the 46px inputs (measured 18px computed height), instead of letting the scroll box take the overflow.
`box-sizing` compounded it: without an explicit border-box the sheet's 86vh excluded its 1px border and
16px bottom padding, so a 86vh cap measured 706px at an 800px viewport.

**Rule.** In a height-capped flex column, only the scroll container may shrink: the body gets
`flex: 1 1 auto; min-height: 0`, and every other child gets `flex: 0 0 auto`. Set `box-sizing: border-box`
on the capped element so the cap is the box the user sees. Two fields meant to look alike get one
explicit height — `<input>` and `<select>` differ by 2px at the same padding (44 vs 46, measured) — and
the select keeps its horizontal padding or its text runs under the native arrow (seen at 348px).

**Check.** `tests/vault/vault-client-contracts.test.js` pins the three rules (`flex: 1 1 auto` on the body,
`flex: 0 0 auto` on its children, a single `height` on the fields); the harness measurement is in the
commit that introduced it. Measured after the fix at a 540px and a 348px sheet: fields 46/46/46, insets
21/21/21/21, button labels off-centre by 0.00px, toggles 2 columns then 1, no horizontal overflow, and a
430px cap scrolls 616px of body with the footer still inside the sheet.
## 46. A closed card's public bio was rendered as its definition

**Symptom.** A character whose definition JanitorAI hides opened with an empty Info tab — just the
lock note and the tags — while its public bio appeared under **Prompt Blocks → Description**, as
though the site had not hidden anything. The card's own text sat in the one place that is supposed
to hold a card *body*.

**Measured cause.** `renderDetail` gated the whole bio block on the card being open
(`closed ? '' : (bioText ? …)`), and the Description drawer fell back to the bio when
`d.description` was empty. A closed card's payload has every body field null — only the public bio
survives (`creator_notes`) — so the drawer fallback caught it and the Info tab showed nothing. The
"Description" label made it worse: the bio was labelled as the definition the site was hiding.

**Rule.** The Info tab renders the creator notes, always, whatever the source — Glaze's
`_InfoTab` does exactly that (`character_detail_screen.dart:1494-1524`) and labels them
DESCRIPTION. The Description drawer renders the card's **own body** and nothing else; no fallback
to notes, ever. On a closed card `description` is empty, so the drawer has no Description row at
all and the pane says `No prompt blocks to preview` instead of inventing content. The gutter is
part of the rule: the closed note had `margin: 14px 0 6px`, so its rounded panel ran edge to edge
(measured left 44) while every other block sat at 60 — it now shares the 16px inset.

**Check.** `detail-view.js` holds the two helpers, so they are unit-testable without SillyTavern
(`index.js` cannot be imported outside the page): five tests in `tests/vault/vault-client-contracts.test.js`
pin that a closed card's bio lands on Info, that the drawer is empty without a body, that plain-text
bios stay escaped, and that the renderer goes through those helpers rather than an inline copy.
Measured in the shipped stylesheet: note, first tag chip, section label text and bio box all start at
the same 16px inset (608px wide inside a 640px window), no horizontal overflow.

## 47. A flex column sheet squashes its content instead of scrolling it, and `display: flex` beats `[hidden]`

**Symptom.** The capture sheet at 360x640 showed all eight lorebook rows and the whole build
group squeezed into 552 px: no scrollbar, `body.scrollHeight === body.clientHeight` (449 = 449),
every row 42 px tall instead of 54, and the extracted-content `<pre>` clipped to its own
scroller that a 1 518 px document had 242 px for. Separately, hiding a stage with the `hidden`
attribute left it on screen, because `.wv-cempty { display: flex }` is an author rule and the
UA `[hidden] { display: none }` is not.

**Cause.** `.wv-cbody` is a flex column inside a max-height-capped flex column. Flex items
shrink by default, so the children gave up height to fit the cap instead of overflowing the
scroller. `overflow-y: auto` only helps when the content actually overflows.

**Rule.** A scrolling flex column sets `flex: 1 1 auto; min-height: 0` on itself and
`flex: none` on its children. Any element that is hidden by the `hidden` attribute and also
has an author `display` rule needs an explicit `[hidden] { display: none !important }`
scope.

**Check.** `tests/vault/import-flow.test.js` "capture sheet styles" pins both rules
(`.wv-cbody > * { flex: none }` via the body rule + the `[hidden]` scope), and the measured
numbers are in the harness run: 360x640 sheet 340x552 with `bodyScroll` 940 > `bodyClient`
450 after the fix, 0 px horizontal overflow at both 360 and 728.

