// Weaver's Vault — deterministic lorebook segmentation (P1).
//
// Pure: no imports, no DOM, no network. It answers one question — "where does an
// entry start?" — with rules taken from the source itself, and it says how sure it is.
// It never guesses a boundary silently: anything it cannot anchor is reported as a
// candidate and every entry carries a confidence.
//
// Why not "split on blank lines": the Fate Limitless capture has entries whose bodies
// contain blank lines (the image block) and authored containers that hold several
// character sheets (Present Characters: 6, Holy Church: 5). Splitting on sheet-name
// lines instead shattered those containers. See docs/JANITOR-CAPTURE-MEASUREMENTS.md §2g.

/** Line endings normalised once, so offsets mean the same thing everywhere. */
export function normaliseText(text) {
    return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** {lines, starts}: starts[i] is the offset of line i's own text. */
export function lineTable(source) {
    const rows = source.split('\n');
    const starts = [];
    let at = 0;
    for (const row of rows) {
        starts.push(at);
        at += row.length + 1;
    }
    return { lines: rows, starts };
}

/**
 * Entry openers, in priority order. A line that matches none of these is never an
 * entry start, however much it looks like a heading: the source is full of section
 * headers ([Example Dialogues], [Riding A+], [Extra Lore], [Abilities], [NOTE: ...]).
 *
 * blankBefore: true means the line only opens an entry when a blank line precedes it.
 * That is what separates "- Name: Van-Fem" (a new sheet with no name marker) from
 * "---\n- Name: Rin Tohsaka" (a section inside the Present Characters container).
 */
export const OPENERS = [
    // The dash is optional: two sheets in the Fate capture omit it ("Servant Name: Achilles;").
    { id: 'servant-sheet', role: 'sheet', pattern: /^-?\s*Servant Name:\s*(.+?);?\s*$/, title: (m) => m[1] },
    { id: 'named-sheet', role: 'sheet', blankBefore: true, pattern: /^-\s*Name:\s*(.+?);?\s*$/, title: (m) => m[1] },
    {
        id: 'topic',
        role: 'topic',
        pattern: /^\[System OOC\]:\s*This entry contains the information for\s+(.+?)\.?\s*$/i,
        title: (m) => m[1].replace(/^the\s+/i, ''),
    },
    {
        id: 'deceased',
        role: 'container',
        pattern: /^\[OOC\]:\s*The following characters are listed as Deceased/i,
        title: () => 'Deceased Characters',
    },
    {
        id: 'present',
        role: 'container',
        pattern: /^\[OOC\]:\s*The following Characters are present in the world\/universe/i,
        title: () => 'Present Characters',
    },
    {
        id: 'cities',
        role: 'container',
        pattern: /^\[System\]:\s*This Entry contains information regarding other major cities/i,
        title: () => 'Other Cities & Locations',
    },
    {
        id: 'other-characters',
        role: 'container',
        pattern: /^\[System\]:\s*This Entry contains information regarding other major characters/i,
        title: () => 'Other Characters',
    },
    {
        id: 'location-images',
        role: 'container',
        pattern: /^\[System Inclusion\]:\s*$/,
        title: () => 'Location Images',
    },
    {
        id: 'holy-church',
        role: 'container',
        pattern: /^\[Holy Church\]:/,
        title: () => 'Holy Church',
    },
    {
        id: 'concepts',
        role: 'container',
        pattern: /^\[Concept #1\]:/,
        title: () => 'Concepts',
    },
];
/** A bracketed heading that is always inside an entry, never a new one. */
export const SECTION_PATTERN = /^\[[^\]\n]{0,90}\]:?/;

/** A bracket paragraph (long text, not a short heading) that may be its own entry. */
export const PARAGRAPH_BRACKET_PATTERN = /^\[[^\]\n]{60,}/;

/** Name lines: two of them in one entry mean two named sheets. */
export const SHEET_FIELD_PATTERN = /^-\s*(?:Servant Name|Name):/gm;

/** Every sheet carries exactly one; two or more mean a second sheet is welded in without a name line. */
export const HEIGHT_WEIGHT_PATTERN = /^-\s*Height\/Weight:/gm;

/** "'Artoria (Summer);'" -> "Artoria (Summer)" */
export function cleanTitle(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .replace(/[;.,:\s]+$/, '')
        .trim();
}

/** A usable title for a block that matches no rule. */
export function titleFromLine(line) {
    let text = String(line ?? '').trim();
    if (text.startsWith('[')) text = text.slice(1);
    if (text.startsWith('###')) text = text.slice(3);
    text = text.replace(/^#+\s*/, '');
    const stop = text.search(/[.\n]/);
    if (stop > 0) text = text.slice(0, stop);
    return cleanTitle(text.slice(0, 80));
}

/** First opener in the table that matches this line, honouring blankBefore. */
export function matchOpener(line, blankBefore) {
    for (const rule of OPENERS) {
        if (rule.blankBefore && !blankBefore) continue;
        const match = rule.pattern.exec(line);
        if (!match) continue;
        return { id: rule.id, role: rule.role, title: cleanTitle(rule.title(match)) };
    }
    return null;
}

/** A paragraph-sized line makes a paragraph-sized title; keep the review table readable. */
export function shortTitle(line, max = 60) {
    const full = titleFromLine(line);
    if (full.length <= max) return full;
    const cut = full.slice(0, max);
    const space = cut.lastIndexOf(' ');
    const head = (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-]+$/, '');
    return head + '…';
}

function trimEnd(source, start, end) {
    let at = end;
    while (at > start && /\s/.test(source[at - 1])) at -= 1;
    return at;
}
/**
 * Segment a captured lorebook region into entries.
 *
 * @param {string} text raw captured text
 * @returns {{ entries: Array, flags: Array, stats: object }}
 */
export function segmentLorebook(text) {
    const source = normaliseText(text);
    const { lines, starts } = lineTable(source);
    const anchors = [];

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim()) continue;
        const blankBefore = i > 0 && lines[i - 1].trim() === '';
        const hit = matchOpener(line, blankBefore);
        if (hit) {
            anchors.push({ ...hit, line: i, start: starts[i], confidence: 1 });
        } else if (i === 0) {
            anchors.push({
                id: 'text-start',
                role: 'unknown',
                title: shortTitle(line),
                truncated: shortTitle(line) !== titleFromLine(line),
                line: 0,
                start: 0,
                confidence: 0.5,
            });
        }
    }

    const flags = [];
    if (!anchors.length) {
        return {
            entries: [],
            flags: [{ code: 'empty', message: 'nothing to segment', at: 0 }],
            stats: { chars: source.length, entries: 0, sheets: 0, containers: 0, topics: 0, flagged: 0 },
        };
    }

    // Text before the first anchor: the capture can start mid-entry, or with an entry
    // that has no marker at all (Fate's Grail War rules).
    if (anchors[0].start > 0 && source.slice(0, anchors[0].start).trim()) {
        anchors.unshift({
            id: 'leading-block',
            role: 'unknown',
            title: shortTitle(lines[0]),
            truncated: shortTitle(lines[0]) !== titleFromLine(lines[0]),
            line: 0,
            start: 0,
            confidence: 0.4,
        });
        flags.push({
            code: 'leading-block',
            message: 'text before the first recognised opener was kept as its own entry',
            at: 0,
        });
    }

    const entries = anchors.map((anchor, index) => {
        const next = anchors[index + 1];
        const end = trimEnd(source, anchor.start, next ? next.start : source.length);
        const content = source.slice(anchor.start, end);
        const entryFlags = [];
        const candidates = [];
        const names = content.match(SHEET_FIELD_PATTERN) || [];
        const sheets = content.match(HEIGHT_WEIGHT_PATTERN) || [];
        const blocks = Math.max(names.length, sheets.length);
        // Containers hold several sheets by design (Present Characters: 6). Only a sheet
        // or topic that suddenly holds two is a welded fragment.
        if (blocks > 1 && anchor.role !== 'container') {
            entryFlags.push('multiple-sheet-blocks');
            flags.push({
                code: 'multiple-sheet-blocks',
                message: anchor.title + ': ' + blocks + ' character sheets in one entry (a second character may be welded in)',
                at: anchor.start,
                entry: index,
            });
        }

        const body = content.split('\n');
        for (let i = 1; i < body.length; i += 1) {
            if (!PARAGRAPH_BRACKET_PATTERN.test(body[i])) continue;
            if (body[i - 1].trim() !== '') continue;
            candidates.push({ line: i, text: body[i].slice(0, 70) });
        }
        if (candidates.length) {
            entryFlags.push('candidate-split');
            for (const candidate of candidates) {
                flags.push({
                    code: 'candidate-split',
                    message: anchor.title + ': bracketed paragraph that may start a new entry — ' + candidate.text,
                    at: anchor.start,
                    entry: index,
                });
            }
        }

        if (anchor.truncated) {
            entryFlags.push('derived-title');
            flags.push({
                code: 'derived-title',
                message: anchor.title + ': title cut from a paragraph; rename it in review',
                at: anchor.start,
                entry: index,
            });
        }

        if (anchor.confidence < 1) {
            entryFlags.push('low-confidence');
            flags.push({
                code: 'low-confidence',
                message: anchor.title + ': no explicit opener; review the boundary',
                at: anchor.start,
                entry: index,
            });
        }

        return {
            index,
            title: anchor.title,
            role: anchor.role,
            rule: anchor.id,
            start: anchor.start,
            end,
            content,
            confidence: anchor.confidence,
            flags: entryFlags,
            candidates,
        };
    });

    const count = (role) => entries.filter((entry) => entry.role === role).length;
    return {
        entries,
        flags,
        stats: {
            chars: entries.reduce((sum, entry) => sum + entry.content.length, 0),
            entries: entries.length,
            sheets: count('sheet'),
            containers: count('container'),
            topics: count('topic'),
            flagged: new Set(flags.map((flag) => flag.entry)).size,
        },
    };
}

export default segmentLorebook;
