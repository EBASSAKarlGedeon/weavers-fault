# janitor_source_settings.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_source_settings.dart
- **Lines:** 88 (read in full: 1-88)
- **Role:** The single "where do JanitorAI cards come from" choice (`local` vs `datacat`), exported as a menu-item list so the content-providers screen and the lorebook capture flow render the identical row.

## Purpose

One setting, one row, two entry points. The file header, verbatim: "The single 'where does this come from' choice of the JanitorAI flow, as a menu row: the catalog card, its closed definition and its closed lorebooks all come from either the local Janitor.AI session or DataCat's scraped copy. Shared because both places that own this setting must offer exactly the same choice: the content providers screen (JanitorAI group) and the extraction settings sheet reachable from the lorebook capture flow."

The setting is `AppSettings.janitorSource`, declared in `features/settings/app_settings_provider.dart` as `@Default(ExtractionSource.datacat) ExtractionSource janitorSource`. It is the consolidation of four older keys that are still read once on upgrade: `extractJanitorLocally`, `janitorLorebookSource`, `janitorCardSource`, `janitorCharacterSource` (`AppSettings.legacyKeys`).

## Behaviour walkthrough

`janitorSourceMenuItems(BuildContext context, WidgetRef ref, AppSettings settings) → List<Widget>`

- Defines `void save(AppSettings next) => ref.read(appSettingsProvider.notifier).save(next);` — a whole-object write; the `AppSettings` instance handed in is whatever the caller watched, so a save is "last-watched-object plus this one field" (see the concurrency note below).
- Returns exactly one widget, built by `_sourceItem(...)`:
  - `label: 'janitor_source_label'.tr()` → `"Extract JanitorAI cards with"`
  - `description: 'janitor_source_label_desc'.tr()` → `"Where JanitorAI character cards, their closed definitions and lorebooks come from."`
  - `value: settings.janitorSource`
  - `order: const [ExtractionSource.datacat, ExtractionSource.local]` with the comment "DataCat first: it needs no account, and it is the default."
  - `hints: { datacat: 'janitor_source_datacat_hint'.tr(), local: 'janitor_source_local_hint'.tr() }`
  - `onSelect: (v) => save(settings.copyWith(janitorSource: v))`

`_sourceItem(...)` builds a `MenuSelectorItem(label, description, currentValue: janitorSourceLabel(value), onTap: ...)`; the row therefore shows the current source's *name* on the right (e.g. "Datacat") and the long description underneath. Tapping it opens:

```
showGlazePickerSheet(context, title: label, items: [
  for (final s in order) GlazePickerItem(
    label: janitorSourceLabel(s),
    hint: hints[s],
    icon: _sourceIcon(s),
    iconWidget: s == ExtractionSource.datacat ? ProviderLogo(provider: ThirdPartyProvider.datacat, size: 20) : null,
    isActive: s == value,
    value: s,
  ),
], onSelect: (v) => onSelect(v as ExtractionSource));
```

`showGlazePickerSheet` (`shared/widgets/list_controls.dart`) is a `GlazeBottomSheet.show` whose items pop the sheet with `Navigator.of(context, rootNavigator: true).pop()` **before** calling `onSelect(item.value)`. Consequences:

- The selection is committed outside the picker route, so the row updates after the sheet is gone.
- A picker row with a leading glyph (`icon` or `iconWidget`) and `isActive` renders a trailing `Icons.check_rounded` action in `context.cs.primary`; a row without a leading glyph falls back to showing `Icons.check_rounded` *as* the leading icon while active.
- `ExtractionSource.datacat` carries a real logo (`ProviderLogo(..., size: 20)`), `ExtractionSource.local` carries `Icons.devices_rounded` ("on your device"), which is why `_sourceIcon` returns `null` for datacat — the branded widget replaces it.

