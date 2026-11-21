# Glaze — Catalog (Discover) Browse Screen + Character Detail: Pixel-Exact UI Spec

Extracted from `C:/Users/Gedeon/Documents/Coding/Glaze-stable` (Flutter/Dart, version `0.10.1`
per `pubspec.yaml:6`). Every value below is quoted from source with a `file:line` citation.
All colors are given as Flutter ARGB hex; when a theme role is used, it is resolved to
concrete hex under the **default dark theme** in §Theme. Citations use the fresh-clone
line numbers; a value marked **CHANGED (was X)** differs from the previous extraction
(cite file below). Everything else is CONFIRMED unchanged (only line numbers shifted).

Out of scope (covered by a sibling spec, `glaze-spec-filter-sheet.md`): the contents of
`CatalogFilterSheet` and the `filter_tag_picker` chips; the full shared-widget deep specs
(glass/noise/menu internals). The shared sheet chrome the catalog uses is documented in
§8 here and in the sibling spec.

Files cited (fresh clone):

- `lib/features/catalog/widgets/catalog_grid.dart` (screen assembly + states)
- `lib/features/catalog/widgets/catalog_controls.dart`
- `lib/shared/widgets/list_controls.dart`
- `lib/shared/widgets/glass_surface.dart`
- `lib/shared/widgets/glaze_bottom_sheet.dart`
- `lib/shared/widgets/desktop_popup.dart`
- `lib/features/catalog/widgets/provider_logo.dart`
- `lib/features/catalog/widgets/catalog_card.dart`, `catalog_card_grid.dart`
- `lib/shared/widgets/card_tag_chips.dart`, `lib/shared/widgets/nsfw_blur.dart`
- `lib/features/character_list/character_list_screen.dart` (shell: tab bar + search strip)
- `lib/features/character_list/character_detail_screen.dart`
- `lib/features/catalog/widgets/catalog_detail_launcher.dart`
- `lib/shared/widgets/glaze_tab_bar.dart`, `glaze_tab_bar_strips.dart`
- `lib/shared/widgets/sheet_view.dart`, `glaze_sheet.dart`, `glaze_fab.dart`, `glaze_spinner.dart`
- `lib/shared/widgets/glaze_toast.dart`, `glaze_action_button.dart`, `glaze_error_block.dart`,
  `glaze_text_field.dart`, `glaze_stepper_sheet.dart`
- `lib/shared/widgets/variation_chip.dart`
- `lib/features/catalog/widgets/catalog_onboarding_sheet.dart`
- `lib/features/catalog/widgets/import_url_dialog.dart`
- `lib/features/catalog/widgets/catalog_comments_section.dart`
- `lib/features/catalog/widgets/catalog_creator_screen.dart`, `services/catalog_creators.dart`
- `lib/features/catalog/widgets/datacat/datacat_sort_sheet.dart`
- `lib/features/catalog/catalog_models.dart`, `catalog_provider.dart`,
  `services/chub_provider.dart`
- `lib/shared/theme/app_theme.dart`, `app_colors.dart`, `theme_preset.dart`
- `lib/shared/utils/color_utils.dart`
- `assets/translations/en.json`

---

## 0. Theme defaults that affect rendering

Resolved from `lib/shared/theme/app_theme.dart` (`AppTheme.dark`, `_buildColorScheme`)
with `ThemePreset` defaults (`lib/shared/theme/theme_preset.dart`):

| Role | Value | Source |
|---|---|---|
| `primary` (accent) | `#C42A4A` | theme_preset.dart:27 `@Default('#C42A4A') accentColor`; app_theme.dart:78 `primary: accent` |
| `surface` (app bg, scaffold) | `#19191A` | app_theme.dart:55 `_vueAppBg = Color(0xFF19191A)` → `surface`/`bgColor` (app_theme.dart:63,86); `scaffoldBackgroundColor: colorScheme.surface` (app_theme.dart:298) |
| `surfaceContainer*` (Low/High/Highest, Bright) | all pinned to `uiColor` = `#1E1E1E` | app_theme.dart:56 `_vueUiBg = Color(0xFF1E1E1E)`, pinned at app_theme.dart:66,93–99 (`surfaceDim` = bgColor, `surfaceBright`–`surfaceContainerHighest` = uiColor) |
| `onSurface` | `#E1E3E6` | `contrastFor()` light branch, lib/shared/utils/color_utils.dart:31–38 (light = `0xFFE1E3E6` when bg luminance ≤ 0.5) |
| `onSurfaceVariant` | `#B0B8C1` | color_utils.dart:33–35 (`secondary: true` light value `0xFFB0B8C1`) |
| `outline` | `#2C2D2E` (dark, bg luminance ≤ 0.35; `#5C5D5E` when brighter) | app_theme.dart:185–191 `_borderFor` |
| `outlineVariant` | `rgba(255,255,255,0.10)` | app_theme.dart:68–70 `Colors.white.withValues(alpha: 0.1)` |
| `error` | `#CF6679` | app_theme.dart:84 |
| `onPrimary`/`onTertiary` | `#E1E3E6` (accent luminance ≤ 0.35) | app_theme.dart:71–73,79 |
| Font | Inter (variable, weight via `wght` axis) | app_theme.dart:11 `kInterFontFamily = 'Inter'`; fontVariations `wght` driven at app_theme.dart:31 |

Glass preset values used by every glass chip/surface
(`theme_preset.dart` defaults): `elementOpacity 0.8` (:29), `elementBlur 12` (:30),
`noiseOpacity 0.03` (:81), `noiseIntensity 0.8` (:82); `borderWidth 1` (:64),
`borderOpacity 0.1` (:66); `cornerScale 1.0` (:71). UI text scale: `uiFontSize 'system'`,
`uiFontWeight 400`, `uiLetterSpacing 0` (theme_preset.dart:47–49) — with `uiFontSize` as a
number the whole text theme scales by `uiFontSize/15` and every role gets
`fontWeight = uiFontWeight` + the letterSpacing delta (app_theme.dart:266–269,405–412).

**GlassSurface paint recipe** (glass_surface.dart:124–247) — applies to all chips below:
tint color composited at `elementOpacity` (0.8) alpha over the backdrop (glass_surface.dart:124–138);
when the resolved fill is opaque the blur is skipped (`fillColor.a >= 1.0`, :152);
otherwise a `BackdropFilter` blur with `sigmaX = sigmaY = elementBlur = 12` (:242–244);
a noise overlay (`NoiseOverlay`, opacity `preset.noiseOpacity`, intensity
`preset.noiseIntensity`) is stacked above the fill (:183–209); border paints inside the box
unless `borderOnTop` (:156,212–220). If the surface sits under a `FlatBackdrop` (opaque
sheets) the tint is pre-composited via `Color.alphaBlend` and no blur runs
(:140–141,145–154). Example: the sheet body fill is `alphaBlend(0.8×#1E1E1E, #19191A) ≈
#1D1D1E`, fully opaque, no blur. Corners scale with the theme's `cornerScale`
(`context.scaleBorderRadius`, glass_surface.dart:120–122) — with the default 1.0 the
stated radii are literal.

Material baseline (`app_theme.dart`, dark copyWith): `visualDensity: VisualDensity.compact`
(:292); InputDecorationTheme filled, fill = `surfaceContainerHighest` `#1E1E1E`, radius
`12×corner`, enabled border = `outline`, focused border = `primary` (:342–357); CardTheme
radius `16×corner`, elevation 0, side `outline` (:334–341); dialog bg
`surfaceContainerHighest`, radius `16×corner` (:305–308); bottomSheet bg
`surfaceContainerHighest`, top radius `20×corner`, sheet max width cap
`kSheetMaxWidthConstraints = BoxConstraints(maxWidth: 640)` (:193–198,309–322);
pointer cursors forced onto all Material controls app-wide (:200–251).

---

## 1. Screen assembly (Discover grid, top → bottom)

`CatalogGrid` is a `CustomScrollView` (catalog_grid.dart:31,64). It sits under the shell
header; the scroll view receives `topPadding = contentTopPad` from the parent screen
(character_list_screen.dart:552–556):

- `topPad = MediaQuery.padding.top + 74.0` (character_list_screen.dart:502)
- `contentTopPad = (showHeaderRow ? topPad + 52.0 : topPad) + (searchStrip ? 41.0 : 0)`
  (character_list_screen.dart:514–516) — tab bar block `_kTabBarBlock = 52.0`
  (character_list_screen.dart:96); search strip block `_kSearchStripBlock = 41.0`
  (character_list_screen.dart:104). The tab bar block is only reserved when the tab row is
  present (`showHeaderRow = !inFolder && (catalogVisible || isDesktopLayout)`,
  character_list_screen.dart:506–511).
- bottom padding into the grid: `bottomPadding = navHeight + 20` (character_list_screen.dart:555)

Sliver order (catalog_grid.dart:64–183):

1. **Top spacer** — `SizedBox(height: topPadding)` (only if > 0) (catalog_grid.dart:65–67)
2. **Controls row** — `Padding(EdgeInsets.fromLTRB(16, 12, 16, 0))` wrapping `CatalogControls`
   (catalog_grid.dart:69–73). See §2.
3. **Janitor queue banner** — janitor provider only, while the proxy reports a waiting
   room; see §15 (catalog_grid.dart:74–83, 578–624).
4. **Active filter chips row** — only when `nsfw`, `tagIds` or `tagNames` are set;
   `_ActiveTagsRow`. See §4 (catalog_grid.dart:85–90).
5. (janitor only) `_JanitorProxyLifecycle` — non-visual lifecycle widget (catalog_grid.dart:91–93).
6. (janitor only) CF challenge WebView — occupies `0.72 × screen height` when a
   Cloudflare challenge is pending (catalog_grid.dart:94–105).
