# janitor_build_widgets.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_build_widgets.dart
- **Lines:** 349 (read in full: 1-349)
- **Role:** Four reusable building blocks for the JanitorAI lorebook build UI — `ContextSourceTile` (toggle **and** reveal one context source with its token count), `DisclosureRow` (reveal-only), `ContentPane` (the scrollable read-only text box both open into) and `ActionTile` (a GlassSurface "button").

## Purpose

The doc anchors each widget to the JanitorAI web app (`JAR`) that Glaze is reproducing:

- `ContextSourceTile` — "Mirrors JAR's `.ctx-block`: a row that both toggles whether the source is sent to the build LLM *and* opens to show the exact text that would be sent, with its token count. A source with no content cannot be sent, so it is shown disabled and does not open."
- `DisclosureRow` — "Mirrors JAR's "extracted content" `<details>` block."
- `ActionTile` — "An action rendered the Glaze way — a [GlassSurface] tile rather than a Material button ([docs/UI_KIT.md]: "a tile built on GlassSurface *is* the button")."

These are three different interaction contracts over the same idea (show me exactly what gets sent) plus one button style. Nothing here fetches, persists or decides anything.

## Behaviour walkthrough

### `ContextSourceTile`

```dart
class ContextSourceTile extends StatefulWidget {
  final String label;
  final String content;        // empty ⇒ nothing to send
  final String? emptyNote;     // overrides 'catalog_ctx_empty' when empty for a nameable reason
  final bool pending;          // content does not exist yet but will by send time
  final bool value;
  final ValueChanged<bool> onChanged;
}
```

`pending` doc: "The content does not exist yet but will by the time it is sent, so the row stays selectable while empty. The character card before a capture is the case this exists for — JAR keeps its checkbox live for the same reason."

State: one `bool _open = false`.

`build` computes:

```dart
final text = widget.content.trim();
final empty = text.isEmpty;
final locked = empty && !widget.pending;   // nothing to reveal, and nothing coming
```

Row (`InkWell` with `mouseCursor: SystemMouseCursors.click`, `onTap: empty ? null : () { Haptics.selectionClick(); setState(() => _open = !_open); }`, `Padding(EdgeInsets.symmetric(horizontal: 16, vertical: 10))`):

1. `Expanded` column — the label at fontSize 16, colour `cs.onSurfaceVariant.withValues(alpha: 0.5)` when `locked` else `cs.onSurfaceVariant`; 1 px gap; then the sub-line:
   ```dart
   empty
     ? (widget.emptyNote ?? 'catalog_ctx_empty'.tr())          // "Content is empty"
     : 'catalog_ctx_tokens'.tr(args: ['${estimateTokens(text)}'])  // "{} tokens"
   ```
   style `const TextStyle(color: Color(0xFF99A2AD), fontSize: 12)` — a hard-coded grey, not a theme token.
2. If `!empty`: chevron `Icons.keyboard_arrow_up_rounded` / `Icons.keyboard_arrow_down_rounded`, size 20, `cs.onSurfaceVariant`.
3. 8 px gap, then a Material `Switch`:
   ```dart
   Switch(
     value: widget.value && !locked,       // a locked row always renders off
     onChanged: locked ? null : (v) { Haptics.selectionClick(); widget.onChanged(v); },
     activeThumbColor: cs.primary,
     activeTrackColor: cs.primary.withValues(alpha: 0.5),
     trackOutlineColor: WidgetStateProperty.resolveWith((states) =>
       states.contains(WidgetState.selected) ? Colors.transparent : cs.outlineVariant),
   )
   ```
4. Below the row, when `_open && !empty`: `Padding(EdgeInsets.fromLTRB(16, 0, 16, 12), child: ContentPane(text: text))` — default `maxHeight: 180`.

Three states worth naming: **pending-empty** (switch live, no chevron, `emptyNote` as sub-line, cannot open), **locked-empty** (switch disabled *and* forced visually off, label at 50 % opacity), **populated** (switch live, chevron, opens the pane, shows token count).

Token count comes from `estimateTokens(String text, {bool useCache = true})` in `core/llm/tokenizer.dart`: returns `0` for empty or media-only text, uses the loaded BPE tokenizer when one is installed in the isolate, otherwise an approximation; results cached by content hash. It is therefore a *count of what would be sent*, not a model-specific number.

Caller (only one: `widgets/janitor_lorebook_capture_sheet.dart`), in `_extractContextGroup()` and `_keyContextGroup(ExtractionResult ex)`:

| label key | English | notes at call site |
| --- | --- | --- |
| `catalog_ctx_card` | `Character card` | extract group: `content: (_extraction ?? _importCapture)?.cardContext ?? ''`, `emptyNote: 'catalog_ctx_card_pending'.tr()`, `pending: (_extraction ?? _importCapture) == null` |
| `catalog_ctx_catalog` | `Card description on site` | `content: _previewCtx.catalog` |
| `catalog_ctx_scenario` | `Scenario` | |
| `catalog_ctx_greetings` | `First message(s)` | extract group falls back to `…?.greetingsContext ?? ''` and uses `emptyNote: 'catalog_ctx_greetings_pending'.tr()` (`Not in the catalog — taken from the chat during extraction`) |
| `catalog_ctx_lorebook_descs` | `Lorebook descriptions` | `content: buildLorebookDescsContext(_public)` |

