// Weaver's Vault — character library extension.
// Browse UI + filter sheet ported from Glaze (AGPL-3.0, github.com/hydall/Glaze).
// Pixel specs extracted widget-by-widget from the Glaze source (see design/):
//   glaze-spec-filter-sheet.md — filter sheet: floating window (52px title bar,
//     ≤640 wide, 85% height), MenuGroup cards (#1D1D1D r20, accent-caps header
//     13/w700/ls0.3), MenuSwitchItem rows (16px label, compact M3 switch),
//     range/number fields (r12 #1E1E1E, 15px tabular), FilterTagPicker
//     (stadium chips, selected row above search, fold at 24 + 6, "Show all"),
//     filters commit on close (dispose diff), NSFL gated behind a warning.
//   glaze-spec-catalog.md — browse screen: controls row (32px glass pills,
//     accent 13/w600 label, 18px icons), active-filter chips row (28px),
//     cards (2/3 art, white@15% border, hover lift, Glaze chip colors),
//     212px grid slots, chub hides the result-count line.
import { extension_settings } from '../../extensions.js';
import { getRequestHeaders, characters, getCharacters, importCharacter } from '../../../script.js';
import { convertCharacterBook, saveWorldInfo, updateWorldInfoList, importWorldInfo } from '../../world-info.js';
// Resolved against this module URL so the popup markup works wherever the
// extension is served from (the overlay DOM lives under the app's base URL).
const IMG_CHUB = new URL('chub.png', import.meta.url).href;
const IMG_SAUCEPAN = new URL('saucepan.svg', import.meta.url).href;
const IMG_DATACAT = new URL('datacat.png', import.meta.url).href;

// Provider switch (Glaze Providers popup): Datacat ships in M5 — the row is
// shown but disabled, exactly like an unbuilt milestone should be.
const SOURCE_META = {
    chub: { label: 'Chub', img: IMG_CHUB },
    saucepan: { label: 'Saucepan', img: IMG_SAUCEPAN },
    datacat: { label: 'Datacat', img: IMG_DATACAT },
};

// Extracted Saucepan cards by companionId — the detail FAB import consumes these.
const saucepanFiles = new Map();

function parseCompanionIdLocal(url) {
    const m = /saucepan\.ai\/companion\/([a-f0-9-]{8,64})/i.exec(String(url));
    return m ? m[1] : null;
}

const extensionName = "Weaver's Vault";
const MODULE = 'weavers-vault';

