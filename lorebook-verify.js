// Weaver's Vault — lorebook verification gates (P2).
//
// Pure. Every gate answers with machine-readable failures so the UI can block an
// import and point at the entry that broke it. The point is that a book is never
// "probably fine": either the boundary is provable from the source or it is a flag.
//
// Errors block. Warnings are review items (a legitimate two-form Servant, a
// bracketed paragraph that might be its own entry).

import {
    HEIGHT_WEIGHT_PATTERN,
    SHEET_FIELD_PATTERN,
    matchOpener,
    normaliseText,
} from './lorebook-segment.js';

/** What may sit between two entries: whitespace and empty "---" dividers. */
export const SEPARATOR_PATTERN = /^(?:\s|---[ \t]*)+$/;

/** "Artoria (Summer);" and "artoria (summer)" compare equal. */
export function normaliseName(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .replace(/[;.,:\s]+$/, '')
        .trim()
        .toLowerCase();
}

/** The segmentation role, kept apart from World Info's numeric "role" field. */
export function roleOf(entry) {
    const value = entry && entry.vaultRole !== undefined ? entry.vaultRole : entry && entry.role;
    return typeof value === 'string' ? value : null;
}

function firstLineOf(content) {
    return String(content ?? '').split('\n').find((line) => line.trim()) || '';
}

function entryLabel(entry, index) {
    const title = String(entry && entry.title ? entry.title : entry && entry.comment ? entry.comment : '');
    return title ? title + ' [#' + index + ']' : '#' + index;
}

/** The name a sheet carries in its first lines, if any. */
export function sheetNameOf(content) {
    const lines = String(content ?? '').split('\n').slice(0, 4);
    for (const line of lines) {
        const match = /^-?\s*Servant Name:\s*(.+?);?\s*$/.exec(line) || /^-\s*Name:\s*(.+?);?\s*$/.exec(line);
        if (match) return match[1];
    }
    return null;
}
/** G1/G2: offsets are honest and every non-entry character is a separator. */
function checkCoverage(source, entries, fail, warn) {
    let previousEnd = 0;
    entries.forEach((entry, index) => {
        const label = entryLabel(entry, index);
        const hasOffsets = Number.isFinite(entry.start) && Number.isFinite(entry.end);
        if (!hasOffsets) {
            warn('coverage', 'no-offsets', label + ': no source offsets, verbatim check falls back to search');
            // A rebuilt sheet may carry a "- Servant Name:" line we re-attached; the body
            // after it is what must occur in the capture.
            const body = String(entry.content ?? '')
                .replace(/^-?\s*Servant Name:[^\n]*\n/, '')
                .replace(/^-\s*Name:[^\n]*\n/, '');
            if (body.trim() && !String(source).includes(body)) {
                fail('coverage', 'not-verbatim', label + ': content does not occur in the source');
            }
            return;
        }
        const actual = source.slice(entry.start, entry.end);
        if (actual !== String(entry.content ?? '')) {
            fail('coverage', 'offset-mismatch', label + ': content is not source[start..end]');
        }
        if (entry.start < previousEnd) {
            fail('coverage', 'overlap', label + ': starts before the previous entry ends');
        }
        const gap = source.slice(previousEnd, entry.start);
        if (gap && !SEPARATOR_PATTERN.test(gap)) {
            fail('coverage', 'uncovered-text', label + ': ' + JSON.stringify(gap.slice(0, 40)) + ' is outside every entry');
        }
        previousEnd = entry.end;
    });
    if (entries.length && Number.isFinite(entries[entries.length - 1].end)) {
        const tail = source.slice(entries[entries.length - 1].end);
        if (tail && !SEPARATOR_PATTERN.test(tail)) {
            fail('coverage', 'uncovered-tail', JSON.stringify(tail.slice(0, 40)) + ' is outside every entry');
        }
    }
}

/** G3: no entry may contain another entry's opener. */
function checkForeignOpeners(entries, fail) {
    entries.forEach((entry, index) => {
        const lines = String(entry.content ?? '').split('\n');
        for (let i = 1; i < lines.length; i += 1) {
            if (!lines[i].trim()) continue;
            const blankBefore = lines[i - 1].trim() === '';
            const hit = matchOpener(lines[i], blankBefore);
            if (!hit) continue;
            // The entry's own name line, after a leading "---" divider, is not foreign.
            if (hit.role === 'sheet' && normaliseName(hit.title) === normaliseName(entry.title ?? entry.comment)) continue;
            fail(
                'foreign-opener',
                'foreign-opener',
                entryLabel(entry, index) + ': contains the opener of another entry — ' + JSON.stringify(lines[i].slice(0, 60)),
            );
            break;
        }
    });
}
/** G4/G5: the title says what the body starts with, and two entries never share one. */
function checkTitles(entries, fail, warn) {
    const seen = new Map();
    entries.forEach((entry, index) => {
        const label = entryLabel(entry, index);
        const title = String(entry.title ?? entry.comment ?? '');
        if (!title.trim()) {
            fail('titles', 'empty-title', label + ': no title');
            return;
        }
        const key = normaliseName(title);
        if (seen.has(key)) {
            fail('titles', 'duplicate-title', label + ': same title as ' + seen.get(key));
        } else {
            seen.set(key, label);
        }
        // Containers start with an OOC/System line, so the first name inside is not the title.
        const name = roleOf(entry) === 'container' ? null : sheetNameOf(entry.content);
        // "Gilgamesh (Caster)" disambiguates two sheets of the same spirit; the body keeps
        // the authored name, so the qualifier is allowed but nothing else is.
        const base = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (name && normaliseName(name) !== key && normaliseName(name) !== normaliseName(base)) {
            fail('titles', 'title-mismatch', label + ': body names ' + JSON.stringify(name));
        }
        if (!name && roleOf(entry) === 'sheet') {
            warn('titles', 'no-name-line', label + ': sheet has no name line in its first lines');
        }
        const first = firstLineOf(entry.content);
        if (roleOf(entry) === 'topic' && first && !normaliseName(first).includes(key)) {
            warn('titles', 'title-not-in-first-line', label + ': first line does not mention the title');
        }
    });
}

