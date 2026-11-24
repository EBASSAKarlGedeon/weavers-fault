# third_party_providers_screen.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/third_party_providers_screen.dart
- **Lines:** 286 (read in full: 1-286)
- **Role:** The "Content providers" screen — the single settings surface where each of the five catalog sources is enabled/disabled and where the JanitorAI account row and the JanitorAI extraction-source selector live.

## Purpose

One list screen, built from `MenuGroup`s, that owns:

1. the **catalog master switch** (show/hide the Discover tab) plus two catalog-wide display options (onboarding replay, NSFW blur),
2. a **per-source enable switch** for the four browse providers,
3. each source's **account row** (JanitorAI, Chub, DataCat, Saucepan) and the **JanitorAI extraction-source** row,
4. a **"Lorebook build"** collapsible section that exists only under the JanitorAI group, only while JanitorAI is enabled, and only while the extraction source is `local`.

Class doc, verbatim: "Lists the five content sources (JanitorAI, Janny, Datacat, Chub, Saucepan), each as a group. The four browse providers can be toggled on/off: disabling one hides it from the catalog and collapses its per-provider settings. Saucepan has no toggle — it is always on and only backs URL import, so its account settings are always shown."

It is reached from the menu (`menu_screen.dart:295`), from the menu's search index (`menu/menu_search_index.dart:337`), and from the catalog's provider picker (`catalog_controls.dart:170`).

## Behaviour walkthrough

### Opening

`openThirdPartyProvidersScreen(BuildContext context)`:

- `if (floatOnDesktop(context, 'third-party-providers', push: true)) return;` — on desktop it opens as a *floating window* keyed `'third-party-providers'`; the `push: true` means the window is stacked onto the Menu's when opened from there.
- Otherwise `await Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(builder: (_) => const ThirdPartyProvidersScreen()));`.

The doc-comment explains the root-navigator choice: the screen "works identically from the menu and from the catalog provider picker (which live in different shell branches)".

### State read

```
final disabled = ref.watch(thirdPartyProvidersProvider);          // Set<ThirdPartyProvider> of DISABLED
final catalogEnabled = ref.watch(catalogMasterEnabledProvider);   // bool, default true
final blurNsfw = ref.watch(blurNsfwImagesProvider);               // bool, default false
final janitorSource = ref.watch(appSettingsProvider.select((s) => s.value?.janitorSource));
```

Defaults come from `third_party_providers_provider.dart`: `build()` returns `{ThirdPartyProvider.janny, ThirdPartyProvider.datacat, ThirdPartyProvider.chub}` — i.e. **JanitorAI is the only browse provider on by default**, and Saucepan is never in the set (it is always on). Persisted as a `StringList` under `gz_disabled_third_party_providers`; a stored `'saucepan'` entry from an older build is ignored on load.

### Layout

- `topPad = DetachedShellHost.of(context) ? 0.0 : MediaQuery.of(context).padding.top + 74.0;` — "Inside the desktop floating window the frame supplies the title bar, so the space reserved for a header would be a gap."
- `bottomPad = MediaQuery.of(context).padding.bottom + 20.0;`
- `GlazeScaffold(title: 'third_party_providers_title'.tr(), showBackground: true, extendBodyBehindHeader: true, onBack: () => Navigator.of(context).pop(), body: ListView(padding: EdgeInsets.fromLTRB(0, topPad + 8, 0, bottomPad), ...))`.
  The `onBack` comment is a bug-fix note worth keeping: "Pushed as a raw MaterialPageRoute, so pop this route directly. Using maybePop() here would be blocked by GlazeScaffold's PopScope (canPop == false on non-iOS) and recurse back into onBack → crash."

### Children

1. **Catalog group** — `MenuGroup(header: 'third_party_catalog_title'.tr() = "Catalog", headerIcon: Icons.public_rounded, description: 'third_party_catalog_desc'.tr(), headerTrailing: _GroupSwitch(catalogEnabled → catalogMasterEnabledProvider.notifier.setEnabled(v)))`.
   Items:
   - `MenuItem(icon: Icons.school_outlined, label: 'catalog_onboarding_replay'.tr(), subtitle: 'catalog_onboarding_replay_hint'.tr(), onTap: () => replayCatalogOnboarding(context))`.
   - `MenuSwitchItem(label: 'catalog_blur_nsfw'.tr(), description: 'catalog_blur_nsfw_desc'.tr(), value: blurNsfw, onChanged: → blurNsfwImagesProvider.notifier.setBlurring(v))`. Comment: "One switch for every source: a display choice only, it covers the main image and the images in the bio of an adult row and never removes a character from the results."