const DEFAULTS = {
    nsfw: false,          // committed content filter (applies when the sheet closes)
    sort: 'popular',
    query: '',
    source: 'chub',       // active catalog source (Q8): chub | saucepan | datacat
    perPage: 24,
    openAfterImport: true,
    filters: {},          // per-source filter profiles (keyed by source id)
    ledger: [],           // import ledger (Q4): {source, id, name, at, url}
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

// Glaze CatalogFilters defaults (catalog_models.dart): min 29 / max 100000.
const FILTER_DEFAULTS = {
    nsfw: false,
    nsfwOnly: false,
    minTokens: 29,
    maxTokens: 100000,
    minAiRating: 0,
    minTags: 0,
    requireImages: false,
    requireLore: false,
    requireCustomPrompt: false,
    requireExampleDialogues: false,
    requireAlternateGreetings: false,
    recommendedVerified: false,
    inclusiveOr: false,
    tagNames: [],        // selected tag names (chub topics are name-based)
};

function committedFilters() {
    const s = settings();
    s.filters.chub = s.filters.chub ?? {};
    const f = s.filters.chub;
    for (const [k, v] of Object.entries(FILTER_DEFAULTS)) {
        if (f[k] === undefined) f[k] = structuredClone(v);
    }
    f.tagNames = Array.isArray(f.tagNames) ? f.tagNames : [];
    f.minTokens = Number(f.minTokens) || 29;
    f.maxTokens = Number(f.maxTokens) || 100000;
    return f;
}

function saveSettingsQuiet() {
    // extension_settings is saved by Loreweaver's debounced settings saver; pull it in.
    import('../../../script.js').then(m => m.saveSettingsDebounced());
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

const REQUIRE_ROWS = [
    ['requireImages', 'With gallery images'],
    ['requireLore', 'With lorebooks'],
    ['requireCustomPrompt', 'With custom prompt'],
    ['requireExampleDialogues', 'With example dialogues'],
    ['requireAlternateGreetings', 'With alternate greetings'],
];

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function switchRowHtml(key, label) {
    return `
        <div class="wv-mrow">
            <span class="wv-mlabel2">${escapeHtml(label)}</span>
            <label class="wv-switch"><input type="checkbox" data-filter="${key}" /><span class="wv-knob"></span></label>
        </div>`;
}

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
                    <img class="wv-srclogo" src="${IMG_CHUB}" alt="" width="18" height="18" /><span class="wv-srclabel">Chub</span><span class="fa-solid fa-chevron-down wv-dn"></span>
                </button>
                <div class="wv-right">
                    <button class="wv-iconbtn wv-filterbtn" title="Filters" aria-label="Filters">
                        <span class="fa-solid fa-bars-staggered"></span>
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
            <div class="wv-row3"></div>
            <div class="wv-status"></div>
            <div class="wv-grid"></div>
            <div class="wv-endbar"></div>
            <div class="wv-sentinel"></div>
            <div class="wv-detail" hidden></div>

            <div class="wv-filters-overlay" hidden>
                <div class="wv-modal">
                    <div class="wv-sheetbar">
                        <span class="wv-sheettitle">Filters</span>
                        <span class="wv-spacer"></span>
                        <button class="wv-winbtn" data-win="max" title="Maximize (visual only)" aria-label="Maximize"><span class="fa-regular fa-square"></span></button>
                        <button class="wv-winbtn wv-mclose" title="Close" aria-label="Close filters"><span class="fa-solid fa-xmark"></span></button>
                    </div>
                    <div class="wv-sheetbody">
                        <section class="wv-mcard">
                            <div class="wv-mhead2">Content</div>
                            ${switchRowHtml('nsfw', 'Show NSFW')}
                            ${switchRowHtml('nsfl', 'Show NSFL')}
                            ${switchRowHtml('nsfwOnly', 'NSFW only')}
                        </section>
                        <section class="wv-mcard">
                            <div class="wv-mhead2">Card</div>
                            <div class="wv-rangerow">
                                <div class="wv-rangetitle">Token Range</div>
                                <div class="wv-range">
                                    <div class="wv-tinput"><span class="wv-prefix">Min</span><input type="text" inputmode="numeric" class="wv-mintok" placeholder="0" /></div>
                                    <span class="wv-dash">–</span>
                                    <div class="wv-tinput"><span class="wv-prefix">Max</span><input type="text" inputmode="numeric" class="wv-maxtok" placeholder="100000" /></div>
                                </div>
                            </div>
                            <div class="wv-mrow wv-numrow">
                                <span class="wv-mlabel2">Minimum AI rating</span>
                                <div class="wv-tinput wv-numfield"><input type="text" inputmode="numeric" class="wv-minair" placeholder="0" /></div>
                            </div>
                            <div class="wv-mrow wv-numrow">
                                <span class="wv-mlabel2">Minimum tag count</span>
                                <div class="wv-tinput wv-numfield"><input type="text" inputmode="numeric" class="wv-mintags" placeholder="0" /></div>
                            </div>
                        </section>
                        <section class="wv-mcard wv-collapsible" data-open="false">
                            <div class="wv-wash"></div>
                            <button class="wv-collapse-head">
                                <span class="wv-collapse-label">Must include</span>
                                <span class="fa-solid fa-chevron-down wv-collapse-chev"></span>
                            </button>
                            <div class="wv-collapse-body" hidden>
                                ${REQUIRE_ROWS.map(([k, label]) => switchRowHtml(k, label)).join('')}
                            </div>
                        </section>
                        <section class="wv-mcard">
                            <div class="wv-mhead2">Other</div>
                            ${switchRowHtml('recommendedVerified', 'Recommended / verified')}
                        </section>
                        <section class="wv-mcard">
                            <div class="wv-mhead2 wv-tagshead"><span>Tags</span><button class="wv-clearbtn" hidden></button></div>
                            ${switchRowHtml('inclusiveOr', 'Match any tag')}
                            <div class="wv-tagsbody">
                                <div class="wv-selwrap" hidden></div>
                                <div class="wv-tagsearch">
                                    <span class="fa-solid fa-magnifying-glass"></span>
                                    <input type="text" class="wv-tagfilter" placeholder="Search tags..." spellcheck="false" />
                                    <button class="wv-tagclear" hidden><span class="fa-solid fa-xmark"></span></button>
                                </div>
                                <div class="wv-tagcloud"></div>
                                <button class="wv-showall" hidden></button>
                            </div>
                        </section>
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
    if (!overlay.hidden) { closeFilterSheet(); return; }
    closeVault();
}

function openVault() {
    ensureOverlay();
    root.hidden = false;
    const s = settings();
    state.source = s.source ?? 'chub';
    const f = committedFilters();
    state.query = s.query;
    state.sort = s.sort;
    state.filters = { ...f, tags: new Set(f.tagNames) };
    state.nsfw = f.nsfw;
    root.querySelector('.wv-search').value = s.query;
    hydrateSourceChip();
    hydrateControls();
    if (!state.hydrated) {
        state.hydrated = true;
        if (state.source === 'chub') runSearch();
        else showSourceHint();
    }
}

// Non-browsable sources (Saucepan URL import): the grid stays empty until a
// companion URL is pasted — the hint names the flow, Glaze empty-state style.
function showSourceHint() {
    const grid = root.querySelector('.wv-grid');
    if (grid) grid.innerHTML = '';
    const meta = SOURCE_META[state.source] ?? SOURCE_META.chub;
    const status = root.querySelector('.wv-status');
    if (status && !status.textContent) {
        status.textContent = state.source === 'saucepan'
            ? 'Paste a saucepan.ai companion URL above to import'
            : `${meta.label}: coming in a later milestone`;
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
    source: 'chub',      // active catalog source (mirrors settings().source)
    filters: null,       // committed filter model (Glaze CatalogFilters mirror)
    tagCloud: null,      // full tag index for the filter sheet (loaded lazily)
    tagCloudLoading: false,
    tagQuery: '',
    tagSuggestions: [],
    tagSuggestionsLoading: false,
    tagExpanded: false,
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

// Glaze badge count (catalog_controls.dart): nsfw + tags + token bounds ≠
// defaults + the chub-only flags.
function activeFilterCount() {
    const f = state.filters;
    if (!f) return 0;
    let n = 0;
    if (f.nsfw) n++;
    if (f.nsfwOnly) n++;
    if (f.minTokens !== FILTER_DEFAULTS.minTokens || f.maxTokens !== FILTER_DEFAULTS.maxTokens) n++;
    if (f.minAiRating > 0) n++;
    if (f.minTags > 0) n++;
    for (const [key] of REQUIRE_ROWS) if (f[key]) n++;
    if (f.recommendedVerified) n++;
    if (f.inclusiveOr && f.tags.size) n++;
    n += f.tags.size;
    return n;
}

function runSearch() {
    const myEpoch = ++state.epoch;
    state.loading = true;
    state.page = state.page || 1;
    renderStatus('Searching…');
    const f = state.filters ?? { ...committedFilters(), tags: new Set() };
    fetch('/api/weavers-vault/chub/search', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            query: state.query,
            page: state.page,
            limit: settings().perPage,
            sort: state.sort,
            nsfw: f.nsfw,
            nsfl: Boolean(f.nsfl),
            topics: [...f.tags],
            minTokens: f.minTokens,
            maxTokens: f.maxTokens,
            flags: {
                nsfwOnly: f.nsfwOnly,
                requireImages: f.requireImages,
                requireLore: f.requireLore,
                requireCustomPrompt: f.requireCustomPrompt,
                requireExampleDialogues: f.requireExampleDialogues,
                requireAlternateGreetings: f.requireAlternateGreetings,
                recommendedVerified: f.recommendedVerified,
                inclusiveOr: f.inclusiveOr,
                minAiRating: f.minAiRating,
                minTags: f.minTags,
            },
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
    // Chub is the only browsable (infinite-scroll) source; clearing the grid
    // for a non-browsable source must not drag the sentinel into a search.
    if (state.source !== 'chub' || state.loading || state.reachedEnd) return;
    state.page += 1;
    runSearch();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderStatus(text, isError = false) {
    const el = root.querySelector('.wv-status');
    el.classList.toggle('wv-status-error', isError);
    // Chub hides the result-count line (catalog_grid.dart:136-137): errors
    // still show, counts stay in the DOM for screen readers only.
    if (text && isError) {
        el.textContent = text;
        el.classList.remove('wv-sronly');
        el.hidden = false;
        return;
    }
    el.classList.add('wv-sronly');
    el.textContent = text || (state.reachedEnd
        ? (state.items.length ? `${state.items.length}${state.total ? ` of ${state.total}` : ''} results` : 'No results')
        : `${state.items.length}${state.total ? ` of ${state.total}` : ''} results`);
    el.hidden = false;
}

// Glaze's number formatting: 1.0k / 1.0kk.
function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}kk`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

// CardTagChips (card_tag_chips.dart): NSFW/SFW/`#custom` get dedicated
// colors; every other tag is primary-tinted. Text only — no emoji in code.
function chipHtml(tag) {
    if (String(tag).startsWith('#')) return `<span class="wv-chip wv-c-tag">${escapeHtml(tag)}</span>`;
    return `<span class="wv-chip wv-c-cat">${escapeHtml(tag)}</span>`;
}

function renderGrid() {
    const grid = root.querySelector('.wv-grid');
    grid.innerHTML = '';
    const nsfwOn = state.filters?.nsfw;
    for (const item of state.items) {
        const card = document.createElement('article');
        card.className = 'wv-card';
        const blur = item.nsfw && !nsfwOn;
        const tags = item.tags ?? [];
        const chips = [
            `<span class="wv-chip ${item.nsfw ? 'wv-c-nsfw' : 'wv-c-sfw'}">${item.nsfw ? 'NSFW' : 'SFW'}</span>`,
            ...tags.slice(0, 8).map(t => chipHtml(`#${t}`)),
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

// Active-filter chips row (Glaze _ActiveTagsRow): 28px horizontal chips.
// NSFW red; selected tags accent-tinted; each chip removes its filter.
function renderActiveChips() {
    const row = root.querySelector('.wv-row3');
    const f = state.filters;
    if (!f) { row.innerHTML = ''; return; }
    const chips = [];
    if (f.nsfw) chips.push(`<button class="wv-fchip wv-fchip-nsfw" data-clear="nsfw">NSFW <span class="fa-solid fa-xmark wv-fchipx"></span></button>`);
    if (f.nsfwOnly) chips.push(`<button class="wv-fchip" data-clear="nsfwOnly">NSFW only <span class="fa-solid fa-xmark wv-fchipx"></span></button>`);
    if (f.minTokens !== FILTER_DEFAULTS.minTokens || f.maxTokens !== FILTER_DEFAULTS.maxTokens) {
        chips.push(`<button class="wv-fchip" data-clear="tokens">${f.minTokens}–${f.maxTokens} tokens <span class="fa-solid fa-xmark wv-fchipx"></span></button>`);
    }
    if (f.minAiRating > 0) chips.push(`<button class="wv-fchip" data-clear="minAiRating">AI rating ≥ ${f.minAiRating} <span class="fa-solid fa-xmark wv-fchipx"></span></button>`);
    if (f.minTags > 0) chips.push(`<button class="wv-fchip" data-clear="minTags">Tags ≥ ${f.minTags} <span class="fa-solid fa-xmark wv-fchipx"></span></button>`);
    for (const [key, label] of REQUIRE_ROWS) {
        if (f[key]) chips.push(`<button class="wv-fchip" data-clear="${key}">${label} <span class="fa-solid fa-xmark wv-fchipx"></span></button>`);
    }
    if (f.recommendedVerified) chips.push(`<button class="wv-fchip" data-clear="recommendedVerified">Recommended / verified <span class="fa-solid fa-xmark wv-fchipx"></span></button>`);
    for (const tag of f.tags) {
        chips.push(`<button class="wv-fchip" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)} <span class="fa-solid fa-xmark wv-fchipx"></span></button>`);
    }
    row.innerHTML = chips.join('');
    row.querySelectorAll('.wv-fchip').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.clear) {
            const key = b.dataset.clear;
            if (key === 'tokens') { state.filters.minTokens = FILTER_DEFAULTS.minTokens; state.filters.maxTokens = FILTER_DEFAULTS.maxTokens; }
            else state.filters[key] = false;
        } else if (b.dataset.tag) {
            state.filters.tags.delete(b.dataset.tag);
        }
        commitFilters();
        resetAndSearch();
    }));
}

// ---------------------------------------------------------------------------
// Toolbar wiring (glass controls, sort menu)
// ---------------------------------------------------------------------------

function hydrateControls() {
    const badge = root.querySelector('.wv-badge');
    const n = activeFilterCount();
    badge.hidden = n === 0;
    badge.textContent = n;
    renderActiveChips();
    const sortIcon = root.querySelector('.wv-sorticon');
    sortIcon.className = `${SORT_ICONS[state.sort] ?? 'fa-solid fa-sort'} wv-sorticon`;
    renderSortMenu();
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

function wireToolbar() {
    const search = root.querySelector('.wv-search');
    search.addEventListener('input', () => {
        state.query = search.value;
        settings().query = search.value;
        saveSettingsQuiet();
        // Saucepan source: the search bar is a paste-URL importer, not browse.
        if (state.source === 'saucepan') {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                if (parseCompanionIdLocal(state.query)) importSaucepanUrl(state.query.trim());
            }, 600);
            return;
        }
        clearTimeout(searchTimer);
        searchTimer = setTimeout(resetAndSearch, 400); // Glaze's debounce cadence
    });
    search.addEventListener('keydown', e => {
        if (e.key === 'Enter' && state.source === 'saucepan' && parseCompanionIdLocal(search.value)) {
            e.preventDefault();
            clearTimeout(searchTimer);
            importSaucepanUrl(search.value.trim());
        }
    });

    // Source chip → Providers popup (Glaze provider switch: rows + active check).
    root.querySelector('.wv-source').addEventListener('click', e => {
        e.stopPropagation();
        showSourceMenu();
    });

    // Sort menu (glass chip → desktop popup, Glaze sortIconChip)
    root.querySelector('.wv-sortbtn').addEventListener('click', e => {
        e.stopPropagation();
        const menu = root.querySelector('.wv-menu');
        menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', e => {
        const menu = root.querySelector('.wv-menu');
        if (menu && !menu.hidden && !menu.contains(e.target)) menu.hidden = true;
    });

    // Filter sheet (floating window; filters commit on close, like Glaze)
    const overlay = root.querySelector('.wv-filters-overlay');
    root.querySelector('.wv-filterbtn').addEventListener('click', () => openFilterSheet());
    root.querySelector('.wv-mclose').addEventListener('click', () => closeFilterSheet());
    overlay.addEventListener('click', e => { if (e.target === overlay) closeFilterSheet(); });

    // Collapsible "Must include" group (Glaze MenuCollapsibleSection)
    root.querySelector('.wv-collapse-head').addEventListener('click', () => {
        const card = root.querySelector('.wv-collapsible');
        const open = card.dataset.open === 'true';
        card.dataset.open = String(!open);
        card.querySelector('.wv-collapse-body').hidden = open;
    });

    // Number fields commit into the draft; applied when the sheet closes.
    const minTok = root.querySelector('.wv-mintok');
    const maxTok = root.querySelector('.wv-maxtok');
    const minAir = root.querySelector('.wv-minair');
    const minTags = root.querySelector('.wv-mintags');
    for (const [input, key] of [[minTok, 'minTokens'], [maxTok, 'maxTokens'], [minAir, 'minAiRating'], [minTags, 'minTags']]) {
        input.addEventListener('input', () => {
            state.filters[key] = Number(input.value) || 0;
        });
    }

    // Switch rows (toggle rows inside group cards)
    root.querySelectorAll('.wv-sheetbody input[data-filter]').forEach(box => {
        box.addEventListener('change', () => {
            state.filters[box.dataset.filter] = box.checked;
        });
    });

    // Tag picker wiring
    root.querySelector('.wv-tagfilter').addEventListener('input', () => {
        const q = root.querySelector('.wv-tagfilter').value.trim();
        root.querySelector('.wv-tagclear').hidden = !q;
        clearTimeout(tagSearchTimer);
        state.tagQuery = q;
        state.tagExpanded = false;
        renderTagPicker();
        if (q) tagSearchTimer = setTimeout(() => fetchTagSuggestions(q), 250); // Glaze's debounce
    });
    root.querySelector('.wv-tagclear').addEventListener('click', () => {
        root.querySelector('.wv-tagfilter').value = '';
        root.querySelector('.wv-tagclear').hidden = true;
        state.tagQuery = '';
        state.tagSuggestions = [];
        renderTagPicker();
    });
    root.querySelector('.wv-clearbtn').addEventListener('click', () => {
        state.filters.tags.clear();
        renderTagPicker();
    });
    root.querySelector('.wv-showall').addEventListener('click', () => {
        state.tagExpanded = !state.tagExpanded;
        renderTagPicker();
    });

    // Infinite scroll (Glaze: load more when near the end)
    const sentinel = root.querySelector('.wv-sentinel');
    new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) loadMore();
    }, { root: root.querySelector('.wv-panel'), rootMargin: '600px' }).observe(sentinel);
}

