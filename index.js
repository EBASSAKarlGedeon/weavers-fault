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
const IMG_JANNY = new URL('janny.svg', import.meta.url).href;

// Window-chrome glyphs, drawn inline to match Glaze's Material icons
// (`Icons.crop_square_rounded` / `Icons.fullscreen_exit_rounded`) instead of
// Font Awesome's hairline fa-square, which is sharp-cornered and much lighter.
const ICON_MAXIMIZE = `<svg class="wv-winsvg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
const ICON_RESTORE = `<svg class="wv-winsvg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`;

// Provider switch (Glaze Providers popup): Datacat ships in M5 — the row is
// shown but disabled, exactly like an unbuilt milestone should be.
const SOURCE_META = {
    chub: { label: 'Chub', img: IMG_CHUB },
    saucepan: { label: 'Saucepan', img: IMG_SAUCEPAN },
    datacat: { label: 'DataCat', img: IMG_DATACAT },
    janny: { label: 'JannyAI', img: IMG_JANNY },
};

// JannyAI cards arrive already built by the server (it drives a real browser
// through the site's Cloudflare challenge); keyed by character id.
const jannyFiles = new Map();

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
// DataCat's Client API sorts a field over a time window; the server resolves
// these keys (incl. the _week/_24h legacy form) via resolveSort.
const DATACAT_SORTS = {
    fresh: { label: 'Fresh', icon: 'fa-solid fa-clock-rotate-left' },
    score: { label: 'Top rated', icon: 'fa-solid fa-thumbs-up' },
    score_week: { label: 'Top rated this week', icon: 'fa-solid fa-arrow-trend-up' },
    score_24h: { label: 'Top rated 24 hours', icon: 'fa-solid fa-fire' },
    chat_count: { label: 'Most chats', icon: 'fa-solid fa-comments' },
    messages_per_chat: { label: 'Deepest chats', icon: 'fa-solid fa-comment-dots' },
};

