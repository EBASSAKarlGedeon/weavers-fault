// Weaver's Vault — character library extension.
// Browse UI ported from Glaze's Discover tab (AGPL-3.0, github.com/hydall/Glaze):
// glass controls (surface @ 0.8 + 12px backdrop blur + accent@18% border),
// #19191A app bg / #1E1E1E surfaces / #C42A4A accent, catalog card with
// white@15% border + lift-on-hover, text chips, filter sheet, epoch guard.
// Source-adapter logic likewise ported from Glaze — see docs/ in the vault repo.
import { extension_settings } from '../../extensions.js';
import { getRequestHeaders, characters, getCharacters, importCharacter } from '../../../script.js';
import { convertCharacterBook, saveWorldInfo, updateWorldInfoList, importWorldInfo } from '../../world-info.js';

const extensionName = "Weaver's Vault";
const MODULE = 'weavers-vault';

const DEFAULTS = {
    nsfw: false,          // "Show NSFW" content filter (Glaze filter sheet)
    sort: 'popular',
    query: '',
    perPage: 24,
    openAfterImport: true,
    filters: {},          // per-source filter profiles (keyed by source id)
    ledger: [],           // import ledger (Q4): {source, id, name, what, at, url}
    favorites: [],        // {source, id, name}
};

function settings() {
    extension_settings[MODULE] = extension_settings[MODULE] ?? {};
    const s = extension_settings[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    return s;
}

function chubFilters() {
    const s = settings();
    s.filters.chub = s.filters.chub ?? {};
    const f = s.filters.chub;
    f.minTokens = Number(f.minTokens) || null;
    f.maxTokens = Number(f.maxTokens) || null;
    f.topics = Array.isArray(f.topics) ? f.topics : [];
    return f;
}

function saveSettingsQuiet() {
    // extension_settings is saved by Loreweaver's debounced settings saver; pull it in.
    import('../../../script.js').then(m => m.saveSettingsDebounced());
}

// Glaze colors its tag chips with small emoji markers (category chips keep the
// colored glyph, custom/hashtag chips render cyan). Map the common chub topics.
const TAG_EMOJI = [
    ['angst', '💔'], ['fluff', '🧸'], ['smut', '💋'], ['comedy', '😂'],
    ['dominant', '⛓️'], ['submissive', '🧎'], ['dead dove', '🕊️'], ['game', '🎮'],
    ['anime', '📺'], ['multiple', '👥'], ['anypov', '🎭'], ['malepov', '💁‍♂️'],
    ['fempov', '💁‍♀️'], ['royalty', '👑'], ['monster', '👹'], ['magic', '✨'],
    ['romance', '💗'], ['fantasy', '🐉'], ['adventure', '🗺️'], ['school', '🏫'],
    ['strategy', '🧠'], ['cultivation', '☯️'], ['rpg', '🎲'], ['drama', '🎬'],
    ['history', '📜'], ['sci-fi', '🚀'], ['science fiction', '🚀'], ['horror', '👻'],
    ['mystery', '🔍'], ['villain', '🦹'], ['hero', '🦸'], ['non-human', '👽'],
    ['fictional', '📚'], ['switch', '🔄'], ['maid', '🧹'], ['harem', '👥'],
    ['cheating', '💔'], ['husband', '💍'], ['boxer', '🥊'],
];
function tagEmoji(tag) {
    const l = String(tag).toLowerCase();
    for (const [key, emoji] of TAG_EMOJI) if (l.includes(key)) return emoji;
    return '';
}

const SORT_ICONS = {
    popular: 'fa-solid fa-star',
    trending_week: 'fa-solid fa-arrow-trend-up',
    trending_24h: 'fa-solid fa-fire',
    latest: 'fa-solid fa-clock',
    rating: 'fa-solid fa-thumbs-up',
    updated: 'fa-solid fa-rotate',
};
const SORT_LABELS = {
    popular: 'Most popular',
    trending_week: 'Trending this week',
    trending_24h: 'Trending 24 hours',
    latest: 'Latest',
    rating: 'Top rated',
    updated: 'Recently updated',
};

// ---------------------------------------------------------------------------
// Overlay shell (proven RPG-engine pattern: fullscreen DOM overlay, no iframe)
// ---------------------------------------------------------------------------

let root = null;

function ensureOverlay() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'wv-root';
    root.hidden = true;
    root.innerHTML = `
        <div class="wv-panel">
            <div class="wv-searchbar">
                <span class="fa-solid fa-magnifying-glass"></span>
                <input class="wv-search" type="text" placeholder="Search characters..." autocomplete="off" spellcheck="false" />
                <button class="wv-iconbtn wv-close" title="Close (Esc)" aria-label="Close"><span class="fa-solid fa-xmark"></span></button>
            </div>
            <div class="wv-row2">
                <button class="wv-glass wv-source" title="Source (more coming in v2)">
                    <span class="wv-srclogo">C</span>Chub<span class="fa-solid fa-chevron-down wv-dn"></span>
                </button>
                <div class="wv-right">
                    <button class="wv-iconbtn wv-filterbtn" title="Filters" aria-label="Filters">
                        <span class="fa-solid fa-filter"></span>
                        <span class="wv-badge" hidden></span>
                    </button>
                    <div class="wv-sortwrap">
                        <button class="wv-iconbtn wv-sortbtn" title="Sort" aria-label="Sort">
                            <span class="fa-solid fa-arrow-down-wide-short wv-sorticon"></span>
                            <span class="fa-solid fa-chevron-down wv-dn"></span>
                        </button>
                        <div class="wv-menu" hidden></div>
                    </div>
                </div>
            </div>
            <div class="wv-row3">
                <button class="wv-fpill wv-nsfw-chip" hidden>NSFW <span class="wv-x">×</span></button>
            </div>
            <div class="wv-status"></div>
            <div class="wv-grid"></div>
            <div class="wv-endbar"></div>
            <div class="wv-sentinel"></div>
            <div class="wv-detail" hidden></div>
            <div class="wv-filters-overlay" hidden>
                <div class="wv-modal" role="dialog" aria-label="Filters">
                    <div class="wv-mhead">
                        <h2>Filters</h2>
                        <button class="wv-mclose" aria-label="Close filters">×</button>
                    </div>
                    <div class="wv-msection">
                        <div class="wv-mlabel">CONTENT</div>
                        <div class="wv-mrow">
                            <span>Show NSFW</span>
                            <label class="wv-switch"><input type="checkbox" class="wv-nsfw" /><span class="wv-knob"></span></label>
                        </div>
                    </div>
                    <div class="wv-msection">
                        <div class="wv-mlabel">CARD</div>
                        <div class="wv-toklabel">Token Range</div>
                        <div class="wv-range">
                            <div class="wv-tinput"><span>Min</span><input type="text" inputmode="numeric" class="wv-mintok" placeholder="0" /></div>
                            <span class="wv-dash">-</span>
                            <div class="wv-tinput"><span>Max</span><input type="text" inputmode="numeric" class="wv-maxtok" placeholder="100000" /></div>
                        </div>
                    </div>
                    <div class="wv-msection">
                        <div class="wv-mlabel">TAGS</div>
                        <div class="wv-tagsearch">
                            <span class="fa-solid fa-magnifying-glass"></span>
                            <input type="text" class="wv-tagfilter" placeholder="Search tags..." spellcheck="false" />
                        </div>
                        <div class="wv-tagcloud"></div>
                        <button class="wv-showall">⌄ Show all (<span class="wv-tagcount">0</span>)</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(root);
    root.querySelector('.wv-close').addEventListener('click', closeVault);
    document.addEventListener('keydown', onKeydown);
    return root;
}

function onKeydown(e) {
    if (!root || root.hidden || e.key !== 'Escape') return;
    const overlay = root.querySelector('.wv-filters-overlay');
    if (!overlay.hidden) { overlay.hidden = true; return; }
    closeVault();
}

function openVault() {
    ensureOverlay();
    root.hidden = false;
    const s = settings();
    const f = chubFilters();
    state.query = s.query;
    state.sort = s.sort;
    state.nsfw = s.nsfw;
    state.topics = new Set(f.topics);
    state.minTok = f.minTokens;
    state.maxTok = f.maxTokens;
    root.querySelector('.wv-search').value = s.query;
    hydrateControls();
    if (!state.hydrated) {
        state.hydrated = true;
        runSearch();
    }
}

function closeVault() {
    if (root) root.hidden = true;
}

// ---------------------------------------------------------------------------
// Search state + epoch guard (Glaze mechanic: stale responses discarded on any
// change of query/sort/filters/page-reset)
// ---------------------------------------------------------------------------

const state = {
    hydrated: false,
    epoch: 0,
    query: '',
    sort: 'popular',
    nsfw: false,
    topics: new Set(),
    minTok: null,
    maxTok: null,
    tagCloud: null,      // lazily fetched tag index for the filter sheet
    tagCloudLoading: false,
    page: 0,
    items: [],
    total: 0,
    hasMore: false,
    loading: false,
    reachedEnd: false,
};

let searchTimer = null;

function resetAndSearch() {
    state.page = 0;
    state.items = [];
    state.reachedEnd = false;
    runSearch();
}

function activeFilterCount() {
    return (state.nsfw ? 1 : 0) + state.topics.size + ((state.minTok || state.maxTok) ? 1 : 0);
}

function runSearch() {
    const myEpoch = ++state.epoch;
    state.loading = true;
    state.page = state.page || 1;
    renderStatus('Searching…');
    fetch('/api/weavers-vault/chub/search', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            query: state.query,
            page: state.page,
            limit: settings().perPage,
            sort: state.sort,
            nsfw: state.nsfw,
            nsfl: false, // account-scoped on chub; v2 alongside the chub key
            topics: [...state.topics],
            minTokens: state.minTok || 0,
            maxTokens: state.maxTok || 100000,
        }),
    })
        .then(r => r.json().then(body => ({ ok: r.ok, status: r.status, body })))
        .then(({ ok, status, body }) => {
            if (myEpoch !== state.epoch) return; // stale
            state.loading = false;
            if (!ok) {
                // Party-labeled error: the source is at fault, not the app.
                renderStatus(`chub.ai answered ${status}${body?.error ? ` — ${body.error}` : ''}`, true);
                return;
            }
            if (state.page === 1) state.items = body.items ?? [];
            else state.items.push(...(body.items ?? []));
            state.total = body.total ?? state.items.length;
            state.hasMore = Boolean(body.hasMore);
            state.reachedEnd = state.items.length === 0 || !state.hasMore;
            renderGrid();
            renderStatus();
        })
        .catch(error => {
            if (myEpoch !== state.epoch) return;
            state.loading = false;
            renderStatus(`Network error — ${error.message}`, true);
        });
}

function loadMore() {
    if (state.loading || state.reachedEnd) return;
    state.page += 1;
    runSearch();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderStatus(text, isError = false) {
    const el = root.querySelector('.wv-status');
    el.classList.toggle('wv-status-error', isError);
    if (text) {
        el.textContent = text;
        el.hidden = false;
        return;
    }
    // Glaze: result count line + "End of results" footer at the grid's end.
    if (state.reachedEnd) {
        el.textContent = state.items.length
            ? `${state.items.length}${state.total ? ` of ${state.total}` : ''} results`
            : 'No results';
    } else {
        el.textContent = `${state.items.length}${state.total ? ` of ${state.total}` : ''} results`;
    }
    el.hidden = false;
}

// Glaze's number formatting: 1.0k / 1.0kk.
function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}kk`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function chipHtml(tag) {
    const emoji = tagEmoji(tag);
    if (emoji) return `<span class="wv-chip wv-c-cat">${emoji} ${escapeHtml(tag)}</span>`;
    return `<span class="wv-chip wv-c-tag">#${escapeHtml(tag)}</span>`;
}

function renderGrid() {
    const grid = root.querySelector('.wv-grid');
    grid.innerHTML = '';
    for (const item of state.items) {
        const card = document.createElement('article');
        card.className = 'wv-card';
        const blur = item.nsfw && !state.nsfw;
        const tags = item.tags ?? [];
        const chips = [
            `<span class="wv-chip ${item.nsfw ? 'wv-c-nsfw' : 'wv-c-sfw'}">${item.nsfw ? 'NSFW' : 'SFW'}</span>`,
            ...tags.slice(0, 8).map(chipHtml),
        ].join('');
        card.innerHTML = `
            <div class="wv-art ${blur ? 'wv-blur' : ''}">
                <img loading="lazy" referrerpolicy="no-referrer" alt="" />
                <div class="wv-ph"></div>
                ${blur ? '<button class="wv-reveal" title="Reveal">👁</button>' : ''}
                <span class="wv-chat"><span class="fa-regular fa-envelope"></span><span class="wv-chat-n">${item.chatCount ? fmtCount(item.chatCount) : ''}</span></span>
            </div>
            <div class="wv-info">
                <h3 class="wv-card-name"></h3>
                <div class="wv-creator"></div>
                <div class="wv-tokens"></div>
                <div class="wv-chips">${chips}</div>
                <p class="wv-syn"></p>
            </div>
        `;
        const img = card.querySelector('img');
        img.src = item.avatarUrl || '';
        card.querySelector('.wv-ph').textContent = (item.name || '?')[0].toUpperCase();
        img.addEventListener('error', () => { img.remove(); card.querySelector('.wv-art').classList.add('wv-noimg'); });
        if (blur) {
            card.querySelector('.wv-reveal')?.addEventListener('click', e => {
                e.stopPropagation();
                card.querySelector('.wv-art').classList.remove('wv-blur');
                card.querySelector('.wv-reveal').remove();
            });
        }
        const name = card.querySelector('.wv-card-name');
        name.textContent = item.name;
        name.title = item.name;
        card.querySelector('.wv-creator').textContent = `@${item.creator}`;
        card.querySelector('.wv-tokens').textContent = item.tokens ? `${fmtCount(item.tokens)} tokens` : '';
        card.querySelector('.wv-syn').textContent = item.description || '';
        // M3: detail popup on click.
        card.addEventListener('click', () => openDetail(item));
        grid.appendChild(card);
    }
    const endbar = root.querySelector('.wv-endbar');
    endbar.textContent = state.reachedEnd && state.items.length ? 'End of results' : '';
}

// ---------------------------------------------------------------------------
// Toolbar wiring (glass controls, sort menu, filter sheet)
// ---------------------------------------------------------------------------

function hydrateControls() {
    const badge = root.querySelector('.wv-badge');
    const n = activeFilterCount();
    badge.hidden = n === 0;
    badge.textContent = n;
    root.querySelector('.wv-nsfw-chip').hidden = !state.nsfw;
    root.querySelector('.wv-nsfw').checked = state.nsfw;
    root.querySelector('.wv-mintok').value = state.minTok ?? '';
    root.querySelector('.wv-maxtok').value = state.maxTok ?? '';
    const sortIcon = root.querySelector('.wv-sorticon');
    sortIcon.className = `${SORT_ICONS[state.sort] ?? 'fa-solid fa-sort'} wv-sorticon`;
    renderSortMenu();
    renderTagCloud();
}

function renderSortMenu() {
    const menu = root.querySelector('.wv-menu');
    menu.innerHTML = Object.entries(SORT_LABELS).map(([key, label]) =>
        `<button data-sort="${key}" class="${key === state.sort ? 'wv-on' : ''}">${label}</button>`).join('');
    menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        state.sort = b.dataset.sort;
        settings().sort = state.sort;
        saveSettingsQuiet();
        menu.hidden = true;
        hydrateControls();
        resetAndSearch();
    }));
}

