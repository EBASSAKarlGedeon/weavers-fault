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
import { convertCharacterBook, createWorldInfoEntry, saveWorldInfo, updateWorldInfoList, world_names, importWorldInfo } from '../../world-info.js';
import { ConnectionManagerRequestService } from '../shared.js';
import { getTokenCount } from '../../tokenizers.js';
import {
    REQUEST_TEMPERATURE,
    RebuildError,
    contextFor,
    parseReply,
    partCacheKey,
    planBuild,
    publicEntryContents,
    readRebuildSettings,
    resolveRebuildProfile,
    transportFor,
    withoutPublicEntries,
} from './lorebook-rebuild.js';
import {
    captureBack,
    captureConfirmClose,
    captureStage,
    captureStages,
    importOptions,
    lorebookRefs,
} from './import-flow.js';
import { descriptionBodyHtml, escapeHtml, infoBioHtml } from './detail-view.js';
// Resolved against this module URL so the popup markup works wherever the
// extension is served from (the overlay DOM lives under the app's base URL).
const IMG_CHUB = new URL('chub.png', import.meta.url).href;
const IMG_SAUCEPAN = new URL('saucepan.svg', import.meta.url).href;
const IMG_DATACAT = new URL('datacat.png', import.meta.url).href;
const IMG_JANNY = new URL('janny.png', import.meta.url).href;
const IMG_JANITOR = new URL('janitor.png', import.meta.url).href;

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
    janitor: { label: 'JanitorAI', img: IMG_JANITOR },
};

// JannyAI cards arrive already built by the server (it drives a real browser
// through the site's Cloudflare challenge); keyed by character id.
const jannyFiles = new Map();

// JanitorAI cards also arrive built by the server (it reads
// /hampter/characters/{id} inside the signed-in browser session). The detail
// payload is kept separately because a closed card has to be able to say *why*
// it cannot be imported.
const janitorFiles = new Map();
const janitorCards = new Map();

// Extracted Saucepan cards by companionId — the detail FAB import consumes these.
const saucepanFiles = new Map();

function parseCompanionIdLocal(url) {
    const m = /saucepan\.ai\/companion\/([a-f0-9-]{8,64})/i.exec(String(url));
    return m ? m[1] : null;
}

/**
 * The id out of a pasted JanitorAI link.
 *
 * The site's canonical page is `/characters/<uuid>_<slug>` — the slug after the
 * underscore is decoration and must not end up in the id. A bare uuid is
 * accepted too, because that is what an id copied from an API payload looks
 * like, and a link to the profile is not a character at all.
 * @param {string} url
 * @returns {string|null}
 */