// JannyAI searches its own Meilisearch index, whose sort vocabulary is this.
const JANNY_SORTS = {
    newest: { label: 'Newest', icon: 'fa-solid fa-clock' },
    oldest: { label: 'Oldest', icon: 'fa-solid fa-clock-rotate-left' },
    tokens_desc: { label: 'Most tokens', icon: 'fa-solid fa-arrow-trend-up' },
    tokens_asc: { label: 'Fewest tokens', icon: 'fa-solid fa-arrow-down-wide-short' },
    relevant: { label: 'Most relevant', icon: 'fa-solid fa-magnifying-glass' },
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
            <div class="wv-dcbrowser" hidden></div>
            <div class="wv-detail" hidden></div>

            <div class="wv-filters-overlay" hidden>
                <div class="wv-modal">
                    <div class="wv-sheetbar">
                        <span class="wv-sheettitle">Filters</span>
                        <span class="wv-spacer"></span>
                        <button class="wv-winbtn wv-fmax" title="Maximize" aria-label="Maximize">${ICON_MAXIMIZE}</button>
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
    applySourceLayout();
    if (!state.hydrated) {
        state.hydrated = true;
        if (state.source === 'datacat') showDatacatBrowser();
        else if (state.source === 'saucepan') showSourceHint();
        else runSearch();
    } else if (state.source === 'datacat') {
        // The frame survives a close/reopen, so just make sure it is visible
        // and still holds its browsing context.
        showDatacatBrowser();
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

/**
 * One search entry point for every browsable source. Chub pages by number;
 * DataCat pages by offset and sorts a field over a time window, so the request
 * shape differs while the render path stays identical.
 */
function searchRequest() {
    const f = state.filters ?? { ...committedFilters(), tags: new Set() };
    if (state.source === 'janny') {
        // The index pages by number and carries no tags of its own (its hits
        // expose ids only), so only the token bound and NSFW flag travel.
        return {
            url: '/api/weavers-vault/janny/search',
            source: 'JannyAI',
            body: {
                query: state.query,
                page: state.page,
                nsfw: f.nsfw,
                minTokens: f.minTokens,
                maxTokens: f.maxTokens,
                sort: state.sort,
            },
        };
    }
    if (state.source === 'datacat') {
        const perPage = settings().perPage || 24;
        return {
            url: '/api/weavers-vault/datacat/search',
            source: 'DataCat',
            body: {
                query: state.query,
                offset: (state.page - 1) * perPage,
                limit: perPage,
                // The server resolves both the field and the window from this
                // key (score_week → {score, week}).
                sort: state.sort,
                tagIds: [],
                nsfw: Boolean(f.nsfw),
            },
        };
    }
    return {
        url: '/api/weavers-vault/chub/search',
        source: 'chub.ai',
        body: {
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
        },
    };
}

function runSearch() {
    const myEpoch = ++state.epoch;
    state.loading = true;
    state.page = state.page || 1;
    renderStatus('Searching…');
    const { url, body, source } = searchRequest();
    fetch(url, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    })
        .then(r => r.json().then(payload => ({ ok: r.ok, status: r.status, payload })))
        .then(({ ok, status, payload }) => {
            if (myEpoch !== state.epoch) return; // stale
            state.loading = false;
            if (!ok) {
                // Party-labeled error: the source is at fault, not the app.
                const detail = payload?.error ? ` — ${payload.error}` : '';
                renderStatus(`${source} answered ${status}${detail}`, true);
                return;
            }
            if (state.page === 1) state.items = payload.items ?? [];
            else state.items.push(...(payload.items ?? []));
            state.total = payload.total ?? state.items.length;
            state.hasMore = Boolean(payload.hasMore);
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
    // Only browsable sources page; clearing the grid for a paste-URL source
    // (Saucepan) must not drag the sentinel into a search.
    if (state.source === 'saucepan' || state.loading || state.reachedEnd) return;
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
        // JannyAI's search index carries no creator, so an empty value must not
        // render as a bare "@".
        card.querySelector('.wv-creator').textContent = item.creator ? `@${item.creator}` : '';
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
    const icon = state.source === 'datacat'
        ? (DATACAT_SORTS[state.sort]?.icon ?? 'fa-solid fa-sort')  // reserved for the optional REST adapter
        : state.source === 'janny'
            ? (JANNY_SORTS[state.sort]?.icon ?? 'fa-solid fa-sort')
            : (SORT_ICONS[state.sort] ?? 'fa-solid fa-sort');
    sortIcon.className = `${icon} wv-sorticon`;
    renderSortMenu();
}

function sortTable() {
    if (state.source === 'datacat') {
        return Object.fromEntries(Object.entries(DATACAT_SORTS).map(([k, v]) => [k, v.label]));
    }
    if (state.source === 'janny') {
        return Object.fromEntries(Object.entries(JANNY_SORTS).map(([k, v]) => [k, v.label]));
    }
    return SORT_LABELS;
}

function renderSortMenu() {
    const menu = root.querySelector('.wv-menu');
    menu.innerHTML = Object.entries(sortTable()).map(([key, label]) =>
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
        // DataCat is embedded: its own search bar owns the query.
        if (state.source === 'datacat') return;
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
    root.querySelector('.wv-fmax').addEventListener('click', () => {
        const modal = root.querySelector('.wv-modal');
        const on = modal.classList.toggle('wv-max');
        const b = root.querySelector('.wv-fmax');
        b.title = on ? 'Restore' : 'Maximize';
        b.innerHTML = on ? ICON_RESTORE : ICON_MAXIMIZE;
    });
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
    // Tags are chub topics and the "Other" switches are chub flags; JannyAI's
    // index exposes neither, so showing them would promise filtering that
    // cannot happen. Only the token bound and NSFW flag apply there.
    const chubOnly = state.source !== 'janny';
    const tagCard = root.querySelector('.wv-tagshead')?.closest('.wv-mcard');
    if (tagCard) tagCard.hidden = !chubOnly;
    const otherCard = root.querySelector('.wv-mintags')?.closest('.wv-mcard');
    if (otherCard) otherCard.hidden = !chubOnly;
    overlay.hidden = false;
    if (chubOnly) ensureTagCloud();
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
            ? ICON_RESTORE
            : ICON_MAXIMIZE;
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
                <button class="wv-winbtn wv-dmax" title="Maximize">${ICON_MAXIMIZE}</button>
                    <button class="wv-winbtn wv-dclose" title="Close"><span class="fa-solid fa-xmark"></span></button>
            </div>
            <div class="wv-dloading">
                <span class="wv-spinner"></span>
                <div class="wv-dphase">${item.source === 'janny' ? 'Opening JannyAI in a browser session…' : 'Loading character…'}</div>
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
        if (item.source === 'janny') {
            // The server reads the page inside a real browser (Cloudflare) and
            // hands back a finished, provenance-stamped card PNG.
            const r = await fetch('/api/weavers-vault/janny/card', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: item.fullPath, name: item.name }),
                signal: detailAbort.signal,
            });
            const payload = await r.json();
            if (!r.ok) throw new Error(payload?.error || `JannyAI answered ${r.status}`);
            jannyFiles.set(item.fullPath, payload.file);
            renderDetail(popup, item, payload.character);
            return;
        }
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
                    <button class="wv-winbtn wv-dmax" title="Maximize">${ICON_MAXIMIZE}</button>
                    <button class="wv-winbtn wv-dclose" title="Close"><span class="fa-solid fa-xmark"></span></button>
                </div>
                <div class="wv-derror">
                    <span class="fa-solid fa-triangle-exclamation wv-derricon"></span>
                    <div class="wv-derrmsg">${item.source === 'datacat' ? 'DataCat' : item.source === 'janny' ? 'JannyAI' : 'chub.ai'} failed — ${escapeHtml(error.message)}</div>
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
                <button class="wv-winbtn wv-dmax" title="Maximize">${ICON_MAXIMIZE}</button>
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
                            ? `<a class="wv-heroauthor" href="${item.source === 'saucepan'
                                ? 'https://saucepan.ai/companion/' + encodeURIComponent(item.fullPath ?? '')
                                : item.source === 'datacat'
                                    ? 'https://datacat.run/creators/' + encodeURIComponent(item.creatorId || d.creator)
                                    : item.source === 'janny'
                                        ? 'https://jannyai.com/creators/' + encodeURIComponent(d.creator)
                                        : 'https://chub.ai/' + escapeHtml((item.fullPath || '').split('/')[0])}" target="_blank" rel="noopener noreferrer">@${escapeHtml(d.creator)}</a>`
                            : (item.source === 'saucepan' || item.source === 'janny'
                                ? ''
                                : `<span class="wv-heroauthor">@${escapeHtml((item.fullPath || '').split('/')[0])}</span>`)}
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
            } else if (item.source === 'datacat') {
                window.open(`https://datacat.run/characters/${encodeURIComponent(item.id)}`, '_blank', 'noopener');
            } else if (item.source === 'janny') {
                window.open(`https://jannyai.com/characters/${encodeURIComponent(item.fullPath)}`, '_blank', 'noopener');
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
        if (item.source === 'janny') { importJannyCharacter(item, character); return; }
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
            : source === 'janny'
                ? `https://jannyai.com/characters/${item.fullPath}`
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
            <button class="wv-srcrow ${id === state.source ? 'wv-on' : ''}" data-source="${id}">
                <img src="${meta.img}" width="18" height="18" alt="" />
                <span class="wv-srclabel">${meta.label}</span>
            </button>`).join('')}`;
    root.appendChild(pop);
    const chip = root.querySelector('.wv-source').getBoundingClientRect();
    pop.style.left = `${Math.round(chip.left)}px`;
    pop.style.top = `${Math.round(chip.bottom + 6)}px`;
    pop.querySelectorAll('.wv-srcrow').forEach(b => b.addEventListener('click', () => {
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
    search.placeholder = state.source === 'saucepan'
        ? 'Paste a saucepan.ai companion URL…'
        : 'Search characters...';
}

/**
 * DataCat runs as an embedded browser inside the panel (the only anonymous
 * path DataCat offers), so the search grid's furniture has to get out of its
 * way: the site brings its own search bar, filters and sort control.
 */
function applySourceLayout() {
    const browsing = state.source === 'datacat';
    root.classList.toggle('wv-browsing', browsing);
    for (const selector of ['.wv-row3', '.wv-grid', '.wv-status', '.wv-endbar', '.wv-sentinel', '.wv-right']) {
        const el = root.querySelector(selector);
        if (el) el.hidden = browsing;
    }
    const search = root.querySelector('.wv-search');
    if (search) {
        search.hidden = browsing;
        search.placeholder = 'Search characters...';
    }
    if (!browsing) hideDatacatBrowser();
}

function setSource(source) {
    if (!SOURCE_META[source]) return;
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
        // Sorts are a per-provider vocabulary: keep the key only when the new
        // source knows it, else fall back to that source's default order.
        const known = source === 'datacat' ? DATACAT_SORTS
            : source === 'janny' ? JANNY_SORTS
                : SORT_LABELS;
        if (!known[state.sort]) {
            state.sort = source === 'datacat' ? 'fresh' : source === 'janny' ? 'newest' : 'popular';
            settings().sort = state.sort;
            saveSettingsQuiet();
        }
    }
    state.source = source;
    settings().source = source;
    saveSettingsQuiet();
    hydrateSourceChip();
    // The sort icon and menu are a per-provider vocabulary, so they have to be
    // re-hydrated on switch — resetAndSearch only re-renders the grid.
    hydrateControls();
    if (source === 'datacat') {
        // The embedded site owns browsing/search/detail; there is nothing to
        // search from here.
        applySourceLayout();
        showDatacatBrowser();
    } else if (source !== 'saucepan') {
        applySourceLayout();
        resetAndSearch();
    } else {
        applySourceLayout();
        // Non-browsable source: clear the grid and point at the paste flow.
        state.items = [];
        const grid = root.querySelector('.wv-grid');
        if (grid) grid.innerHTML = '';
        const status = root.querySelector('.wv-status');
        status.classList.remove('wv-status-error');
        status.textContent = 'Paste a saucepan.ai companion URL above to import';
    }
}

// ─── DataCat (M5) — iframe + postMessage bridge ────────────────────────────
// Ported from DataCat's own SillyTavern browser extension
// (datacat-sillytavern-browser v0.1.9, AGPL-3.0 — see docs/DESIGN.md attribution).
//
// This is the path that actually works without an account or a client id: the
// site runs in an iframe (`dc_embed=st`, `dc_auth_mode=client-link`) and hands
// a ready-made PNG card back over postMessage. Glaze's `api/client/v1` path
// needs an integration key DataCat has to issue, so it stays as the optional
// server-side adapter; the bridge is what the vault uses to browse.
//
// Protocol (parent side):
//   parent → child  {type:'datacat:st-bridge:init', nonce, source}
//   child  → parent {type:'datacat:st-bridge:ready', nonce}
//   child  → parent {type:'datacat:st-character-card:prepare', nonce, requestId, metadata}
//   parent → child  {type:'datacat:st-character-card:ack', nonce, requestId, status, message, ...}
//   child  → parent {type:'datacat:st-character-card', nonce, requestId, metadata, png}
//   parent → child  ack 'ok' with the imported avatar.

const DC_BROWSER_URL = 'https://datacat.run/characters/recent';
const DC_CLIENT = 'datacat-browser';
const DC_CLIENT_VERSION = '0.1.9';
const DC_AUTH_MODE = 'client-link';
const DC_MAX_PNG_BYTES = 32 * 1024 * 1024;
const DC_PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DC_CHARACTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DC_REQUEST_ID = /^[a-zA-Z0-9._:-]{1,128}$/;
const DC_NONCE = /^[a-zA-Z0-9-]{16,128}$/;
const DC_PARENT_SOURCE = 'sillytavern-datacat-browser';

const datacatBridge = {
    frame: null,
    origin: null,
    nonce: '',
    ready: false,
    listening: false,
    pulse: null,
    acks: new Map(),   // requestId → {status, message, extra, expiresAt}
    active: new Set(),     // imports in flight
};

function datacatNonce() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** DataCat only accepts the first-open flag once per account, like the extension. */
function datacatFirstOpen() {
    const store = settings();
    return store.datacatFirstOpenAt ? false : true;
}

function rememberDatacatFirstOpen() {
    const store = settings();
    if (store.datacatFirstOpenAt) return;
    store.datacatFirstOpenAt = new Date().toISOString();
    saveSettingsQuiet();
}

function datacatBridgeUrl(nonce) {
    const url = new URL(DC_BROWSER_URL);
    url.searchParams.set('dc_embed', 'st');
    url.searchParams.set('dc_bridge_nonce', nonce);
    url.searchParams.set('dc_client', DC_CLIENT);
    url.searchParams.set('dc_client_version', DC_CLIENT_VERSION);
    url.searchParams.set('dc_auth_mode', DC_AUTH_MODE);
    if (datacatFirstOpen()) url.searchParams.set('dc_first_open', '1');
    return url.href;
}

function sendDatacatBridgeInit() {
    const win = datacatBridge.frame?.contentWindow;
    if (!win || !datacatBridge.origin || !datacatBridge.nonce) return;
    try {
        win.postMessage({ type: 'datacat:st-bridge:init', nonce: datacatBridge.nonce, source: DC_PARENT_SOURCE }, datacatBridge.origin);
    } catch (error) {
        console.warn("[Weaver's Vault] DataCat bridge init failed:", error.message);
    }
}

const DC_ACK_TTL_MS = 2 * 60 * 1000;

function datacatPruneAcks() {
    const now = Date.now();
    for (const [id, ack] of datacatBridge.acks) if (!ack || ack.expiresAt <= now) datacatBridge.acks.delete(id);
}

function datacatRememberAck(requestId, status, message, extra) {
    if (!requestId || (status !== 'ok' && status !== 'existing')) return;
    datacatPruneAcks();
    datacatBridge.acks.set(requestId, { status, message, extra: { ...extra }, expiresAt: Date.now() + DC_ACK_TTL_MS });
}

/** True when this request was already answered — the ack is re-sent instead. */
function datacatReplayAck(requestId) {
    datacatPruneAcks();
    const ack = datacatBridge.acks.get(requestId);
    if (!ack) return false;
    postDatacatAck(requestId, ack.status, ack.message, ack.extra);
    return true;
}

/** Ack back into the iframe; the site renders these as its import phases. */
function postDatacatAck(requestId, status, message, extra = {}) {
    datacatRememberAck(requestId, status, message, extra);
    const win = datacatBridge.frame?.contentWindow;
    if (!win || !datacatBridge.origin) return;
    try {
        win.postMessage({
            type: 'datacat:st-character-card:ack',
            nonce: datacatBridge.nonce,
            requestId,
            status,
            message,
            ...extra,
        }, datacatBridge.origin);
    } catch (error) {
        console.warn("[Weaver's Vault] DataCat ack failed:", error.message);
    }
}

function isDatacatBridgeEvent(event) {
    return Boolean(event?.source && datacatBridge.frame && event.source === datacatBridge.frame.contentWindow);
}

/**
 * DataCat asks the parent to (re)send the init payload by posting a READY
 * message with needsInit:true — the extension detects exactly this shape.
 */
function isDatacatBridgeInitRequest(event) {
    if (!isDatacatBridgeEvent(event)) return false;
    const data = event.data;
    return Boolean(
        data && typeof data === 'object'
        && data.type === 'datacat:st-bridge:ready'
        && data.needsInit === true
        && datacatBridge.origin && event.origin === datacatBridge.origin,
    );
}

function isTrustedDatacatEvent(event) {
    if (!isDatacatBridgeEvent(event)) return false;
    if (event.origin !== datacatBridge.origin) return false;
    const data = event.data;
    return Boolean(data && typeof data === 'object' && data.nonce === datacatBridge.nonce);
}

/** Port of the extension's sanitizeImportNamePart: a stable ASCII avatar name. */
function datacatNamePart(value, fallback = 'character', maxLength = 48) {
    const cleaned = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLength);
    return cleaned || fallback;
}

/**
 * DataCat's own avatar naming: `datacat_<title>_<shortId>`, used as
 * `preserved_name` so a re-import of the same character is recognisable on
 * disk, exactly like the official extension.
 */
function datacatPreservedName(metadata = {}) {
    const id = datacatCharacterId(metadata);
    const shortId = datacatNamePart(id.replace(/-/g, ''), 'unknown', 36);
    const title = datacatNamePart(metadata.characterName || metadata.name, 'character', 44);
    return `datacat_${title}_${shortId}`;
}

/** id -> avatar, persisted so a reload still recognises DataCat imports. */
function datacatImportMap() {
    const store = settings();
    if (!store.datacatImports || typeof store.datacatImports !== 'object') store.datacatImports = {};
    return store.datacatImports;
}

function datacatFindImported(metadata = {}) {
    const id = datacatCharacterId(metadata);
    const map = datacatImportMap();
    const candidates = new Set();
    if (id && map[id]) candidates.add(map[id]);
    candidates.add(datacatPreservedName(metadata));
    for (const candidate of candidates) {
        const clean = String(candidate || '').replace(/\.png$/i, '');
        if (!clean) continue;
        const found = characters.find(c => String(c.avatar || '').replace(/\.png$/i, '') === clean);
        if (found) return found;
    }
    return null;
}

function datacatRememberImport(metadata, fileName) {
    const id = datacatCharacterId(metadata);
    if (!id || !fileName) return;
    datacatImportMap()[id] = fileName;
    saveSettingsQuiet();
}

function datacatCharacterId(metadata = {}) {
    const id = String(metadata.datacatCharacterId || metadata.datacat_character_id
        || metadata.characterId || metadata.character_id || '').trim().toLowerCase();
    return DC_CHARACTER_ID.test(id) ? id : '';
}

function datacatRequestId(value) {
    const id = String(value || '').trim();
    return DC_REQUEST_ID.test(id) ? id : '';
}

/**
 * Reads the PNG's tEXt/zTXt/iTXt chunks looking for the character card payload
 * (`chara` = V2, `ccv3` = V3). An image-only PNG from a provider is a silent
 * trap: SillyTavern happily creates a character whose every field is empty, so
 * the import has to refuse it and say why.
 */
function readPngCardPayload(payload) {
    const bytes = new Uint8Array(payload);
    const view = new DataView(payload);
    const chunks = [];
    let cardKind = '';
    let cardBytes = 0;
    let cardText = '';
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        chunks.push(type);
        const start = offset + 8;
        if (!cardKind && (type === 'tEXt' || type === 'zTXt' || type === 'iTXt')) {
            const data = bytes.subarray(start, start + length);
            const nul = data.indexOf(0);
            if (nul > 0) {
                const keyword = String.fromCharCode(...data.subarray(0, nul));
                if (keyword === 'chara' || keyword === 'ccv3') {
                    cardKind = keyword;
                    cardBytes = data.length - nul - 1;
                    // tEXt payloads are plain base64; compressed variants are
                    // left to the empty-card heuristic (it just skips).
                    if (type === 'tEXt') {
                        try {
                            cardText = atob(String.fromCharCode(...data.subarray(nul + 1)));
                        } catch {
                            cardText = '';
                        }
                    }
                }
            }
        }
        if (type === 'IEND') break;
        offset = start + length + 4;
    }
    return { chunks, cardKind, cardBytes, cardText };
}

