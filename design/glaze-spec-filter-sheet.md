# Glaze — Catalog Filter Sheet: pixel-exact UI spec

Extracted from `C:/Users/Gedeon/Documents/Coding/Glaze-stable` (Flutter, `lib/`,
version 0.10.1 per `pubspec.yaml`). **Every value re-verified line-by-line
against the fresh clone on 2026-11.** Citations are `file:line` in that clone.
Resolved theme-role colors are given for the **default dark preset** (accent
`#C42A4A`); the role → hex mapping is derived in §0.

Verification notes:

- Every numeric value in the previous revision was **CONFIRMED unchanged**.
  What changed is only *where* the code sits (the shared library was
  refactored, so most line numbers moved) and a handful of constant/flag
  names. Changed entries are marked **CHANGED (old → new)** below; everything
  else is CONFIRMED with fresh citations.
- New content added in this pass is marked **ADDED**.

Primary files:

- `lib/features/catalog/widgets/catalog_filter_sheet.dart` (the stateful sheet)
- `lib/shared/widgets/filter_sheet.dart` (generic `FilterSheet` renderer + range/number rows)
- `lib/shared/widgets/filter_tag_picker.dart` (tags card, search field, chips)
- `lib/shared/widgets/menu_group.dart` (group cards, switch rows, collapsible section)
- `lib/shared/widgets/sheet_view.dart` (sheet container: handle, header, scroll, chrome)
- `lib/shared/widgets/glaze_sheet.dart` (`showGlazeSheet` — how the sheet is presented, incl. desktop window)
- `lib/shared/widgets/glaze_bottom_sheet.dart` (only used by the NSFL sub-dialogs inside this sheet)
- `lib/shared/theme/app_theme.dart`, `lib/shared/theme/theme_preset.dart`,
  `lib/shared/utils/color_utils.dart` (**CHANGED**: the old spec placed
  `contrastFor` in `lib/shared/theme/color_utils.dart`; it actually lives in
  `lib/shared/utils/color_utils.dart`), `lib/shared/theme/app_colors.dart`
- Strings: `assets/translations/en.json` (values listed in §9)

---

## 0. Theme role → exact color (default dark preset)

From `app_theme.dart`:

| Role | Value | Source |
|---|---|---|
| Accent / `primary` | `#C42A4A` | `theme_preset.dart:27` (`@Default('#C42A4A') String accentColor`) |
| `surface` (sheet fill, app bg) | `#19191A` | `app_theme.dart:55` (`_vueAppBg`) → `ColorScheme.surface` at `app_theme.dart:86` |
| `surfaceContainerHighest` (= `surfaceContainerLow…Highest` all pinned) | `#1E1E1E` | `app_theme.dart:56` (`_vueUiBg`), pinned at `app_theme.dart:93–99` (**CHANGED** line cite: old `84–88` → new `93–99`) |
| `onSurface` | `#E1E3E6` | `color_utils.dart:35` — `contrastFor(#1E1E1E)`: luminance < 0.5 → light constant `0xFFE1E3E6` (`color_utils.dart:31–38`) |
| `onSurfaceVariant` | `#B0B8C1` | `color_utils.dart:34` (`secondary: true` → `0xFFB0B8C1`), applied at `app_theme.dart:65,100` |
| `outline` (input/card borders) | `#2C2D2E` | `app_theme.dart:185–191` — `_borderFor(#1E1E1E, dark)`: luminance < 0.35 → `0xFF2C2D2E` (**CHANGED** line cite: old `196–203` → new `185–191`) |
| `outlineVariant` | `white @ 10%` (`0x1AFFFFFF`) | `app_theme.dart:68–70` |
| `error` | `#CF6679` | `app_theme.dart:84` (**CHANGED** line cite: old `73` → new `84`) |
| Danger color (NSFL switch) | `#FF5A5F` | `filter_sheet.dart:308` (`const _dangerColor`) |
| Destructive red (bottom-sheet items) | `#FF4444` | `glaze_bottom_sheet.dart:1264, 1464` (**CHANGED** line cite: old `624, 898` → new `1264, 1464`) |
| Font | **Inter** (bundled variable font; weights driven via `FontVariation('wght', …)`) | `app_theme.dart:11`, `app_theme.dart:28–31` |
| `visualDensity` | **`VisualDensity.compact`** app-wide | `app_theme.dart:292` (**CHANGED** line cite: old `289` → new `292`) |
| Sheet max width | `BoxConstraints(maxWidth: 640)` | `app_theme.dart:198` (`kSheetMaxWidthConstraints`), applied to every modal sheet at `app_theme.dart:321` (**CHANGED** line cite: old `221`/`314` → new `198`/`321`) |
| Element opacity / blur / noise | `0.8` / `12` / `0.03` | `theme_preset.dart:29–30` (opacity/blur), `:81` (`noiseOpacity 0.03`) (**CHANGED** line cite: old `29–30,76` → new `29–30,81`; noise intensity `0.8` at `theme_preset.dart:82`) |

Composite values used below:

- **Group-card fill** (`GlassSurface` inside the opaque sheet): default tint =
  `surfaceContainerHighest` `#1E1E1E` at `elementOpacity 0.8` composited once
  over the sheet's opaque `FlatBackdrop` (`#19191A`) → each channel
  `0.8·30 + 0.2·25 = 29` → **`#1D1D1D`** (glass_surface.dart:124–141; alpha ≥ 1
  ⇒ the per-frame blur is skipped, glass_surface.dart:145–154 — cards render as
  *solid* `#1D1D1D`).
- **Chip fill (unselected)**: `onSurface @ 0.05` over card `#1D1D1D` →
  ≈ `#272727` composited.

---

## 1. Sheet container

### 1.1 Presentation (`catalog_controls.dart:178–191` → `glaze_sheet.dart:71–117`)