function parseJanitorIdLocal(url) {
    const text = String(url ?? '').trim();
    const page = /janitorai\.com\/characters\/([0-9a-f]{8}-[0-9a-f-]{4,})/i.exec(text);
    if (page) return page[1].split('_')[0];
    const bare = /^([0-9a-f]{8}-[0-9a-f-]{4,})$/i.exec(text);
    return bare ? bare[1] : null;
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

// JanitorAI's listing has its own four sorts (the site 400s on anything else,
// including `all`), so the menu must offer exactly these.
const JANITOR_SORTS = {
    trending24: { label: 'Trending 24 hours', icon: 'fa-solid fa-fire' },
    trending: { label: 'Trending', icon: 'fa-solid fa-arrow-trend-up' },
    latest: { label: 'Latest', icon: 'fa-solid fa-clock' },
    popular: { label: 'Most popular', icon: 'fa-solid fa-star' },
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
                    <button class="wv-iconbtn wv-ledgerbtn" title="Import history" aria-label="Import history">
                        <span class="fa-solid fa-clock-rotate-left"></span>
                    </button>
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
                                <div class="wv-tagmeta" hidden></div>
                                <div class="wv-tagcloud"></div>
                                <button class="wv-showall" hidden></button>
                            </div>
                        </section>
                    </div>
                </div>
            </div>

            <!-- Import history (Q4): the ledger every import and every refusal lands in. -->
            <div class="wv-ledger-overlay" hidden>
                <div class="wv-modal">
                    <div class="wv-sheetbar">
                        <span class="wv-sheettitle">Import history</span>
                        <span class="wv-spacer"></span>
                        <button class="wv-winbtn wv-lclear" title="Clear history" aria-label="Clear history"><span class="fa-solid fa-trash-can"></span></button>
                        <button class="wv-winbtn wv-lclose" title="Close" aria-label="Close import history"><span class="fa-solid fa-xmark"></span></button>
                    </div>
                    <div class="wv-sheetbody wv-ledgerbody"></div>
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
    const ledger = root.querySelector('.wv-ledger-overlay');
    if (ledger && !ledger.hidden) { closeLedgerSheet(); return; }
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
    tagMeta: null,          // {source, fetchedAt} for the JannyAI vocabulary
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
    // Only count what the active source can honour — the sheet hides the rest,
    // so a badge for a hidden switch would be unexplainable.
    const chub = state.source === 'chub';
    let n = 0;
    if (f.nsfw) n++;
    if (f.minTokens !== FILTER_DEFAULTS.minTokens || f.maxTokens !== FILTER_DEFAULTS.maxTokens) n++;
    if (f.inclusiveOr && f.tags.size) n++;
    n += f.tags.size;
    if (chub) {
        if (f.nsfwOnly) n++;
        if (f.minAiRating > 0) n++;
        if (f.minTags > 0) n++;
        for (const [key] of REQUIRE_ROWS) if (f[key]) n++;
        if (f.recommendedVerified) n++;
    }
    return n;
}

/**
 * One search entry point for every browsable source. Chub pages by number;
 * DataCat pages by offset and sorts a field over a time window, so the request
 * shape differs while the render path stays identical.
 */
function searchRequest() {
    const f = state.filters ?? { ...committedFilters(), tags: new Set() };
    if (state.source === 'janitor') {
        // The listing is a GET with a query string, and it filters on numeric tag
        // ids — the sheet stores names, so they travel as names and the server
        // resolves them through its cached catalogue.
        const params = new URLSearchParams();
        params.set('page', String(state.page || 1));
        params.set('sort', state.sort);
        // The listing has its own SWF/NSFW switch and honours nothing else: with
        // the sheet's "Show NSFW" off, the request must say `mode=sfw` (measured
        // 2026-11-26: without it the grid filled with NSFW cards while the toggle
        // read off, because the client never sent the parameter the server already
        // supports).
        params.set('mode', f.nsfw ? 'all' : 'sfw');
        // A pasted link is not a phrase. Leaving it in the box must not turn the
        // grid into "search for this URL", which is how the first live run of S7
        // returned "No results" while the box looked empty.
        const phrase = state.query.trim();
        if (phrase && !parseJanitorIdLocal(phrase)) params.set('search', phrase);
        for (const tag of f.tags) params.append('tags[]', tag);
        return {
            url: `/api/weavers-vault/janitor/search?${params.toString()}`,
            method: 'GET',
            source: 'JanitorAI',
        };
    }
    if (state.source === 'janny') {
        // The index pages by number and filters on numeric tag ids; the sheet
        // stores names, so they travel as names and the server resolves them
        // through its cached catalog.
        return {
            url: '/api/weavers-vault/janny/search',
            source: 'JannyAI',
            body: {
                query: state.query,
                page: state.page,
                nsfw: f.nsfw,
                minTokens: f.minTokens,
                maxTokens: f.maxTokens,
                tags: [...f.tags],
                inclusiveOr: Boolean(f.inclusiveOr),
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
    const { url, body, method = 'POST', source } = searchRequest();
    fetch(url, method === 'GET'
        ? { method, headers: getRequestHeaders() }
        : { method, headers: getRequestHeaders(), body: JSON.stringify(body) })
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
            // A selected tag the provider no longer carries is dropped and named:
            // leaving it selected would filter on nothing and still look like a
            // successful search (the silent no-op the sheet must never produce).
            if (payload.unknownTags?.length) {
                const stale = payload.unknownTags.map(tag => String(tag));
                for (const tag of stale) state.filters.tags.delete(tag);
                const saved = committedFilters();
                saved.tagNames = saved.tagNames.filter(tag => !stale.includes(tag));
                saveSettingsQuiet();
                hydrateControls();
                toastr.warning(`${source} no longer has: ${stale.join(', ')}`, "Weaver's Vault filter");
            }
            if (state.page === 1) {
                state.items = payload.items ?? [];
            } else {
                // Measured on the live listing: page 2 shared 19 of 34 ids with
                // page 1, because a live sort shifts while you page through it.
                // Appending blindly put the same card on the grid twice.
                const seen = new Set(state.items.map(item => item.fullPath ?? item.id));
                const fresh = (payload.items ?? []).filter(item => {
                    const key = item.fullPath ?? item.id;
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                state.items.push(...fresh);
                state.reachedEnd = fresh.length === 0;
            }
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
    // Same units the site prints (991k, 1M); the range extends to 99 billion,
    // above which the full number is shown rather than rounding it away —
    // stats.message passed 1,000,000 within days of the badge fix.
    const trim = v => { const s = v >= 100 ? String(Math.round(v)) : v.toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s; };
    if (n >= 100e9) return String(Math.round(n));
    if (n >= 1e9) return `${trim(n / 1e9)}B`;
    if (n >= 1e6) return `${trim(n / 1e6)}M`;
    if (n >= 1e3) return `${trim(n / 1e3)}k`;
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
    for (const item of state.items) {
        // "Show NSFW" is a promise, not a hint: a provider that ignores its own
        // SFW switch (JanitorAI returns SFW-mode listings that still carry
        // NSFW-rated rows, measured 2026-11-26) must not put one on screen while
        // the toggle reads off. Items without a rating flag are always shown.
        if (item.nsfw && !state.filters?.nsfw) continue;
        const card = document.createElement('article');
        card.className = 'wv-card';
        const tags = item.tags ?? [];
        const chips = [
            `<span class="wv-chip ${item.nsfw ? 'wv-c-nsfw' : 'wv-c-sfw'}">${item.nsfw ? 'NSFW' : 'SFW'}</span>`,
            ...tags.slice(0, 8).map(t => chipHtml(`#${t}`)),
        ].join('');
        card.innerHTML = `
            <div class="wv-art">
                <img loading="lazy" referrerpolicy="no-referrer" alt="" />
                <div class="wv-ph"></div>
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
            : state.source === 'janitor'
                ? (JANITOR_SORTS[state.sort]?.icon ?? 'fa-solid fa-sort')
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
    if (state.source === 'janitor') {
        return Object.fromEntries(Object.entries(JANITOR_SORTS).map(([k, v]) => [k, v.label]));
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
        // Saucepan and JanitorAI: the search bar is a paste-URL importer.
        if (state.source === 'saucepan') {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                if (parseCompanionIdLocal(state.query)) importSaucepanUrl(state.query.trim());
            }, 600);
            return;
        }
        if (state.source === 'janitor') {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                // A pasted link is an import; a phrase is a search. Both arrive in
                // the same box because the source does both.
                if (parseJanitorIdLocal(state.query)) importJanitorUrl(state.query.trim());
                else resetAndSearch();
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
        if (e.key === 'Enter' && state.source === 'janitor' && parseJanitorIdLocal(search.value)) {
            e.preventDefault();
            clearTimeout(searchTimer);
            importJanitorUrl(search.value.trim());
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
    root.querySelector('.wv-ledgerbtn').addEventListener('click', () => openLedgerSheet());
    root.querySelector('.wv-lclose').addEventListener('click', closeLedgerSheet);
    root.querySelector('.wv-ledger-overlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeLedgerSheet();
    });
    // Two presses, not a browser confirm(): the first arms the button, the
    // second clears. A history is cheap to lose but pointless to lose by accident.
    root.querySelector('.wv-lclear').addEventListener('click', event => {
        const button = event.currentTarget;
        if (button.dataset.armed !== 'true') {
            button.dataset.armed = 'true';
            button.classList.add('wv-armed');
            button.title = 'Press again to clear the whole history';
            setTimeout(() => {
                if (button.dataset.armed === 'true') {
                    button.dataset.armed = 'false';
                    button.classList.remove('wv-armed');
                    button.title = 'Clear history';
                }
            }, 3000);
            return;
        }
        button.dataset.armed = 'false';
        button.classList.remove('wv-armed');
        button.title = 'Clear history';
        settings().ledger = [];
        saveSettingsQuiet();
        renderLedger();
    });
    root.querySelector('.wv-ledgerbtn').addEventListener('click', () => openLedgerSheet());
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
        // Glaze's debounce. A site-owned vocabulary is complete locally, so there
        // is nothing to ask an index for (and chub's tag search would answer with
        // another provider's words).
        const closedVocabulary = state.source === 'janny' || state.source === 'janitor';
        if (q && !closedVocabulary) tagSearchTimer = setTimeout(() => fetchTagSuggestions(q), 250);
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
    // Tags exist for chub (topics) and JannyAI (its own tag ids). Saucepan is not
    // browsable, so it gets neither.
    const tagsAvailable = state.source === 'chub' || state.source === 'janny' || state.source === 'janitor';
    const tagCard = root.querySelector('.wv-tagshead')?.closest('.wv-mcard');
    if (tagCard) tagCard.hidden = !tagsAvailable;

    // Chub-only filters: NSFL, NSFW-only, the per-card "recommended/verified"
    // marker, AI rating, tag count and the "must include" cards are listing
    // flags of chub's API. JannyAI's index can only filter createdAtStamp,
    // isLowQuality, isNsfw, permanentToken, tagIds and totalToken, so showing
    // these would promise filtering that never happens. Hiding is the honest
    // option, and it keeps the badge count truthful.
    const chubOnlyKeys = [
        'nsfl', 'nsfwOnly', 'recommendedVerified', 'minAiRating', 'minTags',
        ...REQUIRE_ROWS.map(([key]) => key),
    ];
    for (const key of chubOnlyKeys) {
        const input = root.querySelector(`.wv-sheetbody input[data-filter="${key}"]`);
        const row = input?.closest('.wv-mrow');
        if (row) row.hidden = state.source !== 'chub';
    }
    // The two numeric fields have no data-filter attribute of their own.
    for (const selector of ['.wv-minair', '.wv-mintags']) {
        const row = root.querySelector(`.wv-sheetbody ${selector}`)?.closest('.wv-mrow');
        if (row) row.hidden = state.source !== 'chub';
    }
    // JanitorAI's listing takes a page, a sort, a search phrase, tag ids and a
    // creator id — nothing else. A token range or a "match any tag" switch would
    // filter on nothing and look like a successful search, so they are hidden
    // rather than offered (the rule from PITFALLS #13: never offer a control the
    // source cannot honour).
    if (state.source === 'janitor') {
        // The token range is not a `.wv-mrow`: it is a `.wv-rangerow` (label +
        // two fields) inside the Card section, so a `closest('.wv-mrow')` found
        // nothing and the row stayed on screen promising a filter that never
        // happens (measured on the phone sheet).
        const rangeRow = root.querySelector('.wv-sheetbody .wv-rangerow');
        if (rangeRow) rangeRow.hidden = true;
        // The whole Card section then holds only the chub-only numeric rows
        // (AI rating, tag count), which are hidden just above.
        const cardSection = rangeRow?.closest('.wv-mcard');
        if (cardSection) cardSection.hidden = state.source === 'janitor';
        const anyTag = root.querySelector('.wv-sheetbody input[data-filter="inclusiveOr"]')?.closest('.wv-mrow');
        if (anyTag) anyTag.hidden = true;
    }
    // The whole "must include" collapsible is chub-only too.
    const collapsible = root.querySelector('.wv-sheetbody .wv-collapsible');
    if (collapsible) collapsible.hidden = state.source !== 'chub';
    // The "Other" card holds nothing else, so hide the whole card with it.
    const otherCard = root.querySelector('.wv-sheetbody input[data-filter="recommendedVerified"]')?.closest('.wv-mcard');
    if (otherCard) otherCard.hidden = state.source !== 'chub';

    overlay.hidden = false;
    if (tagsAvailable) ensureTagCloud();
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

/**
 * The sources whose tag vocabulary lives on the site rather than in a search
 * index, and the endpoint that reads it.
 * @returns {{label: string, url: string}|null}
 */
function siteTagSource() {
    if (state.source === 'janitor') return { label: 'JanitorAI', url: '/api/weavers-vault/janitor/tags' };
    if (state.source === 'janny') return { label: 'JannyAI', url: '/api/weavers-vault/janny/tags' };
    return null;
}

async function ensureTagCloud() {
    if (state.tagCloud || state.tagCloudLoading) return;
    state.tagCloudLoading = true;
    renderTagPicker();
    try {
        const siteTags = siteTagSource();
        if (siteTags) {
            // Both labels live on the site, not in a search index (JannyAI's
            // index only knows numeric tagIds, JanitorAI's listing only numeric
            // tag_id[]s); the server reads each once and caches it.
            const r = await fetch(siteTags.url, { headers: getRequestHeaders() });
            const body = await r.json();
            if (!r.ok) throw new Error(body?.error || `${siteTags.label} answered ${r.status}`);
            state.tagCloud = (body.tags ?? []).map(t => String(t.name ?? '').trim()).filter(Boolean);
            state.tagMeta = { source: body.source ?? null, fetchedAt: body.fetchedAt ?? null };
        } else {
            const r = await fetch('/api/weavers-vault/chub/tags', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ limit: 500, sort: 'n_projects', nsfw: true, nsfl: true }),
            });
            const body = await r.json();
            if (r.ok) state.tagCloud = (body.tags ?? []).map(t => t.name);
            else toastr.error(body?.error || `chub.ai answered ${r.status}`, "Weaver's Vault tags");
        }
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
/**
 * Say where the tag vocabulary came from.
 *
 * JannyAI's labels are read from its own sidebar and cached, so they can be
 * missing (built-in list) or old. Saying so beats a filter sheet that silently
 * offers a stale or incomplete list, and the refresh is one click.
 */
function renderTagMeta() {
    const el = root.querySelector('.wv-tagmeta');
    if (!el) return;
    const meta = state.tagMeta;
    const siteTags = siteTagSource();
    if (!siteTags || !meta) {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }
    // fetchedAt is epoch *milliseconds as a number*; Date.parse() wants a string
    // and returns NaN for this, which silently hid the whole note.
    const stamp = typeof meta.fetchedAt === 'number' ? meta.fetchedAt : Date.parse(String(meta.fetchedAt));
    const ageDays = Number.isFinite(stamp) ? Math.floor((Date.now() - stamp) / 86_400_000) : null;
    let text = '';
    if (meta.source === 'fallback') {
        text = `Built-in tag list — ${siteTags.label}'s own list could not be read just now.`;
    } else if (meta.source === 'stale') {
        // Serving last week's vocabulary is right; pretending it is current is not.
        text = `${siteTags.label}'s tag list could not be refreshed just now — showing the cached list.`;
    } else if (ageDays !== null && ageDays >= 6) {
        text = `Tag list read ${ageDays} days ago.`;
    }
    el.hidden = !text;
    el.innerHTML = text
        ? `<span>${escapeHtml(text)}</span><button class="wv-tagrefresh">Refresh</button>`
        : '';
    el.querySelector('.wv-tagrefresh')?.addEventListener('click', refreshProviderTags);
}

/** Re-read the active provider's tag list, keeping the current one if it fails. */
async function refreshProviderTags(event) {
    const button = event?.currentTarget;
    const siteTags = siteTagSource();
    if (!siteTags) return;
    if (button) button.disabled = true;
    try {
        const r = await fetch(`${siteTags.url}?refresh=1`, { headers: getRequestHeaders() });
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || `${siteTags.label} answered ${r.status}`);
        const names = (body.tags ?? []).map(t => String(t.name ?? '').trim()).filter(Boolean);
        if (!names.length) throw new Error(`${siteTags.label} returned no tags.`);
        state.tagCloud = names;
        state.tagMeta = { source: body.source ?? null, fetchedAt: body.fetchedAt ?? null };
        // Drop selections that no longer exist, so a filter cannot become a no-op.
        const known = new Set(names.map(n => n.toLowerCase()));
        for (const tag of [...state.filters.tags]) {
            if (!known.has(tag.toLowerCase())) state.filters.tags.delete(tag);
        }
        saveSettingsQuiet();
        renderTagPicker();
        toastr.success(`Tag list refreshed (${names.length} tags).`, "Weaver's Vault");
    } catch (error) {
        toastr.error(error.message, "Weaver's Vault tags");
    } finally {
        if (button) button.disabled = false;
    }
}

function renderTagPicker() {
    renderTagMeta();
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
        // Both site-owned vocabularies are closed: JannyAI's index and JanitorAI's
        // listing filter on numeric tag ids, so a free-text tag could never match
        // anything. No "add raw" chip for them.
        const closedVocabulary = state.source === 'janny' || state.source === 'janitor';
        const addRaw = !closedVocabulary
            && ![...f.tags].some(t => t.toLowerCase() === query)
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

// Glaze's window has no dim, so the empty area around it reads as the backdrop.
// Clicking it closes, like the title-bar X. Wired once on the persistent popup:
// a press that starts inside the window (selecting text) must not count, even if
// the release lands outside, so the press target is remembered, not just the click.
function wireDetailBackdrop(popup) {
    if (popup.dataset.backdrop === '1') return;
    popup.dataset.backdrop = '1';
    let pressedOnBackdrop = false;
    popup.addEventListener('pointerdown', (event) => {
        pressedOnBackdrop = event.button === 0 && event.target === popup;
    });
    popup.addEventListener('click', (event) => {
        const close = pressedOnBackdrop && event.target === popup;
        pressedOnBackdrop = false;
        if (close) popup.hidden = true;
    });
}

async function openDetail(item, preloaded = null, report = null) {
    ensureOverlay();
    const popup = root.querySelector('.wv-detail');
    wireDetailBackdrop(popup);
    popup.hidden = false;
    // A closed JanitorAI definition is a verdict, not a failure: there is no
    // card to preview, so it renders the verdict instead of an empty sheet.
    if (report?.needsCapture) {
        renderDetailClosed(popup, item, report);
        return;
    }
    popup.innerHTML = `
        <div class="wv-dwin">
            <div class="wv-dwinbar">
                <div class="wv-sheettitle"></div>
                <button class="wv-winbtn wv-dmax" title="Maximize">${ICON_MAXIMIZE}</button>
                    <button class="wv-winbtn wv-dclose" title="Close"><span class="fa-solid fa-xmark"></span></button>
            </div>
            <div class="wv-dloading">
                <span class="wv-spinner"></span>
                <div class="wv-dphase">${item.source === 'janny' ? 'Opening JannyAI in a browser session…' : item.source === 'janitor' ? 'Reading JanitorAI…' : 'Loading character…'}</div>
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
        if (item.source === 'janny' || item.source === 'janitor') {
            // Both sources read their detail inside a real browser session and
            // hand back a finished, provenance-stamped card PNG.
            const janitor = item.source === 'janitor';
            const r = await fetch(`/api/weavers-vault${janitor ? '/janitor' : '/janny'}/card`, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: item.fullPath, name: item.name }),
                signal: detailAbort.signal,
            });
            const payload = await r.json();
            if (!r.ok) throw vaultError(payload?.error || `${janitor ? 'JanitorAI' : 'JannyAI'} answered ${r.status}`, payload?.code, r.status, payload?.reason);
            if (janitor) {
                // A closed card is a classification, not an error: it has no
                // importable text at all, so the detail has to say so.
                if (payload.needsCapture) {
                    janitorCards.set(item.fullPath, payload);
                    renderDetailClosed(popup, item, payload);
                    return;
                }
                janitorFiles.set(item.fullPath, payload.file);
            } else {
                jannyFiles.set(item.fullPath, payload.file);
            }
            renderDetail(popup, item, payload.character, {
                meta: payload.meta,
                definitionPublic: payload.definitionPublic,
            });
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
                    <div class="wv-derrmsg">${item.source === 'datacat' ? 'DataCat' : item.source === 'janny' ? 'JannyAI' : item.source === 'janitor' ? 'JanitorAI' : 'chub.ai'} failed — ${escapeHtml(error.message)}</div>
                    <div class="wv-derractions">
                        ${error.code === 'janny_browser' || error.code === 'janitor_browser' ? '<button class="wv-dshowbrowser">Show the browser window</button>' : ''}
                        <button class="wv-dretry" data-fullpath="${escapeHtml(item.fullPath)}">Try again</button>
                    </div>
                </div>
            </div>`;
        wireWinChrome(popup, () => { popup.hidden = true; });
        popup.querySelector('.wv-dretry').addEventListener('click', () => openDetail(item));
        // The automation window is parked offscreen with no taskbar button, so a
        // check that wants one human click needs this: move it into view.
        popup.querySelector('.wv-dshowbrowser')?.addEventListener('click', async event => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                const focus = item.source === 'janitor' ? '/janitor/browser/focus' : '/janny/browser/focus';
                const r = await fetch(`/api/weavers-vault${focus}`, { method: 'POST', headers: getRequestHeaders() });
                const body = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(body?.error || `The browser answered ${r.status}`);
                toastr.info('A Chrome window was brought to the front. Finish the check there, then press “Try again”.', "Weaver's Vault");
            } catch (err) {
                toastr.error(err.message, "Weaver's Vault");
            } finally {
                button.disabled = false;
            }
        });
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

/**
 * What a closed JanitorAI card can honestly show.
 *
 * Measured: such a payload has `personality`, `scenario`, `first_message`,
 * `example_dialogs` and `scripts` all null, with every `token_counts.*` at 0 —
 * only the public bio survives. So there is nothing to preview and nothing to
 * import, and the sheet says exactly that instead of showing blank blocks. The
 * import button is absent rather than disabled: a dead button invites clicking.
 */
/**
 * A closed JanitorAI card, rendered by the *same* window as every other source.
 *
 * This used to be a second renderer — a bare pane with a lock note, a bio block
 * and a Recover button — which is why a JanitorAI card looked like a different
 * product from a chub one. There is now one window: hero, tab strip, prompt-block
 * drawers, FAB. A closed card changes the *data*, not the layout: the definition
 * is what is missing, so the same Import button recovers it and offers its
 * lorebooks, and the site's public bio stands in for the body inside the
 * Description drawer.
 * @param {HTMLElement} popup
 * @param {object} item
 * @param {object} report the `/janitor/card` payload with `needsCapture`
 */
function renderDetailClosed(popup, item, report) {
    const row = report?.row ?? {};
    const bioHtml = String(report?.bioHtml ?? '');
    const bioText = bioHtml || String(row.blurb ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const closedItem = { ...item, avatarUrl: item?.avatarUrl || row.avatar || '' };
    const character = {
        data: {
            name: row.name || item?.name || 'Untitled',
            creator: row.creator || '',
            tags: [...(row.tags ?? []), ...(row.customTags ?? [])].filter(Boolean).slice(0, 8),
            creator_notes: bioText,
            description: '',
            personality: '',
            scenario: '',
            first_mes: '',
            extensions: { vault_source: 'janitor' },
        },
    };
    renderDetail(popup, closedItem, character, {
        closed: true,
        reason: janitorBlockMessage(report),
        bioHtml,
        meta: report?.meta ?? null,
    });
}

/**
 * Recover a closed JanitorAI definition.
 *
 * The route drives the site for a minute or two, so the button owns the wait and
 * says how long it has been waiting rather than leaving a dead spinner. A profile
 * wall is a real answer from the site (it will not generate without a persona),
 * so it is shown as instructions — the server has already opened that window.
 * @param {object} item
 * @param {HTMLElement} popup
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} status
 */
async function recoverJanitorCard(item, popup, button, status) {
    if (!item?.fullPath) return;
    const started = Date.now();
    button.disabled = true;
    status.hidden = false;
    const tick = setInterval(() => {
        status.textContent = `Recovering… ${Math.round((Date.now() - started) / 1000)}s (JanitorAI is generating)`;
    }, 1_000);
    status.textContent = 'Recovering… starting the JanitorAI window';
    try {
        const r = await fetch('/api/weavers-vault/janitor/capture', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ id: item.fullPath }),
        });
        const payload = await r.json();
        if (!r.ok) {
            status.textContent = payload?.error || `The capture answered ${r.status}`;
            if (payload?.code === 'janitor_profile_required') {
                status.textContent += ' Complete your JanitorAI profile, then press Import again.';
            }
            ledgerFail(item, 'capture', failureReason(payload, r.status));
            toastr.error(status.textContent, "Weaver's Vault");
            return;
        }
        const report = payload.report ?? {};
        status.textContent = `Recovered ${report.descriptionChars ?? 0} characters. Importing…`;
        const captured = new Map([[item.fullPath, payload.file]]);
        await importJannyCharacter(item, payload.character, '/janitor/capture', captured);
        status.textContent = `Recovered and imported: ${report.descriptionChars ?? 0} characters of definition, ${report.scenarioChars ?? 0} of scenario, ${report.closedLoreEntries ?? 0} hidden lore entries.`;
    } catch (error) {
        console.error(`[${extensionName}] janitor capture failed`, error);
        status.textContent = error.message;
        ledgerFail(item, 'capture', failureReason(error, error.status));
        toastr.error(error.message, "Weaver's Vault capture failed");
    } finally {
        clearInterval(tick);
        button.disabled = false;
    }
}

function renderDetail(popup, item, character, report = {}) {
    const d = character.data;
    const name = d.name || '?';
    const closed = Boolean(report?.closed);
    // Glaze's Info tab reads `character.creatorNotes` (_InfoTab:1492), i.e. the
    // card's storefront/creator notes — NOT the card body. The body is the
    // Description block inside the Prompt Blocks tab. Rendering `description`
    // here showed a completely different text than the real app.
    const bioText = String(d.creator_notes ?? '').trim();
    // A janitor card's notes are converted bio HTML (janitor-html.js, sanitised);
    // every other source's notes are plain text and stay escaped.
    const isHtml = d.extensions?.vault_source === 'janitor' && /^<(div|p|h[1-6]|ul|ol|blockquote)\b/i.test(bioText);
    // Both of these are pure and unit-tested (detail-view.js): the closed-card
    // bug lived here, and this file cannot be imported without SillyTavern.
    const infoBio = infoBioHtml({ bioText, isHtml, tagCount: (d.tags ?? []).length, closed });
    const descriptionBody = descriptionBodyHtml(d.description);
    // One accordion list for every source; the Description row is filled from
    // whichever of the two above exists, so the drawer never renders empty.
    const sections = DETAIL_PROMPT_SECTIONS.filter(([key]) => (key === 'description' ? Boolean(descriptionBody) : Boolean(d[key])));
    const greetings = [d.first_mes, ...(d.alternate_greetings ?? [])].filter(g => g && g.trim());
    // The Lorebooks inventory and the options sheet need the same list: the
    // character's own `scripts` (Glaze `lorebookScriptRefs`), never a guess from
    // the card's `character_book`.
    const bookRefs = item.source === 'janitor' ? lorebookRefs(report?.meta ?? null) : [];
    const chubBook = item.source === 'chub' ? d.character_book : null;

    popup.innerHTML = `
        <div class="wv-dwin">
            <div class="wv-dwinbar">
                <div class="wv-sheettitle"></div>
                <button class="wv-winbtn wv-dmax" title="Maximize">${ICON_MAXIMIZE}</button>
                    <button class="wv-winbtn wv-dclose" title="Close"><span class="fa-solid fa-xmark"></span></button>
            </div>
            <div class="wv-dscroll">
                <div class="wv-hero">
                    <img class="wv-heroimg" src="${escapeHtml(item.avatarUrl || '')}" referrerpolicy="no-referrer" alt="" />
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
                        ${closed ? `
                            <div class="wv-dclosednote">
                                <span class="fa-solid fa-lock wv-derricon"></span>
                                <div>${escapeHtml(report.reason ?? '')}</div>
                            </div>` : ''}
                        <div class="wv-dtagwrap">${(d.tags ?? []).slice(0, 8).map(detailTagChip).join('')}</div>
                        ${infoBio}
                    </div>
                    <div class="wv-dpane wv-dpane-prompts" hidden>
                        ${sections.length || greetings.length ? '' : '<div class="wv-dnoprev">No prompt blocks to preview</div>'}
                        ${sections.map(([k, label]) => `
                            <div class="wv-acc ${k === 'description' ? 'open' : ''}">
                                <button class="wv-acchead">
                                    <span class="wv-acclabel">${label}</span>
                                    <span class="fa-solid fa-chevron-up wv-accchev"></span>
                                </button>
                                <div class="wv-accbody">${k === 'description' ? descriptionBody : escapeHtml(d[k]).replace(/\n/g, '<br>')}</div>
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
                        <div class="wv-dbooks" hidden>
                            <div class="wv-dseclabel">Lorebooks</div>
                            <div class="wv-dbooklist"></div>
                            <div class="wv-dbookhint">Read-only inventory. Use Import to bring these into the library.</div>
                        </div>
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
            <div class="wv-recoverstatus" hidden></div>
        </div>`;

    const win = popup.querySelector('.wv-dwin');
    const close = () => { popup.hidden = true; };
    wireWinChrome(popup, close);
    popup.querySelector('.wv-dback').addEventListener('click', close);

    // Tab strip: pill track glass, sliding active pill, equal-width budget of
    // Exactly three segments, each a third of the strip: the 2.35-tab budget
    // from the multi-tab original clipped "Images" off the right edge on a
    // desktop window (measured scrollWidth 751 vs clientWidth 594).
    // Lorebooks inventory (Glaze character_detail_screen.dart:937-952): the tab
    // lists what the character has, read-only, and points at the Import button.
    // Filled on first open, because the counts cost one JanitorAI request.
    const bookList = popup.querySelector('.wv-dbooklist');
    const booksBox = popup.querySelector('.wv-dbooks');
    let booksLoaded = !bookRefs.length;
    const renderBooks = (books) => {
        bookList.innerHTML = books.map(book => {
            const icon = book.kind === 'closed' ? 'fa-lock' : book.kind === 'scripted' ? 'fa-code' : 'fa-book';
            const count = Number(book.entryCount) || 0;
            const sub = book.kind === 'closed'
                ? 'Private · recovered from the prompt'
                : book.kind === 'scripted'
                    ? 'Scripted (advanced) · rebuilt with your LLM'
                    : count + ' ' + (count === 1 ? 'entry' : 'entries');
            return '<div class="wv-dbookrow"><span class="fa-solid ' + icon + ' wv-dbookicon"></span>'
                + '<div><div class="wv-dbooktitle">' + escapeHtml(book.title || book.name || 'Lorebook') + '</div>'
                + '<div class="wv-dbooksub">' + escapeHtml(sub) + '</div></div></div>';
        }).join('');
    };
    const loadBooks = async () => {
        try {
            const r = await fetch('/api/weavers-vault/janitor/lorebooks', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: item.fullPath, name: item.name }),
            });
            const payload = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(payload?.error || 'JanitorAI answered ' + r.status);
            const books = Array.isArray(payload.books) ? payload.books : [];
            if (books.length) renderBooks(books);
        } catch (error) {
            console.warn('[' + extensionName + '] lorebook inventory failed: ' + error.message);
        }
    };
    if (chubBook) {
        booksBox.hidden = false;
        const count = (chubBook.entries ?? []).length;
        renderBooks([{ kind: 'public', name: item.name || 'Lorebook', entryCount: count }]);
    } else if (bookRefs.length) {
        booksBox.hidden = false;
        renderBooks(bookRefs.map(ref => ({ kind: ref.isPublic ? 'public' : 'closed', name: ref.title || 'Lorebook' })));
    }

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
        if (i === 1 && !booksLoaded) { booksLoaded = true; loadBooks(); }
    };
    tabs.forEach((t, i) => t.addEventListener('click', () => selectTab(i)));
    selectTab(0);

    // Accordions: closed = 3-line clamp + fade mask; open = full (280ms).
    // The open body has no height cap (style.css), so the expansion animation is
    // driven here: measure the real content height, hand it to the transition,
    // then release the inline style to `none` once it lands. Live height in the
    // DOM matters — greeting rows and images change it after opening — and a
    // pixel cap is what made long descriptions unscrollable (PITFALLS #44).
    popup.querySelectorAll('.wv-acc').forEach(acc => {
        const body = acc.querySelector('.wv-accbody');
        acc.querySelector('.wv-acchead').addEventListener('click', () => {
            if (!body) { acc.classList.toggle('open'); return; }
            const opening = !acc.classList.contains('open');
            if (opening) {
                acc.classList.add('open');
                body.style.maxHeight = `${body.scrollHeight}px`;
                return;
            }
            // Closing: pin the current height first, or the transition would
            // start from `none` and snap.
            body.style.maxHeight = `${body.scrollHeight}px`;
            void body.offsetHeight;
            body.style.maxHeight = '';
            acc.classList.remove('open');
        });
        body?.addEventListener('transitionend', e => {
            if (e.propertyName === 'max-height' && acc.classList.contains('open')) body.style.maxHeight = 'none';
        });
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
        const heroImg = popup.querySelector('.wv-heroimg');        pop.innerHTML = `
            <button class="wv-dpoprow" data-act="source"><span class="fa-solid fa-arrow-up-right-from-square"></span>Open source site</button>`;
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
            if (item.source === 'saucepan') {
                window.open(`https://saucepan.ai/companion/${encodeURIComponent(item.fullPath)}`, '_blank', 'noopener');
            } else if (item.source === 'datacat') {
                window.open(`https://datacat.run/characters/${encodeURIComponent(item.id)}`, '_blank', 'noopener');
            } else if (item.source === 'janny') {
                window.open(`https://jannyai.com/characters/${encodeURIComponent(item.fullPath)}`, '_blank', 'noopener');
            } else if (item.source === 'janitor') {
                window.open(`https://janitorai.com/characters/${encodeURIComponent(item.fullPath)}`, '_blank', 'noopener');
            } else {
                window.open(`https://chub.ai/characters/${encodeURIComponent(item.fullPath)}`, '_blank', 'noopener');
            }
            pop.remove();
        }));
        setTimeout(() => document.addEventListener('click', function once(ev) {
            if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', once); }
        }), 0);
    });

    // One Import button, always (Glaze character_detail_screen.dart:1026-1037):
    // the options sheet appears only when the character lists lorebooks, and a
    // closed definition is recovered through that same door — the recovery is a
    // mode of the import, never a second button.
    const fab = popup.querySelector('.wv-dfab');
    fab.addEventListener('click', () => openImportFlow({ item, character, popup, closed, report }));
}