/**
 * Stamp vault provenance onto an already-imported character.
 *
 * `POST /api/characters/edit` must NOT be used for this. Its handler rebuilds
 * the card with `charaFormatData(request.body)`, which assigns every text field
 * from the FLAT fields of the request body
 * (`_.set(char, 'description', data.description || '')`, and the same for
 * personality/scenario/first_mes/mes_example/creator_notes/system_prompt/openings/
 * tags/creator/version). A payload carrying only `ch_name` + `json_data` therefore
 * preserved the foreign keys but blanked all text: measured on the DataCat path,
 * the PNG imported with ~7.4k description and the stamp call left 0.
 *
 * `POST /api/characters/merge-attributes` (single mode) reads the card, applies a
 * deep merge and writes it back, so only the keys sent change — provenance lands
 * and every text field is untouched.
 *
 * @param {string} avatar Imported avatar file name (e.g. `datacat_x.png`)
 * @param {Record<string, string>} extensions Provenance keys to merge in
 * @returns {Promise<boolean>} Whether the stamp was written
 */
async function stampVaultProvenance(avatar, extensions) {
    try {
        const response = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar, data: { extensions } }),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            console.error(`[${extensionName}] provenance stamp failed (${response.status})`, detail);
            return false;
        }
        return true;
    } catch (error) {
        console.error(`[${extensionName}] provenance stamp failed`, error);
        return false;
    }
}