`janitorSourceLabel(ExtractionSource source)` is the public display-name function used by both the collapsed row and the picker: `local → 'janitor_source_local'.tr()` = `"Local"`, `datacat → 'janitor_source_datacat'.tr()` = `"Datacat"`. Note the casing: the value is `"Datacat"` here but `"DataCat"` in the account menu label (`datacat_account_menu`); the enum name is `datacat`.

`_sourceIcon(source)` returns `Icons.devices_rounded` for `local` and `null` for `datacat`.

## Data shapes

- `enum ExtractionSource { local, datacat }` with `static ExtractionSource? parse(Object? value)` accepting an `ExtractionSource` or a case-insensitive trimmed `String` name (`'local'`, `'datacat'`), else `null`. Order of `values` is `local, datacat`; the *display* order is the reversed, explicit `order` list.
- Persisted as the enum **name** (lowercase string) in the settings blob, key `janitorSource`.
- Sync merge (`AppSettings.applyPartial`) treats `janitorSource` specially via `_extractionSourceKeys = <String>{'janitorSource'}`: "An unknown source name from a newer (or corrupted) client keeps the local value rather than silently resetting it to the default." That is, a device running an older build will not overwrite `local`/`datacat` with garbage, and will not accept a value it does not know.
- `MenuSelectorItem` fields used: `label`, `description`, `currentValue`, `onTap`.
- `GlazePickerItem` fields used: `label`, `hint`, `icon`, `iconWidget`, `isActive`, `value`.

## Network / WebView contract

None here. The setting's whole meaning is *which* network path the rest of the app takes:

- `local` → `JanitorWebViewProxy` (offscreen WebView on `https://janitorai.com`) with the user's account: metadata from `https://janitorai.com/hampter/characters/{id}`, closed-card capture via the assembled `/generateAlpha` prompt, closed lorebooks from the same capture.
- `datacat` → DataCat's scraped copy (no Janitor account, no WebView); public scripts only for lorebooks, and a creator can forbid DataCat extraction entirely.

Those consequences live in `app_settings_provider.dart`'s enum doc ("`[datacat]` — datacat.run's scraped copy. No Janitor.AI account needed, but it only carries what DataCat has already extracted, and its lorebooks come from the character's *public* scripts only (private books are metadata stubs there …)") and in the hint strings below.

## Selectors, regexes and string literals

No regexes, no selectors, no URLs.

i18n keys consumed (values from `assets/translations/en.json`):

- `janitor_source_label` = `"Extract JanitorAI cards with"`
- `janitor_source_label_desc` = `"Where JanitorAI character cards, their closed definitions and lorebooks come from."`
- `janitor_source_datacat` = `"Datacat"`
- `janitor_source_local` = `"Local"`
- `janitor_source_datacat_hint` = `"Some creators may have forbidden DataCat from extracting their cards. Only public lorebooks are extractable."`
- `janitor_source_local_hint` = `"Extract both the characters and lorebooks, either private or public, on your device using your Janitor account. Requires being logged in."`

Enum names, stored verbatim: `'local'`, `'datacat'`.

## State machine, retries, timings

No state of its own; it is a pure projection of `AppSettings.janitorSource`. One transition (`datacat ⇄ local`) with immediate persistence, no confirmation, no debounce, and **no migration of already-imported characters** — the setting only affects future reads/captures (inferred: nothing in this file or in the importers rewrites existing rows).

Downstream consumers change behaviour *live* when the value flips: the content-providers screen shows or hides the "Lorebook build" section on `janitorSource == ExtractionSource.local`, and the capture sheet's locking logic keys off it (`widgets/janitor_lorebook_capture_sheet.dart:284` and `:1468`, per the cross-references in `janitor_account_provider.md`).

There is **no validation against a missing account**: the row offers `local` unconditionally, and the "Requires being logged in" hint is the only warning. The failure appears later as `Exception('Not logged into JanitorAI — log in first (Menu → JanitorAI).')` from `janitor_webview_proxy.dart:884`.