/**
 * An Error that keeps the server's machine-readable code, so the UI can offer the
 * action that matches the failure instead of one generic retry.
 * @param {string} message
 * @param {string|undefined} code
 * @param {number} status
 * @returns {Error}
 */
/**
 * An error that carries the route's own classification.
 *
 * `reason` is kept separately from `code` on purpose: the code is the
 * transport's word (`janitor_missing`), the reason is the phenomenon the ledger
 * records (`missing`). Passing the code through as the reason produced ledger
 * lines reading `janitor_missing` — measured 2026-11-26 — so the server's reason
 * travels with the error and is preferred by `failureReason`.
 * @param {string} message
 * @param {string} [code]
 * @param {number} [status]
 * @param {string} [reason]
 * @returns {Error}
 */
function vaultError(message, code, status, reason) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    if (reason) error.reason = String(reason);
    return error;
}

function ledgerCheck(item) {
    const s = settings();
    const source = item.source ?? 'chub';
    return s.ledger.find(e => e.source === source && e.id === item.fullPath);
}

function ledgerAdd(item, what, reason = '') {
    const s = settings();
    const source = item.source ?? 'chub';
    s.ledger.push({
        source,
        id: item.fullPath,
        name: item.name,
        what,
        at: Date.now(),
        // Why it failed, when it did (S9): 'private', 'transport', 'signed-out',
        // 'script-denied', … — a ledger line that only says "lorebook" is a
        // mystery, and the whole point is that every failure states a reason.
        ...(reason ? { reason } : {}),
        url: source === 'saucepan'
            ? `https://saucepan.ai/companion/${item.fullPath}`
            : source === 'janny'
                ? `https://jannyai.com/characters/${item.fullPath}`
                : source === 'janitor'
                    ? `https://janitorai.com/characters/${item.fullPath}`
                    : source === 'datacat'
                        ? `https://datacat.run/characters/${item.fullPath}`
                : `https://chub.ai/characters/${item.fullPath}`,
    });
    saveSettingsQuiet();
}

/**
 * Record a failure, always with a reason (S9).
 *
 * "Every import lands in the ledger; every failure states a reason": a line that
 * says only `character` leaves the next debugging session guessing, so the
 * reason is required here and never defaulted to a shrug.
 * @param {{source?: string, fullPath?: string, name?: string}} item
 * @param {string} what 'character' | 'lorebook' | 'lorebooks' | 'blocked' | 'capture'
 * @param {string} reason a token from `JANITOR_FAILURE_REASONS` (server) or a status
 */
function ledgerFail(item, what, reason) {
    ledgerAdd(item, what, String(reason ?? '').trim() || 'unknown');
}

