/**
 * The catalog import workflow's decisions, ported from Glaze.
 *
 * Glaze's import is one button with a conditional sheet and a four-stage
 * capture sheet behind it (`lib/features/character_list/character_detail_screen.dart`
 * `_handleImportTap`, `lib/features/catalog/widgets/janitor_lorebook_capture_sheet.dart`).
 * The widget code lives in `index.js`; everything that *decides* what the user
 * is offered lives here, so the workflow can be checked without a DOM.
 *
 * The single rule this encodes: a lorebook is only ever pulled by an action the
 * user chose. Nothing is attached to a character behind a plain import, and a
 * closed book is never advertised as downloadable.
 */

/** The attached `scripts[]` of a JanitorAI character, as the site lists them. */
export function lorebookRefs(meta) {
    const scripts = meta?.scripts;
    if (!Array.isArray(scripts)) return [];
    return scripts
        .filter(script => script && typeof script === 'object')
        .filter(script => (script.type === 'lorebook' || script.type === 'advanced') && script.id != null)
        .map(script => ({
            id: String(script.id),
            title: String(script.title ?? ''),
            // `is_public` is authoritative; absent means public, as on the site.
            isPublic: script.is_public !== false,
        }));
}

/** Whether the Import button has anything to ask about (`_previewHasLorebooks`). */
export function hasAttachedBooks(meta) {
    return lorebookRefs(meta).length > 0;
}

/**
 * The three kinds of attached book, kept apart because each has its own path:
 * `public` maps 1:1 onto World Info, `scripted` must be rebuilt from its
 * JavaScript, `closed` can only be recovered from a captured prompt.
 *
 * `failed` is a book the site would not serve: never reported as closed, since
 * a transport error and a private book are different answers.
 */
export function bookKinds(books) {
    const list = Array.isArray(books) ? books : [];
    const json = list.filter(book => book?.kind === 'public' && book.book);
    const js = list.filter(book => book?.kind === 'scripted' && book.jsSource);
    const closed = list.filter(book => book?.kind === 'closed');
    const failed = list.filter(book => book?.kind === 'failed');
    return { json, js, closed, failed, downloadable: [...json, ...js] };
}

/**
 * The Import options sheet: shown only when the character lists books, and
 * never with a row that does nothing. `lorebooks` appears whenever books exist
 * (public or closed) because both kinds are pulled there.
 */
export function importOptions({ bookCount = 0 } = {}) {
    if (!bookCount) return null;
    return [
        { mode: 'character+lorebooks', label: 'Character + lorebooks', hint: 'Also import the attached lorebooks', icon: 'fa-book-open' },
        { mode: 'character', label: 'Character only', hint: 'Import the character without its lorebooks', icon: 'fa-user' },
        { mode: 'lorebooks', label: 'Lorebooks only', hint: 'Pull the lorebooks without adding the character', icon: 'fa-book' },
    ];
}

/**
 * Which stage the capture sheet is on.
 *
 * Derived, never stored — the same way Glaze derives it (:943-951) — so a
 * stage can never claim work that is not there: a character with no closed
 * book has no build or save stage at all.
 */
export function captureStage({ importing = false, hasFlow = false, built = false, extracted = false } = {}) {
    if (importing) return 'character';
    if (!hasFlow) return 'collect';
    if (built) return 'save';
    if (extracted) return 'build';
    return 'collect';
}

/** Stages in the strip, in order; `character` only when an import is running. */
export function captureStages({ importing = false } = {}) {
    return [
        ...(importing ? [{ id: 'character', label: 'Character' }] : []),
        { id: 'collect', label: 'Collecting' },
        { id: 'build', label: 'Building' },
        { id: 'save', label: 'Saving' },
    ];
}

/**
 * A `hasFlow` sheet owns the run: back steps one stage, and closing it with
 * work in hand asks first. The first stage closes instead.
 */
export function captureBack({ stage, built = false, busy = false } = {}) {
    if (busy) return 'held';
    if (stage === 'save' && built) return 'build';
    if (stage === 'build') return 'collect';
    return 'close';
}

export function captureConfirmClose({ delivered = false, work = true } = {}) {
    // Nothing extracted and nothing built: there is no progress to discard, so
    // closing is not a confirmation, it is just closing.
    return work && !delivered;
}
