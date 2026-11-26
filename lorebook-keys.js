// Weaver's Vault — author keys (P4).
//
// A closed Janitor lorebook arrives as text only: no entry ids, no names, no keys.
// What the author *did* publish is inside the text: sheets declare their own
// "- Keywords:" line, and every sheet names the character in "- Servant Name:".
// Harvest those into a store keyed by normalised title, and the same store can be
// applied to any book by the same author that shares the servant sheets.

import { normaliseName } from './lorebook-verify.js';

const KEY_LINE = /^\s*(?:[-*]\s*)?\[?\s*(?:keywords?|key words?|triggers?|aliases?|also known as)\s*\]?\s*:\s*(.+)$/i;

/** Tokens of a comma list, quotes and trailing punctuation stripped. */
export function splitKeyList(value) {
    return String(value || '')
        .split(/\s*,\s*/)
        .map((token) => token.replace(/^[\s"'\[]+/, '').replace(/[\s"'\];]+$/, '').trim())
        .filter((token) => token && token.toLowerCase() !== 'and');
}

/** Every key the author declared inside one entry body. */
export function harvestKeys(content) {
    const keys = [];
    for (const line of String(content || '').split('\n')) {
        const match = KEY_LINE.exec(line);
        if (match) keys.push(...splitKeyList(match[1]));
    }
    return keys;
}

function uniqueByName(values) {
    const out = [];
    for (const value of values) {
        if (!out.some((existing) => normaliseName(existing) === normaliseName(value))) out.push(value);
    }
    return out;
}

/** titles = every normalised title in the book: a qualified sheet does not claim the bare name. */
function titleKeys(title, titles) {
    const out = [];
    const push = (value) => {
        const text = String(value || '').trim();
        if (text && !out.some((existing) => normaliseName(existing) === normaliseName(text))) out.push(text);
    };
    push(title);
    for (const part of String(title || '').split(/\s*\/\s*/)) push(part);
    const bare = String(title || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    // "Scáthach (Summer)" is its own sheet: the bare name belongs to the base sheet,
    // so it is only a key here when no entry is titled that.
    if (bare && !(titles && titles.has(normaliseName(bare)))) push(bare);
    return out;
}

const SUB_SHEET = /^\s*-?\s*\[?Name\s*:\s*(.+?)\]?\s*;?\s*$/;

/** Split an entry at its "[Name: X" rows, so a container's people keep their own keys. */
export function subSheets(content) {
    const out = [];
    let current = null;
    for (const line of String(content || '').split('\n')) {
        const match = SUB_SHEET.exec(line);
        if (match) {
            if (current) out.push(current);
            current = { name: match[1].trim(), content: '' };
        } else if (current) {
            current.content += line + '\n';
        }
    }
    if (current) out.push(current);
    return out;
}

/**
 * entries -> { store, collisions, authored }
 * store is keyed by normaliseName(title) so a book's titles and a store's names match.
 */
export function buildKeyStore(entries) {
    const store = Object.create(null);
    const owners = new Map();
    const collisions = [];
    const titles = new Set((entries || []).map((entry) => normaliseName(entry.title)).filter(Boolean));
    let authored = 0;
    for (const entry of entries || []) {
        const title = String(entry.title || '').trim();
        const key = normaliseName(title);
        if (!key) continue;
        const declared = harvestKeys(entry.content);
        if (declared.length) authored += 1;
        const keys = [...titleKeys(title, titles)];
        for (const declaredKey of declared) {
            if (!keys.some((existing) => normaliseName(existing) === normaliseName(declaredKey))) keys.push(declaredKey);
        }
        store[key] = keys;
        for (const sheet of subSheets(entry.content)) {
            const declared = harvestKeys(sheet.content);
            if (!declared.length) continue;
            const name = normaliseName(sheet.name);
            if (!name || store[name]) continue;
            store[name] = uniqueByName([...titleKeys(sheet.name, titles), ...declared]);
            authored += 1;
        }
        for (const single of keys) {
            const owner = owners.get(normaliseName(single));
            if (!owner) owners.set(normaliseName(single), title);
            else if (owner !== title) collisions.push({ key: single, titles: [owner, title] });
        }
    }
    return { store, collisions, authored };
}

/** Compose stores left to right; later books win only where they say more. */
export function mergeStores(...stores) {
    const out = Object.create(null);
    for (const store of stores) {
        if (!store) continue;
        for (const [key, keys] of Object.entries(store)) {
            const existing = out[key] || [];
            const merged = existing.slice();
            for (const single of keys) {
                if (!merged.some((value) => normaliseName(value) === normaliseName(single))) merged.push(single);
            }
            out[key] = merged;
        }
    }
    return out;
}

/** Look a title up, tolerating the "(Caster)" qualifiers a review adds. */
export function authorKeysFor(store, title) {
    if (!store) return null;
    const keys = store[normaliseName(title)];
    if (Array.isArray(keys) && keys.length) return keys;
    const base = String(title || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const fallback = store[normaliseName(base)];
    return Array.isArray(fallback) && fallback.length ? fallback : null;
}

/** keysFor factory for buildLorebook: the author's list, plus the title. */
export function keysForStore(store) {
    const table = store || {};
    return (title) => authorKeysFor(table, title);
}

export default buildKeyStore;