2. **Per-provider groups**, in `ThirdPartyProvider.values` order → `janitor, janny, datacat, chub, saucepan`.
3. **After the JanitorAI group only**, conditionally:
   ```
   if (p == ThirdPartyProvider.janitor && !disabled.contains(p) && janitorSource == ExtractionSource.local)
     MenuCollapsibleSection(label: 'lorebook_build_settings_section'.tr(), helpTerm: 'lorebook-build-prompt',
       children: const [LorebookBuildLlmGroup(), LorebookBuildPromptsGroup()])
   ```
   Comment: "Lorebook builds are part of the local JanitorAI flow (closed and scripted lorebooks), so their connection and prompts follow its group — the same settings the capture sheet's gear opens. DataCat rebuilds nothing, so there they would be settings for nothing."
   **Note the asymmetry with the dedicated sheet**: this inline section omits `LorebookBuildSplitGroup`; only `showJanitorExtractionSettingsSheet` (capture-sheet gear) exposes the long-lorebook splitting controls.

### `_providerGroup(...)`

`toggleable = p != ThirdPartyProvider.saucepan;` → `MenuGroup(header: _label(p), headerIconWidget: ProviderLogo(provider: p), description: _description(p), headerTrailing: toggleable ? _GroupSwitch(value: enabled, onChanged: (v) => thirdPartyProvidersProvider.notifier.setEnabled(p, v)) : null, items: [ if (enabled || !toggleable) ..._settingsFor(context, ref, p) ])`.

So a **disabled provider keeps its header and description but loses its settings rows entirely** (not greyed, gone). Saucepan's settings are always present.

### `_settingsFor` per provider

- **janitor**: `ref.watch(janitorAccountProvider)`; rows are
  - `MenuItem(icon: Icons.person_outline_rounded, label: 'janitor_login_menu'.tr(), subtitle: account.isLoggedIn ? 'janitor_login_menu_logged_in'.tr(namedArgs: {'name': account.userName!}) : 'janitor_login_menu_logged_out'.tr(), onTap: () => openJanitorAccountSheet(context, ref))`
  - `if (settings != null) ...janitorSourceMenuItems(context, ref, settings)` — the extraction-source selector from `janitor_source_settings.dart`.
- **saucepan**: `ref.watch(saucepanAccountProvider)`; one `MenuItem(icon: Icons.ramen_dining_outlined, label: 'Saucepan account', subtitle: account.isLoggedIn ? (account.handle != null ? 'Logged in as ${account.handle}' : 'Logged in') : 'Log in for local companion extraction', onTap: () => openSaucepanAccountSheet(context, ref))`. **All four of those strings are hardcoded English, not i18n keys** — a translation gap.
- **chub**: `chub_account_provider`; login `MenuItem` (`'chub_login_menu'` / `'chub_login_menu_logged_in'` / `'chub_login_menu_logged_out'`, `Icons.key_outlined`), then `MenuSwitchItem(label: 'catalog_filter_nsfl'.tr(), description: 'chub_nsfl_account_hint'.tr(), value: chub.nsfl, onChanged: ...)` with a guard: `if (v && !chub.isLoggedIn) { openChubAccountSheet(context, ref); return; }`. Comment: "Account-level NSFL opt-in, mirroring chub.ai's own `no_nsfl` profile flag: the site only ever serves NSFL to a signed-in account, and this is the persistent 'I want it' that the per-search toggle in the filter sheet then narrows."
- **datacat**: `MenuItem(icon: Icons.person_outline_rounded, label: 'datacat_account_menu'.tr(), subtitle: linked ? (displayName != null ? 'datacat_account_linked_as'.tr(namedArgs: {'name': ...}) : 'datacat_account_linked'.tr()) : 'datacat_account_not_linked'.tr(), onTap: () => openDatacatAccountSheet(context, ref))`. Comment: "Linking is only needed to post kudos and comments; browsing and importing work without it, so the row says what it unlocks rather than presenting itself as a prerequisite."
- **janny**: `return const [];` — "No dedicated settings — the group is just an enable/disable toggle."

### `_label` / `_description`

