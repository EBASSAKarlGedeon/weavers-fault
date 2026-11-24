# janitor_session_expired_state.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_session_expired_state.dart
- **Lines:** 226 (read in full: 1-226)
- **Role:** The full-pane "Janitor.AI session expired" state that replaces the catalog error line when a JanitorAI listing ended in a 401 that survived both the token refresh and the anonymous retry — plus its one-shot animated illustration.

## Purpose

This widget is the visible end of a long failure chain: a signed-in session whose cookies the WebView still sends but JanitorAI refuses. Its class doc names the trigger and the two behaviours that look like bugs if you do not know them:

> "Stands in for the catalog's error line when JanitorAI kept answering 401 — usually a stale account session the refresh could not save, seen mostly behind VPNs.
> The dead session is dropped before the login sheet opens: left in place, the login page would find the old token, count it as a successful sign-in and close at once. Dropping it alone often brings the feed back, so the catalog reloads even when the user closes the sheet without logging in (a successful login reloads it itself)."

So the file encodes three decisions: (a) 401 up to the *last* resort gets its own state, not a text error; (b) clearing the stored identity **before** showing the login UI is mandatory, otherwise the login page self-completes; (c) the catalog is reloaded on sheet close regardless of outcome, because dropping the dead token is itself often the fix.

## Behaviour walkthrough

### Where it is mounted

`lib/features/catalog/widgets/catalog_grid.dart:105-106`:

```dart
if (state.error != null && state.janitorSessionExpired)
  const SliverToBoxAdapter(child: JanitorSessionExpiredState())
else if (state.error != null)
  SliverToBoxAdapter(… Text(state.error!) with fontSize 13, color onSurfaceVariant, padding EdgeInsets.all(32) …)
```

It is a sliver at the top of the catalog list — the ordinary error line is replaced, not stacked on top of it.

### The trigger flag

`CatalogState.janitorSessionExpired`, documented at `catalog_provider.dart:48-52`:

> "The last JanitorAI fetch ended in a 401 that survived both the session refresh and the anonymous retry: the account cookies the WebView still sends are being refused, so the grid offers a re-login instead of a bare error. Cleared with [error]."

Set in the search catch (`catalog_provider.dart:436-443`):

```dart
} catch (e) {
  if (!mounted || epoch != _searchEpoch) return;
  state = state.copyWith(
    loading: false,
    error: formatError(e),
    janitorSessionExpired: e is JanitorAuthException,
  );
}
```

Note `copyWith` defaults `janitorSessionExpired` to `false`, so *every* state update that does not pass it clears the flag (along with `error`). A successful reload therefore removes this pane automatically.

`JanitorAuthException` is thrown in `services/janitor_webview_proxy.dart` in exactly two places, both after the recovery steps:

- `_refusalError(...)`: a refusal with `status == 401` becomes `const JanitorAuthException()` and is explicitly **not** cached against the character ("the session went stale mid-capture, and it would be wrong to mark the character as unextractable — after a fresh login it works").
- the fetch path: `if (result.status == 401 && janitorReadIsPublic(url, method: method)) { _log('401 persists — retrying the read without the account token'); result = await _rawFetch(url, method, anonymous: true); } if (result.status == 401) throw const JanitorAuthException();`

So a 401 reaches this widget only for a read that is *not* on the public allowlist (`hampter/characters` ≤ 2 segments, `hampter/characters/tags/suggest`, `hampter/tags`, `hampter/reviews/{id}`), or for a public read that failed again anonymously.

### `_relogin()` — the only action

```dart
Future<void> _relogin() async {
  setState(() => _busy = true);
  await ref.read(janitorAccountProvider.notifier).setUserName(null);
  await JanitorWebViewProxy.instance.logout();
  if (!mounted) return;
  await showJanitorLoginSheet(context);
  if (!ref.read(janitorAccountProvider).isLoggedIn) {
    await ref.read(catalogProvider.notifier).search(reset: true);
  }
  if (mounted) setState(() => _busy = false);
}
```

Step by step and why each matters for a port:

1. `setUserName(null)` → `JanitorAccountNotifier.setUserName` removes the prefs key `gz_janitor_user_name` and sets `JanitorAccount()` so `isLoggedIn` is false *before* any UI appears. This is the "don't let the login page find the old token" step at the app-preferences layer.
2. `JanitorWebViewProxy.instance.logout()` (from `services/janitor_webview_proxy.dart:1885-1898`) wipes the WebView layer:
   ```dart
   await controller.evaluateJavascript(source: 'try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}');
   await CookieManager.instance().deleteAllCookies();
   await _reload();
   ```
   i.e. `localStorage.clear(); sessionStorage.clear();` in-page, then `deleteAllCookies()`, then a page reload (which also re-runs whatever Cloudflare clearance the origin needs). This is the slow part — the logout menu elsewhere in the app deliberately updates account state first for the same reason.
