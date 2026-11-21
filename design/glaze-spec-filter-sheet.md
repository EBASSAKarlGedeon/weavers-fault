# Glaze — Catalog Filter Sheet: pixel-exact UI spec

Extracted from `C:/Users/Gedeon/Documents/Coding/Glaze-stable` (Flutter, `lib/`).
Every number below is taken verbatim from source; citations are `file:line`.
Resolved theme-role colors are given for the **default dark preset** (accent
`#C42A4A`); the role → hex mapping is derived in §0.

Primary files:

- `lib/features/catalog/widgets/catalog_filter_sheet.dart` (the stateful sheet)
- `lib/shared/widgets/filter_sheet.dart` (generic `FilterSheet` renderer + range/number rows)
- `lib/shared/widgets/filter_tag_picker.dart` (tags card, search field, chips)
- `lib/shared/widgets/menu_group.dart` (group cards, switch rows, collapsible section)
- `lib/shared/widgets/sheet_view.dart` (sheet container: handle, header, scroll, chrome)
- `lib/shared/widgets/glaze_sheet.dart` (`showGlazeSheet` — how the sheet is presented, incl. desktop window)
- `lib/shared/widgets/glaze_bottom_sheet.dart` (only used by the NSFL sub-dialogs inside this sheet)
- `lib/shared/theme/app_theme.dart`, `lib/shared/theme/app_colors.dart`, `lib/shared/theme/theme_preset.dart`

---

## 0. Theme role → exact color (default dark preset)

From `app_theme.dart`:

| Role | Value | Source |
|---|---|---|
| Accent / `primary` | `#C42A4A` | `theme_preset.dart:27` (`@Default('#C42A4A') String accentColor`) |
| `surface` (sheet fill, app bg) | `#19191A` | `app_theme.dart:54` (`_vueAppBg`) |
| `surfaceContainerHighest` (= `surfaceContainerLow…Highest` all pinned) | `#1E1E1E` | `app_theme.dart:55` (`_vueUiBg`), pinned at `app_theme.dart:84–88` |
| `onSurface` | `#E1E3E6` | `color_utils.dart:35` — `contrastFor(#1E1E1E)`: luminance < 0.5 → light constant `0xFFE1E3E6` |
| `onSurfaceVariant` | `#B0B8C1` | `color_utils.dart:34` (`secondary: true` → `0xFFB0B8C1`) |
| `outline` (input/card borders) | `#2C2D2E` | `app_theme.dart:196–203` — `_borderFor(#1E1E1E, dark)`: luminance < 0.35 → `0xFF2C2D2E` |
| `outlineVariant` | `white @ 10%` (`0x1AFFFFFF`) | `app_theme.dart:64–66` |
| `error` | `#CF6679` | `app_theme.dart:73` |
| Danger color (NSFL switch) | `#FF5A5F` | `filter_sheet.dart:308` (`const _dangerColor`) |
| Destructive red (bottom-sheet items) | `#FF4444` | `glaze_bottom_sheet.dart:624, 898` |
| Font | **Inter** (bundled variable font; weights driven via `FontVariation('wght', …)`) | `app_theme.dart:9`, `app_theme.dart:29–30` |
| `visualDensity` | **`VisualDensity.compact`** app-wide | `app_theme.dart:289` |
| Sheet max width | `BoxConstraints(maxWidth: 640)` | `app_theme.dart:221` (`kSheetMaxWidthConstraints`), applied to every modal sheet at `app_theme.dart:314` |
| Element opacity / blur / noise | `0.8` / `12` / `0.03` | `theme_preset.dart:29–30,76` |

Composite values used below:

- **Group-card fill** (`GlassSurface` inside the opaque sheet): tint =
  `#1E1E1E @ elementOpacity 0.8` composited once over the sheet's opaque
  `FlatBackdrop` (`#19191A`) → each channel `0.8·30 + 0.2·25 = 29` →
  **`#1D1D1D`** (glass_surface.dart:88–97; alpha ≥ 1 ⇒ the per-frame blur is
  skipped, glass_surface.dart:112–121 — cards render as *solid* `#1D1D1D`).
