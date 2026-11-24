# janitor_account_provider.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/janitor_account_provider.dart
- **Lines:** 51 (read in full: 1-51)
- **Role:** Riverpod notifier holding the last-known JanitorAI display name in `shared_preferences`, so the UI can show "Logged in as …" without booting the headless WebView.

## Purpose

Persists one string across launches — the account's display name — and nothing else. Explicitly *not* an auth gate: "Only the display `userName` is kept — enough to show 'Logged in as …' in the menu without booting the headless WebView to re-check the session." The real session check is `JanitorWebViewProxy.isLoggedIn()` (a JWT probe inside the page) and, per-request, HTTP `401` handling.

This matters for a port: the extraction pipeline must never treat `JanitorAccount.isLoggedIn` as proof of a live session. It is a cached *hint* that can be stale in both directions — true while the token is dead, false while a valid session exists in another profile (inferred: nothing reconciles it except explicit login/logout paths).

## Behaviour walkthrough

`class JanitorAccount { final String? userName; const JanitorAccount({this.userName}); bool get isLoggedIn => userName != null && userName!.isNotEmpty; }`

`class JanitorAccountNotifier extends Notifier<JanitorAccount>` with `static const _userNameKey = 'gz_janitor_user_name';`

- `build()` — calls `_load()` **fire-and-forget** (`_load();` without `await`) and returns `const JanitorAccount()` (empty). So the first frame is always "logged out"; the name arrives asynchronously and the state flips only if a name is present. A notifier never assigning a value with no stored name means `state` stays the initial empty account (no extra emission).
- `_load()` — `SharedPreferences.getInstance()`, `getString(_userNameKey)`, and `if (name != null && name.isNotEmpty) state = JanitorAccount(userName: name);`. Empty string stored in prefs is therefore treated as absent (and left in prefs, not removed).
- `setUserName(String? name)` — persists then updates state, in this order: `name == null || name.isEmpty` ⇒ `await prefs.remove(_userNameKey); state = const JanitorAccount();`; else `await prefs.setString(_userNameKey, name); state = JanitorAccount(userName: name);`. Both branches `await` the write before publishing state, so a state write implies the value is durable (as durable as `shared_preferences` is).

Provider: `final janitorAccountProvider = NotifierProvider<JanitorAccountNotifier, JanitorAccount>(JanitorAccountNotifier.new);`

### Who writes it

- `widgets/janitor_login_sheet.dart`: after a login lands — it checks `JanitorWebViewProxy.hasSessionToken(controller)` on any non-`/login` `janitorai.com` URL, then `JanitorWebViewProxy.fetchUserName(controller)` and `setUserName(userName)` only when that returns non-null; also `setUserName(null)` on the logout path (two call sites, one at line 42 and one at 95).
- `widgets/janitor_session_expired_state.dart`: `setUserName(null)` on the "session expired" flow, and a guard `if (!ref.read(janitorAccountProvider).isLoggedIn)` (the same class is reused to decide whether to re-prompt).
- `widgets/catalog_detail_launcher.dart` (line 415) and `widgets/janitor_lorebook_capture_sheet.dart` (line 761): `setUserName(null)` on logout.

### Who reads it

`ref.read(janitorAccountProvider).isLoggedIn` at `widgets/catalog_detail_launcher.dart:210` (`_janitorLoggedIn`), `widgets/catalog_filter_sheet.dart:80` (whether to offer account-only filters), `widgets/janitor_login_sheet.dart:25` (skip the sheet when already "logged in"), `widgets/janitor_lorebook_capture_sheet.dart:284` and `:1468` (capture sheet gating); `ref.watch` at `widgets/catalog_onboarding_sheet.dart:251` and `widgets/third_party_providers_screen.dart:160` (menu/status display).

So the *pattern* is: the display name is a UI-level gate for "offer account features", while the actual capture refuses to start on a token it cannot see (`_captureLocked` throws `Exception('Not logged into JanitorAI — log in first (Menu → JanitorAI).')` when `!await isLoggedIn()`).

## Data shapes

`JanitorAccount { String? userName }`. Storage: a single `shared_preferences` string, key `gz_janitor_user_name`, value = JanitorAI's `user_name` field from `GET https://janitorai.com/hampter/profiles/mine` (read by `JanitorWebViewProxy.fetchUserName`, which returns `(j && typeof j.user_name === "string") ? j.user_name : null`).

## Network / WebView contract