Opened with `showGlazeSheet(isScrollControlled: true, useRootNavigator: true,
useSafeArea: true, backgroundColor: Colors.transparent)`
(`catalog_controls.dart:178–183`; CONFIRMED, previously cited as 182–195).

**Phone/tablet** (`glaze_sheet.dart:104–116`): plain `showModalBottomSheet` —
transparent bg (the content paints itself), default `barrierColor` =
`Colors.black54` (Flutter default; `showGlazeSheet` forwards `barrierColor`
untouched at `glaze_sheet.dart:113`), theme supplies `maxWidth: 640`
(`app_theme.dart:321`), drag-to-dismiss enabled.

**Desktop** (`glaze_sheet.dart:89–103` desktop branch; `:119–193` the route):
NOT a bottom band. The same content opens as a **centered, resizable floating
window**:

- Width: `min(0.92 × window width, 640)` (`glaze_sheet.dart:297–300`; cap
  `kGlazeSheetWindowMaxWidth = 640`, glaze_sheet.dart:14 — **CHANGED** name:
  old spec called it `_kGlazeSheetWindowMaxWidth`; it is now a public const)
- Height: fixed at `0.85 × window height` (`kGlazeSheetWindowHeightFactor =
  0.85`, glaze_sheet.dart:17 — **CHANGED** name/line: old
  `_kGlazeSheetWindowHeightFactor` at `:12`; now public at `:17`;
  `maxHeight = bounds.height * 0.85` at glaze_sheet.dart:301, applied as a
  fixed `SizedBox(height: …)` at `glaze_sheet.dart:350`) — this sheet does NOT
  pass `windowContentSized` (default `false`, glaze_sheet.dart:83; the call
  site passes none, `catalog_controls.dart:178–191`)
- Window frame (`desktop_window_chrome.dart:33–59`): `GlassSurface`,
  radius **16** on all corners (`:34`), border `outlineVariant`
  (`white @ 10%`, `:37`, painted `borderOnTop: true` at `:40`), shadow
  `black @ alpha(active ? 0.5 : 0.3)`, `blurRadius active ? 40 : 24`,
  `spreadRadius active ? 4 : 0` (`:41–47`); title bar height **52**
  (`desktop_window_geometry.dart:11`), then a 1px `outlineVariant` divider
  (`desktop_window_chrome.dart:53`).