function renderTagCloud() {
    const cloud = root.querySelector('.wv-tagcloud');
    const selected = state.topics;
    if (!state.tagCloud) {
        cloud.innerHTML = state.tagCloudLoading
            ? '<span class="wv-taghint">Loading tags…</span>'
            : '<span class="wv-taghint">Open the vault once with the filter sheet to load the tag index.</span>';
        root.querySelector('.wv-tagcount').textContent = state.tagCloud?.length ?? 0;
        return;
    }
    const query = (root.querySelector('.wv-tagfilter').value || '').toLowerCase();
    cloud.innerHTML = state.tagCloud
        .filter(t => !query || t.name.toLowerCase().includes(query))
        .map(t => `<button class="wv-tchip ${selected.has(t.name) ? 'wv-sel' : ''}" data-tag="${escapeHtml(t.name)}">${tagEmoji(t.name)} ${escapeHtml(t.name)}</button>`)
        .join('');
    root.querySelector('.wv-tagcount').textContent = state.tagCloud.length;
    cloud.querySelectorAll('.wv-tchip').forEach(b => b.addEventListener('click', () => {
        const tag = b.dataset.tag;
        if (state.topics.has(tag)) state.topics.delete(tag); else state.topics.add(tag);
        b.classList.toggle('wv-sel');
        persistFilters();
        hydrateControls();
        resetAndSearch();
    }));
}

