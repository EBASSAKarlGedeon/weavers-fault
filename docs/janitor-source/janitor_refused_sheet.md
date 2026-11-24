# janitor_refused_sheet.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_refused_sheet.dart
- **Lines:** 71 (read in full: 1-71)
- **Role:** Two small explanatory bottom sheets — one for a JanitorAI refusal (a character whose prompt can never be captured) and one for an expired JanitorAI session — each returning a boolean that tells the caller whether to continue.

## Purpose

The file exists so that two *non-transient* dead ends do not look like errors, and so the one thing still possible in each case is offered as a button instead of buried in a log. Its header says why the refusal specifically cannot be a retry: "A refused `/generateAlpha` is not a bug the user can retry away: the common case is a creator who restricted the character to JanitorAI's own model, so the closed card and its closed lorebooks can never be captured for it. The sheet quotes JanitorAI's own wording (`Proxies are forbidden for this character`) so the reason is unambiguous, and offers the one thing that still works — importing the public part of the card."

Both functions are consumed only by `widgets/catalog_detail_launcher.dart` (the catalog detail/preview importer): `showJanitorRefusedSheet` at lines 346, 426 and 524, `showJanitorSessionExpiredSheet` at line 417. A third, *widget*-shaped sibling (`widgets/janitor_session_expired_state.dart`) covers the capture sheet's own dead end and is a separate file.

## Behaviour walkthrough

### `showJanitorRefusedSheet(BuildContext context, JanitorRefusedException refusal, {bool offerImportAnyway = true}) → Future<bool>`

```
var importAnyway = false;
await GlazeBottomSheet.show<void>(context,
  title: 'catalog_janitor_refused_title'.tr(),
  bigInfo: BottomSheetBigInfo(
    icon: Icons.lock_outline,
    description: '${refusal.message}.\n\n${'catalog_janitor_refused_body'.tr()}',
    buttonText: offerImportAnyway ? 'catalog_janitor_refused_import_anyway'.tr() : null,
    onButtonTap: offerImportAnyway ? () { importAnyway = true; Navigator.of(context).pop(); } : null,
  ));
return importAnyway;
```

Key behaviours:

- **JanitorAI's own sentence comes first**, then a blank line, then Glaze's explanation. The full text a user sees, for the canonical refusal, is:

  ```
  Proxies are forbidden for this character.

  Because of that, Glaze is unable to recover the character and its lorebooks (if it has them).
  ```

- The status code is **not** shown. `JanitorRefusedException.status` exists (403 for the predicted proxy refusal, 0 for a transport error, others from the server) but the sheet only prints `message` (`JanitorRefusedException` in `services/janitor_webview_proxy.dart`).
- `offerImportAnyway: false` renders the same explanation **without any button** — the caller passes it for lorebooks-only imports ("Lorebooks-only imports nothing into the library, so there is no public part left to fall back to", `catalog_detail_launcher.dart:345`).
- The sheet is **dismissible**: `GlazeBottomSheet.show` defaults to `isDismissible = true`, so barrier tap / back closes it with `importAnyway == false`, which the callers treat as "stop". `onButtonTap` pops the sheet itself and sets the flag before popping — and the caller's `await` resolves after the route is gone.
- Nothing else is returned; there is no third option ("show me the lorebooks anyway", "retry") because a refusal is, by construction, permanent for that character.

### `showJanitorSessionExpiredSheet(BuildContext context) → Future<bool>`

```
var relog = false;
await GlazeBottomSheet.show<void>(context,
  title: 'catalog_janitor_session_expired_title'.tr(),
  bigInfo: BottomSheetBigInfo(
    icon: Icons.person_off_outlined,
    description: 'catalog_janitor_session_expired'.tr(),
    buttonText: 'catalog_janitor_session_expired_login'.tr(),
    onButtonTap: () { relog = true; Navigator.of(context).pop(); },
  ));
if (!relog || !context.mounted) return false;
await showJanitorLoginSheet(context);
return true;
```