Concurrency note (inferred): `onSelect` closes over the `settings` object passed into `janitorSourceMenuItems`, and `save()` writes the whole `AppSettings`. If another setting changed between the caller's `watch` and the tap, that change can be reverted by this save. Every other settings writer in this codebase re-reads (`ref.read(appSettingsProvider).value ?? settings`) before mutating — `LorebookBuildLlmGroup`/`LorebookBuildSplitGroup` in `lorebook_build_settings.dart` do exactly that. This file does not.

## Errors and user-visible messages

None. A picker selection cannot fail; a bad stored value is normalised by `ExtractionSource.parse` and the `applyPartial` guard, both silently.

User-visible text is limited to the six strings above (label, description, two names, two hints).

## Persistence

Written through `appSettingsProvider.notifier.save(...)` → `shared_preferences` under `janitorSource` (value = enum name). Read back through `AppSettings.read` with `ExtractionSource.parse(prefs.get('janitorSource')) ?? defaults.janitorSource`, so an unreadable value falls back to `datacat`.

Related legacy keys still read once on upgrade, then dropped: `extractJanitorLocally`, `janitorLorebookSource`, `janitorCardSource`, `janitorCharacterSource`.

## Porting notes for our SillyTavern port

1. **This is one of the few settings with a real capability difference, so port the row and its two hints, not just the enum.** In Weaver's Vault the counterpart is: a JanitorAI *token-based* path (our `local`, since we have no WebView and must use the user's own token over `fetch`) vs. DataCat as a no-account fallback. The hint wording ("Requires being logged in", "Only public lorebooks are extractable") is exactly the expectation-setting our users need before they hit a closed card.
2. **Default to the no-account path.** Glaze defaults to `datacat` deliberately ("it needs no account, and it is the default"). Our equivalent default is to *not* demand a token for basic import, and require one only for closed-card/closed-lorebook work.
3. **Keep the choice in exactly one place.** The lesson of the four legacy keys (`extractJanitorLocally`, `janitorLorebookSource`, `janitorCardSource`, `janitorCharacterSource`) is that per-artifact source settings multiply and diverge; Glaze collapsed them into one and now gates the whole flow on it. Do the same.
4. **Order matters for discoverability**: `datacat` first, `local` second, even though `local` is the powerful one. Users read the list top-down; leading with the zero-friction option is the choice that kept support load down.
5. **Re-read before saving.** If our port's settings are stored as a flat object (they will be, in `extensionSettings`), mutate a fresh copy on select rather than a snapshot captured at render time — otherwise a concurrent change (e.g. a lorebook build setting saved by a debounce) is silently lost.
6. **If we support a toast/status line**, consider validating immediately: selecting `local` with no token could surface "Not logged in — add your token" right away instead of failing minutes later inside a capture. Glaze does not do this (deliberate: the token may be added after).

## Open questions

- Whether the capture sheet shows the same row with the same order, or a different affordance (the file comment says the extraction settings sheet is the second owner, but `janitor_extraction_settings_sheet.dart` in this dossier contains only the three build groups — the row must be injected by the *capture* sheet, not the settings sheet). `widgets/janitor_lorebook_capture_sheet.dart` (and its call to `janitorSourceMenuItems`) would settle it.
- Whether flipping the source mid-flow is honoured by an already-open capture sheet (it `watch`es or `read`s the value at different points: `:284`, `:1468`). Not determinable from this file; `janitor_lorebook_capture_sheet.dart`.
- Whether `ProviderLogo` has a `size` parameter of exactly 20 in the expected aspect (it is called with `size: 20` here) — `widgets/provider_logo.dart`.
- Whether any other surface (e.g. `catalog_filter_sheet.dart`) also gates on `janitorSource`, which would make this row's blast radius larger than the two documented owners. A repo-wide grep for `janitorSource` would settle it; `janitor_account_provider.md` cites `catalog_filter_sheet.dart:80` for a related login gate, not for the source.