/**
 * The reason out of a route error body, or a thrown `vaultError`, or the status.
 *
 * JanitorAI routes send `reason` (derived once, server-side, by
 * `janitorFailureReason`); the other sources answer with a bare status.
 */
function failureReason(source, status = 0) {
    const reason = source?.reason ?? source?.code;
    if (reason) return String(reason);
    return status ? `http-${status}` : 'unknown';
}

/** A ledger item for a failure with no imported character behind it. */
function ledgerItemFor(source, id, name = '') {
    return { source, fullPath: String(id ?? ''), id: String(id ?? ''), name: String(name ?? '') };
}

/** What a ledger row says it did, in words (`what` is a compact token). */
const LEDGER_WHAT_LABELS = {
    character: 'Character',
    'character+lorebook': 'Character + lorebook',
    lorebook: 'Lorebook',
    lorebooks: 'Lorebooks',
    blocked: 'Not imported',
    capture: 'Definition recovery',
};

/**
 * The reason tokens from `JANITOR_FAILURE_REASONS` (and the local ones), as a
 * reader can act on them. A raw token in the UI would be honest but useless.
 */
const LEDGER_REASON_LABELS = {
    unproxyable: 'the creator turned the proxy off',
    private: 'private',
    deleted: 'deleted',
    missing: 'no such character on the site',
    'no-definition': 'the site hides its definition',
    'closed-capture-failed': 'the definition recovery failed',
    'profile-required': 'JanitorAI wants a persona first',
    challenge: 'a browser check did not finish',
    'signed-out': 'not signed in',
    'rate-limited': 'rate limited',
    transport: 'the request never completed',
    'no-browser': 'no browser to drive',
    unparseable: 'the site answered something unexpected',
    server: 'the site returned an error',
    'bad-id': 'that is not a link this source understands',
    'no-extract': 'the extraction data was gone',
    'import-failed': 'Loreweaver could not write the card',
    'save-failed': 'the lorebook could not be saved',
    'script-denied': 'the site refused the lorebook',
    'script-missing': 'the lorebook endpoint is gone',
    'no-entries': 'the lorebook is empty',
};