`_label` returns **hardcoded** `'JanitorAI'`, `'Janny'`, `'Datacat'`, `'Chub'`, `'Saucepan'` (brand names, intentionally untranslated). `_description` returns i18n keys:

- `third_party_janitor_desc` = `"Mirror of the official JanitorAI character repository."`
- `third_party_janny_desc` = `"Archive of JanitorAI characters that is regularly updated. Look here for deleted characters."`
- `third_party_datacat_desc` = `"Character repository that hosts its own bots and also archives JanitorAI bots. Has the most advanced filtering features."`
- `third_party_chub_desc` = `"Character repository with the most lax restrictions. Every character has open definitions."`
- `third_party_saucepan_desc` = `"Place for exiled JanitorAI creators. Characters can only be imported with open definitions, and only by URL."`

### `_GroupSwitch`

`Switch` with `Haptics.selectionClick()` on change, `activeThumbColor: context.cs.primary`, `activeTrackColor: primary.withValues(alpha: 0.5)`, `trackOutlineColor` resolved by `WidgetState.selected` (transparent when selected, else `outlineVariant`), `materialTapTargetSize: MaterialTapTargetSize.shrinkWrap`.

## Data shapes

- `Set<ThirdPartyProvider>` where `enum ThirdPartyProvider { janitor, janny, datacat, chub, saucepan }` and set membership means **disabled**. `isEnabled(p) => p == saucepan || !state.contains(p)`; `setEnabled` early-returns for `saucepan` and for a no-op change.
- `ThirdPartyProvider.janitor ⇒ CatalogProvider.janitor` (extension); `saucepan ⇒ null`.
- `AppSettings.janitorSource` — `@Default(ExtractionSource.datacat)`; `enum ExtractionSource { local, datacat }`.
- Chub account: `{ bool isLoggedIn, bool nsfl, ... }`; DataCat: `{ bool linked, String? displayName }`; Saucepan: `{ bool isLoggedIn, String? handle }`; Janitor: `{ String? userName }`.

## Network / WebView contract

None directly — every row delegates to an account sheet (`openJanitorAccountSheet`, `openChubAccountSheet`, `openDatacatAccountSheet`, `openSaucepanAccountSheet`). The only network-shaped fact here is that the JanitorAI account row's subtitle is a *cached* display name, so it can claim "Logged in: X" with a dead token (see `janitor_login_sheet.md` / `janitor_account_provider.md`).

## Selectors, regexes and string literals

No regexes or selectors. Literals defined in this file:

- `'third-party-providers'` — the desktop floating-window key passed to `floatOnDesktop`.
- `'Saucepan account'`, `'Logged in as ${account.handle}'`, `'Logged in'`, `'Log in for local companion extraction'` — untranslated.
- `'JanitorAI'`, `'Janny'`, `'Datacat'`, `'Chub'`, `'Saucepan'` — untranslated brand labels.
- i18n keys consumed: `third_party_providers_title`, `third_party_catalog_title`, `third_party_catalog_desc`, `catalog_onboarding_replay`, `catalog_onboarding_replay_hint`, `catalog_blur_nsfw`, `catalog_blur_nsfw_desc`, `lorebook_build_settings_section`, `janitor_login_menu`, `janitor_login_menu_logged_in`, `janitor_login_menu_logged_out`, `catalog_filter_nsfl`, `chub_nsfl_account_hint`, `chub_login_menu`, `chub_login_menu_logged_in`, `chub_login_menu_logged_out`, `datacat_account_menu`, `datacat_account_linked`, `datacat_account_linked_as`, `datacat_account_not_linked`, `third_party_janitor_desc`, `third_party_janny_desc`, `third_party_datacat_desc`, `third_party_chub_desc`, `third_party_saucepan_desc`.
- Named-arg placeholders: `{name}` in `janitor_login_menu_logged_in` and `datacat_account_linked_as`.
- `helpTerm: 'lorebook-build-prompt'` — a glossary term id (see `assets/translations/glossary_en.json`).

## State machine, retries, timings

Stateless apart from provider watches. Every toggle writes immediately to `shared_preferences` (via the notifiers) with no debounce and no confirmation; `_GroupSwitch` fires a haptic on each change. There is **no confirm dialog for disabling a provider**, which only hides it from the catalog (no data is deleted).

Interactions between the three independent switches (behavioural, worth stating because it is not obvious from the UI):