function persistFilters() {
    const f = chubFilters();
    f.topics = [...state.topics];
    f.minTokens = state.minTok;
    f.maxTokens = state.maxTok;
    settings().nsfw = state.nsfw;
    saveSettingsQuiet();
}

function wireToolbar() {
    const search = root.querySelector('.wv-search');
    search.addEventListener('input', () => {
        state.query = search.value;
        settings().query = search.value;
        saveSettingsQuiet();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(resetAndSearch, 400); // Glaze's debounce cadence
    });

    // Sort menu (glass chip → picker, Glaze sortIconChip)
    root.querySelector('.wv-sortbtn').addEventListener('click', e => {
        e.stopPropagation();
        const menu = root.querySelector('.wv-menu');
        menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', e => {
        const menu = root.querySelector('.wv-menu');
        if (menu && !menu.hidden && !menu.contains(e.target)) menu.hidden = true;
    });

    // NSFW chip (active-filter pill with ×)
    root.querySelector('.wv-nsfw-chip').addEventListener('click', e => {
        state.nsfw = e.target.classList.contains('wv-x') ? false : !state.nsfw;
        persistFilters();
        hydrateControls();
        resetAndSearch();
    });

    // Filter sheet
    const overlay = root.querySelector('.wv-filters-overlay');
    root.querySelector('.wv-filterbtn').addEventListener('click', () => {
        overlay.hidden = false;
        ensureTagCloud();
    });
    root.querySelector('.wv-mclose').addEventListener('click', () => { overlay.hidden = true; });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.hidden = true; });
    root.querySelector('.wv-nsfw').addEventListener('change', e => {
        state.nsfw = e.target.checked;
        persistFilters();
        hydrateControls();
        resetAndSearch();
    });
    const minTok = root.querySelector('.wv-mintok');
    const maxTok = root.querySelector('.wv-maxtok');
    for (const input of [minTok, maxTok]) input.addEventListener('input', () => {
        state.minTok = Number(minTok.value) || null;
        state.maxTok = Number(maxTok.value) || null;
        persistFilters();
        hydrateControls();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(resetAndSearch, 500);
    });
    root.querySelector('.wv-tagfilter').addEventListener('input', () => renderTagCloud());

    // Infinite scroll (Glaze: load more when near the end)
    const sentinel = root.querySelector('.wv-sentinel');
    new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) loadMore();
    }, { root: root.querySelector('.wv-panel'), rootMargin: '400px' }).observe(sentinel);
}