Both groups also carry `MenuSwitchItem(label: 'catalog_ctx_extra'.tr())` — `Custom text` — with `description: 'catalog_ctx_extra_desc'.tr()` = `Your own notes — names, aliases, setting details` and, when on, `MenuFieldItem(label: 'catalog_ctx_extra_label'.tr())` = `Notes` with `placeholder: 'catalog_ctx_extra_ph'.tr()` = `Optional custom context…`. So the six context sources are: card, catalog description, scenario, greetings, lorebook descriptions, plus free-text notes — exactly JAR's `#useSources`.

### `DisclosureRow`

```dart
final String label;
final String? subtitle;
final String content;
final bool initiallyOpen;   // default false
```

State: `late bool _open = widget.initiallyOpen;`. Same `InkWell` + `Haptics.selectionClick()` pattern, `onTap: text.isEmpty ? null : …`, `Padding(EdgeInsets.symmetric(horizontal: 16, vertical: 13))`. Label fontSize 16 `cs.onSurfaceVariant`; subtitle (when non-null) fontSize 12 at `onSurfaceVariant.withValues(alpha: 0.45)` with a 2 px gap; chevron only when `text.isNotEmpty`. Open body: `ContentPane(text: text, maxHeight: 220)` in `EdgeInsets.fromLTRB(16, 0, 16, 12)`.

Differences from `ContextSourceTile`: no switch, no token count, no `pending`/`emptyNote`, taller max height (220 vs 180). Used at `janitor_lorebook_capture_sheet.dart:1523` for the "extracted content" reveal.

### `ContentPane`

```dart
const ContentPane({ required this.text, this.maxHeight = 180, this.mono = false });
```

`Container(width: double.infinity, constraints: BoxConstraints(maxHeight: maxHeight), padding: EdgeInsets.all(10), decoration: color cs.surface.withValues(alpha: 0.5), BorderRadius.circular(12), Border.all(color: cs.outlineVariant))` wrapping `SingleChildScrollView(child: SelectableText(text, style: TextStyle(fontSize: 11, height: 1.4, fontFamily: mono ? 'monospace' : null, color: cs.onSurfaceVariant)))`. Selection is enabled on purpose — the pane is for inspection and copy-out. `mono: true` is used for the raw provider JSON dump (`…ContentPane(text: body, mono: true, maxHeight: 200)` at line 2386) and for the Tavern-format JSON preview (`JsonEncoder.withIndent('  ')` at ~1660).

### `ActionTile`

```dart
const ActionTile({ required this.icon, required this.label, required this.onTap,
                   this.primary = false, this.busy = false, this.expand = false, this.compact = false });
```

`enabled = onTap != null && !busy`; `accent = primary ? cs.primary : cs.onSurfaceVariant`; `fg = enabled ? accent : accent.withValues(alpha: 0.4)`.

`GlassSurface(borderRadius: BorderRadius.circular(compact ? 14 : 20), enableRipple: enabled, tint: primary ? cs.primary.withValues(alpha: 0.15) : null, border: Border.all(color: primary ? cs.primary.withValues(alpha: 0.3) : cs.outlineVariant), onTap: enabled ? onTap : null, child: Padding(compact ? EdgeInsets.symmetric(horizontal: 10, vertical: 6) : EdgeInsets.symmetric(horizontal: 16, vertical: 12), child: Row(mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min, mainAxisAlignment: expand ? MainAxisAlignment.center : MainAxisAlignment.start, children: [ spinner-or-icon, SizedBox(width: compact ? 6 : 8), Text(label, fontSize: compact ? 12 : 13, w600, color: fg) ])))`.

- `busy` → `SizedBox(width: compact ? 13 : 16, height: …, child: GlazeSpinner(color: fg))` in place of the icon, and the tap is blocked (`onTap: enabled ? … : null`, with `enabled` false while busy).
- `expand` doc: "Fill the available width and centre the content — for a section's single main action, rather than one chip among several."
- `compact` doc: "Pill-sized, for a per-row action that has to sit inside a list row (a menu row's trailing slot) without out-weighing the row itself."

Callers (all in `janitor_lorebook_capture_sheet.dart`): section main actions at 1281/1317/1361/1557/1574/2064/2126, one `expand`-style centred action in the sheet footer.

## Data shapes

No models. Inputs are `String`/`bool`/`IconData`/callbacks; `ContentPane` takes already-rendered text (extracted content, a JSON dump, a prompt preview). Token counts are `int` from `estimateTokens`.

## Network / WebView contract

None — no HTTP, no WebView, no persistence, no Riverpod. Purely presentational; the only side channels are `Haptics.selectionClick()` (platform haptic) and the caller's `onChanged`/`onTap`.