// ---------------------------------------------------------------------------
// Filter sheet (Glaze CatalogFilterSheet: draft state, commit on close)
// ---------------------------------------------------------------------------

let tagSearchTimer = null;

function openFilterSheet() {
    const overlay = root.querySelector('.wv-filters-overlay');
    // Fresh draft from the committed profile (Glaze initState); edits apply
    // when the sheet closes.
    state.filters = { ...state.filters, tags: new Set(state.filters.tags) };
    const f = state.filters;
    root.querySelectorAll('.wv-sheetbody input[data-filter]').forEach(box => {
        box.checked = Boolean(f[box.dataset.filter]);
    });
    root.querySelector('.wv-mintok').value = f.minTokens;
    root.querySelector('.wv-maxtok').value = f.maxTokens;
    root.querySelector('.wv-minair').value = f.minAiRating;
    root.querySelector('.wv-mintags').value = f.minTags;
    syncCollapsible();
    state.tagExpanded = false;
    state.tagQuery = '';
    state.tagSuggestions = [];
    root.querySelector('.wv-tagfilter').value = '';
    root.querySelector('.wv-tagclear').hidden = true;
    overlay.hidden = false;
    ensureTagCloud();
    renderTagPicker();
}

function syncCollapsible() {
    const collapsible = root.querySelector('.wv-collapsible');
    const f = state.filters;
    const reqActive = REQUIRE_ROWS.filter(([k]) => f[k]).length;
    const open = reqActive > 0;
    collapsible.dataset.open = String(open);
    collapsible.querySelector('.wv-collapse-body').hidden = !open;
    collapsible.querySelector('.wv-collapse-label').textContent =
        reqActive > 0 ? `Must include · ${reqActive}` : 'Must include';
}

