// Weaver's Vault — provenance (P5).
//
// A built book must be traceable to the capture it came from and the review that shaped
// it. The fingerprint is FNV-1a 64-bit over the source text: a content check, not a
// signature, and pure so the extension can compute it in the browser and the CLI in Node.

export const PROVENANCE_VERSION = 1;

/** 64-bit FNV-1a over UTF-16 code units, as 16 hex digits. */
export function fingerprint(text) {
    const value = String(text ?? '');
    let high = 0xcbf2 & 0xffff;
    let low = 0x9ce4;
    for (let index = 0; index < value.length; index += 1) {
        const unit = value.charCodeAt(index);
        low ^= unit & 0xff;
        low = Math.imul(low, 0x01000193) >>> 0;
        high ^= (unit >>> 8) & 0xff;
        high = Math.imul(high, 0x01000193) >>> 0;
    }
    return (high >>> 0).toString(16).padStart(8, '0') + (low >>> 0).toString(16).padStart(8, '0');
}

/** Stable stringify: object keys sorted, so a fingerprint does not depend on insertion order. */
export function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
}

/**
 * What gets stamped on the book: the source, the review that shaped it, the key store
 * that supplied the triggers, and the counts the verifier agreed to.
 */
export function buildProvenance({ text, captureId, decisions, review, segmentation, report }) {
    const source = String(text ?? '');
    const applied = (review && review.applied) || [];
    const byKind = (kind) => applied.filter((action) => action.kind === kind).length;
    const decisionBlob = stableStringify(decisions || {});
    return {
        version: PROVENANCE_VERSION,
        tool: 'weavers-vault/lorebook-build',
        captureId: captureId || null,
        source: {
            chars: source.length,
            lines: source.split('\n').length,
            fingerprint: fingerprint(source),
        },
        review: {
            fingerprint: fingerprint(decisionBlob),
            renames: byKind('rename'),
            splits: byKind('split'),
            merges: byKind('merge'),
            problems: ((review && review.problems) || []).length,
        },
        segmentation: {
            entries: segmentation && segmentation.stats ? segmentation.stats.entries : null,
            flags: segmentation && Array.isArray(segmentation.flags) ? segmentation.flags.length : null,
        },
        result: {
            entries: report && report.summary ? report.summary.entries : null,
            characters: report && report.summary ? report.summary.chars : null,
            ok: Boolean(report && report.ok),
        },
    };
}

export default buildProvenance;