- Title bar (`desktop_window_chrome.dart:93–178`): title **"Filters"**
  (delivered by `SheetView`'s header claim — see below), fontSize **17**,
  **w700**, `onSurface` when the window is active (`onSurface @ 0.55` when
  not) with a 150 ms animated fade between (`:128–140`, `_kActiveFade`
  `desktop_window_chrome.dart:9`); close button `Icons.close_rounded` size 20
  (`:167–173`), color `onSurfaceVariant` (compact-density IconButton,
  `:94–109`; default window-button icon size 18 `:102`, maximize button
  `Icons.crop_square_rounded` size 18 `:157–166`). **ADDED detail:** when the
  title bar has no back button its leading inset is 12 px
  (`desktop_window_chrome.dart:124`); a back button (not used here) would be
  `Icons.arrow_back_rounded` size 20 with 4 px edge padding (`:115–122`).
- Route transition: 180 ms fade + scale 0.97 → 1, `easeOutCubic`
  (`glaze_sheet.dart:156` duration; `:181–188` transitions).
- Inside the window, `SheetView` drops its own header row and hands
  "Filters" + actions to the window title bar (`_buildWindow`,
  sheet_view.dart:1089–1113 — **CHANGED** line cite: old `1014–1046`; the
  title/action handoff mechanism is the shell-header claim built at
  `sheet_view.dart:540–560` and consumed by `_WindowFrame`,
  glaze_sheet.dart:456–464).

### 1.2 Sheet chrome (`sheet_view.dart`)

`FilterSheet` builds a `SheetView(title, showHandle: true, bodyPadding: 0)`
containing a `ListView` (`filter_sheet.dart:212–234`):

- **Corner radius**: top edge only, **20** (`_kSheetCornerRadius = 20`,
  sheet_view.dart:21, applied sheet_view.dart:1055–1064 and again in the
  foreground border decoration at `:1068–1075`) — constant at every height, so
  the expanded sheet keeps rounded corners.
- **Background**: solid opaque `surface` = **`#19191A`**
  (`sheet_view.dart:1141–1144`
  `ColoredBox(color: cs.surface.withValues(alpha: opaque ? 1.0 : 0.8))`; the
  modal-sheet branch passes `opaque: true` — `sheet_view.dart:1113` sets
  `opaque: !_inWindow`, `:1019–1027` documents "solid opaque background") →
  also published as `FlatBackdrop` for the cards (`sheet_view.dart:1132–1133`).
- **Border**: top edge only, `outlineVariant` (`white @ 10%`), painted as a
  *foreground* decoration (`glazeSheetBorder`, glaze_sheet.dart:22–24;
  sheet_view.dart:1065–1075).
- **Height behavior**: starts **collapsed at 85% of screen height**
  (`_collapsed`: `h * 0.85`, sheet_view.dart:266–272 — **CHANGED** line cite:
  old `255–264`), draggable/snap to fullscreen; 350 ms snap animation
  (`sheet_view.dart:279–282` — **CHANGED** line cite: old `265–267`; curve is
  applied at the animation drive site).
- **Drag handle (grabber)**: centered bar, width **36** (collapsed) → animates
  to **24** when expanded, height **4**, radius **2**, color
  `white @ alpha(0.35)` collapsed / `0.6` expanded, 300 ms animation;
  surrounding vertical padding **10** ⇒ handle strip is 24 px tall
  (sheet_view.dart:1399–1419 — **CHANGED** line cite: old `1478–1502`). This
  sheet never auto-expands, so it shows the 36×4 / white@0.35 state.
- **Header row (below the handle)**: padding `EdgeInsets.fromLTRB(16, 0, 16, 12)`
  (sheet_view.dart:1422). Title **"Filters"** — fontSize **18**, **w700**,
  color `onSurface` (`#E1E3E6`), maxLines 1, ellipsis (sheet_view.dart:1443–1452).
  **There is NO close button** in the sheet header: `showBack: false` (default,
  sheet_view.dart:113) and `actions: []` (`filter_sheet.dart:212–216` passes
  neither) — the sheet closes by drag-down, back, or (desktop) the window close
  button.
- **Header scrim**: `TopEdgeBlur` over the scrolling body — height
  `extraTop + 8` where `extraTop = status-bar padding + 10 (handle pad) +
  measured header height` (sheet_view.dart:833–837; blur height applied at
  `:859`) ⇒ ≈ 84 px on a phone; sigma **24**, tint
  `_headerScrimColor() @ 0.88` (sheet_view.dart:857–866). **ADDED detail:**
  `_headerScrimColor` is `cs.surface` (**`#19191A`**) in a modal sheet but
  `cs.surfaceContainerHighest` (**`#1E1E1E`**) inside a desktop window
  (sheet_view.dart:755–756) — irrelevant for this sheet's phone look, relevant
  for the desktop window variant.
- **Scrolling**: body is a `ListView` (filter_sheet.dart:222–231) with padding
  `EdgeInsets.fromLTRB(0, top + 8, 0, bottom + 32)` where `top` = the measured
  header height (~76; `sheet_view.dart:1324–1331` injects `_headerBaseH` into
  `MediaQuery.padding.top`) and `bottom` = nav-bar inset + 16
  (`navInset`, sheet_view.dart:1284–1286). ⇒ first card sits **8 px** under the
  header; after the last card there is 32 px (+ safe area).
- **Scrollbar**: persistent `RawScrollbar`, thickness **6**, radius **3**,
  `thumbVisibility: true` (sheet_view.dart:1693–1698 — **CHANGED** line cite:
  old `1637–1646`; no `thumbColor` is passed, so the RawScrollbar default
  thumb color applies).
- **No bottom action bar / no Apply button anywhere in this sheet.** Filters
  commit **on close** (`dispose()` diffs state and calls `onApply`,
  catalog_filter_sheet.dart:174–208 — **CHANGED** line cite: old `222–262`).
  The only button-like header control is the tags card's "Clear (N)" (§2.5).
- Max width 640 via theme constraints; the `SheetView` body centers
  (`Alignment.topCenter`, sheet_view.dart:1297–1298).

---

## 2. Section-by-section content

All sections are rendered by `FilterSheet` (`filter_sheet.dart:210–266`) as an
ordered list inside the `ListView`. Every titled group renders as a **`MenuGroup`
card**: outer padding `EdgeInsets.fromLTRB(16, 0, 16, 12)`
(menu_group.dart:329 — **CHANGED** line cite: old `471–479`) ⇒ 16 px side
gutters, 12 px gap between cards, `GlassSurface` with radius **20**, border
`Border.all(outlineVariant)` = 1px `white @ 10%`, fill `#1D1D1D` (see §0),
tap-glow ripple in `primary` (menu_group.dart:330–339, `enableRipple: true`;
glow rendered by `GlowRippleOverlay`, glass_surface.dart:263–271 and
glow_ripple.dart:177–241).

**Group header (accent-caps variant, `menu_group.dart:343–413`)** — used by
every filter group (`filter_sheet.dart:277–281`):

- Padding `EdgeInsets.fromLTRB(16, 16, 8, bottomPad)` where
  `bottomPad = 4` when the group has rows and no description (2.0 with one;
  16.0 when the group has no rows) (menu_group.dart:349–351 — **CHANGED** line
  cite: old `530–539`)
- Label = `title.toUpperCase()`, color `primary` (`#C42A4A`),
  `FontWeight.w700`, fontSize **13**, `letterSpacing: 0.3`
  (menu_group.dart:377–387 — **CHANGED** line cite: old `562–575`)
- Optional trailing widget on the same row (the tags card uses it — §2.5)

**Section order for the Catalog filter sheet** (`catalog_filter_sheet.dart:455–512`):

1. **CONTENT** group (always) — `:460`
2. Timeline mode → hint only (§2.7) — `:463–464`. Otherwise:
3. **CARD** group (providers with token range) — `:469`
4. (Chub only) **MUST INCLUDE** collapsible group + **OTHER** group — `:470`
5. **TAGS** card — `:471–495`
6. (Janitor + signed in) **BLOCKED TAGS** card — `:496–508`

### 2.1 CONTENT group — `catalog_filter_group_content` = **"Content"**

`FilterGroupSection(title: 'Content', rows: …)` (`catalog_filter_sheet.dart:257–282`)
→ `MenuGroup(headerVariant: accentCaps)` (`filter_sheet.dart:276–282`).

Header text: **"CONTENT"**.

Rows (each a `MenuSwitchItem`, menu_group.dart:551–644 — **CHANGED** line cite:
old `725–800`):

- Row padding `EdgeInsets.symmetric(horizontal: 16, vertical: 10)` (menu_group.dart:589)
- Layout: **label left, switch right** — `Expanded(label column)` + 16 px gap
  (menu_group.dart:633) + `GlazeSwitch` (menu_group.dart:634–638)
- Label style: fontSize **16**, `FontWeight.w400`, color
  `onSurfaceVariant` (`#B0B8C1`) (menu_group.dart:607–613)
- Optional description under label: fontSize 12, color `#99A2AD`
  (menu_group.dart:619–628; the filter sheet passes none)
- Rows in this group, in order:
  1. **"Show NSFW"** (`catalog_filter_nsfw`) — value `_nsfw` (`:261–265`)
  2. (Chub only) **"Show NSFL"** (`catalog_filter_nsfl`) — `isDanger: true` →
     the switch's active color is **`#FF5A5F`** instead of accent
     (`catalog_filter_sheet.dart:267–272`; `filter_sheet.dart:294–302` —
     `activeColor: row.isDanger ? _dangerColor : null` at `:301`;
     `glaze_switch.dart:36–38`). Toggling on opens a confirmation dialog (§6);
     while signed out it opens a login prompt instead (`:384–398`).
  3. (Chub, non-timeline) **"NSFW only"** (`catalog_filter_nsfw_only`) (`:273–278`)

### 2.2 CARD group — `catalog_filter_group_card` = **"Card"**

`FilterGroupSection(title: 'Card')` (catalog_filter_sheet.dart:286–317). Hidden
entirely for DataCat (`CatalogControls.supportsTokenRange`, `:469`).

Header: **"CARD"**.

**Row 1 — "Token Range"** (`FilterRangeSection` → `_RangeRow`,
filter_sheet.dart:361–408 — **CHANGED** line cite: old `363–402`):

- Outer padding `EdgeInsets.fromLTRB(16, 10, 16, 10)` (`:367–368`)
- Label "Token Range" on its own line: fontSize **16**, **w400**,
  color `onSurfaceVariant` (`#B0B8C1`) (`_rowLabelStyle`, filter_sheet.dart:310)
- `SizedBox(height: 10)` (`:376`)
- Then **one row, two numeric fields with an en-dash between**:
  `Expanded(_NumberField(min, prefix "Min"))` + `Padding(horizontal: 10)` with
  a `Text('–', fontSize 16, color onSurfaceVariant)` + `Expanded(_NumberField(max, prefix "Max"))`
  (filter_sheet.dart:377–403)
- Defaults: min **29**, max **100000** (`catalog_models.dart:49–50` — CONFIRMED)
- **`_NumberField`** (filter_sheet.dart:415–503 — **CHANGED** line cite: old `432–522`):
  - `TextField`, `keyboardType: number`, digits-only formatter,
    `textAlign: TextAlign.end` when it has a prefix (center when not) (`:466–471`)
  - Text style: fontSize **15**, color `onSurface` (`#E1E3E6`),
    `FontFeature.tabularFigures()` (filter_sheet.dart:472–476)
  - Decoration: `isDense: true`, `contentPadding:
    EdgeInsets.symmetric(horizontal: 12, vertical: 11)` (filter_sheet.dart:478–482)
  - Prefix ("Min"/"Max"): a `Text` fontSize **13**, color `onSurfaceVariant`,
    inside `Padding(EdgeInsets.only(left: 12, right: 8))`,
    `prefixIconConstraints: BoxConstraints()` (zero min — the text sets its own
    width) (filter_sheet.dart:483–495)
  - Everything else comes from the theme's `inputDecorationTheme`
    (app_theme.dart:342–357 — **CHANGED** line cite: old `334–353`): **filled**,
    fillColor `#1E1E1E` (`surfaceContainerHighest`), radius **12**, enabled /
    focused border `OutlineInputBorder` — enabled 1px `#2C2D2E` (`outline`),
    focused 1px `#C42A4A` (`primary`).
- An emptied field snaps back to the committed value on blur
  (filter_sheet.dart:441–454 — **CHANGED** line cite: old `461–470`).

**Rows 2–3 (Chub only) — number rows** (`FilterNumberSection` → `_NumberRow`,
filter_sheet.dart:313–357 — **CHANGED** line cite: old `312–359`):

- Padding `EdgeInsets.fromLTRB(16, 8, 16, 8)` (`:320`)
- **Label left, one compact number field right** (`SizedBox(width: 96)`,
  `:347–352`; 16 px gap between label and field, `:346`)
- Label fontSize **16**, **w400**, `onSurfaceVariant` (`:327–332`)
- Field = `_NumberField` without prefix: `textAlign: TextAlign.center`,
  same theme decoration as above
- Rows: **"Minimum AI rating"** (`catalog_filter_min_ai_rating`) and
  **"Minimum tag count"** (`catalog_filter_min_tags`), both labeled `Min`
  (`catalog_filter_sheet.dart:302–314`)

### 2.3 MUST INCLUDE group (Chub only) — **"Must include"**, collapsible

`FilterGroupSection(collapsible: true)` → `MenuCollapsibleSection`
(catalog_filter_sheet.dart:321–354; filter_sheet.dart:283–289;
menu_group.dart:40–168 — **CHANGED** line cite: old `60–167`):

- Outer padding `EdgeInsets.fromLTRB(16, 0, 16, 12)` (menu_group.dart:101);
  `GlassSurface` radius **20**, border 1px `outlineVariant`
  (menu_group.dart:100–108)
- Collapsed label: `"Must include · N"` where **N** = number of active rows
  (`filter_sheet.dart:285`); opens itself on mount when any row is active
  (`initiallyExpanded: active > 0`, `filter_sheet.dart:286` and
  menu_group.dart:62)
- Header padding `EdgeInsets.symmetric(horizontal: 16, vertical: 14)`
  (menu_group.dart:132); label fontSize **16**, **w600 when expanded /
  normal (w400) when collapsed**; color `onSurface` expanded,
  `onSurfaceVariant` collapsed (menu_group.dart:144–149 — **CHANGED** line
  cite: old `166–178`)
- Chevron `Icons.keyboard_arrow_down_rounded` (no explicit size → Material
  default **24**), color `primary` expanded / `onSurfaceVariant` collapsed,
  animated `AnimatedRotation` 150 ms (menu_group.dart:154–163 — **CHANGED**
  line cite: old `179–189`)
- **Expanded header wash**: vertical linear gradient
  `primary @ 0.22 → primary @ 0.0` on the header `AnimatedContainer`, animated
  150 ms (menu_group.dart:115–131 — **CHANGED** line cite: old `140–155`)
- Nested `MenuGroup` renders flat inside (no own card/gutters; a 1px
  `outlineVariant` rule separates it from the next nested group — the last one
  drops the rule, menu_group.dart:308–317 — **CHANGED** line cite: old
  `437–445, 495–500`)

Rows (5 `MenuSwitchItem`s, same style as §2.1): **"With gallery images"**,
**"With lorebooks"**, **"With custom prompt"**, **"With example dialogues"**,
**"With alternate greetings"** (`catalog_filter_sheet.dart:326–352`).

### 2.4 OTHER group (Chub only) — **"Other"**

Regular `MenuGroup` (non-collapsible, `catalog_filter_sheet.dart:354–368`). Rows
(menu-switch style of §2.1): **"Recommended / verified"**,
**"Exclude my characters"**.

### 2.5 TAGS card — `catalog_tags` = **"Tags"** (`FilterTagPicker`, filter_tag_picker.dart)

A `MenuGroup` with the accent-caps header **"TAGS"** and a header-trailing
clear button (filter_tag_picker.dart:173–178 — **CHANGED** line cite: old
`157–163`).

**ADDED — option switches above the picker:** `FilterTagsSection.options` are
rendered as regular `filterRow(…)` menu-switch rows at the top of the tags
card, before the content padding (filter_tag_picker.dart:179–180). For Chub
this is one row: **"Match any tag"** (`catalog_filter_inclusive_or`,
catalog_filter_sheet.dart:480–487, value `_inclusiveOr`).

**Content container padding**: `EdgeInsets.fromLTRB(16, 6, 16, 10)`
(filter_tag_picker.dart:182). Inside, top-to-bottom:

1. **Selected chips** (only when `_selectedCount > 0`): a `Wrap` with
   `spacing: 6, runSpacing: 6` of *selected-state* chips (§3), then
   `SizedBox(height: 12)` (filter_tag_picker.dart:186–199)
2. **Search field** (`FilterSearchField`, §5), then `SizedBox(height: 12)`
   (filter_tag_picker.dart:201–209)
3. **Chip grid** (§3) — a `Wrap(spacing: 6, runSpacing: 6)`
4. **"Show all (N)" expander** (only when the list folds, §3.1)
5. Empty/loading hints (§3.2)

Behavior: curated tags only (no search) show every *unselected* tag; typing
switches to local matches (starts-with first, then contains) followed by
remote suggestions; picking a chip from search results clears the query;
a new query re-folds the grid (filter_tag_picker.dart:55–123, 232–277 —
**CHANGED** line cite: old `63–120, 245–296`).

**Clear button** (`FilterClearButton`, filter_sheet.dart:507–529 — **CHANGED**
line cite: old `524–547`) in the header: `TextButton`, foreground `primary`,
`VisualDensity.compact`, padding `EdgeInsets.symmetric(horizontal: 8)`, text
`'catalog_clear_tags'.tr(namedArgs: {'count': …})` = **"Clear ({count})"** —
fontSize **13**, **w600** (filter_sheet.dart:515–527).

### 2.6 BLOCKED TAGS card (Janitor, signed in) — `catalog_blocked_tags` = **"Blocked tags"**

Same `MenuGroup`/accent-caps layout as TAGS with the same clear button
(janitor_blocked_content_section.dart:142–147 — **CHANGED** line cite: old
`126–200` for the whole card). Content padding `fromLTRB(16, 6, 16, 10)`
(`:150`); selected blocked entries (tags *and* keywords, indistinguishable) as
selected chips (Wrap 6/6, then 12, `:155–175`), then `FilterSearchField` (hint
**"Block a tag..."**, `catalog_blocked_search`, `:176–183`), then — while a
query is active only — a `Wrap(spacing: 6, runSpacing: 6)` with an "add
keyword" chip (`Icons.block_rounded`, label `Block tag "{keyword}"`,
`:190–198`) plus up to **8** tag matches and **8** keyword-suggestion chips
(`take(8)`, janitor_blocked_content_section.dart:123–138 — **CHANGED** line
cite: old `117–123`).

