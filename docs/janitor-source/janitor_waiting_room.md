# janitor_waiting_room.md
- **Path:** `C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/janitor_waiting_room.dart`
- **Lines:** 115 (read in full, 1–115)
- **Role:** Pure, WebView-free recogniser and value type for JanitorAI's Cloudflare **Waiting Room** page — it turns a response body/HTML string into a `JanitorWaitingRoom` (refresh interval + the site's own wait estimate) or `null`, plus the `JanitorQueueException` thrown when the queue never admits.

## Purpose

While Cloudflare's Waiting Room is active, JanitorAI answers **every** request — API calls included — with the same HTML page, under a plain HTTP `200`. Treating that body as JSON is silent corruption, so this file supplies the one predicate everyone else uses to tell "the queue" from "the app": `parseJanitorWaitingRoom(text)`.

The library doc states the shape of that page verbatim: "`Please wait — janitor`, `You're in line`, an `Estimated wait: …` line and a `refresh` meta tag", and "The page reloads itself every `refresh` seconds, and one of those reloads is what eventually lets the visitor through. From HTTP alone it looks like a perfectly normal `200`, so callers have to recognise it before treating the body as JSON."

Design note carried in the code: the markers are "the page's own unique sentences rather than a bare `"you're in line"`, so a character card that happens to talk about queues is not mistaken for one."

## Behaviour walkthrough

- **`class JanitorWaitingRoom`** — immutable value type:
  - `final Duration refreshInterval` (default `const Duration(seconds: 20)`) — "How long the page asks to wait before refreshing itself. The reload is what advances the queue, so callers that drive the page use this as their polling interval."
  - `final String? estimatedWait` — "The page's own estimate, e.g. `4 minutes`. Null when it carries none."
  - `const` constructor with named optional params.
  - `operator ==` compares `refreshInterval` **and** `estimatedWait`; `hashCode = Object.hash(refreshInterval, estimatedWait)`. Value equality is load-bearing: `JanitorWebViewProxy._setWaitingRoom` and `announce()` both no-op when the new reading `==` the previous one, which is how a static page avoids re-notifying the UI each poll.
  - `toString()` → `'JanitorWaitingRoom(refresh: ${refreshInterval.inSeconds}s, wait: ${estimatedWait ?? 'unknown'})'`.
- **`class JanitorQueueException implements Exception`** — carries `final JanitorWaitingRoom? lastReading` (last reading before giving up), const constructor with a single optional positional argument. Doc: "Unlike a `JanitorRefusedException` this is transient and says nothing about the character."
- **`parseJanitorWaitingRoom(String text)`** — the recogniser:
  1. `if (text.isEmpty) return null;`
  2. `lower = text.toLowerCase()`; `title` extracted with `RegExp(r'<title[^>]*>([^<]*)</title>', caseSensitive: false)` → group 1 lowercased, defaulting to `''`.
  3. `queued` is true when **any** of four marker groups matches:
     - `lower.contains('janitor is managing traffic')`;
     - `lower.contains('traffic is high right now') && lower.contains('letting people in slowly')`;
     - `title.contains('please wait') && title.contains('janitor')`;
     - `lower.contains('this page refreshes every') && lower.contains('in line')`.
     (Note this is a plain substring test over the whole document, unlike the in-page probe which concatenates title+description+body — see the proxy dossier.)
  4. Not queued → `null`.
  5. `wait = _cleanWait(_estimatedWait.firstMatch(text)?.group(1))`.
  6. `refresh = int.tryParse(...)` over `_refreshMeta` first, else `_refreshMetaReversed`, group 1; unparseable → `null`.
  7. Returns `JanitorWaitingRoom(refreshInterval: Duration(seconds: (refresh != null && refresh > 0) ? refresh : 20), estimatedWait: wait)`.
- **`_cleanWait(String? value)`** — `null` in → `null` out; strips tags with `RegExp(r'<[^>]+>')` → `' '`, collapses whitespace with `RegExp(r'\s+')` → `' '`, trims; empty result → `null`. This matters because the estimate is captured as `[^<\n\r]+`, which can still drag in entities/markup, e.g. `"4&nbsp;minutes"` (the regex itself stops at `<`, so the strip is defence for e.g. `</span>`-free text).

Module-private regexes (top-level `final`, compiled once):
- `_estimatedWait = RegExp(r'Estimated wait:\s*([^<\n\r]+)', caseSensitive: false)`
- `_refreshMeta = RegExp(r'''<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\s*(\d+)''', caseSensitive: false)`
- `_refreshMetaReversed = RegExp(r'''<meta[^>]*content\s*=\s*["']?\s*(\d+)[^>]*http-equiv\s*=\s*["']?refresh''', caseSensitive: false)`

The two meta regexes exist because attribute order is not guaranteed; both tolerate quoted/unquoted attribute values and arbitrary whitespace around `=`, and both require `http-equiv="refresh"` / `content="<digits>` in that order per pattern.

## Data shapes

- Input: any `String` — an HTTP response body (from in-page `fetch`), or page HTML.
- Output: `JanitorWaitingRoom?`. `refreshInterval` seconds come from the `refresh` meta `content` attribute (first integer); `estimatedWait` is the raw trailing text after `Estimated wait:`.
- `JanitorQueueException.lastReading` is `JanitorWaitingRoom?` so the exception can report the site's own estimate.

## Network / WebView contract

None here — no HTTP, no WebView, no injected JS. This is a pure string analyser, deliberately testable without a WebView (the parallel `janitor_session.dart` states that intent for its own helpers; this file follows the same pattern).

