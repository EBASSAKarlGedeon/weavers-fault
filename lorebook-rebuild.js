// Weaver's Vault — lorebook rebuild core.
//
// Pure: no imports, no DOM, no network. `index.js` owns the dialog and the model
// call; this file owns the parts that must not drift from Glaze:
//   * the two system prompts (janitor_lorebook_rebuilder.dart:28-81),
//   * the CONTEXT block intros and their order (:344-364),
//   * the chunk budget and split (:161-242),
//   * the tolerant reply parser (:377-441).
// Ported from Glaze (AGPL-3.0, github.com/hydall/Glaze); keep the line references
// when editing so the port can be re-checked.

/** System prompt for concatenated lorebook text (:28). Blank override => this. */
export const TEXT_SYSTEM_PROMPT = `You reconstruct a SillyTavern World Info (lorebook) from raw text.

You are given text extracted from an LLM chat prompt: one or more lorebook entries a
roleplay platform injected because their trigger keywords matched. The character card and
user persona have already been removed; what remains is lorebook entry bodies concatenated
together (often separated by blank lines). You may also be given the character card and a
catalog/world description as CONTEXT — use those ONLY to infer better keys, never output
them as entries.

Your job:
1. Split the text into discrete, self-contained World Info entries. Each coherent block
   about one topic (a person, place, faction, item, rule, lore fact) is one entry. Do NOT
   merge unrelated topics; do NOT split a single topic across entries.
2. For each entry write:
   - "content": the entry body, faithful to the source.
   - "key": array of primary trigger keywords/phrases (names, aliases, places, distinctive
     nouns), inferred from the content and the provided context.
   - "keysecondary": optional array of secondary keywords (else []).
   - "comment": a short title (the topic name).
   - "order": optional integer insertion order; default 100.
3. Output ONLY a JSON object:
   { "entries": [ { "comment": "...", "key": ["..."], "keysecondary": [], "content": "...", "order": 100 }, ... ] }
No markdown, no prose, no code fences — JSON only.`;

/** System prompt for JavaScript source (:56): recover entries, do not split bodies. */
export const JS_SYSTEM_PROMPT = `You reconstruct a SillyTavern World Info (lorebook) from JavaScript source.

You are given the JavaScript source of a JanitorAI "advanced" / Nine API lorebook script. It
typically defines an array of lore entries (often \`const loreEntries = [ ... ]\`), where each
entry is an object with fields such as \`keywords\`/\`keys\`/\`keysRaw\`, \`content\`, \`personality\`,
\`scenario\`, \`name\`/\`title\`/\`category\`, \`constant\`, \`priority\`/\`insertion_order\`, and an
optional \`filters.notWith\` (secondary "not with" keywords). Some scripts assemble entries
with code; recover the resulting lore regardless.

You may also be given the character card and a catalog/world description as CONTEXT — use
those ONLY to infer better keys, never output them as entries.

Your job:
1. Recover every distinct lore entry the script defines. Do NOT invent entries the script
   does not contain; do NOT merge unrelated entries or split a single entry.
2. For each entry write:
   - "content": the entry body. If an entry has no \`content\` but has \`personality\` and/or
     \`scenario\`, combine those into the content.
   - "key": array of primary trigger keywords (from \`keywords\`/\`keys\`/\`keysRaw\`).
   - "keysecondary": secondary keywords (e.g. from \`filters.notWith\`), else [].
   - "comment": a short title (from \`name\`/\`title\`/\`category\`).
   - "order": optional integer insertion order (from \`priority\`/\`insertion_order\`); default 100.
3. Output ONLY a JSON object:
   { "entries": [ { "comment": "...", "key": ["..."], "keysecondary": [], "content": "...", "order": 100 }, ... ] }
No markdown, no prose, no code fences — JSON only.`;