### 2.7 Timeline hint (Chub Timeline mode)

`FilterCustomSection(child: _TimelineFiltersHint)` → padding
`EdgeInsets.fromLTRB(16, 4, 16, 16)` (filter_sheet.dart:257–260 — **CHANGED**
line cite: old `240–249`). Row: `Icons.info_outline_rounded` size **16** color
`onSurfaceVariant`, 10 px gap, text **"Chub Timeline doesn't support
filters"** (`catalog_chub_timeline_no_filters`) — fontSize **13**, color
`onSurfaceVariant`, `height: 1.35` (catalog_filter_sheet.dart:521–543 —
**CHANGED** line cite: old `463–486`).

---

## 3. Tag chip component (`FilterTagChip`, filter_tag_picker.dart:399–466 — **CHANGED** line cite: old `561–635`)

`Material` + `StadiumBorder` (fully rounded pill), `clipBehavior: antiAlias`,
InkWell with hand cursor + haptic on tap (`:417–434`).

**Unselected:**

- Fill: `onSurface @ 0.05` → ≈ `#272727` composited over the `#1D1D1D` card
  (`:418–420`)
- Border: 1px `outlineVariant` = `white @ 0.1` (`:421–427`)
- Padding: `EdgeInsets.fromLTRB(12, 6, 12, 6)` (`:435–441`)
- Label: fontSize **13**, `height: 1.2`, color `onSurfaceVariant` (`#B0B8C1`),
  maxLines 1, ellipsis (`:449–455`; `fg` resolved at `:416`)