7. Error state: `Padding(all: 32)`, centered `Text(state.error)`,
   `fontSize 13, color onSurfaceVariant` (catalog_grid.dart:107–123). When the error is a
   JanitorAI auth expiry, a `JanitorSessionExpiredState` widget replaces it
   (catalog_grid.dart:106).
8. Result-count row — `Padding(EdgeInsets.fromLTRB(16, 6, 16, 6))`; while loading renders an
   empty `SizedBox(height: 11)` as a placeholder, otherwise
   `Text('${state.total} result${state.total == 1 ? '' : 's'}')`,
   `TextStyle(fontSize: 11, color: onSurfaceVariant)` (catalog_grid.dart:126–142).
   Not shown for providers `janny` / `chub` / `datacat`; those get a bare
   `SizedBox(height: 12)` spacer instead (catalog_grid.dart:125,143).
9. **Grid** — `CatalogCardGridSliver` with
   `padding: EdgeInsets.fromLTRB(16, 0, 16, bottomPadding)` (catalog_grid.dart:161–166).
   See §6. When the list is empty, not loading, and `page > 1`, the grid is replaced by the
   empty state: `Padding(top: 80)`, centered `Text('catalog_empty')` ("No characters
   found", en.json `catalog_empty`), `fontSize 14, color onSurfaceVariant`
   (catalog_grid.dart:145–159).
10. **Loading spinner** — `Padding(bottom: 24)`, centered `SizedBox(28×28)` holding
    `GlazeSpinner(color: primary)` (catalog_grid.dart:169–178).
11. **End of results** — shown when `!hasMore && results.isNotEmpty`;
    `Padding(bottom: 24)`, `Text('End of results')`,
    `TextStyle(fontSize: 12, color: onSurfaceVariant.withValues(alpha: 0.5))`
    (catalog_grid.dart:180–190).

Infinite scroll: on `ScrollEndNotification` with `metrics.extentAfter < 600` → `loadMore()`
(catalog_grid.dart:54–59). Scrollbars are suppressed
(`ScrollConfiguration…scrollbars: false`, catalog_grid.dart:62–64).

Onboarding: every build schedules `maybeShowCatalogOnboarding` post-frame (catalog_grid.dart:39–43)
— see §12.

---

## 2. Controls row components

`CatalogControls` (catalog_controls.dart:18,145–236) renders a `Row` inside one
`GlassBackdropGroup` (single shared backdrop blur for the row, catalog_controls.dart:235;
glass_surface.dart:288+):

```
[GlazeDropdownChip (provider)]  <Spacer>  [GlazeFilterIconButton]  —8px—  [sort chip]
```

DataCat provider replaces the sort chip with a labelled `GlazeActionChip` whose label is
the active time window (`datacatWindowOptions()[filters.window]`, catalog_controls.dart:143–201);
others get `GlazeSortIconChip` (catalog_controls.dart:202–226).

### 2.1 GlazeDropdownChip (provider dropdown) — `list_controls.dart:81–141`

- `MouseRegion(cursor: SystemMouseCursors.click)` + `GestureDetector` tap
  (list_controls.dart:96–99).
- `SizedBox(height: 32)` → `GlassSurface`:
  - `borderRadius: 16` (full pill) (list_controls.dart:101–104)
  - `tint: context.cs.surface` → `#19191A` at alpha 0.8
  - `border: primary.withValues(alpha: 0.18)` → `rgba(196,42,74,0.18)`
    (list_controls.dart:105–107)
  - backdrop blur sigma 12 + noise 0.03 (see §0)
- inner `Padding(horizontal: 14)`, `Row(min)` (list_controls.dart:107–138):
  - optional leading logo: `SizedBox(18×18, Center)` + `SizedBox(width: 6)`
    (list_controls.dart:110–119)
  - label text: `fontSize 13, w600, color primary` (`#C42A4A`) (list_controls.dart:120–126)
  - `SizedBox(width: 4)`
  - chevron `Icons.keyboard_arrow_down_rounded`, `size 18, primary`
    (list_controls.dart:127–132)
- Leading widget = `ProviderLogo.catalog(provider, size: 18)` (catalog_controls.dart:152) —
  bundled raster/SVG brand marks: `assets/logos/providers/{janitor,janny,datacat,chub}.png`,
  `saucepan.svg`, drawn at native colors; raster `Image.asset(fit: contain)`, SVG via
  `SvgPicture.asset` (provider_logo.dart:9–15,39–47).

### 2.2 GlazeFilterIconButton (filter button + badge) — `list_controls.dart:402–465`

- `SizedBox(32×32)`, `Stack(clipBehavior: Clip.none, alignment: center)`
  (list_controls.dart:416–420):
  - base: `GlassSurface(radius 16, tint surface, border primary a0.18)` with centered
    `Icon(Icons.filter_list_rounded, size 18, primary)` (list_controls.dart:423–435)
  - badge when `count > 0`: `Positioned(top: -2, right: -2)`,
    `Container(constraints minWidth 16 / minHeight 16, padding horizontal 4)`,
    `color: primary` (`#C42A4A`), `shape: circle`; text `$count`: `fontSize 10, w700,
    Colors.white, height 1.0` (list_controls.dart:437–461).
- Badge count logic (catalog_controls.dart:70–110): nsfw +1 (:74); NSFL +1 but only when
  the active provider is chub (:76–78); tagIds length (:79); tagNames length (:80);
  **CHANGED (was unconditional)** token-range bounds differing from 29 / 100000 are only
  counted when the provider supports a token range at all — DataCat's API takes no token
  bounds, so a stale range from another provider must not badge it
  (`supportsTokenRange(p) = p != datacat`, catalog_controls.dart:64–68,81–90); plus the 11
  chub-only refinement flags (nsfwOnly, requireImages, requireLore, requireCustomPrompt,
  requireExampleDialogues, requireAlternateGreetings, recommendedVerified, excludeMine,
  inclusiveOr, minAiRating > 0, minTags > 0) counted only for chub
  (catalog_controls.dart:92–105).

### 2.3 GlazeSortIconChip — `list_controls.dart:144–194`

- `Tooltip(message: currentSortLabel)`; `SizedBox(height: 32)` → `GlassSurface`
  (radius 16, tint surface, border primary a0.18) → `Padding(horizontal: 10)` →
  `Row(min)`: active-sort icon `size 18, primary`, `SizedBox(width: 2)`,
  chevron `keyboard_arrow_down_rounded` `size 18, primary`
  (list_controls.dart:162–188).
- Icon map (catalog_controls.dart:112–131): **CHANGED (map extended)** —
  trending→`trending_up_rounded`, **`trending_week`→`trending_up_rounded` (new key)**,
  trending_24h→`local_fire_department_rounded`, popular→`star_rounded`,
  latest/newest→`schedule_rounded`, oldest→`history_rounded`,
  tokens_desc→`arrow_downward_rounded`, tokens_asc→`arrow_upward_rounded`,
  relevant→`auto_awesome_rounded`, rating→`thumb_up_rounded`, updated→`update_rounded`,
  timeline→`timeline_rounded`; fallback `Icons.sort_rounded` (catalog_controls.dart:131–132).

### 2.4 GlazeActionChip (DataCat order chip, labelled variant) — `list_controls.dart:198–263`

Same 32-height glass pill (radius 16, tint surface, border primary a0.18,
list_controls.dart:219–226); padding `horizontal: label == null ? 7 : 12`
(list_controls.dart:229); icon 18 primary (list_controls.dart:233); with a label:
`SizedBox(width: 6)` then `Text(label)` `fontSize 13, w600, primary`, maxLines 1 ellipsis
(list_controls.dart:234–247). Tooltip: `'${_currentSortLabel()} · $datacatWindowLabel'`
(catalog_controls.dart:199).

### 2.5 Sort filter-icon interplay

Filter button and sort chip are separated by `SizedBox(width: 8)`
(catalog_controls.dart:192,209).

### 2.6 Provider / sort picker sheets

Provider chip → `showGlazePickerSheet(title: 'blacklist_glossary_chip', items: …,
headerAction: _SettingsGearButton)` — each row's leading widget is
`ProviderLogo.catalog(provider: p, size: 20)` (catalog_controls.dart:154–172). The gear
pinned to the sheet header: `IconButton(Icons.settings_outlined, size 22, color primary,
visualDensity: compact)` opening the content-providers screen
(catalog_controls.dart:241–256). Sort chip → `showGlazePickerSheet(title: 'sort_by', …)`
with per-option glyphs (catalog_controls.dart:211–226). DataCat instead opens
`showDatacatSortSheet` — one sheet, two labelled sections ("Sort by", "Time window");
sort fields fresh/score/chat_count/messages_per_chat/first_published with icons
new_releases/star/chat_bubble/forum/event_available, windows all/week/24h with icons
all_inclusive/date_range/local_fire_department; active rows carry a trailing check action
(datacat_sort_sheet.dart:10–46,51–105).

---

## 3. Search field

Two variants in `character_list_screen.dart`; which one shows depends on the shell layout:

**(a) In-strip field** — **CHANGED (placement clarified: desktop title-bar layout only, and
it leads the column above the tab bar)**. The strip exists only under the app's title bar
(Windows/desktop): `_searchInStrip = TitleBarHeaderScope.of(context)`
(character_list_screen.dart:88,338; title_bar_header.dart:23–32). It is rendered in the
header's `below` slot as a `Column([search strip, tab bar])` — strip first, tab bar after
(character_list_screen.dart:249–257). Spec parts:

- Block height `_kSearchStripBlock = 41.0`; inner field area `SizedBox(height: 41 − 1 = 40)`
  (character_list_screen.dart:104,1012).
- Strip fill: `ColoredBox(color: inputDecorationTheme.fillColor ??
  surfaceContainerHighest)` → `#1E1E1E` edge-to-edge (character_list_screen.dart:1007–1010).
- Field vertically centered (`Center`) with `isDense`, `filled: false`, all borders
  `InputBorder.none`, `contentPadding: EdgeInsets.symmetric(vertical: 10)`
  (character_list_screen.dart:1018–1063).
- Text style: `Theme.textTheme.bodyMedium` (M3 default `14px` Inter, color `onSurface`
  `#E1E3E6`) — the app-wide theme multiplies font size by `uiFontSize/15` and applies
  `uiFontWeight 400`/`uiLetterSpacing 0` defaults (character_list_screen.dart:1000;
  app_theme.dart:405–412).
- Hint: `catalog_search_placeholder` = **"Search characters..."**
  (`assets/translations/en.json`; `search_characters` = "Search characters" is the
  non-catalog tab's key). Hint style = bodyMedium with `color: onSurfaceVariant`
  `#B0B8C1` (character_list_screen.dart:1030–1035).
- Prefix icon: `Padding(left: 16, right: 10)` around `Icon(Icons.search_rounded, size: 18,
  color: primary)`; `prefixIconConstraints: BoxConstraints()` (unconstrained)
  (character_list_screen.dart:1037–1045).
- Suffix (when text non-empty): `IconButton(Icon(Icons.close_rounded, size: 16),
  padding: zero)`, constrained `BoxConstraints.tightFor(width: 40, height: 32)`
  (character_list_screen.dart:1046–1057).
- Below the strip: `Divider(height: 1, color: outlineVariant)` → 1px
  `rgba(255,255,255,0.10)` line (character_list_screen.dart:1069).
- The strip is disabled (field `enabled: false`) while Chub's Timeline — which ignores
  queries — is the active Discover feed (`locked`, character_list_screen.dart:254,1022).
- Desktop tabs row: the strip row continues into `_buildDesktopTabsRow` only when the
  strip is *not* shown; see §3c.

**(b) In-header field** (when search is expanded into the shell header — mobile/other):

- Plain `TextField` in the header title slot: `isDense`, `border: InputBorder.none`,
  `style: fontSize 16, color onSurface`; hint same size `16`, color `onSurfaceVariant`;
  `cursorColor: primary`; `autofocus: true`; `textInputAction: search`
  (character_list_screen.dart:976–993).
- The header's search *button* (collapsed state): `SizedBox(44×44)` wrapping
  `IconButton(Icon(search_rounded | close_rounded, size 22), color: primary)`
  (character_list_screen.dart:224–243). Locked (disabled) when the Chub Timeline is active
  on Discover (character_list_screen.dart:237–239).

Query debounces 400 ms before hitting the catalog provider
(character_list_screen.dart:294–300).

**(c) Desktop tabs row** (`_buildDesktopTabsRow`, character_list_screen.dart:1137–1162):
`Row([Expanded(Align(centerLeft, ConstrainedBox(maxWidth: 420, tab strip))), gap 12,
Add button (height 42)])` when on My Characters (or catalog hidden) — the Add button
rides the same row instead of floating over the grid. The Add button at height 42 is a
compact stadium: `Container(height: 42, padding h16, color primary, radius 21,
shadow black a0.3 blur 10 offset(0,4))` with `Icon(add_rounded, size 20, white)`,
`SizedBox(width: 6)`, `Text(fontSize 14, w500, white)` (character_list_screen.dart:1696–1748;
at the default height 48 it is a full `GlazeFab`, :1703–1711). Mobile keeps a full-width
strip (`EdgeInsets.only(top: 10)` above, character_list_screen.dart:1123–1126).

The tab strip above the grid (My Characters / **Discover**) is a `GlazeTabBar` **pill**
style: labels `'tab_my_characters'` = "My Characters", `'tab_catalog'` = "Discover"
(en.json; character_list_screen.dart:1164–1172); icons `person_rounded` / `public_rounded`.
Full pill spec is in §7.4 (same widget the detail page uses).

---

## 4. Active filter chips row

`_ActiveTagsRow` (catalog_grid.dart:438–565). Rendered under the controls row when any
filter is active (order: NSFW first, then names, then resolved tag ids — duplicates removed,
catalog_grid.dart:444–487).

- Container: `Padding(top: 12)` → `SizedBox(height: 28)` → horizontal `ListView`,
  `padding: EdgeInsets.symmetric(horizontal: 16)`, separator `SizedBox(width: 8)`
  (catalog_grid.dart:516–525).
- Chip: `Container(padding: EdgeInsets.symmetric(horizontal: 10))`,
  `borderRadius: 16`, `alignment: center` (catalog_grid.dart:531–548):
  - NSFW chip: bg `Color(0x33FF4444)`, border `Color(0x4DFF4444)`,
    text `Color(0xFFFF4444)` (catalog_grid.dart:534,539,553)
  - regular chip: bg `primary.withValues(alpha: 0.2)`, border `primary` (opaque),
    text `Colors.white` (catalog_grid.dart:534–535,538–541)
- Content `Row(min)`: `Text(name)` `fontSize 12` (white / `#FF4444`),
  `SizedBox(width: 4)`, `Icon(Icons.close, size: 10)` (white / `#FF4444`)
  (catalog_grid.dart:548–563). Tap removes the filter; `MouseRegion` click cursor
  (catalog_grid.dart:527–530).

---

## 5. Card component (`CatalogCard`)

`catalog_card.dart:10–121`.

### 5.1 Container + motion states

- `AnimatedContainer(duration: 300ms, curve: Curves.easeOutBack)`,
  `transformAlignment: Alignment.center` (catalog_card.dart:40–44).
- Transform: pressed → `scale 0.96`; hovered → `scale 1.01` + `translateY −4.0`;
  idle → identity (catalog_card.dart:28–29,46–47).
- Decoration (catalog_card.dart:46–60):
  - `color: surfaceContainerHighest` → `#1E1E1E` (catalog_card.dart:48)
  - `borderRadius: 16` (catalog_card.dart:49)
  - `border: Border.all(color: Colors.white.withValues(alpha: 0.15))` (catalog_card.dart:50)
  - `boxShadow`: idle `Colors.black a0.1, blurRadius 6, offset(0,4)`;
    hovered `a0.3, blurRadius 24, offset(0,12)` (catalog_card.dart:52–58)
- Inner `ClipRRect(radius 16)` → `Column(stretch)` (catalog_card.dart:61–66).

### 5.2 Image area

- `AspectRatio(aspectRatio: 2/3)`, `Stack(expand)`
  (catalog_card.dart:67–71).
- Image: `CachedNetworkImage(fit: cover)`; placeholder/error = `ColoredBox(primary a0.2)`
  with centered first letter: `Text(name[0].toUpperCase())`, `'?'` when the name is empty —
  **CHANGED (was `name[0].toUpperCase()` only)** — `fontSize 48, bold, color primary`
  (catalog_card.dart:113–120).
- NSFW blur wrapper: `NsfwBlur(enabled)` → `ClipRect` + `ImageFiltered` Gaussian
  `sigmaX = sigmaY = 16` (the `NsfwBlur` default), `TileMode.clamp` (nsfw_blur.dart:13–45;
  sigma default at nsfw_blur.dart:25). Enabled when the blur setting is on *and*
  `shouldBlurNsfwItem(item)` — nsfw, or chub nsfl (catalog_card.dart:94–99).
- **Bottom fade** `_BottomFade` (catalog_card.dart:72,128–152): bottom-aligned
  `FractionallySizedBox(heightFactor: 0.5, widthFactor: 1.0)` with vertical
  `LinearGradient(topCenter→bottomCenter): [Colors.transparent, surfaceContainerHighest (#1E1E1E)]`
  (catalog_card.dart:135–148).
- **Message badge** `_MessageBadge` (catalog_card.dart:75–79,242–278): `Positioned(top: 8,
  right: 8)`; `Container(padding h6 v4, color: Colors.black a0.6, borderRadius: 10)`;
  `Row(min)`: `Icon(Icons.mail_outline_rounded, size 12, Colors.white70)`,
  `SizedBox(width: 4)`, count text `fontSize 10, w600, Colors.white`
  (catalog_card.dart:255–277). Only when `item.messageCount > 0`. Formatted: ≥1e6 →
  `x.xkk`, ≥1000 → `x.xk`, else raw — `CatalogCard._formatNumber` (catalog_card.dart:160–163).

### 5.3 Info block `_CardInfo` (catalog_card.dart:155–239)

`Padding(EdgeInsets.fromLTRB(10, 0, 10, 12))`, `Column(stretch, min)`
(catalog_card.dart:180–183). Each block renders only when non-empty:

1. **Name**: `maxLines 2, ellipsis`; `TextStyle(fontWeight w700, fontSize 15,
   height 1.2, color Colors.white)` (catalog_card.dart:185–195).
2. `SizedBox(height: 2)` → **Creator** `@creator`: `maxLines 1, ellipsis`;
   `fontSize 11, color Colors.white.withValues(alpha: 0.7)` (catalog_card.dart:198–206).
3. `SizedBox(height: 2)` → **Tokens** — **CHANGED (was `'{n} tokens'`; now the same k/kk
   formatter as the badge)**: `'{_formatNumber(item.tokens)} tokens'` (≥1e6 `x.xkk`,
   ≥1000 `x.xk`, else raw); `fontSize 11, w600, color white a0.5`
   (catalog_card.dart:209–217).
4. `SizedBox(height: 8)` → **Tag chips** `CardTagChips(tags)` (catalog_card.dart:219–221).
5. `SizedBox(height: 8)` → **Description** (HTML stripped — `<img>` tags removed first,
   then all tags, whitespace collapsed — catalog_card.dart:166–171):
   `maxLines 3, ellipsis`; `fontSize 11, height 1.4, color white a0.55`
   (catalog_card.dart:224–233).

### 5.4 CardTagChips (`card_tag_chips.dart:9–63`)

`Wrap(spacing: 4, runSpacing: 4)`; chip = `Container(padding h8 v2,
borderRadius: context.glazeBorderRadius(8) — **CHANGED (was constant 8; now cornerScale-
aware; literal 8 at cornerScale 1.0)**, Border.all(color))` + `Text(tag)` `fontSize 10, w600`.

| Tag | bg | fg | border |
|---|---|---|---|
| `NSFW` | `#33FF4444` | `#FF4444` | `#4DFF4444` |
| `SFW` | `#334CAF50` | `#4CAF50` | `#4D4CAF50` |
| `#custom` | `#1A00FFFF` | `#00CCCC` | `#3300FFFF` |
| other | `primary a0.15` | `primary` | `primary a0.2` |

---

## 6. Grid

`CatalogCardGridSliver` (catalog_card_grid.dart:12–65):

- Outer `SliverPadding(padding)` = `EdgeInsets.fromLTRB(16, 0, 16, bottomPadding)`
  (16/16 gutters; bottom `navHeight + 20` from the shell).
- Columns: `crossAxisCount = (crossAxisExtent / 212).ceil().clamp(1, 10)` — column slots
  are **212 logical px wide** at desktop (catalog_card_grid.dart:30–32).
- Row layout: `Padding(bottom: 12)` per row → `IntrinsicHeight` → `Row(stretch)`; each card
  `Expanded` with `EdgeInsets.only(right: isLast ? 0 : 12)` → **column gap 12, row gap 12**
  (catalog_card_grid.dart:43–53).
- Empty trailing slots in the last row render `SizedBox.shrink()` (catalog_card_grid.dart:54–56).
- Grid is a `SliverList` of rows (variable card heights align row-by-row).

---

## 7. Character detail page

Opened from a card tap: `showGlazeSheet(… backgroundColor: transparent, isScrollControlled,
useRootNavigator)` wrapping `CatalogDetailLauncher` → `CharacterDetailScreen`
(catalog_grid.dart:206–216; catalog_detail_launcher.dart:566–593).
The launcher's loading/error states:

- `_LoadingView`: `Container(height: 360, color: surfaceContainerHighest (#1E1E1E),
  borderRadius vertical top 24)`, centered `GlazeSpinner(primary)`; optional phase text
  `fontSize 12, onSurfaceVariant`, gap 12 (catalog_detail_launcher.dart:644–679). For a
  JanitorAI card the phase can name the admission queue (§15).
- `_ErrorView`: same 360 container; `padding: 32`; icon (default
  `Icons.error_outline_rounded`) `size 48, onSurfaceVariant`; gap 16; message
  `fontSize 13, onSurfaceVariant`, center; gap 16; retry button
  `Container(padding h20 v10, color primary, radius 12)` with `Text(… color white,
  w600)` (catalog_detail_launcher.dart:684–741). The "visible to logged-in visitors only"
  notice reuses this view with `Icons.lock_outline_rounded` and a localized action label
  that logs in and refetches (catalog_detail_launcher.dart:532–538,504–515).

The launcher decides the JanitorAI source ("Extract JanitorAI cards with" setting):
metadata from the WebView proxy, DataCat as the fallback/primary copy of a closed
definition, local extraction only for a closed definition with source = local
(catalog_detail_launcher.dart:94–228,212–219). Import wiring: `onImport: _doImport`,
`onBeforeImport: _confirmImportPossible` — see §11
(catalog_detail_launcher.dart:588–592).

### 7.1 Sheet container (mobile modal bottom sheet)

`SheetView` (`sheet_view.dart`), shown via `showGlazeSheet` with transparent bg
(glaze_sheet.dart:71–97):

- Height: collapsed = `0.85 × screen` (overridable `collapsedFraction`;
  sheet_view.dart:266–272), expands to full (sheet_view.dart:274).
- Corner radius: top corners `context.glazeRadius(20)` — **CHANGED (was "20 constant";
  now scaled by the theme's cornerScale; literal 20 at cornerScale 1.0)** —
  `_kSheetCornerRadius = 20` (sheet_view.dart:21) applied via `context.glazeRadius(…)` at
  sheet_view.dart:1055–1077.
- Border: `glazeSheetBorder` = **top edge only**, `color: outlineVariant`
  (`rgba(255,255,255,0.10)`), painted in the *foreground* decoration
  (sheet_view.dart:1065–1075; glaze_sheet.dart:22–24).
- Fill: solid opaque `context.cs.surface` = `#19191A` (sheet_view.dart:1141–1144
  `ColoredBox(color: surface.withValues(alpha: opaque ? 1.0 : 0.8))` with `opaque: true`)
  and the body subtree is wrapped in `FlatBackdrop(color: surface)` so inner glass
  surfaces pre-composite (sheet_view.dart:1132–1140).
- Drag handle: block of vertical padding 10 + centered bar — width `36` collapsed / `24`
  expanded, height `4`, `borderRadius 2`, color `white a0.35` collapsed / `a0.6` expanded,
  `AnimatedContainer 300ms easeOutCubic` (sheet_view.dart:1399–1418).
- Pinned-header scrim: `TopEdgeBlur(height: headerH + 8, sigma: 24,
  tint: surface a0.88)` (sheet_view.dart:857–866).
- FAB slot: `Positioned(right: 16, bottom: 16 + MediaQuery.padding.bottom + bottomInset)`
  (sheet_view.dart:983–989,1209–1215).

**Desktop variant** (`showGlazeSheet`, glaze_sheet.dart:71–97): the same content opens as a
floating window: width `min(0.92 × windowW, 640)` (glaze_sheet.dart:14,297–300), height cap
`0.85 × windowH` (`kGlazeSheetWindowHeightFactor`, glaze_sheet.dart:17,301), **with
title-bar chrome** (`windowChrome` default true, glaze_sheet.dart:84), no dim barrier
(barrierColor null when chrome, glaze_sheet.dart:146–147), fade + scale(0.97→1) 180 ms
easeOutCubic entrance (glaze_sheet.dart:156,183–188). Inside a window, `SheetView` drops
its own handle/app-bar and paints transparent over the window glass (sheet_view.dart:264,
1141–1144). Chrome-less content-only windows would use `_SheetPanel`
(glaze_sheet.dart:404–434): radius `context.glazeBorderRadius(16)` (literal 16 at
cornerScale 1.0), shadow `black a0.5, blur 40, spread 4`.

### 7.2 Floating header (over the hero)

`_buildFloatingHeader` (character_detail_screen.dart:956–995): `Align(topCenter)` →
`Padding(top: safeTop + 12, left: 16, right: 16)` → `Row`:

- Back button `_DetailHeaderButton` (icon `Icons.arrow_back`), left — pops, or goes to
  `/characters` when nothing to pop (character_detail_screen.dart:966–975).
- `Spacer`.
- Kebab `_DetailHeaderButton` (`Icons.more_vert_rounded`) right — in library mode always
  (`_openActionsMenu`: export/edit/hide/variations/open-in-catalog/convert/delete);
  in preview mode only when blur can be lifted or a source URL exists (menu items: open-source
  `open_in_new_rounded`, un/re-blur `visibility(_off)_outlined`) via `GlazeBottomSheet`
  (character_detail_screen.dart:977–989,365–396).
- Button spec (character_detail_screen.dart:1042–1103): `SizedBox(40×40)` →
  `GlassSurface(borderRadius 20 → circle, tint surface (#19191A a0.8), border =
  preset.borderParsed ?? onSurface at `borderOpacity` alpha, width `borderWidth` — i.e.
  rgba(196,42,74,0.10), 1px by default, character_detail_screen.dart:75–81)` → centered
  `Icon(size 20, color primary)`. Press animation: scale `1.0 → 0.82`,
  80 ms forward / 150 ms reverse, `Curves.easeOut` (character_detail_screen.dart:1061–1069).

### 7.3 Hero

`_HeroSection` (character_detail_screen.dart:1105–1244):

- `SizedBox(height: 310, width: ∞)`, tappable → image viewer (`ImageViewer.show` with the
  hero provider + character description) (character_detail_screen.dart:1139–1160).
- Image: `CachedNetworkImage(fit: cover, alignment: topCenter)` (file image variant same);
  through `NsfwBlur` (sigma 16) when preview blur is active.
  Placeholder `_HeroPlaceholder`: `ColoredBox(Color(0x14C42A4A))`, centered initial letter
  `fontSize 64, w700, color _kText35 (0x59FFFFFF)`, `'?'` when the name is empty —
  **CHANGED (was initial only)** — (character_detail_screen.dart:1224–1243,1430–1449).
- Scrim gradient over the whole image: `LinearGradient(topCenter→bottomCenter,
  stops [0.35, 0.60, 1.0], colors [transparent, 0x33000000, 0xBF000000])`
  (character_detail_screen.dart:1165–1178).
- Caption: `Positioned(left: 16, right: 16, bottom: 16)`, `Column(start, min)`
  (character_detail_screen.dart:1179–1197):
  - optional variation chip `VariationChip(name, maxWidth: 180)` then `SizedBox(height: 6)`:
    pill = `Container(constraints maxWidth, padding h7 v1, color primary a0.14,
    borderRadius: context.glazeBorderRadius(10) — **CHANGED (was constant 10; now
    cornerScale-aware; literal 10 at cornerScale 1.0)**` + `Text` `fontSize 11, w700,
    primary`, 1 line ellipsis (character_detail_screen.dart:1187–1190;
    variation_chip.dart:14–38).
  - **Name** `_HeroName`: `TextStyle(fontSize 22, w700, white, shadows [blur 6, 0xCC000000])`
    (character_detail_screen.dart:1262–1268), capped to 2 lines
    (`_kHeroNameMaxLines`, :1262); longer names scroll top↔bottom (hold 1600 ms,
    speed 26 px/s — :1270–1274,1321–1428; honours `MediaQuery.disableAnimationsOf`,
    :1359–1365).
  - **Author** `@creator`: `fontSize 13`; tappable → `primary, w600`; plain →
    `_kText50 (0x80FFFFFF), w400`; `shadows [blur 3, 0xCC000000]`
    (character_detail_screen.dart:1204–1222). Tap opens the creator screen when the
    provider has one (`onOpenCreator`), else `previewAuthorUrl` in the browser
    (character_detail_screen.dart:854–862; catalog_detail_launcher.dart:599–641).

### 7.4 Tab strip

`Padding(EdgeInsets.fromLTRB(16, 16, 16, 8))` wrapping `GlazeTabBar` (pill style)
(character_detail_screen.dart:865–871). Tabs: **Info** (`info_outline_rounded`),
**Prompt Blocks** (`description_outlined`), **Images** (`photo_library_outlined`)
(character_detail_screen.dart:87–97).

`PillTabStrip` (glaze_tab_bar_strips.dart:22–189):

- Track: `SizedBox(height: 42)` → `GlassSurface(borderRadius 21, tint surface,
  border primary a0.18)` (full pill, glass recipe §0)
  (glaze_tab_bar_strips.dart:168–184).
- Active pill: `AnimatedPositioned(250ms easeOutCubic)`, inset `top: 3, bottom: 3`,
  `Padding(horizontal: 3)` → `GlassSurface(borderRadius 18, tint primary (#C42A4A, a0.8),
  border white a0.14)` (glaze_tab_bar_strips.dart:97–115).
- Tab content: `Row(center)`: `Icon(size 18)`, `SizedBox(width: 8)`,
  `Text(fontSize 14, w600, maxLines 1, ellipsis)`; active → white, inactive → `primary`
  (glaze_tab_bar_strips.dart:118–151).
- Tab width: `viewport / visible` where `visible = tabs.length < 2.35 ? tabs.length : 2.35`
  — the equal-width budget `_kVisibleTabs = 2.35` (glaze_tab_bar_strips.dart:19,84–89); with
  3 tabs the strip scrolls horizontally and the active tab auto-reveals (250 ms
  easeOutCubic, glaze_tab_bar_strips.dart:58–75); with ≤ 2 tabs the strip swipe itself
  switches tabs (`SwipeTabSwitcher(enabled: !_scrolls)`, glaze_tab_bar_strips.dart:162–167).
- Body swipe changes tabs (`SwipeTabSwitcher`/`TabSlideSwitcher` around the content,
  character_detail_screen.dart:873–881).

### 7.5 Info tab

- **Tag chips** `_TagChip` (character_detail_screen.dart:1699–1736), in
  `Padding(LTRB(16, 8, 16, 0))` + `Wrap(spacing: 6, runSpacing: 6)`
  (character_detail_screen.dart:1500–1508):
  chip = `Container(padding h9 v3, borderRadius 10, Border.all)` + `Text(fontSize 11,
  w600)`. Colors: `NSFW` bg `0x33FF4444` / fg `0xFFFF4444` / border `0x4DFF4444`;
  `SFW` bg `0x334CAF50` / fg `0xFF4CAF50` / border `0x524CAF50`; `#custom` bg `0x1A00FFFF` /
  fg `0xFF00CCCC` / border `0x3300FFFF`; other bg `_kAccentDim 0x1FC42A4A` /
  border `_kAccentBorder 0x33C42A4A` / fg = `primary` (tokens at :61–73).
- **Description label**: `Padding(LTRB(16, 16, 16, 6))`, `Text(uppercase)`
  `fontSize 11, w600, letterSpacing 0.77, color _kText35 (0x59FFFFFF)`
  (character_detail_screen.dart:1509–1521).
- **Bio block** `_BioMarkdown` (character_detail_screen.dart:1548–1634), inside
  `Padding(LTRB(16, 0, 16, 4))` (character_detail_screen.dart:1522–1531): container
  `padding: 16`, `color: 0x7B000000`, `borderRadius: 8`,
  `border: Color(0x1A8B5CF6)` (matches JanitorAI's `.characterInfoMarkdownContent`);
  text `GptMarkdown` `fontSize 13.5, height 1.55, color _kText75 (0xBFFFFFFF)`
  (character_detail_screen.dart:1573–1576,1613–1621); segments separated by
  `SizedBox(height: 8)` (:1622–1629); the whole bio sits in a `SelectionArea`
  (:1612). HTML is converted to markdown and split into per-`text-align` segments
  (:1606–1609). Bio images: `ClipRRect(radius 8)`, `fit: contain`, through `NsfwBlur`
  when enabled (character_detail_screen.dart:1640–1697).
- Empty fallback: centered `Padding(all: 40)`, `Text('no_preview_available',
  color _kText35)` (character_detail_screen.dart:1533–1542).
- Folded-in **section headers** `_TabSectionHeader`
  (character_detail_screen.dart:1456–1482): `Padding(LTRB(16, 24, 16, 4))`,
  `Icon(size 15, primary)`, `SizedBox(width: 8)`, `Text(uppercase)`
  `fontSize 11, w700, letterSpacing 0.77, primary`. Used for Community
  (`forum_outlined`, DataCat previews only), Comments (`forum_outlined`, JanitorAI
  previews only) under Info (:913–932), and Lorebooks (`menu_book_outlined`) under
  Prompt Blocks (:944–950).

**Comments section (JanitorAI previews)** — `CatalogCommentsView`
(catalog_comments_section.dart:22–99; full spec §13). Comment cards and paging footer are
specified in §13; pages load lazily at `maxScrollExtent − 600`
(character_detail_screen.dart:304–338) with page size 20
(janitor_provider.dart:431).

### 7.6 Prompt Blocks tab

Accordion cards (`_PromptsTab`, character_detail_screen.dart:1740–1824). Sections in order:
Description, Personality, Scenario, Appearance, Message Example, System Prompt,
Post-History Instructions (both system-role label; non-empty only, :1751–1786), then one
**First Messages** card (:1805–1819) with a count badge only when there is more than one
greeting (:1860–1872); with a single greeting its row is always expanded (:1862,1888).

- **Card shell** `_AccordionShell` (character_detail_screen.dart:1996–2013):
  `margin LTRB(16, 16, 16, 0)`, `color _kSurface (0x0DFFFFFF)`, `borderRadius 16`,
  `border _kBorderLine (0x0DFFFFFF)`.
- **Header** `_AccordionHeader` (character_detail_screen.dart:2017–2087): tap row
  `Padding(LTRB(16, 14, 12, 14))`; label uppercase `fontSize 13, w600, letterSpacing 0.65,
  primary`; optional count badge (`Container(padding h7 v2, radius 8, bg _kAccentDim,
  border _kAccentBorder)`, text `fontSize 11, w700, primary`) + `SizedBox(width: 8)`;
  chevron `Icons.keyboard_arrow_up_rounded, size 24, color _kText50`, rotated `0.5 turns`
  when closed, `AnimatedRotation 280ms easeOutCubic`.
- **Body** `_CollapsibleText` (character_detail_screen.dart:2091–2140):
  `AnimatedCrossFade(280ms, sizeCurve easeOutCubic)`.
  - Closed: 3-line taste `maxLines 3, overflow clip`, `fontSize 13.5, height 1.55, color
    _kText75`, `Padding(LTRB(16, 0, 16, 14))`, faded by a `ShaderMask` linear gradient
    (stops `[0.45, 1.0]`, white → transparent, `BlendMode.dstIn`).
  - Open: selectable text, same style, `Padding(LTRB(16, 0, 16, 16))`.
- **First Messages card** (:1842–1961): per-message row = `Divider(height: 1, thickness: 1,
  color _kBorderLine)` + `Padding(LTRB(16, 12, 12, 10))` with label
  `'First message #N'` — `fontSize 12, w600, letterSpacing 0.5, color _kText50` — and
  chevron (`keyboard_arrow_up_rounded, size 20, _kText35`, `AnimatedRotation 280ms`).
- Trailing spacer at tab end: `SizedBox(height: 16)` (character_detail_screen.dart:1820).

### 7.7 Images tab

`CharacterGalleryView(shrinkWrap: true)` inside the same scroll body; in preview mode the
entries come from the in-memory card instead of a DB query
(character_detail_screen.dart:889–901).

### 7.8 Floating "Import to library" FAB

`_ImportFab` → `GlazeFab(icon: Icons.download_rounded, label: 'catalog_import' |
'catalog_import_busy', subtitle: janitorPhaseLabel(phase), busy: importing)`
(character_detail_screen.dart:1015–1038) — **CHANGED (was `label: 'catalog_import' |
phase`; the phase now rides the FAB's new `subtitle` line under the label, and the busy
label is its own key `catalog_import_busy` = "Importing character")**.
Library mode instead shows `_ChatFab` = `GlazeFab(icon: chat_bubble_rounded, label:
'Open chat')` (character_detail_screen.dart:1000–1013).

`GlazeFab` spec (glaze_fab.dart:13–148):

- Height **56** (`_height`, :38); with a label a **stadium pill** (`StadiumBorder`), padding
  `left: 18, right: 22`; without label a 56 circle (:48–54,63–68).
- Border: `Colors.white.withValues(alpha: 0.18)` stadium side (:48–54).
- Content `Row(min)`: icon `size 22` (28 when icon-only; busy → `SizedBox(22)` spinner,
  `glow: false`) (:56–61), `SizedBox(width: 10)`, label `Text(fontSize 15, w700,
  maxLines 1, ellipsis)` (:79–88); **NEW `subtitle`** when set: second line under the label,
  `fontSize 12, w500, color glyph a0.75`, maxLines 1 ellipsis (:89–99).
- Fill: `Material(color: accent)` (`#C42A4A`); busy → `accent a0.7`; disabled → whole
  button at `AnimatedOpacity 0.5` (150 ms; `busy` keeps opacity 1) (:110–112,132–135).
- Glyph color: white if accent luminance is dark, else black
  (`estimateBrightnessForColor`) (:42–46).
- Shadows (two, under the same ShapeDecoration):
  1. `Colors.black a0.55, blurRadius 28, spreadRadius 2, offset(0, 10)`
  2. `accent a0.4, blurRadius 24, offset(0, 4)` (accent bloom) (:114–131)
- Press: Material `InkWell`, splash = glyph a0.15, highlight = glyph a0.08 (:136–141).
- Body content bottom clearance above the FAB: `SizedBox(height: 100 + safeBottom)`
  (character_detail_screen.dart:882).

---

## 8. Picker sheet (provider / sort pickers)

`showGlazePickerSheet` (`list_controls.dart:38–77`) builds `GlazePickerItem`s into a
`GlazeBottomSheet.show`:

**Mobile** — `GlazeBottomSheet.show` routes to `showGlazeSheet(useRootNavigator,
useSafeArea, backgroundColor transparent, barrierColor Colors.black54, enableDrag: !locked,
isScrollControlled)`; on desktop the same call opens a **content-sized, chrome-less
floating window** (`windowContentSized: true, windowChrome: false`,
glaze_bottom_sheet.dart:308–321). A plain items list *without* `headerAction`/`source`
routes to `showDesktopPopup` instead on desktop (glaze_bottom_sheet.dart:267–306) — the
provider picker carries a gear `headerAction`, so it keeps the window form.

- Container `GlazeBottomSheetFrame` (glaze_bottom_sheet.dart:348–401):
  `ConstrainedBox(maxHeight: 0.95 × screen)` → `FlatBackdrop(surface #19191A)` →
  `GlassSurface(borderRadius vertical top 24 (or 16 inside a window), border = in-window
  Border.all(outlineVariant) | glazeSheetBorder (top outlineVariant), borderOnTop: true)`;
  Column: handle bar then content. Fill resolves opaque (≈ `#1D1D1E`), **no blur** on the
  sheet body.
- **Handle** `_HandleBar` (glaze_bottom_sheet.dart:1015–1032): `Padding(vertical: 10)` +
  centered `Container(width 32, height 4, color white a0.35, radius 2)`.
- **Header** `_Header` (glaze_bottom_sheet.dart:1034–1096): `Padding(LTRB(20, 0, 12, 16))`,
  title `fontSize 18, w700, onSurface (#E1E3E6)`; trailing `headerAction` — the provider
  picker pins the gear button (§2.6); a plugin `source` renders an
  `extension_outlined` 13px + `fontSize 12` line under the title (:1051–1089).
- **Body list** `_ItemsList` (glaze_bottom_sheet.dart:1108–1217): one group card per run of
  same-`section` items = `Padding(LTRB(16, 0, 16, 16))` → `Container(color white a0.06,
  border white a0.1, borderRadius: context.glazeBorderRadius(16) — literal 16 at
  cornerScale 1.0, clip antiAlias)`; rows separated by `Divider(height: 1, thickness: 1,
  color white a0.06)` (:1164–1169,1188–1204). A section label renders as
  `_SheetSectionLabel`: `Padding(LTRB(16, 8, 16, 8))`, uppercase `fontSize 12, w600,
  onSurfaceVariant, letterSpacing 0.6` (:1486–1506).
- **Row** `_ItemRow` (glaze_bottom_sheet.dart:1219–1298): `GestureDetector` with press
  state (`AnimatedContainer 100ms`, pressed bg `white a0.08`), padding
  `EdgeInsets.symmetric(horizontal: 16, vertical: 14)`; `Row`:
  - leading `iconWidget` in `SizedBox(22×22)` **or** `Icon(size 22)`; icon color for
    picker items = `primary` when active or when it's the fallback check, else
    `onSurfaceVariant` (list_controls.dart:51–66); `SizedBox(width: 16)`
  - label `_ItemLabel` `Text(fontSize 16, color onSurface)` (destructive → `#FF4444`);
    with `hint`: label 16 + `SizedBox(height: 2)` + hint `fontSize 12,
    onSurfaceVariant` (glaze_bottom_sheet.dart:1456–1481)
  - trailing actions: for the active picker row, a check chip `Padding(all: 8)` around
    `Icon(Icons.check_rounded, size 22, primary)` (:1274–1292).
  - Non-active rows with a leading glyph show **no** trailing check; rows *without* a
    leading widget get `icon: Icons.check_rounded` only when active (list_controls.dart:51–57).
- Haptics: `Haptics.selectionClick()` on tap (glaze_bottom_sheet.dart:1237–1241).

**Desktop** — a plain picker list routes to `showDesktopPopup` instead
(glaze_bottom_sheet.dart:281–306), `desktop_popup.dart`:

- Panel: width **240** (default param, desktop_popup.dart:81), anchored at last
  pointer-down (`lastPointerDownPosition`, tracked by `PointerPositionTracker`,
  desktop_popup.dart:10–26,79–80), flips across and clamps with a **12 px** viewport margin
  (`_gap`, desktop_popup.dart:188,214–231); entrance fade + scale(0.96→1, topLeft) 140 ms
  (desktop_popup.dart:124,152–164).
- `GlassSurface(borderRadius 12, border outlineVariant, boxShadow black a0.35,
  blurRadius 24, spreadRadius 1)` (desktop_popup.dart:246–260) (glass recipe §0).
- Optional title: `Padding(LTRB(14, 12, 14, 8))`, `fontSize 12, w600, onSurfaceVariant` +
  `Divider(1px, outlineVariant)`; `SizedBox(height: 4)` top/bottom around rows
  (desktop_popup.dart:263–286).
- Row `_PopupRow` (desktop_popup.dart:295–350): `Padding(h14 v9)`, `HoverGlow` hover;
  leading `iconWidget` in `SizedBox(18×18)` or `Icon(size 18)` + `SizedBox(width: 10)`;
  label `fontSize 14, onSurface` (destructive → `error #CF6679`); hint `fontSize 11,
  onSurfaceVariant`; trailing action icons `size 18` with `SizedBox(width: 8)`.

---

## 9. Cross-cutting interactions summary

- Every tappable glass control uses `MouseRegion(cursor: SystemMouseCursors.click)`
  (theme also forces hand cursors onto all Material buttons app-wide,
  app_theme.dart:200–251).
- Loading indicators are `GlazeSpinner` (glaze_spinner.dart): tapered accent arc, cycle
  1600 ms (:65), sweep 0.08–0.82 turns (:68–69), default diameter = its box (28×28 in the
  grid, :169–178), stroke `diameter × 0.115 (clamped 1.8–12)` (:249–250), faint track
  `color a × 0.12` (:102), two halo passes (width ×2.2 a0.08, ×1.5 a0.14, :239–240) + head
  bloom (radial `a0.35` over `radius stroke×2`, stops [0.2, 1], :298–320); `glow: false`
  available for tiny/dense rows (:50–52).
- Toast after import: `GlazeToast.show(context, 'Imported ${item.name}')`
  (catalog_grid.dart:218) — full styling in §10.
- After import, default behavior navigates to `/characters?open=<id>`
  (`openCardAfterImport` setting, default true — app_settings_provider.dart:189;
  catalog_grid.dart:220–228).

---

## 10. GlazeToast (post-import toast) — NEW SECTION

File: `lib/shared/widgets/glaze_toast.dart`. Catalog import uses
`GlazeToast.show(context, 'Imported ${item.name}')` (catalog_grid.dart:218), i.e. all
defaults.

**Invocation defaults** (glaze_toast.dart:28–51): `duration 2500 ms`,
`position ToastPosition.bottom`, `isError/isWarning false`, `showCopyButton false`,
`source null`. Variants: `warning()` — 3500 ms amber (:121–134); `error()` — 4000 ms top
(:149–158); `errorWithCopy()` — 8000 ms top + copy chip (:160–170). A new toast replaces
the current one (:63); only one toast lives at a time (:92).

**Placement / motion** (`_ToastAnimator`, glaze_toast.dart:266–377):

- Overlay-positioned full-width; the chip is horizontally centered.
- Bottom position: `bottom = padding.bottom + 80 + 24`; top position:
  `top = padding.top + 56 + 16` (:338–341).
- Enter: 300 ms, opacity easeOut 0→1, scale 0.85→1 with overshoot curve
  `Cubic(0.34, 1.56, 0.64, 1)`, translate ±20 px (from below for bottom, above for top),
  same curve (:273–300).
- Leave: 250 ms `animateBack(0, curve: easeIn)` (:319–331,275).
- Countdown starts when the chip is first on screen (:304–309).

**Chip** (`_ToastChip`, glaze_toast.dart:405–551):

- Radius: `context.glazeBorderRadius(24)` (literal 24 at cornerScale 1.0) with a
  `BackdropFilter` blur `sigma 12` (dropped under battery saver → opaque fill)
  (:432–439).
- Fill: normal `Color(0xC21E1E1E)` (opaque variant `0xE61E1E1E`); error
  `0xC25C1A1A`; warning `0xC2F5B301` (:449–458).
- Border: `Color(0x59A0A0A0)` 1px on every toast (:409,467).
- Shadow: `Color(0x401A1A1A), blurRadius 20, offset(0,4)` (:469–475).
- Constraints: `maxWidth = screen width − 48`; padding
  `EdgeInsets.fromLTRB(20, 10, 20, 10)` (right 8 when a copy chip is shown) (:460–464).
- Text: `fontSize 13, w500, height 1.3, color white` (warning → `Color(0xFF2A1E00)`)
  (:514–524). Optional `source` line: `fontSize 10, w500, color a0.5`, right-aligned under
  the text (:526–551).
- Copy chip (only `showCopyButton`): `padding h10 v4`, bg `white a0.33` (warning:
  `0x332A1E00`), radius `glazeBorderRadius(12)`, text `fontSize 11, w600`; toggles
  Copy/Copied (:482–507).

---

## 11. Import flow from the UI — NEW SECTION

### 11.1 From the detail preview (catalog card → library)

Tap Import FAB → `_handleImportTap` (character_detail_screen.dart:651–663):

1. No-op while `importing`; then `onBeforeImport` gate runs first —
   `_confirmImportPossible` (catalog_detail_launcher.dart:517–528): if JanitorAI forbids
   proxy capture (`allow_proxy: false` or a prior refusal), a `JanitorRefusedSheet`
   explains and offers "import anyway"; declining aborts.
2. If the character has attached lorebooks (JanitorAI meta carries lorebook scripts), an
   **Import options** bottom sheet opens — `GlazeBottomSheet.show(title: 'Import options')`
   with three rows: **Character + lorebooks** (`auto_stories_outlined`), **Character only**
   (`person_outline_rounded`), **Lorebooks only** (`menu_book_outlined`), each with a hint
   line; otherwise the import starts immediately in `CatalogImportMode.character`
   (character_detail_screen.dart:665–698,281–283).
3. `_doImport` (catalog_detail_launcher.dart:333–438): lorebooks-only mode opens the
   JanitorAI lorebook capture sheet instead of importing; "character + lorebooks" opens
   the capture sheet over the preview while the character import runs
   (catalog_detail_launcher.dart:388–401). Import errors route to a session-expired login
   sheet (JanitorAuthException), a refusal sheet, or `GlazeErrorDialog`
   (:407–437).
4. On success the preview sheet pops with the imported character id
   (catalog_detail_launcher.dart:404–406); the grid then shows the toast (§10) and
   navigates to `/characters?open=<id>` when `openCardAfterImport` is on
   (catalog_grid.dart:220–228).

### 11.2 From the Add sheet URL import (`ImportUrlDialog`)

Reachable from My Characters' Add sheet → "Import with JanitorAI" (opens as
`GlazeBottomSheet.show(title, child: ImportUrlDialog)`,
character_list_screen.dart:1213–1224). Contents (import_url_dialog.dart:53–118):

- `Padding(LTRB(16, 0, 16, 16))`; caption label `placeholder_janitor_url` text
  `fontSize 14, onSurfaceVariant`, `Padding(left: 4, bottom: 12)`;
  `GlazeTextField(autofocus: true, hint 'https://...')` (theme-filled field, §0).
- Loading row: 20×20 `GlazeSpinner(primary)` + `SizedBox(width: 12)` + phase text
  `fontSize 13, onSurfaceVariant` (`catalog_phase_label` with the phase name, or
  `catalog_extracting`).
- Error: `GlazeErrorBlock` — `Container(color #FF3B30 a0.1, border #FF3B30 1px, radius
  glazeBorderRadius(8))` with a header strip (`color #FF3B30 a0.2`, padding
  `LTRB(12, 6, 6, 6)`, label `fontSize 10 bold letterSpacing 1` + copy icon 14) and a
  monospace message `fontSize 12, height 1.4, color #FFB3B3` (glaze_error_block.dart:36–37,41–92).
- Action: `GlazeActionButton(icon download_rounded, label 'action_import_by_link' /
  'catalog_importing', tone primary, expand, busy)` — GlassSurface pill radius 14, tint
  `primary a0.18`, border `accent a0.22`, padding `h14 v10`, icon 16, label `fontSize 13,
  w600` accent-colored, disabled `Opacity 0.4` (glaze_action_button.dart:59–105).

Routing by URL host (import_url_dialog.dart:120–158,241–267): janitorai.com / jannyai.com /
chub.ai (+ characterhub.org) links open the corresponding **catalog card preview** (same
sheet + toast + `?open=` navigation as a grid tap, but the toast text is the literal
`'Imported'`, import_url_dialog.dart:689–759); pygmalion.chat / risuai / perchance /
aicharactercards / saucepan links import straight into the library with an
`Imported …` toast (import_url_dialog.dart:142–158,451–471,657).

---

## 12. Catalog onboarding sheet — NEW SECTION

File: `catalog_onboarding_sheet.dart`. Triggered once ever on the Discover tab:
`maybeShowCatalogOnboarding` checks `SharedPreferences` key `catalog_onboarding_shown`,
sets it up front (dismissed runs never reappear), then `GlazeBottomSheet.show(child:
CatalogOnboardingSheet)` — dismissible, no title, the `child` form of the sheet
(:20–50,39–46; glaze_bottom_sheet.dart:221,308–342). Re-openable from Content providers
(`replayCatalogOnboarding`, :49–50).

Content is a `GlazeStepperSheet` (glaze_stepper_sheet.dart:43–146): padding
`LTRB(20, 14, 20, 24)`; AnimatedSwitcher 280 ms slide (`±0.08` width) + fade between steps;
`SizedBox(height: 20)` then the nav row (Back / Skip / Next / Start labels). Step title
`fontSize 22, w700, height 1.2`; body `fontSize 15, height 1.5`; progress dots: 6 px
circles (18×6 pill for the active one), colors `primary a0.22 / a0.35 on accent steps`
(glaze_stepper_sheet.dart:245–299).

Steps (:80–115): 1) Welcome — 72×72 icon bubble (`primary a0.12` circle, icon 36 primary,
:306–322) + the four provider logos at size 30 in a row with 14 px gaps (:123–144);
2) Sources — provider toggle rows; 3) Chub NSFL unlock (only if chub enabled); 4) JanitorAI
source choice (only if janitor enabled); 5) JanitorAI login (only when source = local).

