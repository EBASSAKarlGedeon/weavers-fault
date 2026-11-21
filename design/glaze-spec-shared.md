# Glaze — Shared widget library: pixel-exact UI spec

Extracted from `C:/Users/Gedeon/Documents/Coding/Glaze-stable` (Flutter,
version 0.10.1 per `pubspec.yaml`). **Every value below was read directly from
the source of the fresh clone**; citations are `file:line`. Theme roles are
resolved to hex for the **default dark preset** (accent `#C42A4A`) — the full
role → hex table is §0.

Companion specs: `glaze-spec-filter-sheet.md` (catalog filter sheet, and its
§0/§7 share this theme table's content), `glaze-spec-catalog.md` (catalog
screens). Strings not covered by those two are in §13 here.

---

## 0. Theme role → exact color (default dark preset)

### 0.1 ColorScheme (dark) — `app_theme.dart:58–104`

| Role | Value | Source |
|---|---|---|
| `primary` / `tertiary` (accent) | `#C42A4A` | `theme_preset.dart:27` (`@Default('#C42A4A') String accentColor`); parse fallback `theme_preset.dart:292`; applied `app_theme.dart:78,82` |
| `onPrimary` / `onTertiary` (btnFg) | `#E1E3E6` | `app_theme.dart:71–73` — accent luminance > 0.35 ? `#1A1A1B` : `#E1E3E6`; `#C42A4A` is dark ⇒ `#E1E3E6` |
| `secondary` | `#828282` | `app_theme.dart:75,80` (`defaultSecondary`) |
| `onSecondary` | white | `app_theme.dart:81` |
| `error` | `#CF6679` | `app_theme.dart:84` |
| `onError` | white | `app_theme.dart:85` |
| `surface` (app bg, sheet fill) | `#19191A` | `app_theme.dart:55` (`_vueAppBg`), assigned `:63,86` |
| `onSurface` | `#E1E3E6` | `color_utils.dart:35` via `contrastFor(uiColor)` at `app_theme.dart:64,87` |
| `surfaceTint` | = `surface` `#19191A` | `app_theme.dart:89` (M3 tint neutralised) |
| `surfaceDim` | `#19191A` | `app_theme.dart:93` |
| `surfaceBright`, `surfaceContainerLow`, `surfaceContainer`, `surfaceContainerHigh`, `surfaceContainerHighest` | `#1E1E1E` (all pinned) | `app_theme.dart:56` (`_vueUiBg`) pinned at `:94–99` |
| `onSurfaceVariant` | `#B0B8C1` | `color_utils.dart:34` (secondary) via `app_theme.dart:65,100` |
| `outline` | `#2C2D2E` | `app_theme.dart:67` via `_borderFor` `:185–191` — dark + `computeLuminance() < 0.35` ⇒ `0xFF2C2D2E`; above 0.35 it would be `#5C5D5E` |
| `outlineVariant` | `white @ 10%` (`0x1AFFFFFF`) | `app_theme.dart:68–70` |

### 0.2 `GlazeColors` theme extension — `app_colors.dart:51–78`

| Role | Value | Source |
|---|---|---|
| `accent` | `#C42A4A` | `app_colors.dart:74–78` (`GlazeColors.dark`), overridden from preset at `:115–118` |
| `userBubble` | `#C42A4A` | `app_colors.dart:76`, `:120` |
| `charBubble` (dark) | `#1E1E1E` | `app_colors.dart:77` |
| default italic | `#888888` | `app_colors.dart:87` |
| `inputFill` (dark) | **`#252525`** | `app_colors.dart:225–227` — literal dark value used by `MenuFieldItem`/`MenuSelectorItem`/`MenuRangeItem` value fields (NOT by theme-`InputDecorationTheme` fields, which use `#1E1E1E`) |

### 0.3 Theme-level defaults (dark) — `app_theme.dart:254–457`

- `useMaterial3: true`, `blendLevel: 0` (`:284–285`);
  `visualDensity: VisualDensity.compact` (`:292`)
- **`inputDecorationTheme`** (`:342–357`): `filled: true`, fillColor
  `surfaceContainerHighest` = `#1E1E1E`, all three borders
  `OutlineInputBorder` radius `12 * cornerScale` — enabled/default 1px
  `outline` `#2C2D2E` (`:345–352`), focused 1px `primary` `#C42A4A` (`:353–356`)
- **`dialogTheme`** (`:305–308`): backgroundColor `#1E1E1E`, radius `16 * cornerScale`
- **`bottomSheetTheme`** (`:309–322`): backgroundColor + modalBackgroundColor
  `#1E1E1E`, `surfaceTintColor: surface`, top corners `20 * cornerScale`,
  `constraints: kSheetMaxWidthConstraints` = `BoxConstraints(maxWidth: 640)`
  (`:198`, applied `:321`)
- **`cardTheme`** (`:334–341`): color `#1E1E1E`, elevation 0, radius
  `16 * cornerScale`, 1px `outline` side
- **`popupMenuTheme`** (`:323–327`): color `#1E1E1E`, surfaceTint `surface`,
  radius `12 * cornerScale`
- **`appBarTheme`** (`:328–333`): transparent background, foreground
  `onSurface`, elevation 0, scrolledUnderElevation 0
- **`elevatedButtonTheme`** (`:358–366`): bg = `_ensureButtonContrast(primary,
  surface)` — `app_theme.dart:162–183` lightens the accent stepwise (+0.04 L)
  until contrast ≥ 4.5, falling back to HSL L=0.6; foreground `btnFg`
  (`:278–280`, `#E1E3E6` for a dark button bg), radius `8 * cornerScale`
- **`filledButtonTheme` / `outlinedButtonTheme` / `iconButtonTheme`**
  (`:367–395`): radius `20 * cornerScale` (base Flex styles otherwise)
- **`textButtonTheme`** (`:381–388`): foreground always `onSurface` (`#E1E3E6`),
  radius `20 * cornerScale`