function closeFilterSheet() {
    const overlay = root.querySelector('.wv-filters-overlay');
    overlay.hidden = true;
    // Glaze: commit on dispose — diff the draft against the committed profile.
    const draft = state.filters;
    const committed = committedFilters();
    const draftTags = [...draft.tags].sort();
    const changed =
        draft.nsfw !== committed.nsfw ||
        draft.nsfwOnly !== committed.nsfwOnly ||
        draft.minTokens !== committed.minTokens ||
        draft.maxTokens !== committed.maxTokens ||
        draft.minAiRating !== committed.minAiRating ||
        draft.minTags !== committed.minTags ||
        draft.requireImages !== committed.requireImages ||
        draft.requireLore !== committed.requireLore ||
        draft.requireCustomPrompt !== committed.requireCustomPrompt ||
        draft.requireExampleDialogues !== committed.requireExampleDialogues ||
        draft.requireAlternateGreetings !== committed.requireAlternateGreetings ||
        draft.recommendedVerified !== committed.recommendedVerified ||
        draft.inclusiveOr !== committed.inclusiveOr ||
        JSON.stringify(draftTags) !== JSON.stringify([...committed.tagNames].sort());
    if (changed) {
        commitFilters();
        resetAndSearch();
    }
}

function commitFilters() {
    const draft = state.filters;
    const f = committedFilters();
    Object.assign(f, {
        nsfw: draft.nsfw,
        nsfl: Boolean(draft.nsfl),
        nsfwOnly: draft.nsfwOnly,
        minTokens: draft.minTokens,
        maxTokens: draft.maxTokens,
        minAiRating: draft.minAiRating,
        minTags: draft.minTags,
        requireImages: draft.requireImages,
        requireLore: draft.requireLore,
        requireCustomPrompt: draft.requireCustomPrompt,
        requireExampleDialogues: draft.requireExampleDialogues,
        requireAlternateGreetings: draft.requireAlternateGreetings,
        recommendedVerified: draft.recommendedVerified,
        inclusiveOr: draft.inclusiveOr,
        tagNames: [...draft.tags],
    });
    state.nsfw = f.nsfw;
    state.filters = { ...f, tags: new Set(f.tagNames) };
    saveSettingsQuiet();
    hydrateControls();
}

async function ensureTagCloud() {
    if (state.tagCloud || state.tagCloudLoading) return;
    state.tagCloudLoading = true;
    renderTagPicker();
    try {
        const r = await fetch('/api/weavers-vault/chub/tags', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ limit: 500, sort: 'n_projects', nsfw: true, nsfl: true }),
        });
        const body = await r.json();
        if (r.ok) state.tagCloud = (body.tags ?? []).map(t => t.name);
        else toastr.error(body?.error || `chub.ai answered ${r.status}`, "Weaver's Vault tags");
    } catch (error) {
        toastr.error(error.message, "Weaver's Vault tags");
    } finally {
        state.tagCloudLoading = false;
        renderTagPicker();
    }
}

async function fetchTagSuggestions(q) {
    state.tagSuggestionsLoading = true;
    renderTagPicker();
    try {
        const r = await fetch('/api/weavers-vault/chub/tags', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ limit: 20, search: q, nsfw: true, nsfl: false }),
        });
        const body = await r.json();
        if (state.tagQuery !== q) return; // stale (out-of-order response guard)
        state.tagSuggestions = (body.tags ?? []).map(t => t.name);
    } catch {
        if (state.tagQuery === q) state.tagSuggestions = [];
    } finally {
        if (state.tagQuery === q) {
            state.tagSuggestionsLoading = false;
            renderTagPicker();
        }
    }
}

// FilterTagPicker render: selected chips row → search → grid (local matches,
// starts-with first + remote suggestions + "add raw query" chip) → folding
// at collapsedCount 24, folding only when the pool exceeds 24 + 6.
function renderTagPicker() {
    const f = state.filters;
    if (!f) return;
    const cloud = root.querySelector('.wv-tagcloud');
    const selwrap = root.querySelector('.wv-selwrap');
    const clearBtn = root.querySelector('.wv-clearbtn');
    const showAll = root.querySelector('.wv-showall');
    const query = (root.querySelector('.wv-tagfilter').value || '').trim().toLowerCase();

    // Header trailing "Clear (n)"
    const selectedCount = f.tags.size;
    clearBtn.hidden = selectedCount === 0;
    clearBtn.textContent = `Clear (${selectedCount})`;

    // Selected chips row (sits above the search field)
    if (selectedCount > 0) {
        selwrap.hidden = false;
        selwrap.innerHTML = [...f.tags].map(t =>
            `<button class="wv-tchip wv-sel" data-tag="${escapeHtml(t)}">${escapeHtml(t)}<span class="fa-solid fa-xmark wv-chipx"></span></button>`).join('');
        selwrap.querySelectorAll('.wv-tchip').forEach(b => b.addEventListener('click', () => {
            f.tags.delete(b.dataset.tag);
            renderTagPicker();
        }));
    } else {
        selwrap.hidden = true;
        selwrap.innerHTML = '';
    }

    // Grid
    if (state.tagCloudLoading && !state.tagCloud && !query) {
        cloud.innerHTML = '<div class="wv-tagloading"><span class="wv-spinner"></span></div>';
        showAll.hidden = true;
        return;
    }
    let pool;
    if (query) {
        const known = new Set((state.tagCloud ?? []).map(t => t.toLowerCase()));
        const local = (state.tagCloud ?? [])
            .filter(t => !f.tags.has(t) && t.toLowerCase().includes(query))
            .sort((a, b) => (b.toLowerCase().startsWith(query) ? 1 : 0) - (a.toLowerCase().startsWith(query) ? 1 : 0));
        const remote = (state.tagSuggestions ?? [])
            .map(s => s.trim())
            .filter(s => s && !known.has(s.toLowerCase()) && ![...f.tags].some(t => t.toLowerCase() === s.toLowerCase()))
            .map(s => ({ name: s }));
        pool = [...local.map(t => ({ name: t })), ...remote];
        const addRaw = ![...f.tags].some(t => t.toLowerCase() === query)
            && !(state.tagCloud ?? []).some(t => t.toLowerCase() === query)
            && !remote.some(t => t.name.toLowerCase() === query);
        if (addRaw) pool.push({ name: query, addRaw: true });
        if (!pool.length) {
            cloud.innerHTML = `<div class="wv-taghint">${state.tagSuggestionsLoading ? 'Searching tags...' : 'No tags found'}</div>`;
            showAll.hidden = true;
            return;
        }
    } else {
        pool = (state.tagCloud ?? []).filter(t => !f.tags.has(t)).map(t => ({ name: t }));
        if (!pool.length) {
            cloud.innerHTML = '<div class="wv-taghint">No tags yet</div>';
            showAll.hidden = true;
            return;
        }
    }

    const LIMIT = 24;
    const folds = pool.length > LIMIT + 6;
    const shown = folds && !state.tagExpanded ? pool.slice(0, LIMIT) : pool;
    cloud.innerHTML = shown.map(t => t.addRaw
        ? `<button class="wv-tchip wv-addraw" data-raw="1"><span class="fa-solid fa-plus"></span>${escapeHtml(t.name)}</button>`
        : `<button class="wv-tchip" data-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`).join('');
    showAll.hidden = !folds;
    if (folds) showAll.innerHTML = state.tagExpanded
        ? '<span class="fa-solid fa-chevron-up"></span> Show less'
        : `<span class="fa-solid fa-chevron-down"></span> Show all (${pool.length})`;

    cloud.querySelectorAll('.wv-tchip').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.raw) {
            const raw = root.querySelector('.wv-tagfilter').value.trim();
            if (raw) f.tags.add(raw);
        } else {
            f.tags.add(b.dataset.tag);
        }
        // A pick from a search result ends the search (Glaze): the chip moves
        // up into the selection and the query is spent.
        root.querySelector('.wv-tagfilter').value = '';
        root.querySelector('.wv-tagclear').hidden = true;
        state.tagQuery = '';
        state.tagSuggestions = [];
        state.tagExpanded = false;
        renderTagPicker();
    }));
}