// The six context blocks, verbatim and in Glaze's order (:349-360). Their text
// says, for each kind, what may be inferred from it and that it must never be
// emitted as an entry — that sentence is the whole reason keys improve without
// the card leaking into the book.
export const CONTEXT_BLOCKS = [
    {
        key: 'card',
        intro: 'CONTEXT — the character card these entries accompany. Use it ONLY to infer better trigger keys and resolve names/aliases. Do NOT output any of this card text as entries:',
    },
    {
        key: 'catalog',
        intro: 'CONTEXT — the public catalog description for this character as shown on the site (setting, place and faction names). Use it ONLY to infer better trigger keys. Do NOT output any of this as entries:',
    },
    {
        key: 'scenario',
        intro: 'CONTEXT — the scenario / setup for this roleplay. Use it ONLY to infer better trigger keys (names, places, situations). Do NOT output any of this as entries:',
    },
    {
        key: 'greetings',
        intro: "CONTEXT — the character's opening message(s) / greeting(s). Use them ONLY to infer better trigger keys (names, places, items mentioned). Do NOT output any of this as entries:",
    },
    {
        key: 'lorebookDescs',
        intro: 'CONTEXT — the public descriptions of lorebooks attached to this character (titles and descriptions only — the lorebook contents themselves are NOT included here). Use it ONLY to infer better trigger keys. Do NOT output any of this as entries:',
    },
    {
        key: 'extra',
        intro: 'CONTEXT — additional notes provided by the user (names, aliases, setting details). Use it ONLY to infer better trigger keys. Do NOT output any of this as entries:',
    },
];

/** Default chunk size in tokens (:19, kDefaultLorebookBuildChunkTokens). */
export const DEFAULT_CHUNK_TOKENS = 24000;
/** Floor under the chunk budget (:164): a tiny window must not shred the text. */
export const MIN_CHUNK_TOKENS = 2000;
/** Glaze sends 0.2 for this task; a rebuild is mechanical, not creative (:579). */
export const REQUEST_TEMPERATURE = 0.2;

/**
 * Sentinel for "do not send `max_tokens` at all".
 *
 * Glaze passes `maxTokens: 0` to a transport that then omits the field (:573-578)
 * because `max_tokens` bounds reasoning + content TOGETHER: any finite cap can be
 * spent entirely on the thinking stream, leaving `content` empty before the model
 * emits a single brace of the JSON. Our transport's `createRequestData()` deletes
 * undefined values (custom-request.js:444-449), so `undefined` here means the field
 * never reaches the provider.
 */
export const BOUNDLESS_MAX_TOKENS = undefined;

/**
 * Cheap fallback token estimate, used only when the caller has no tokenizer.
 * Four characters per token is SillyTavern's own heuristic for mixed prose; it is
 * good enough for a budget and never used for a number shown as exact.
 * @param {string} text
 * @returns {number}
 */
export function defaultCountTokens(text) {
    return Math.ceil(String(text ?? '').length / 4);
}

/**
 * How much lorebook text one request may carry: the user's setting, clamped to
 * half of what is left of the window once the repeated context is paid for, and
 * never below MIN_CHUNK_TOKENS (:171-185).
 * @param {{ chunkTokens?: number, window?: number, fixedTokens?: number }} [options]
 * @returns {number}
 */
export function chunkBudget({ chunkTokens = DEFAULT_CHUNK_TOKENS, window = 0, fixedTokens = 0 } = {}) {
    const setting = Number(chunkTokens);
    let budget = Number.isFinite(setting) ? setting : DEFAULT_CHUNK_TOKENS;
    const size = Number(window);
    // window 0/unknown: no clamp, exactly like Glaze with a connection of unknown
    // context size. `/2` because prompt and reply share it (:166-170).
    if (Number.isFinite(size) && size > 0) {
        budget = Math.min(budget, Math.floor((size - Number(fixedTokens) || 0) / 2));
    }
    return budget < MIN_CHUNK_TOKENS ? MIN_CHUNK_TOKENS : budget;
}

/**
 * The text cut into entry blocks: blank lines are the boundary, as on the site.
 * @param {string} text
 * @returns {string[]}
 */
export function splitEntryBlocks(text) {
    return String(text ?? '')
        .split(/\n{2,}/)
        .map(block => block.trim())
        .filter(Boolean);
}

/**
 * [text] cut into pieces of at most [maxTokens]: between entry blocks first, then
 * on line breaks, then by length for a single over-long line (:192-242).
 * @param {string} text
 * @param {number} maxTokens
 * @param {(text: string) => number} [countTokens]
 * @returns {string[]}
 */
