# Glaze — Catalog (Discover) Browse Screen + Character Detail: Pixel-Exact UI Spec

Extracted from `C:/Users/Gedeon/Documents/Coding/Glaze-stable` (Flutter/Dart).
Every value below is quoted from source with a `file:line` citation. All colors are given as
Flutter ARGB hex; when a theme role is used, it is resolved to concrete hex under the **default
dark theme** in §Theme.

Out of scope (covered by a sibling spec): the contents of `CatalogFilterSheet` and the
`filter_tag_picker` chips. The shared sheet chrome both use is documented in §Picker sheet here.

Files cited:

- `lib/features/catalog/widgets/catalog_grid.dart` (screen assembly)
- `lib/features/catalog/widgets/catalog_controls.dart`
- `lib/shared/widgets/list_controls.dart`
- `lib/shared/widgets/glass_surface.dart`
- `lib/shared/widgets/glaze_bottom_sheet.dart`
- `lib/shared/widgets/desktop_popup.dart`
- `lib/features/catalog/widgets/provider_logo.dart`
- `lib/features/catalog/widgets/catalog_card.dart`, `catalog_card_grid.dart`
- `lib/shared/widgets/card_tag_chips.dart`, `lib/shared/widgets/nsfw_blur.dart`
- `lib/features/character_list/character_list_screen.dart` (search field + tab placement)
- `lib/features/character_list/character_detail_screen.dart`
- `lib/features/catalog/widgets/catalog_detail_launcher.dart`
- `lib/shared/widgets/glaze_tab_bar.dart`, `glaze_tab_bar_strips.dart`
- `lib/shared/widgets/sheet_view.dart`, `glaze_sheet.dart`, `glaze_fab.dart`, `glaze_spinner.dart`
- `lib/shared/widgets/variation_chip.dart`
- `lib/shared/theme/app_theme.dart`, `app_colors.dart`, `theme_preset.dart`

---

## 0. Theme defaults that affect rendering

Resolved from `lib/shared/theme/app_theme.dart` (`AppTheme.dark`, `AppTheme._buildColorScheme`)
with `ThemePreset` defaults (`lib/shared/theme/theme_preset.dart:21-120`):

| Role | Value | Source |
|---|---|---|
| `primary` (accent) | `#C42A4A` | theme_preset.dart:26 `@Default('#C42A4A') accentColor` |
| `surface` (app bg, scaffold) | `#19191A` | app_theme.dart:35 `_vueAppBg = Color(0xFF19191A)` → `surface/bgColor` (app_theme.dart:71,73); `scaffoldBackgroundColor: colorScheme.surface` (dark copyWith) |
| `surfaceContainer*` (Low/High/Highest, Bright) | all pinned to `uiColor` = `#1E1E1E` | app_theme.dart:36 `_vueUiBg = Color(0xFF1E1E1E)`, pinned at app_theme.dart:81-87 |
| `onSurface` | `#E1E3E6` | `contrastFor()` light branch, lib/shared/utils/color_utils.dart:35 |
| `onSurfaceVariant` | `#B0B8C1` | color_utils.dart:33-35 (`secondary: true` light value) |
| `outline` | `#2C2D2E` | app_theme.dart:170 `_borderFor`: bg luminance ≤ 0.35 → `Color(0xFF2C2D2E)` (dark) |
| `outlineVariant` | `rgba(255,255,255,0.10)` | app_theme.dart:63-65 `Colors.white.withValues(alpha: 0.1)` |
| `error` | `#CF6679` | app_theme.dart:77 |
| Font | Inter (variable, weight via `wght` axis) | app_theme.dart:14 `kInterFontFamily = 'Inter'` |

Glass preset values used by every glass chip/surface
(`theme_preset.dart:29-30,76-77` defaults): `elementOpacity 0.8`, `elementBlur 12`,
`noiseOpacity 0.03`, `noiseIntensity 0.8`; `borderWidth 1`, `borderOpacity 0.1`
(theme_preset.dart:83-86).

**GlassSurface paint recipe** (`glass_surface.dart:96-215`) — applies to all chips below:
tint color composited at `elementOpacity` (0.8) alpha over the backdrop; when the resolved
fill is opaque the blur is skipped; otherwise a `BackdropFilter` blur with
`sigmaX = sigmaY = elementBlur = 12`; a noise overlay (`NoiseOverlay`, opacity 0.03) is
stacked above the fill; border paints inside the box unless `borderOnTop`.
If the surface sits under a `FlatBackdrop` (opaque sheets) the tint is pre-composited and
no blur runs (`glass_surface.dart:120-133`). Example: the sheet body fill is
`alphaBlend(0.8×#1E1E1E, #19191A) ≈ #1D1D1E`, fully opaque, no blur.

Material baseline (`app_theme.dart`, dark copyWith): `visualDensity: compact`;
InputDecorationTheme filled, fill = `surfaceContainerHighest` `#1E1E1E`, radius 12,
enabled border = `outline`, focused border = `primary` (app_theme.dart `inputDecorationTheme`);
CardTheme radius 16, elevation 0, side `outline`; dialog/sheet bg `surfaceContainerHighest`;
sheet max width cap `kSheetMaxWidthConstraints = 640` (app_theme.dart:181).