Sub-widgets:

- Provider toggle row (:324–389): `Container(padding LTRB(12, 10, 8, 10), color white
  a0.05, radius 16, border white a0.08)`; logo 26 (top-padded 2), gap 12, name `fontSize
  15, w600, onSurface`, gap 2, description `fontSize 13, height 1.4,
  onSurfaceVariant`; `GlazeSwitch` right.
- Source option row (:391–475): `AnimatedContainer(150ms, padding 14, radius 16)`; selected
  → `accent a0.12` bg + accent 1.5px border, else `white a0.05` + `white a0.1` 1px; icon
  slot 24×24 (logo 22 or icon 22 `onSurfaceVariant`), gap 12, title `fontSize 15, w600,
  onSurface`, gap 3, description `fontSize 13, height 1.4, onSurfaceVariant`; trailing
  radio icon 22 (checked/unchecked, accent / `onSurfaceVariant`).
- Signed-in row (:477–507): `Container(padding h14 v12, color primary a0.1, radius 14)`,
  `check_circle_rounded` 20 primary, gap 10, text `fontSize 14, onSurface`.
- NSFL switch row (:509–557): `Padding(vertical: 6)`; title `fontSize 15, w600,
  onSurface`, description `fontSize 12, onSurfaceVariant`, `GlazeSwitch`.

