// Weaver's Vault — assemble a World Info book from a capture (P2.5).
//
// Pure. Segmentation gives the boundaries, this gives the book: every entry gets the
// full SillyTavern schema, keys and an order, and the verifier runs before anything
// is returned. A caller cannot get a book without a report.

import { authorKeysFor } from './lorebook-keys.js';
import { buildProvenance } from './lorebook-provenance.js';
import { applyReview } from './lorebook-review.js';
import { segmentLorebook } from './lorebook-segment.js';
import { verifyLorebook } from './lorebook-verify.js';

/** Fields every entry must end up with; the caller's template wins when supplied. */
const DEFAULTS = {
    keysecondary: [],
    constant: false,
    selective: true,
    order: 100,
    position: 4,
    disable: false,
    addMemo: false,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    probability: 100,
    depth: 10,
    useProbability: true,
    role: 0,
    vectorized: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: 0,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    displayIndex: 0,
};

/**
 * Keys for a title when the author supplied none.
 * "Saber / Artoria" -> ["Saber", "Artoria"]; the parenthetical alias is kept whole.
 */
function keyId(value) {
    return String(value ?? '').trim().toLowerCase();
}

function uniqueKeys(keys) {
    const seen = new Set();
    const out = [];
    for (const key of keys) {
        const text = String(key ?? '').trim();
        const id = keyId(text);
        if (!text || seen.has(id)) continue;
        seen.add(id);
        out.push(text);
    }
    return out;
}

export function defaultKeys(title) {
    const text = String(title ?? '').trim();
    if (!text) return [];
    const parts = text.split('/').map((part) => part.trim()).filter(Boolean);
    const keys = [text];
    for (const part of parts) {
        if (!keys.some((key) => key.toLowerCase() === part.toLowerCase())) keys.push(part);
    }
    const base = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (base && !keys.some((key) => key.toLowerCase() === base.toLowerCase())) keys.push(base);
    return keys;
}

/**
 * Build a book from raw captured text.
 *
 * @param {{text: string, template?: object, authorKeys?: object, keysFor?: Function}} input
 *   template: an existing entry whose non-content fields are copied (position/depth/role...)
 *   authorKeys: { "artoria pendragon": ["Artoria", "Saber"] } keyed by normaliseName(title)
 *   keysFor: (title, entry) => string[] overrides defaultKeys
 * @returns {{ book: {entries: object}, report: object }}
 */
export function buildLorebook(input = {}) {
    const template = input.template && typeof input.template === 'object' ? input.template : {};
    const segmentation = segmentLorebook(input.text);
    const review = applyReview({ entries: segmentation.entries, decisions: input.decisions || {} });
    const keysFor = typeof input.keysFor === 'function' ? input.keysFor : null;
    const authorKeys = input.authorKeys || null;

    const entries = {};
    let fromAuthor = 0;
    review.entries.forEach((entry, index) => {
        const title = entry.title;
        const author = authorKeysFor(authorKeys, title);
        if (author) fromAuthor += 1;
        // The title always triggers the entry; the author's own keys ride on top of the
        // generated ones instead of replacing them (a sheet's keywords rarely repeat its name).
        const generated = defaultKeys(title);
        const keys = keysFor
            ? keysFor(title, entry) || generated
            : author
              ? uniqueKeys(author)
              : generated;
        entries[String(index)] = {
            ...DEFAULTS,
            ...template,
            role: template.role ?? DEFAULTS.role,
            uid: index,
            comment: title,
            key: keys,
            content: entry.content,
            constant: false,
            order: 100 - index,
            displayIndex: index,
            // "role" is World Info's injection slot; the segmentation label lives apart.
            vaultRole: entry.role,
            start: entry.start,
            end: entry.end,
        };
    });

    const report = verifyLorebook({
        source: input.text,
        entries: Object.values(entries),
        authorKeys,
    });
    const provenance = buildProvenance({
        text: input.text,
        captureId: input.captureId,
        decisions: input.decisions || {},
        review,
        segmentation,
        report,
    });
    return {
        book: { entries, extensions: { vault: provenance } },
        report: {
            ...report,
            segmentation: { stats: segmentation.stats, flags: segmentation.flags },
            review: { applied: review.applied, problems: review.problems },
            provenance,
        },
    };
}

export default buildLorebook;