async function ensureTagCloud() {
    if (state.tagCloud || state.tagCloudLoading) return;
    state.tagCloudLoading = true;
    renderTagCloud();
    try {
        const r = await fetch('/api/weavers-vault/chub/tags', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ limit: 80, sort: 'n_projects', nsfw: true, nsfl: false }),
        });
        const body = await r.json();
        if (r.ok) state.tagCloud = body.tags ?? [];
        else toastr.error(body?.error || `chub.ai answered ${r.status}`, "Weaver's Vault tags");
    } catch (error) {
        toastr.error(error.message, "Weaver's Vault tags");
    } finally {
        state.tagCloudLoading = false;
        renderTagCloud();
    }
}

// ---------------------------------------------------------------------------
// Detail popup + import (M3)
// ---------------------------------------------------------------------------

let detailAbort = null;

async function openDetail(item) {
    ensureOverlay();
    const popup = root.querySelector('.wv-detail');
    popup.hidden = false;
    popup.innerHTML = '<div class="wv-detail-body">Loading…</div>';
    detailAbort?.abort();
    detailAbort = new AbortController();
    try {
        const r = await fetch(`/api/weavers-vault/chub/character?fullPath=${encodeURIComponent(item.fullPath)}`,
            { headers: getRequestHeaders(), signal: detailAbort.signal });
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || `chub.ai answered ${r.status}`);
        renderDetail(popup, item, body.character);
    } catch (error) {
        if (error.name === 'AbortError') return;
        popup.innerHTML = `<div class="wv-detail-body wv-status-error">chub.ai failed — ${escapeHtml(error.message)}</div>`;
    }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderDetail(popup, item, character) {
    const d = character.data;
    const book = d.character_book;
    const bookEntries = book?.entries ? (book.entries.length ?? Object.keys(book.entries).length) : 0;
    popup.innerHTML = `
        <div class="wv-detail-head">
            <img class="wv-detail-poster" src="${escapeHtml(item.avatarUrl || '')}" referrerpolicy="no-referrer" alt="" />
            <div class="wv-detail-titlebox">
                <div class="wv-detail-name">${escapeHtml(d.name)}</div>
                <div class="wv-detail-sub">by ${escapeHtml(d.creator)} · ${item.tokens ? `${fmtCount(item.tokens)} tokens` : ''}
                    ${book ? ` · lorebook: ${bookEntries} entries` : ''}</div>
                <div class="wv-detail-tags">${(d.tags ?? []).slice(0, 8).map(t => chipHtml(t)).join('')}</div>
            </div>
            <button class="wv-detail-close menu_button" title="Close"><span class="fa-solid fa-xmark"></span></button>
        </div>
        <div class="wv-detail-body">
            ${d.creator_notes ? `<h4>Creator's note</h4><div>${escapeHtml(d.creator_notes)}</div>` : ''}
            ${d.description ? `<h4>Description</h4><div>${escapeHtml(d.description)}</div>` : ''}
            ${d.personality ? `<h4>Personality</h4><div>${escapeHtml(d.personality)}</div>` : ''}
            ${d.scenario ? `<h4>Scenario</h4><div>${escapeHtml(d.scenario)}</div>` : ''}
            ${d.first_mes ? `<h4>First message</h4><div class="wv-detail-pre">${escapeHtml(d.first_mes.slice(0, 1200))}${d.first_mes.length > 1200 ? '…' : ''}</div>` : ''}
            ${d.alternate_greetings?.length ? `<h4>Alternate greetings</h4><div>${d.alternate_greetings.length}</div>` : ''}
            ${d.mes_example ? `<h4>Example dialogue</h4><div class="wv-detail-pre">${escapeHtml(d.mes_example.slice(0, 600))}${d.mes_example.length > 600 ? '…' : ''}</div>` : ''}
            ${!d.description && !d.first_mes && !d.creator_notes ? '<div class="wv-status-error">No public definition on this card.</div>' : ''}
        </div>
        <div class="wv-detail-actions">
            <a class="wv-detail-source menu_button" href="https://chub.ai/characters/${encodeURIComponent(item.fullPath)}" target="_blank" rel="noopener noreferrer">Open on source site ↗</a>
            <button class="wv-import-button menu_button">Import</button>
        </div>
    `;
    popup.querySelector('.wv-detail-close').addEventListener('click', () => { popup.hidden = true; });
    popup.querySelector('.wv-import-button').addEventListener('click', () => {
        if (book) showImportModeSheet(item, character);
        else importChubCharacter(item, character, false);
    });
}

// Glaze's import-mode options sheet — only shown when a lorebook exists (Q11).
function showImportModeSheet(item, character) {
    const popup = root.querySelector('.wv-detail');
    const sheet = document.createElement('div');
    sheet.className = 'wv-mode-sheet';
    sheet.innerHTML = `
        <div class="wv-mode-title">Import what?</div>
        <button data-mode="both">Character + lorebook</button>
        <button data-mode="character">Character only</button>
        <button data-mode="lorebook">Lorebook only</button>
        <button data-mode="cancel" class="wv-mode-cancel">Cancel</button>
    `;
    popup.appendChild(sheet);
    sheet.addEventListener('click', e => {
        const mode = e.target?.dataset?.mode;
        if (!mode) return;
        sheet.remove();
        if (mode === 'cancel') return;
        if (mode === 'lorebook') importChubLorebookOnly(item, character);
        else importChubCharacter(item, character, mode === 'both');
    });
}

function ledgerCheck(item) {
    const s = settings();
    return s.ledger.find(e => e.source === 'chub' && e.id === item.fullPath);
}

function ledgerAdd(item, what) {
    const s = settings();
    s.ledger.push({ source: 'chub', id: item.fullPath, name: item.name, what, at: Date.now(), url: `https://chub.ai/characters/${item.fullPath}` });
    saveSettingsQuiet();
}