---

## 13. Catalog comments section (JanitorAI preview Info tab) — NEW SECTION

File: `catalog_comments_section.dart`. Color tokens (:10–14): `_kSurface 0x0DFFFFFF`,
`_kBorderLine 0x14FFFFFF`, `_kText75 0xBFFFFFFF`, `_kText50 0x80FFFFFF`,
`_kText35 0x59FFFFFF`.

- List: `Column(stretch)`; each card `Padding(LTRB(16, 0, 16, 10))` (:42–47).
- **Comment card** (:142–189): `Container(padding LTRB(14, 12, 14, 12), color _kSurface,
  radius 16, border _kBorderLine — pinned comments get `primary a0.28`)`. Header row:
  avatar 34 (circle, CachedNetworkImage cover; fallback circle `0x14C42A4A` with initial
  `fontSize 15, w700, _kText50`, :284–332), gap 10, author line, optional pinned pin icon
  (`push_pin_rounded` 14 primary, left pad 6). Author line: name `fontSize 13.5, w700,
  white` (1 line ellipsis); verified badge icon `verified_rounded` 13 primary (left pad 4);
  PLUS badge: `Container(padding h5 v1, color 0x33FFC107, radius 6)` with text `fontSize
  8, w800, letterSpacing 0.5, color 0xFFFFC107` (:190–249); `@username` line `fontSize 11,
  _kText35`. Body: `SelectableText` `fontSize 13.5, height 1.5, _kText75` after a 10 px
  gap. Meta row (:255–279): heart icon 13 `_kText50`, gap 4, like count `fontSize 11.5,
  _kText50`, gap 14, comment icon 13, gap 4, reply count 11.5; right-aligned relative time
  `fontSize 11, _kText35`.