No network of its own. The producer of `userName` is `JanitorWebViewProxy.fetchUserName(InAppWebViewController)` in `services/janitor_webview_proxy.dart`, which runs in-page:

- Injects `_findTokenJs`, calls `__glazeFindToken()`; returns `null` when no token.
- `fetch("https://janitorai.com/hampter/profiles/mine", { headers: { "Accept": "application/json, text/plain, */*", "authorization": "Bearer " + token }, credentials: "include" })`
- `if (!r.ok) return null;` then `j.user_name` if it is a string; whole call bounded by `.timeout(const Duration(seconds: 10))`.

## Selectors, regexes and string literals

Nothing DOM-facing. Literals: `'gz_janitor_user_name'` (prefs key), `'https://janitorai.com/hampter/profiles/mine'`, header names `"Accept"` (`"application/json, text/plain, */*"`) and `"authorization"` (`"Bearer "` prefix — lowercase header name in the injected JS), `"credentials": "include"`, response field `user_name`. UI copy is not in this file.

## State machine, retries, timings

No timers or retries. One asynchronous transition: `build()` → empty state → (`_load`) → named state, with no guaranteed ordering relative to first paint. `isLoggedIn` therefore reads `false` for at least one frame after launch even when a name is stored — any UI that treats the first emission as authoritative must handle the flip (all current consumers are reactive, so they do).

Failure mode: if `SharedPreferences.getInstance()` throws (platform channel not ready), `_load` throws inside an unawaited future — no handler, so it surfaces as an unhandled async error (inferred from the absence of a `try`/`catch`).

## Errors and user-visible messages

None raised or displayed by this file. Neighbouring strings that the gate produces: `'Not logged into JanitorAI — log in first (Menu → JanitorAI).'` (proxy, thrown by the capture) and `'Janitor.AI session expired (401)'` (`JanitorAuthException.toString()`).

## Persistence

- Key: `gz_janitor_user_name`, single `String`, in `shared_preferences` (`SharedPreferences.getInstance()`; on Android this is an XML prefs file, on desktop a JSON/prefs store — the exact location is platform-determined, not stated here).
- Lifetime: indefinite; cleared only by `setUserName(null)`/`setUserName('')`.
- Cleared on: explicit logout (`catalog_detail_launcher.dart`, `janitor_lorebook_capture_sheet.dart`, `janitor_login_sheet.dart`) and on the session-expired flow (`janitor_session_expired_state.dart`).
- No tokens, cookies or secrets are stored here — the JWT lives in the WebView cookie jar (`sb-*-auth-token*`), which is a deliberate split (see `janitor_session.md`).

## Porting notes for our SillyTavern port

1. **Reproduce the split, not this class.** Our extension has its own settings object (`extension_settings.weavers_vault` or equivalent) and, critically, SillyTavern's browser context already holds whatever `janitorai.com` session exists. Storing a display name in extension settings for a "Logged in as …" hint is fine; treating it as an auth gate is the trap this file exists to avoid.
2. **Never gate a network call on the cached name.** The gate that matters is the response: `401` ⇒ refresh once ⇒ anonymous retry only for allowlisted public GETs ⇒ then a real error. A stale `userName` shows a wrong menu line; a stale *gate* skips the login prompt entirely.
3. **Write-on-login / clear-on-logout symmetry** is worth keeping: the login path sets the name only after confirming a token exists (`hasSessionToken`) and after fetching the profile, and every logout/expiry path clears it. That ordering (verify token → fetch name → persist) is what prevents a "logged in" hint with no session.
4. Dart-only scaffolding to drop: Riverpod `Notifier`/`NotifierProvider`, `ref.watch` vs `ref.read`, `const JanitorAccount()` initial value.
5. Fragile / worth improving: the fire-and-forget `_load` gives a spurious logged-out frame and can produce an unhandled error; a browser port can simply read the stored value synchronously at init.

## Open questions

- Whether any surface treats `isLoggedIn` as authorization (rather than a display hint) beyond the capture sheets listed — not determined from this file; `widgets/janitor_lorebook_capture_sheet.dart` around lines 284 and 1468 would settle it (only call sites were read, not their use of the value).
- Whether `gz_` prefixed keys are namespaced/cleared anywhere globally (`gz_` suggests a shared Glaze key prefix) — no cleanup/migration code was read; a repo-wide search for `gz_` would settle it.
- Whether the login sheet re-verifies the stored name against the live profile on launch — not determined here; `widgets/janitor_login_sheet.dart:25` (`if (!ref.read(janitorAccountProvider).isLoggedIn)`) suggests it does not.
