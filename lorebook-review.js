// Weaver's Vault — apply a human review pass to segmenter output (P3).
//
// Pure. The segmenter proves what it can and flags the rest; this module turns the
// reviewer's answers (rename, split here, merge into the previous entry) into entries
// again, keeping offsets honest so the verifier can still prove coverage.

import { titleFromLine } from './lorebook-segment.js';
import { normaliseName } from './lorebook-verify.js';

function offsetOfLine(content, line) {
    const lines = content.split('\n');
    let at = 0;
    for (let i = 0; i < line; i += 1) at += (lines[i] ?? '').length + 1;
    return at;
}

function trimEntry(content) {
    return content.replace(/\s+$/, '');
}

/** A split's second half needs a title: its header, else its first words, else a fallback. */
function titleForSplit(content, fallback) {
    const first = content.split('\n').find((line) => line.trim()) || '';
    const header = /^-?\s*\[([^\]\n]{2,120})\]:?\s*$/.exec(first.trim());
    if (header) return header[1].trim();
    return titleFromLine(first) || fallback;
}

/**
 * decisions: {
 *   renames: { "3": "New title" },
 *   splits:  [{ entry: 3, candidate: 0 }],   // candidate index from entry.candidates
 *   merges:  [4]                             // entry 4 joins the entry above it
 * }
 */
export function applyReview({ entries, decisions = {} }) {
    const renames = decisions.renames || {};
    const splits = Array.isArray(decisions.splits) ? decisions.splits : [];
    const merges = new Set(Array.isArray(decisions.merges) ? decisions.merges : []);
    const problems = [];
    const applied = [];

    const working = entries.map((entry) => ({
        ...entry,
        flags: Array.isArray(entry.flags) ? entry.flags.slice() : [],
        candidates: Array.isArray(entry.candidates) ? entry.candidates.slice() : [],
    }));

    for (const [index, title] of Object.entries(renames)) {
        const entry = working[Number(index)];
        if (!entry) {
            problems.push('rename for entry ' + index + ', which does not exist');
            continue;
        }
        const next = String(title ?? '').trim();
        if (!next || next === entry.title) continue;
        entry.title = next;
        entry.flags = entry.flags.filter((flag) => flag !== 'derived-title');
        applied.push({ kind: 'rename', entry: Number(index), title: next });
    }

    const byEntry = new Map();
    for (const split of splits) {
        const index = Number(split.entry);
        if (!byEntry.has(index)) byEntry.set(index, []);
        byEntry.get(index).push(Number(split.candidate));
    }

    const output = [];
    working.forEach((entry, index) => {
        const wanted = byEntry.get(index) || [];
        if (!wanted.length) {
            output.push(entry);
            return;
        }
        const cuts = [];
        for (const candidateIndex of wanted) {
            const candidate = entry.candidates[candidateIndex];
            if (!candidate) {
                problems.push('entry ' + index + ': no candidate ' + candidateIndex);
                continue;
            }
            const at = offsetOfLine(entry.content, candidate.line);
            if (at <= 0 || at >= entry.content.length) {
                problems.push('entry ' + index + ': split at line ' + candidate.line + ' would empty a half');
                continue;
            }
            cuts.push({ at, kind: candidate.kind });
        }
        cuts.sort((a, b) => a.at - b.at);
        // A cut's kind belongs to the piece that STARTS at it, not the one it ends.
        const pieces = [];
        let cursor = 0;
        let startKind = null;
        for (const cut of cuts) {
            if (cut.at > cursor) {
                pieces.push({ from: cursor, to: cut.at, kind: startKind });
                cursor = cut.at;
                startKind = cut.kind;
            }
        }
        pieces.push({ from: cursor, to: entry.content.length, kind: startKind });

        pieces.forEach((piece, position) => {
            const content = trimEntry(entry.content.slice(piece.from, piece.to));
            if (!content) return;
            const start = entry.start + piece.from;
            if (position === 0) {
                output.push({ ...entry, content, start, end: start + content.length, candidates: [], flags: [] });
                return;
            }
            const title = titleForSplit(content, entry.title + ' (continued)');
            output.push({
                index,
                title,
                role: piece.kind === 'bracket-header' ? 'container' : 'unknown',
                rule: 'review:split',
                start,
                end: start + content.length,
                content,
                confidence: 1,
                flags: [],
                candidates: [],
            });
            applied.push({ kind: 'split', entry: index, at: start, title });
        });
    });

    const merged = [];
    output.forEach((entry, position) => {
        if (merges.has(position) && merged.length) {
            const previous = merged[merged.length - 1];
            previous.content = trimEntry(previous.content) + '\n\n' + entry.content;
            previous.end = Math.max(previous.end, entry.end);
            previous.flags = previous.flags.concat(entry.flags || []);
            applied.push({ kind: 'merge', entry: position, into: merged.length - 1 });
            return;
        }
        merged.push({ ...entry });
    });

    const seen = new Map();
    return {
        entries: merged.map((entry, index) => {
            const key = normaliseName(entry.title);
            if (key && seen.has(key)) {
                problems.push('duplicate title after review: ' + entry.title);
            } else if (key) {
                seen.set(key, index);
            }
            return { ...entry, index };
        }),
        applied,
        problems,
    };
}

export default applyReview;