- **Chip fill (unselected)**: `onSurface @ 0.05` over card `#1D1D1D` →
  ≈ `#272727` composited.

---

## 1. Sheet container

### 1.1 Presentation (`catalog_controls.dart:182–195` → `glaze_sheet.dart:113–140`)

Opened with `showGlazeSheet(isScrollControlled: true, useRootNavigator: true,
useSafeArea: true, backgroundColor: Colors.transparent)`.

**Phone/tablet** (`glaze_sheet.dart:133–140`): plain
`showModalBottomSheet` — transparent bg (the content paints itself), default
`barrierColor` = `Colors.black54` (Flutter default), theme supplies
`maxWidth: 640` (`app_theme.dart:314`), drag-to-dismiss enabled.

**Desktop** (`glaze_sheet.dart:77–84, 106–133`): NOT a bottom band. The same
content opens as a **centered, resizable floating window**:

- Width: `min(0.92 × window width, 640)` (`glaze_sheet.dart:213–215`; cap
  `kGlazeSheetWindowMaxWidth = 640`, glaze_sheet.dart:9)
- Height: fixed at `0.85 × window height` (`_kGlazeSheetWindowHeightFactor =
  0.85`, glaze_sheet.dart:12; `maxHeight = bounds.height * 0.85`,
  glaze_sheet.dart:215) — this sheet does NOT pass `windowContentSized`
- Window frame (`desktop_window_chrome.dart:32–57`): `GlassSurface`,
  radius **16** on all corners, border `outlineVariant` (`white @ 10%`),
  shadow `black @ alpha(active ? 0.5 : 0.3)`, `blurRadius active ? 40 : 24`,
  `spreadRadius active ? 4 : 0`; title bar height **52**
  (`desktop_window_geometry.dart:11`), then a 1px `outlineVariant` divider.
- Title bar (`desktop_window_chrome.dart:96–180`): title **"Filters"**,
  fontSize **17**, **w700**, `onSurface` when the window is active
  (`onSurface @ 0.55` when not); close button `Icons.close_rounded` size 20,
  color `onSurfaceVariant` (compact-density IconButton); maximize button
  `Icons.crop_square_rounded` size 18. Route transition: 180 ms fade +
  scale 0.97 → 1, `easeOutCubic` (glaze_sheet.dart:82–84, 121–133).
- Inside the window, `SheetView` drops its own header row and hands
  "Filters" + actions to the window title bar (`sheet_view.dart:331–352`,
  `_buildWindow` at `sheet_view.dart:1014–1046`).

### 1.2 Sheet chrome (`sheet_view.dart`)

`FilterSheet` builds a `SheetView(title, showHandle: true, bodyPadding: 0)`
containing a `ListView` (`filter_sheet.dart:220–240`):

- **Corner radius**: top edge only, **20** (`_kSheetCornerRadius = 20`,
  sheet_view.dart:20, applied sheet_view.dart:1059–1068) — constant at every
  height, so the expanded sheet keeps rounded corners.
- **Background**: solid opaque `surface` = **`#19191A`**
  (`sheet_view.dart:1042–1049` `ColoredBox(color: cs.surface.withValues(alpha: 1.0))`).
- **Border**: top edge only, `outlineVariant` (`white @ 10%`), painted as a
  *foreground* decoration (`glazeSheetBorder`, glaze_sheet.dart:15–19;
  sheet_view.dart:1062–1068).
- **Height behavior**: starts **collapsed at 85% of screen height**
  (`_collapsed`: `h * 0.85`, sheet_view.dart:255–264), draggable/snap to
  fullscreen; 350 ms `easeOutCubic` snap animation (sheet_view.dart:265–267).
- **Drag handle (grabber)**: centered bar, width **36** (collapsed) → animates
  to **24** when expanded, height **4**, radius **2**, color
  `white @ alpha(0.35)` collapsed / `0.6` expanded, 300 ms animation;
  surrounding vertical padding **10** ⇒ handle strip is 24 px tall
  (sheet_view.dart:1478–1502). This sheet never auto-expands, so it shows the
  36×4 / white@0.35 state.