export function chunkText(text, maxTokens, countTokens = defaultCountTokens) {
    const limit = Math.max(1, Number(maxTokens) || 0);
    const chunks = [];
    let current = [];
    let currentTokens = 0;
    for (const block of splitEntryBlocks(text)) {
        for (const piece of splitOversized(block, limit, '\n', (t) => countTokens(t))) {
            const tokens = countTokens(piece);
            if (currentTokens > 0 && currentTokens + tokens > limit) {
                chunks.push(current.join('\n\n'));
                current = [];
                currentTokens = 0;
            }
            current.push(piece);
            currentTokens += tokens;
        }
    }
    if (current.length) chunks.push(current.join('\n\n'));
    return chunks;
}

/**
 * [text] packed greedily along [separator], or by length when a single line is
 * longer than the budget (:214-242).
 * @param {string} text
 * @param {number} maxTokens
 * @param {string} separator
 * @param {(text: string) => number} countTokens
 * @returns {string[]}
 */
function splitOversized(text, maxTokens, separator, countTokens) {
    const tokens = countTokens(text);
    if (tokens <= maxTokens) return [text];
    if (!separator) {
        const step = Math.max(1, Math.floor((text.length * maxTokens) / tokens));
        const pieces = [];
        for (let i = 0; i < text.length; i += step) pieces.push(text.slice(i, i + step));
        return pieces;
    }
    const pieces = [];
    let current = '';
    let currentTokens = 0;
    for (const line of text.split(separator)) {
        for (const part of splitOversized(line, maxTokens, '', countTokens)) {
            const partTokens = countTokens(part);
            if (currentTokens > 0 && currentTokens + partTokens > maxTokens) {
                pieces.push(current);
                current = '';
                currentTokens = 0;
            }
            if (current) current += separator;
            current += part;
            currentTokens += partTokens;
        }
    }
    if (current) pieces.push(current);
    return pieces;
}

/**
 * The exact chat messages a build sends: a system prompt plus ONE user message
 * bundling every selected context block, then the source (:330-373). Exposed so
 * the dialog can preview without spending a call — the same function the send
 * path uses, never a parallel copy.
 * @param {string} lorebookText
 * @param {{ card?: string, catalog?: string, scenario?: string, greetings?: string,
 *   lorebookDescs?: string, extra?: string, fromJs?: boolean, systemPrompt?: string }} [options]
 * @returns {{ role: string, content: string }[]}
 */
export function messagesFor(lorebookText, options = {}) {
    const { fromJs = false } = options;
    const parts = [];
    for (const block of CONTEXT_BLOCKS) {
        const value = String(options[block.key] ?? '').trim();
        // A selected-but-empty block is omitted entirely, never sent as a bare
        // header with nothing under it.
        if (value) parts.push(`${block.intro}\n\n${value}`);
    }
    parts.push(fromJs
        ? `JavaScript lorebook source to convert into entries:\n\n${lorebookText}`
        : `Raw lorebook text to convert into entries:\n\n${lorebookText}`);
    const custom = String(options.systemPrompt ?? '').trim();
    // A blank override means "use the default", exactly like a cleared settings
    // field in Glaze (:290-303).
    const system = custom || (fromJs ? JS_SYSTEM_PROMPT : TEXT_SYSTEM_PROMPT);
    return [
        { role: 'system', content: system },
        { role: 'user', content: parts.join('\n\n---\n\n') },
    ];
}

/**
 * Every request a build sends, in order (:244-288). `chunkTokens <= 0` and any
 * JavaScript source are always one request: a script cannot be cut without
 * losing the code that assembles its entries.
 * @param {{ text: string, fromJs?: boolean, chunkTokens?: number, window?: number,
 *   context?: Record<string, string>, systemPrompt?: string,
 *   countTokens?: (text: string) => number }} options
 * @returns {{ requests: { role: string, content: string }[][], budget: number,
 *   fixedTokens: number, reason: string, textTokens: number }}
 */