/** A ledger timestamp as "12 min ago" / "8 Aug, 18:57". */
function ledgerWhen(at) {
    const date = new Date(Number(at) || 0);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return '';
    const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * The ledger, newest first.
 *
 * Every import and every refusal lands here (S9), so this is the one place a
 * user can answer "did I already import this?" and "why didn't that one work?"
 * after the toast has gone. Rows carry the source, what happened, when, the
 * reason when there is one, and a link to the source page.
 */
function renderLedger() {
    const body = root.querySelector('.wv-ledgerbody');
    if (!body) return;
    const entries = [...(settings().ledger ?? [])]
        .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
    if (!entries.length) {
        body.innerHTML = `<div class="wv-ledger-empty">
            <span class="fa-solid fa-clock-rotate-left"></span>
            <p>Nothing yet.</p>
            <p class="wv-ledger-hint">Every character and lorebook you import lands here — and so does every attempt that failed, with the reason.</p>
        </div>`;
        return;
    }
    const rows = entries.map(entry => {
        const source = String(entry.source ?? 'chub');
        const label = SOURCE_META[source]?.label ?? source;
        const failed = Boolean(entry.reason);
        const what = LEDGER_WHAT_LABELS[entry.what] ?? entry.what ?? '';
        const reason = failed ? (LEDGER_REASON_LABELS[entry.reason] ?? entry.reason) : '';
        // A refusal often has no name — a 404 has only an id. Showing that id in
        // the title style would read as a character called "00000000-…", so it
        // gets the identifier treatment instead (and carries the full value in
        // `title`, which is also what a copy needs).
        const named = Boolean(String(entry.name ?? '').trim());
        const name = String(named ? entry.name : (entry.id || '(unnamed)'));
        const nameClass = named ? 'wv-lname' : 'wv-lname wv-lid';
        return `<div class="wv-lrow">
            <span class="wv-lsrc" data-source="${escapeHtml(source)}">${escapeHtml(label)}</span>
            <div class="wv-lmain">
                <div class="${nameClass}" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                <div class="wv-lmeta">
                    <span class="wv-lwhat${failed ? ' wv-lfail' : ''}">${escapeHtml(what)}</span>
                    <span class="wv-ldot">·</span>${escapeHtml(ledgerWhen(entry.at))}
                    ${failed ? `<span class="wv-ldot">·</span><span class="wv-lreason">${escapeHtml(reason)}</span>` : ''}
                </div>
            </div>
            ${entry.url ? `<a class="wv-llink" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" title="Open source page"><span class="fa-solid fa-arrow-up-right-from-square"></span></a>` : ''}
        </div>`;
    }).join('');
    body.innerHTML = `<section class="wv-mcard wv-lcard">
        <div class="wv-mhead2">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</div>
        ${rows}
    </section>`;
}

function openLedgerSheet() {
    const overlay = root.querySelector('.wv-ledger-overlay');
    if (!overlay) return;
    renderLedger();
    overlay.hidden = false;
    const clear = overlay.querySelector('.wv-lclear');
    // Disarm a half-pressed Clear when the sheet is opened fresh.
    clear.dataset.armed = 'false';
    clear.classList.remove('wv-armed');
    clear.title = 'Clear history';
}

function closeLedgerSheet() {
    const overlay = root.querySelector('.wv-ledger-overlay');
    if (overlay) overlay.hidden = true;
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
/**
 * What the search box means for the active source.
 *
 * Kept in one place because two callers set it (the chip hydration and the
 * DataCat layout switch) and they disagreed: the layout pass unconditionally
 * wrote "Search characters...", so switching to JanitorAI advertised a search
 * that source does not do yet.
 * @returns {string}
 */
function searchPlaceholder() {
    if (state.source === 'saucepan') return 'Paste a saucepan.ai companion URL…';
    // JanitorAI browses and takes a pasted link: one box, both meanings.
    if (state.source === 'janitor') return 'Search, or paste a janitorai.com character URL…';
    return 'Search characters...';
}

function hydrateSourceChip() {
    const meta = SOURCE_META[state.source] ?? SOURCE_META.chub;
    const chip = root.querySelector('.wv-source');
    chip.querySelector('img').src = meta.img;
    chip.querySelector('.wv-srclabel').textContent = meta.label;
    root.querySelector('.wv-search').placeholder = searchPlaceholder();
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
        search.placeholder = searchPlaceholder();
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
        // The tag vocabulary belongs to the provider: chub topics carry no meaning
        // in JannyAI's index (which filters numeric ids), so keeping the old cloud
        // offered filters that never resolve — a silent no-op. Drop it, and the
        // sheet re-reads the new provider's list on open.
        state.tagCloud = null;
        state.tagSuggestions = [];
        state.tagMeta = null;
        state.tagQuery = '';
        const tagFilter = root.querySelector('.wv-tagfilter');
        if (tagFilter) tagFilter.value = '';
        // Sorts are a per-provider vocabulary: keep the key only when the new
        // source knows it, else fall back to that source's default order.
        const known = source === 'datacat' ? DATACAT_SORTS
            : source === 'janny' ? JANNY_SORTS
                : source === 'janitor' ? JANITOR_SORTS
                    : SORT_LABELS;
        if (!known[state.sort]) {
            state.sort = source === 'datacat' ? 'fresh'
                : source === 'janny' ? 'newest'
                    : source === 'janitor' ? 'trending24'
                        : 'popular';
            settings().sort = state.sort;
            saveSettingsQuiet();
        }
    }
    // A pasted link persisted from the paste-to-import days is not a query for the
    // grid: drop it on entry so browsing starts from the source's own listing.
    const isPasteUrl = (source === 'janitor' && parseJanitorIdLocal(state.query))
        || (source === 'saucepan' && parseCompanionIdLocal(state.query));
    if (isPasteUrl) {
        state.query = '';
        settings().query = '';
        const box = root.querySelector('.wv-search');
        if (box) box.value = '';
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
                ledgerFail(ledgerItemFor('datacat', datacatCharacterId(data.metadata)), 'character', failureReason(error, error.status));
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
        // DataCat imports went unrecorded: the ledger only ever saw chub, janny,
        // saucepan and janitor, so "imported before" never warned for this source.
        ledgerAdd(ledgerItemFor('datacat', id, name), 'character');
        toastr.success(`Imported ${name}`, "Weaver's Vault");
    } finally {
        datacatBridge.active.delete(id);
    }
}

// ─── JanitorAI paste-to-import (S4) ──────────────────────────────────────────
// One URL in, one card out. The server reads /hampter/characters/{id} inside the
// signed-in browser session and classifies what it got, because on this site a
// card that hides its definition returns a complete-looking payload whose text
// fields are all null — importing that would create a blank card.

/** Why a card cannot be imported, in words a user can act on. */
function janitorBlockMessage(payload) {
    const reason = payload?.blockReason;
    if (reason === 'unproxyable') return 'This creator turned off the proxy, so JanitorAI will not serve this character to anyone.';
    if (reason === 'private') return 'This character is private.';
    if (reason === 'deleted') return 'This character was deleted.';
    if (reason === 'missing') return 'JanitorAI has no character with that id.';
    return 'JanitorAI hides this character\'s definition, so there is nothing to import yet.';
}

async function importJanitorUrl(url) {
    const status = root.querySelector('.wv-status');
    const id = parseJanitorIdLocal(url);
    if (!id) {
        ledgerFail(ledgerItemFor('janitor', url), 'blocked', 'bad-id');
        status.classList.add('wv-status-error');
        status.textContent = 'That is not a JanitorAI character link.';
        return;
    }
    status.classList.remove('wv-status-error');
    status.textContent = 'Reading JanitorAI…';
    try {
        const r = await fetch('/api/weavers-vault/janitor/card', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ id }),
        });
        const payload = await r.json().catch(() => null);
        if (!r.ok) throw vaultError(payload?.error || `JanitorAI answered ${r.status}`, payload?.code, r.status, payload?.reason);
        if (payload.needsCapture) {
            // Not an error: the card exists, its definition is closed. Saying so
            // is honest; importing it anyway would create a blank character.
            janitorCards.set(id, payload);
            // Not imported, and the ledger says so with the site's own reason.
            ledgerFail(ledgerItemFor('janitor', id, payload.row?.name ?? ''), 'blocked', payload.blockReason || 'no-definition');
            status.classList.add('wv-status-error');
            status.textContent = janitorBlockMessage(payload);
            const item = { id, fullPath: id, name: payload.row?.name ?? '', source: 'janitor' };
            openDetail(item, null, payload);
            return;
        }
        const character = payload.character;
        const item = {
            id,
            fullPath: id,
            name: character.data.name,
            avatarUrl: payload.avatarDataUrl,
            tags: character.data.tags ?? [],
            nsfw: Boolean(payload.row?.nsfw),
            source: 'janitor',
        };
        janitorFiles.set(id, payload.file);
        status.textContent = '';
        openDetail(item, character);
    } catch (error) {
        ledgerFail(ledgerItemFor('janitor', id), 'blocked', failureReason(error, error.status));
        status.classList.add('wv-status-error');
        status.textContent = error.message;
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
        ledgerFail(item, 'character', 'no-extract');
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
        ledgerFail(item, 'character', failureReason(error, error.status));
        toastr.error(error.message, "Weaver's Vault import failed");
    }
}

/**
 * JannyAI import. The PNG handed over by `/janny/card` already carries the vault
 * provenance (vault_source/vault_url/vault_full_path) inside its chara chunk, so
 * there is nothing to stamp afterwards — and stamping is exactly where imports
 * used to get blanked, so not touching the card again is the safer path.
 */
async function importJannyCharacter(item, character, route = '/janny/card', cache = jannyFiles) {
    let cardFile = cache.get(item.fullPath);
    if (!cardFile) {
        // Detail was opened before a reload, or the cache was cleared: rebuild it
        // from the same route rather than failing.
        try {
            const r = await fetch(`/api/weavers-vault${route}`, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: item.fullPath, name: item.name }),
            });
            const payload = await r.json();
            if (!r.ok) throw vaultError(payload?.error || `The source answered ${r.status}`, payload?.code, r.status, payload?.reason);
            cardFile = payload.file;
            cache.set(item.fullPath, cardFile);
            character = payload.character;
        } catch (error) {
            ledgerFail(item, 'character', failureReason(error, error.status));
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
        return importedAvatar;
    } catch (error) {
        console.error(`[${extensionName}] import failed`, error);
        ledgerFail(item, 'character', failureReason(error, error.status));
        toastr.error(error.message, "Weaver's Vault import failed");
        return null;
    }
}

/**
 * Import a JanitorAI character's lorebooks as World Info files (S8).
 *
 * Kept for the rebuild-sheet pass: the import workflow now pulls books through
 * the capture sheet instead, so nothing calls this from the Import button.
 *
 *
 * The server classifies each book. `public` books arrive already converted to a
 * characterBook, so they go through the same `convertCharacterBook` →
 * `saveWorldInfo` pair the chub path uses — SillyTavern's own entry template
 * stays the only definition of what an entry holds. `scripted` books need the
 * LLM rebuild and are never run silently (they spend the user's tokens), and a
 * `failed` book is reported with its measured reason, never as "private".
 *
 * The saved names land on the card as `vault_lorebooks` through
 * `stampVaultProvenance` (merge-attributes, PITFALLS #1); `world` links the first
 * one, because SillyTavern's linked-world field holds a single name.
 * @returns {Promise<string[]>} the World Info names that were saved
 */
async function importJanitorLorebooks(item, avatar) {
    let payload;
    try {
        const r = await fetch('/api/weavers-vault/janitor/lorebooks', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ id: item.fullPath, name: item.name }),
        });
        payload = await r.json();
        if (!r.ok) throw vaultError(payload?.error || `JanitorAI answered ${r.status}`, payload?.code, r.status, payload?.reason);
    } catch (error) {
        ledgerFail(item, 'lorebooks', failureReason(error, error.status));
        toastr.error(`Could not read the character's lorebooks: ${error.message}`, "Weaver's Vault lorebooks");
        return [];
    }

    const books = Array.isArray(payload.books) ? payload.books : [];
    const saved = [];
    // Scripted books cannot be saved from their payload: their lore only exists
    // as JavaScript. Collected here so the rebuild sheet can offer them once,
    // after the import, instead of one toast per book that goes nowhere.
    const scripted = [];
    for (const book of books) {
        if (book.kind === 'public' && book.book) {
            try {
                const worldInfo = convertCharacterBook(book.book);
                await saveWorldInfo(book.name, worldInfo, true);
                saved.push(book.name);
                ledgerAdd(item, 'lorebook');
                const count = Number(book.entryCount) || 0;
                toastr.success(`Lorebook '${book.name}' imported (${count} ${count === 1 ? 'entry' : 'entries'}).`, "Weaver's Vault");
            } catch (error) {
                ledgerAdd(item, 'lorebook', 'save-failed');
                toastr.error(`Lorebook '${book.name}' could not be saved: ${error.message}`, "Weaver's Vault");
            }
            continue;
        }
        const reason = book.reason || book.kind;
        ledgerAdd(item, 'lorebook', reason);
        if (book.kind === 'scripted') {
            if (book.jsSource) scripted.push(book);
            else toastr.warning(`'${book.name}' is scripted but its source could not be read, so it cannot be rebuilt.`, "Weaver's Vault lorebooks");
        } else if (book.kind === 'closed') {
            toastr.warning(reason === 'private'
                ? `'${book.title}' is private — the author has not published it, so it cannot be downloaded.`
                : `'${book.title}' has no entries to import.`, "Weaver's Vault lorebooks");
        } else {
            toastr.warning(`'${book.title}' could not be downloaded (${reason}).`, "Weaver's Vault lorebooks");
        }
    }

    if (saved.length) {
        await updateWorldInfoList();
        const stamped = await stampVaultProvenance(avatar, { world: saved[0], vault_lorebooks: saved });
        if (stamped) await getCharacters();
        else console.warn(`[${extensionName}] lorebooks saved but the card was not stamped with vault_lorebooks`);
    }
    if (scripted.length) {
        openRebuildSheet({
            item,
            avatar,
            card: characters.find(character => character.avatar === avatar) || null,
            books,
            scripted,
            saved,
        });
    }
    return saved;
}

// ─── Scripted-lorebook rebuild (docs/LOREBOOK-REBUILD-SPEC.md) ──────────────
// A scripted book is JavaScript, not entries: the site's "advanced" books build
// their lore in code, so the only way to a World Info is to ask a model to
// recover it. The request comes from lorebook-rebuild.js — the same planBuild()
// the preview renders — and NOTHING is sent until the user confirms the profile
// and model in the sheet. Silence here is the feature: an automatic rebuild
// would spend tokens on a profile the user never chose.

function rebuildConfig() {
    const store = settings();
    store.rebuild = readRebuildSettings(store.rebuild);
    return store.rebuild;
}

function saveRebuildConfig(patch) {
    Object.assign(rebuildConfig(), patch);
    saveSettingsQuiet();
}

// Sync on purpose: planBuild() must price a request before it is sent, and the
// async counter belongs to rendering, not to the plan.
function rebuildCountTokens() {
    return (text) => {
        try { return getTokenCount(String(text ?? ''), 0); }
        catch { return Math.ceil(String(text ?? '').length / 4); }
    };
}

/** Chat-completion profiles only: a text-completion or embedding profile cannot
 * answer a chat request, and offering it would be a trap. */
function rebuildProfiles() {
    try {
        return ConnectionManagerRequestService.getSupportedProfiles().filter(profile => {
            try {
                return ConnectionManagerRequestService.validateProfile(profile).selected === 'openai';
            } catch {
                return false;
            }
        });
    } catch {
        return [];
    }
}

/** Never overwrite a World Info file the user already has. */
function uniqueWorldName(base) {
    const name = String(base || 'Rebuilt lorebook').trim();
    if (!world_names.includes(name)) return name;
    const rebuilt = `${name} (rebuilt)`;
    if (!world_names.includes(rebuilt)) return rebuilt;
    for (let i = 2; i < 100; i += 1) {
        const candidate = `${name} (rebuilt ${i})`;
        if (!world_names.includes(candidate)) return candidate;
    }
    return `${name} (rebuilt ${Date.now()})`;
}

function rebuildBookLabel(book) {
    const title = String(book.title || book.name || 'Lorebook');
    const size = Number(book.jsSource?.length) || 0;
    return `${title} — ${size ? `${(size / 1000).toFixed(1)}k chars of source` : 'source missing'}`;
}

/**
 * The rebuild sheet: pick books, pick what context may help infer keys, pick the
 * profile, look at the plan — then, only on an explicit Build + confirm, send.
 * @param {{ item: object, avatar?: string, card?: object, books: object[],
 *   scripted: object[], saved: string[] }} options
 */
function openRebuildSheet({ item, avatar, card, books, scripted, saved }) {
    const config = rebuildConfig();
    const profiles = rebuildProfiles();
    let chosen;
    try {
        chosen = resolveRebuildProfile(profiles, config.profileId,
            extension_settings.connectionManager?.selectedProfile || '');
    } catch (error) {
        toastr.error(`${error.message} Add a chat-completion profile in Connection Manager first.`, "Weaver's Vault");
        return;
    }
    if (chosen.fellBack) {
        toastr.info(`The saved rebuild profile is gone (ID: ${chosen.staleId}) — using '${chosen.profile.name || chosen.profile.model}'.`,
            "Weaver's Vault");
    }

    const overlay = document.createElement('div');
    overlay.className = 'wv-mode-overlay';
    overlay.innerHTML = `
        <div class="wv-modesheet wv-rbsheet">
            <div class="wv-modehandle"></div>
            <div class="wv-modehead">Rebuild scripted lorebooks</div>
            <div class="wv-rbscroll">
                <div class="wv-rbhint">A scripted book is JavaScript, so its entries have to be recovered by a model.
                    One request per book, with no output cap. Nothing is sent until you press Build and confirm.</div>
                <div class="wv-rbsection">Books</div>
                <div class="wv-rbbooks">
                    ${scripted.map((book, i) => `
                        <label class="wv-rbbook">
                            <input type="checkbox" class="wv-rbbookbox" data-book="${i}" ${book.jsSource ? 'checked' : 'disabled'} />
                            <span class="wv-rbbooktext">${escapeHtml(rebuildBookLabel(book))}</span>
                        </label>`).join('')}
                </div>
                <div class="wv-rbsection">Context (never emitted as entries)</div>
                <div class="wv-rbtoggles">
                    <label class="wv-rbtoggle"><input type="checkbox" data-ctx="card" ${config.context.card ? 'checked' : ''} /> Character card</label>
                    <label class="wv-rbtoggle"><input type="checkbox" data-ctx="scenario" ${config.context.scenario ? 'checked' : ''} /> Scenario</label>
                    <label class="wv-rbtoggle"><input type="checkbox" data-ctx="lorebookDescs" ${config.context.lorebookDescs ? 'checked' : ''} /> Lorebook titles + descriptions</label>
                    <label class="wv-rbtoggle"><input type="checkbox" data-ctx="greetings" ${config.context.greetings ? 'checked' : ''} /> Greetings</label>
                    <label class="wv-rbtoggle wv-rboff"><input type="checkbox" data-ctx="catalog" disabled /> Catalog page (needs one extra site fetch)</label>
                </div>
                <input class="wv-tokeninput wv-rbextra" type="text" placeholder="Extra names or aliases you know (optional)"
                    value="${escapeHtml(config.extra)}" spellcheck="false" />
                <div class="wv-rbsection">Connection</div>
                <select class="wv-tokeninput wv-rbprofile">
                    ${profiles.map(profile => `<option value="${escapeHtml(profile.id)}" title="${escapeHtml(`${profile.name || profile.id} — ${profile.model || ''}`)}" ${profile.id === chosen.profile.id ? 'selected' : ''}>${escapeHtml(profile.name || profile.id)}</option>`).join('')}
                </select>
                <input class="wv-tokeninput wv-rbmodel" type="text" spellcheck="false"
                    placeholder="Model override (blank = the profile's model)" value="${escapeHtml(config.model)}" />
                <div class="wv-rbsummary">Choose books, then Preview.</div>
                <details class="wv-rbdetails" hidden>
                    <summary>Exact request</summary>
                    <pre class="wv-rbpre"></pre>
                </details>
                <div class="wv-rbstatus" aria-live="polite"></div>
            </div>
            <div class="wv-rbfoot">
                <button class="wv-abtn wv-abtn-neutral" type="button" data-rb="later"><span class="wv-abtnlabel">Later</span></button>
                <button class="wv-abtn wv-abtn-neutral" type="button" data-rb="preview"><span class="wv-abtnlabel">Preview</span></button>
                <button class="wv-abtn wv-abtn-primary" type="button" data-rb="build"><span class="wv-abtnlabel">Build</span></button>
            </div>
        </div>`;
    root.appendChild(overlay);

    const $ = (selector) => overlay.querySelector(selector);
    const boxes = [...overlay.querySelectorAll('.wv-rbbookbox')];
    const ctxBoxes = [...overlay.querySelectorAll('[data-ctx]')];
    const summary = $('.wv-rbsummary');
    const details = $('.wv-rbdetails');
    const pre = $('.wv-rbpre');
    const status = $('.wv-rbstatus');
    const buildButton = $('[data-rb="build"]');
    const profileSelect = $('.wv-rbprofile');
    const modelInput = $('.wv-rbmodel');

    // The dropdown fits profile names; the model is the expensive fact, so it is
    // spelled out on hover, in the field's placeholder, in the preview and in the
    // confirm. A native select clipped 'name — model' at 348px without an ellipsis.
    const selectedProfile = () => profiles.find(profile => profile.id === profileSelect.value) || chosen.profile;
    const syncModelHint = () => {
        modelInput.placeholder = `Model override — blank = ${selectedProfile().model || selectedProfile().name || 'the profile model'}`;
    };
    profileSelect.addEventListener('change', () => {
        syncModelHint();
        details.hidden = true;
        summary.textContent = 'Press Preview to price the request.';
    });
    syncModelHint();

    // Parts that already came back OK, so a failed part 14 does not re-bill 1-13
    // (§5.3). Keyed by profile + model + the exact messages, which means a
    // changed context or model simply misses instead of reusing stale text.
    const partCache = new Map();

    const toggles = () => Object.fromEntries(ctxBoxes.map(box => [box.dataset.ctx, box.checked]));
    const selectedBooks = () => boxes
        .filter(box => box.checked && !box.disabled)
        .map(box => scripted[Number(box.dataset.book)])
        .filter(book => book && book.jsSource);

    const planFor = (book) => {
        const context = contextFor({
            card,
            books,
            extra: $('.wv-rbextra').value,
            toggles: toggles(),
        });
        return planBuild({
            text: book.jsSource,
            fromJs: true,
            context,
            systemPrompt: config.systemJs,
            countTokens: rebuildCountTokens(),
        });
    };

    const describe = () => {
        const picked = selectedBooks();
        if (!picked.length) {
            summary.textContent = 'No book selected.';
            details.hidden = true;
            return null;
        }
        const count = rebuildCountTokens();
        const plans = picked.map(planFor);
        const requests = plans.reduce((sum, plan) => sum + plan.requests.length, 0);
        const tokens = plans.reduce((sum, plan) => sum
            + plan.requests.reduce((part, messages) => part + messages.reduce((n, m) => n + count(m.content), 0), 0), 0);
        summary.textContent = `${picked.length} book(s), ${requests} request(s), ~${tokens.toLocaleString()} prompt tokens, no output cap.`;
        const first = plans[0].requests[0];
        const clipped = first.map(message => ({
            role: message.role,
            content: message.content.length > 6000
                ? `${message.content.slice(0, 6000)}\n\n… (${message.content.length - 6000} more chars)`
                : message.content,
        }));
        pre.textContent = JSON.stringify({
            profile: selectedProfile().name || selectedProfile().id,
            model: modelInput.value.trim() || selectedProfile().model || 'profile default',
            max_tokens: 'omitted (boundless)',
            temperature: REQUEST_TEMPERATURE,
            messages: clipped,
        }, null, 2);
        details.hidden = false;
        return picked;
    };

    for (const box of [...boxes, ...ctxBoxes, $('.wv-rbextra')]) {
        box.addEventListener('change', () => { details.hidden = true; summary.textContent = 'Press Preview to price the request.'; });
    }

    $('[data-rb="later"]').addEventListener('click', () => overlay.remove());
    $('[data-rb="preview"]').addEventListener('click', describe);

    const setBusy = (busy, text = '') => {
        buildButton.disabled = busy;
        overlay.querySelector('[data-rb="preview"]').disabled = busy;
        overlay.querySelector('.wv-rbprofile').disabled = busy;
        overlay.querySelector('.wv-rbmodel').disabled = busy;
        status.textContent = text;
    };

    buildButton.addEventListener('click', async () => {
        const picked = describe();
        if (!picked) return;
        const profileId = profileSelect.value;
        const profile = selectedProfile();
        const model = modelInput.value.trim();
        const label = model || profile.model || profile.name;
        saveRebuildConfig({
            profileId,
            model,
            extra: $('.wv-rbextra').value,
            context: toggles(),
        });
        const requests = picked.reduce((sum, book) => sum + planFor(book).requests.length, 0);
        const go = confirm(`Build ${picked.length} lorebook(s) with ${requests} request(s)?\n\nProfile: ${profile.name || profile.id}\nModel: ${label}\nOutput cap: none.\n\nThis spends tokens on that account.`);
        if (!go) return;

        const savedNames = [];
        setBusy(true, 'Sending…');
        try {
            for (const book of picked) {
                const plan = planFor(book);
                const parts = [];
                const cacheKeys = plan.requests.map(messages => partCacheKey(
                    { profileId: profile.id, model: model || profile.model }, messages));
                for (let i = 0; i < plan.requests.length; i += 1) {
                    const messages = plan.requests[i];
                    const cached = partCache.get(cacheKeys[i]);
                    if (cached) {
                        parts.push(...cached);
                        status.textContent = `${book.title || book.name}: part ${i + 1} of ${plan.requests.length} already built.`;
                        continue;
                    }
                    status.textContent = `${book.title || book.name}: request ${i + 1} of ${plan.requests.length}…`;
                    const request = transportFor(messages);
                    const overridePayload = { temperature: request.temperature };
                    if (model) overridePayload.model = model;
                    const data = await ConnectionManagerRequestService.sendRequest(
                        profile.id,
                        request.messages,
                        request.maxTokens,
                        { stream: request.stream, includePreset: request.includePreset, includeInstruct: false },
                        overridePayload,
                    );
                    const parsed = parseReply(data?.content,
                        { part: i + 1, total: plan.requests.length, resumable: plan.requests.length > 1 });
                    parts.push(...parsed.entries);
                    partCache.set(cacheKeys[i], parsed.entries);
                    if (parsed.dropped) {
                        console.warn(`[${extensionName}] ${book.title || book.name}: dropped ${parsed.dropped} contentless entr${parsed.dropped === 1 ? 'y' : 'ies'}`);
                    }
                }
                const name = uniqueWorldName(book.title || book.name);
                const worldInfo = { entries: {} };
                for (const entry of parts) {
                    const created = createWorldInfoEntry(name, worldInfo);
                    if (!created) throw new Error('SillyTavern could not allocate a World Info entry.');
                    created.comment = entry.comment;
                    created.key = entry.key;
                    created.keysecondary = entry.keysecondary;
                    created.content = entry.content;
                    created.order = entry.order;
                    created.constant = entry.constant;
                }
                await saveWorldInfo(name, worldInfo, true);
                savedNames.push(name);
                ledgerAdd(item, 'lorebook');
                toastr.success(`Rebuilt '${name}' (${parts.length} ${parts.length === 1 ? 'entry' : 'entries'}).`, "Weaver's Vault");
            }
            await updateWorldInfoList();
            if (avatar) {
                const stamped = await stampVaultProvenance(avatar, { vault_lorebooks: [...saved, ...savedNames] });
                if (stamped) await getCharacters();
            }
            overlay.remove();
        } catch (error) {
            console.error(`[${extensionName}] rebuild failed`, error);
            const measurable = error instanceof RebuildError;
            setBusy(false, measurable && error.part
                ? `Failed at part ${error.part} of ${error.total} — '${error.message}'`
                : `Failed: ${error.message}`);
            if (measurable) {
                toastr.error(`${error.message}${error.resumable ? ' The sheet is still open; press Build to retry.' : ''}`,
                    "Weaver's Vault rebuild");
            } else {
                toastr.error(`${error.message}. Nothing was saved.`, "Weaver's Vault rebuild");
            }
        }
    });

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
    });
}
// ─── The capture sheet (Glaze janitor_lorebook_capture_sheet.dart) ──────────
//
// Four stages, derived rather than stored (:943-951): the character import,
// then collecting, then building, then saving. Collect is the only stage that
// talks to JanitorAI; build is the only one that spends the user's tokens;
// save is the only one that writes a book.