Its consumers define the contract:
- `JanitorWebViewProxy._isWaitingRoomBody(r) => r.status == 200 && parseJanitorWaitingRoom(r.body) != null` — status **must** be 200, i.e. the queue is only recognised on a success response.
- `JanitorWebViewProxy._fetchLocked` throws `JanitorQueueException(parseJanitorWaitingRoom(result.body))` when the second fetch still returns the room.
- The UI consumes `JanitorWebViewProxy.instance.waitingRoom` (`ValueListenable<JanitorWaitingRoom?>`) in `catalog_grid.dart` (`_JanitorQueueBanner(room: room)`) and `catalog_detail_launcher.dart`.

## Selectors, regexes and string literals

- Queue marker phrases, matched case-insensitively as substrings: `'janitor is managing traffic'`, `'traffic is high right now'`, `'letting people in slowly'`, `'please wait'`, `'janitor'` (title), `'this page refreshes every'`, `'in line'`.
- Title selector: `<title[^>]*>([^<]*)</title>`.
- Estimate: `Estimated wait:\s*([^<\n\r]+)`.
- Refresh: the two `<meta … http-equiv="refresh" … content="N">` orders shown above.
- Defaults / magic numbers: `20` (default `refreshInterval`, used in both the constructor default and the `refresh > 0 ? refresh : 20` clamp).
- Exception text, verbatim:
  - `'JanitorAI is still queueing requests.'` (no reading, or reading with no estimate)
  - `'JanitorAI is still queueing requests (estimated wait: ${lastReading!.estimatedWait}).'`
- `toString()` template: `'JanitorWaitingRoom(refresh: ${refreshInterval.inSeconds}s, wait: ${estimatedWait ?? 'unknown'})'`.

## State machine, retries, timings

No state machine or retries here — the *policy* lives in `JanitorWebViewProxy._waitForAdmissionLocked`, which this file feeds. Timings contributed by this file:

- `refreshInterval` default = **20 s**, floor = `refresh > 0` (a `content="0"` is treated as 20, never as "no wait").
- The proxy's settle window is `room.refreshInterval + 6 s` polled at 1 s; the whole queue wait is capped at 20 minutes.
- The in-page probe (`_waitingRoomProbeJs` in the proxy) computes the same `parseInt(refreshEl.content, 10)` with `parsed > 0 ? parsed : 20`, so HTTP-side and page-side defaults agree.

## Errors and user-visible messages

- `JanitorQueueException.toString()` (two variants above) is the developer-facing message; the UI replaces it with the translation key `catalog_error_janitor_queue` = `"JanitorAI is still in its admission queue and did not let Glaze in. Try again in a few minutes."` (from `catalog_error_labels.dart`). During the wait the UI shows a banner from `JanitorWaitingRoom` and, on Android, the foreground notification text `notification_queue` = `"Waiting in the JanitorAI queue..."`.
- No exceptions are thrown by the parser; malformed input simply returns `null` (i.e. "not the queue"), which silently degrades to treating the body as the real response.

## Persistence

_none_ — nothing is stored, cached or memoised. Every call re-parses.

## Porting notes for our SillyTavern port

- **Copy this file's logic almost verbatim into JS.** It is ~40 lines of regex plus one predicate and it is the cheapest insurance against the worst failure mode in the whole pipeline: a `200` whose body is HTML being fed to `JSON.parse`. Reproduce: the four marker groups (and keep the *conjunctive* ones conjunctive — requiring both `traffic is high right now` and `letting people in slowly` is what keeps a character card about queues from matching), the `refresh > 0 ? refresh : 20` clamp, and the tag-strip/collapse in `_cleanWait`.
- **Check `status === 200` at the call site**, as the proxy does; do not run the parser on 4xx/5xx bodies.
- **Preserve the default 20 s and the `+6 s` settle window** if you replicate the polling driver; otherwise keep `refreshInterval` as a hint for a banner ("you're in line — about 4 minutes").
- **What is Dart-only scaffolding:** the class/`==`/`hashCode`/`toString` and the `implements Exception` type. In JS the equivalent is a plain object plus a module-level `parseWaitingRoom(text)`; value equality matters only if you de-dupe banner updates — compare `refresh|wait` strings instead.
- **Fragile:** the matchers depend on Cloudflare's current waiting-room copy and on JanitorAI's `<title>`. Cloudflare rotates this wording per product template, so a `queue` miss is silent (body treated as JSON). Recommend a secondary guard in the port: if the expected JSON shape is absent *and* the body starts with `<`, treat it as "unrecognised HTML" rather than parsing.
- Note the deliberate asymmetry with the in-page probe: the probe also reads `meta[name="description"]` into the haystack and matches `Estimated wait:` against `body.innerText` only; this parser matches the whole document. A body that only carries the phrase in a meta description would be recognised in-page but not here (inferred, not observed).

## Open questions

- Whether the waiting-room page ever returns a non-200 status (e.g. 503 with the same HTML) is not determined from this file; the proxy's `_isWaitingRoomBody` demands 200, and `_isCfBlocked` separately treats 503 as a CF block. A captured response would settle which branch actually fires.
- The precise `<meta>` markup Cloudflare emits (attribute order/quoting) is inferred from the two regex variants; the real page was not available. `docs/` or a saved response fixture in `test/` would settle it.
- Whether the estimate string is later re-shaped for display (e.g. `"4 minutes"` vs `"about 4 minutes"`) is UNKNOWN — not determined from this file; `_JanitorQueueBanner` in `catalog_grid.dart` would settle it.