3. `showJanitorLoginSheet(context)` → `showGlazeSheet` with `isScrollControlled: true, useRootNavigator: true, backgroundColor: Colors.transparent`, hosting `JanitorLoginSheet`, a visible WebView on `https://janitorai.com/login` that shares the cookie jar and `localStorage` with the headless proxy.
4. **After the sheet closes**: reload only when the user is *still* logged out. `if (!ref.read(janitorAccountProvider).isLoggedIn) await …search(reset: true);` — the comment in the class doc explains: a successful login reloads the catalog itself, an abandoned one still benefits from the dropped token (browsing JanitorAI needs no account).
5. `_busy` is cleared last, and only `if (mounted)`.

Failure/interruption paths: `if (!mounted) return;` after logout abandons the flow with `_busy == true` in a dead state — harmless. If `showJanitorLoginSheet` throws, `_busy` is never reset (no try/finally) — the button stays in its busy state until the pane is rebuilt from scratch (inferred from the code).

### `build()`

```dart
Padding(padding: const EdgeInsets.fromLTRB(32, 48, 32, 32), child: Column(children: [
  const _ExpiredSessionIllustration(),
  const SizedBox(height: 20),
  Text('catalog_janitor_session_expired_title'.tr(),
       textAlign: TextAlign.center, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: context.cs.onSurface)),
  const SizedBox(height: 6),
  Text('catalog_janitor_browse_session_expired'.tr(),
       textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: context.cs.onSurfaceVariant)),
  const SizedBox(height: 20),
  GlazeActionButton(
    icon: Icons.login_rounded,
    label: 'catalog_janitor_session_expired_login'.tr(),
    tone: GlazeActionTone.primary,
    busy: _busy,
    onTap: _relogin,
  ),
]))
```

Comment: "Laid out like the empty character and dialog lists." Single centred column, no retry, no "ignore", no provider switch — the only way out of the pane is to log in (or change provider via the chip above, which rebuilds the grid).

### `_ExpiredSessionIllustration`

A one-shot `TweenAnimationBuilder<double>(tween: Tween(begin: 0, end: 1), duration: const Duration(milliseconds: 700))` over a `SizedBox(width: 200, height: 160)` with `Stack(clipBehavior: Clip.none)`:

- `static const _curve = Cubic(0.2, 0.8, 0.2, 1);`
- card: `_curve.transform(const Interval(0, 0.7).transform(t))` → `Positioned(left: 50, top: 14 + 12 * (1 - card))`, `Opacity(opacity: card)`, `Transform.rotate(angle: -0.1 * card)`, child `_AccountCard(color: cs.onSurfaceVariant)`.
- badge: `_curve.transform(const Interval(0.3, 1).transform(t))` → `Positioned(right: 34, bottom: 12)`, `Opacity(opacity: badge)`, `Transform.scale(scale: 0.7 + 0.3 * badge)`, child `_KeyBadge(color: cs.primary, onColor: cs.onPrimary)`.

Doc: "A muted account card with an accent key badge struck through over its corner — the saved login that stopped working. The card settles in, the badge lands a beat later, and then both stay still: an idle loop on an empty screen distracts."

`_AccountCard`: 92×124, `Colors.white.withValues(alpha: 0.06)` fill, `Border.all(color: Colors.white.withValues(alpha: 0.1))`, `BorderRadius.circular(14)`, a 40×40 circle (`color.withValues(alpha: 0.12)`) holding `Icons.person_rounded` size 26 at alpha 0.4, then two `_Line` bars (52 px at alpha 0.35, 34 px at alpha 0.22; `height: 7`, `BorderRadius.circular(4)`), separated by `SizedBox(height: 12)` and `SizedBox(height: 7)`.

`_KeyBadge`: 56×56 circle, `LinearGradient` topLeft→bottomRight `[color, Color.lerp(color, Colors.black, 0.25)!]`, `BoxShadow(color: color.withValues(alpha: 0.35), blurRadius: 20, offset: const Offset(0, 6))`, `Icon(Icons.key_off_rounded, size: 28, color: onColor)` — the struck-through key.

## Data shapes

- Reads: `CatalogState.error` (non-null) + `CatalogState.janitorSessionExpired` (true); `JanitorAccount.isLoggedIn` (`userName != null && userName!.isNotEmpty`).
- Local: one `bool _busy`.
- No models, no JSON, nothing returned.

## Network / WebView contract

This widget issues no HTTP itself. Its network effects are indirect and all through the proxy:

| call | effect |
| --- | --- |
| `JanitorAccountNotifier.setUserName(null)` | `SharedPreferences.remove('gz_janitor_user_name')` |
| `JanitorWebViewProxy.instance.logout()` | injected JS `try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}`, then `CookieManager.instance().deleteAllCookies()`, then internal `_reload()` of the hidden WebView (which re-loads janitorai.com and waits for CF clearance) |
| `showJanitorLoginSheet(context)` | visible WebView on `https://janitorai.com/login` |
| `catalogProvider.notifier.search(reset: true)` | a fresh listing request for the active provider |