- The doc states the entry condition precisely: "Reached only with local extraction on and an account Glaze still believes is signed in: the stored session went stale, so the import cannot create the chat it captures from. Tapping the button opens the login sheet directly."
- **`context.mounted` is checked after the sheet closes** and before opening the login WebView, so a caller whose widget died in the meantime gets `false`.
- **The return value means "the login sheet was shown and closed", not "the user is now logged in".** `showJanitorLoginSheet` returns `Future<void>`, so there is no success signal; `return true;` is unconditional after it completes. The caller (`catalog_detail_launcher.dart:417-421`) then calls `_doImport(...)` again, which re-runs the capture and will throw `JanitorAuthException` again if the user closed the WebView without signing in — and that path calls `setUserName(null)` + `showJanitorSessionExpiredSheet` + retry once more. A user who taps "Log in again" and immediately closes the WebView therefore gets a repeat prompt loop of exactly one extra round (inferred from the caller's code, not stated here).

## Data shapes

- `JanitorRefusedException` (`services/janitor_webview_proxy.dart:581`): `final int status; final String message;` plus
  - `const JanitorRefusedException.proxyForbidden()` → `status = 403`, `message = 'Proxies are forbidden for this character'` (comment: "The wording is JanitorAI's own, so it reads identically whether it was predicted here or read off a real 403.")
  - `bool get isProxyForbidden => message.toLowerCase().contains('prox');`
  - `bool get isTransient => status == 408 || status == 429 || status == 502 || status == 503 || status == 504;`
  - `toString() => message.isEmpty ? 'generateAlpha failed ($status)' : message`.
- Where `message` comes from: `_refusalIn(log)` reads the injected `/generateAlpha` log backwards, skips `matched == true` entries and 2xx statuses, and pulls the server's own wording out of the JSON body under `'message'`, then `'error'`, then `'detail'`; if none is a non-empty string it collapses the raw body (`body.replaceAll(RegExp(r'\s+'), ' ').trim()`). So the first half of the sheet's description is **arbitrary server text** — potentially a long HTML/JSON fragment.
- Caching: `JanitorWebViewProxy._refusals[characterId]`, exposed as `refusalFor(String characterId)`; written by `_refusalError` only when `!refusal.isTransient` and the status is not `401` ("A queue or rate-limit answer says nothing about the card itself; caching it would make every later import report a permanent refusal"; a 401 is converted to `JanitorAuthException` and never cached).
- `BottomSheetBigInfo { IconData icon; String description; String? buttonText; IconData? buttonIcon; bool buttonDisabled; VoidCallback? onButtonTap; }` — this file uses only `icon`, `description`, `buttonText`, `onButtonTap`.

## Network / WebView contract

No network of its own. What it encodes about the network contract:

- A refusal comes from `POST /generateAlpha` on janitorai.com returning an HTTP error instead of an assembled prompt, or is **predicted** from catalog metadata before any request: `janitorAllowsProxy(meta)` false ⇒ `throw const JanitorRefusedException.proxyForbidden();` inside `JanitorExtractor.extract`, right after the metadata fetch. `allow_proxy: false` in `/hampter/characters/{id}` is the creator's "JanitorAI's model only" flag.
- The second button opens `https://janitorai.com/login` in a visible WebView (`showJanitorLoginSheet`) — the only way to fix an expired session in Glaze.

## Selectors, regexes and string literals

No selectors or regexes in this file. Literals:

- i18n keys: `'catalog_janitor_refused_title'` = `"JanitorAI refused"`; `'catalog_janitor_refused_body'` = `"Because of that, Glaze is unable to recover the character and its lorebooks (if it has them)."`; `'catalog_janitor_refused_import_anyway'` = `"Import public part anyway"`; `'catalog_janitor_session_expired_title'` = `"Janitor.AI session expired"`; `'catalog_janitor_session_expired'` = `"Log into your Janitor.AI account again to import this character. The stored session is no longer accepted, so the capture cannot run."`; `'catalog_janitor_session_expired_login'` = `"Log in again"`.
- Icons: `Icons.lock_outline` (refusal), `Icons.person_off_outlined` (expired session).
- Separator: `'.\n\n'` for the refusal description — note the **hard-coded full stop appended to the server message**, so a server message already ending in `.` renders `..`; the same message in the inline error path uses a single `'\n'` (`catalog_error_labels.dart`: `'${error.message}.\n${...}'`).
- Quoted from the other file for reference: `'Proxies are forbidden for this character'`, `'generateAlpha failed ($status)'`.

## State machine, retries, timings

- Refusal: a single yes/no decision variable (`importAnyway`), no retries by design. The caller turns "anyway" into `skipExtraction: true` and, once acknowledged, remembers it for the rest of the preview session via `_refusalAcknowledged` so the sheet is not shown twice for the same character.
- Session expired: `relog` gates the login WebView; the retry is the **caller's** recursion (`_doImport(mode: mode, skipExtraction: skipExtraction)`). There is no attempt counter, no backoff and no "give up after N" — the only implicit bound is the user's patience.
- No timers, no timeouts in this file. The 8 s / 10 s probe timeouts belong to `hasSessionToken` / `fetchUserName` inside the login sheet's flow.
- Dismissal is always a valid exit (`isDismissible` default true, `enableDrag` default true).

## Errors and user-visible messages

- Refusal (canonical): `"Proxies are forbidden for this character."` + `"Because of that, Glaze is unable to recover the character and its lorebooks (if it has them)."`, button `"Import public part anyway"`.
- Refusal (other statuses, e.g. a ban or a limit): whatever sentence the server returned in `message` / `error` / `detail`, plus the same body sentence. A 429/503 shows here **only** if it reached the capture — those are marked `isTransient` and not cached, so the next import attempts again.
- Refusal, lorebooks-only: same text, **no button**, dismiss-only.
- Session expired: `"Janitor.AI session expired"` / `"Log into your Janitor.AI account again to import this character. The stored session is no longer accepted, so the capture cannot run."` / button `"Log in again"`.

Note the naming inconsistency the user sees: the refusal sheet says "JanitorAI" and the expired-session sheet says "Janitor.AI" (both spellings are in the English file).

## Persistence

None. `importAnyway` / `relog` are local variables; the refusal cache and the account name live elsewhere (`JanitorWebViewProxy._refusals`, `gz_janitor_user_name`).

## Porting notes for our SillyTavern port

1. **A refusal is a first-class outcome, not an error.** This is the single most important pattern in the file: when JanitorAI's `/generateAlpha` (or the metadata's `allow_proxy: false`) says the creator forbade proxies, the correct UX is (a) quote the site's own sentence, (b) say what that means for the closed card *and its lorebooks*, (c) offer the public part as a fallback. Our extension should implement exactly that triangle, because the same characters exist and the same fallback (public definition + public books) is what we can deliver.
2. **Check `allow_proxy` before the expensive work.** Glaze predicts the refusal from `/hampter/characters/{id}` metadata and aborts immediately ("Stop on the metadata instead of driving the whole capture to reach the same refusal a minute later"). Our port should fetch metadata first anyway (name, tags, `scripts`), so this check is free — and it means the user gets a clear answer in one request instead of after a persona/chat/proxy setup.
3. **Cache non-transient refusals per character id, never cache transient ones.** Port `isTransient` as-is (`408, 429, 502, 503, 504`) and never cache a 401. This is what stops a rate-limit blip from permanently branding a character unimportable — a bug class that is invisible until a user complains.
4. **Sanitize the server message.** `_refusalIn` may hand through a raw response body. In a SillyTavern popup that becomes HTML-ish text; escape it and clamp the length (Glaze does neither).
5. **The session-expired sheet's contract is weak — fix it in the port.** Returning "true = login sheet shown" forces the caller to re-run blindly. A JS port can do better: after the user submits a token, validate it with `GET /hampter/profiles/mine` and only then retry; otherwise return to the expired state without re-prompting. Also drop the doubled full stop and unify the brand spelling.
6. **Offer the fallback only where it exists.** `offerImportAnyway: false` for a lorebooks-only import is the right nuance: don't offer "import the public part" when the operation adds nothing to the library.
7. **Both sheets are dismissible, and dismissal means "stop".** That is correct for a dead end; do not make them blocking modals.