// ---------------------------------------------------------------------------
// Detail popup + import (M3)
// ---------------------------------------------------------------------------

let detailAbort = null;

// Character detail as Glaze's desktop window (glaze_sheet.dart: chrome'd
// floating window, EMPTY title, close button, no dim): hero 310 + floating
// header buttons + pill tab strip + Info/Prompt Blocks/Images panes + the
// accent Import FAB bottom-right (character_detail_screen.dart).
/**
 * Desktop window chrome (desktop_window_chrome.dart): title bar carries a
 * maximize toggle (crop_square <-> fullscreen_exit) next to close. Maximizing
 * fills the bounds with square corners, exactly like Glaze's
 * `_maximized ? Offset.zero & bounds : ...`.
 */
function wireWinChrome(popup, onClose) {
    const win = popup.querySelector('.wv-dwin');
    const max = popup.querySelector('.wv-dmax');
    popup.querySelector('.wv-dclose')?.addEventListener('click', onClose);
    if (!max || !win) return;
    max.addEventListener('click', () => {
        const on = win.classList.toggle('wv-max');
        max.title = on ? 'Restore' : 'Maximize';
        max.innerHTML = on
            ? '<span class="fa-solid fa-compress"></span>'
            : '<span class="fa-regular fa-square"></span>';
    });
}

async function openDetail(item, preloaded = null) {
    ensureOverlay();
    const popup = root.querySelector('.wv-detail');
    popup.hidden = false;
    popup.innerHTML = `
        <div class="wv-dwin">
            <div class="wv-dwinbar">
                <div class="wv-sheettitle"></div>
                <button class="wv-winbtn wv-dmax" title="Maximize"><span class="fa-regular fa-square"></span></button>
                    <button class="wv-winbtn wv-dclose" title="Close"><span class="fa-solid fa-xmark"></span></button>
            </div>
            <div class="wv-dloading">
                <span class="wv-spinner"></span>
                <div class="wv-dphase">Loading character…</div>
            </div>
        </div>`;
    wireWinChrome(popup, () => { popup.hidden = true; });
    detailAbort?.abort();
    detailAbort = new AbortController();
    // Saucepan items arrive with the character already extracted — no fetch.
    if (preloaded) {
        renderDetail(popup, item, preloaded);
        return;
    }
    try {
        const r = await fetch(`/api/weavers-vault/chub/character?fullPath=${encodeURIComponent(item.fullPath)}`,
            { headers: getRequestHeaders(), signal: detailAbort.signal });
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || `chub.ai answered ${r.status}`);
        renderDetail(popup, item, body.character);
    } catch (error) {
        if (error.name === 'AbortError') return;
        if (popup.hidden) return;
        popup.innerHTML = `
            <div class="wv-dwin">
                <div class="wv-dwinbar">
                    <div class="wv-sheettitle"></div>
                    <button class="wv-winbtn wv-dmax" title="Maximize"><span class="fa-regular fa-square"></span></button>
                    <button class="wv-winbtn wv-dclose" title="Close"><span class="fa-solid fa-xmark"></span></button>
                </div>
                <div class="wv-derror">
                    <span class="fa-solid fa-triangle-exclamation wv-derricon"></span>
                    <div class="wv-derrmsg">chub.ai failed — ${escapeHtml(error.message)}</div>
                    <button class="wv-dretry" data-fullpath="${escapeHtml(item.fullPath)}">Try again</button>
                </div>
            </div>`;
        wireWinChrome(popup, () => { popup.hidden = true; });
        popup.querySelector('.wv-dretry').addEventListener('click', () => openDetail(item));
    }
}

// _TagChip (character_detail_screen.dart:1699–1736) — NSFW/SFW/# colors,
// others accent-dim; radius 10, padding h9 v3, 11/600.
function detailTagChip(tag) {
    const t = String(tag);
    const cls = /^nsfw$/i.test(t) ? 'nsfw' : /^sfw$/i.test(t) ? 'sfw'
        : t.startsWith('#') ? 'custom' : 'cat';
    return `<span class="wv-dtagchip wv-dtag-${cls}">${escapeHtml(t)}</span>`;
}

// Prompt-blocks accordion sections in Glaze's order (:1751–1786);
// non-empty only.
const DETAIL_PROMPT_SECTIONS = [
    ['description', 'Description'],
    ['personality', 'Personality'],
    ['scenario', 'Scenario'],
    ['mes_example', 'Message Example'],
    ['system_prompt', 'System Prompt'],
    ['post_history_instructions', 'Post-History Instructions'],
];

