# janitor_login_sheet.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_login_sheet.dart
- **Lines:** 254 (read in full: 1-254)
- **Role:** The whole JanitorAI account UX: a "JanitorAI Account" menu sheet (log out / cancel) plus the full-height visible WebView on `https://janitorai.com/login` that detects a completed sign-in, persists the display name, flushes cookies, refreshes the catalog and closes itself.

## Purpose

This file is the *only* place a JanitorAI session is created, and the flow's correctness depends on three things it does deliberately:

1. **The login is done by the user inside a real WebView**, not by posting credentials. There is no email/password handling anywhere in Glaze; the sheet simply loads the site's own login page and lets the site do it (including Google sign-in).
2. **The WebView shares the cookie jar and `localStorage` with the headless `JanitorWebViewProxy`** — same app storage, same origin — so a sign-in performed here is immediately usable by catalog and capture requests. The class doc says it explicitly: "The WebView shares its cookie jar and `localStorage` with the headless [JanitorWebViewProxy] (same origin, same app storage), so once the user signs in here the account session is automatically used for catalog requests. No cookies are wiped — unlike the CF challenge WebView."
3. **Success is detected by token presence, not by a URL match**, because JanitorAI is an SPA whose post-login bounce is to the site root, indistinguishable from a user merely browsing.

## Behaviour walkthrough

### `openJanitorAccountSheet(BuildContext context, WidgetRef ref)`

The single entry point for the menu's "JanitorAI Account" item (called from `third_party_providers_screen.dart:171` and `catalog_detail_launcher.dart:508`).

- `if (!ref.read(janitorAccountProvider).isLoggedIn) { await showJanitorLoginSheet(context); return; }` — a not-logged-in user goes straight to the WebView; **the log-out/cancel sheet is only shown to a user Glaze already believes is signed in.**
- Otherwise `GlazeBottomSheet.show<void>(context, title: 'janitor_login_menu'.tr(), items: [...])` with exactly two `BottomSheetItem`s:
  - `label: 'janitor_auth_logout'.tr(), icon: Icons.logout_rounded, isDestructive: true`, whose `onTap` runs, in order:
    1. `Navigator.of(context, rootNavigator: true).pop();` (close the sheet first),
    2. `await ref.read(janitorAccountProvider.notifier).setUserName(null);`
    3. `await JanitorWebViewProxy.instance.logout();`
    4. `await ref.read(catalogProvider.notifier).search(reset: true);`
    The comment states why the order is this: "Clear the account state first so the menu reflects the logout immediately — the WebView/cookie teardown below can take many seconds (page reload + CF clearance wait) and must not block it."
  - `label: 'btn_cancel'.tr(), icon: Icons.close_rounded` → pops.
- Nothing is returned. Both actions are fire-and-forget from the caller's perspective (the caller's `await` returns as soon as the sheet closes, *not* when the teardown finishes).

### `showJanitorLoginSheet(BuildContext context)`

`showGlazeSheet<void>(context: context, isScrollControlled: true, useRootNavigator: true, backgroundColor: Colors.transparent, builder: (_) => const JanitorLoginSheet())`. Note the differences from the extract sheet: **no `barrierColor`, no `useSafeArea`** (defaults apply), root navigator.

Its doc states the caller contract: "After it closes the account session (if any) is active for catalog requests. On a successful sign-in the sheet refreshes the catalog itself, so callers don't need to."

### `JanitorLoginSheet` (StatefulWidget)

`static const _loginUrl = 'https://janitorai.com/login';`

State: `InAppWebViewController? _controller`, `bool _busy` (used only by the in-sheet Log out button), `bool _closing` ("Guards against re-entrant close attempts: once a successful login lands we pop exactly once, even if several navigation callbacks fire in a row.").

`_logout()` (in-sheet button, not the menu one):

```
setState(() => _busy = true);
await ref.read(janitorAccountProvider.notifier).setUserName(null);
await JanitorWebViewProxy.instance.logout();
await ref.read(catalogProvider.notifier).search(reset: true);
await _controller?.loadUrl(urlRequest: URLRequest(url: WebUri(JanitorLoginSheet._loginUrl)));
if (mounted) setState(() => _busy = false);
```

So logging out from inside the sheet keeps the sheet open and reloads the login page — a user can switch accounts without leaving.

`_maybeFinishLogin(WebUri? url)` — the success detector, wired to **both** `onLoadStop` and `onUpdateVisitedHistory`:

```
if (_closing || url == null) return;
if (!url.host.endsWith('janitorai.com')) return;
if (url.path.startsWith('/login')) return;
final controller = _controller; if (controller == null) return;
final loggedIn = await JanitorWebViewProxy.hasSessionToken(controller);
if (!loggedIn || _closing || !mounted) return;
_closing = true;
final userName = await JanitorWebViewProxy.fetchUserName(controller);
if (userName != null) await ref.read(janitorAccountProvider.notifier).setUserName(userName);
await JanitorWebViewProxy.flushCookies();
await ref.read(catalogProvider.notifier).search(reset: true);
if (!mounted) return;
Navigator.of(context).pop();
```

Four properties of this sequence are load-bearing:

- **`url.host.endsWith('janitorai.com')`** accepts `www.janitorai.com` and any other subdomain; a strict `==` would miss them (inferred intent).
- **`url.path.startsWith('/login')`** excludes the login page itself *and* any path under it. The doc explains the design: "JanitorAI redirects away from `/login` (to the site root) once sign-in succeeds — and the screenshot's success toast lands on that root page. So whenever we leave the login page for a janitorai.com URL we verify a session token was actually persisted (creds saved) and, if so, auto-close the sheet. The token check also prevents false closes when the user merely navigates to e.g. the sign-up page."
- **the token check is `hasSessionToken`** (a `callAsyncJavaScript` probe with an 8 s timeout, `janitor_webview_proxy.dart:1830`), so sign-up, password reset, `/forgot-password`, or a same-site browse never closes the sheet.
- **`_closing` is set before the awaits that follow it**, and re-checked after `hasSessionToken` awaits, so two near-simultaneous navigations cannot both proceed to `pop()`.

`fetchUserName` runs in-page against `GET https://janitorai.com/hampter/profiles/mine` with `authorization: Bearer <token>` and `credentials: 'include'`, returning `j.user_name` when it is a string (10 s timeout). If it returns null the sheet still closes — **a successful login with an unreadable profile name is treated as success, only the menu hint stays empty** (and `JanitorAccount.isLoggedIn` therefore stays false, so the next "JanitorAI Account" tap reopens the login WebView even though the session works — a real behavioural wart).

`flushCookies()` exists because "Android holds them in memory and writes them out on its own schedule, so an app killed shortly after signing in comes back signed out." Implementation (other file): sets and deletes a throwaway cookie `gz_flush=1` on `https://glaze-cookie-flush.invalid/`, since every plugin cookie write flushes the whole store.

`search(reset: true)` before closing: "Drop the anonymous catalog results so the now-authenticated character set is fetched — mirrors the logout path. Fires regardless of which entry point (menu or catalog) opened this sheet."

### Rendering

- Height: `GlazeSheetWindowScope.of(context)` decides. Inside a desktop floating window → `double.infinity` and `BorderRadius.circular(16)`; otherwise `MediaQuery.of(context).size.height * 0.92` with `BorderRadius.vertical(top: Radius.circular(20))`, `clipBehavior: Clip.antiAlias`.
- `_Header`: `EdgeInsets.fromLTRB(8, 8, 8, 4)`, a close `IconButton(Icons.close_rounded)` on the left, `Expanded(Text('janitor_auth_title'.tr(), fontSize: 16, FontWeight.w600))`, then either an 18×18 `GlazeSpinner` while `_busy` or `GlazeActionButton(icon: Icons.logout_rounded, label: 'janitor_auth_logout'.tr(), tone: GlazeActionTone.destructive)`.
- The `InAppWebView` fills the rest.

## Data shapes

- `JanitorAccount { String? userName }` in `shared_preferences` under `gz_janitor_user_name` (see `janitor_account_provider.dart`). This sheet is its only writer on the login path.
- `JanitorWebViewProxy.hasSessionToken(InAppWebViewController) → Future<bool>`; `fetchUserName(...) → Future<String?>` (`user_name` string or null); `flushCookies() → Future<void>`; `logout() → Future<void>`.

## Network / WebView contract

`InAppWebView` configuration, verbatim:

```
initialUrlRequest: URLRequest(url: WebUri(JanitorLoginSheet._loginUrl)),   // https://janitorai.com/login
initialSettings: InAppWebViewSettings(
  javaScriptEnabled: true,
  domStorageEnabled: true,
  cacheEnabled: true,
  thirdPartyCookiesEnabled: true,
  isInspectable: false,
  useHybridComposition: true,
  userAgent: janitorWebViewUserAgent,
),
webViewEnvironment: defaultTargetPlatform == TargetPlatform.windows ? chatWebViewEnvironment : null,
gestureRecognizers: { Factory<VerticalDragGestureRecognizer>(...), Factory<HorizontalDragGestureRecognizer>(...) },
onWebViewCreated: (c) => _controller = c,
onLoadStop: (_, url) => _maybeFinishLogin(url),
onUpdateVisitedHistory: (_, url, _) => _maybeFinishLogin(url),
```