## Open questions

- Whether `JanitorWebViewProxy.refusalFor` returns refusals for characters whose refusal was predicted from metadata (no request made) — `_refusalError` is the only writer, and the prediction path throws without touching `_refusals`, so the *sheet* is still shown (via `_importRefusal` recomputing `janitorAllowsProxy`), but the cache is empty for it. Settled partly by `catalog_detail_launcher.dart`; the authoritative answer is in `janitor_webview_proxy.dart` (`_refusalError`, `refusalFor`, `_refusals` declaration).
- Whether any caller uses `offerImportAnyway: false` with a *button-less* sheet expectation other than the lorebooks-only path — only line 346 is visible in the launcher read; `janitor_lorebook_capture_sheet.dart` may also call it (grep showed no other call sites in `lib`, so: no).
- Whether the description's `\n\n` renders as a paragraph break or a literal newline in `BottomSheetBigInfo` (`shared/widgets/glaze_bottom_sheet.dart`, `_BigInfo`) — not determined here; for a JS port assume two lines and style accordingly.
- Whether `JanitorRefusedException` messages ever contain the literal `'Proxies are forbidden for this character'` from a real 403 in practice (the constant is reused for the prediction, so the string is guaranteed for predictions but only expected for real responses) — `janitor_webview_proxy.dart` `_refusalIn` plus a live capture would settle it.