/**
 * @param {{ item: object, meta: ?object, character: ?object,
 *   characterImport: ?function }} options
 */
function openCaptureSheet({ item, meta = null, character = null, characterImport = null }) {
    const overlay = document.createElement('div');
    overlay.className = 'wv-mode-overlay';
    overlay.innerHTML =
        '<div class="wv-csheet" role="dialog" aria-label="Lorebooks">'
        + '<div class="wv-modehandle"></div>'
        + '<div class="wv-chead">'
        + '<button class="wv-cback" type="button" title="Back"><span class="fa-solid fa-chevron-left"></span></button>'
        + '<div class="wv-ctitle">Lorebooks</div>'
        + '<button class="wv-cclose" type="button" title="Close"><span class="fa-solid fa-xmark"></span></button>'
        + '</div>'
        + '<div class="wv-cstrip"></div>'
        + '<div class="wv-cbody">'
        + '<div class="wv-cstage-character wv-cempty" hidden>'
        + '<span class="wv-spinner"></span>'
        + '<div class="wv-cphasetitle">Importing the character</div>'
        + '<div class="wv-cphasehint">Lorebooks come next: once the character is in the library, you choose what to send to make their entries fire.</div>'
        + '<div class="wv-cphasestep"></div>'
        + '</div>'
        + '<div class="wv-cstage-collect" hidden>'
        + '<div class="wv-csection wv-cpublic" hidden>'
        + '<button class="wv-csechead" type="button" data-sec="public" title="Public lorebooks · <span class="wv-csecn"></span>"><span>Public lorebooks · <span class="wv-csecn"></span></span><span class="fa-solid fa-chevron-up wv-cchev"></span></button>'
        + '<div class="wv-csecbody" data-sec="public" hidden>'
        + '<div class="wv-cnote wv-cpubnote"></div>'
        + '<div class="wv-crows wv-cpubrows"></div>'
        + '<button class="wv-abtn wv-abtn-primary wv-cdownloadall" type="button" hidden><span class="wv-abtnlabel"></span></button>'
        + '</div>'
        + '</div>'
        + '<div class="wv-csection wv-cclosed" hidden>'
        + '<button class="wv-csechead" type="button" data-sec="closed"><span>Closed lorebooks · <span class="wv-cseccn"></span></span><span class="fa-solid fa-chevron-up wv-cchev"></span></button>'
        + '<div class="wv-csecbody" data-sec="closed" hidden>'
        + '<div class="wv-cnote wv-ccclosednote"></div>'
        + '<div class="wv-crows wv-ccclosedrows"></div>'
        + '</div>'
        + '</div>'
        + '<div class="wv-cnone" hidden>No lorebooks attached.</div>'
        + '<div class="wv-cimportcap" hidden>'
        + '<div class="wv-cnote wv-importcapnote"></div>'
        + '<button class="wv-abtn wv-abtn-neutral wv-useimport" type="button"><span class="wv-abtnlabel">Continue with entries from the import</span></button>'
        + '</div>'
        + '<button class="wv-abtn wv-abtn-primary wv-ccapture" type="button"><span class="wv-abtnlabel">Collect lorebook entries</span></button>'
        + '<div class="wv-cstatus wv-ccapturestatus" aria-live="polite"></div>'
        + '</div>'
        + '<div class="wv-cstage-build" hidden>'
        + '<div class="wv-cgroup">'
        + '<div class="wv-cgrouphead">Build with LLM</div>'
        + '<div class="wv-cnote wv-cextnote"></div>'
        + '<details class="wv-cdetails"><summary>Extracted content</summary><pre class="wv-cpre wv-cextpre"></pre></details>'
        + '<button class="wv-abtn wv-abtn-neutral wv-cdltext" type="button"><span class="wv-abtnlabel">Download extracted content as .txt</span></button>'
        + '</div>'
        + '<div class="wv-cgroup">'
        + '<div class="wv-cgrouphead">Context for key inference</div>'
        + '<div class="wv-cnote">Sent to the model so it can infer trigger keys — never written back as entries.</div>'
        + '<div class="wv-ctoggles wv-cbuildtoggles"></div>'
        + '<input class="wv-tokeninput wv-cbuildextra" type="text" placeholder="Extra names or aliases you know (optional)" spellcheck="false" />'
        + '</div>'
        + '<div class="wv-cactions">'
        + '<button class="wv-abtn wv-abtn-primary wv-cbuild" type="button"><span class="wv-abtnlabel">Build lorebook</span></button>'
        + '<button class="wv-abtn wv-abtn-neutral wv-cpreview" type="button"><span class="wv-abtnlabel">Preview prompt</span></button>'
        + '</div>'
        + '<div class="wv-cnote">Building a lorebook may take a while, please be patient.</div>'
        + '<div class="wv-cstatus wv-cbuildstatus" aria-live="polite"></div>'
        + '</div>'
        + '<div class="wv-cstage-save" hidden>'
        + '<div class="wv-cgroup">'
        + '<div class="wv-cgrouphead wv-cbuilt-head">Built 0 entries</div>'
        + '<label class="wv-cfield"><span>World info name</span><input class="wv-tokeninput wv-cname" type="text" spellcheck="false" /></label>'
        + '<div class="wv-cnote wv-cscope"></div>'
        + '<div class="wv-cactions">'
        + '<button class="wv-abtn wv-abtn-primary wv-csave" type="button"><span class="wv-abtnlabel">Save to library</span></button>'
        + '<button class="wv-abtn wv-abtn-neutral wv-cexport" type="button"><span class="wv-abtnlabel">Export .json</span></button>'
        + '<button class="wv-abtn wv-abtn-neutral wv-cdltext2" type="button"><span class="wv-abtnlabel">Download extracted content as .txt</span></button>'
        + '</div>'
        + '<div class="wv-cnote wv-ckeynote"></div>'
        + '<div class="wv-cstatus wv-csavestatus" aria-live="polite"></div>'
        + '</div>'
        + '</div>'
        + '</div>'
        + '</div>';
    root.appendChild(overlay);

    const $ = selector => overlay.querySelector(selector);
    const esc = value => escapeHtml(String(value ?? ''));
    const config = rebuildConfig();
    const profiles = rebuildProfiles();

    const state = {
        importing: Boolean(characterImport),
        character,
        avatar: null,
        books: [],
        loaded: false,
        loadError: '',
        downloaded: new Set(),
        converting: '',
        savingAll: false,
        savedAllDone: 0,
        importLore: '',
        captured: '',
        extracting: false,
        extractPhase: '',
        built: null,
        building: false,
        buildProgress: null,
        elapsed: 0,
        delivered: false,
        context: { ...config.context },
        extra: config.extra || '',
        name: '',
        partCache: new Map(),
        profileId: config.profileId,
        openSection: '',
    };

    const hasFlow = () => state.books.some(book => book.kind === 'closed') || Boolean(state.captured);
    const stage = () => captureStage({
        importing: state.importing,
        hasFlow: hasFlow(),
        built: Boolean(state.built),
        extracted: Boolean(state.captured),
    });
    const busy = () => state.extracting || state.building || state.savingAll || Boolean(state.converting);
    const keyOf = book => String(book.id ?? book.name ?? book.title ?? '');
    const closedBooks = () => state.books.filter(book => book.kind === 'closed');
    const jsonBooks = () => state.books.filter(book => book.kind === 'public' && book.book);
    const jsBooks = () => state.books.filter(book => book.kind === 'scripted' && book.jsSource);
    const downloadable = () => [...jsonBooks(), ...jsBooks()];

    const setStatus = (selector, text) => { const el = $(selector); if (el) el.textContent = text; };
    const captureCount = () => (state.captured ? state.captured.trim().split(/\n\s*\n/).length : 0);

    const worldInfoFor = (name, entries) => {
        const worldInfo = { entries: {} };
        for (const entry of entries) {
            const created = createWorldInfoEntry(name, worldInfo);
            if (!created) throw new Error('SillyTavern could not allocate a World Info entry.');
            created.comment = entry.comment;
            created.key = entry.key;
            created.keysecondary = entry.keysecondary;
            created.content = entry.content;
            created.order = entry.order;
            created.constant = entry.constant;
        }
        return worldInfo;
    };

    const markDelivered = () => { state.delivered = true; };

    const stamp = async (name) => {
        if (!state.avatar) return;
        try {
            // merge-attributes replaces an array wholesale, so the list is read
            // back and extended: a second book must not erase the first one's
            // provenance, and an existing linked world stays linked.
            const existing = characters.find(entry => entry.avatar === state.avatar)?.data?.extensions ?? {};
            const books = Array.isArray(existing.vault_lorebooks) ? existing.vault_lorebooks : [];
            const stamped = await stampVaultProvenance(state.avatar, {
                world: existing.world || name,
                vault_lorebooks: books.includes(name) ? books : [...books, name],
            });
            if (stamped) await getCharacters();
        } catch (error) {
            console.warn('[' + extensionName + '] lorebook saved but the card was not stamped: ' + error.message);
        }
    };

    const saveEntries = async (entries, name) => {
        const world = worldInfoFor(name, entries);
        await saveWorldInfo(name, world, true);
        await updateWorldInfoList();
        await stamp(name);
        ledgerAdd(item, 'lorebook');
        markDelivered();
        toastr.success('Saved \'' + name + '\' (' + entries.length + ' ' + (entries.length === 1 ? 'entry' : 'entries') + ').', "Weaver's Vault");
    };

    // The per-book destination sheet every public conversion ends in, the same
    // two rows Glaze offers (:614-643).
    const offerSave = (entries, defaultName) => {
        const sheet = document.createElement('div');
        sheet.className = 'wv-mode-overlay';
        sheet.innerHTML =
            '<div class="wv-modesheet">'
            + '<div class="wv-modehandle"></div>'
            + '<div class="wv-modehead">' + esc(defaultName) + '</div>'
            + '<div class="wv-modecard">'
            + '<button data-do="save"><span class="fa-solid fa-bookmark wv-modeicon"></span>'
            + '<span class="wv-modelabels"><span class="wv-modelabel">Save to library</span>'
            + '<span class="wv-modehint">Add to your World Info list</span></span></button>'
            + '<button data-do="export"><span class="fa-solid fa-download wv-modeicon"></span>'
            + '<span class="wv-modelabels"><span class="wv-modelabel">Export .json</span>'
            + '<span class="wv-modehint">SillyTavern world info</span></span></button>'
            + '</div>'
            + '</div>';
        root.appendChild(sheet);
        sheet.addEventListener('click', async event => {
            const action = event.target?.closest('button')?.dataset?.do;
            if (event.target === sheet) { sheet.remove(); return; }
            if (!action) return;
            sheet.remove();
            try {
                if (action === 'export') {
                    downloadTextFile(defaultName.replace(/[^\w\- ]+/g, '').trim() + '.json',
                        JSON.stringify(worldInfoFor(defaultName, entries), null, 2));
                    markDelivered();
                    toastr.success('Exported ' + defaultName + '.json', "Weaver's Vault");
                    return;
                }
                await saveEntries(entries, uniqueWorldName(defaultName));
                render();
            } catch (error) {
                toastr.error(error.message, "Weaver's Vault");
            }
        });
    };

    const describeKinds = (book) => {
        if (book.kind === 'scripted') return 'Scripted (advanced) · rebuilt with your LLM';
        if (book.kind === 'closed') return book.reason === 'private' ? 'Private · recovered from the prompt' : 'Closed · recovered from the prompt';
        const count = Number(book.entryCount) || 0;
        return count + ' ' + (count === 1 ? 'entry' : 'entries') + ' · downloads whole';
    };

    const rowHtml = (book) => {
        const key = keyOf(book);
        const done = state.downloaded.has(key);
        const publicBook = book.kind === 'public' || book.kind === 'scripted';
        const icon = book.kind === 'closed' ? 'fa-lock' : book.kind === 'scripted' ? 'fa-code' : 'fa-book';
        const action = book.kind === 'scripted' ? 'convert' : 'save';
        const label = state.converting === key ? 'Converting…' : 'Convert';
        return '<div class="wv-crow" data-key="' + esc(key) + '">'
            + '<span class="fa-solid ' + icon + ' wv-crowicon"></span>'
            + '<div class="wv-crowtext">'
            + '<div class="wv-crowtitle">' + esc(book.title || book.name || 'Lorebook') + '</div>'
            + '<div class="wv-crowsub">' + esc(describeKinds(book)) + '</div>'
            + (book.description ? '<div class="wv-crowdesc">' + esc(book.description) + '</div>' : '')
            + '</div>'
            + (done
                ? '<span class="fa-solid fa-check wv-crowdone" title="Saved or exported"></span>'
                : publicBook
                    ? '<button class="wv-crowbtn" type="button" data-act="' + action + '" data-key="' + esc(key) + '"'
                        + (busy() ? ' disabled' : '') + '>' + label + '</button>'
                    : '')
            + '</div>';
    };

    const renderStrip = () => {
        const current = stage();
        const stages = captureStages({ importing: state.importing });
        const strip = $('.wv-cstrip');
        strip.hidden = !state.importing && !hasFlow();
        strip.innerHTML = stages.map(entry =>
            '<span class="wv-cpill' + (entry.id === current ? ' on' : '') + '">' + esc(entry.label) + '</span>').join('');
        const back = $('.wv-cback');
        const step = captureBack({ stage: current, built: Boolean(state.built), busy: busy() });
        back.hidden = step === 'close';
        back.disabled = step === 'held';
        back.classList.toggle('wv-cbackheld', step === 'held');
    };

    const renderToggles = () => {
        const container = $('.wv-cbuildtoggles');
        const sources = [
            ['card', 'Character card'],
            ['scenario', 'Scenario'],
            ['lorebookDescs', 'Lorebook titles + descriptions'],
            ['greetings', 'Greetings'],
        ];
        container.innerHTML = sources.map(([key, label]) =>
            '<label class="wv-rbtoggle"><input type="checkbox" data-ctx="' + key + '"'
            + (state.context[key] ? ' checked' : '') + ' /> ' + esc(label) + '</label>').join('')
            + '<label class="wv-rbtoggle wv-rboff"><input type="checkbox" disabled /> Catalog page (needs one extra site fetch)</label>';
        container.querySelectorAll('[data-ctx]').forEach(box => {
            box.addEventListener('change', () => { state.context[box.dataset.ctx] = box.checked; });
        });
        $('.wv-cbuildextra').value = state.extra;
        $('.wv-cbuildextra').addEventListener('input', event => { state.extra = event.target.value; });
    };

    const render = () => {
        const current = stage();
        renderStrip();
        overlay.querySelectorAll('.wv-cstage-character').forEach(node => { node.hidden = current !== 'character'; });
        overlay.querySelectorAll('.wv-cstage-collect').forEach(node => { node.hidden = current !== 'collect'; });
        overlay.querySelectorAll('.wv-cstage-build').forEach(node => { node.hidden = current !== 'build'; });
        overlay.querySelectorAll('.wv-cstage-save').forEach(node => { node.hidden = current !== 'save'; });

        // ── collect ───────────────────────────────────────────────────────────
        const pub = [...jsonBooks(), ...jsBooks()];
        const closed = closedBooks();
        $('.wv-cpublic').hidden = !pub.length;
        $('.wv-cclosed').hidden = !closed.length;
        $('.wv-cnone').hidden = pub.length + closed.length > 0 || !state.loaded;
        if (state.loadError) $('.wv-cnone').textContent = state.loadError;
        overlay.querySelectorAll('.wv-cpublic .wv-csecn').forEach(node => { node.textContent = String(pub.length); });
        overlay.querySelectorAll('.wv-cclosed .wv-cseccn').forEach(node => { node.textContent = String(closed.length); });
        if (pub.length) {
            const jsonCount = jsonBooks().length;
            const jsCount = jsBooks().length;
            const notes = ['Public, downloaded whole from Janitor.AI — no extraction needed.'];
            if (jsCount) notes.push('Scripted (advanced) books are shipped as a script, so they are rebuilt into entries with your active LLM.');
            if (closed.length) notes.push('Their entries are automatically removed from the extracted closed lorebook below.');
            $('.wv-cpubnote').textContent = notes.join(' ');
            $('.wv-cpubrows').innerHTML = pub.map(rowHtml).join('');
            const all = $('.wv-cdownloadall');
            all.hidden = pub.length < 2;
            all.disabled = busy();
            all.querySelector('.wv-abtnlabel').textContent = state.savingAll
                ? 'Saving ' + state.savedAllDone + '/' + pub.length + '…'
                : 'Download all (' + pub.length + ')';
        }
        if (closed.length) {
            $('.wv-ccclosednote').textContent = closed.length > 1
                ? 'This character has ' + closed.length + ' closed lorebooks which need to be extracted. They will be merged into a single lorebook due to limitations of the extraction method.'
                : 'This lorebook is closed. It can only be recovered by capturing the assembled prompt through your Janitor.AI session and rebuilding it into keyed entries with your active LLM.';
            $('.wv-ccclosedrows').innerHTML = closed.map(rowHtml).join('');
        }
        const captureButton = $('.wv-ccapture');
        captureButton.disabled = busy() || !closed.length;
        captureButton.querySelector('.wv-abtnlabel').textContent = state.extracting
            ? (state.extractPhase || 'Collecting entries…')
            : 'Collect lorebook entries';
        const importCap = $('.wv-cimportcap');
        importCap.hidden = !state.importLore || Boolean(state.captured);
        if (!importCap.hidden) {
            $('.wv-importcapnote').textContent = 'The character import already collected entries with the default context ('
                + state.importLore.trim().split(/\n\s*\n/).length
                + ' blocks). Continue with those, or collect again.';
        }

        // ── build ─────────────────────────────────────────────────────────────
        if (current === 'build') {
            const text = state.captured;
            $('.wv-cextnote').textContent = text.trim()
                ? 'Extracted content · ' + text.trim().split(/\n\s*\n/).length + ' blocks'
                : 'No closed lorebook text was found.';
            $('.wv-cextpre').textContent = text;
            $('.wv-cdltext').hidden = !text.trim();
            $('.wv-cbuild').disabled = state.building || !text.trim();
            $('.wv-cpreview').disabled = state.building || !text.trim();
            $('.wv-cbuild').querySelector('.wv-abtnlabel').textContent = state.building
                ? (state.buildProgress
                    ? 'Building… part ' + Math.min(state.buildProgress[0] + 1, state.buildProgress[1]) + ' of ' + state.buildProgress[1] + ' · ' + state.elapsed + 's'
                    : 'Building… ' + state.elapsed + 's')
                : 'Build lorebook';
            if (!overlay.querySelector('.wv-cbuildtoggles').childElementCount) renderToggles();
        }

        // ── save ──────────────────────────────────────────────────────────────
        if (current === 'save' && state.built) {
            $('.wv-cbuilt-head').textContent = 'Built ' + state.built.entries.length + ' ' + (state.built.entries.length === 1 ? 'entry' : 'entries');
            const nameInput = $('.wv-cname');
            if (document.activeElement !== nameInput) nameInput.value = state.name || state.built.name;
            nameInput.placeholder = state.built.name;
            $('.wv-cscope').textContent = state.character
                ? 'Saved for ' + (state.character.data?.name || 'this character') + ': the book is attached to the card, not switched on globally.'
                : 'Saved standalone and switched off: no character was imported, so there is nothing to attach it to.';
            $('.wv-ckeynote').textContent = state.built.entries.length
                ? 'Keys were inferred by ' + (state.built.model || 'the build model') + '.'
                : '';
        }
    };

    // ── data ──────────────────────────────────────────────────────────────────
    const loadBooks = async () => {
        try {
            const r = await fetch('/api/weavers-vault/janitor/lorebooks', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: item.fullPath, name: item.name }),
            });
            const payload = await r.json().catch(() => ({}));
            if (!r.ok) throw vaultError(payload?.error || 'JanitorAI answered ' + r.status, payload?.code, r.status, payload?.reason);
            state.books = Array.isArray(payload.books) ? payload.books : [];
            if (!state.character && payload.characterName) {
                state.character = { data: { name: payload.characterName, description: '', scenario: '', first_mes: '', alternate_greetings: [] } };
            }
        } catch (error) {
            state.loadError = 'Could not read the lorebooks: ' + error.message;
        } finally {
            state.loaded = true;
            render();
        }
    };

    // ── public books ──────────────────────────────────────────────────────────
    const bookByKey = key => state.books.find(book => keyOf(book) === key);

    const savePublicBook = async (book) => {
        const name = uniqueWorldName(book.name || book.title || 'Lorebook');
        const worldInfo = convertCharacterBook(book.book);
        await saveWorldInfo(name, worldInfo, true);
        await updateWorldInfoList();
        state.downloaded.add(keyOf(book));
        markDelivered();
        ledgerAdd(item, 'lorebook');
        await stamp(name);
        toastr.success('Lorebook \'' + name + '\' imported (' + (Number(book.entryCount) || 0) + ' entries).', "Weaver's Vault lorebooks");
    };

    const downloadAll = async () => {
        const list = downloadable();
        if (!list.length || busy()) return;
        state.savingAll = true;
        state.savedAllDone = 0;
        render();
        const failed = [];
        for (const book of list) {
            try {
                if (book.kind === 'scripted') await convertScript(book);
                else await savePublicBook(book);
                state.savedAllDone += 1;
            } catch (error) {
                failed.push(book.title || book.name || 'lorebook');
                console.warn('[' + extensionName + '] lorebook download failed: ' + error.message);
            }
            render();
        }
        state.savingAll = false;
        render();
        if (failed.length) toastr.warning('Saved ' + state.savedAllDone + ' of ' + list.length + ' — failed: ' + failed.join(', '), "Weaver's Vault lorebooks");
        else toastr.success('Saved ' + state.savedAllDone + ' lorebooks', "Weaver's Vault lorebooks");
    };

    const modelCall = async (plan, onPart) => {
        const parts = [];
        const profile = profiles.find(entry => entry.id === state.profileId) || profiles[0];
        if (!profile) throw new Error('No active LLM connection. Add one in Settings → API and select it before building a lorebook.');
        for (let i = 0; i < plan.requests.length; i += 1) {
            const messages = plan.requests[i];
            const key = partCacheKey({ profileId: profile.id, model: config.model || profile.model }, messages);
            const cached = state.partCache.get(key);
            if (cached) { parts.push(...cached); continue; }
            onPart(i, plan.requests.length);
            const request = transportFor(messages);
            const overridePayload = { temperature: request.temperature };
            if (config.model) overridePayload.model = config.model;
            const data = await ConnectionManagerRequestService.sendRequest(
                profile.id,
                request.messages,
                request.maxTokens,
                { stream: request.stream, includePreset: request.includePreset, includeInstruct: false },
                overridePayload,
            );
            const parsed = parseReply(data?.content, { part: i + 1, total: plan.requests.length, resumable: plan.requests.length > 1 });
            parts.push(...parsed.entries);
            state.partCache.set(key, parsed.entries);
        }
        return parts;
    };

    const contextNow = () => contextFor({
        card: state.character,
        books: state.books,
        extra: state.extra,
        toggles: state.context,
    });

    const planFor = (text, fromJs) => planBuild({
        text,
        fromJs,
        context: contextNow(),
        systemPrompt: fromJs ? config.systemJs : config.systemText,
        countTokens: rebuildCountTokens(),
    });

    const convertScript = async (book) => {
        if (state.converting) return;
        if (book.jsSource === undefined) throw new Error('The script source could not be read.');
        const plan = planFor(book.jsSource, true);
        const go = confirm('Rebuild \'' + (book.title || book.name) + '\' with your active LLM?\n\n'
            + plan.requests.length + ' request(s). Output cap: none.\n\nThis spends tokens on that account.');
        if (!go) return;
        state.converting = keyOf(book);
        render();
        try {
            const entries = await modelCall(plan, (done, total) => {
                setStatus('.wv-ccapturestatus', (book.title || book.name) + ': part ' + (done + 1) + ' of ' + total + '…');
            });
            state.downloaded.add(keyOf(book));
            setStatus('.wv-ccapturestatus', '');
            offerSave(entries, book.name || book.title || 'Scripted lorebook');
        } finally {
            state.converting = '';
            render();
        }
    };

    // ── capture ───────────────────────────────────────────────────────────────
    const capture = async () => {
        if (state.extracting || !closedBooks().length) return;
        state.extracting = true;
        state.extractPhase = 'Collecting entries…';
        render();
        try {
            const payload = await captureJanitorLore(item, phase => {
                state.extractPhase = phase;
                render();
            });
            const raw = String(payload.lorebookText ?? '');
            // Public entries are injected verbatim into the same prompt, so they
            // are cut back out rather than rebuilt as closed content.
            const contents = publicEntryContents(jsonBooks());
            state.captured = withoutPublicEntries(raw, contents);
            if (!state.avatar && payload.file) state.avatar = null;
            if (!state.character && payload.character) state.character = payload.character;
            if (!state.name) state.name = (state.character?.data?.name || item.name || 'Character') + ' — Closed Lorebook';
            if (!state.captured.trim()) toastr.warning('The capture recovered no closed lorebook text.', "Weaver's Vault lorebooks");
        } catch (error) {
            setStatus('.wv-ccapturestatus', error.message);
            toastr.error(error.message, "Weaver's Vault capture failed");
            ledgerFail(item, 'capture', failureReason(error, error.status));
        } finally {
            state.extracting = false;
            state.extractPhase = '';
            render();
        }
    };

    // ── build ─────────────────────────────────────────────────────────────────
    const build = async () => {
        if (state.building || !state.captured.trim()) return;
        const plan = planFor(state.captured, false);
        const name = (state.name || ((state.character?.data?.name || item.name || 'Character') + ' — Closed Lorebook')).trim();
        const go = confirm('Build \'' + name + '\' with your active LLM?\n\n'
            + plan.requests.length + ' request(s), no output cap.\n\nThis spends tokens on that account.');
        if (!go) return;
        state.building = true;
        state.elapsed = 0;
        state.buildProgress = null;
        render();
        const timer = setInterval(() => { state.elapsed += 1; render(); }, 1_000);
        try {
            const entries = await modelCall(plan, (done, total) => {
                state.buildProgress = total > 1 ? [done, total] : null;
                render();
            });
            state.built = { name, entries, model: config.model || (profiles.find(entry => entry.id === state.profileId) || profiles[0])?.model || '' };
            state.name = name;
        } catch (error) {
            console.error('[' + extensionName + '] lorebook build failed', error);
            const measurable = error instanceof RebuildError;
            setStatus('.wv-cbuildstatus', measurable && error.part
                ? 'Failed at part ' + error.part + ' of ' + error.total + ' — ' + error.message
                : 'Failed: ' + error.message);
            toastr.error(error.message + (error.resumable ? ' The sheet is still open; press Build to retry.' : '. Nothing was saved.'), "Weaver's Vault rebuild");
        } finally {
            clearInterval(timer);
            state.building = false;
            state.buildProgress = null;
            render();
        }
    };

    // ── save ──────────────────────────────────────────────────────────────────
    const currentName = () => {
        const typed = $('.wv-cname')?.value.trim();
        return typed || state.built?.name || 'Lorebook';
    };

    const save = async () => {
        if (!state.built) return;
        const name = uniqueWorldName(currentName());
        try {
            await saveEntries(state.built.entries, name);
            toastr.success('Saved \'' + name + '\'', "Weaver's Vault");
            render();
        } catch (error) {
            setStatus('.wv-csavestatus', 'Save failed: ' + error.message);
            toastr.error(error.message, "Weaver's Vault");
        }
    };

    const exportJson = () => {
        if (!state.built) return;
        try {
            const name = currentName();
            downloadTextFile(name.replace(/[^\w\- ]+/g, '').trim() + '.json',
                JSON.stringify(worldInfoFor(name, state.built.entries), null, 2));
            markDelivered();
            toastr.success('Exported ' + name + '.json', "Weaver's Vault");
            render();
        } catch (error) {
            setStatus('.wv-csavestatus', 'Export failed: ' + error.message);
        }
    };

    // ── chrome ────────────────────────────────────────────────────────────────
    const close = () => {
        if (busy()) return;
        if (captureConfirmClose({ delivered: state.delivered, work: Boolean(state.captured || state.built) })) {
            const go = confirm("The lorebook hasn't been saved or exported yet. Closing now discards the extraction progress.");
            if (!go) return;
        }
        overlay.remove();
    };

    const goBack = () => {
        const step = captureBack({ stage: stage(), built: Boolean(state.built), busy: busy() });
        if (step === 'held' || step === 'close') return;
        if (step === 'build') { state.built = null; render(); return; }
        // build -> collect drops the capture and everything derived from it.
        state.captured = '';
        state.built = null;
        state.buildProgress = null;
        render();
    };

    $('.wv-cclose').addEventListener('click', close);
    $('.wv-cback').addEventListener('click', goBack);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelectorAll('.wv-csechead').forEach(head => head.addEventListener('click', () => {
        const body = overlay.querySelector('.wv-csecbody[data-sec="' + head.dataset.sec + '"]');
        if (!body) return;
        body.hidden = !body.hidden;
        head.classList.toggle('on', !body.hidden);
    }));
    $('.wv-ccapture').addEventListener('click', capture);
    $('.wv-useimport').addEventListener('click', () => {
        state.captured = state.importLore;
        if (!state.name) state.name = (state.character?.data?.name || item.name || 'Character') + ' — Closed Lorebook';
        render();
    });
    $('.wv-cbuild').addEventListener('click', build);
    $('.wv-cpreview').addEventListener('click', () => {
        const plan = planFor(state.captured, false);
        const sheet = document.createElement('div');
        sheet.className = 'wv-mode-overlay';
        const first = plan.requests[0] || [];
        sheet.innerHTML = '<div class="wv-csheet wv-cpreviewsheet"><div class="wv-modehandle"></div>'
            + '<div class="wv-modehead">Prompt sent to the build LLM</div>'
            + '<div class="wv-cnote">' + (plan.requests.length > 1
                ? 'The extracted content is too long for one request, so the build sends ' + plan.requests.length + ' requests one after another. Shown here is the first one.'
                : '') + '</div>'
            + '<pre class="wv-cpre wv-cpreviewpre">' + esc(first.map(message => '[' + message.role + ']\n' + message.content).join('\n\n')) + '</pre>'
            + '<div class="wv-cactions"><button class="wv-abtn wv-abtn-neutral wv-cpreviewclose" type="button"><span class="wv-abtnlabel">Close</span></button></div></div>';
        root.appendChild(sheet);
        sheet.querySelector('.wv-cpreviewclose').addEventListener('click', () => sheet.remove());
        sheet.addEventListener('click', event => { if (event.target === sheet) sheet.remove(); });
    });
    $('.wv-csave').addEventListener('click', save);
    $('.wv-cexport').addEventListener('click', exportJson);
    $('.wv-cdltext').addEventListener('click', () => downloadTextFile('extracted-lorebook.txt', state.captured, 'text/plain'));
    $('.wv-cdltext2').addEventListener('click', () => downloadTextFile('extracted-lorebook.txt', state.captured, 'text/plain'));
    $('.wv-cdownloadall').addEventListener('click', downloadAll);
    $('.wv-cpubrows').addEventListener('click', async event => {
        const button = event.target?.closest('[data-act]');
        if (!button) return;
        const book = bookByKey(button.dataset.key);
        if (!book) return;
        try {
            if (button.dataset.act === 'convert') await convertScript(book);
            else await savePublicBook(book);
            render();
        } catch (error) {
            toastr.error(error.message, "Weaver's Vault lorebooks");
        }
    });

    render();
    if (state.importing) {
        (async () => {
            try {
                const result = await characterImport({ onPhase: phase => {
                    const step = $('.wv-cphasestep');
                    if (step) step.textContent = phase;
                } });
                if (result) {
                    state.avatar = result.avatar || null;
                    state.character = result.character || state.character;
                    if (result.loreText) state.importLore = String(result.loreText);
                }
            } catch (error) {
                toastr.error(error.message, "Weaver's Vault import failed");
            } finally {
                state.importing = false;
                render();
            }
        })();
    }
    loadBooks();
}