- **Header row (below the handle)**: padding `EdgeInsets.fromLTRB(16, 0, 16, 12)`
  (sheet_view.dart:1505). Title **"Filters"** — fontSize **18**, **w700**,
  color `onSurface` (`#E1E3E6`), maxLines 1, ellipsis (sheet_view.dart:1518–1526).
  **There is NO close button** in the sheet header: `showBack: false` and
  `actions: []` — the sheet closes by drag-down, back, or (desktop) the window
  close button.
- **Header scrim**: `TopEdgeBlur` over the scrolling body — height
  `headerHeight + 8` (header = 24 handle + ~52 title row = ~76 → strip ≈ 84),
  sigma **24**, tint `surface @ 0.88` (sheet_view.dart:1184–1192).
- **Scrolling**: body is a `ListView` (filter_sheet.dart:225–234) with padding
  `EdgeInsets.fromLTRB(0, top + 8, 0, bottom + 32)` where `top` = the measured
  header height (~76; `sheet_view.dart:1236–1244` injects `_headerBaseH` into
  `MediaQuery.padding.top`) and `bottom` = nav-bar inset + 16
  (`navInset`, sheet_view.dart:1311–1314). ⇒ first card sits **8 px** under the
  header; after the last card there is 32 px (+ safe area).
- **Scrollbar**: persistent `RawScrollbar`, thickness **6**, radius **3**,
  `thumbVisibility: true` (sheet_view.dart:1637–1646; RawScrollbar default
  thumb color). Desktop sheet also shows a scrollbar
  (`white @ 0.15`, thickness 4, radius 3, right padding 3 — that variant is in
  `GlazeBottomSheetFrame`'s list, not this one).
- **No bottom action bar / no Apply button anywhere in this sheet.** Filters
  commit **on close** (`dispose()` diffs state and calls `onApply`,
  catalog_filter_sheet.dart:222–262). The only button-like header control is
  the tags card's "Clear (N)" (§2.4).
- Max width 640 via theme constraints; the `SheetView` itself centers
  (`Alignment.topCenter`, sheet_view.dart:1322).

---

## 2. Section-by-section content

All sections are rendered by `FilterSheet` (`filter_sheet.dart:220–297`) as an
ordered list inside the `ListView`. Every titled group renders as a **`MenuGroup`
card**: outer padding `EdgeInsets.fromLTRB(16, 0, 16, 12)`
(menu_group.dart:471–479) ⇒ 16 px side gutters, 12 px gap between cards,
`GlassSurface` with radius **20**, border `Border.all(outlineVariant)` =
1px `white @ 10%`, fill `#1D1D1D` (see §0), tap-glow ripple in `primary`
(menu_group.dart:481–487; glass_surface.dart:265–276).

**Group header (accent-caps variant, `menu_group.dart:530–586`)** — used by
every filter group (`filter_sheet.dart:283–287`):

- Padding `EdgeInsets.fromLTRB(16, 16, 8, 4)` (when the group has rows;
  `bottomPad = 4` when no description, menu_group.dart:536–539)
- Label = `title.toUpperCase()`, color `primary` (`#C42A4A`),
  `FontWeight.w700`, fontSize **13**, `letterSpacing: 0.3`
  (menu_group.dart:562–575)
- Optional trailing widget on the same row (the tags card uses it — §2.4)

**Section order for the Catalog filter sheet** (`catalog_filter_sheet.dart:397–444`):

1. **CONTENT** group (always)
2. Timeline mode → hint only (§2.7). Otherwise:
3. **CARD** group (providers with token range)
4. (Chub only) **MUST INCLUDE** collapsible group
5. (Chub only) **OTHER** group
6. **TAGS** card
7. (Janitor + signed in) **BLOCKED TAGS** card

### 2.1 CONTENT group — `catalog_filter_group_content` = **"Content"**

`FilterGroupSection(title: 'Content', rows: …)` (`catalog_filter_sheet.dart:127–152`)
→ `MenuGroup(headerVariant: accentCaps)` (`filter_sheet.dart:277–289`).

Header text: **"CONTENT"**.

Rows (each a `MenuSwitchItem`, menu_group.dart:725–800):

- Row padding `EdgeInsets.symmetric(horizontal: 16, vertical: 10)`
- Layout: **label left, switch right** — `Expanded(label column)` + 16 px gap +
  `GlazeSwitch`
- Label style: fontSize **16**, `FontWeight.w400`, color
  `onSurfaceVariant` (`#B0B8C1`) (menu_group.dart:754–763)
- Optional description under label: fontSize 12, color `#99A2AD`
  (menu_group.dart:764–772; the filter sheet passes none)
- Rows in this group, in order:
  1. **"Show NSFW"** (`catalog_filter_nsfw`) — value `_nsfw`
  2. (Chub only) **"Show NSFL"** (`catalog_filter_nsfl`) — `isDanger: true` →
     the switch's active color is **`#FF5A5F`** instead of accent
     (catalog_filter_sheet.dart:141; filter_sheet.dart:290–296; glaze_switch.dart:31–44).
     Toggling on opens a confirmation dialog (§6); while signed out it opens a
     login prompt instead.
  3. (Chub, non-timeline) **"NSFW only"** (`catalog_filter_nsfw_only`)

### 2.2 CARD group — `catalog_filter_group_card` = **"Card"**

`FilterGroupSection(title: 'Card')` (catalog_filter_sheet.dart:154–184). Hidden
entirely for DataCat (`CatalogControls.supportsTokenRange`).

Header: **"CARD"**.

**Row 1 — "Token Range"** (`FilterRangeSection` → `_RangeRow`,
filter_sheet.dart:363–402):

- Outer padding `EdgeInsets.fromLTRB(16, 10, 16, 10)`
- Label "Token Range" on its own line: fontSize **16**, **w400**,
  color `onSurfaceVariant` (`#B0B8C1`) (`_rowLabelStyle`, filter_sheet.dart:310)
- `SizedBox(height: 10)`
- Then **one row, two numeric fields with an en-dash between**:
  `Expanded(_NumberField(min, prefix "Min"))` + `Padding(horizontal: 10)` with
  a `Text('–', fontSize 16, color onSurfaceVariant)` + `Expanded(_NumberField(max, prefix "Max"))`
  (filter_sheet.dart:378–396)
- Defaults: min **29**, max **100000** (`catalog_models.dart:49–50`)
- **`_NumberField`** (filter_sheet.dart:432–522):
  - `TextField`, `keyboardType: number`, digits-only formatter,
    `textAlign: TextAlign.end` when it has a prefix (center when not)
  - Text style: fontSize **15**, color `onSurface` (`#E1E3E6`),
    `FontFeature.tabularFigures()` (filter_sheet.dart:490–495)
  - Decoration: `isDense: true`, `contentPadding:
    EdgeInsets.symmetric(horizontal: 12, vertical: 11)` (filter_sheet.dart:497–501)
  - Prefix ("Min"/"Max"): a `Text` fontSize **13**, color `onSurfaceVariant`,
    inside `Padding(EdgeInsets.only(left: 12, right: 8))`,
    `prefixIconConstraints: BoxConstraints()` (zero min — the text sets its own
    width) (filter_sheet.dart:502–520)
  - Everything else comes from the theme's `inputDecorationTheme`
    (app_theme.dart:334–353): **filled**, fillColor `#1E1E1E`
    (`surfaceContainerHighest`), radius **12**, enabled/focused border
    `OutlineInputBorder` — enabled 1px `#2C2D2E` (`outline`), focused 1px
    `#C42A4A` (`primary`).
- An emptied field snaps back to the committed value on blur
  (filter_sheet.dart:461–470).

**Rows 2–3 (Chub only) — number rows** (`FilterNumberSection` → `_NumberRow`,
filter_sheet.dart:312–359):

- Padding `EdgeInsets.fromLTRB(16, 8, 16, 8)`
- **Label left, one compact number field right** (`SizedBox(width: 96)`,
  16 px gap between label and field)
- Label fontSize **16**, **w400**, `onSurfaceVariant`
- Field = `_NumberField` without prefix: `textAlign: TextAlign.center`,
  same theme decoration as above
- Rows: **"Minimum AI rating"** (`catalog_filter_min_ai_rating`) and
  **"Minimum tag count"** (`catalog_filter_min_tags`), both labeled `Min`.

### 2.3 MUST INCLUDE group (Chub only) — **"Must include"**, collapsible

`FilterGroupSection(collapsible: true)` → `MenuCollapsibleSection`
(catalog_filter_sheet.dart:186–222; filter_sheet.dart:292–302;
menu_group.dart:60–167):

- Outer padding `EdgeInsets.fromLTRB(16, 0, 16, 12)`; `GlassSurface` radius
  **20**, border 1px `outlineVariant` (menu_group.dart:128–137)
- Collapsed label: `"Must include · N"` where **N** = number of active rows
  (`filter_sheet.dart:298`); opens itself on mount when any row is active
  (`initiallyExpanded: active > 0`)
- Header padding `EdgeInsets.symmetric(horizontal: 16, vertical: 14)`
  (menu_group.dart:156); label fontSize **16**, **w600 when expanded /
  normal (w400) when collapsed**; color `onSurface` expanded,
  `onSurfaceVariant` collapsed (menu_group.dart:166–178)
- Chevron `Icons.keyboard_arrow_down_rounded` (default size 24), color
  `primary` expanded / `onSurfaceVariant` collapsed, animated 150 ms
  (menu_group.dart:179–189)
- **Expanded header wash**: vertical linear gradient
  `primary @ 0.22 → primary @ 0.0`, animated 150 ms (menu_group.dart:140–155)
- Nested `MenuGroup` renders flat inside (no own card/gutters; a 1px
  `outlineVariant` rule separates it from the next nested group,
  menu_group.dart:437–445, 495–500)

Rows (5 `MenuSwitchItem`s, same style as §2.1): **"With gallery images"**,
**"With lorebooks"**, **"With custom prompt"**, **"With example dialogues"**,
**"With alternate greetings"**.

### 2.4 OTHER group (Chub only) — **"Other"**

Regular `MenuGroup` (non-collapsible). Rows (menu-switch style of §2.1):
**"Recommended / verified"**, **"Exclude my characters"**.

### 2.5 TAGS card — `catalog_tags` = **"Tags"** (`FilterTagPicker`, filter_tag_picker.dart)

A `MenuGroup` with the accent-caps header **"TAGS"** and a header-trailing
clear button (filter_tag_picker.dart:157–163).

**Content container padding**: `EdgeInsets.fromLTRB(16, 6, 16, 10)`
(filter_tag_picker.dart:182). Inside, top-to-bottom:

1. **Selected chips** (only when `_selectedCount > 0`): a `Wrap` with
   `spacing: 6, runSpacing: 6` of *selected-state* chips (§3), then
   `SizedBox(height: 12)` (filter_tag_picker.dart:186–204)
2. **Search field** (`FilterSearchField`, §5), then `SizedBox(height: 12)`
   (filter_tag_picker.dart:205–212)
3. **Chip grid** (§3) — a `Wrap(spacing: 6, runSpacing: 6)`
4. **"Show all (N)" expander** (only when the list folds, §3.1)
5. Empty/loading hints (§3.2)

Behavior: curated tags only (no search) show every *unselected* tag; typing
switches to local matches (starts-with first, then contains) followed by
remote suggestions; picking a chip from search results clears the query;
a new query re-folds the grid (filter_tag_picker.dart:63–120, 245–296).

**Clear button** (`FilterClearButton`, filter_sheet.dart:524–547) in the
header: `TextButton`, foreground `primary`, `VisualDensity.compact`,
padding `EdgeInsets.symmetric(horizontal: 8)`, text
**"Clear ({count})"** — fontSize **13**, **w600**.

### 2.6 BLOCKED TAGS card (Janitor, signed in) — `catalog_blocked_tags` = **"Blocked tags"**

Same `MenuGroup`/accent-caps layout as TAGS with the same clear button
(janitor_blocked_content_section.dart:126–200). Content padding
`fromLTRB(16, 6, 16, 10)`; selected blocked entries as selected chips
(Wrap 6/6, then 12), then `FilterSearchField` (hint **"Block a tag..."**),
then — while a query is active only — a `Wrap(spacing: 6, runSpacing: 6)`
with an "add keyword" chip (`Icons.block_rounded`, label
`Block tag "{keyword}"`) plus up to **8** tag matches and **8** suggestion
chips (`take(8)`, janitor_blocked_content_section.dart:117–123).

### 2.7 Timeline hint (Chub Timeline mode)

`FilterCustomSection(child: _TimelineFiltersHint)` → padding
`EdgeInsets.fromLTRB(16, 4, 16, 16)` (filter_sheet.dart:240–249). Row:
`Icons.info_outline_rounded` size **16** color `onSurfaceVariant`, 10 px gap,
text **"Chub Timeline doesn't support filters"** — fontSize **13**, color
`onSurfaceVariant`, `height: 1.35` (catalog_filter_sheet.dart:463–486).

---

## 3. Tag chip component (`FilterTagChip`, filter_tag_picker.dart:561–635)

`Material` + `StadiumBorder` (fully rounded pill), `clipBehavior: antiAlias`,
InkWell with hand cursor + haptic on tap.

**Unselected:**

- Fill: `onSurface @ 0.05` → ≈ `#272727` composited over the `#1D1D1D` card
- Border: 1px `outlineVariant` = `white @ 0.1`
- Padding: `EdgeInsets.fromLTRB(12, 6, 12, 6)`
- Label: fontSize **13**, `height: 1.2`, color `onSurfaceVariant` (`#B0B8C1`),
  maxLines 1, ellipsis

**Selected:**

- Fill: `primary @ 0.22` (`#C42A4A` @ 22%)
- Border: 1px `primary @ 0.7`
- Padding: `EdgeInsets.fromLTRB(12, 6, 8, 6)` — right side narrows to 8
- Label: fontSize **13**, color **`onSurface` (`#E1E3E6`)**
- Trailing remove mark: `Icons.close_rounded` size **14**, same `onSurface`
  color, after a 4 px gap

**Icon-led chip** (e.g. `Search by tag "…"` with `Icons.add_rounded` size 16
in `primary`, 4 px gap after the icon): left padding narrows to **8**
(filter_tag_picker.dart:603–612).

Height: 6+6 padding + 13·1.2 ≈ **27–28 px** pill.

### 3.1 "Show all" expander (filter_tag_picker.dart:298–338)

- Appears only when the pool exceeds `collapsedCount + 6` = **30**
  (`collapsedCount` default **24**, filter_sheet.dart:171;
  `folds = tags.length > limit + 6`, filter_tag_picker.dart:252)
- Collapsed shows the first **24** chips
- `TextButton.icon`: foreground **`primary`**, `VisualDensity.compact`,
  padding `EdgeInsets.symmetric(horizontal: 4)`, preceded by
  `Padding(EdgeInsets.only(top: 6))`
- Icon: `Icons.keyboard_arrow_down_rounded` (or `keyboard_arrow_up_rounded`
  when expanded), size **18**
- Label: **"Show all ({count})"** / **"Show less"** — fontSize **13**,
  **w600**

### 3.2 Empty / loading states

- Loading: centered 20×20 `GlazeSpinner(strokeWidth: 2)` (arc color
  `primary`, faint track tint of it), inside `Padding(vertical: 12)`
  (filter_tag_picker.dart:214–224)
- Empty: `Padding(vertical: 6)`, `Text` fontSize **13**, color
  `onSurfaceVariant` — "No tags yet" / "No tags found" / "Searching tags..."
  (filter_tag_picker.dart:340–350)

---

## 4. Toggle component

`GlazeSwitch` (glaze_switch.dart:16–45) = stock **Material 3 `Switch`** with
`VisualDensity.compact` applied app-wide (app_theme.dart:289) — M3 metrics
track 52×32 / thumb 24 shrink by the compact density (≈ **44×28**, thumb ≈ 20).

Colors:

- **On**: thumb = `primary` (`#C42A4A`) — `GlazeSwitch` overrides the theme
  (glaze_switch.dart:31–33); track = `primary @ 0.5`
  (glaze_switch.dart:34). Theme default track when *selected* is solid
  `primary` (app_theme.dart:362–371) — GlazeSwitch's 0.5-alpha track wins.
- **Off**: thumb **white** (theme `switchTheme.thumbColor: all(Colors.white)`,
  app_theme.dart:363); track = `onSurface @ 0.3` (app_theme.dart:365–367) →
  `#E1E3E6` @ 30%; track outline = `outlineVariant` (`white @ 0.1`) when
  unselected, `transparent` when selected (glaze_switch.dart:35–43).
- **Danger variant** (NSFL): thumb `#FF5A5F`, track `#FF5A5F @ 0.5`
  (filter_sheet.dart:290–296 → glaze_switch.dart:31–34).
- All switches render with the **hand cursor** on desktop
  (app_theme.dart:204–246 forces `SystemMouseCursors.click` on every enabled
  Material control).

Row composition (`MenuSwitchItem`): label **left**, switch **right**, 16 px
gap, row padding 16/10 (menu_group.dart:725–800).

---

## 5. Search field component (`FilterSearchField`, filter_tag_picker.dart:467–521)

`TextField` on the **theme's** `inputDecorationTheme`:

- Text: fontSize **15**, color `onSurface` (`#E1E3E6`)
- Hint: color `onSurfaceVariant` (`#B0B8C1`), no explicit size → merges with
  the theme's default input style (16 at default settings)
- `isDense: true`, `contentPadding: EdgeInsets.symmetric(vertical: 12)`
- Leading: `Icons.search_rounded` size **20**, color `onSurfaceVariant`
- Trailing: while loading → 16×16 `GlazeSpinner(strokeWidth: 2)` inside
  `Padding(all: 12)`; else, when there is text → `IconButton`
  (`Icons.close_rounded` size 18, color `onSurfaceVariant`, compact density)
- Fill `#1E1E1E`, radius **12**, border 1px `#2C2D2E` (enabled) /
  `#C42A4A` (focused) — all from `app_theme.dart:334–353`
- `textInputAction: search` (or `done` when custom tags are allowed; submit
  adds the raw query as a tag)
- Debounce for remote suggestions: **250 ms** (filter_tag_picker.dart:74)

---

## 6. Sub-dialogs (NSFL), rendered via `GlazeBottomSheet.show`

Shown as a **chrome-less, content-sized desktop window / phone bottom sheet**
(glaze_bottom_sheet.dart:180–206):

- Phone: modal bottom sheet, barrier `Colors.black54`, top radius 24
  (`BorderRadius.vertical(top: Radius.circular(24))`), solid fill
  `surface` (`#19191A`), top border `outlineVariant`, drag handle 32×4
  `white @ 0.35`, vertical padding 10 (glaze_bottom_sheet.dart:366–399,
  466–475, 1317–1338)
- Desktop: centered window, radius **16** on all sides, shadow
  `black @ 0.5, blurRadius 40, spreadRadius 4` (glaze_sheet.dart:400–424),
  no title bar (the content supplies its own header: `_Header` — padding
  `fromLTRB(20, 0, 12, 16)`, title fontSize 18 w700 `onSurface`,
  glaze_bottom_sheet.dart:1466–1512) — plus the same 32×4 handle and a
  20 px top inset in window mode
- **Big info block** (`_BigInfo`, glaze_bottom_sheet.dart:2040–2079): padding
  `fromLTRB(20, 12, 20, 20)`; icon 64 (`Icons.lock_outline_rounded` for the
  login prompt / `Icons.warning_amber_rounded` for the confirm) color
  `onSurfaceVariant @ 0.5`; 16 px gap; description fontSize **16**, color
  `onSurface`, `height: 1.5`, centered
- **Item rows** (`_ItemRow`, glaze_bottom_sheet.dart:612–660): rows sit in a
  card — fill `white @ 0.06`, border 1px `white @ 0.1`, radius **16**
  (glaze_bottom_sheet.dart:941–963); row padding
  `EdgeInsets.symmetric(horizontal: 16, vertical: 14)`; label fontSize **16**,
  color `onSurface` (or `#FF4444` destructive); pressed tint
  `white @ 0.08` (100 ms)
- Dialog buttons are **centered** (`centered: true`): the confirm is
  destructive (**"I have nothing to lose"**) and cancel (**"I'm too young to
  die"**) is normal; the login prompt's single button is **"Sign in"**

---

## 7. Material theme defaults that affect rendering (dark theme, app_theme.dart:279–406)

- `useMaterial3: true`, `blendLevel: 0`, `visualDensity: VisualDensity.compact`
  (289)
- `dialogTheme`: bg `surfaceContainerHighest` = `#1E1E1E` (302–304)
- `bottomSheetTheme`: bg + modal bg `#1E1E1E`, `surfaceTintColor: surface`,
  constraints `maxWidth: 640` (305–316) — though both sheets here paint
  transparent and fill themselves with `#19191A`
- `cardTheme`: bg `#1E1E1E`, radius 16, 1px `outline` border, elevation 0
  (317–326)
- `inputDecorationTheme` (334–353): filled, fillColor `#1E1E1E`, radius 12,
  enabled border 1px `#2C2D2E`, focused border 1px `#C42A4A`
- `textButtonTheme`: foreground `onSurface` (355–357)
- `switchTheme` (362–371): thumb always white; selected track `primary`,
  unselected `onSurface @ 0.3`; outline always transparent (GlazeSwitch
  overrides thumb/active-track/outline as in §4)
- `scaffoldBackgroundColor` / `canvasColor` = `surface` `#19191A` (291–293)
- `iconTheme`: color `onSurface` (372–373)
- Text theme: Inter, body color `onSurface`, per-role weights driven via
  `FontVariation('wght', …)`; UI font size factor = `uiFontSize / 15.0`
  (default 15 ⇒ factor 1.0), UI letter-spacing and weight deltas applied
  app-wide (theme_preset.dart defaults; app_theme.dart:275–288, 374–387)
- Mouse cursors: every enabled Material control gets the **hand pointer**;
  disabled gets the plain arrow (app_theme.dart:204–246)
- Desktop sheet-window scrollbar: `white @ 0.15`, 4 px, radius 3
  (glaze_bottom_sheet.dart:498–505 — used by `GlazeBottomSheetFrame`, not by
  `SheetView`)

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
   - **TAGS** (+ "Clear (N)" 13px/600 accent in header; 6/10 vertical padding;
     selected chip wrap 6/6 + 12; search field (radius 12, filled `#1E1E1E`,
     20px search glyph, 15px text, vertical 12 padding) + 12; chip grid
     6/6; ≤24 chips collapsed, fold at >30, "Show all (N)" 13px/600 accent
     with 18px chevron, 6 px above)
   - (Janitor) **BLOCKED TAGS** (same card anatomy as TAGS)
4. 32 px (+ safe area) below the last card; nothing pinned at the bottom —
   **no Apply/Reset bar**; state commits when the sheet closes
5. Desktop: the same body inside a 640-max, 85%-height centered resizable
   window with a 52 px title bar ("Filters" 17px/700 + close ✕), 16 px
   radius, 1px `rgba(255,255,255,0.1)` border, black 40-blur shadow