/**
 * Character text length from a decoded V2/V3 card. Used to catch DataCat's
 * name-only cards before they become blank characters in the library.
 */
function datacatCardTextLengths(raw) {
    if (!raw) return null;
    try {
        const card = JSON.parse(raw);
        const data = card?.data ?? card ?? {};
        const fields = ['description', 'first_mes', 'mes_example', 'scenario', 'personality', 'system_prompt'];
        let total = 0;
        for (const field of fields) total += String(data[field] ?? '').length;
        total += (Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [])
            .reduce((sum, greeting) => sum + String(greeting ?? '').length, 0);
        return { total, cardName: String(data.name ?? card?.name ?? '') };
    } catch {
        return null;
    }
}

function validateDatacatPng(payload) {
    const isBuffer = payload instanceof ArrayBuffer;
    if (!isBuffer) throw new Error('DataCat PNG payload is invalid.');
    if (payload.byteLength < DC_PNG_SIGNATURE.length) throw new Error('DataCat PNG payload is too small.');
    if (payload.byteLength > DC_MAX_PNG_BYTES) throw new Error('DataCat PNG payload exceeds the 32 MB import limit.');
    const head = new Uint8Array(payload, 0, DC_PNG_SIGNATURE.length);
    if (!DC_PNG_SIGNATURE.every((expected, i) => head[i] === expected)) {
        throw new Error('DataCat payload is not a PNG file.');
    }
    return payload;
}