export function planBuild(options) {
    const {
        text = '',
        fromJs = false,
        chunkTokens = DEFAULT_CHUNK_TOKENS,
        window = 0,
        context = {},
        systemPrompt = '',
        countTokens = defaultCountTokens,
    } = options;
    const build = (piece) => messagesFor(piece, { ...context, fromJs, systemPrompt });
    const textTokens = countTokens(text);

    if (fromJs || !(Number(chunkTokens) > 0)) {
        return {
            requests: [build(text)],
            budget: null,
            fixedTokens: 0,
            reason: fromJs ? 'javascript' : 'chunking-off',
            textTokens,
        };
    }

    // What every request repeats: the system prompt plus all context blocks, and
    // the payload header. Measured on the empty-text request, like Glaze (:276-279).
    const fixedTokens = build('').reduce((sum, m) => sum + countTokens(m.content), 0);
    const budget = chunkBudget({ chunkTokens, window, fixedTokens });
    const chunks = chunkText(text, budget, countTokens);
    // One chunk means the whole text goes in one request — the split is a budget
    // check, not a rewrite of the payload.
    if (chunks.length <= 1) {
        return { requests: [build(text)], budget, fixedTokens, reason: 'fits', textTokens };
    }
    return {
        requests: chunks.map(build),
        budget,
        fixedTokens,
        reason: 'chunked',
        textTokens,
    };
}

/**
 * What the transport call looks like for one planned request. `maxTokens` is
 * BOUNDLESS_MAX_TOKENS (`undefined`), which deletes the field before it reaches
 * the provider — see the constant for why a cap is wrong on a reasoning model.
 * @param {{ role: string, content: string }[]} messages
 * @returns {{ messages: { role: string, content: string }[], maxTokens: undefined,
 *   temperature: number, stream: false, includePreset: false }}
 */
export function transportFor(messages) {
    return {
        messages,
        maxTokens: BOUNDLESS_MAX_TOKENS,
        temperature: REQUEST_TEMPERATURE,
        stream: false,
        includePreset: false,
    };
}

/**
 * Strip code fences, then cut to the outermost JSON object/array (:377-386).
 * @param {string} text
 * @returns {string}
 */
export function stripFences(text) {
    let value = String(text ?? '').trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value);
    if (fence) value = fence[1].trim();
    const first = value.search(/[\[{]/);
    const last = Math.max(value.lastIndexOf('}'), value.lastIndexOf(']'));
    if (first >= 0 && last > first) value = value.slice(first, last + 1);
    return value;
}

/**
 * Coerce parsed JSON into a list of raw entry maps (:389-398): an array, or
 * `entries` as a list or a map, or a bare `lorebook` array.
 * @param {unknown} parsed
 * @returns {unknown[]}
 */
export function coerceEntries(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
        const entries = parsed.entries;
        if (Array.isArray(entries)) return entries;
        if (entries && typeof entries === 'object') return Object.values(entries);
        if (Array.isArray(parsed.lorebook)) return parsed.lorebook;
    }
    return [];
}

/**
 * Keys as a clean string list: an array or a comma-separated string (:400-408).
 * Duplicates are dropped — the site repeats names across aliases and a duplicate
 * trigger is a no-op; Glaze keeps them, so this is the one place we tighten.
 * @param {unknown} value
 * @returns {string[]}
 */
export function asKeys(value) {
    const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
    const keys = [];
    for (const item of raw) {
        if (item === null || item === undefined) continue;
        const key = String(item).trim();
        if (key && !keys.includes(key)) keys.push(key);
    }
    return keys;
}

/**
 * One raw entry coerced to the fields we save (:410-441). Returns null when the
 * entry has no content: a contentless entry is a dead trigger in SillyTavern,
 * so it is dropped and counted instead of saved.
 * @param {unknown} raw
 * @param {number} index
 * @returns {{ comment: string, key: string[], keysecondary: string[],
 *   content: string, order: number, constant: boolean } | null}
 */
export function normalizeEntry(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const content = String(raw.content ?? raw.text ?? '').trim();
    if (!content) return null;
    const comment = String(
        raw.comment ?? raw.title ?? raw.name ?? raw.category ?? `Entry ${index}`,
    ).trim();
    const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null);
    const order = number(raw.order) ?? number(raw.priority) ?? number(raw.insertion_order) ?? 100;
    return {
        comment,
        key: asKeys(raw.key ?? raw.keys ?? raw.keywords),
        keysecondary: asKeys(raw.keysecondary ?? raw.secondary_keys ?? raw.keySecondary),
        content,
        order,
        constant: raw.constant === true,
    };
}