- **Footer** (:50–99): first-load error → `_FooterError` (`Padding(v24 h16)`, message
  `fontSize 13, _kText50` centered, gap 12, retry pill `Container(padding h18 v9, color
  primary, radius 12)`, text white w600, :102–140); loading → 22×22 `GlazeSpinner(primary)`
  centered, `vertical 40` before any cards / `16` after (:59–73); empty → `Padding(all:
  40)` "No comments yet" `_kText35` (:74–85); end → `Padding(vertical: 18)` "That's all"
  `fontSize 12, _kText35` (:86–93); hasMore-but-idle → `SizedBox(height: 24)` placeholder
  (:94–99).

DataCat previews show the interactive community section instead
(`DatacatCommunitySection`, character_detail_screen.dart:913–919) — its composer/account
UI is out of scope here.

---

## 14. Catalog creator screen — NEW SECTION

Files: `catalog_creator_screen.dart` (UI), `services/catalog_creators.dart` (feed).

Opening (:34–55): desktop → `showGlazeSheet(windowSize: Size(1180, 820), windowTitle:
creatorName)` — a titled floating window; other platforms → full-screen `MaterialPageRoute`
pushed on the root navigator. Only sources with creator pages offer it: DataCat (by
`creatorRef`), JanitorAI (by `creatorId`), Chub (username); **JannyAI has none**
(catalog_creators.dart:65–95). The hero author line opens it when available
(catalog_detail_launcher.dart:599–613).