The condition that put the user here — 401 after refresh **and** after the anonymous retry — lives in `services/janitor_webview_proxy.dart`; the anonymous-retry allowlist (and why account reads must not be retried anonymously) lives in `services/janitor_session.dart`.

## Selectors, regexes and string literals

No regexes, no DOM selectors.

| literal | where |
| --- | --- |
| `catalog_janitor_session_expired_title` → `Janitor.AI session expired` | heading, fontSize 18 / w600 |
| `catalog_janitor_browse_session_expired` → `Janitor.AI rejects the saved session (401), so the catalog can't load. This happens most often behind a VPN — log into your account again.` | body, fontSize 13 |
| `catalog_janitor_session_expired_login` → `Log in again` | button label |
| `Icons.login_rounded`, `GlazeActionTone.primary` | button icon/tone |
| `Icons.person_rounded`, `Icons.key_off_rounded` | illustration icons |
| `Duration(milliseconds: 700)`, `Cubic(0.2, 0.8, 0.2, 1)`, `Interval(0, 0.7)`, `Interval(0.3, 1)`, `-0.1 * card`, `0.7 + 0.3 * badge` | animation |
| `EdgeInsets.fromLTRB(32, 48, 32, 32)`, `20 / 6 / 20` gaps | layout |
| `200 × 160`, `92 × 124`, `40 × 40`, `56 × 56`, `_Line height: 7` | illustration geometry |

One-string contrast worth knowing for the port: the *import*-side key is different — `catalog_janitor_session_expired` = `Log into your Janitor.AI account again to import this character. The stored session is no longer accepted, so the capture cannot run.` (used by `services/catalog_error_labels.dart` for `JanitorAuthException`). Two copies, two contexts: browsing vs capturing.

## State machine, retries, timings

```
search() ──401 persists──▶ error + janitorSessionExpired
        │                        │
        │                        ▼
        │              [JanitorSessionExpiredState]
        │                        │ tap "Log in again"
        │                        ▼
        │              _busy = true → identity cleared → cookies+storage wiped → reload
        │                        ▼
        │              login sheet (visible WebView)
        │                   ├─ success → login sheet triggers its own reload
        │                   └─ closed/cancelled → search(reset: true)
        ▼                        ▼
     (cleared)            _busy = false
```

Timings: 700 ms illustration; `logout()` is unbounded (page reload + CF clearance wait — the logout menu comment says it "can take many seconds"). No retry counter, no exponential backoff anywhere.

## Errors and user-visible messages

Only the three strings above. Notably absent: any hint that the user can browse anonymously (which the code *relies* on — it reloads the feed after a cancelled login), any display of the underlying 401, and any way to dismiss the pane.

## Persistence

Indirect only: it **clears** the persisted account name key `gz_janitor_user_name` and destroys all WebView cookies/localStorage/sessionStorage for the app's WebView store. Nothing is written.

## Porting notes for our SillyTavern port

1. **Give 401-against-a-signed-in-account its own UI state, not an error string.** The condition the app detects is specific: refresh attempted, refused, public read retried anonymously, refused again. Our extension should set a distinct `sessionExpired` flag on the listing state so the view can offer a recovery, and clear it on every successful load.
2. **Clear the credential before opening any login UI.** In our case the "login UI" is a URL the user must open in the browser (or a pasted token/`cf_clearance`); the equivalent failure is a stale token being *validated* by a page that trusts its presence. Drop the stored token first, then present recovery.
3. **Reload unconditionally on return.** The upstream insight is that dropping the dead credential is frequently sufficient because browsing is anonymous-capable. Our port should test "is the operation anonymous-capable?" per endpoint (JanitorAI: listings, card metadata, `/hampter/tags`, tag suggest, reviews) rather than gating the reload on a successful login.
4. **Never cache a 401 as a property of the character.** The proxy explicitly refuses to record 401 in `_refusals`, so a re-login retries cleanly. A JS port that memoizes failures per character id would make the session error permanent.
5. **Two different copy strings for two contexts** — keep "session expired" separate from "log in again to import this character", because the recovery differs (browse anonymously vs a capture that genuinely needs the account).
6. Copy the *shape* of the state (illustration + heading + explanation + single primary action), not the geometry; our vault UI is not Flutter.

## Open questions

- Whether `showJanitorLoginSheet` itself detects a completed login and reloads the catalog, and on which signal (the class doc asserts it does) — UNKNOWN from this file; settled by `widgets/janitor_login_sheet.dart` (it fetches `/hampter/profiles/mine` on login per `janitor_account_provider.dart`'s doc).
- Whether a 401 during a *capture* also routes here or only to `catalog_janitor_session_expired` — this file shows only the browse path; the capture path is in `widgets/janitor_lorebook_capture_sheet.dart:760` and `widgets/catalog_detail_launcher.dart:412`.
- Whether the `_busy` latch can be left stuck if `showJanitorLoginSheet` throws — inferred from the absence of try/finally; a runtime check would settle it.