- **`switchTheme`** (`:396–403`): thumbColor always `Colors.white`; trackColor
  selected = `primary`, otherwise `onSurface @ 0.3` (`#E1E3E6 @ 30%`);
  trackOutlineColor always `transparent`
- **`iconTheme`** (`:404`): color `onSurface`
- **`textSelectionTheme`** (`:300–304`): cursor + handle `primary`,
  selection `primary @ 0.3`
- **`scaffoldBackgroundColor` / `canvasColor`** = `surface` `#19191A` (`:298–299`)
- **Text theme** (`:405–412` via `_applySafe` `:13–52`): Inter
  (`kInterFontFamily`, `:11`); every role gets `FontVariation('wght', weight)`
  because the bundled Inter is a variable font (`:28–31`); fontSize factor =
  `uiFontSize / 15.0` (`:269`) — default `uiFontSize` is `dynamic 'system'`
  resolving to 15.0 (`theme_preset.dart:47,256–260`) ⇒ factor 1.0; letterSpacing
  delta `uiLetterSpacing` (default 0, `theme_preset.dart:49`); default weight
  `uiFontWeight` 400 (`theme_preset.dart:48`)
- **`scrollbarTheme`: NOT SET** — `grep -rn "scrollbarTheme" lib/` returns
  nothing; scrollbars use Material defaults except where widgets configure a
  `RawScrollbar` explicitly (§5, §8)
- **Mouse cursors** (`:207–251`): every enabled Material control gets
  `SystemMouseCursors.click` (hand); disabled gets `SystemMouseCursors.basic`
- `cornerScale` default **1.0** (`theme_preset.dart:71`) so all radii render at
  their design values; `GlazeUiScale` extension (`ui_scale.dart:10–61`)
  multiplies them (`context.glazeRadius/glazeBorderRadius`)
- Preset effect defaults: `elementOpacity 0.8` (`theme_preset.dart:29`),
  `elementBlur 12` (`:30`), `noiseOpacity 0.03` (`:81`), `noiseIntensity 0.8`
  (`:82`), `bgBlur 0` (`:28`)

---

## 1. `GlassSurface` — `lib/shared/widgets/glass_surface.dart`

The base glassmorphic surface every card/chrome piece is built from.

- Props: `borderRadius`, `tint`, `border`, `borderOnTop` (paints the border
  *over* the child, `:28–34,156,212–221`), `boxShadow`, `onTap/onLongPress`,
  `enableRipple`, `glowColor`, `rippleRadiusFactor` (default 1.0),
  `rippleIntensity` (default **0.15**, `:92–93`), `backdropSample`, `backdropKey`
- **Fill**: alpha = `elementOpacity` (0.8) — or **1.0 in battery-saver** —
  (`:124`); default tint (when none passed) =
  `surfaceContainerHighest #1E1E1E` at that alpha (`:125–131`)
- **Flat-backdrop compositing**: inside a `FlatBackdrop(color: …)` subtree the
  tint is alpha-blended against the opaque backdrop colour once
  (`Color.alphaBlend`, `:138–141`) and the blur is skipped when the composite
  is fully opaque (`fillColor.a >= 1.0`, `:145–154`). Over the sheet's
  `#19191A` backdrop this yields solid `#1D1D1D` cards.
- **Blur**: `BackdropFilter` with sigmaX=sigmaY=`elementBlur` (12) unless
  battery-saver / debug-off / webview-blur / opaque fill (`:145–154,238–247`)
- **Noise**: `NoiseOverlay(opacity: noiseOpacity 0.03, intensity:
  noiseIntensity 0.8)` clipped to the same radius, painted over the fill
  (`:183–207`)
- **Ripple**: with a tap handler → `GlowInkWell` (`:251–262`); with
  `enableRipple` → `GlowRippleOverlay` (`:263–271`); glow color defaults to
  `colorScheme.primary`
- `GlassBackdropGroup` (`:288–315`) shares one backdrop capture between
  non-overlapping sibling surfaces; `GlassSurface` closes the group around its
  own children (`:177–179`) so nested glass blurs independently
- `FlatBackdrop` (`:345–364`): inherited opaque colour behind a subtree; only
  accepted when fully opaque (`:352–359`)

---

## 2. `NoiseOverlay` — `lib/shared/widgets/noise_overlay.dart`

Film-grain overlay painted over glass surfaces.

- `tint` default **black** `0xFF000000` (`:26–27`)
- Effective alpha scale = `(intensity * opacity).clamp(0, 1)` (`:50`) — with
  the defaults `0.8 * 0.03 = 0.024` (grain alphas 0–2.4%)
- Grain is a **128×128 tile** of 1px random cells, baked **once** per
  (tint, alphaScale) with a fixed seed `Random(42)` (`:114`, `:159`, `:154–179`)
  and repeated by an `ImageShader` (`:75–100`)
- Cell size (`stepFor`, `:123–126`): `ceil(pixels / 50000)` clamped to
  **1–10** logical px on mobile, **1–2** on desktop (`:132–142`)

---

## 3. `CardBackdrop` — `lib/shared/widgets/card_backdrop.dart`

Baked-blur system for surfaces sitting directly over the static app
background (a `MenuGroup` card, not a header over a list):

- `CardBackdrop(image, sigma, dim)` bakes the app background pre-blurred and
  lets `GlassSurface(backdropSample: true)` sample the region under itself
  instead of running a `BackdropFilter` (`:77–123`)
- `combineSigma(a, b) = sqrt(a² + b²)` (`:105–106`) — the bake must use the
  combined bgBlur + elementBlur sigma