function renderDetail(popup, item, character) {
    const d = character.data;
    const name = d.name || '?';
    const book = d.character_book;
    // Glaze's Info tab reads `character.creatorNotes` (_InfoTab:1492), i.e. the
    // card's storefront/creator notes — NOT the card body. The body is the
    // Description block inside the Prompt Blocks tab. Rendering `description`
    // here showed a completely different text than the real app.
    const bioText = String(d.creator_notes ?? '').trim();
    const greetings = [d.first_mes, ...(d.alternate_greetings ?? [])].filter(g => g && g.trim());

    popup.innerHTML = `
        <div class="wv-dwin">
            <div class="wv-dwinbar">
                <div class="wv-sheettitle"></div>
                <button class="wv-winbtn wv-dmax" title="Maximize"><span class="fa-regular fa-square"></span></button>
                    <button class="wv-winbtn wv-dclose" title="Close"><span class="fa-solid fa-xmark"></span></button>
            </div>
            <div class="wv-dscroll">
                <div class="wv-hero">
                    <img class="wv-heroimg ${item.nsfw && !(state.filters?.nsfw) ? 'wv-blurred' : ''}" src="${escapeHtml(item.avatarUrl || '')}" referrerpolicy="no-referrer" alt="" />
                    <div class="wv-heroscrim"></div>
                    <div class="wv-dheadbtns">
                        <button class="wv-dhbtn wv-dback" title="Back"><span class="fa-solid fa-arrow-left"></span></button>
                        <span class="wv-dhspacer"></span>
                        <button class="wv-dhbtn wv-dkebab" title="More"><span class="fa-solid fa-ellipsis-v"></span></button>
                    </div>
                    <div class="wv-herocap">
                        <div class="wv-heroname">${escapeHtml(name)}</div>
                        ${d.creator
                            ? `<a class="wv-heroauthor" href="${item.source === 'saucepan' ? 'https://saucepan.ai/companion/' + encodeURIComponent(item.fullPath ?? '') : 'https://chub.ai/' + escapeHtml((item.fullPath || '').split('/')[0])}" target="_blank" rel="noopener noreferrer">@${escapeHtml(d.creator)}</a>`
                            : (item.source === 'saucepan' ? '' : `<span class="wv-heroauthor">@${escapeHtml((item.fullPath || '').split('/')[0])}</span>`)}
                    </div>
                </div>
                <div class="wv-dtabs" data-active="0">
                    <div class="wv-dtabind"></div>
                    <button class="wv-dtab"><span class="fa-solid fa-circle-info"></span><span>Info</span></button>
                    <button class="wv-dtab"><span class="fa-solid fa-file-lines"></span><span>Prompt Blocks</span></button>
                    <button class="wv-dtab"><span class="fa-regular fa-images"></span><span>Images</span></button>
                </div>
                <div class="wv-dpanewrap">
                    <div class="wv-dpane wv-dpane-info">
                        <div class="wv-dtagwrap">${(d.tags ?? []).slice(0, 8).map(detailTagChip).join('')}</div>
                        ${bioText ? `
                            <div class="wv-dseclabel">Description</div>
                            <div class="wv-bio">${escapeHtml(bioText).replace(/\n/g, '<br>')}</div>`
                            : ((d.tags ?? []).length ? '' : '<div class="wv-dnoprev">No preview available</div>')}
                    </div>
                    <div class="wv-dpane wv-dpane-prompts" hidden>
                        ${DETAIL_PROMPT_SECTIONS.filter(([k]) => d[k]).map(([k, label], i) => `
                            <div class="wv-acc ${k === 'description' ? 'open' : ''}">
                                <button class="wv-acchead">
                                    <span class="wv-acclabel">${label}</span>
                                    <span class="fa-solid fa-chevron-up wv-accchev"></span>
                                </button>
                                <div class="wv-accbody">${escapeHtml(d[k]).replace(/\n/g, '<br>')}</div>
                            </div>`).join('')}
                        ${greetings.length ? `
                            <div class="wv-acc ${greetings.length === 1 ? 'open' : ''}">
                                <button class="wv-acchead">
                                    <span class="wv-acclabel">First Messages</span>
                                    ${greetings.length > 1 ? `<span class="wv-accbadge">${greetings.length}</span>` : ''}
                                    <span class="fa-solid fa-chevron-up wv-accchev"></span>
                                </button>
                                <div class="wv-accbody">${greetings.map((g, i) => `
                                    ${i > 0 ? '<div class="wv-greetdiv"></div>' : ''}
                                    <div class="wv-greetrow">
                                        <span class="wv-greetlabel">First message #${i + 1}</span>
                                        <span class="fa-solid fa-chevron-up wv-greetchev"></span>
                                    </div>
                                    <div class="wv-greettext" ${greetings.length === 1 ? '' : 'hidden'}>${escapeHtml(g).replace(/\n/g, '<br>')}</div>`).join('')}
                                </div>
                            </div>` : ''}
                    </div>
                    <div class="wv-dpane wv-dpane-images" hidden>
                        <div class="wv-dgal">
                            <img src="${escapeHtml(item.avatarUrl || '')}" referrerpolicy="no-referrer" alt="" />
                        </div>
                    </div>
                    <div class="wv-dspacer"></div>
                </div>
            </div>
            <button class="wv-dfab">
                <span class="fa-solid fa-download wv-dfabicon"></span>
                <span class="wv-dfablabel">Import to library</span>
            </button>
        </div>`;

    const win = popup.querySelector('.wv-dwin');
    const close = () => { popup.hidden = true; };
    wireWinChrome(popup, close);
    popup.querySelector('.wv-dback').addEventListener('click', close);

    // Tab strip: pill track glass, sliding active pill, equal-width budget of
    // 2.35 visible tabs (PillTabStrip) → 3 tabs scroll horizontally.
    const tabs = [...popup.querySelectorAll('.wv-dtab')];
    const panes = [...popup.querySelectorAll('.wv-dpane')];
    const ind = popup.querySelector('.wv-dtabind');
    const strip = popup.querySelector('.wv-dtabs');
    const selectTab = (i) => {
        strip.dataset.active = String(i);
        ind.style.transform = `translateX(${i * 100}%)`;
        tabs.forEach((t, j) => t.classList.toggle('on', j === i));
        panes.forEach((p, j) => { p.hidden = j !== i; });
        const el = tabs[i];
        strip.scrollTo({ left: Math.max(0, el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2), behavior: 'smooth' });
    };
    tabs.forEach((t, i) => t.addEventListener('click', () => selectTab(i)));
    selectTab(0);

    // Accordions: closed = 3-line clamp + fade mask; open = full (280ms).
    popup.querySelectorAll('.wv-acc').forEach(acc => {
        acc.querySelector('.wv-acchead').addEventListener('click', () => acc.classList.toggle('open'));
    });
    popup.querySelectorAll('.wv-greetrow').forEach(row => {
        row.addEventListener('click', () => {
            const text = row.nextElementSibling;
            if (text) text.hidden = !text.hidden;
        });
    });

    // Kebab (preview mode): open source site — desktop popup (240, r12 glass).
    popup.querySelector('.wv-dkebab').addEventListener('click', e => {
        e.stopPropagation();
        const old = root.querySelector('.wv-dpopup');
        if (old) { old.remove(); return; }
        const pop = document.createElement('div');
        pop.className = 'wv-dpopup';
        const heroImg = popup.querySelector('.wv-heroimg');
        const blurred = heroImg?.classList.contains('wv-blurred');
        pop.innerHTML = `
            <button class="wv-dpoprow" data-act="source"><span class="fa-solid fa-arrow-up-right-from-square"></span>Open source site</button>
            ${blurred ? '<button class="wv-dpoprow" data-act="unblur"><span class="fa-solid fa-eye"></span>Unblur NSFW</button>' : ''}`;
        win.appendChild(pop);
        const btn = popup.querySelector('.wv-dkebab').getBoundingClientRect();
        const winRect = win.getBoundingClientRect();
        const pw = 240, ph = 46;
        let x = btn.right - winRect.left - pw;
        let y = btn.bottom - winRect.top + 4;
        x = Math.max(12, Math.min(x, winRect.width - pw - 12));
        y = Math.min(y, winRect.height - ph - 12);
        pop.style.left = `${x}px`;
        pop.style.top = `${y}px`;
        pop.querySelectorAll('.wv-dpoprow').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.act === 'unblur') {
                heroImg?.classList.remove('wv-blurred');
            } else if (item.source === 'saucepan') {
                window.open(`https://saucepan.ai/companion/${encodeURIComponent(item.fullPath)}`, '_blank', 'noopener');
            } else {
                window.open(`https://chub.ai/characters/${encodeURIComponent(item.fullPath)}`, '_blank', 'noopener');
            }
            pop.remove();
        }));
        setTimeout(() => document.addEventListener('click', function once(ev) {
            if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', once); }
        }), 0);
    });

    // Import FAB → mode sheet when lorebooks exist, straight import otherwise.
    popup.querySelector('.wv-dfab').addEventListener('click', () => {
        if (item.source === 'saucepan') { importSaucepanCharacter(item, character); return; }
        if (book) showImportModeSheet(item, character);
        else importChubCharacter(item, character, false);
    });
}