/** A rebuild failure that must reach the user, never be swallowed. */
export class RebuildError extends Error {
    /**
     * @param {string} message
     * @param {{ code?: string, part?: number, total?: number, raw?: string,
     *   resumable?: boolean, cause?: unknown }} [details]
     */
    constructor(message, details = {}) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause });
        this.name = 'RebuildError';
        this.code = details.code || 'rebuild';
        this.part = details.part ?? null;
        this.total = details.total ?? null;
        this.raw = details.raw ?? '';
        this.resumable = details.resumable === true;
    }
}

/**
 * A reply parsed into entries, or a RebuildError. No empty book: a part that
 * yields nothing usable fails the build (:546-549).
 * @param {string} reply
 * @param {{ part?: number, total?: number, resumable?: boolean }} [where]
 * @returns {{ entries: ReturnType<typeof normalizeEntry>[], dropped: number }}
 */
export function parseReply(reply, where = {}) {
    const raw = String(reply ?? '');
    const body = stripFences(raw);
    if (!body) {
        throw new RebuildError('The model returned an empty reply.',
            { code: 'unparseable', raw, ...where });
    }
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch (error) {
        throw new RebuildError('The model did not return JSON.',
            { code: 'unparseable', raw, cause: error, ...where });
    }
    const candidates = coerceEntries(parsed);
    const entries = [];
    let dropped = 0;
    candidates.forEach((candidate, index) => {
        const entry = normalizeEntry(candidate, index);
        if (entry) entries.push(entry);
        else dropped += 1;
    });
    if (!entries.length) {
        throw new RebuildError('The model returned no usable lorebook entries.',
            { code: 'no-entries', raw, ...where });
    }
    return { entries, dropped };
}

/**
 * The part cache key: a part built on another profile or model is not what a
 * retry here would return (:506-512).
 * @param {{ profileId?: string, model?: string }} request
 * @param {{ role: string, content: string }[]} messages
 * @returns {string}
 */
export function partCacheKey(request, messages) {
    return [request.profileId ?? '', request.model ?? '', ...messages.map(m => m.content)].join('\u0000');
}

/**
 * Defaults for the build sheet, mirroring Glaze's `_buildSources`
 * (janitor_lorebook_capture_sheet.dart:233): card, catalog and scenario on,
 * greetings off, lorebook descriptions ON for a build (they differ from the
 * capture defaults). `catalog` is off here: our server does not carry the site
 * description, so turning it on needs one extra page fetch — an ask, not a
 * default. `extra` is the user's own free text.
 */
export const REBUILD_CONTEXT_DEFAULTS = Object.freeze({
    card: true,
    catalog: false,
    scenario: true,
    greetings: false,
    lorebookDescs: true,
});

/** The persisted shape, and the shape `readRebuildSettings()` guarantees. */
export const REBUILD_DEFAULTS = Object.freeze({
    profileId: '',
    model: '',
    chunkTokens: DEFAULT_CHUNK_TOKENS,
    context: REBUILD_CONTEXT_DEFAULTS,
    extra: '',
    systemText: '',
    systemJs: '',
});

/**
 * Normalize whatever is in `extension_settings` into a complete, typed
 * settings object, so a half-written or hand-edited entry can never reach a
 * request as `undefined`.
 * @param {unknown} raw
 * @returns {{ profileId: string, model: string, chunkTokens: number,
 *   context: { card: boolean, catalog: boolean, scenario: boolean,
 *     greetings: boolean, lorebookDescs: boolean }, extra: string,
 *   systemText: string, systemJs: string }}
 */