/** Opens (or re-shows) the embedded DataCat browser inside the vault panel. */
function showDatacatBrowser() {
    const host = root.querySelector('.wv-dcbrowser');
    if (!host) return;
    host.hidden = false;
    if (!datacatBridge.frame) {
        const nonce = datacatNonce();
        if (!DC_NONCE.test(nonce)) return;
        const frame = document.createElement('iframe');
        frame.className = 'wv-dcframe';
        frame.title = 'Explore';
        frame.loading = 'eager';
        frame.setAttribute('referrerpolicy', 'no-referrer');
        // Same sandbox set the official extension uses: the site needs scripts,
        // forms and its own origin, but not top-level navigation.
        frame.setAttribute('sandbox', 'allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts');
        frame.src = datacatBridgeUrl(nonce);
        datacatBridge.frame = frame;
        datacatBridge.origin = new URL(frame.src).origin;
        datacatBridge.nonce = nonce;
        frame.addEventListener('load', () => {
            frame.dataset.datacatFrameLoaded = 'true';
            sendDatacatBridgeInit();
        });
        host.appendChild(frame);
        wireDatacatBridge();
        // The site retries init at these offsets; mirror it so a dropped first
        // message cannot leave the bridge dead, and keep a heartbeat going.
        for (const delay of [350, 900, 1800, 3200]) setTimeout(sendDatacatBridgeInit, delay);
        clearInterval(datacatBridge.pulse);
        datacatBridge.pulse = setInterval(sendDatacatBridgeInit, 5000);
    }
    sendDatacatBridgeInit();
}