// Glaze's import-options sheet (GlazeBottomSheet, chrome-less content-sized
// desktop window WITH dim): handle bar + "Import options" header + one group
// card of three rows (icon 22 primary, label 16, hint 12).
function showImportModeSheet(item, character) {
    const overlay = document.createElement('div');
    overlay.className = 'wv-mode-overlay';
    overlay.innerHTML = `
        <div class="wv-modesheet">
            <div class="wv-modehandle"></div>
            <div class="wv-modehead">Import options</div>
            <div class="wv-modecard">
                <button data-mode="both">
                    <span class="fa-solid fa-book-open wv-modeicon"></span>
                    <span class="wv-modelabels"><span class="wv-modelabel">Character + lorebooks</span><span class="wv-modehint">Also import the attached lorebooks</span></span>
                </button>
                <button data-mode="character">
                    <span class="fa-regular fa-user wv-modeicon"></span>
                    <span class="wv-modelabels"><span class="wv-modelabel">Character only</span><span class="wv-modehint">Import the character without its lorebooks</span></span>
                </button>
                <button data-mode="lorebook">
                    <span class="fa-solid fa-book wv-modeicon"></span>
                    <span class="wv-modelabels"><span class="wv-modelabel">Lorebooks only</span><span class="wv-modehint">Pull the lorebooks without adding the character</span></span>
                </button>
            </div>
        </div>`;
    root.appendChild(overlay);
    overlay.addEventListener('click', e => {
        const mode = e.target?.closest('button')?.dataset?.mode;
        if (e.target === overlay || mode === 'cancel') { overlay.remove(); return; }
        if (!mode) return;
        overlay.remove();
        root.querySelector('.wv-detail').hidden = true;
        if (mode === 'lorebook') importChubLorebookOnly(item, character);
        else importChubCharacter(item, character, mode === 'both');
    });
}

function ledgerCheck(item) {
    const s = settings();
    const source = item.source ?? 'chub';
    return s.ledger.find(e => e.source === source && e.id === item.fullPath);
}

function ledgerAdd(item, what) {
    const s = settings();
    const source = item.source ?? 'chub';
    s.ledger.push({
        source,
        id: item.fullPath,
        name: item.name,
        what,
        at: Date.now(),
        url: source === 'saucepan'
            ? `https://saucepan.ai/companion/${item.fullPath}`
            : `https://chub.ai/characters/${item.fullPath}`,
    });
    saveSettingsQuiet();
}

// ─── Provider switch (M4) ────────────────────────────────────────────────────

function showSourceMenu() {
    const old = root.querySelector('.wv-srcmenu');
    if (old) { old.remove(); return; }
    const pop = document.createElement('div');
    pop.className = 'wv-menu wv-srcmenu';
    pop.innerHTML = `
        <div class="wv-srchead">Providers</div>
        ${Object.entries(SOURCE_META).map(([id, meta]) => `
            <button class="wv-srcrow ${id === state.source ? 'wv-on' : ''} ${id === 'datacat' ? 'wv-srcdisabled' : ''}" data-source="${id}" ${id === 'datacat' ? 'disabled' : ''}>
                <img src="${meta.img}" width="18" height="18" alt="" />
                <span class="wv-srclabel">${meta.label}</span>
                ${id === 'datacat' ? '<span class="wv-srcsoon">M5</span>' : ''}
            </button>`).join('')}`;
    root.appendChild(pop);
    const chip = root.querySelector('.wv-source').getBoundingClientRect();
    pop.style.left = `${Math.round(chip.left)}px`;
    pop.style.top = `${Math.round(chip.bottom + 6)}px`;
    pop.querySelectorAll('.wv-srcrow:not(.wv-srcdisabled)').forEach(b => b.addEventListener('click', () => {
        pop.remove();
        setSource(b.dataset.source);
    }));
    setTimeout(() => document.addEventListener('click', function once(ev) {
        if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', once); }
    }), 0);
}

// Chip/placeholder must match the persisted source on every open — setSource
// isn't called for restores (would clear the grid/reset search).
function hydrateSourceChip() {
    const meta = SOURCE_META[state.source] ?? SOURCE_META.chub;
    const chip = root.querySelector('.wv-source');
    chip.querySelector('img').src = meta.img;
    chip.querySelector('.wv-srclabel').textContent = meta.label;
    const search = root.querySelector('.wv-search');
    search.placeholder = state.source === 'saucepan' ? 'Paste a saucepan.ai companion URL…' : 'Search characters...';
}

function setSource(source) {
    if (!SOURCE_META[source] || source === 'datacat') return;
    if (state.source !== source) {
        // A provider switch starts clean: the typed text and tag selections
        // belong to the previous provider (chub topics mean nothing on
        // Saucepan, and a pasted link is not a search query for chub).
        state.query = '';
        settings().query = '';
        const search = root.querySelector('.wv-search');
        if (search) search.value = '';
        state.filters = { ...committedFilters(), tagNames: [], tags: new Set() };
        commitFilters();
    }
    state.source = source;
    settings().source = source;
    saveSettingsQuiet();
    hydrateSourceChip();
    if (source === 'chub') {
        resetAndSearch();
    } else {
        // Non-browsable source: clear the grid and point at the paste flow.
        state.items = [];
        const grid = root.querySelector('.wv-grid');
        if (grid) grid.innerHTML = '';
        const status = root.querySelector('.wv-status');
        status.classList.remove('wv-status-error');
        status.textContent = 'Paste a saucepan.ai companion URL above to import';
    }
}

// ─── Saucepan URL import (M4) ────────────────────────────────────────────────
// The server does the extraction (auth-gated REST + decoy-fragment
// reassembly) and returns a ready card PNG; the import then rides the exact
// same native chain as the chub flow.

async function importSaucepanUrl(url) {
    const status = root.querySelector('.wv-status');
    status.classList.remove('wv-status-error');
    status.textContent = 'Extracting companion…';
    try {
        const r = await fetch('/api/weavers-vault/saucepan/extract', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ url }),
        });
        const body = await r.json().catch(() => null);
        if (r.status === 401) {
            status.textContent = '';
            openSaucepanTokenSheet(url);
            return;
        }
        if (!r.ok) throw new Error(body?.error || `Saucepan answered ${r.status}`);
        const character = body.character;
        const item = {
            id: body.companionId,
            fullPath: body.companionId,
            name: character.data.name,
            avatarUrl: body.avatarDataUrl,
            tags: character.data.tags ?? [],
            nsfw: false,
            source: 'saucepan',
        };
        saucepanFiles.set(body.companionId, body.file);
        status.textContent = '';
        openDetail(item, character);
    } catch (error) {
        status.classList.add('wv-status-error');
        status.textContent = error.message;
    }
}