**Selected:**

- Fill: `primary @ 0.22` (`#C42A4A` @ 22%)
- Border: 1px `primary @ 0.7`
- Padding: `EdgeInsets.fromLTRB(12, 6, 8, 6)` — right side narrows to 8
- Label: fontSize **13**, color **`onSurface` (`#E1E3E6`)**
- Trailing remove mark: `Icons.close_rounded` size **14**, same `onSurface`
  color, after a 4 px gap (`:457–460`)

**Icon-led chip** (e.g. `Search by tag "…"` — `catalog_add_custom_tag` — with
`Icons.add_rounded` size 16 in `primary`, 4 px gap after the icon):
left padding narrows to **8** (filter_tag_picker.dart:435–448).

Height: 6+6 padding + 13·1.2 ≈ **27–28 px** pill.

### 3.1 "Show all" expander (filter_tag_picker.dart:280–311 — **CHANGED** line cite: old `298–338`)

- Appears only when the pool exceeds `collapsedCount + 6` = **30**
  (`collapsedCount` default **24**, filter_sheet.dart:172 — **CHANGED** line
  cite: old `171`; `folds = tags.length > limit + 6`, filter_tag_picker.dart:252)
- Collapsed shows the first **24** chips (`:253`)
- `TextButton.icon`: foreground **`primary`**, `VisualDensity.compact`,
  padding `EdgeInsets.symmetric(horizontal: 4)`, preceded by
  `Padding(EdgeInsets.only(top: 6))` (`:281–292`)