function hideDatacatBrowser() {
    const host = root.querySelector('.wv-dcbrowser');
    if (host) host.hidden = true;
}

/**
 * One global listener: the iframe asks for init, then drives the import with
 * prepare/card messages. Every message is bound to this frame *and* the nonce,
 * so another embedded page cannot drive an import.
 */
function wireDatacatBridge() {
    if (datacatBridge.listening) return;
    datacatBridge.listening = true;
    window.addEventListener('message', (event) => {
        if (!datacatBridge.frame) return;
        // The site asks for init with READY{needsInit:true} — not an init message.
        if (isDatacatBridgeInitRequest(event)) {
            datacatBridge.origin = event.origin;
            sendDatacatBridgeInit();
            return;
        }
        if (!isTrustedDatacatEvent(event)) return;
        const data = event.data;

        if (data.type === 'datacat:st-bridge:ready') {
            datacatBridge.ready = true;
            if (data.analyticsFirstOpenAccepted === true) rememberDatacatFirstOpen();
            return;
        }
        // A retried request must get the same answer, not a second import.
        if (data.type === 'datacat:st-character-card:prepare' || data.type === 'datacat:st-character-card') {
            const replay = datacatReplayAck(String(data.requestId || ''));
            if (replay) return;
        }
        if (data.type === 'datacat:st-character-card:prepare') {
            const requestId = datacatRequestId(data.requestId);
            if (!requestId) return;
            const id = datacatCharacterId(data.metadata);
            const existing = datacatFindImported(data.metadata);
            if (existing) {
                postDatacatAck(requestId, 'existing', 'Found local copy.', {
                    datacatCharacterId: id, avatar: existing.avatar, phase: 'Chat ready', step: 'open-existing', stepLabel: 'Open local copy',
                });
                return;
            }
            // 'need-card' is the cue for the site to send the PNG.
            postDatacatAck(requestId, 'need-card', 'Ready for PNG payload.', {
                datacatCharacterId: id, phase: 'Card payload needed', step: 'preflight', stepLabel: 'Check local copy',
            });
            return;
        }
        if (data.type === 'datacat:st-character-card') {
            importDatacatBridgeCard(data).catch((error) => {
                console.error("[Weaver's Vault] DataCat import failed:", error);
                postDatacatAck(datacatRequestId(data.requestId), 'error', error?.message || 'DataCat import failed.');
                toastr.error(error?.message || 'DataCat import failed.', "Weaver's Vault");
            });
        }
    });
    // The site re-syncs when the tab regains focus, same as the official bridge.
    window.addEventListener('focus', () => sendDatacatBridgeInit());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') sendDatacatBridgeInit();
    });
}