---

## 1. Screen assembly (Discover grid, top → bottom)

`CatalogGrid` is a `CustomScrollView` (catalog_grid.dart:60-67). It sits under the shell header;
the scroll view receives `topPadding = contentTopPad` from the parent screen
(character_list_screen.dart:513-517):

- `topPad = MediaQuery.padding.top + 74.0` (character_list_screen.dart:502)
- `contentTopPad = topPad + 52.0` (tab bar block, `_kTabBarBlock = 52`, character_list_screen.dart:96,515)
- `+ 41.0` more when the search strip is shown (`_kSearchStripBlock = 41`, character_list_screen.dart:104,516)
- bottom padding into the grid: `bottomPadding = navHeight + 20` (character_list_screen.dart:556)

Sliver order (catalog_grid.dart:60-190):

1. **Top spacer** — `SizedBox(height: topPadding)` (only if > 0) (catalog_grid.dart:62-63)
2. **Controls row** — `Padding(EdgeInsets.fromLTRB(16, 12, 16, 0))` wrapping `CatalogControls`
   (catalog_grid.dart:64-68). See §2.
3. **Active filter chips row** — only when `nsfw` or tag filters are set; `Padding(top: 12)`.
   See §4 (catalog_grid.dart:69-77).
4. Result-count row — `Padding(EdgeInsets.fromLTRB(16, 6, 16, 6))`; while loading renders an
   empty `SizedBox(height: 11)` as a placeholder, otherwise
   `Text('${state.total} result${state.total == 1 ? '' : 's'}')`,
   `TextStyle(fontSize: 11, color: onSurfaceVariant)` (catalog_grid.dart:113-135).
   Not shown for providers `janny` / `chub` / `datacat`; those get a bare
   `SizedBox(height: 12)` spacer instead (catalog_grid.dart:136-137).
5. **Grid** — `CatalogCardGridSliver` with
   `padding: EdgeInsets.fromLTRB(16, 0, 16, bottomPadding)` (catalog_grid.dart:150-158).
   See §6.
6. **Loading spinner** — `Padding(bottom: 24)`, centered `SizedBox(28×28)` holding
   `GlazeSpinner(color: primary)` (catalog_grid.dart:159-168).
7. **End of results** — shown when `!hasMore && results.isNotEmpty`;
   `Padding(bottom: 24)`, `Text('End of results')`,
   `TextStyle(fontSize: 12, color: onSurfaceVariant.withValues(alpha: 0.5))`
   (catalog_grid.dart:169-181).
8. Empty state (no results, not loading, page > 1): `Padding(top: 80)`, centered
   `Text('catalog_empty')`, `fontSize 14, color onSurfaceVariant` (catalog_grid.dart:139-148).
9. Error state: `Padding(all: 32)`, centered `Text(error)`,
   `fontSize 13, color onSurfaceVariant` (catalog_grid.dart:97-108).

Infinite scroll: on `ScrollEndNotification` with `metrics.extentAfter < 600` → `loadMore()`
(catalog_grid.dart:50-56). Scrollbars are suppressed
(`ScrollConfiguration…scrollbars: false`, catalog_grid.dart:57-59).

---

## 2. Controls row components

`CatalogControls` (catalog_controls.dart:124-200) renders a `Row` inside one
`GlassBackdropGroup` (single shared backdrop blur for the row):

```
[GlazeDropdownChip (provider)]  <Spacer>  [GlazeFilterIconButton]  —8px—  [sort chip]
```

DataCat provider replaces the sort chip with a labelled `GlazeActionChip`
(catalog_controls.dart:184-193); others get `GlazeSortIconChip` (catalog_controls.dart:195-212).

### 2.1 GlazeDropdownChip (provider dropdown) — `list_controls.dart:90-141`

- `MouseRegion(cursor: SystemMouseCursors.click)` + `GestureDetector` tap.
- `SizedBox(height: 32)` → `GlassSurface`:
  - `borderRadius: 16` (full pill)
  - `tint: context.cs.surface` → `#19191A` at alpha 0.8
  - `border: primary.withValues(alpha: 0.18)` → `rgba(196,42,74,0.18)`
  - backdrop blur sigma 12 + noise 0.03 (see §0)
- inner `Padding(horizontal: 14)`, `Row(min)`:
  - optional leading logo: `SizedBox(18×18, Center)` + `SizedBox(width: 6)`
  - label text: `fontSize 13, w600, color primary` (`#C42A4A`)
  - `SizedBox(width: 4)`
  - chevron `Icons.keyboard_arrow_down_rounded`, `size 18, primary`
- Leading widget = `ProviderLogo.catalog(provider, size: 18)` (catalog_controls.dart:139) —
  bundled raster/SVG brand marks: `assets/logos/providers/{janitor,janny,datacat,chub}.png`,
  `saucepan.svg`, drawn at native colors, `fit: contain` (provider_logo.dart:9-17,40-45).