- **`thirdPartyCookiesEnabled: true`** is required for Google sign-in (the OAuth round trip is cross-site).
- **`userAgent: janitorWebViewUserAgent`** is the third-party-login enabler. From `chat_webview_environment.dart`: an embedded WebView's UA carries markers Google rejects — WebView2's `Edg/…` token ("UA inconsistency") and Android's `; wv` (`disallowed_useragent`) — and the UA string cannot simply be replaced with a stock Chrome UA because the WebView keeps emitting `Sec-CH-UA` client hints from its real Chromium version, which Cloudflare then blocks. So the UA is the real Chrome version with only the embedded markers stripped:
  - Windows: `'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$major.0.0.0 Safari/537.36'` from the installed WebView2 version.
  - Android/iOS: default UA with `'; wv'` and `Version/\d+\.\d+\s+` removed, whitespace collapsed; `null` (no override) when the result equals the default or the platform cannot answer.
  The login sheet's own comment: "Drop WebView2's native `Edg/…` token (rejected by Google sign-in) while keeping the Chrome version aligned with the client hints CF validates. Null on mobile → native UA kept."
- **`webViewEnvironment: chatWebViewEnvironment` on Windows only** — WebView2 must be initialized before any WebView is created (the shared environment also hosts the chat WebViews).
- **Gesture recognizers** claim vertical *and* horizontal drags so the WebView scrolls instead of the enclosing modal sheet eating the gesture. Horizontal matters because of carousels on the site.
- **`onUpdateVisitedHistory` is not optional**: the SPA can land the post-login state by `history.pushState` without a full load, and `onLoadStop` alone would miss it.
- No `onLoadError`, no `onReceivedError`, no progress indicator, no `onProgressChanged`: a network failure inside the sheet shows the WebView's own error page and nothing else. The only escape is the close button.
- No cookie deletion on open or close; no `shouldOverrideUrlLoading` policy, so the WebView follows links anywhere the site sends it (including off-site OAuth hops and back).

## Selectors, regexes and string literals

No CSS selectors or regexes in this file. Literals:

- `'https://janitorai.com/login'` (`_loginUrl`).
- i18n keys used: `'janitor_login_menu'` → `"JanitorAI Account"`, `'janitor_auth_logout'` → `"Log out"`, `'btn_cancel'` → `"Cancel"`, `'janitor_auth_title'` → `"JanitorAI Authentication"`.
- Host/path predicates: `'janitorai.com'`, `'/login'`.
- Window/route keys: none here (the desktop window key `'third-party-providers'` belongs to the providers screen).

Indirect literals that this flow depends on, from `janitor_webview_proxy.dart`: `'https://janitorai.com/hampter/profiles/mine'`, header `'authorization': 'Bearer ' + token` with `'Accept': 'application/json, text/plain, */*'`, and the token finder `_findTokenJs` — which reads chunked Supabase SSR cookies `^(sb-.*-auth-token)(?:\.(\d+))?$`, concatenates the `.N` chunks, strips a `base64-` prefix, base64-(url-)decodes, matches `"access_token":"(eyJ[^"]+)"`, and falls back to scanning all of `localStorage`. A JS port must reproduce this token discovery verbatim or derive the token some other way.

## State machine, retries, timings

States: `browsing` (no token yet) → `detected` (`_closing = true`, session confirmed) → `closing` (`pop()`), or `manual logout` (`_busy` true while `logout()` runs, then reload).

- The detector is idempotent by `_closing`, not by state: **there is no "checking" state** — the header spinner is for `_busy` only, so the 8 s + 10 s of token/user-name probes after a login are invisible to the user (the sheet just sits there, then closes).
- Timeouts (all in the proxy): `hasSessionToken` `Duration(seconds: 8)`; `fetchUserName` `Duration(seconds: 10)`; both swallow errors and return `false`/`null`.
- No retry of the login itself; the user retries by using the form again.
- `logout()` in the proxy clears `localStorage`/`sessionStorage` in-page, calls `CookieManager.instance().deleteAllCookies()` (**all cookies, not just janitorai.com** — it would also drop chub/datacat cookies in the same jar, inferred consequence), then `_reload()`s the offscreen page. Both steps are individually try/caught, so a failure still proceeds.
- The comment on the menu logout path quantifies the teardown: "can take many seconds (page reload + CF clearance wait)".

## Errors and user-visible messages