Layout (:181–241): `GlazeScaffold(title, showBackground, extendBodyBehindHeader)`;
`topPad = inWindow ? 8 : padding.top + 74`; `bottomPad = padding.bottom + 20`. Error with
no items → `GlazeErrorBlock.fromError` in `Padding(LTRB(16, topPad+16, 16, bottomPad))`.
Wide screens (`maxWidth ≥ 860`): left profile column `SizedBox(width: 300)` with
`SingleChildScrollView(padding LTRB(16, topPad+8, 0, bottomPad))` beside the grid; narrow:
profile header above the grid (:24–26,202–239).

Grid (:244–265): `CustomScrollView` — top spacer `topPad + 8`, optional profile header,
`CatalogCardGridSliver` (§6, default padding), loading `Padding(vertical: 24)` +
`GlazeSpinner(primary)`, bottom spacer `bottomPad`. Infinite scroll at
`maxScrollExtent − 600`; a short page keeps loading until the viewport overflows
(:104–108,170–179).

Profile header (`_ProfileHeader`, :268–401): `GlassSurface(radius 16)` + `Padding(all
16)` (20 vertical); horizontal identity row = avatar 48 (circle; fallback
`surfaceContainerHighest` with initial `fontSize 48×0.375, w700, onSurfaceVariant`,
:403–443), gap 12, name `fontSize 17, w700, onSurface` (vertical column form: 19) +
`verified_rounded` 16 primary after a 6 px gap; `@handle` `fontSize 12,
onSurfaceVariant` when it differs from the name; about text `SelectableText(fontSize 13,
height 1.4, onSurfaceVariant)` after a 12/16 px gap; stats row — `Wrap(spacing 16,
runSpacing 6)` (vertical form: stacked, 8 px apart) of `_Stat`: icon 14 +
`SizedBox(width: 5)` + `'$value $label'` `fontSize 12, onSurfaceVariant` (:445–469).
Stats: characters (`person_outline_rounded`), followers (`favorite_border_rounded`),
chats (`chat_bubble_outline_rounded`), messages (`forum_outlined`) — only when the source
reports them (:308–333).