### 2.2 GlazeFilterIconButton (filter button + badge) — `list_controls.dart:404-465`

- `SizedBox(32×32)`, `Stack(clipBehavior: Clip.none, alignment: center)`:
  - base: `GlassSurface(radius 16, tint surface, border primary a0.18)` with centered
    `Icon(Icons.filter_list_rounded, size 18, primary)`
  - badge when `count > 0`: `Positioned(top: -2, right: -2)`,
    `Container(constraints minWidth 16 / minHeight 16, padding horizontal 4)`,
    `color: primary` (`#C42A4A`), `shape: circle`;
    text `$count`: `fontSize 10, w700, Colors.white, height 1.0`.
- Badge count logic: nsfw +1, chub-only NSFL +1, tagIds length, tagNames length, token-range
  bounds differing from 29 / 100000, plus 11 chub-only refinement flags
  (catalog_controls.dart:64-101).

### 2.3 GlazeSortIconChip — `list_controls.dart:152-194`

- `Tooltip(message: currentSortLabel)`; `SizedBox(height: 32)` → `GlassSurface`
  (radius 16, tint surface, border primary a0.18) → `Padding(horizontal: 10)` →
  `Row(min)`: active-sort icon `size 18, primary`, `SizedBox(width: 2)`,
  chevron `keyboard_arrow_down_rounded` `size 18, primary`.
- Icon map (catalog_controls.dart:110-127): trending→`trending_up_rounded`,
  trending_24h→`local_fire_department_rounded`, popular→`star_rounded`,
  latest/newest→`schedule_rounded`, oldest→`history_rounded`,
  tokens_desc→`arrow_downward_rounded`, tokens_asc→`arrow_upward_rounded`,
  relevant→`auto_awesome_rounded`, rating→`thumb_up_rounded`, updated→`update_rounded`,
  timeline→`timeline_rounded`; fallback `Icons.sort_rounded`.

### 2.4 GlazeActionChip (DataCat order chip, labelled variant) — `list_controls.dart:206-263`

Same 32-height glass pill (radius 16, tint surface, border primary a0.18);
padding `horizontal: label == null ? 7 : 12`; icon 18 primary; with a label:
`SizedBox(width: 6)` then `Text(label)` `fontSize 13, w600, primary`, maxLines 1 ellipsis.

### 2.5 Sort filter-icon interplay

Filter button and sort chip are separated by `SizedBox(width: 8)`
(catalog_controls.dart:184,196).

---

## 3. Search field

Two variants in `character_list_screen.dart`; the Discover tab shows:

**(a) In-strip field** (desktop title-bar layout and mobile strip, shown under the tab bar row):

- Block height `_kSearchStripBlock = 41.0`; inner field area `SizedBox(height: 41 − 1 = 40)`
  (character_list_screen.dart:104,1012).
- Strip fill: `ColoredBox(color: inputDecorationTheme.fillColor ?? surfaceContainerHighest)`
  → `#1E1E1E` edge-to-edge (character_list_screen.dart:1005-1009).
- Field vertically centered (`Center`) with `isDense`, `filled: false`, all borders
  `InputBorder.none`, `contentPadding: EdgeInsets.symmetric(vertical: 10)`
  (character_list_screen.dart:1030-1055).
- Text style: `Theme.textTheme.bodyMedium` (M3 default `14px` Inter, color `onSurface`
  `#E1E3E6`) — the app-wide theme multiplies font size by `uiFontSize/15` and applies
  `uiFontWeight 400`/`uiLetterSpacing 0` defaults (character_list_screen.dart:1000;
  app_theme.dart:399-405).