- Icon: `Icons.keyboard_arrow_down_rounded` (or `keyboard_arrow_up_rounded`
  when expanded), size **18** (`:293–298`)
- Label: **"Show all ({count})"** / **"Show less"** — fontSize **13**,
  **w600** (`:299–309`)

### 3.2 Empty / loading states

- Loading: centered 20×20 `GlazeSpinner(strokeWidth: 2)` (arc color
  `primary`, faint track tint of it), inside `Padding(vertical: 12)`
  (filter_tag_picker.dart:219–229 — **CHANGED** line cite: old `214–224`)
- Empty: `Padding(vertical: 6)`, `Text` fontSize **13**, color
  `onSurfaceVariant` — "No tags yet" (`filter_tags_none`) / "No tags found"
  (`filter_tags_nothing_found`) / "Searching tags..."
  (`catalog_searching_tags`) (filter_tag_picker.dart:239–247, 316–324 —
  **CHANGED** line cite: old `340–350`)

---

## 4. Toggle component

`GlazeSwitch` (glaze_switch.dart:11–46 — **CHANGED** line cite: old `16–45`) =
stock **Material 3 `Switch`** with `VisualDensity.compact` applied app-wide
(app_theme.dart:292) — M3 metrics track 52×32 / thumb 24 shrink by the compact
density (≈ **44×28**, thumb ≈ 20).

Colors:

- **On**: thumb = `activeColor ?? primary` (`#C42A4A`) — `activeThumbColor:
  active` (glaze_switch.dart:37 — **CHANGED** line cite: old `31–33`); track =
  `active @ 0.5` (`activeTrackColor`, glaze_switch.dart:38). Theme default
  track when *selected* is solid `primary` (app_theme.dart:396–403 —
  **CHANGED** line cite: old `362–371`; thumb white at `:397`, selected track
  `:399`) — GlazeSwitch's 0.5-alpha track wins.
- **Off**: thumb **white** (theme `switchTheme.thumbColor: all(Colors.white)`,
  app_theme.dart:397); track = `onSurface @ 0.3` (app_theme.dart:398–401 —
  **CHANGED** line cite: old `365–367`) → `#E1E3E6` @ 30%; track outline =
  `outlineVariant` (`white @ 0.1`) when unselected, `transparent` when
  selected (glaze_switch.dart:39–43 — **CHANGED** line cite: old `35–43`).
- **Danger variant** (NSFL): thumb `#FF5A5F`, track `#FF5A5F @ 0.5`
  (filter_sheet.dart:294–302 → glaze_switch.dart:36–38).
- All switches render with the **hand cursor** on desktop
  (app_theme.dart:207–251 — **CHANGED** line cite: old `204–246` forces
  `SystemMouseCursors.click` on every enabled Material control).

Row composition (`MenuSwitchItem`): label **left**, switch **right**, 16 px
gap, row padding 16/10 (menu_group.dart:588–638).

---

## 5. Search field component (`FilterSearchField`, filter_tag_picker.dart:329–393 — **CHANGED** line cite: old `467–521`)

`TextField` on the **theme's** `inputDecorationTheme`:

- Text: fontSize **15**, color `onSurface` (`#E1E3E6`) (`:371`)
- Hint: color `onSurfaceVariant` (`#B0B8C1`), no explicit size → merges with
  the theme's default input style (16 at default settings) (`:377`)
- `isDense: true`, `contentPadding: EdgeInsets.symmetric(vertical: 12)` (`:378–379`)
- Leading: `Icons.search_rounded` size **20**, color `onSurfaceVariant` (`:380–384`)
- Trailing: while loading → 16×16 `GlazeSpinner(strokeWidth: 2)` inside
  `Padding(all: 12)` (`:352–360`); else, when there is text → `IconButton`
  (`Icons.close_rounded` size 18, color `onSurfaceVariant`, compact density)
  (`:361–367`)
- Fill `#1E1E1E`, radius **12**, border 1px `#2C2D2E` (enabled) /
  `#C42A4A` (focused) — all from `app_theme.dart:342–357`
- `textInputAction: search` (or `done` when custom tags are allowed; submit
  adds the raw query as a tag) (`:372–374`)
- Debounce for remote suggestions: **250 ms** (filter_tag_picker.dart:72 —
  **CHANGED** line cite: old `74`)

---

## 6. Sub-dialogs (NSFL), rendered via `GlazeBottomSheet.show`

Shown as a **chrome-less, content-sized desktop window / phone bottom sheet**
(glaze_bottom_sheet.dart:308–321 — **CHANGED** line cite: old `180–206`;
`windowContentSized: true` at `:320`, `windowChrome: false` at `:321`):