- **Sign-in errors are the site's own** (rendered by janitorai.com inside the WebView). Glaze adds no messages: wrong password, unverified email, blocked third-party cookies, and a Cloudflare interstitial all look like whatever the page shows.
- Missing profile name ⇒ silent success (menu shows the logged-out subtitle afterwards, see below).
- Menu subtitles (from `third_party_providers_screen.dart`): `'janitor_login_menu_logged_in'.tr(namedArgs: {'name': account.userName!})` = `"Logged in: {name}"`, else `'janitor_login_menu_logged_out'.tr()` = `"Log into your Janitor account"`. Note `account.userName!` is force-unwrapped under `isLoggedIn`, which is safe by the `JanitorAccount.isLoggedIn` definition.
- No error surface at all exists in this sheet. That is by design: the sheet is just a browser.

## Persistence

- `shared_preferences` key `gz_janitor_user_name` (write on login, remove on either logout path).
- WebView storage: the cookie jar (`CookieManager`) and per-origin `localStorage`/`sessionStorage` — shared with the headless proxy, flushed to disk explicitly after login via the throwaway `gz_flush` cookie on `https://glaze-cookie-flush.invalid/`.
- Catalog state is invalidated (`search(reset: true)`) in three places: menu logout, in-sheet logout, login success.

## Porting notes for our SillyTavern port

1. **There is no login flow to port in the naive sense.** Glaze does not implement authentication; it embeds the site and reads the resulting token. In our extension we have no WebView we control and no cross-origin cookie access. What we *can* do is what the user already does: log into janitorai.com in their own browser, then copy the `access_token` (or the whole `sb-*-auth-token` cookie value) into a token field. **That is the port decision to make explicit in the UI**: Glaze's "log in here" becomes "paste your Janitor.AI token here", and the instructions must say where to find it (DevTools → Application → Cookies → `sb-<ref>-auth-token`, value prefixed `base64-`), because the extraction hinges on that exact token shape.
2. If we do the token-copy route, port `_findTokenJs`'s *acceptance* logic, not its scraping: accept a raw `eyJ…` JWT, a `base64-<base64>` blob, or a JSON session object, and extract `access_token`. That logic ("`raw.indexOf("base64-") === 0` → slice(7)", base64url tolerance, `"access_token":"(eyJ[^"]+)"`, `o.access_token || o.accessToken || o.token || o.currentSession.access_token || o[0]`) is the exact compatibility surface JanitorAI has produced over time.
3. **Verify the token before calling login good**, as `hasSessionToken` does: a cheap authenticated request. Glaze's version is the profiles call; ours should hit `https://janitorai.com/hampter/profiles/mine` and require `user_name` to be a string — that single call both proves the session and yields the display name for the "Logged in: {name}" hint.
4. **Refresh the list after login and after logout.** Glaze resets the whole catalog because the anonymous and authenticated result sets differ (NSFW/following visibility). In an extension that means clearing the cached catalog and any "logged-out" negative caches, including cached refusals (`refusalFor`), which are keyed by character id and would otherwise survive a re-login.
5. **Re-login must be a first-class, non-error path.** `describeCatalogError` maps `JanitorAuthException` to the "session expired" sentence, and `catalog_detail_launcher.dart` catches it mid-import, clears the account name, opens `showJanitorSessionExpiredSheet`, and *restarts the import* after the user logs in. Reproduce that: an expired token must not lose the pending import.
6. Two Glaze behaviours worth **not** copying: (a) success with an unreadable `user_name` leaving the account marked logged out (causes a redundant login prompt), and (b) `deleteAllCookies()` on logout (destroys unrelated providers' sessions in the same jar). In an extension, scope the logout to janitorai.com cookies and treat "token valid but name unknown" as logged in.
7. Timings to expect: the login WebView needs the user to finish the site's own flow (email+password, or Google OAuth with redirects); Glaze's own probes add up to 18 s worst case before the sheet closes. A JS port should show a "verifying…" state during that window rather than looking frozen.

## Open questions

- Whether `_maybeFinishLogin` can fire before the WebView has committed storage for the just-set cookie on iOS (the probe runs in the same controller, so it should see it; not proven). `services/janitor_webview_proxy.dart` + iOS behaviour of `flutter_inappwebview` would settle it.
- Whether the login WebView is affected by Cloudflare's interactive challenge (it has no `CfChallengeService` escalation of its own — the *proxy* does). If the login page escalates, the user solves it in the visible sheet, which is presumably fine but is not stated. `services/cf_challenge_service.dart` and `services/janitor_webview_proxy.dart` (`_escalateToVisible`) would settle the division of labour.
- Whether `JanitorWebViewProxy.instance` is running its headless page at the time the login sheet opens (the shared storage only helps if both are on the same origin and profile, which the doc asserts but does not enforce with a check). `_ensureStarted`/`_start` in `janitor_webview_proxy.dart` would confirm.
- The sheet's `GlazeSheetWindowScope` branch implies a desktop floating-window presentation; whether that window is resizable enough for the site's pages is a UI question not determinable from this file (`shared/widgets/glaze_sheet.dart`).