// Paste-only bearer token (DESIGN.md Q14) — a small sheet, not a login form.
// Saucepan login sheet (saucepan_login_sheet.dart): handle + password is the
// primary path (mints the bearer token server-side, password never stored);
// paste-token is the fallback toggle. Buttons are GlazeActionButtons: full-
// width tiles — primary = accent@18% tint / accent@22% border, neutral =
// surface fill / onSurface@22% border, radius 14, icon 16px + 8px gap, 13px
// w600 label. Outside tap (or Esc) dismisses, like a Glaze bottom sheet.
function openSaucepanTokenSheet(retryUrl) {
    const overlay = document.createElement('div');
    overlay.className = 'wv-mode-overlay';
    overlay.innerHTML = `
        <div class="wv-modesheet wv-tokensheet">
            <div class="wv-modehandle"></div>
            <div class="wv-modehead">Log in to Saucepan</div>
            <div class="wv-tokenhint">Extraction pulls the companion definition under your account and reassembles it on-device. A throwaway account is recommended. Credentials go only to saucepan.ai — the minted token is stored per-device and never synced.</div>
            <div class="wv-loginfields">
                <input class="wv-tokeninput wv-loginhandle" type="text" placeholder="Handle" autocomplete="off" spellcheck="false" />
                <input class="wv-tokeninput wv-loginpass" type="password" placeholder="Password" autocomplete="off" spellcheck="false" />
            </div>
            <input class="wv-tokeninput wv-logintoken" type="password" placeholder="Bearer token" autocomplete="off" spellcheck="false" hidden />
            <button class="wv-abtn wv-abtn-primary wv-abtn-expand" type="button">
                <span class="fa-solid fa-right-to-bracket wv-abtnicon"></span><span class="wv-abtnlabel">Log in</span>
            </button>
            <button class="wv-abtn wv-abtn-neutral wv-abtn-expand" type="button">
                <span class="fa-solid fa-key wv-abtnicon"></span><span class="wv-abtnlabel">Use a bearer token instead</span>
            </button>
        </div>`;
    root.appendChild(overlay);
    const handle = overlay.querySelector('.wv-loginhandle');
    const pass = overlay.querySelector('.wv-loginpass');
    const token = overlay.querySelector('.wv-logintoken');
    const fields = overlay.querySelector('.wv-loginfields');
    const primary = overlay.querySelector('.wv-abtn-primary');
    const swap = overlay.querySelector('.wv-abtn-neutral');
    handle.focus();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    swap.addEventListener('click', () => {
        const toToken = token.hidden;
        token.hidden = !toToken;
        fields.hidden = toToken;
        swap.querySelector('.wv-abtnlabel').textContent = toToken ? 'Log in with handle instead' : 'Use a bearer token instead';
        swap.querySelector('.wv-abtnicon').className = toToken
            ? 'fa-solid fa-right-to-bracket wv-abtnicon'
            : 'fa-solid fa-key wv-abtnicon';
        primary.querySelector('.wv-abtnlabel').textContent = toToken ? 'Save token' : 'Log in';
        (toToken ? token : handle).focus();
    });
    const submit = async () => {
        const useToken = !token.hidden;
        const label = primary.querySelector('.wv-abtnlabel');
        try {
            label.textContent = 'Signing in…';
            let r;
            if (useToken) {
                if (!token.value.trim()) { label.textContent = 'Save token'; return; }
                r = await fetch('/api/weavers-vault/saucepan/token', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ token: token.value.trim() }),
                });
            } else {
                if (!handle.value.trim() || !pass.value) { label.textContent = 'Log in'; return; }
                r = await fetch('/api/weavers-vault/saucepan/login', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ handle: handle.value.trim(), password: pass.value }),
                });
            }
            if (!r.ok) throw new Error(((await r.json().catch(() => null))?.error) ?? `Login failed (${r.status})`);
            overlay.remove();
            toastr.success('Signed in to Saucepan', "Weaver's Vault");
            if (retryUrl) importSaucepanUrl(retryUrl);
        } catch (error) {
            toastr.error(error.message, "Weaver's Vault");
            label.textContent = useToken ? 'Save token' : 'Log in';
        }
    };
    primary.addEventListener('click', submit);
    overlay.addEventListener('keydown', e => {
        if (e.key === 'Enter') submit();
    });
}

async function importSaucepanCharacter(item, character) {
    const cardFile = saucepanFiles.get(item.fullPath);
    if (!cardFile) {
        toastr.error('Extraction data missing — paste the companion URL again.', "Weaver's Vault");
        return;
    }
    const dup = ledgerCheck(item);
    if (dup) {
        toastr.warning(`Imported before (${new Date(dup.at).toLocaleString()}) — importing again creates a duplicate.`, "Weaver's Vault");
    }
    toastr.info('Importing character…', "Weaver's Vault");
    try {
        // The card PNG the server built already carries the vault provenance
        // (vault_source/vault_url/vault_full_path) inside its chara chunk.
        const bytes = Uint8Array.from(atob(cardFile.buffer), c => c.charCodeAt(0));
        const file = new File([bytes], cardFile.fileName, { type: cardFile.fileType });
        const importedAvatar = await importCharacter(file, { importTags: false });
        await getCharacters();
        const target = importedAvatar ? characters.find(c => c.avatar === importedAvatar) : null;
        if (!target) {
            console.warn(`[${extensionName}] imported but could not locate character in the library list`);
        }
        ledgerAdd(item, 'character');
        toastr.success(`Imported ${character.data.name}`, "Weaver's Vault");
    } catch (error) {
        console.error(`[${extensionName}] import failed`, error);
        toastr.error(error.message, "Weaver's Vault import failed");
    }
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
        // importCharacter returns the avatar filename the import actually created —
        // match by that, NOT by name: chub detail names often carry a leading space
        // (" Mother Silk") while the import pipeline sanitizes it away, so name
        // equality silently fails and the provenance stamp never lands.
        const importedAvatar = await importCharacter(file, { importTags: false });
        await getCharacters();
        const target = importedAvatar
            ? characters.find(c => c.avatar === importedAvatar)
            : characters.filter(c => (c.name ?? '').trim() === (character.data.name ?? '').trim()).pop();
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
            const editResponse = await fetch('/api/characters/edit', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    ch_name: target.name,
                    avatar_url: target.avatar,
                    json_data: JSON.stringify(target),
                }),
            });
            if (!editResponse.ok) {
                console.error(`[${extensionName}] provenance stamp edit failed (${editResponse.status}) — card imported but not stamped`);
                toastr.warning('Imported, but provenance stamping failed — cleanup tests may refuse to remove this card.', "Weaver's Vault");
            }
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

function addLauncher() {
    if (document.getElementById('wv-topbar-button')) return true;
    // Top bar, right after the Character Management icon (#rightNavHolder).
    const anchor = document.getElementById('rightNavHolder');
    if (!anchor) return false;
    const b = document.createElement('div');
    b.id = 'wv-topbar-button';
    b.className = 'drawer';
    b.innerHTML = '<div class="drawer-toggle"><div class="drawer-icon fa-solid fa-book fa-fw closedIcon" title="Open Weaver\'s Vault"></div></div>';
    b.addEventListener('click', openVault);
    anchor.insertAdjacentElement('afterend', b);
    return true;
}

jQuery(async () => {
    console.log(`[${extensionName}] Loading…`);
    try {
        settings();
        if (!addLauncher()) {
            // Top bar not ready yet; retry shortly (same as RPG engine's approach).
            setTimeout(addLauncher, 2000);
        }
        ensureOverlay();
        wireToolbar();
        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});
