/**
 * The detail window's read-only markup, kept pure so it can be tested without a
 * browser: index.js reads SillyTavern globals at import time, so anything that
 * lives there is only reachable in the real UI. These three functions are the
 * parts a user reported getting wrong (the closed-card bio, 2026-11-27).
 */

export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * The Info tab's bio block.
 *
 * Glaze's `_InfoTab` renders the creator notes under an upper-case DESCRIPTION
 * label regardless of source (character_detail_screen.dart:1494-1524). A closed
 * JanitorAI card has no body, so the site's public bio *is* its notes and belongs
 * here — it used to be pushed into the Description drawer instead, which read as
 * a definition the site had just said it was hiding.
 * @param {{ bioText?: string, isHtml?: boolean, tagCount?: number, closed?: boolean }} view
 * @returns {string}
 */
export function infoBioHtml({ bioText, isHtml = false, tagCount = 0, closed = false } = {}) {
    const text = String(bioText ?? '');
    if (!text.trim()) {
        // Tags alone are a preview; a closed card already carries the lock note.
        return tagCount || closed ? '' : '<div class="wv-dnoprev">No preview available</div>';
    }
    // A janitor card's notes are converted, sanitised HTML (janitor-html.js);
    // escaping them printed the tags, and their attribute strings also forced the
    // tab strip out of view.
    const body = isHtml
        ? `<div class="wv-bio wv-biohtml">${text}</div>`
        : `<div class="wv-bio">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
    return `<div class="wv-dseclabel">Description</div>${body}`;
}

/**
 * The Description drawer holds the card's own body and nothing else: the bio
 * fallback that used to live here is what put a closed card's public bio under
 * Prompt Blocks.
 * @param {string} description
 * @returns {string}
 */
export function descriptionBodyHtml(description) {
    const text = String(description ?? '');
    return text ? escapeHtml(text).replace(/\n/g, '<br>') : '';
}