- Phone: modal bottom sheet, barrier `Colors.black54` (`:313`), top radius 24
  (`BorderRadius.vertical(top: Radius.circular(24))`, `:384`), solid fill
  `surface` (`#19191A` — `FlatBackdrop(color: context.cs.surface)`, `:379–380`),
  top border `outlineVariant` (`glazeSheetBorder`, `:385–387`), drag handle
  32×4 `white @ 0.35`, radius 2, vertical padding 10 (`_HandleBar`,
  glaze_bottom_sheet.dart:1015–1031, shown at `:393`)
- Desktop: centered window, radius **16** on all sides, shadow
  `black @ 0.5, blurRadius 40, spreadRadius 4` (`_SheetPanel`,
  glaze_sheet.dart:404–434 — **CHANGED** line cite: old `400–424`), no title
  bar (the content supplies its own header: `_Header` — padding
  `fromLTRB(20, 0, 12, 16)`, title fontSize 18 w700 `onSurface`,
  glaze_bottom_sheet.dart:1043–1053 — **CHANGED** line cite: old
  `1466–1512`) — plus the same 32×4 handle and a 20 px top inset in window
  mode (glaze_bottom_sheet.dart:771–776)
- Window-mode scrollbar (inside the content's own scroll view): `RawScrollbar`
  thumb `white @ 0.15`, radius **3**, thickness **4**, right padding 3
  (glaze_bottom_sheet.dart:669–674 — CONFIRMED, previously cited as
  `498–505`); the header also gets a `TopEdgeBlur` scrim, height
  `_headerH + 8`, sigma 24, tint `surface @ 0.88` (`:655–659`)
- **Big info block** (`_BigInfo`, glaze_bottom_sheet.dart:2054–2093 —
  **CHANGED** line cite: old `2040–2079`): padding `fromLTRB(20, 12, 20, 20)`
  (`:2062`); icon 64 (`Icons.lock_outline_rounded` for the login prompt /
  `Icons.warning_amber_rounded` for the confirm — chosen by the caller,
  catalog_filter_sheet.dart:406–408, 432–434) color
  `onSurfaceVariant @ 0.5` (`:2065–2069`); 16 px gap (`:2070`); description
  fontSize **16**, color `onSurface`, `height: 1.5`, centered (`:2071–2079`)
- **Item rows** (`_ItemRow`, glaze_bottom_sheet.dart:1228–1280 — **CHANGED**
  line cite: old `612–660`): rows sit in a card — padding
  `fromLTRB(16, 0, 16, 16)` (`:1189`), fill `white @ 0.06`, border 1px
  `white @ 0.1`, radius **16** (glaze_bottom_sheet.dart:1188–1204 —
  **CHANGED** line cite: old `941–963`); row padding
  `EdgeInsets.symmetric(horizontal: 16, vertical: 14)` (`:1247`); label
  fontSize **16**, color `onSurface` (or `#FF4444` destructive —
  `_ItemLabel`, glaze_bottom_sheet.dart:1456–1470; leading icon destructive
  color at `:1263–1265`); pressed tint `white @ 0.08` (100 ms)
  (`:1242–1246`)
- Dialog buttons are **centered** (`centered: true` renders the label through
  a `Center`, glaze_bottom_sheet.dart:1269–1273): the confirm is destructive
  (**"I have nothing to lose"**, `catalog_nsfl_btn`) and cancel
  (**"I'm too young to die"**, `catalog_nsfl_btn_cancel`) is normal; the login
  prompt's single button is **"Sign in"** (`chub_nsfl_login_btn`) — call sites
  catalog_filter_sheet.dart:402–452.

---

## 7. Material theme defaults that affect rendering (dark theme, app_theme.dart:296–456)

- `useMaterial3: true`, `blendLevel: 0` (`:284–285`),
  `visualDensity: VisualDensity.compact` (`:292`)
- `dialogTheme` (`:305–308`): bg `surfaceContainerHighest` = `#1E1E1E`,
  radius `16 * cornerScale`
- `bottomSheetTheme` (`:309–322`): bg + modal bg `#1E1E1E`,
  `surfaceTintColor: surface`, top radius `20 * cornerScale`, constraints
  `maxWidth: 640` (`:321`) — though both sheets here paint transparent and
  fill themselves with `#19191A`
- `cardTheme` (`:334–341`): bg `#1E1E1E`, radius 16, 1px `outline` border,
  elevation 0
- `inputDecorationTheme` (`:342–357`): filled, fillColor `#1E1E1E`, radius 12,
  enabled border 1px `#2C2D2E`, focused border 1px `#C42A4A`
- `textButtonTheme`: foreground `onSurface`, radius 20 (`:381–388`)
- `switchTheme` (`:396–403`): thumb always white; selected track `primary`,
  unselected `onSurface @ 0.3`; outline always transparent (GlazeSwitch
  overrides thumb/active-track/outline as in §4)
- `scaffoldBackgroundColor` / `canvasColor` = `surface` `#19191A` (`:298–299`)
- `iconTheme`: color `onSurface` (`:404`)
- Text theme: Inter, body color `onSurface`, per-role weights driven via
  `FontVariation('wght', …)`; UI font size factor = `uiFontSize / 15.0`
  (default 15 ⇒ factor 1.0 — `theme_preset.dart:256–260` defaults `uiFontSize`
  to `dynamic 'system'` → 15.0), UI letter-spacing (default 0,
  `theme_preset.dart:49`) and weight deltas (default 400,
  `theme_preset.dart:48`) applied app-wide (app_theme.dart:266–269, 405–412)
- Mouse cursors: every enabled Material control gets the **hand pointer**;
  disabled gets the plain arrow (app_theme.dart:207–251)
- **ADDED:** `scrollbarTheme` is **NOT configured** anywhere in the theme
  (`grep -r scrollbarTheme lib/` → no hits); scrollbars use Flutter/Material
  defaults except where a widget passes its own (`RawScrollbar` in
  `sheet_view.dart:1693–1698`, `glaze_bottom_sheet.dart:669–674`)
- Desktop sheet-window scrollbar: `white @ 0.15`, 4 px, radius 3
  (glaze_bottom_sheet.dart:669–674 — used by `GlazeBottomSheetFrame`'s content,
  not by `SheetView`)

---

## 8. Layout summary (what a 1:1 HTML/CSS reproduction must build)

Top → bottom (phone, collapsed at 85% height, width ≤ 640):

1. 24 px handle strip with a centered 36×4, white@0.35, radius-2 pill
2. 12 px, then title row: 16 px gutters — "Filters" 18px/700 `#E1E3E6`,
   12 px below it
3. ~8 px, then cards, each 16 px gutters / 12 px apart, radius 20,
   fill `#1D1D1D`, 1px border `rgba(255,255,255,0.1)`:
   - **CONTENT** (13px/700 caps, `#C42A4A`, ls 0.3, padding 16/16/8/4) →
     switch rows (16/10 padding, label 16px/400 `#B0B8C1` left,
     M3-compact switch right)
   - **CARD** → range row (label 16px/400 muted; 10 px; two 12-radius
     `#1E1E1E` filled number fields, 15px tabular `#E1E3E6`, "Min"/"Max"
     13px muted prefixes, en-dash separator 16px muted, 10 px gaps) +
     (Chub) two 96-px-wide centered number rows
   - (Chub) **MUST INCLUDE** collapsible (16px label, 14px vertical padding,
     chevron; 0.22-accent top wash when open; 5 switch rows)
   - (Chub) **OTHER** (2 switch rows)
   - **TAGS** (+ "Clear (N)" 13px/600 accent in header; (Chub) "Match any tag"
     switch row first; 6/10 vertical padding; selected chip wrap 6/6 + 12;
     search field (radius 12, filled `#1E1E1E`, 20px search glyph, 15px text,
     vertical 12 padding) + 12; chip grid 6/6; ≤24 chips collapsed, fold at
     >30, "Show all (N)" 13px/600 accent with 18px chevron, 6 px above)
   - (Janitor) **BLOCKED TAGS** (same card anatomy as TAGS)
4. 32 px (+ safe area) below the last card; nothing pinned at the bottom —
   **no Apply/Reset bar**; state commits when the sheet closes
5. Desktop: the same body inside a 640-max, 85%-height centered resizable
   window with a 52 px title bar ("Filters" 17px/700 + close ✕), 16 px
   radius, 1px `rgba(255,255,255,0.1)` border, black 40-blur shadow

---

## 9. Exact English strings (assets/translations/en.json)

All values CONFIRMED (line numbers from the fresh clone):

| Key | en.json line | Value |
|---|---|---|
| `catalog_filters` | 1935 | `Filters` |
| `catalog_filter_nsfw` | 1936 | `Show NSFW` |
| `catalog_filter_nsfl` | 1937 | `Show NSFL` |
| `catalog_filter_nsfw_only` | 1940 | `NSFW only` |
| `catalog_filter_require_images` | 1941 | `With gallery images` |
| `catalog_filter_require_lore` | 1942 | `With lorebooks` |
| `catalog_filter_require_custom_prompt` | 1943 | `With custom prompt` |
| `catalog_filter_require_example_dialogues` | 1944 | `With example dialogues` |
| `catalog_filter_require_alternate_greetings` | 1945 | `With alternate greetings` |
| `catalog_filter_recommended_verified` | 1946 | `Recommended / verified` |
| `catalog_filter_exclude_mine` | 1947 | `Exclude my characters` |
| `catalog_filter_inclusive_or` | 1948 | `Match any tag` |
| `catalog_filter_min_ai_rating` | 1949 | `Minimum AI rating` |
| `catalog_filter_min_tags` | 1950 | `Minimum tag count` |
| `catalog_token_range` | 1952 | `Token Range` |
| `catalog_min` | 1953 | `Min` |
| `catalog_max` | 1954 | `Max` |
| `catalog_tags` | 1955 | `Tags` |
| `catalog_blocked_tags` | 1956 | `Blocked tags` |
| `catalog_blocked_search` | 1957 | `Block a tag...` |
| `catalog_blocked_add_keyword` | 1958 | `Block tag "{keyword}"` |
| `catalog_clear_tags` | 1959 | `Clear ({count})` |
| `catalog_search_tags` | 1960 | `Search tags...` |
| `catalog_add_custom_tag` | 1961 | `Search by tag "{tag}"` |
| `filter_tags_show_all` | 1962 | `Show all ({count})` |
| `filter_tags_show_less` | 1963 | `Show less` |
| `filter_tags_nothing_found` | 1964 | `No tags found` |
| `filter_tags_none` | 1965 | `No tags yet` |
| `catalog_filter_group_content` | 1966 | `Content` |
| `catalog_filter_group_card` | 1967 | `Card` |
| `catalog_filter_group_require` | 1968 | `Must include` |
| `catalog_filter_group_other` | 1969 | `Other` |
| `catalog_searching_tags` | 1970 | `Searching tags...` |
| `catalog_nsfl_warning_title` | 1971 | `NSFL Content Warning` |
| `catalog_nsfl_warning_desc` | 1972 | `Trust me, you don't want to do this.` |
| `catalog_nsfl_btn` | 1973 | `I have nothing to lose` |
| `catalog_nsfl_btn_cancel` | 1974 | `I'm too young to die` |
| `catalog_chub_timeline_no_filters` | 1986 | `Chub Timeline doesn't support filters` |
| `chub_nsfl_login_desc` | 1938 | `To show NSFL characters you have to sign in to a Chub account. This is a site limitation. Sign in?` |
| `chub_nsfl_login_btn` | 1939 | `Sign in` |
| `chub_nsfl_account_hint` | 1951 | `Account-level — only applies while signed in.` |
| `catalog_search_placeholder` | 1556 | `Search characters...` |
| `catalog_empty` | 1558 | `No characters found` |
| `catalog_end` | 1559 | `That's all` |