export function readRebuildSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const context = value.context && typeof value.context === 'object' ? value.context : {};
    const flag = (key) => (typeof context[key] === 'boolean' ? context[key] : REBUILD_CONTEXT_DEFAULTS[key]);
    const chunk = Number(value.chunkTokens);
    return {
        profileId: typeof value.profileId === 'string' ? value.profileId : '',
        model: typeof value.model === 'string' ? value.model.trim() : '',
        chunkTokens: Number.isFinite(chunk) && chunk >= 0 ? Math.trunc(chunk) : DEFAULT_CHUNK_TOKENS,
        context: {
            card: flag('card'),
            catalog: flag('catalog'),
            scenario: flag('scenario'),
            greetings: flag('greetings'),
            lorebookDescs: flag('lorebookDescs'),
        },
        extra: typeof value.extra === 'string' ? value.extra : '',
        systemText: typeof value.systemText === 'string' ? value.systemText : '',
        systemJs: typeof value.systemJs === 'string' ? value.systemJs : '',
    };
}

/**
 * Which connection profile builds: a valid saved id, else the active profile,
 * else nothing — never a silent pick of some other profile (Glaze
 * `resolveLorebookBuildConfig`, :309-321). `profiles` must already be the
 * usable chat-completion subset; this only chooses among them.
 * @param {{ id: string, name?: string, model?: string }[]} profiles
 * @param {string} preferredId
 * @param {string} activeId
 * @returns {{ profile: object, fellBack: boolean, staleId: string }}
 */
export function resolveRebuildProfile(profiles, preferredId, activeId) {
    const list = Array.isArray(profiles) ? profiles : [];
    const preferred = preferredId ? list.find(p => p && p.id === preferredId) : null;
    if (preferred) return { profile: preferred, fellBack: false, staleId: '' };
    const active = activeId ? list.find(p => p && p.id === activeId) : null;
    if (active) {
        return { profile: active, fellBack: Boolean(preferredId), staleId: preferredId || '' };
    }
    throw new RebuildError('No chat-completion connection profile is available.',
        { code: 'no-profile' });
}

/**
 * Titles and descriptions of the character's lorebooks, as the CONTEXT block
 * expects them: a title line, a blank line, the description, blank line, next.
 * @param {{ title?: string, name?: string, description?: string }[]} books
 * @returns {string}
 */
export function lorebookDescsContext(books) {
    return (Array.isArray(books) ? books : [])
        .map(book => {
            const title = String(book.title || book.name || '').trim();
            const description = String(book.description || '').trim();
            if (!title && !description) return '';
            return [title, description].filter(Boolean).join('\n\n');
        })
        .filter(Boolean)
        .join('\n\n\n');
}

/**
 * The character card's greetings, first one first, joined the way Glaze joins
 * them (`:335`).
 * @param {{ first_mes?: string, alternate_greetings?: string[] }} data
 * @returns {string}
 */
export function greetingsContext(data) {
    const card = data && typeof data === 'object' ? data : {};
    const greetings = [card.first_mes, ...(Array.isArray(card.alternate_greetings) ? card.alternate_greetings : [])]
        .map(value => String(value ?? '').trim())
        .filter(Boolean);
    return greetings.join('\n\n---\n\n');
}

/**
 * Build the context object `planBuild()` consumes from a card, its books and
 * the chosen toggles. One function, so the preview and the request cannot show
 * different context.
 * @param {{ card?: object, books?: object[], catalog?: string, extra?: string,
 *   toggles?: Partial<typeof REBUILD_CONTEXT_DEFAULTS> }} options
 * @returns {Record<string, string>}
 */
export function contextFor(options = {}) {
    const { card = null, books = [], catalog = '', extra = '', toggles = {} } = options;
    const enabled = { ...REBUILD_CONTEXT_DEFAULTS, ...toggles };
    const data = card && card.data ? card.data : (card || {});
    return {
        card: enabled.card ? String(data.description ?? '').trim() : '',
        catalog: enabled.catalog ? String(catalog ?? '').trim() : '',
        scenario: enabled.scenario ? String(data.scenario ?? '').trim() : '',
        greetings: enabled.greetings ? greetingsContext(data) : '',
        lorebookDescs: enabled.lorebookDescs ? lorebookDescsContext(books) : '',
        // The extra box has no toggle: it is either written or empty, and an
        // empty one is simply absent from the message.
        extra: String(extra ?? '').trim(),
    };
}
