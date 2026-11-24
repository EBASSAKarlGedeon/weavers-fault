# janitor_webview_proxy.md
- **Path:** `C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/janitor_webview_proxy.dart`
- **Lines:** 2374 (read in full: 1–300, 301–600, 601–900, 901–1200, 1201–1500, 1501–1800, 1801–2100, 2101–2374)
- **Role:** A persistent offscreen Chromium session that runs all janitorai.com API calls in-page (keeping Cloudflare's TLS-bound `cf_clearance` valid) and drives the `/generateAlpha` capture that recovers a hidden card, its closed lorebook and greetings from a throwaway chat.

## Purpose

`JanitorWebViewProxy.instance` does two jobs.

**Transport.** `fetch(url, method, body)` runs HTTP *inside* the page. Header comment: "Cloudflare binds `cf_clearance` to the TLS/JA3 fingerprint of the client that solved the Turnstile challenge. A cookie obtained in a WebView cannot be replayed by Dio … so CF answers 403 even with the exact same cookie + User-Agent."

**Capture.** `captureGenerateAlpha(...)` drives the real chat UI with a synthetic send so the server assembles `POST /generateAlpha`; the *response body* — `{messages:[…]}` whose system message holds the hidden card and the triggered (closed) lorebook entries — is scraped from page memory. Port of the SillyTavern `janitor-lorebook` plugin's Playwright `runFromUrl`/`_autoTrigger` and `capture.cjs` `_send`. All account-mutating state (proxy preset, `source`, `generation_settings`, profile name, `{{user}}` persona, chat) is snapshotted, forced and restored in `finally`.

## Behaviour walkthrough

**Lifecycle.** `setActive(bool)` from the catalog UI; `_beginHold`/`_endHold` maintain `_pending` and arm/cancel `_shutdownTimer`. `_scheduleIdleShutdown()` bails when `_active || _pending > 0` or nothing is running, else `Timer(_idleShutdownGrace, …)` → `dispose()`; grace is `Duration(seconds: 45)` (3 s caused a native teardown hitch mid-chat-load). `_enqueue<T>(task)` chains onto `_gate`, so navigations, solves and captures are strictly serialized — two overlapping captures "would restore each other's snapshots". `_ensureStarted` merely awaits `_waitForAdmission()` when the controller is live.

**Start.** `_start()` builds a `HeadlessInAppWebView` at `_origin` with `javaScriptEnabled: true, domStorageEnabled: true, cacheEnabled: true, thirdPartyCookiesEnabled: true, isInspectable: false, useHybridComposition: true, userAgent: janitorWebViewUserAgent`, plus `webViewEnvironment: defaultTargetPlatform == TargetPlatform.windows ? chatWebViewEnvironment : null`. `onWebViewCreated` reads `navigator.userAgent` by JS → `CfChallengeService.instance.setWebViewUA(ua)`; `onLoadStop` completes `_loadStop`. Then `run()`, `_awaitLoad`, `_waitForClearance`, `_waitForAdmission`, `_refreshSession()` once. `_awaitLoad({20 s})` awaits `_loadStop`, reset before *every* navigation because "`callAsyncJavaScript` hangs forever if invoked while the page is still `about:blank`". `dispose()` nulls controller/start/loadStop, clears the notifier, `PerfDebug.slowAwait('catalog webview teardown', …)`.

**`_fetchLocked` ladder.** `_ensureStarted()` → `_rawFetch`; then: waiting-room body (`status == 200 && parseJanitorWaitingRoom(body) != null`) → `_recoverFromQueue()` + retry, still room → `throw JanitorQueueException(...)`; `_isCfBlocked` → `_reload()` + retry; still → `_escalateToVisible()` + `_reload()` + retry; still → `throw JanitorCfException(status)`; `status < 0` → `'WebView fetch failed'`; `401` → `_refreshSession(force: true)` + retry; still `401` and `janitorReadIsPublic(url, method: method)` → retry `anonymous: true`; still `401` → `JanitorAuthException`; `>= 400` → `'HTTP ${status}'`.

**`_rawFetch`.** One JS body inlining `_findTokenJs`:
```
const headers = { "Accept": "application/json, text/plain, */*" };
if (token) headers["authorization"] = "Bearer " + token;
const opts = { method: <jsonEncode>, headers: headers, credentials: "include" };
/* when body != null */ headers["Content-Type"] = "application/json"; opts.body = <jsonEncode>;
const r = await fetch(<jsonEncode(url)>, opts);
return { status: r.status, body: respBody, auth: token ? 1 : 0 };
```
Arguments are inlined rather than passed via `arguments`, "which has been flaky on Android in this plugin version". `.timeout(25 s)`; timeout/JS error → `(status: -1, body: '')`.

**CF/queue recovery.** `_isCfBlocked`: `403`, `503`, or `200` whose body contains `'Access Restricted'`. `_escalateToVisible`: `CfChallengeService.instance.invalidate()` then `await …solve()` — `isPending` makes `CatalogGrid` mount `_CfChallengeWebView`, which lands `cf_clearance` in the shared jar. `_waitForClearance({12 s})` polls `CookieManager.instance().getCookies(url: _origin)` every `400 ms` for a non-empty `cf_clearance`. `_recoverFromQueue` remembers `.path.contains('/chats/')`, reloads when the document is the app but the body was the room ("only waiting would never advance the queue"), waits for admission, then re-waits for the composer on a chat. `_reloadCurrentPage` uses `controller.reload()` so "a chat URL that landed on the waiting room must keep pointing at that chat".

**Admission queue.** `waitingRoom` is a public `ValueNotifier<JanitorWaitingRoom?>`, de-duped by value equality. `_waitForAdmission` holds across `_waitForAdmissionLocked`, which loops until `now + _waitLimit` (**20 min**): probe; `!ready` → if unreadable `> 30 s` do `_reloadCurrentPage()`, else sleep `1 s`; `room == null` → admitted; else set notifier, `announce(room)` → `onPhase('waiting in queue' + ' (${estimatedWait})')`, `ensureNotificationHold()`; inner poll every `1 s` for `room.refreshInterval + 6 s` (a changed room announces and breaks); `!moved` → `_reloadCurrentPage()` to advance the queue itself; deadline → `throw JanitorQueueException(lastRoom)`. The hold is `GenerationNotificationService.instance.acquireWorkHold(title: 'Glaze', text: 'notification_queue'.tr())` so Android cannot freeze the process and stop the page's own refresh timer; a refusal is non-fatal. `_probeWaitingRoom` evaluates `_waitingRoomProbeJs` → `{ready, queue, refresh, wait}`.

**Capture.** Phases (logged `'capture phase: $p'`, forwarded to `onPhase`): `'starting'` → `isLoggedIn()` else `'Not logged into JanitorAI — log in first (Menu → JanitorAI).'` → `_refreshSession()` → `'configuring proxy'` → `_enterExtractionMode()`.

1. `'checking profile'` → `_seedProfileName()`; `'preparing persona'` → `_ensureUserMacroPersona()`; `bakedUserName = seeded.sentinel ?? (personaId == null ? await _activePersonaName() : null)`.
2. `removeAllUserScripts()` + `addUserScript(UserScript(source: _captureUserScript, injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START))`.
3. `_inFreshChat`: `POST https://janitorai.com/hampter/chats` with `{"character_id": characterId, "persona_id": ?personaId}` (Dart null-aware element — the key is *omitted* when null); missing `id` → `'Could not create chat (no id in response).'`; `loadUrl('https://janitorai.com/chats/$chatId')` → `_awaitLoad` → `_waitForClearance` → `_waitForAdmission`; then a deliberate `phase('reloading for preset')` + `controller.reload()` + the same three waits, because "JanitorAI caches the selected proxy preset in its client store"; `'waiting for chat UI'` → `_waitForComposer(60 s)`, failure logs `'composer never appeared — sending anyway'`; `finally` `'deleting chat'` → `_deleteChat`. Body: `greetings = _fetchChatGreetings(chatId)`; `dot = _captureOneSend('.', 60 s)`; a `dot.refusal` aborts; `card = extractCard(dot.payload!)`; trigger = join of `[card?, triggerText.trim()?, greetings.join('\n\n---\n\n')?]` with `'\n\n'`, else `'.'`; `_resetCapture()`; `full = _captureOneSend(trigger, 120 s)`.
4. `result = full.payload ?? dot.payload`; null → refusal else `'Timed out waiting for a generateAlpha capture.'`; then `_splitPasses(...)`; `'captured'` → `JanitorCaptureResult(payload: result, probePayload: full.payload != null ? dot.payload : null, extraPasses, greetings, bakedUserName)`.

Outer `finally`, dependency order, each best-effort: `_deletePersona` → `_restoreProfileName` → `'restoring settings'` + `_restoreProfile`.

**`_captureOneSend`.** `callAsyncJavaScript(functionBody: 'return await window.__glazeSend(${jsonEncode(text)});')`; decode `res.error` → `'The send script failed: …'`, `value['ok'] != true` → `'Could not reach the chat composer (${value['reason'] ?? 'unknown'}).'`, `value['cleared'] == false` → `'The message would not send — it stayed in the composer (${value['diag'] ?? 'no detail'}).'`. Then poll every **700 ms**: `'window.__glazeAlpha ? JSON.stringify(window.__glazeAlpha) : null'`; each poll also checks `_refusalIn(await _readAlphaLog())` and returns early on a refusal. Timeout → `_describeAlphaTimeout()`, prefixed by any send-side problem ("a swallowed send explains the silence").

**Extraction mode.** `GET /hampter/api-settings` → snapshot `selected_proxy_config_id`, `source`, `generation_settings`, `hadOwnPresets`; `POST /proxy-configs` dummy; **re-read** and match `client_id` for the server `id` (else `'dummy proxy preset not found after create'`); `PATCH` `{'selected_proxy_config_id': id}` (must-have), then two independently wrapped best-effort patches `{'source': 'proxy'}` and `{'generation_settings': {...originalGen, 'context_length': 0}}` ("isolated so a rejection can't undo the selection"). Failure deletes the dummy and returns `null`. `_restoreProfile`: selection restored only when `hadOwnPresets` else `null`; `source = 'janitor'` (JLLM) when the account had no presets; `generation_settings` = original when it had a numeric `context_length`, else original + `context_length: _defaultContextLength` (**4096**) — the alternative leaves every real chat at zero context. Then `DELETE /proxy-configs/{id}`.

**Persona/profile/greetings.** `_ensureUserMacroPersona`: `GET /hampter/personas` (bare List, `{personas: []}` or `{data: []}`), reuse one named `'{{user}}'`, else `POST {'appearance': '', 'avatar': '', 'groupId': null, 'name': '{{user}}', 'pronouns': null}` ("mirrors the JanitorAI web client's POST exactly") reading `id`/`data.id`; total failure → `null`. `_seedProfileName`: if `name.trim()` empty, `PATCH {'name': <sentinel>, 'profile': priorAppearance}` with a 24-char uppercase sentinel, because the "set up your profile" modal eats the first message. `_fetchChatGreetings`: `GET /hampter/chats/{id}`, `character` at top level or under `data.character`, `first_message` then each `first_messages` (String or Map with `first_message`/`message`), skipping empties, strings with no `[\p{L}\p{N}]` ("pads the array with nulls and invisible-character placeholders"), and duplicates.

**Split passes.** Logs `'lore ${n}t of $janitorLoreTokenCap'` (+`' (estimated)'`). No split when unsaturated, or when the `.` probe alone is saturated (`'the "." probe alone fills the lorebook cap — not splitting'` = always-on entry). `Queue.of(splitTrigger(trigger))`, `< 2` → none. While queue non-empty and `pass < _maxSplitPasses` (**16**): label `'pass ${pass + 1}/${pass + 1 + queue.length}'`, fresh chat + `_resetCapture()` + `_captureOneSend(piece, 120 s)`; null payload logs `'$label captured nothing: …'` and continues; saturated piece is re-split (`'… cannot be split further'` when not); leftover → `'split pass limit reached — N pieces never sent'`. Fresh chat per piece because "re-sending in the same chat would keep the earlier message in the scan window and hit the same cap".

**Session.** `_findTokenJs` defines `__glazeFindToken()`: group cookies by `/^(sb-.*-auth-token)(?:\.(\d+))?$/`, sort numeric indices, concatenate, `extract`: `decodeURIComponent` → strip `base64-` → return if it starts `eyJ` with 3 dot-parts; else for `[b64decode(raw), raw]` try `/"access_token":"(eyJ[^"]+)"/` then `JSON.parse` reading `access_token|accessToken|token|currentSession.access_token|o[0]`; finally sweep all `localStorage`. `b64decode` tries `atob` then base64url (`-`→`+`, `_`→`/`). `isLoggedIn()` (`10 s`) and `_readAccessToken()` (`10 s`) call it. `_refreshSession({force})`: valid token → true; else `_reload()` and poll `400 ms` for `8 s`, else `'session still stale after reload — the refresh token is gone too'` (Supabase's JWT is only traded by the page's own client on load). `logout()` clears `localStorage`/`sessionStorage`, `deleteAllCookies()`, `_reload()`. `flushCookies()` sets then deletes cookie `gz_flush` at `https://glaze-cookie-flush.invalid/` because "every cookie write it performs flushes the whole store" (the only way to persist Android's in-memory jar). `hasSessionToken(controller)` (`8 s`) and `fetchUserName(controller)` (`10 s`) are static: the visible login sheet shares the jar.

## Data shapes

- `JanitorCaptureResult{payload, probePayload?, extraPasses, greetings, bakedUserName?}` — `payload` is the raw `generateAlpha` JSON `{messages:[{role, content}, …]}`; `probePayload` is the `.` send's capture, the diff baseline; `extraPasses` are split-pass payloads.
- `_SendResult = ({Map<String,dynamic>? payload, String? problem, JanitorRefusedException? refusal})`.
- `JanitorRefusedException{status, message}`; `const .proxyForbidden()` = `(403, 'Proxies are forbidden for this character')`; `isProxyForbidden => message.toLowerCase().contains('prox')`; `isTransient => status == 408 || 429 || 502 || 503 || 504`.
- `JanitorCfException(int status)`, `JanitorAuthException()`, `JanitorQueueException(JanitorWaitingRoom?)`.
- `_refusals: Map<String, JanitorRefusedException>` by character id; `_refusalError` turns 401 into `JanitorAuthException` and never caches transient statuses ("a queue or rate-limit answer says nothing about the card itself").
- Dummy preset: `{'api_key': 'sk-<48 lowercase alnum>', 'api_url': 'http://127.0.0.1:<8001..65000>/v1/chat/completions', 'model': 'gpt-4o', 'name': '<12 lowercase alnum>', 'prompt_id': null, 'client_id': '<uuid v4>'}` — fresh `client_id` per run because "JanitorAI permanently burns each client_id" (`409 API_SETTINGS_PROXY_CONFIG_CONFLICT`), other fields randomised so the preset is not fingerprintable.
- Alpha log entry: `{t: <ms>, via: 'fetch'|'xhr', status, matched: bool, body: <≤300 chars when unmatched>}`.

## Network / WebView contract

| Method | URL | Body |
|---|---|---|
| GET | `https://janitorai.com/hampter/api-settings` | — |
| POST | `https://janitorai.com/hampter/api-settings/proxy-configs` | dummy preset |
| PATCH | `https://janitorai.com/hampter/api-settings` | `selected_proxy_config_id` / `source` / `generation_settings` |
| DELETE | `https://janitorai.com/hampter/api-settings/proxy-configs/{id}` | — |
| POST | `https://janitorai.com/hampter/chats` | `{character_id, persona_id?}` → `{id}` |
| GET | `https://janitorai.com/hampter/chats/{id}` | — (`character.first_message`, `first_messages`) |
| DELETE | `https://janitorai.com/hampter/chats/{id}` | — |
| GET/POST | `https://janitorai.com/hampter/personas` | `{appearance, avatar, groupId, name, pronouns}` |
| DELETE | `https://janitorai.com/hampter/personas/{id}` | — |
| GET/PATCH | `https://janitorai.com/hampter/profiles/mine` | `{name, profile}`; reads `user_name` |
| GET (page) | `https://janitorai.com/chats/{chatId}` | — composer host |

Every fetch: `credentials: "include"`, `Accept: application/json, text/plain, */*`, `authorization: Bearer <supabase token>` unless anonymous, `Content-Type: application/json` with a body. The generator endpoint (`…/generateAlpha`, matched by substring `'/generateAlpha'`) is called by the site's own client, never by this file.

Three injected payloads: `_findTokenJs`; `_waitingRoomProbeJs` (reads `document.title`, `body.innerText||textContent`, `meta[name="description"]`, `/Estimated wait:\s*([^\n\r]+)/i`, `meta[http-equiv="refresh"]` with `parseInt(…,10)` default `20`, returns `{ready, queue, refresh, wait}`); `_captureUserScript`, guarded by `window.__glazeHooked`, installed `AT_DOCUMENT_START` so it hooks the network "before page scripts capture their own `fetch` reference".

## Selectors, regexes and string literals

- Composer candidates: `['textarea[placeholder]', 'form textarea', 'textarea', 'div[contenteditable="true"]']`; `findInput` walks each NodeList **backwards**, requiring `el.offsetParent !== null`.
- Send: `'button[aria-label*="send" i], ' + 'button[class*="sendButton" i], ' + 'button[type="submit"]'`; fallback = last live `button` in `input.closest('form') || input.parentElement`. `isSendBtn` rejects labels containing `'stop'`/`'cancel'` — "aria-label stays English across UI locales (confirmed on a Polish client)".
- Stop: `'button[aria-label*="stop" i], button[aria-label*="cancel" i]'`. Overlay: `'[class*="modalOverlay" i], [class*="ModalOverlay"]'`; close: `'[class*="modal" i] button[aria-label*="close" i], ' + '[role="dialog"] button[aria-label*="close" i]'`.
- Composer tag: `data-glaze-composer` = `'1'`.
- Token regexes: `/^(sb-.*-auth-token)(?:\.(\d+))?$/`, `/"access_token":"(eyJ[^"]+)"/`; prefixes `base64-`, `eyJ`.
- Queue phrases: `'janitor is managing traffic'`; `'traffic is high right now'` + `'letting people in slowly'`; `'please wait'` + `'janitor'`; `'this page refreshes every'` + `'in line'`.
- Keyboard synthesis: Enter (`key`, `code` = `'Enter'`), Escape, with `Object.defineProperty(ev, 'keyCode', {get: () => 13|27})` and `'which'`, because "the `KeyboardEvent` constructor ignores keyCode/which (they stay 0)".
- React value set: `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype /* or HTMLInputElement */, 'value').set` then `new Event('input', {bubbles: true})`; contenteditable path `focus()` → `textContent = val` → `new InputEvent('input', {bubbles: true})`. "A plain `el.value = …` leaves React's state empty and the send no-ops."
- Dart literals: `'https://janitorai.com'`, `'https://janitorai.com/chats/$chatId'`, `'https://glaze-cookie-flush.invalid/'`, `'gz_flush'`, `'cf_clearance'`, `'Access Restricted'`, `'{{user}}'`, `'gpt-4o'`, `'janitor'`, `'proxy'`, `'context_length'`, `'selected_proxy_config_id'`, `'client_id'`, `'prompt_id'`, `'sk-'`, `'\n\n'`, `'\n\n---\n\n'`, `'.'`.

## State machine, retries, timings

| Site | Value |
|---|---|
| `_waitLimit` | `Duration(minutes: 20)` |
| `_idleShutdownGrace` | `Duration(seconds: 45)` |
| `_maxSplitPasses` | `16` |
| `_defaultContextLength` | `4096` |
| `_awaitLoad` | `20 s` |
| `_waitForClearance` | `12 s`, poll `400 ms` |
| `_waitForComposer` | `60 s`, poll `400 ms` |
| `_rawFetch` | `.timeout(25 s)` |
| `isLoggedIn`/`_readAccessToken`/`fetchUserName` | `10 s`; `hasSessionToken` `8 s` |
| `_refreshSession` | `8 s`, poll `400 ms` |
| `_captureOneSend` | poll `700 ms`; budget `60 s` (dot) / `120 s` (trigger, each piece) |
| queue unreadable → reload | `> 30 s`; poll `1 s` |
| queue settle window | `refreshInterval + 6 s`, poll `1 s` |
| JS `dismissModals` | `4000 ms` (`2000` retry), sleep `300 ms` |
| JS stop-abort | `15000 ms`, sleep `300 ms` |
| JS send-button poll | `30000 ms`, sleep `200 ms` |
| JS `waitComposerCleared` | `3000 ms`, sleep `400 ms`, twice max |
| JS alpha log | max `12` entries; unmatched body `300` chars |

Per request: up to 4 `_rawFetch` attempts (initial, post-queue, post-soft-reload, post-escalation), then one 401 refresh retry, then one anonymous retry. Send ladder: `click` → (`dismissModals(2000)` + synthetic Enter) → `how += '+enter'`; `sent` is `'click'` or `'enter'`. Split: up to 16 extra chats.

## Errors and user-visible messages

Thrown: `'Not logged into JanitorAI — log in first (Menu → JanitorAI).'`, `'WebView not available.'`, `'Could not create chat (no id in response).'`, `'Timed out waiting for a generateAlpha capture.'`, `'WebView fetch failed'`, `'HTTP ${status}'`, `'dummy proxy preset not found after create'`, `'Janitor.AI session expired (401)'`, `'generateAlpha failed ($status)'`, `'JanitorCfException(status=$status)'`, the `.proxyForbidden` wording, `JanitorQueueException`.

Send/timeout prose: `'The send script failed: …'`, `'Could not reach the chat composer (…).'`, `'The message would not send — it stayed in the composer (…).'`, `'No /generateAlpha request left the page — the message was sent but JanitorAI never asked the server to assemble a prompt (generation refused, or the chat is still busy).'`, `'JanitorAI answered /generateAlpha with '` + newest two entries joined by `" | "` (`'$status returned a prompt that arrived too late'` / `'$status: <body|empty body>'`).

Parity-critical logs: `'capture phase: $p'`, `'composer never appeared — sending anyway'`, `'onLoadStop timeout — proceeding anyway'`, `'CF block persists — escalating to visible challenge'`, `'401 — refreshing the session and retrying once'`, `'401 persists — retrying the read without the account token'`, `'extraction mode on (dummy proxy $id selected, context_length 0)'`.

UI mapping (`catalog_error_labels.dart`): `catalog_janitor_session_expired` = `"Log into your Janitor.AI account again to import this character. The stored session is no longer accepted, so the capture cannot run."`, `catalog_error_janitor_cloudflare`, `catalog_error_janitor_queue`, notification `notification_queue` = `"Waiting in the JanitorAI queue..."`.

## Persistence

Nothing is persisted by this class; its state *is* the Chromium profile — cookies on `https://janitorai.com` (`sb-<ref>-auth-token(.N)`, `cf_clearance`), `localStorage`/`sessionStorage`, plus the throwaway `gz_flush` cookie on `glaze-cookie-flush.invalid`. `CfChallengeService` persists the CF cookie/UA/expiry in `SharedPreferences`. `window.__glazeAlpha`/`__glazeAlphaLog` live only in the page and are reset per send (`window.__glazeAlpha = null; window.__glazeAlphaLog = [];`).

## Porting notes for our SillyTavern port

- **Drop the transport layer.** JA3 binding does not survive moving into a page on our own origin. Choose (a) header injection of a user-supplied `cf_clearance` + its exact UA, or (b) fetch from a same-origin context (content script / iframe on janitorai.com). `_rawFetch`, `_waitForClearance`, `_escalateToVisible`, `flushCookies`, `_awaitLoad` and the WebView settings are scaffolding.
- **Reproduce literally:** every `/hampter/*` path, method and body; fresh `client_id` per run; `source: 'proxy'`; `context_length: 0`; the restore rules including the `hadOwnPresets → source: 'janitor'` and `4096` fallbacks; the `{{user}}`-named persona (makes substitution a no-op) plus baked-name swap-back; the profile-name sentinel; greetings from the chat object; split passes with a fresh chat per piece and the 16-pass cap.
- **Reuse the injected JS nearly verbatim** — token finder, `__glazeHooked`/`__glazeAlpha`/`__glazeAlphaLog`/`__glazeSend`/`__glazeComposerReady`, and the send ladder (dismiss overlay → click stop until idle → native-setter type → click send → verify cleared → Escape + synthetic Enter with forced `keyCode`/`which`). The alpha log is what turns a bare timeout into "never fired / refused / not a prompt".
- **Fragile:** hashed class fragments (`_sendButton_…`, `_modalOverlay_…`), the English-`aria-label` assumption, `isTrusted: false` clicks, a fetch/XHR hook that cannot see service-worker or websocket traffic, and the "reload once for preset" client-cache hack.
- **Invariants:** one serialized gate for anything mutating account state; refusal cached per character while 401/408/429/502/503/504 never are.

## Open questions

- Whether `POST /hampter/chats` tolerates an *absent* `persona_id` versus explicit `null` (the code omits the key) — UNKNOWN — not determined from this file; a live request log would settle it.
- Whether `context_length: 0` is still honoured or silently clamped — UNKNOWN — not determined from this file; live captures or `janitor_field_diff.dart` would show truncation.
- Whether `POST /proxy-configs` returns the created object (the code defensively re-reads, implying maybe not) — UNKNOWN, not determined from this file.