// Fetches a source file through Loreweaver's content pipeline (UA spoofing +
// chub parsing happen server-side) and returns the ready-to-import File.
async function vaultFetchSourceFile(url) {
    const r = await fetch('/api/content/importURL', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ url }),
    });
    if (!r.ok) throw new Error(`Loreweaver content pipeline answered ${r.status}`);
    const type = r.headers.get('X-Custom-Content-Type') ?? 'character';
    const blob = await r.blob();
    const fileName = (r.headers.get('Content-Disposition') ?? '').split('filename=')[1]?.replace(/"/g, '') ?? 'card.png';
    return { file: new File([blob], fileName, { type: blob.type }), type };
}

async function importChubCharacter(item, character, withBook) {
    const dup = ledgerCheck(item);
    if (dup) {
        toastr.warning(`Imported before (${new Date(dup.at).toLocaleString()}) — importing again creates a duplicate.`, "Weaver's Vault");
    }
    toastr.info('Importing character…', "Weaver's Vault");
    try {
        // Native chain minus the tag-import popup: content pipeline → importCharacter
        // (importTags:false → no dialog; the card's tags still ride the card data).
        const { file } = await vaultFetchSourceFile(`https://chub.ai/characters/${item.fullPath}`);
        await importCharacter(file, { importTags: false });
        await getCharacters();
        // Match by name; the import pipeline's JSON may differ subtly from the detail fetch.
        const target = characters.filter(c => c.name === character.data.name).pop();
        if (!target) {
            console.warn(`[${extensionName}] imported but could not locate character for provenance stamp`);
        } else {
            target.data.extensions = target.data.extensions ?? {};
            target.data.extensions.vault_source = 'chub';
            target.data.extensions.vault_url = `https://chub.ai/characters/${item.fullPath}`;
            let bookName;
            if (withBook && target.data.character_book) {
                bookName = target.data.character_book.name || `${target.name}'s Lorebook`;
                const converted = convertCharacterBook(target.data.character_book);
                await saveWorldInfo(bookName, converted, true);
                await updateWorldInfoList();
                target.data.extensions.world = bookName;
                toastr.success(`Lorebook '${bookName}' imported and linked.`, "Weaver's Vault");
            }
            // Stamp provenance via the standard character edit endpoint.
            await fetch('/api/characters/edit', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    ch_name: target.name,
                    avatar_url: target.avatar,
                    json_data: JSON.stringify(target),
                }),
            });
            await getCharacters();
        }
        ledgerAdd(item, 'character' + (withBook ? '+lorebook' : ''));
        toastr.success(`Imported ${character.data.name}`, "Weaver's Vault");
    } catch (error) {
        console.error(`[${extensionName}] import failed`, error);
        toastr.error(error.message, "Weaver's Vault import failed");
    }
}