/** The site handed us a card: import it, then report the avatar back. */
async function importDatacatBridgeCard(payload) {
    const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    const requestId = datacatRequestId(payload?.requestId);
    const id = datacatCharacterId(metadata);
    if (!requestId) throw new Error('DataCat sent an invalid request id.');
    if (!id) throw new Error('DataCat sent an invalid character id.');
    if (datacatBridge.active.has(id)) {
        postDatacatAck(requestId, 'processing', 'This character is already importing.', {
            datacatCharacterId: id, phase: 'Already importing', step: 'in-progress', stepLabel: 'Wait for active import',
        });
        return;
    }
    datacatBridge.active.add(id);
    try {
        const png = validateDatacatPng(payload.png);
        const card = readPngCardPayload(png);
        // Kept for live diagnosis: what the site actually sent, without guessing.
        window.__wvDatacatLastCard = {
            name: metadata.characterName, bytes: png.byteLength,
            chunks: card.chunks, cardKind: card.cardKind, cardBytes: card.cardBytes,
            at: new Date().toISOString(),
        };
        if (!card.cardKind || card.cardBytes < 64) {
            throw new Error(`DataCat sent artwork only — no card data in the PNG (chunks: ${card.chunks.join(', ') || 'none'}).`);
        }
        // Evidence check (2026-11-23), official extension captured in DevTools
        // plus datacat.run's own traffic recorded through chrome-network-mcp:
        //   - Open-in-SillyTavern path: GET /api/characters/<id>/download
        //       ?t=…&downloadFormat=png&variant=janitor_core&sourceKind=janitor
        //     — no `definitionSource` — and the official extension still got a
        //     FULL card (Lena: description ~7.4k, first_mes, 9 tags), then
        //     POST /api/characters/import → 200.
        //   - Site Download button: the same endpoint with
        //     `&definitionSource=source` → FULL card as well (Hana: 7,061).
        // So a missing `definitionSource` does NOT by itself yield a name-only
        // card; the earlier hypothesis that it did is RETRACTED. DataCat
        // sometimes answers with an empty definition (its mirrored retrieval
        // for that character has not completed). The official extension imports
        // that blank card silently; we refuse it rather than creating a blank
        // character.
        const name = String(metadata.characterName || metadata.name || 'datacat-character').trim();
        const texts = datacatCardTextLengths(card.cardText);
        if (texts && texts.total < 16) {
            throw new Error(`DataCat answered with a card that has no text for "${name}" — its stored definition for this character is empty, so the PNG carries only the name and the artwork. Open the character on datacat.run (or in the DataCat panel), press Download to pull the full definition, then import that PNG. This is DataCat-side retrieval state, not something the vault changes.`);
        }
        // Same contract the official extension posts: the PNG as `avatar`, an
        // explicit `file_type`, a stable `preserved_name`, and the provenance
        // block as `datacat_metadata`.
        const preservedName = datacatPreservedName(metadata);
        const uploadName = `${datacatNamePart(
            String(metadata.fileName || '').replace(/\.png$/i, '') || preservedName,
            preservedName,
            96,
        )}.png`;
        const file = new File([png], uploadName, { type: 'image/png' });
        const formData = new FormData();
        formData.append('avatar', file);
        formData.append('file_type', 'png');
        formData.append('preserved_name', preservedName);
        formData.append('datacat_metadata', JSON.stringify({
            source: 'datacat', provider: 'datacat',
            datacatCharacterId: id, characterId: id,
            characterName: String(metadata.characterName || metadata.name || '').slice(0, 256),
            creatorName: String(metadata.creatorName || metadata.creator || '').slice(0, 256),
            sourceKind: String(metadata.sourceKind || metadata.source_kind || '').slice(0, 64),
            characterUrl: String(metadata.characterUrl || metadata.character_url || metadata.url || '').slice(0, 2048),
        }));

        postDatacatAck(requestId, 'processing', 'Importing into Loreweaver…', {
            datacatCharacterId: id, phase: 'Importing PNG', step: 'st-import-png', stepLabel: 'Import PNG',
        });
        const headers = { ...getRequestHeaders() };
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-type') delete headers[key];
        const response = await fetch('/api/characters/import', {
            method: 'POST', headers, body: formData, cache: 'no-cache',
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.error) {
            throw new Error(result?.message || `Loreweaver could not import this PNG (${response.status}).`);
        }
        const importedBase = String(result.file_name || preservedName).trim().replace(/\.png$/i, '');
        const fileName = `${importedBase}.png`;
        datacatRememberImport(metadata, fileName);
        // Phase order matches the extension: announce the refresh, then reload.
        postDatacatAck(requestId, 'processing', 'Refreshing library…', {
            datacatCharacterId: id, avatar: fileName, phase: 'Refreshing library', step: 'refresh-library', stepLabel: 'Refresh library',
        });
        await getCharacters();

        // Provenance for the ledger + the source link, merged in place. Never
        // `POST /api/characters/edit` here: that handler rebuilds the card from
        // flat form fields and blanks every text field (see stampVaultProvenance).
        const target = characters.find(c => c.avatar === fileName);
        if (!target) {
            console.warn("[Weaver's Vault] DataCat import landed but could not be found for stamping");
        } else {
            const stamped = await stampVaultProvenance(fileName, {
                vault_source: 'datacat',
                vault_full_path: id,
                vault_url: `https://datacat.run/characters/${id}`,
            });
            if (!stamped) {
                toastr.warning('Imported, but provenance stamping failed.', "Weaver's Vault");
            }
            await getCharacters();
            const after = characters.find(c => c.avatar === fileName);
            const kept = String(after?.data?.description ?? '').length;
            if (after && stamped && kept === 0) {
                console.warn("[Weaver's Vault] DataCat import landed with an empty description after stamping");
            }
        }

        postDatacatAck(requestId, 'ok', 'Imported into Loreweaver.', {
            datacatCharacterId: id, avatar: fileName, phase: 'Chat ready', step: 'open-chat', stepLabel: 'Open chat',
        });
        toastr.success(`Imported ${name}`, "Weaver's Vault");
    } finally {
        datacatBridge.active.delete(id);
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

/**
 * JannyAI import. The PNG handed over by `/janny/card` already carries the vault
 * provenance (vault_source/vault_url/vault_full_path) inside its chara chunk, so
 * there is nothing to stamp afterwards — and stamping is exactly where imports
 * used to get blanked, so not touching the card again is the safer path.
 */
async function importJannyCharacter(item, character) {
    let cardFile = jannyFiles.get(item.fullPath);
    if (!cardFile) {
        // Detail was opened before a reload, or the cache was cleared: rebuild it
        // from the same route rather than failing.
        try {
            const r = await fetch('/api/weavers-vault/janny/card', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: item.fullPath, name: item.name }),
            });
            const payload = await r.json();
            if (!r.ok) throw new Error(payload?.error || `JannyAI answered ${r.status}`);
            cardFile = payload.file;
            jannyFiles.set(item.fullPath, cardFile);
            character = payload.character;
        } catch (error) {
            toastr.error(error.message, "Weaver's Vault import failed");
            return;
        }
    }
    const dup = ledgerCheck(item);
    if (dup) {
        toastr.warning(`Imported before (${new Date(dup.at).toLocaleString()}) — importing again creates a duplicate.`, "Weaver's Vault");
    }
    toastr.info('Importing character…', "Weaver's Vault");
    try {
        const bytes = Uint8Array.from(atob(cardFile.buffer), c => c.charCodeAt(0));
        const file = new File([bytes], cardFile.fileName, { type: cardFile.fileType });
        const importedAvatar = await importCharacter(file, { importTags: false });
        await getCharacters();
        if (!importedAvatar || !characters.find(c => c.avatar === importedAvatar)) {
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
            // Stamp provenance by merging, never via `/api/characters/edit`
            // (that endpoint rebuilds the card from flat fields and blanks text).
            let bookName;
            if (withBook && target.data.character_book) {
                bookName = target.data.character_book.name || `${target.name}'s Lorebook`;
                const converted = convertCharacterBook(target.data.character_book);
                await saveWorldInfo(bookName, converted, true);
                await updateWorldInfoList();
                toastr.success(`Lorebook '${bookName}' imported and linked.`, "Weaver's Vault");
            }
            const stampExtensions = {
                vault_source: 'chub',
                vault_url: `https://chub.ai/characters/${item.fullPath}`,
            };
            if (bookName) stampExtensions.world = bookName;
            const stamped = await stampVaultProvenance(target.avatar, stampExtensions);
            if (!stamped) {
                console.error(`[${extensionName}] provenance stamp failed — card imported but not stamped`);
                toastr.warning('Imported, but provenance stamping failed — cleanup tests may refuse to remove this card.', "Weaver's Vault");
            } else {
                target.data.extensions = { ...(target.data.extensions ?? {}), ...stampExtensions };
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