Opening a card opens the same `CatalogDetailLauncher` sheet (§7) at the feed's provider
(:159–168).

---

## 15. JanitorAI queue / session-expired / Cloudflare states — NEW SECTION

- **Queue banner** (`_JanitorQueueBanner`, catalog_grid.dart:578–624): janitor-only sliver
  under the controls row; `Padding(LTRB(16, 10, 16, 0))` → `Container(padding h12 v10,
  color surfaceContainerHighest (#1E1E1E), radius 12, border outlineVariant)`;
  `Icon(hourglass_top_rounded, 18, primary)`, gap 10, text `fontSize 12,
  onSurfaceVariant` ("JanitorAI is in queue. Glaze will continue automatically." / with
  estimated wait, en.json `catalog_janitor_queue(_wait)`).
- **Loading phase text**: the detail preview's `_LoadingView` (§7) shows the queue message
  in place of the spinner caption while the proxy waits
  (catalog_detail_launcher.dart:547–564).
- **Session expired**: an auth error during browse swaps the error sliver for
  `JanitorSessionExpiredState` (catalog_grid.dart:106; widget in
  `janitor_session_expired_state.dart`); during import the preview opens the login sheet
  and retries after a successful login (catalog_detail_launcher.dart:410–422).
- **Cloudflare challenge**: an in-app `InAppWebView` (about:blank → janitorai.com with a
  clean cookie store, UA pinned to the proxy's agent) occupies
  `SizedBox(height: 0.72 × screen)` until `cf_clearance` is minted; then the sliver
  disappears and the search proceeds (catalog_grid.dart:94–105,196–372).

---

## 16. Data fields the UI reads (models + Chub mapping) — NEW SECTION

### 16.1 `CatalogItem` (catalog_models.dart:6–38)

`id, name, avatarUrl, description, tags (List<String>), tokens, chatCount, messageCount,
creator, creatorId, nsfw, nsfl, slug, source, fullPath, creatorRef, sourceKind`.
UI usage: grid card uses name/avatarUrl/description/tags/tokens/creator/messageCount;
`shouldBlurNsfwItem` uses `nsfw`/`nsfl`; launcher uses `id, slug, fullPath, creatorId,
creator, creatorRef, sourceKind`; chub detail uses `fullPath`.

`CatalogFilters` (catalog_models.dart:40–71): `sort ('trending' default), nsfw, nsfl,
tagIds, tagNames, excludeTagNames, minTokens 29, maxTokens 100000`, plus chub-only flags
(nsfwOnly, requireImages, requireLore, requireCustomPrompt, requireExampleDialogues,
requireAlternateGreetings, recommendedVerified, excludeMine, inclusiveOr, minAiRating,
minTags) and `window ('all' — DataCat only)`. Provider state (`CatalogState`,
catalog_provider.dart:43–63): `results, loading, error, janitorSessionExpired, page,
hasMore, query, total, activeProvider, filters, nextOffset`; page size **24**
(catalog_provider.dart:26); per-provider persisted keys `gz_catalog_provider`,
`gz_catalog_filters_<provider>`, `gz_catalog_sort`
(catalog_provider.dart:27–34); sort defaults janitor `trending`, janny `newest`, datacat
`fresh`, chub `popular` (catalog_provider.dart:36–41).

### 16.2 Chub search response → `CatalogItem` (services/chub_provider.dart)

Search endpoint `GET https://api.chub.ai/search` with params: `first=<24>, page,
sort=<field>, nsfw, nsfl (filters.nsfl || account NSFL), include_forks=true, min_tokens,
venus=false`, optional `max_days_ago` (trending windows), `search`, `username` (creator
feed), `max_tokens` (only when < 100000), `topics=` / `excludetopics=` (comma-joined tag
names), and the chub-only flags as their own params (:206–247). Headers
`CH-API-KEY`/`samwise` when an account key is set (:14–25).

Response fields used (`_normalizeNode`, :322–349): `fullPath` (id + creator prefix),
`name` ('Unknown' fallback), `avatar_url`/`max_res_url` (fallback
`https://avatars.charhub.io/avatars/<fullPath>/avatar.webp`), `tagline` → card
`description`, `topics` (a `nsfw` topic → 'NSFW' first tag, else 'SFW'; both 'nsfw' and
'sfw' stripped from the shown tags), `nTokens`/`n_tokens`, `nChats`/`n_chats`,
`nsfw`/`is_nsfw`, `nsfl`/`is_nsfl`. `messageCount` is **not** set → no message badge on
chub cards. Total from `data.count` (capped at 100000) or `data.total`; `hasMore` from a
`cursor` (:248–257).

Character detail (`chubGetCharacter`, :307–320): `GET /api/characters/<fullPath>?full=true`;
`chubCharacterData` (:353–388) maps `definition`: `personality` → card `description`
(Chub's body text), `tavern_personality` → `personality`, `description` (or `tagline`) →
`creatorNotes`, `scenario`, `example_dialogs` → `mesExample`, `system_prompt`,
`post_history_instructions`, `first_message` + `alternate_greetings` (normalized so the
primary greeting is never empty — greeting_normalizer), `embedded_lorebook` →
`characterBook`.

Tag suggestions: `POST /tags` (`limit 40`, `sort: n_projects`) for the filter sheet's
search; the standing tag list is the 500 most-used tags with a sampled-results fallback
(:37–65,73–140).

### 16.3 Import result

`CatalogSearchResult { characters, total, hasMore, nextOffset }`
(catalog_models.dart:102–121) — `nextOffset` carries DataCat's authoritative paging cursor.
`DownloadedCharacter { charData: CharacterData, avatarUrl, avatarBytes }`
(:123–138) — `avatarBytes` is used when the image endpoint needs credentials.
`CharacterData` (:140–172): `name, description, personality, scenario, firstMes,
mesExample, creatorNotes, systemPrompt, postHistoryInstructions, alternateGreetings, tags,
creator, creatorId, characterBook`. The import persists via
`CatalogNotifier.importCharacter` (catalog_provider.dart:489+): timestamp id, image
fetch/download, embedded lorebook conversion, optional public lorebook attach — the
JanitorAI closed-definition path is the extractor in the launcher (§11.1).