- Catalog master off + provider on ⇒ catalog hidden entirely (`catalogVisibleProvider` false), but this screen still lists and toggles providers.
- JanitorAI disabled ⇒ its account row and the extraction-source row disappear; the lorebook-build section disappears too. The stored `janitorSource` value is untouched.
- `janitorSource == datacat` ⇒ the lorebook-build section disappears from this screen even though the user may still rebuild lorebooks via the capture sheet's gear (where all three groups, including splitting, are shown). This is the one *undiscoverable setting* on this screen: with DataCat selected, nothing here hints that build settings exist.

## Errors and user-visible messages

None. The screen performs no I/O and reports no failures; `settings == null` simply omits the extraction-source row (async first-load of `AppSettings`).

The screen does surface account *state* as subtitle text (see literals above), including the stale-token case.

## Persistence

Nothing local. It reads/writes:

- `gz_disabled_third_party_providers` (`StringList` of `ThirdPartyProvider.name`, absent = enabled) — `thirdPartyProvidersProvider`.
- `gz_catalog_enabled` (`bool`, default `true`) — `catalogMasterEnabledProvider`.
- `gz_blur_nsfw_images` (`bool`, default `false`) — `blurNsfwImagesProvider`.
- `janitorSource` (via `AppSettings`, value `'local'` / `'datacat'`) — written by `janitor_source_menu_items`.
- Chub `nsfl`, and each provider's account record, through their own notifiers.

## Porting notes for our SillyTavern port

1. **Copy the information architecture, not the widget tree.** The screen's real content is: one master switch, one enable switch per source, one account row per source, one extraction-source row for JanitorAI, one build-settings section scoped to the JanitorAI group. In Weaver's Vault that becomes a settings block in the extension drawer (we ship no catalog, so the enable switches and the master catalog switch have no counterpart; the JanitorAI account/status row and the source choice do).
2. **The JanitorAI group is where all three Janitor-specific decisions live**, and they are coupled: *account* (who can see closed content), *extraction source* (`local` vs `datacat`), and *build settings* (which LLM rebuilds the closed book). Our port should keep that coupling visible in one place rather than scattering them across tabs — Glaze's own bug history here (the split group missing from this screen) shows how easily the third one drifts out of sync.
3. **Source choice semantics to reproduce exactly**: `datacat` is the default and needs no account, but cannot yield closed cards or closed lorebooks; `local` reads what the logged-in account can see and can capture the assembled prompt, but requires being logged in. The two hint strings state this in the user's language and are worth porting verbatim in meaning:
   - `janitor_source_datacat_hint` = `"Some creators may have forbidden DataCat from extracting their cards. Only public lorebooks are extractable."`
   - `janitor_source_local_hint` = `"Extract both the characters and lorebooks, either private or public, on your device using your Janitor account. Requires being logged in."`
4. **Provider descriptions are honest about capability** (`"Every character has open definitions."` for Chub, `"Characters can only be imported with open definitions, and only by URL."` for Saucepan). If our port ever offers a second source as a fallback for a refused character, those sentences are the model: say what the source can and cannot recover before the user tries.
5. **Do not copy the untranslated Saucepan strings.** They are the one place in this file that bypasses i18n; our extension ships one locale set and should not inherit that.
6. `janitorSource == local` gating of the build section is correct for DataCat (nothing to rebuild) but it also removes the *only* entry point to the build settings from this screen. In our port, keep the build settings reachable regardless of source (the capture sheet's gear does exactly that), or make the section explain why it is hidden.

## Open questions

- Whether `janitorSource` is editable while `local` was never logged in — the row is shown unconditionally (no login gate), so a user can pick `local` with no account and only discover the requirement at capture time (the capture sheet's `_captureLocked` handles it). Whether the UI warns anywhere before that: not in this file; `janitor_lorebook_capture_sheet.dart` would settle it.
- What `ProviderLogo` renders for `thirdPartyProvider.saucepan` (a brand logo or a fallback glyph) — not determined from this file; `provider_logo.dart`.
- Whether `floatOnDesktop` with `push: true` reuses an already-open window keyed `'third-party-providers'` or stacks duplicates — not determined from this file; `shared/shell/desktop/desktop_floating_provider.dart`.
- Whether the catalog master-off state hides the Discover tab only, or also clears cached catalog results — this screen does not act on it beyond the switch; `catalog_provider.dart` / `catalogVisibleProvider` consumers would settle it.