async function importChubLorebookOnly(item, character) {
    const book = character.data.character_book;
    if (!book) return;
    try {
        const bookName = book.name || `${character.data.name}'s Lorebook`;
        const converted = convertCharacterBook(book);
        await saveWorldInfo(bookName, converted, true);
        await updateWorldInfoList();
        ledgerAdd(item, 'lorebook');
        toastr.success(`Lorebook '${bookName}' imported.`, "Weaver's Vault");
    } catch (error) {
        toastr.error(error.message, "Weaver's Vault import failed");
    }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function addMenuEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('wv-menu-entry')) return !!menu;
    const item = document.createElement('div');
    item.id = 'wv-menu-entry';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.title = "Open Weaver's Vault";
    const icon = document.createElement('div');
    icon.className = 'fa-solid fa-book extensionsMenuExtensionButton';
    const label = document.createElement('span');
    label.textContent = "Weaver's Vault";
    item.append(icon, label);
    item.addEventListener('click', openVault);
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openVault(); });
    menu.appendChild(item);
    return true;
}

function addLauncher() {
    if (document.getElementById('wv-launcher')) return;
    const b = document.createElement('button');
    b.id = 'wv-launcher';
    b.type = 'button';
    b.title = "Open Weaver's Vault";
    b.setAttribute('aria-label', "Open Weaver's Vault");
    b.textContent = '📚';
    b.addEventListener('click', openVault);
    document.body.appendChild(b);
}

jQuery(async () => {
    console.log(`[${extensionName}] Loading…`);
    try {
        settings();
        if (!addMenuEntry()) {
            // Menu not ready yet; retry shortly (same as RPG engine's approach).
            setTimeout(addMenuEntry, 2000);
        }
        addLauncher();
        ensureOverlay();
        wireToolbar();
        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});