## Selectors, regexes and string literals

No regexes, no selectors.

| literal | meaning |
| --- | --- |
| `catalog_ctx_empty` | `Content is empty` |
| `catalog_ctx_tokens` | `{} tokens` |
| `catalog_ctx_card` / `_catalog` / `_scenario` / `_greetings` / `_lorebook_descs` | `Character card` / `Card description on site` / `Scenario` / `First message(s)` / `Lorebook descriptions` |
| `catalog_ctx_card_pending` | `Recovered from the character during extraction` |
| `catalog_ctx_greetings_pending` | `Not in the catalog — taken from the chat during extraction` |
| `catalog_ctx_extra` / `_desc` / `_label` / `_ph` | `Custom text` / `Your own notes — names, aliases, setting details` / `Notes` / `Optional custom context…` |
| `Color(0xFF99A2AD)` | sub-line colour in `ContextSourceTile` |
| `'monospace'` | `ContentPane` font family when `mono` |
| `fontSize 16 / 12 / 11 / 13`, `height 1.4 / 1.35`, `alpha 0.5 / 0.45 / 0.4 / 0.3 / 0.15 / 0.5`, `circular(12 / 14 / 20)`, `maxHeight 180 / 200 / 220`, `sizes 13 / 16 / 18 / 20`, paddings `16,10 / 16,13 / 16,0,16,12 / 16,0,16,12 / 10 / 10,6 / 16,12`, gaps `1 / 2 / 6 / 8` | layout |

## State machine, retries, timings

- `ContextSourceTile`: 2-state disclosure (`_open`) orthogonal to the caller-held `value`; the only transition guard is `empty` (cannot open, cannot toggle when `locked`).
- `DisclosureRow`: same, seeded from `initiallyOpen`.
- No timers, no animation, no retries, no async.
- Note the deliberate asymmetry: `_open` is *not* reset when `content` becomes non-empty, so a row that was locked-empty and later receives content opens on the first tap (inferred; nothing special-cases the transition).

## Errors and user-visible messages

No error handling — the widgets render whatever they are given. Two silent behaviours worth knowing:

- A `locked` tile renders its switch **off** even if the caller's `value` is `true` (`value: widget.value && !locked`), so a persisted selection on a source that lost its content looks deselected and will be reported back only if the user can still toggle it (it cannot, `onChanged: null`). The caller's `value` stays `true` — i.e. it may still be sent while appearing off (inferred; depends on the caller's sender, which skips empty content per the class doc).
- `pending` rows show `emptyNote` (or `Content is empty`) and no chevron even though they are selectable — the only cue that content is coming is the note text.

## Persistence

None. `_open`/`_open` flags are per-widget-instance; selections live in the caller's `_extractSources` / `_buildSources` structs (in the capture sheet), which is what gets used to assemble the LLM request.

## Porting notes for our SillyTavern port

1. **"Toggle + peek" is the right control for context sources.** A checkbox that does not show what it sends is the thing this widget exists to avoid. In the vault, each context source row should open a read-only pane with the exact text and a token count computed by the same estimator used to build the request, or the count is a lie.
2. **Three render states, not two**: populated / pending-but-coming / unavailable. The `pending` case is load-bearing for the pre-capture card and greetings — without it a user cannot pre-select sources that a capture will fill.
3. **`DisclosureRow` for outputs, `ContextSourceTile` for inputs.** The build result (extracted content, prompt preview, raw JSON) is a disclosure, never a toggle.
4. **`SelectableText` + scroll inside a capped height** is the pattern for showing a large payload without taking over the screen; give JSON a `monospace` family and indent it (`JsonEncoder.withIndent('  ')`).
5. **Do not copy the locked-but-selected blind spot.** If a source's content is gone, either clear the selection or keep the switch interactive so the user can turn it off; a switch that reads off while the value is true is a bug generator.
6. **Buttons are tiles.** `ActionTile`'s states (primary tint, disabled at 40 % alpha, busy spinner in the icon's slot with taps blocked, `expand` for the one main action, `compact` for row-trailing actions) are the vocabulary the vault's build UI should mirror for visual consistency.

## Open questions

- Whether a `locked` tile's `value: true` is excluded at send time — this file only documents "A source with no content cannot be sent"; the enforcement is in the caller's request assembly (UNKNOWN here; `widgets/janitor_lorebook_capture_sheet.dart` / `services/janitor_extractor.dart` would settle it).
- What `Haptics.selectionClick()` maps to per platform (no-op on desktop?) — UNKNOWN — `core/platform/haptics.dart`.
- Whether `estimateTokens`' approximation path (no tokenizer loaded) is what the build request also budgets against — UNKNOWN — `core/llm/tokenizer.dart` and `services/janitor_lorebook_rebuilder.dart`.
- Whether `ActionTile.busy` is ever combined with `expand` in a way that shifts layout (spinner 13 vs 16 px inside a fixed row) — not determinable from this file; call sites at `janitor_lorebook_capture_sheet.dart:1281-1361` would show it.