/** G6: a sheet or topic that holds two character sheets (the welded-fragment case). */
function checkSheetBlocks(entries, warn) {
    entries.forEach((entry, index) => {
        if (roleOf(entry) === 'container') return;
        const content = String(entry.content ?? '');
        const names = content.match(SHEET_FIELD_PATTERN) || [];
        const sheets = content.match(HEIGHT_WEIGHT_PATTERN) || [];
        const blocks = Math.max(names.length, sheets.length);
        if (blocks > 1) {
            warn('sheets', 'multiple-sheet-blocks', entryLabel(entry, index) + ': ' + blocks + ' character sheets in one entry');
        }
    });
}
/** G7: keys exist; the author's list wins when one is supplied. */
function checkKeys(entries, authorKeys, fail, warn) {
    entries.forEach((entry, index) => {
        const label = entryLabel(entry, index);
        const keys = Array.isArray(entry.key) ? entry.key.filter((key) => String(key).trim()) : [];
        if (!keys.length) {
            fail('keys', 'missing-keys', label + ': no trigger keys');
            return;
        }
        if (!authorKeys) return;
        const title = String(entry.title ?? entry.comment ?? '');
        const author = authorKeys[normaliseName(title)];
        if (!author || !author.length) return;
        if (!keys.some((key) => normaliseName(key) === normaliseName(author[0]))) {
            warn('keys', 'author-key-missing', label + ': author key ' + JSON.stringify(author[0]) + ' is not in the entry keys');
        }
    });
}

/** G8: macros are well formed (a captured {{user}} can come back as {{{user}}}). */
function checkMacros(entries, fail, warn) {
    entries.forEach((entry, index) => {
        const label = entryLabel(entry, index);
        const content = String(entry.content ?? '');
        if (/\{\{\{|\}\}\}/.test(content)) {
            fail('macros', 'malformed-macro', label + ': triple-brace macro');
        }
        const open = (content.match(/\{\{/g) || []).length;
        const close = (content.match(/\}\}/g) || []).length;
        if (open !== close) {
            warn('macros', 'unbalanced-macro', label + ': ' + open + ' "{{" vs ' + close + ' "}}"');
        }
    });
}

/** G9: the fields a World Info entry must carry, with their types. */
const SCHEMA = {
    uid: 'number',
    key: 'array',
    comment: 'string',
    content: 'string',
    constant: 'boolean',
    position: 'number',
    depth: 'number',
};

function checkSchema(entries, fail) {
    entries.forEach((entry, index) => {
        const label = entryLabel(entry, index);
        for (const [field, type] of Object.entries(SCHEMA)) {
            const value = entry[field];
            const ok = type === 'array' ? Array.isArray(value) : typeof value === type;
            if (!ok) fail('schema', 'bad-field', label + ': ' + field + ' must be a ' + type);
        }
    });
}
/**
 * Run every gate.
 *
 * @param {{source?: string, entries: Array, authorKeys?: object}} input
 *   authorKeys: { "artoria pendragon": ["Artoria", "Saber"] } keyed by normaliseName(title)
 * @returns {{ ok: boolean, failures: Array, warnings: Array, summary: object }}
 */
export function verifyLorebook(input = {}) {
    const entries = Array.isArray(input.entries) ? input.entries : [];
    const source = typeof input.source === 'string' ? normaliseText(input.source) : '';
    const failures = [];
    const warnings = [];
    const fail = (gate, code, message) => failures.push({ gate, code, message });
    const warn = (gate, code, message) => warnings.push({ gate, code, message });

    checkSchema(entries, fail);
    if (source) checkCoverage(source, entries, fail, warn);
    checkForeignOpeners(entries, fail);
    checkTitles(entries, fail, warn);
    checkSheetBlocks(entries, warn);
    checkKeys(entries, input.authorKeys || null, fail, warn);
    checkMacros(entries, fail, warn);

    const roleCount = (role) => entries.filter((entry) => roleOf(entry) === role).length;
    return {
        ok: failures.length === 0,
        failures,
        warnings,
        summary: {
            entries: entries.length,
            chars: entries.reduce((sum, entry) => sum + String(entry.content ?? '').length, 0),
            keys: entries.reduce((sum, entry) => sum + (Array.isArray(entry.key) ? entry.key.length : 0), 0),
            sheets: roleCount('sheet'),
            containers: roleCount('container'),
            topics: roleCount('topic'),
        },
    };
}

export default verifyLorebook;