// ─── The import workflow (Glaze character_detail_screen.dart:651-698) ────────
//
// One Import button, one conditional sheet. The options exist only when the
// character actually lists lorebooks, and the capture sheet behind them is the
// only place a lorebook is pulled: a plain import never attaches books, and a
// closed book is never offered as something that can be downloaded.

/**
 * The options sheet: three rows, each a whole mode.
 * @param {{ item: object, character: ?object, source: 'chub'|'janitor',
 *   meta?: ?object, popup?: ?HTMLElement, fab?: ?HTMLElement, status?: ?HTMLElement,
 *   closed?: boolean, bookCount?: number }} options
 */
function showImportOptions({ item, character = null, source, meta = null, popup = null, fab = null, status = null, closed = false, bookCount = 1 }) {
    const overlay = document.createElement('div');
    overlay.className = 'wv-mode-overlay';
    const rows = importOptions({ bookCount }).map(option =>
        '<button data-mode="' + option.mode + '">'
        + '<span class="fa-solid ' + option.icon + ' wv-modeicon"></span>'
        + '<span class="wv-modelabels"><span class="wv-modelabel">' + escapeHtml(option.label) + '</span>'
        + '<span class="wv-modehint">' + escapeHtml(option.hint) + '</span></span>'
        + '</button>').join('');
    overlay.innerHTML =
        '<div class="wv-modesheet">'
        + '<div class="wv-modehandle"></div>'
        + '<div class="wv-modehead">Import options</div>'
        + '<div class="wv-modecard">' + rows + '</div>'
        + '</div>';
    root.appendChild(overlay);

    const finishChub = (mode) => {
        const detail = root.querySelector('.wv-detail');
        if (detail) detail.hidden = true;
        if (mode === 'lorebooks') importChubLorebookOnly(item, character);
        else importChubCharacter(item, character, mode === 'character+lorebooks');
    };

    const importJanitorCharacter = async ({ onPhase = () => {} } = {}) => {
        if (!closed) {
            const avatar = await importJannyCharacter(item, character, '/janitor/card', janitorFiles);
            return { avatar, character, loreText: null };
        }
        // A closed definition IS the capture: the same run that assembles the
        // prompt returns both the card and the lorebook text, so it is never
        // run twice for one import.
        const payload = await captureJanitorLore(item, onPhase);
        const avatar = await importJannyCharacter(item, payload.character, '/janitor/capture',
            new Map([[item.fullPath, payload.file]]));
        return { avatar, character: payload.character, loreText: payload.lorebookText ?? null };
    };

    overlay.addEventListener('click', async event => {
        const mode = event.target?.closest('button')?.dataset?.mode;
        if (event.target === overlay) { overlay.remove(); return; }
        if (!mode) return;
        overlay.remove();
        if (source === 'chub') { finishChub(mode); return; }
        if (mode === 'lorebooks') {
            openCaptureSheet({ item, meta, character: null });
            return;
        }
        if (mode === 'character+lorebooks') {
            openCaptureSheet({ item, meta, character, characterImport: importJanitorCharacter });
            return;
        }
        if (closed) { await recoverJanitorCard(item, popup, fab, status); return; }
        await importJannyCharacter(item, character, '/janitor/card', janitorFiles);
    });
}