- `CardBackdrop.closed(child)` (`:118–119`) closes the scope so surfaces inside
  (a sheet's fill, a floating window) fall back to their own blur
- `CardBackdropSample` (`:301–373`) paints the baked texture in screen space
  under its child

---

## 4. Glow ripple — `lib/shared/widgets/glow_ripple.dart`

- Painter (`:8–51`): a blurred radial gradient —
  `MaskFilter.blur(BlurStyle.normal, 10)`, colors `[color @ intensity·opacity,
  transparent]`, stops `[0.0, 0.7]`
- Animation (`:57–67`): controller **800 ms**; scale 0.2 → 2.5 and opacity
  1.0 → 0.0, both `Curves.easeOut`; ripple radius = max(child w, h) ×
  `radiusFactor`
- `GlowInkWell` (`:110–168`): drop-in for GestureDetector; ripple starts at
  the tap point, always clipped to the (rounded) bounds; hand cursor when
  clickable
- `GlowRippleOverlay` (`:177–241`): non-blocking full-area glow via a
  translucent `Listener`; child hit-testing unaffected
- Default `intensity` **0.15**, `radiusFactor` **1.0** on both

---

## 5. `MenuGroup` library — `lib/shared/widgets/menu_group.dart`

- `MenuGroupHeaderVariant { standard, accentCaps }` (`:16`)
- `menuGroupsFlat(context)` (`:22–23`): true inside a desktop window host
  (`DetachedShellHost`) or a sidebar panel — groups then render flat
- **`MenuGroup`** (`:254–341`):
  - Column: optional header, items, and — only when there are items — a
    trailing `SizedBox(height: 6)` gap before the card's bottom edge (`:292–303`)
  - Card (non-nested, non-flat): outer padding `fromLTRB(16, 0, 16, 12)`
    (`:329`) around `GlassSurface(enableRipple: true, borderRadius: 20,
    border: Border.all(outlineVariant), backdropSample: true)` (`:330–339`)
  - Nested (`MenuGroupNesting`): no card — just a 1px `outlineVariant` bottom
    rule, omitted for the last nested group (`:308–317`)
  - **Header** (`:343–413`): padding `fromLTRB(16, 16, 8, bottomPad)`,
    `bottomPad = hasItems ? (description != null ? 2.0 : 4.0) : 16.0` (`:349–351`)
    - `standard`: label as-is, fontSize **18**, w700, `onSurface` (`:377–387`)
    - `accentCaps`: label `.toUpperCase()`, fontSize **13**, w700,
      `letterSpacing 0.3`, color `primary` (`:377–387`)
    - optional `headerIcon` (16 px in accentCaps / 18 px standard, color
      `primary`, then 8 px gap, `:361–375`) or `headerIconWidget` in the same
      16/18 box
    - optional `description` under the label: `SizedBox(height: 2)` + text
      fontSize **12**, color **`#99A2AD`**, right padding 8 (`:396–409`)
    - `headerTrailing` widget pinned at the row's right edge (`:393`)
    - `HelpTip(term)` after the label (`:389`) — see below
- **`MenuSubHeader`** (`:418–438`): padding `fromLTRB(16, 10, 16, 4)`; text
  fontSize **13**, w600, `letterSpacing 0.3`, color `onSurface`
- **`MenuItem`** (`:442–547`): tap row — pressed tint `primary @ 0.08`
  animated 120 ms (`:484–488`); padding `symmetric(h: 16, v: 13)` (`:489`);
  optional icon **22** in `#99A2AD` (or 22×22 `iconWidget`) + 16 px gap
  (`:492–497`); label fontSize **16** w400 `onSurfaceVariant` (`:502–509`);
  optional `badge` 4 px under the label (`:510–513`); optional subtitle
  fontSize **12**, `onSurfaceVariant @ 0.45`, 2 px above (`:514–527`);
  optional trailing `value` text fontSize **14** `onSurfaceVariant` (`:531–538`)
- **`MenuSwitchItem`** (`:551–644`): InkWell (hand cursor, haptic) + padding
  `symmetric(h: 16, v: 10)` (`:588–589`); label column left (fontSize **16**,
  w400, `onSurfaceVariant`, `:607–613`; description fontSize 12 `#99A2AD`
  1 px below, `:619–628`; `HelpTip` inline); 16 px gap (`:633`); `GlazeSwitch`
  right (`:634–638`, with optional `activeColor`); optional leading
  `_ParameterIncludeSwitch` in a 40 px box + 8 px gap (`:592–598`)
- **`MenuFieldItem`** (`:648–841`): outer padding `fromLTRB(16, 10, 16, 8)`
  (`:772`); label row fontSize **13** `onSurfaceVariant` + optional
  `HelpTip(size: 14)` (`:784–794`); optional description 12 `#99A2AD`
  (`:811–821`); 6 px; `TextField` — text fontSize **15** `onSurface` (`:736`),
  hint `onSurfaceVariant @ 0.4` (`:739–741`), **`fillColor: context.inputFill`
  = `#252525`** (`:743`, app_colors.dart:225–227), radius 12, enabled border
  1px `outlineVariant`, focused border **1.5px `primary @ 0.5`** (`:745–759`),
  `contentPadding: symmetric(h: 14, v: 13)`, `isDense: true` (`:760–764`);
  optional reset button left of the field + 6 px (`:720–723`); optional helper
  caption 6 px under, fontSize **11.5**, height 1.3, `onSurfaceVariant @ 0.7`
  (or `error`) (`:824–836`)
- **`MenuRangeItem`** (`:845–1126`): outer padding `fromLTRB(16, 10, 16,
  included ? 0 : 10)` animated 220 ms (`:958,966–969`); label fontSize **15**
  (`:987–993`) — `onSurface` when included, `onSurface @ 0.4` when not; value
  control right: editable = `SizedBox(width: unit == null ? 72 : 88,
  height: 36)` centered TextField, fontSize **14**, `FontVariation('wght',
  500)`, fill `inputFill #252525`, radius **10**, enabled 1px
  `outlineVariant`, focused 1.5px `primary @ 0.5`, `contentPadding:
  symmetric(h: 8)`, optional unit suffix fontSize 13 (`:1049–1101`); else a
  plain fontSize 14 wght-500 text (`:1103–1110`); slider below in
  `Padding(vertical: 4)` → `GlazeSlider` (`:1114–1125`)
- **`MenuScriptItem`** (`:1132–1245`): same row anatomy as `MenuItem` plus a
  stock `Switch` — `activeThumbColor: primary`, `activeTrackColor:
  primary @ 0.5`, unselected outline `outlineVariant`,
  `shrinkWrap` tap target (`:1210–1224`) — and a trailing more-vert icon 20 in
  `onSurfaceVariant @ 0.45` (`:1231–1239`)
- **`MenuSelectorItem`** (`:1249–1381`): outer padding `fromLTRB(16, 10, 16,
  8)` (`:1292`); label fontSize **13** (`:1305–1313`); 6 px; selector box =
  `Container(padding: symmetric(h: 14, v: 12), constraints: minHeight 48,
  color: inputFill #252525, radius 12, border 1px outlineVariant)` (`:1338–1349`)
  with value text fontSize **15** `onSurface` (`:1352–1360`) and trailing
  `Icons.keyboard_arrow_down_rounded` size **22**, `onSurfaceVariant @ 0.5`
  (`:1363–1369`)
- **`_ResetToDefaultButton`** (`:1389–1417`): `Icons.undo_rounded` size 18
  (16 on rows), color `primary`, 4 px padding, InkResponse radius 18,
  tooltip `'reset_to_default'`
- **`_ParameterIncludeSwitch`** (`:1419–1449`): `SizedBox(width: 40)` +
  `FittedBox` around a stock `Switch` with primary thumb / `primary @ 0.5`
  track / `outlineVariant` unselected outline, shrinkWrap
- **`MenuCollapsibleSection`** (`:40–168`): disclosure card, radius 20
  (`:67`); header `AnimatedContainer` 150 ms with vertical gradient
  `primary @ 0.22 → 0.0` when expanded (`:115–131`); padding
  `symmetric(h: 16, v: 14)` (`:132`); label fontSize **16**, w600 expanded /
  normal collapsed, `onSurface` / `onSurfaceVariant` (`:144–149`); chevron
  `Icons.keyboard_arrow_down_rounded` (default size 24) rotating 150 ms,
  `primary` expanded / `onSurfaceVariant` collapsed (`:154–163`); children
  render nested (rule-separated) inside the same card (`:90–95`)
- **`FlatGroupSurface`** (`:178–222`): flat-mode group surface — optional
  `color` fill, 1px `outlineVariant` bottom rule, optional 3px `accent` left
  bar as a *foreground* decoration, `GlowRippleOverlay(primary)` wrap
- **`HelpTip`** (`lib/shared/widgets/help_tip.dart:27–67`): 20×20 tappable
  circle with `Icons.help_outline_rounded` size 16 (14/16 by param), color
  **`#99A2AD`**, 4px horizontal padding; hidden when `hideTooltips` is on

---

## 6. `SheetView` — `lib/shared/widgets/sheet_view.dart`

Generic modal-sheet container (used by `FilterSheet` and most sheets).

- Corner radius **20** top-only (`_kSheetCornerRadius`, `:21`; applied
  `:1055–1075`) and a foreground top border `glazeSheetBorder` =
  1px `outlineVariant` (`glaze_sheet.dart:22–24`)
- Fill: `ColoredBox(cs.surface.withValues(alpha: opaque ? 1.0 : 0.8))`
  (`:1141–1144`); modal sheets pass `opaque: true` (`:1113`) ⇒ solid `#19191A`,
  published as `FlatBackdrop` for the cards (`:1132–1133`); window-hosted
  sheets fill transparent (the window's glass is behind them, `:1142–1143`)
- Collapsed height **0.85 × screen** (`:266–272`), snap animation **350 ms**
  (`:279–282`)
- Drag handle strip: vertical padding 10 around a bar width **36 → 24**
  (expanded), height **4**, radius **2**, `white @ 0.35 → 0.6`, animated
  300 ms easeOutCubic (`:1399–1419`)
- Header row: padding `fromLTRB(16, 0, 16, 12)` (`:1422`); back button
  (optional) `Icons.arrow_back` size 20 `primary` in a `_HeaderIconButton`
  + 8 px (`:1428–1437`); title fontSize **18** w700 `onSurface`, 1-line
  ellipsis (`:1443–1452`); actions each in a `_HeaderIconButton` with 8 px
  left padding (`:1456–1471`); tabs row and `headerBottom` row share the same
  LTRB(16,0,16,12) padding (`:1475–1501`)
- `_HeaderIconButton` (`:1536–1576`): transparent circular Material + InkWell,
  `BoxConstraints(minWidth: 40, minHeight: 40, maxHeight: 40)`, foreground
  defaults to `primary`
- Header scrim: `TopEdgeBlur` height `headerH + 8`, sigma **24**, tint
  `_headerScrimColor() @ 0.88` — `cs.surface #19191A` in a modal sheet,
  `cs.surfaceContainerHighest #1E1E1E` inside a window (`:755–756`, applied
  `:857–866` and `:1251–1257`)
- `TopEdgeBlur` itself (`lib/shared/widgets/top_edge_blur.dart`): blur strip +
  separate gradient scrim `[tint, tint, tint @ 0]` with stops
  `[0, fadeStart(0.5), 1]` over `height` (`:80–88,107–125`)
- Body insets: `MediaQuery.padding.top = _headerBaseH` (measured header),
  `.bottom = navInset` = nav inset + 16 (fitContent sheets: bare inset)
  (`:1284–1286,1324–1331`); body centered `Alignment.topCenter` (`:1297–1298`)
- Scrollbar wrapper `_MaybeScrollbar` (`:1646–1700`): `RawScrollbar(thumbVisibility:
  true, thickness: 6, radius: 3)` with the **default** thumb color

---

## 7. `showGlazeSheet` / desktop sheet window — `lib/shared/widgets/glaze_sheet.dart`

- `showGlazeSheet(...)` (`:71–117`): desktop layout → `_GlazeSheetWindowRoute`
  (a `PopupRoute`); otherwise plain `showModalBottomSheet` forwarding every
  argument
- Route (`:119–193`): barrier `chrome ? null : (barrierColor ??
  Colors.black54)` (`:146–147` — a chrome'd window does NOT dim the screen);
  transition **180 ms** fade + scale **0.97 → 1**, `easeOutCubic` (`:156,
  181–188`)
- Window sizing (`:297–301`): width `min(bounds.width * 0.92, 640)`
  (`kGlazeSheetWindowMaxWidth`, `:14`); height `bounds.height * 0.85`
  (`kGlazeSheetWindowHeightFactor`, `:17`) — fixed unless `windowContentSized`
  (then a `ConstrainedBox(maxHeight: …)`, `:343–351`); resizable only when
  chrome'd and not content-sized (`:302`)
- Chrome-less window (`_SheetPanel`, `:404–434`): radius **16** all corners
  (`:411`), shadow `black @ 0.5, blurRadius 40, spreadRadius 4` (`:415–421`),
  top/bottom padding removed from the content (`:425–430`)
- Chrome'd window (`_WindowFrame`, `:436–504`): `DesktopWindowFrame` +
  `DesktopWindowTitleBar` fed by the hosted screen's shell-header claim (title
  + actions), close button pops the route (`:466–503`)
- `GlazeSheetWindowScope` (`:32–51`): tells hosted content (SheetView,
  GlazeBottomSheetFrame) it is in a window

---

## 8. `GlazeBottomSheet` — `lib/shared/widgets/glaze_bottom_sheet.dart`

Reusable bottom sheet / chrome-less window with items, big-info and cards.

- `GlazeBottomSheet.show(...)` (`:203–345`): `showGlazeSheet(useRootNavigator:
  true, useSafeArea: true, backgroundColor: transparent, barrierColor:
  Colors.black54, isScrollControlled: true, windowContentSized: true,
  windowChrome: false)` (`:308–321`)
- **Frame** (`_GlazeBottomSheetFrame`, `:366–400`): `FlatBackdrop(cs.surface
  #19191A)` + `GlassSurface(borderOnTop: true)`; radius **24** top-only on
  phone / **16** all corners in a window (`:382–384`); border `glazeSheetBorder`
  on phone / `Border.all(outlineVariant)` in a window (`:385–387`); drag
  handle only on phone (`:393`); maxHeight `0.95 × screen` on phone
  (`:362,369–373`)
- **Content** (`_GlazeBottomSheetContent`, `:633–798`): `TopEdgeBlur` height
  `_headerH + 8`, sigma 24, tint `surface @ 0.88` (`:655–659`); scrollbar
  `RawScrollbar(thumbColor: white @ 0.15, radius: 3, thickness: 4, padding:
  EdgeInsets.only(right: 3))` (`:669–674`); body list bottom padding
  `bottomInset + safeBottom + 16` (`:682–689`)
- Window-mode header stack: `SizedBox(height: 20)` top inset, no handle
  (`:771–776`); phone: `_HandleBar` (`:776`)
- **`_HandleBar`** (`:1015–1031`): padding `symmetric(vertical: 10)`, bar
  **32×4**, radius 2, `white @ 0.35`
- **`_Header`** (`:1034–1090`): padding `fromLTRB(20, 0, 12, 16)` (`:1053`);
  title fontSize **18** w700 `onSurface` (`:1043–1050`); optional `source`
  line under it (plugin name, small and grey) and optional `headerAction` at
  the right
- **Search field** (`_SheetSearchField` decoration, `:955–981`): filled,
  `fillColor: white @ 0.06`, radius 12, border `BorderSide.none` default,
  enabled 1px `white @ 0.1`, focused 1px `primary @ 0.5`,
  `contentPadding: symmetric(vertical: 11)`, suffix constraints
  `minWidth: 38, minHeight: 0`
- **Items list** (`_ItemsList`, `:1155–1209`): rows grouped in a card —
  outer padding `fromLTRB(16, 0, 16, 16)` (`:1189`), fill `white @ 0.06`,
  border 1px `white @ 0.1`, radius **16**, antiAlias clip (`:1190–1198`);
  1px `white @ 0.06` divider between rows (`:1164–1169`)
- **`_ItemRow`** (`:1228–1280`): padding `symmetric(h: 16, v: 14)` (`:1247`);
  pressed tint `white @ 0.08` animated **100 ms** (`:1242–1246`); optional
  leading icon **22** (color `iconColor ?? (destructive ? #FF4444 :
  onSurfaceVariant)`, `:1257–1266`) + 16 px gap; label centered when
  `centered: true` (`:1269–1273`); optional trailing actions (icon 20,
  `:1274–1280`)
- **`_ItemLabel`** (`:1456–1478`): fontSize **16**, color `#FF4444` when
  destructive else `onSurface` (`:1462–1465`); with a hint: hint line under
  the label
- **`_LazyItemRow`** (`:1300–1336`): per-row card fill `white @ 0.06`, border
  1px `white @ 0.1` (top divider `white @ 0.1` first row / `0.06` after),
  radius 16 on the outer corners
- **`_BigInfo`** (`:2054–2094`): padding `fromLTRB(20, 12, 20, 20)` (`:2062`);
  icon size **64**, `onSurfaceVariant @ 0.5` (`:2065–2069`); 16 px gap;
  description fontSize **16**, `onSurface`, `height: 1.5`, centered
  (`:2071–2079`); optional button 24 px below → `GlazeActionButton` (primary
  tone, expand) (`:2080–2089`)
- Empty search state (`:987–1009`): padding `fromLTRB(20, 12, 20, 28)`,
  `Icons.search_off_rounded` size **36** `onSurfaceVariant @ 0.5`, 10 px,
  text fontSize **14** `onSurfaceVariant`

---

## 9. List controls — `lib/shared/widgets/list_controls.dart`

- `GlazePickerItem` (`:10–34`) + `showGlazePickerSheet` (`:38–77`): opens a
  `GlazeBottomSheet`; each row is a `BottomSheetItem` whose icon is the
  item's own glyph or — when active and glyph-less — `Icons.check_rounded`
  in `primary`; an active row with a leading glyph also gets a trailing
  check action
- **`GlazeDropdownChip`** (`:81–140`): 32 px tall `GlassSurface(radius: 16,
  tint: cs.surface, border: 1px primary @ 0.18)`; horizontal padding **14**;
  optional leading widget in an 18×18 box + 6 px; label fontSize **13** w600
  `primary`; 4 px; `Icons.keyboard_arrow_down_rounded` size **18** `primary`
- **`GlazeSortIconChip`** (`:144–190`): same 32 px glass pill; padding
  horizontal **10**; icon **18** `primary` + 2 px + chevron **18** `primary`
- **`GlazeActionChip`** (`:198–257`): same 32 px glass pill; padding
  horizontal **7** (icon only) / **12** (labelled); icon **18** `primary`;
  optional label fontSize 13 w600 `primary` + 6 px
- **`GlazeReorderToggleButton`** (`:265–304`): **32×32** glass pill; armed:
  tint `primary`, border `primary @ 0.9`, icon `Colors.white`; idle: tint
  `surface`, border `primary @ 0.18`, icon `primary`; icon
  `Icons.swap_vert_rounded` size **18**
- **`GlazeFilterIconButton`** (`:402–469`): **32×32** glass circle (radius 16,
  tint `surface`, border `primary @ 0.18`) with `Icons.filter_list_rounded`
  size **18** `primary`; badge when `count > 0`: positioned at
  `top: -2, right: -2`, `BoxConstraints(minWidth: 16, minHeight: 16)`,
  horizontal padding 4, solid `primary` circle, text fontSize **10** w700
  white height 1.0 (`:437–463`)
- `PresetSortControls` (`:344–398`): reorder toggle + sort chip in a row with
  8 px gap, wrapped in one `GlassBackdropGroup`

---

## 10. Filter framework widgets

(`filter_sheet.dart` and `filter_tag_picker.dart` are specced in full in
`glaze-spec-filter-sheet.md` §2–§5; summary of the shared pieces:)

- Section types `FilterToggleSection` / `FilterRangeSection` /
  `FilterNumberSection` / `FilterGroupSection` / `FilterTagsSection` /
  `FilterCustomSection` (filter_sheet.dart:40–185); `collapsedCount` default
  **24** (`:172`)
- `FilterSheet` renders `SheetView` + `ListView` padding
  `fromLTRB(0, top+8, 0, bottom+32)` (`:222–231`); consecutive untitled rows
  share one card (`:237–266`); `FilterCustomSection` child padding
  `fromLTRB(16, 4, 16, 16)` (`:257–260`)
- `filterRow` (`:294–306`): toggle → `MenuSwitchItem` (danger ⇒
  `activeColor #FF5A5F`, `_dangerColor` `:308`); number/range rows as specced
- `_rowLabelStyle` fontSize 16 w400 (`:310`)
- `FilterTagChip` / `FilterSearchField` — see filter-sheet spec §3/§5

---

## 11. `GlazeSwitch` — `lib/shared/widgets/glaze_switch.dart:11–46`

Stock Material 3 `Switch` under the app's compact visual density; wraps
`Haptics.selectionClick()` on change (`:31–36`).

- `activeColor` param (default `colorScheme.primary`) → `activeThumbColor`
  (`:28,37`); `activeTrackColor = active @ 0.5` (`:38`);
  `trackOutlineColor`: `transparent` when selected, `outlineVariant`
  (`white @ 0.1`) otherwise (`:39–43`)
- Off state inherits the theme: thumb white, track `onSurface @ 0.3`
  (`app_theme.dart:396–403`)
- Danger usage (NSFL): pass `activeColor: Color(0xFFFF5A5F)` (filter_sheet.dart:301,308)

---

## 12. Standalone widgets

### 12.1 `GlazeSpinner` — `lib/shared/widgets/glaze_spinner.dart`

- Default size **36** (`defaultSize`, `:31`); fills tight constraints when
  `size` is null and constraints are tight (`:108–123`)
- Color defaults to `colorScheme.primary` (`:101`); track = `color @ 0.12`
  (`:102`)
- Spin cycle **1600 ms** (`:65`), sweep oscillates **0.08 → 0.82 turns**
  (`:68–69`) with easeInOutCubic grow/shrink (`:139–144`); determinate tween
  **260 ms** easeOutCubic (`:167–170`)
- Stroke width defaults to `diameter * 0.115` clamped **1.8–12** (`:249–250`)
- Glow (on by default, `:24`): two under-passes at `width*2.2 @ alpha 0.08`
  and `width*1.5 @ alpha 0.14` (`:238–241`), plus a head bloom — circle of
  radius `width*2` with a radial gradient `color @ 0.35 → 0` (`:298–320`)
- Indeterminate arc is tapered via a sweep gradient fading in over the tail
  third (`:265–288`); determinate arc is solid (`:289–291`)
- Stroke caps round (`:262`)

### 12.2 `PillTabStrip` — `lib/shared/widgets/glaze_tab_bar_strips.dart`

- `_kVisibleTabs = 2.35` (`:19`) — viewport shows 2.35 equal-width tabs; more
  tabs ⇒ the strip scrolls
- Track: `GlassSurface(radius: 21, tint: cs.surface, border: 1px primary @
  0.18)` in a **42 px** tall box (`:90,169–175`)
- Active pill: `GlassSurface(radius: 18, tint: cs.primary, border: 1px
  white @ 0.14)`, inset `top: 3, bottom: 3` + horizontal padding **3**
  (`:97–115`), sliding via `AnimatedPositioned` **250 ms easeOutCubic**
  (`:98–100`)
- Tab content: icon **18** + 8 px + label fontSize **14** w600, maxLines 1
  ellipsis; colors: active **white**, inactive **`primary`** (`:121–145`)
- Auto-reveal of a newly-active clipped tab: 250 ms easeOutCubic scroll
  (`:58–75`); body-swipe disabled while the strip scrolls (`:162–164`)
- **`UnderlineTabStrip`** (`:201–316`, same file): content-sized tabs, 22 px
  gaps (`:223`); per-tab 200 ms easeOut animation (`:260–262`); vertical
  padding 6 + 6 px below the label for a **2px** bottom rule fading in accent
  (`:267–283`); icon **17** (`:288–292`), label fontSize **15** w600; idle
  color `onSurface @ 0.45`, live `onSurface`, icon lands on accent when active
  (`:251–254,297–306`)

### 12.3 `GlazeFab` — `lib/shared/widgets/glaze_fab.dart`

- Height **56** (`_height`, `:38`); circle (icon-only) or stadium (labelled)
  shape with a 1px `white @ 0.18` hairline border (`:48–54`)
- Fill `primary`; glyph is **white on a dark accent, black on a light one**
  (`ThemeData.estimateBrightnessForColor`, `:43–46`); busy fill `primary @ 0.7`
  (`:133`)
- Icon-only: `Icons.add_rounded` (default, `:32`) size **28** (`:61`);
  extended: icon size **22**, left padding **18**, 10 px gap, right padding
  **22** (`:61–68,73`); label fontSize **15** w700 (`:83–86`); optional
  subtitle fontSize **12** w500 at glyph @ 0.75 (`:89–99`)
- Busy swaps the icon for a 22 px `GlazeSpinner(glow: false)` in the glyph
  color (`:56–60`)
- Shadows (`:119–130`): `black @ 0.55, blurRadius 28, spreadRadius 2,
  offset(0, 10)` + accent bloom `accent @ 0.4, blurRadius 24, offset(0, 4)`
- Disabled: opacity **0.5**, 150 ms (`:110–112`); splash `glyph @ 0.15`,
  highlight `glyph @ 0.08` (`:139–140`)

### 12.4 `CardTagChips` — `lib/shared/widgets/card_tag_chips.dart`

Compact colour-coded tag chips for character/catalog cards.

- `Wrap(spacing: 4, runSpacing: 4)` (`:18–20`); optional `max` cap (`:16`)
- Colours (case-insensitive match on the upper-cased tag, `:24–42`):
  - `NSFW`: bg `0x33FF4444`, fg `#FF4444`, border `0x4DFF4444`
  - `SFW`: bg `0x334CAF50`, fg `#FF4CAF50`, border `0x4D4CAF50`
  - `#custom`: bg `0x1A00FFFF`, fg `#FF00CCCC` (cyan), border `0x3300FFFF`
  - anything else: bg `primary @ 0.15`, fg `primary`, border `primary @ 0.2`
- Chip: padding `symmetric(h: 8, v: 2)`, radius **8**, 1px border; text
  fontSize **10** w600 (`:44–57`)

### 12.5 `NsfwBlur` — `lib/shared/widgets/nsfw_blur.dart`

- `ImageFiltered` Gaussian blur over the child, `sigma` default **16**
  (`:25`), wrapped in a `ClipRect` so the smear stays inside the image box
  (`:36–45`); no-op when `enabled == false` (`:31`)

### 12.6 `VariationChip` — `lib/shared/widgets/variation_chip.dart`

- Pill: `BoxConstraints(maxWidth: 110)`, padding `symmetric(h: 7, v: 1)`,
  fill `primary @ 0.14`, radius **10** (`:21–30`); text fontSize **11** w700
  `primary`, 1-line ellipsis (`:32–42`)

### 12.7 `DesktopPopup` — `lib/shared/widgets/desktop_popup.dart`

Pointer-anchored desktop dropdown (stands in for a bottom sheet).

- Default width **240** (`:81`); anchored at `lastPointerDownPosition`
  (recorded by `PointerPositionTracker`, `:12–28`) or screen center
  (`:83–88`)
- Route (`:100–167`): transparent barrier (`:118`), dismissible, transition
  **140 ms** fade + scale **0.96 → 1**, `easeOutCubic`, alignment topLeft
  (`:124,154–165`)
- Positioning (`:184–230`): 12 px viewport gap (`_gap`, `:188`); flips across
  the anchor on overflow, then clamps (`:205–225`)
- Panel (`:232–293`): `GlassSurface(radius: 12, border: 1px outlineVariant,
  boxShadow: black @ 0.35, blurRadius 24, spreadRadius 1)` (`:251–259`);
  optional title — padding `fromLTRB(14, 12, 14, 8)`, fontSize **12** w600
  `onSurfaceVariant`, then a 1px `outlineVariant` divider (`:268–280`); 4 px
  above and below the rows (`:282,285`)
- Row (`:295–365`): `HoverGlow` wrap; padding `symmetric(h: 14, v: 9)`
  (`:314`); optional icon/widget 18×18 + 10 px (`:317–327`); label fontSize
  **14** (`:335`), color `error` when destructive else `onSurface` (`:308`);
  optional hint fontSize **11** `onSurfaceVariant` (`:337–344`); trailing
  action icons 18 (`:348–359`)

### 12.8 `GlazeToast` — `lib/shared/widgets/glaze_toast.dart`

- API (`:16–176`): `show(context, text, {duration 2500 ms, position bottom,
  isError, isWarning, showCopyButton, source})`; `warning` = 3500 ms amber
  (`:121–147`); `error` = 4000 ms top (`:149–158`); `errorWithCopy` = 8000 ms
  top with copy button (`:160–170`); one toast at a time (`:53–83`)
- Chip (`_ToastChip`, `:381–552`):
  - Radius **24** (clip + decoration, `:433,468`); backdrop blur sigma **12**
    unless battery-saver (then an opaque fill, `:432–439`)
  - Fill (`:450–458`): normal `#C21E1E1E` (opaque `#E61E1E1E`); error
    `#C25C1A1A` (opaque `#E65C1A1A`); warning `#C2F5B301` (opaque
    `#E6F5B301`)
  - Text color: white; warning uses dark `#FF2A1E00` (`:459`)
  - Border: 1px **`0x59A0A0A0`** on every toast (`:409,467`)
  - Shadow: `0x401A1A1A`, blurRadius **20**, offset `(0, 4)` (`:469–475`)
  - Max width `screen - 48` (`:461–463`); padding
    `fromLTRB(20, 10, showCopyButton ? 8 : 20, 10)` (`:464`)
  - Text fontSize **13** w500 height **1.3** (`:515–525`); optional `source`
    line: 2 px below, fontSize **10** w500, `color @ 0.5`, right-aligned
    (`:526–550`)
  - Copy button (`:482–507`): 8 px gap, padding `symmetric(h: 10, v: 4)`,
    fill `0x33FFFFFF` (or `0x332A1E00` on warning), radius **12**, text
    fontSize **11** w600 — "Copy" → "Copied" for 2 s
- Animation (`:266–331`): enter **300 ms** with overshoot curve
  `Cubic(0.34, 1.56, 0.64, 1)` — scale 0.85 → 1, translateY ±20 (from below
  for bottom, above for top), opacity easeOut; leave **250 ms** easeIn
  (`:273–275,285–300,319–330`)
- Position (`:339–341`): bottom = `padding.bottom + 80 + 24`; top =
  `padding.top + 56 + 16`
- Tap dismisses (or long-press copies when no copy button) (`:425–431`)

### 12.9 `ProviderLogo` — `lib/features/catalog/widgets/provider_logo.dart`

- Bundled brand marks (`:9–15`): janitor/janny/datacat/chub are **raster
  PNGs** (`assets/logos/providers/*.png`), saucepan is an SVG
- Default render size **18×18**, `BoxFit.contain` (`:23,40`)
- **The Chub logo has no in-code shape or colors**: `chub.png` is a
  256×256 8-bit grayscale+alpha PNG (verified via PNG header) — reproduce it
  from the asset file, not from code

---

## 13. Desktop window chrome

### 13.1 `DesktopWindowFrame` — `lib/shared/shell/desktop/desktop_window_chrome.dart:18–60`

- `GlassSurface` radius **16** (0 when maximized, `:34`), border 1px
  `outlineVariant` painted **on top** (`:37,40`); ClipRRect re-applies the
  scaled radius (`:48–49`)
- Shadow (`:41–47`): `black @ alpha(active ? 0.5 : 0.3)`,
  `blurRadius active ? 40 : 24`, `spreadRadius active ? 4 : 0`
- Column: title bar, `Divider(height: 1, color: outlineVariant)` (`:53`),
  expanded child

### 13.2 `DesktopWindowTitleBar` — `desktop_window_chrome.dart:66–179`

- Height **52** (`kDesktopWindowTitleBarHeight`,
  desktop_window_geometry.dart:11); row padding: leading `SizedBox(width: 4)`
  (`:115`), or a back `IconButton` (`Icons.arrow_back_rounded` size **20**,
  `:117–122`) when `onBack` is set, else `SizedBox(width: 12)` (`:124`);
  trailing `SizedBox(width: 4)` (`:174`)
- Title (`:128–142`): fontSize **17**, w700, `onSurface` when active /
  `onSurface @ 0.55` inactive, animated `_kActiveFade` **150 ms** (`:9`),
  ellipsis; `titleWidget` overrides
- Window buttons (`:98–109`): compact `IconButton`, default icon size **18**,
  color `onSurfaceVariant` (active) / `onSurfaceVariant @ 0.55` (inactive)
  (`:94–96`); icons: detach `open_in_new_rounded`, minimize
  `minimize_rounded`, maximize `crop_square_rounded` (restore:
  `fullscreen_exit_rounded`, `:157–166`), close `close_rounded` size **20**
  (`:167–173`); tooltips from localization keys `desktop_window_*`

### 13.3 Geometry — `lib/shared/shell/desktop/desktop_window_geometry.dart`

- Min window size **360×260** (`:7`); title-bar grab strip 52 (`:11`); a
  window may hang off the edges until **96 px** of it remains on screen
  (`kDesktopWindowGrabMargin`, `:14`); resize grip width **6** (`:17`)
- `defaultWindowRect` (`:48–59`): preferred size capped at **92%** of bounds,
  centered, cascaded **28 px** per step (mod 6)
- `clampWindowRect` (`:65–85`): clamps size into bounds (≥ min size), top ≥ 0
  and ≤ `bounds.height − 52`, left within the grab margin
- `DesktopWindowMoveArea` (`:156–186`): title-bar drag + **double-click
  toggles maximize**
- `DesktopWindowGeometry` (`:195–349`): `Positioned` at the rect (inflated by
  grip/2 when resizable), edge/corner grips of `grip*2` hit area (`:290–345`)

---

## 14. English strings not covered by the other specs

From `assets/translations/en.json` (values verbatim; the catalog-filter and
tag strings live in `glaze-spec-filter-sheet.md` §9):

| Key | Line | Value |
|---|---|---|
| `desktop_window_detach` | 149 | `Open in a separate window` |
| `desktop_window_minimize` | 150 | `Minimize` |
| `desktop_window_maximize` | 151 | `Maximize` |
| `desktop_window_restore` | 152 | `Restore` |
| `sort_by` | 33 | `Sort by` |
| `no_results` | 140 | `No results` |
| `reset_to_default` | 518 | `Reset to default` |
| `catalog_search_placeholder` | 1556 | `Search characters...` |
| `catalog_empty` | 1558 | `No characters found` |
| `catalog_end` | 1559 | `That's all` |

*(Toast button labels "Copy"/"Copied" are hardcoded, `glaze_toast.dart:498`.)*