- Hint: `catalog_search_placeholder` = **"Search characters..."**
  (`assets/translations/en.json:1452`; `search_characters` = "Search characters" is the
  non-catalog tab's key, en.json:32). Hint style = bodyMedium with
  `color: onSurfaceVariant` `#B0B8C1`.
- Prefix icon: `Padding(left: 16, right: 10)` around `Icon(Icons.search_rounded, size: 18,
  color: primary)`; `prefixIconConstraints: BoxConstraints()` (unconstrained)
  (character_list_screen.dart:1040-1050).
- Suffix (when text non-empty): `IconButton(Icon(Icons.close_rounded, size: 16),
  padding: zero)`, constrained `BoxConstraints.tightFor(width: 40, height: 32)`.
- Below the strip: `Divider(height: 1, color: outlineVariant)` → 1px
  `rgba(255,255,255,0.10)` line (character_list_screen.dart:1057).

**(b) In-header field** (when search is expanded into the shell header, mobile):

- Plain `TextField` in the header title slot: `isDense`, `border: InputBorder.none`,
  `style: fontSize 16, color onSurface`; hint same size `16`, color `onSurfaceVariant`;
  `cursorColor: primary`; `autofocus: true`; `textInputAction: search`
  (character_list_screen.dart:976-997).
- The header's search *button* (collapsed state): `SizedBox(44×44)` wrapping
  `IconButton(Icon(search_rounded | close_rounded, size 22), color: primary)`
  (character_list_screen.dart:222-239).

Query debounces 400 ms before hitting the catalog provider
(character_list_screen.dart:300-303).

The tab strip above the grid (My Characters / Catalog Discover) is a `GlazeTabBar` **pill**
style: `Padding(desktop ? LTRB(16,10,16,0) : only(top:10))`; strip max width 420 on desktop
(`_kTabStripWidth = 420`, character_list_screen.dart:100,1140-1150; icons `person_rounded`
/ `public_rounded`). Full pill spec is in §7.3 (same widget the detail page uses).

---

## 4. Active filter chips row

`_ActiveTagsRow` (catalog_grid.dart:427-549). Rendered under the controls row when any
filter is active.

- Container: `Padding(top: 12)` → `SizedBox(height: 28)` → horizontal `ListView`,
  `padding: EdgeInsets.symmetric(horizontal: 16)`, separator `SizedBox(width: 8)`
  (catalog_grid.dart:504-515).
- Chip: `Container(padding: EdgeInsets.symmetric(horizontal: 10))`,
  `borderRadius: 16`, `alignment: center`:
  - NSFW chip: bg `Color(0x33FF4444)`, border `Color(0x4DFF4444)`,
    text `Color(0xFFFF4444)`
  - regular chip: bg `primary.withValues(alpha: 0.2)`, border `primary` (opaque),
    text `Colors.white`
  (catalog_grid.dart:518-538)
- Content `Row(min)`: `Text(name)` `fontSize 12` (white / `#FF4444`),
  `SizedBox(width: 4)`, `Icon(Icons.close, size: 10)` (white / `#FF4444`)
  (catalog_grid.dart:539-553). Tap removes the filter; `MouseRegion` click cursor.

---

## 5. Card component (`CatalogCard`)

`catalog_card.dart:27-126`.

### 5.1 Container + motion states

- `AnimatedContainer(duration: 300ms, curve: Curves.easeOutBack)`,
  `transformAlignment: Alignment.center` (catalog_card.dart:40-44).
- Transform: pressed → `scale 0.96`; hovered → `scale 1.01` + `translateY −4.0`;
  idle → identity (catalog_card.dart:33-35).
- Decoration (catalog_card.dart:45-63):
  - `color: surfaceContainerHighest` → `#1E1E1E`
  - `borderRadius: 16`
  - `border: Border.all(color: Colors.white.withValues(alpha: 0.15))`
  - `boxShadow`: idle `Colors.black a0.1, blurRadius 6, offset(0,4)`;
    hovered `a0.3, blurRadius 24, offset(0,12)`
- Inner `ClipRRect(radius 16)` → `Column(stretch)`.

### 5.2 Image area

- `AspectRatio(aspectRatio: 2/3)`, `Stack(expand)`
  (catalog_card.dart:66-91).
- Image: `CachedNetworkImage(fit: cover)`; placeholder/error = `ColoredBox(primary a0.2)`
  with centered first letter: `Text(name[0].toUpperCase())`,
  `fontSize 48, bold, color primary` (catalog_card.dart:106-121).
- NSFW blur wrapper: `NsfwBlur(enabled)` → `ClipRect` + `ImageFiltered` Gaussian
  `sigmaX = sigmaY = 16` (`NsfwBlur` default), `TileMode.clamp` (nsfw_blur.dart:16-48).
- **Bottom fade** `_BottomFade` (catalog_card.dart:73,128-148): bottom-aligned
  `FractionallySizedBox(heightFactor: 0.5, widthFactor: 1.0)` with vertical
  `LinearGradient(topCenter→bottomCenter): [Colors.transparent, surfaceContainerHighest (#1E1E1E)]`.
- **Message badge** `_MessageBadge` (catalog_card.dart:86-91, 242-273): `Positioned(top: 8,
  right: 8)`; `Container(padding h6 v4, color: Colors.black a0.6, borderRadius: 10)`;
  `Row(min)`: `Icon(Icons.mail_outline_rounded, size 12, Colors.white70)`,
  `SizedBox(width: 4)`, count text `fontSize 10, w600, Colors.white`
  (formatted: ≥1e6 → `x.xkk`, ≥1000 → `x.xk`, else raw — catalog_card.dart:244-249).

### 5.3 Info block `_CardInfo` (catalog_card.dart:155-239)

`Padding(EdgeInsets.fromLTRB(10, 0, 10, 12))`, `Column(stretch, min)`:

1. **Name**: `maxLines 2, ellipsis`; `TextStyle(fontWeight w700, fontSize 15,
   height 1.2, color Colors.white)` (catalog_card.dart:177-184).
2. `SizedBox(height: 2)` → **Creator** `@creator`: `maxLines 1, ellipsis`;
   `fontSize 11, color Colors.white.withValues(alpha: 0.7)` (catalog_card.dart:185-194).
3. `SizedBox(height: 2)` → **Tokens** `'{n} tokens'`: `fontSize 11, w600,
   color white a0.5` (catalog_card.dart:195-204).
4. `SizedBox(height: 8)` → **Tag chips** `CardTagChips(tags)` (catalog_card.dart:205-209).
5. `SizedBox(height: 8)` → **Description** (HTML stripped, whitespace collapsed):
   `maxLines 3, ellipsis`; `fontSize 11, height 1.4, color white a0.55`
   (catalog_card.dart:210-222).

### 5.4 CardTagChips (`card_tag_chips.dart:20-72`)

`Wrap(spacing: 4, runSpacing: 4)`; chip = `Container(padding h8 v2, borderRadius 8,
Border.all(color))` + `Text(tag)` `fontSize 10, w600`.

| Tag | bg | fg | border |
|---|---|---|---|
| `NSFW` | `#33FF4444` | `#FF4444` | `#4DFF4444` |
| `SFW` | `#334CAF50` | `#4CAF50` | `#4D4CAF50` |
| `#custom` | `#1A00FFFF` | `#00CCCC` | `#3300FFFF` |
| other | `primary a0.15` | `primary` | `primary a0.2` |

---

## 6. Grid

`CatalogCardGridSliver` (catalog_card_grid.dart:24-62):

- Outer `SliverPadding(padding)` = `EdgeInsets.fromLTRB(16, 0, 16, bottomPadding)`
  (16/16 gutters; bottom `navHeight + 20` from the shell).
- Columns: `crossAxisCount = (crossAxisExtent / 212).ceil().clamp(1, 10)` — column slots
  are **212 logical px wide** at desktop (catalog_card_grid.dart:30-32).
- Row layout: `Padding(bottom: 12)` per row → `IntrinsicHeight` → `Row(stretch)`; each card
  `Expanded` with `EdgeInsets.only(right: isLast ? 0 : 12)` → **column gap 12, row gap 12**.
- Empty trailing slots in the last row render `SizedBox.shrink()`.
- Grid is a `SliverList` of rows (variable card heights align row-by-row).

---

## 7. Character detail page

Opened from a card tap: `showGlazeSheet(… backgroundColor: transparent, isScrollControlled,
useRootNavigator)` wrapping `CatalogDetailLauncher` → `CharacterDetailScreen`
(catalog_grid.dart:189-196; catalog_detail_launcher.dart:547-573).
The launcher's loading/error states:

- `_LoadingView`: `Container(height: 360, color: surfaceContainerHighest (#1E1E1E),
  borderRadius vertical top 24)`, centered `GlazeSpinner(primary)`; optional phase text
  `fontSize 12, onSurfaceVariant`, gap 12 (catalog_detail_launcher.dart:731-769).
- `_ErrorView`: same 360 container; `padding: 32`; icon (default
  `Icons.error_outline_rounded`) `size 48, onSurfaceVariant`; gap 16; message
  `fontSize 13, onSurfaceVariant`, center; gap 16; retry button
  `Container(padding h20 v10, color primary, radius 12)` with `Text(… color white,
  w600)` (catalog_detail_launcher.dart:772-824).

### 7.1 Sheet container (mobile modal bottom sheet)

`SheetView` (`sheet_view.dart`), shown via `showModalBottomSheet` with transparent bg:

- Height: collapsed = `0.85 × screen` (`_collapsed`, sheet_view.dart:268-271), expands to full.
- Corner radius: top corners `20` constant (`_kSheetCornerRadius = 20`, sheet_view.dart:20,
  1042-1060).
- Border: `glazeSheetBorder` = **top edge only**, `color: outlineVariant`
  (`rgba(255,255,255,0.10)`), painted in the *foreground* decoration (sheet_view.dart:1046-1055;
  glaze_sheet.dart:21-23).
- Fill: solid opaque `context.cs.surface` = `#19191A` (sheet_view.dart:1188-1196
  `ColoredBox(color: surface.withValues(alpha: opaque ? 1.0 : 0.8))` with `opaque: true`).
- Drag handle: block of vertical padding 10 + centered bar — width `36` collapsed / `24`
  expanded, height `4`, `borderRadius 2`, color `white a0.35` collapsed / `a0.6` expanded,
  `AnimatedContainer 300ms easeOutCubic` (sheet_view.dart:1387-1410). Total header-block
  estimate 24px (sheet_view.dart:390-392).
- Pinned-header scrim: `TopEdgeBlur(height: headerH + 8, sigma: 24,
  tint: surface a0.88)` (sheet_view.dart:1277-1289).

**Desktop variant** (`showGlazeSheet`, glaze_sheet.dart:57-96): the same content opens as a
floating window: width `min(0.92 × windowW, 640)` (glaze_sheet.dart:220-224), height
`0.85 × windowH`, **with title-bar chrome** (`windowChrome` default true), no dim barrier,
fade + scale(0.97→1) 180 ms easeOutCubic entrance (glaze_sheet.dart:133-144). Inside a
window, `SheetView` drops its own handle/app-bar and paints transparent over the window
glass (sheet_view.dart:335-338, 1188-1196). Chrome-less content-only windows would use
`_SheetPanel` (glaze_sheet.dart:403+): radius 16, shadow `black a0.5, blur 40, spread 4`.

### 7.2 Floating header (over the hero)

`_buildFloatingHeader` (character_detail_screen.dart:994-1040): `Align(topCenter)` →
`Padding(top: safeTop + 12, left: 16, right: 16)` → `Row`:

- Back button `_DetailHeaderButton` (icon `Icons.arrow_back`), left.
- `Spacer`.
- Kebab `_DetailHeaderButton` (`Icons.more_vert_rounded`) right — in preview mode only when
  blur can be lifted or a source URL exists (menu items: open-source
  `open_in_new_rounded`, un/re-blur `visibility(_off)_outlined`).
- Button spec (character_detail_screen.dart:1047-1120): `SizedBox(40×40)` →
  `GlassSurface(borderRadius 20 → circle, tint surface (#19191A a0.8), border =
  preset.borderParsed ?? onSurface, alpha = borderOpacity 0.1, width 1)`
  → centered `Icon(size 20, color primary)`. Press animation: scale `1.0 → 0.82`,
  80 ms forward / 150 ms reverse, `Curves.easeOut`.

### 7.3 Hero

`_HeroSection` (character_detail_screen.dart:1130-1236):

- `SizedBox(height: 310, width: ∞)`, tappable → image viewer.
- Image: `CachedNetworkImage(fit: cover, alignment: topCenter)` (file image variant same);
  through `NsfwBlur` (sigma 16) when preview blur is active.
  Placeholder `_HeroPlaceholder`: `ColoredBox(Color(0x14C42A4A))`, centered initial letter
  `fontSize 64, w700, color _kText35 (0x59FFFFFF)` (character_detail_screen.dart:1424-1437).
- Scrim gradient over the whole image: `LinearGradient(topCenter→bottomCenter,
  stops [0.35, 0.60, 1.0], colors [transparent, 0x33000000, 0xBF000000])`
  (character_detail_screen.dart:1158-1172).
- Caption: `Positioned(left: 16, right: 16, bottom: 16)`, `Column(start, min)`
  (character_detail_screen.dart:1173-1186):
  - optional variation chip `VariationChip(name, maxWidth: 180)` then `SizedBox(height: 6)`:
    pill = `Container(constraints maxWidth, padding h7 v1, color primary a0.14,
    borderRadius 10)` + `Text` `fontSize 11, w700, primary`, 1 line ellipsis
    (variation_chip.dart:29-51).
  - **Name** `_HeroName`: `TextStyle(fontSize 22, w700, white, shadows [blur 6, 0xCC000000])`,
    capped to 2 lines; longer names scroll top↔bottom (hold 1600 ms, speed 26 px/s)
    (character_detail_screen.dart:1256-1265, 1325-1418).
  - **Author** `@creator`: `fontSize 13`; tappable → `primary, w600`; plain →
    `_kText50 (0x80FFFFFF), w400`; `shadows [blur 3, 0xCC000000]`
    (character_detail_screen.dart:1196-1212).

### 7.4 Tab strip

`Padding(EdgeInsets.fromLTRB(16, 16, 16, 8))` wrapping `GlazeTabBar` (pill style)
(character_detail_screen.dart:864-871). Tabs: **Info** (`info_outline_rounded`),
**Prompt Blocks** (`description_outlined`), **Images** (`photo_library_outlined`)
(character_detail_screen.dart:87-99).

`PillTabStrip` (glaze_tab_bar_strips.dart:22-181):

- Track: `SizedBox(height: 42)` → `GlassSurface(borderRadius 21, tint surface,
  border primary a0.18)` (full pill, glass recipe §0).
- Active pill: `AnimatedPositioned(250ms easeOutCubic)`, inset `top: 3, bottom: 3`,
  `Padding(horizontal: 3)` → `GlassSurface(borderRadius 18, tint primary (#C42A4A, a0.8),
  border white a0.14)`.
- Tab content: `Row(center)`: `Icon(size 18)`, `SizedBox(width: 8)`,
  `Text(fontSize 14, w600)`; active → white, inactive → `primary`.
- Visible-tab budget `_kVisibleTabs = 2.35` → with 3 tabs the strip scrolls horizontally;
  active tab auto-reveals (250 ms easeOutCubic).
- Body swipe changes tabs (`SwipeTabSwitcher`/`TabSlideSwitcher` around the content).

### 7.5 Info tab

- **Tag chips** `_TagChip` (character_detail_screen.dart:1682-1721), in
  `Padding(LTRB(16, 8, 16, 0))` + `Wrap(spacing: 6, runSpacing: 6)`:
  chip = `Container(padding h9 v3, borderRadius 10, Border.all)` + `Text(fontSize 11,
  w600)`. Colors: `NSFW` bg `0x33FF4444` / fg `0xFFFF4444` / border `0x4DFF4444`;
  `SFW` bg `0x334CAF50` / fg `0xFF4CAF50` / border `0x524CAF50`; `#custom` bg `0x1A00FFFF` /
  fg `0xFF00CCCC` / border `0x3300FFFF`; other bg `_kAccentDim 0x1FC42A4A` /
  border `_kAccentBorder 0x33C42A4A` / fg = `primary`.
- **Description label**: `Padding(LTRB(16, 16, 16, 6))`, `Text(uppercase)`
  `fontSize 11, w600, letterSpacing 0.77, color _kText35 (0x59FFFFFF)`
  (character_detail_screen.dart:1485-1500).
- **Bio block** `_BioMarkdown` (character_detail_screen.dart:1537+): container
  `padding: 16`, `color: 0x7B000000`, `borderRadius: 8`,
  `border: Color(0x1A8B5CF6)` (matches JanitorAI's `.characterInfoMarkdownContent`);
  text `GptMarkdown` `fontSize 13.5, height 1.55, color _kText75 (0xBFFFFFFF)`;
  segments separated by `SizedBox(height: 8)`. Bio images: `ClipRRect(radius 8)`,
  `fit: contain`, through `NsfwBlur` when enabled.
- Empty fallback: centered `Padding(all: 40)`, `Text('no_preview_available',
  color _kText35)`.
- Folded-in **section headers** `_TabSectionHeader`
  (character_detail_screen.dart:1439-1460): `Padding(LTRB(16, 24, 16, 4))`,
  `Icon(size 15, primary)`, `SizedBox(width: 8)`, `Text(uppercase)`
  `fontSize 11, w700, letterSpacing 0.77, primary`. Used for Community/Comments
  (`forum_outlined`) and Lorebooks (`menu_book_outlined`).

### 7.6 Prompt Blocks tab

Accordion cards (`_PromptsTab`, character_detail_screen.dart:1723-2123). Sections in order:
Description, Personality, Scenario, Appearance, Message Example, System Prompt,
Post-History Instructions (non-empty only), then one **First Messages** card.

- **Card shell** `_AccordionShell` (character_detail_screen.dart:1979-1994):
  `margin LTRB(16, 16, 16, 0)`, `color _kSurface (0x0DFFFFFF)`, `borderRadius 16`,
  `border _kBorderLine (0x0DFFFFFF)`.
- **Header** `_AccordionHeader` (character_detail_screen.dart:2000+): tap row `Padding(LTRB(16, 14, 12, 14))`;
  label uppercase `fontSize 13, w600, letterSpacing 0.65, primary`; optional count badge
  (`Container(padding h7 v2, radius 8, bg _kAccentDim, border _kAccentBorder)`,
  text `fontSize 11, w700, primary`) + `SizedBox(width: 8)`; chevron
  `Icons.keyboard_arrow_up_rounded, size 24, color _kText50`, rotated `0.5 turns` when
  closed, `AnimatedRotation 280ms easeOutCubic`.
- **Body** `_CollapsibleText` (character_detail_screen.dart:2074+):
  `AnimatedCrossFade(280ms, easeOutCubic)`.
  - Closed: 3-line taste `maxLines 3`, `fontSize 13.5, height 1.55, color _kText75`,
    `Padding(LTRB(16, 0, 16, 14))`, faded by a `ShaderMask` linear gradient
    (stops `[0.45, 1.0]`, white → transparent, `BlendMode.dstIn`).
  - Open: selectable text, same style, `Padding(LTRB(16, 0, 16, 16))`.
- **First Messages card**: per-message row = `Divider(height: 1, thickness: 1,
  color _kBorderLine)` + `Padding(LTRB(16, 12, 12, 10))` with label
  `fontSize 12, w600, letterSpacing 0.5, color _kText50` and chevron
  (`keyboard_arrow_up_rounded, size 20, _kText35`); each greeting collapsible
  (`AnimatedRotation 280ms`).
- Trailing spacer at tab end: `SizedBox(height: 16)`.

### 7.7 Images tab

`CharacterGalleryView(shrinkWrap: true)` inside the same scroll body (grid of character
images; out of scope detail).

### 7.8 Floating "Import to library" FAB

`_ImportFab` → `GlazeFab(icon: Icons.download_rounded, label: 'catalog_import' | phase)`
(glaze_fab.dart). Positioned by `SheetView`:
`Positioned(right: 16, bottom: 16 + MediaQuery.padding.bottom + viewInsets.bottom)`
(sheet_view.dart:982-987, 1204-1209).

Spec (glaze_fab.dart:20-137):

- Height **56**; with a label a **stadium pill** (`StadiumBorder`), padding
  `left: 18, right: 22`; without label a 56 circle.
- Border: `Colors.white.withValues(alpha: 0.18)` stadium side.
- Content `Row(min)`: icon `size 22` (28 when icon-only; busy → `SizedBox(22)` spinner),
  `SizedBox(width: 10)`, label `Text(fontSize 15, w700, maxLines 1, ellipsis)`.
- Fill: `Material(color: accent)` (`#C42A4A`); busy → `accent a0.7`; disabled → whole
  button at `AnimatedOpacity 0.5` (150 ms).
- Glyph color: white if accent luminance is dark, else black
  (`estimateBrightnessForColor`).
- Shadows (two, under the same ShapeDecoration):
  1. `Colors.black a0.55, blurRadius 28, spreadRadius 2, offset(0, 10)`
  2. `accent a0.4, blurRadius 24, offset(0, 4)` (accent bloom)
- Press: Material `InkWell`, splash = glyph a0.15, highlight = glyph a0.08.
- Body content bottom clearance above the FAB: `SizedBox(height: 100 + safeBottom)`
  (character_detail_screen.dart:893).

---

## 8. Picker sheet (provider / sort pickers)

`showGlazePickerSheet` (`list_controls.dart:17-77`) builds `GlazePickerItem`s into a
`GlazeBottomSheet.show`:

**Mobile** — modal bottom sheet (`glaze_bottom_sheet.dart:196-215`):
`showGlazeSheet(useRootNavigator, useSafeArea, backgroundColor transparent,
barrierColor Colors.black54, enableDrag, isScrollControlled)`.

- Container `GlazeBottomSheetFrame` (glaze_bottom_sheet.dart:347+):
  `ConstrainedBox(maxHeight: 0.95 × screen)` → `FlatBackdrop(surface #19191A)` →
  `GlassSurface(borderRadius vertical top 24, border = glazeSheetBorder (top
  outlineVariant), borderOnTop: true)`; Column: handle bar then content.
  Fill resolves opaque (≈ `#1D1D1E`), **no blur** on the sheet body.
- **Handle** `_HandleBar` (glaze_bottom_sheet.dart:1014+): `Padding(vertical: 10)` +
  centered `Container(width 32, height 4, color white a0.35, radius 2)`.
- **Header** `_Header` (glaze_bottom_sheet.dart:1033+): `Padding(LTRB(20, 0, 12, 16))`, title
  `fontSize 18, w700, onSurface (#E1E3E6)`; trailing `headerAction` — the provider picker
  pins a gear `_SettingsGearButton`: `IconButton(Icons.settings_outlined, size 22,
  color primary, visualDensity compact)` (catalog_controls.dart:203-223).
- **Body list** `_ItemsList` (glaze_bottom_sheet.dart:1107+): one group card =
  `Padding(LTRB(16, 0, 16, 16))` → `Container(color white a0.06, border white a0.1,
  borderRadius 16, clip antiAlias)`; rows separated by `Divider(height: 1, thickness: 1,
  color white a0.06)`.
- **Row** `_ItemRow` (glaze_bottom_sheet.dart:1218+): `GestureDetector` with press
  state (`AnimatedContainer 100ms`, pressed bg `white a0.08`), padding
  `EdgeInsets.symmetric(horizontal: 16, vertical: 14)`; `Row`:
  - leading `iconWidget` in `SizedBox(22×22)` **or** `Icon(size 22)`; icon color for
    picker items = `primary` when active or when it's the fallback check, else
    `onSurfaceVariant` (list_controls.dart:57-66); `SizedBox(width: 16)`
  - label `Text(fontSize 16, color onSurface)` (destructive → `#FF4444`)
  - trailing actions: for the active picker row, a check chip
    `Padding(all: 8)` around `Icon(Icons.check_rounded, size 22, primary)`.
  - Non-active rows with a leading glyph show **no** trailing check; rows *without* a
    leading widget get `icon: Icons.check_rounded` only when active.
- Haptics: `Haptics.selectionClick()` on tap.

**Desktop** — a plain picker list routes to `showDesktopPopup` instead
(glaze_bottom_sheet.dart:210-253), `desktop_popup.dart`:

- Panel: width **240**, anchored at last pointer-down, flips across and clamps with a
  12 px viewport margin; entrance fade + scale(0.96→1, topLeft) 140 ms.
- `GlassSurface(borderRadius 12, border outlineVariant, boxShadow black a0.35,
  blurRadius 24, spreadRadius 1)` (glass recipe §0).
- Optional title: `Padding(LTRB(14, 12, 14, 8))`, `fontSize 12, w600,
  onSurfaceVariant` + `Divider(1px, outlineVariant)`; `SizedBox(height: 4)` top/bottom
  around rows.
- Row `_PopupRow`: `Padding(h14 v9)`, `HoverGlow` hover; leading `iconWidget` in
  `SizedBox(18×18)` or `Icon(size 18)` + `SizedBox(width: 10)`; label
  `fontSize 14, onSurface` (destructive → `error #CF6679`); hint `fontSize 11,
  onSurfaceVariant`; trailing action icons `size 18` with `SizedBox(width: 8)`.

---

## 9. Cross-cutting interactions summary

- Every tappable glass control uses `MouseRegion(cursor: SystemMouseCursors.click)`
  (theme also forces hand cursors onto all Material buttons app-wide,
  app_theme.dart `_withPointerCursors`).
- Loading indicators are `GlazeSpinner`: tapered accent arc, default diameter 36, stroke
  `diameter × 0.115 (clamped 1.8–12)`, faint track `color a × 0.12`, two halo passes
  (width ×2.2 a0.08, ×1.5 a0.14) + head bloom (`a0.35` radial, radius `stroke×2`),
  cycle 1600 ms (glaze_spinner.dart:22-46, 180-260).
- Toast after import: `GlazeToast.show(context, 'Imported ${item.name}')`
  (catalog_grid.dart:198).
- After import, default behavior navigates to `/characters?open=<id>`
  (`openCardAfterImport` setting, default true; catalog_grid.dart:201-207).