/**
 * The button's whole job: import the character, and pull lorebooks only when
 * the user asked to. No books attached means no sheet at all.
 */
function openImportFlow({ item, character, popup, closed = false, report = null }) {
    if (item.source === 'saucepan') { importSaucepanCharacter(item, character); return; }
    if (item.source === 'janny') { importJannyCharacter(item, character); return; }
    if (item.source === 'chub') {
        const book = character?.data?.character_book;
        if (book) {
            showImportOptions({ item, character, source: 'chub', bookCount: 1 });
        } else {
            importChubCharacter(item, character, false);
        }
        return;
    }
    const meta = report?.meta ?? null;
    const status = popup.querySelector('.wv-recoverstatus');
    const fab = popup.querySelector('.wv-dfab');
    const refs = lorebookRefs(meta);
    if (!refs.length) {
        // Nothing to ask about: the plain import, which for a closed card is
        // the capture that recovers its definition.
        if (closed) recoverJanitorCard(item, popup, fab, status);
        else importJannyCharacter(item, character, '/janitor/card', janitorFiles);
        return;
    }
    showImportOptions({
        item,
        character,
        source: 'janitor',
        meta,
        popup,
        fab,
        status,
        closed,
        bookCount: refs.length,
    });
}

/** One JanitorAI capture, with the raw lorebook text the rebuild needs. */
async function captureJanitorLore(item, onPhase = () => {}) {
    const started = Date.now();
    const timer = setInterval(() => {
        onPhase('Capturing the prompt… ' + Math.round((Date.now() - started) / 1000) + 's');
    }, 1_000);
    try {
        const r = await fetch('/api/weavers-vault/janitor/capture', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ id: item.fullPath, lore: true }),
        });
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
            throw vaultError(payload?.error || 'The capture answered ' + r.status,
                payload?.code, r.status, payload?.reason);
        }
        return payload;
    } finally {
        clearInterval(timer);
    }
}

/** Writes [text] as a download without a server round trip. */
function downloadTextFile(filename, text, type = 'application/json') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** A JanitorAI import: the card, then whichever of its books can be had. */
async function importJanitorCard(item, character) {
    const avatar = await importJannyCharacter(item, character, '/janitor/card', janitorFiles);
    if (avatar) await importJanitorLorebooks(item, avatar);
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
        ledgerFail(item, 'character', failureReason(error, error.status));
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
        ledgerFail(item, 'lorebook', failureReason(error, error.status));
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
