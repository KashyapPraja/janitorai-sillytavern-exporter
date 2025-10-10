// ==UserScript==
// @name         Janitor AI → SillyTavern Card Exporter
// @namespace    https://github.com/openai/codex
// @version      0.2.0
// @description  Download Janitor AI characters as SillyTavern V2 PNG cards.
// @author       Cervantes Wu (https://mriwu.us)
// @match        https://janitorai.com/*
// @match        https://www.janitorai.com/*
// @match        https://jannyai.com/*
// @match        https://www.jannyai.com/*
// @run-at       document-idle
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlHttpRequest
// @connect      janitorai.com
// @connect      www.janitorai.com
// @connect      cdn.janitorai.com
// @connect      jannyai.com
// @connect      www.jannyai.com
// @connect      cdn.jannyai.com
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = '[JanitorAI → SillyTavern]';
  const BUTTON_ID = 'janitorai-sillytavern-export-button';
  const BUTTON_TEXT = 'Download SillyTavern Card';
  let lastPathname = location.pathname;
  const characterCache = new Map();
  let latestCharacterData = null;
  let networkInterceptInstalled = false;
  const JANNY_HOSTS = ['https://jannyai.com', 'https://www.jannyai.com'];
  const JANNY_SEARCH_TEMPLATES = [
    (term) => `https://jannyai.com/search?query=${encodeURIComponent(term)}`,
    (term) => `https://jannyai.com/search?q=${encodeURIComponent(term)}`,
    (term) => `https://jannyai.com/search/${encodeURIComponent(term)}`,
    (term) => `https://www.jannyai.com/search?query=${encodeURIComponent(term)}`,
    (term) => `https://www.jannyai.com/search?q=${encodeURIComponent(term)}`,
    (term) => `https://www.jannyai.com/search/${encodeURIComponent(term)}`,
    (term) => `https://jannyai.com/api/search?query=${encodeURIComponent(term)}`,
    (term) => `https://jannyai.com/api/search?q=${encodeURIComponent(term)}`,
    (term) => `https://jannyai.com/api/search/characters?query=${encodeURIComponent(term)}`,
    (term) => `https://www.jannyai.com/api/search?query=${encodeURIComponent(term)}`,
    (term) => `https://www.jannyai.com/api/search?q=${encodeURIComponent(term)}`,
    (term) => `https://www.jannyai.com/api/search/characters?query=${encodeURIComponent(term)}`
  ];

  interceptNetwork();
  if (!document.body) {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    ensureButton();
    observeNavigation();
  }

  function observeNavigation() {
    const observer = new MutationObserver(() => ensureButton());
    observer.observe(document.body, { childList: true, subtree: true });

    const originalPushState = history.pushState;
    history.pushState = function pushState() {
      const result = originalPushState.apply(this, arguments);
      setTimeout(onRouteChange, 50);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function replaceState() {
      const result = originalReplaceState.apply(this, arguments);
      setTimeout(onRouteChange, 50);
      return result;
    };

    window.addEventListener('popstate', onRouteChange);

    setInterval(() => {
      if (lastPathname !== location.pathname) {
        lastPathname = location.pathname;
        onRouteChange();
      }
    }, 500);
  }

  function onRouteChange() {
    ensureButton();
  }

  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (!isCharacterPage()) {
      if (existing) existing.remove();
      return;
    }

    if (existing) return;

    const button = createButton();
    document.body.appendChild(button);
  }

  function isCharacterPage() {
    const path = (location.pathname || '').toLowerCase();
    return path.startsWith('/characters/') || path.startsWith('/character/');
  }

  function createButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = BUTTON_TEXT;

    Object.assign(button.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483647',
      background: 'linear-gradient(135deg, #4c1d95, #7c3aed)',
      color: '#ffffff',
      border: 'none',
      borderRadius: '9999px',
      padding: '12px 22px',
      fontSize: '14px',
      fontWeight: '600',
      fontFamily: 'inherit',
      cursor: 'pointer',
      boxShadow: '0 12px 30px rgba(76, 29, 149, 0.35)',
      transition: 'transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease'
    });

    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.05)';
      button.style.boxShadow = '0 18px 40px rgba(124, 58, 237, 0.45)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = '0 12px 30px rgba(76, 29, 149, 0.35)';
    });

    button.addEventListener('focus', () => {
      button.style.outline = '2px solid rgba(124,58,237,0.5)';
      button.style.outlineOffset = '4px';
    });

    button.addEventListener('blur', () => {
      button.style.outline = 'none';
    });

    button.addEventListener('click', () => handleExport(button));

    return button;
  }

  async function handleExport(button) {
    if (button.dataset.busy === '1') {
      return;
    }

    const originalText = button.textContent;
    button.dataset.busy = '1';
    button.textContent = 'Preparing card…';
    button.disabled = true;

    try {
      const character = await extractCharacterData();
      if (!character) {
        throw new Error('Character data could not be located on this page.');
      }

      button.textContent = 'Searching JannyAI…';
      const jannyDownloaded = await tryDownloadFromJanny(character);
      if (jannyDownloaded) {
        button.textContent = 'Card ready!';
        setTimeout(() => {
          button.textContent = originalText;
        }, 1800);
        return;
      }

      const card = buildCardSpec(character);
      button.textContent = 'Rendering artwork…';
      const imageCandidates = extractImageCandidates(character);
      const pngBytes = await buildCardPng(card, imageCandidates);
      const fileName = `${slugify(card.name || 'character')}.png`;
      downloadBlob(pngBytes, fileName);
      button.textContent = 'Card ready!';
      setTimeout(() => {
        button.textContent = originalText;
      }, 1800);
    } catch (error) {
      console.error(LOG_PREFIX, error);
      alert(`${LOG_PREFIX} Failed to export: ${error.message || error}`);
      button.textContent = originalText;
    } finally {
      button.dataset.busy = '0';
      button.disabled = false;
    }
  }

  async function extractCharacterData() {
    const cached = getCachedCharacter();
    if (cached) {
      return cached;
    }

    const searchTargets = [
      window.__NUXT__,
      window.__NUXT__ && window.__NUXT__.data,
      window.__NUXT__ && window.__NUXT__.state,
      window.__NUXT__ && window.__NUXT__.payload,
      window.__NEXT_DATA__,
      window.__NEXT_DATA__ && window.__NEXT_DATA__.props,
      window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps,
      window.__JANITOR_INITIAL_STATE__,
      window.__APOLLO_STATE__
    ];

    for (const target of searchTargets) {
      const found = recordCharacterCandidateFromData(target);
      if (found) {
        return found;
      }
    }

    const scriptNodes = Array.from(document.querySelectorAll('script[type="application/json"], script:not([src])'));
    for (const script of scriptNodes) {
      const content = script.textContent && script.textContent.trim();
      if (!content) continue;

      const jsonCandidates = tryParseJson(content);
      for (const candidate of jsonCandidates) {
        const found = recordCharacterCandidateFromData(candidate);
        if (found) return found;
      }
    }

    return null;
  }

  function tryParseJson(content) {
    const candidates = [];

    try {
      candidates.push(JSON.parse(content));
      return candidates;
    } catch (error) {
      // continue
    }

    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        candidates.push(JSON.parse(match[0]));
      } catch (error) {
        // ignore
      }
    }

    return candidates;
  }

  function findCharacterObject(root) {
    const visited = new WeakSet();
    const stack = [];

    if (Array.isArray(root)) {
      stack.push(...root);
    } else if (root && typeof root === 'object') {
      stack.push(root);
    } else {
      return null;
    }

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);

      if (looksLikeCharacter(current)) {
        return current;
      }

      for (const value of Object.values(current)) {
        if (!value) continue;
        if (typeof value === 'object') {
          stack.push(value);
        }
      }
    }

    return null;
  }

  function looksLikeCharacter(candidate) {
    if (!candidate || typeof candidate !== 'object') return false;
    const nameKeys = ['name', 'title', 'display_name'];
    const descriptionKeys = ['description', 'short_description', 'bio'];
    const greetingKeys = ['greeting', 'opening_message', 'first_mes', 'first_message'];

    const hasName = nameKeys.some((key) => typeof candidate[key] === 'string' && candidate[key].trim().length);
    const hasDescription = descriptionKeys.some((key) => typeof candidate[key] === 'string' && candidate[key].trim().length);
    const hasGreeting = greetingKeys.some((key) => typeof candidate[key] === 'string' && candidate[key].trim().length);

    return hasName && (hasDescription || hasGreeting);
  }

  function buildCardSpec(character) {
    const name = safeString(character.name || character.title);
    let description = cleanRichText(character.description || character.short_description || '');
    let personality = cleanRichText(character.personality || character.traits || character.characteristics || '');
    let scenario = cleanRichText(character.scenario || character.context || character.module || '');
    let systemPrompt = cleanRichText(character.system_prompt || character.system || '');

    const definitionRaw = safeString(character.definition || character.persona || '');
    const definition = normalizeNewlines(definitionRaw);
    if (definition) {
      const systemMatch = definition.match(/<system>([\s\S]*?)<\/system>/i);
      if (systemMatch && systemMatch[1]) {
        systemPrompt = cleanRichText(systemMatch[1]);
      }

      const charNamePattern = new RegExp(`^\\s*<${name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}>([\\s\\S]*?)<\\/${name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}>`, 'i');
      const charMatch = definition.match(charNamePattern);

      let mainDefinition = definition.replace(/<system>[\s\S]*?<\/system>/i, '').trim();

      if (charMatch && charMatch[1]) {
        description = cleanRichText(charMatch[1]);
      } else {
        description = cleanRichText(mainDefinition);
      }

      personality = '';
      scenario = '';
    }

    const firstMessage = cleanRichText(character.greeting || character.opening_message || character.first_mes || character.first_message || '');
    const mesExample = formatExampleDialogs(
      character.example_dialogs ||
      character.example_dialogue ||
      character.dialogues ||
      character.examples ||
      character.example_conversations ||
      character.exampleChats
    );
    const creatorNotes = cleanRichText(character.creator_notes || character.notes || character.commentary || '');
    const postHistory = cleanRichText(character.post_history_instructions || character.memory || '');
    const alternateGreetings = extractAlternateGreetings(character);
    const tags = extractTags(character);
    const creator = extractCreator(character);
    const characterVersion = safeString(character.character_version || character.version || character.revision || '');
    const characterBook = buildCharacterBook(character);
    const extensions = buildExtensions(character);

    return {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      name,
      description,
      personality,
      scenario,
      first_mes: firstMessage,
      mes_example: mesExample,
      creator_notes: creatorNotes,
      system_prompt: systemPrompt,
      post_history_instructions: postHistory,
      alternate_greetings: alternateGreetings,
      character_book: characterBook,
      tags,
      creator,
      character_version: characterVersion,
      extensions
    };
  }

  function safeString(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function normalizeNewlines(text) {
    return safeString(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function safeMultiline(value) {
    return normalizeNewlines(value).trim();
  }

  function stripHtml(value) {
    const text = safeString(value);
    if (!text) return '';
    return text
      .replace(/<\/p>\s*<p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(ul|ol)>/gi, '\n')
      .replace(/<li>\s*/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      .replace(/<\/?[^>]+>/g, '');
  }

  function cleanRichText(value) {
    const stripped = stripHtml(value);
    return safeMultiline(stripped).replace(/\n{3,}/g, '\n\n');
  }

  function extractAlternateGreetings(character) {
    const sources = [
      character.alternate_greetings,
      character.alternative_greetings,
      character.alternateGreetings,
      character.greetings,
      character.alt_greetings,
      character.alternates
    ];

    const greetings = new Set();

    for (const source of sources) {
      if (!source) continue;
      const list = Array.isArray(source) ? source : [source];
      for (const item of list) {
        const text = cleanRichText(item);
        if (text) greetings.add(text);
      }
    }

    return Array.from(greetings);
  }

  function extractTags(character) {
    const sources = [
      character.tags,
      character.genres,
      character.categories,
      character.labels,
      character.hashtags
    ];

    const tags = new Set();

    for (const source of sources) {
      if (!source) continue;
      const list = Array.isArray(source) ? source : safeString(source).split(/[,;]+/);
      for (const tag of list) {
        const trimmed = safeString(tag).trim();
        if (trimmed) tags.add(trimmed);
      }
    }

    return Array.from(tags);
  }

  function extractCreator(character) {
    const creatorSource = character.creator || character.author || character.owner || character.user;
    if (!creatorSource) return '';

    if (typeof creatorSource === 'string') {
      return creatorSource;
    }

    if (typeof creatorSource === 'object') {
      return safeString(
        creatorSource.username ||
        creatorSource.display_name ||
        creatorSource.name ||
        creatorSource.handle ||
        creatorSource.slug ||
        ''
      );
    }

    return '';
  }

  function buildCharacterBook(character) {
    const bookSources = [
      character.character_book,
      character.characterBook,
      character.memory_book,
      character.book,
      character.kb,
      character.lore_book
    ];

    for (const bookSource of bookSources) {
      if (bookSource && typeof bookSource === 'object') {
        const entries = normalizeBookEntries(bookSource.entries || bookSource.items || bookSource);
        if (entries) {
          return {
            name: safeString(bookSource.name || ''),
            description: safeMultiline(bookSource.description || ''),
            entries,
            settings: sanitizeBookSettings(bookSource.settings || {})
          };
        }
      }
    }

    return {
      name: '',
      description: '',
      entries: [],
      settings: {
        scan_depth: 50,
        token_budget: 600,
        reserved_tokens: 150,
        cost_multiplier: 1,
        enable: false
      }
    };
  }

  function normalizeBookEntries(entries) {
    if (!entries) return [];
    const list = Array.isArray(entries) ? entries : [entries];
    const normalized = [];

    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const content = safeMultiline(entry.content || entry.text || entry.value || '');
      const key = safeString(entry.key || entry.keyword || entry.trigger || '');
      if (!content || !key) continue;

      normalized.push({
        id: safeString(entry.id || entry._id || entry.uuid || cryptoRandomId()),
        key,
        content,
        enabled: entry.enabled !== undefined ? Boolean(entry.enabled) : true,
        case_sensitive: entry.case_sensitive !== undefined ? Boolean(entry.case_sensitive) : false,
        order: typeof entry.order === 'number' ? entry.order : normalized.length,
        weight: typeof entry.weight === 'number' ? entry.weight : 1,
        selective: Boolean(entry.selective),
        secondary_keys: Array.isArray(entry.secondary_keys) ? entry.secondary_keys : [],
        comment: safeMultiline(entry.comment || ''),
        extensions: typeof entry.extensions === 'object' && entry.extensions ? entry.extensions : {}
      });
    }

    return normalized;
  }

  function sanitizeBookSettings(settings) {
    return {
      scan_depth: numberOr(settings.scan_depth, 50),
      token_budget: numberOr(settings.token_budget, 600),
      reserved_tokens: numberOr(settings.reserved_tokens, 150),
      cost_multiplier: numberOr(settings.cost_multiplier, 1),
      enable: Boolean(settings.enable)
    };
  }

  function numberOr(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function cryptoRandomId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    const random = Math.random().toString(16).slice(2);
    const timestamp = Date.now().toString(16);
    return `${timestamp}-${random}`;
  }

  function buildExtensions(character) {
    const extensions = {};
    const janitorFields = [
      'id',
      '_id',
      'slug',
      'uuid',
      'rating',
      'language',
      'visibility',
      'nsfw',
      'likes',
      'dislikes',
      'favorite_count',
      'favorites',
      'created_at',
      'createdAt',
      'updated_at',
      'updatedAt',
      'published_at',
      'voice',
      'voice_id',
      'avatar_id',
      'cover_id',
      'ai_model',
      'model',
      'temperature',
      'top_p',
      'frequency_penalty',
      'presence_penalty'
    ];

    const janitorData = {};

    for (const field of janitorFields) {
      if (character[field] !== undefined && character[field] !== null) {
        janitorData[field] = character[field];
      }
    }

    if (character.stats && typeof character.stats === 'object') {
      janitorData.stats = character.stats;
    }

    if (Object.keys(janitorData).length) {
      extensions.janitor = janitorData;
    }

    if (character.extensions && typeof character.extensions === 'object') {
      for (const [key, value] of Object.entries(character.extensions)) {
        if (value !== undefined) {
          extensions[key] = value;
        }
      }
    }

    return extensions;
  }

  function formatExampleDialogs(examples) {
    if (!examples) return '';

    if (typeof examples === 'string') {
      return cleanRichText(examples);
    }

    if (Array.isArray(examples)) {
      const formatted = examples
        .map((dialog) => formatExampleDialog(dialog))
        .filter(Boolean);
      return formatted.join('\n\n');
    }

    if (typeof examples === 'object') {
      if (Array.isArray(examples.dialogs)) {
        return formatExampleDialogs(examples.dialogs);
      }
      if (Array.isArray(examples.examples)) {
        return formatExampleDialogs(examples.examples);
      }
    }

    return '';
  }

  function formatExampleDialog(dialog) {
    if (!dialog) return '';

    if (typeof dialog === 'string') {
      return cleanRichText(dialog);
    }

    if (Array.isArray(dialog)) {
      return dialog
        .map((turn) => formatExampleTurn(turn))
        .filter(Boolean)
        .join('\n');
    }

    if (typeof dialog === 'object') {
      const turns = [];

      if (dialog.user || dialog.you) {
        const userLine = dialog.user || dialog.you;
        if (userLine) {
          turns.push(`{{user}}: ${cleanRichText(userLine)}`);
        }
      }

      if (dialog.character || dialog.bot || dialog.ai) {
        const charLine = dialog.character || dialog.bot || dialog.ai;
        if (charLine) {
          turns.push(`{{char}}: ${cleanRichText(charLine)}`);
        }
      }

      if (!turns.length) {
        for (const [key, value] of Object.entries(dialog)) {
          const line = cleanRichText(value);
          if (!line) continue;
          const speaker = key.toLowerCase().includes('you') ? '{{user}}' : '{{char}}';
          turns.push(`${speaker}: ${line}`);
        }
      }

      return turns.join('\n');
    }

    return '';
  }

  function formatExampleTurn(turn) {
    if (!turn) return '';
    if (typeof turn === 'string') {
      return cleanRichText(turn);
    }

    if (typeof turn === 'object') {
      const text = cleanRichText(turn.text || turn.message || turn.content || '');
      if (!text) return '';
      const speakerRaw = safeString(turn.speaker || turn.name || turn.role || '');
      const speaker = speakerRaw.toLowerCase().includes('you') ? '{{user}}' : '{{char}}';
      return `${speaker}: ${text}`;
    }

    return '';
  }

  function extractImageCandidates(character) {
    const urls = new Set();

    const addCandidate = (value) => {
      if (!value) return;

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return;
        if (/^https?:\/\//i.test(trimmed)) {
          urls.add(trimmed);
          return;
        }
        if (/\.(png|jpe?g|webp|gif|svg)$/i.test(trimmed)) {
          for (const expanded of expandFilenameCandidates(trimmed)) {
            urls.add(expanded);
          }
        }
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          addCandidate(item);
        }
        return;
      }

      if (typeof value === 'object') {
        const directKeys = [
          'url',
          'href',
          'src',
          'image',
          'image_url',
          'imageUrl',
          'original',
          'full',
          'large',
          'medium',
          'default',
          'portrait',
          'card',
          'avatar'
        ];
        for (const key of directKeys) {
          if (value[key]) {
            addCandidate(value[key]);
          }
        }
      }
    };

    const potentialFilenames = [
      character.avatar,
      character.image,
      character.avatar_id,
      character.pfp,
      character.avatarFilename,
      character.profile_picture
    ];
    for (const filename of potentialFilenames) {
      addCandidate(filename);
    }

    const candidates = [
      character.card_image,
      character.cardImage,
      character.image,
      character.imageUrl,
      character.image_url,
      character.avatarUrl,
      character.avatar_url,
      character.avatar,
      character.cover,
      character.icon,
      character.thumbnail,
      character.portrait,
      character.banner,
      character.background
    ];

    for (const candidate of candidates) {
      addCandidate(candidate);
    }

    if (character.images && typeof character.images === 'object') {
      addCandidate(character.images);
    }

    if (character.media && typeof character.media === 'object') {
      addCandidate(character.media);
    }

    if (character.avatar && typeof character.avatar === 'object') {
      addCandidate(character.avatar);
    }

    const deepResolved = findImageUrlInObject(character);
    if (deepResolved) addCandidate(deepResolved);

    const result = Array.from(urls);
    if (!result.length) {
      console.info(`${LOG_PREFIX} No direct image URL found; falling back to placeholder.`);
    } else {
      console.info(`${LOG_PREFIX} Image candidates:`, result);
    }
    return result;
  }

  function resolveImageCandidate(candidate) {
    if (!candidate) return '';
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed && /^https?:\/\//i.test(trimmed)) {
        return trimmed;
      }
      if (trimmed && /\.(png|jpe?g|webp|gif|svg)$/i.test(trimmed)) {
        const expanded = expandFilenameCandidates(trimmed);
        if (expanded.length) {
          return expanded[0];
        }
      }
      return '';
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const resolved = resolveImageCandidate(item);
        if (resolved) return resolved;
      }
      return '';
    }

    if (typeof candidate === 'object') {
      const directKeys = ['url', 'href', 'src', 'image', 'image_url', 'original', 'full', 'large', 'medium', 'default'];
      for (const key of directKeys) {
        if (candidate[key]) {
          const resolved = resolveImageCandidate(candidate[key]);
          if (resolved) return resolved;
        }
      }
    }

    return '';
  }

  function expandFilenameCandidates(filename) {
    if (!filename) return [];
    const trimmed = filename.trim();
    if (!trimmed) return [];

    const strippedProtocol = trimmed.replace(/^(https?:)?\/\//i, '');
    if (/^cdn\.(janitorai|jannyai)\.com/i.test(strippedProtocol)) {
      return [`https://${strippedProtocol}`];
    }

    const normalized = trimmed.replace(/^\/+/, '');
    const pathVariants = new Set([normalized]);
    if (normalized.startsWith('avatars/')) {
      pathVariants.add(normalized.replace(/^avatars\//i, ''));
    }
    if (normalized.startsWith('uploads/')) {
      pathVariants.add(normalized.replace(/^uploads\//i, ''));
    }

    const cdnBases = [
      'https://cdn.jannyai.com/avatars/',
      'https://cdn.jannyai.com/uploads/',
      'https://cdn.jannyai.com/card_images/',
      'https://cdn.jannyai.com/media/',
      'https://cdn.janitorai.com/avatars/',
      'https://cdn.janitorai.com/uploads/',
      'https://cdn.janitorai.com/card_images/',
      'https://cdn.janitorai.com/media/'
    ];

    const results = new Set();
    for (const base of cdnBases) {
      for (const variant of pathVariants) {
        results.add(base.replace(/\/+$/, '/') + variant.replace(/^\/+/, ''));
      }
    }

    return Array.from(results);
  }

  function findImageUrlInObject(root) {
    if (!root || typeof root !== 'object') return '';
    const visited = new WeakSet();
    const stack = [root];

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);

      if (typeof current === 'string') {
        const url = resolveImageCandidate(current);
        if (url) return url;
        continue;
      }

      for (const value of Object.values(current)) {
        if (!value) continue;
        if (typeof value === 'string') {
          const url = resolveImageCandidate(value);
          if (url) return url;
        } else if (typeof value === 'object') {
          stack.push(value);
        }
      }
    }

    return '';
  }

  async function tryDownloadFromJanny(character) {
    try {
      const slugCandidates = collectSlugCandidates(character);
      const name = safeString(character.name || character.title || '');
      const options = await findJannyCardOptions({
        slugCandidates,
        name,
        character
      });

      if (!options.length) {
        return false;
      }

      let selected = options[0];
      if (options.length > 1) {
        selected = promptJannySelection(options);
        if (!selected) {
          return false;
        }
      }

      const bytes = await gmFetchArrayBuffer(selected.cardUrl);
      const filename = selected.fileName || `${slugify(selected.name || name || 'character')}.png`;
      downloadBlob(bytes, filename);
      return true;
    } catch (error) {
      console.warn(`${LOG_PREFIX} JannyAI lookup failed:`, error);
      return false;
    }
  }

  function collectSlugCandidates(character) {
    const candidates = new Set();
    const pathIdentifiers = getPathIdentifiers();
    for (const id of pathIdentifiers) {
      const slug = normalizeSlug(id);
      if (slug) candidates.add(slug);
    }

    const slugFields = [
      'slug',
      'character_slug',
      'characterSlug',
      'permalink',
      'path',
      'url',
      'card_slug',
      'cardSlug',
      'profile_path'
    ];

    for (const field of slugFields) {
      if (character[field]) {
        const slug = normalizeSlug(character[field]);
        if (slug) candidates.add(slug);
      }
    }

    if (character.id) {
      const idSlug = normalizeSlug(`${character.id}`);
      if (idSlug) candidates.add(idSlug);
    }
    if (character.uuid) {
      const uuidSlug = normalizeSlug(`${character.uuid}`);
      if (uuidSlug) candidates.add(uuidSlug);
    }

    const identifierCandidates = collectCandidateIdentifiers(character);
    for (const identifier of identifierCandidates) {
      const slug = normalizeSlug(identifier);
      if (slug) candidates.add(slug);
    }

    return Array.from(candidates);
  }

  function normalizeSlug(value) {
    if (!value) return '';
    let slug = safeString(value)
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^\/+/, '')
      .replace(/#.*$/, '')
      .replace(/\?.*$/, '');
    slug = slug.replace(/^characters\//i, '');
    slug = slug.replace(/^character\//i, '');
    slug = slug.replace(/^card\//i, '');
    return slug.trim();
  }

  async function findJannyCardOptions({ slugCandidates, name }) {
    const options = [];
    const seenUrls = new Set();
    const triedSlugs = new Set();

    for (const rawSlug of slugCandidates) {
      const slug = normalizeSlug(rawSlug);
      if (!slug || triedSlugs.has(slug)) continue;
      triedSlugs.add(slug);
      const pageInfo = await fetchJannyCharacterPage(slug);
      if (!pageInfo) continue;

      for (const cardOption of pageInfo.cards) {
        addJannyOption(options, seenUrls, {
          cardUrl: cardOption.cardUrl,
          fileName: cardOption.fileName,
          name: cardOption.name || pageInfo.title || name,
          slug
        });
      }

      if (options.length) {
        break;
      }
    }

    if (!options.length && name) {
      const searchResults = await fetchJannySearchResults(name);
      for (const result of searchResults) {
        if (result.cardUrl) {
          addJannyOption(options, seenUrls, result);
        } else if (result.slug) {
          const slug = normalizeSlug(result.slug);
          if (!slug || triedSlugs.has(slug)) continue;
          triedSlugs.add(slug);
          const pageInfo = await fetchJannyCharacterPage(slug);
          if (!pageInfo) continue;
          const label = result.name || pageInfo.title || name;
          for (const cardOption of pageInfo.cards) {
            addJannyOption(options, seenUrls, {
              cardUrl: cardOption.cardUrl,
              fileName: cardOption.fileName,
              name: label,
              slug
            });
          }
        }
      }
    }

    return options;
  }

  function addJannyOption(options, seenUrls, option) {
    const url = normalizeUrl(option.cardUrl);
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    options.push({
      cardUrl: url,
      name: option.name || '',
      slug: option.slug || '',
      fileName: option.fileName || deriveFilenameFromUrl(url, option.name)
    });
  }

  async function fetchJannyCharacterPage(slug) {
    const trimmedSlug = normalizeSlug(slug);
    if (!trimmedSlug) return null;

    for (const host of JANNY_HOSTS) {
      const base = host.replace(/\/+$/, '');
      const url = `${base}/characters/${trimmedSlug}`;
      try {
        const response = await gmFetchText(url);
        if (!response || !response.text) continue;
        const parsed = parseJannyCardOptionsFromHtml(response.text, url);
        if (parsed.cards.length) {
          return parsed;
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to fetch JannyAI page ${url}:`, error);
      }
    }

    return null;
  }

  function parseJannyCardOptionsFromHtml(html, pageUrl) {
    const parser = new DOMParser();
    let doc = null;
    try {
      doc = parser.parseFromString(html, 'text/html');
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to parse JannyAI HTML`, error);
    }

    const title = doc ? (extractTitleFromDoc(doc) || '') : '';
    const cards = [];
    const seen = new Set();

    if (doc) {
      const elements = doc.querySelectorAll('a[href], button[data-download], button[data-href], [data-card-url]');
      elements.forEach((el) => {
        const attributes = [
          el.getAttribute('data-card-url'),
          el.getAttribute('data-download'),
          el.getAttribute('data-href'),
          el.getAttribute('href')
        ];

        for (const attr of attributes) {
          if (!attr) continue;
          let resolved = attr;
          try {
            resolved = new URL(attr, pageUrl).toString();
          } catch (error) {
            continue;
          }

          if (!/\.png(\?|$)/i.test(resolved)) continue;
          if (!/(card|character|chara|silly|stcard)/i.test(resolved)) continue;
          const normalized = normalizeUrl(resolved);
          if (!normalized || seen.has(normalized)) continue;
          seen.add(normalized);
          cards.push({
            cardUrl: normalized,
            fileName: el.getAttribute('download') || deriveFilenameFromUrl(normalized, title),
            name: (el.textContent || '').trim() || title
          });
        }
      });
    }

    const regex = /https?:\/\/[^"'<>]+\.png/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const candidate = match[0];
      if (!/(card|character|chara|silly|stcard)/i.test(candidate)) continue;
      const normalized = normalizeUrl(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      cards.push({
        cardUrl: normalized,
        fileName: deriveFilenameFromUrl(normalized, title),
        name: title
      });
    }

    return {
      title,
      cards
    };
  }

  function extractTitleFromDoc(doc) {
    if (!doc) return '';
    const ogTitle = doc.querySelector('meta[property="og:title"], meta[name="og:title"]');
    if (ogTitle && ogTitle.getAttribute('content')) {
      return ogTitle.getAttribute('content').trim();
    }
    const h1 = doc.querySelector('h1');
    if (h1 && h1.textContent) {
      return h1.textContent.trim();
    }
    const titleEl = doc.querySelector('title');
    if (titleEl && titleEl.textContent) {
      return titleEl.textContent.trim();
    }
    return '';
  }

  function promptJannySelection(options) {
    const lines = options.map((option, index) => {
      const label = option.name || option.slug || option.cardUrl;
      return `${index + 1}. ${label}`;
    });

    let attempts = 0;
    while (attempts < 3) {
      const input = window.prompt(
        `${LOG_PREFIX} Multiple JannyAI cards found:\n${lines.join('\n')}\nEnter a number (1-${options.length}) to select, or cancel to skip.`
      );

      if (input === null) {
        return null;
      }

      const index = Number.parseInt(input.trim(), 10);
      if (Number.isInteger(index) && index >= 1 && index <= options.length) {
        return options[index - 1];
      }

      attempts += 1;
      alert(`${LOG_PREFIX} Please enter a number between 1 and ${options.length}.`);
    }

    return null;
  }

  async function fetchJannySearchResults(name) {
    const results = [];
    const seenKeys = new Set();

    for (const template of JANNY_SEARCH_TEMPLATES) {
      const url = template(name);
      try {
        const response = await gmFetchText(url);
        if (!response || !response.text) continue;
        const contentType = getHeader(response.headers, 'content-type') || '';
        let batch = [];
        if (/json/i.test(contentType)) {
          try {
            const json = JSON.parse(response.text);
            batch = extractSearchResultsFromJson(json);
          } catch (error) {
            console.warn(`${LOG_PREFIX} Failed to parse JannyAI JSON search response`, error);
          }
        } else {
          batch = extractSearchResultsFromHtml(response.text, url);
        }

        for (const entry of batch) {
          const key = `${normalizeSlug(entry.slug || '')}|${normalizeUrl(entry.cardUrl || '')}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          results.push(entry);
        }

        if (results.length) {
          break;
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} JannyAI search failed for ${url}:`, error);
      }
    }

    return results;
  }

  function extractSearchResultsFromJson(data) {
    const results = [];
    const candidates = collectCharacterObjects(data, 50);
    for (const candidate of candidates) {
      const slug = normalizeSlug(
        candidate.slug ||
        candidate.character_slug ||
        candidate.characterSlug ||
        candidate.path ||
        candidate.permalink ||
        candidate.url ||
        ''
      );
      const name = safeString(candidate.name || candidate.title || candidate.display_name || '');
      const cardUrl = normalizeUrl(
        candidate.cardUrl ||
        candidate.card_url ||
        candidate.card ||
        candidate.card_image ||
        candidate.cardImage ||
        ''
      );

      if (cardUrl) {
        results.push({ slug, name, cardUrl });
      } else if (slug) {
        results.push({ slug, name });
      }
    }
    return results;
  }

  function extractSearchResultsFromHtml(html, baseUrl) {
    const results = [];
    const parser = new DOMParser();
    let doc = null;
    try {
      doc = parser.parseFromString(html, 'text/html');
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to parse JannyAI search HTML`, error);
    }

    if (doc) {
      const anchors = doc.querySelectorAll('a[href*="/characters/"], a[data-href*="/characters/"]');
      anchors.forEach((anchor) => {
        const href = anchor.getAttribute('href') || anchor.getAttribute('data-href');
        if (!href) return;
        let resolved;
        try {
          resolved = new URL(href, baseUrl).toString();
        } catch (error) {
          return;
        }
        const slug = normalizeSlug(resolved);
        if (!slug) return;
        const name = anchor.textContent ? anchor.textContent.trim() : '';
        results.push({ slug, name });
      });

      const cardNodes = doc.querySelectorAll('[data-card-url], a[download][href*=".png"]');
      cardNodes.forEach((node) => {
        const dataUrl = node.getAttribute('data-card-url') || node.getAttribute('href');
        if (!dataUrl) return;
        let resolved;
        try {
          resolved = new URL(dataUrl, baseUrl).toString();
        } catch (error) {
          return;
        }
        if (!/\.png(\?|$)/i.test(resolved)) return;
        results.push({
          slug: normalizeSlug(node.getAttribute('data-slug') || ''),
          name: node.textContent ? node.textContent.trim() : '',
          cardUrl: normalizeUrl(resolved)
        });
      });
    }

    const regex = /https?:\/\/[^"'<>]+\.png/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const candidate = match[0];
      if (!/(card|character|chara|silly|stcard)/i.test(candidate)) continue;
      results.push({
        slug: '',
        name: '',
        cardUrl: normalizeUrl(candidate)
      });
    }

    return results;
  }

  function collectCharacterObjects(root, maxCount = 50) {
    const results = [];
    const visited = new WeakSet();
    const stack = [];

    if (Array.isArray(root)) {
      stack.push(...root);
    } else if (root && typeof root === 'object') {
      stack.push(root);
    } else {
      return results;
    }

    while (stack.length && results.length < maxCount) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);

      if (looksLikeCharacter(current)) {
        results.push(current);
      }

      for (const value of Object.values(current)) {
        if (typeof value === 'object' && value !== null) {
          stack.push(value);
        }
      }
    }

    return results;
  }

  function normalizeUrl(url) {
    if (!url) return '';
    try {
      return new URL(url, window.location.href).toString();
    } catch (error) {
      return '';
    }
  }

  function deriveFilenameFromUrl(url, fallbackName) {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname || '';
      const segments = pathname.split('/').filter(Boolean);
      const last = segments.pop();
      if (last && /\.png$/i.test(last)) {
        return last;
      }
    } catch (error) {
      // ignore URL parsing errors
    }
    if (fallbackName) {
      return `${slugify(fallbackName)}.png`;
    }
    return 'character-card.png';
  }

  async function buildCardPng(card, imageCandidates) {
    const json = JSON.stringify(card);
    const base64 = base64EncodeUnicode(json);
    const textChunkData = buildTextChunkData('chara', base64);

    const canvas = await createCanvasFromImages(imageCandidates, card.name);
    const pngBytes = canvasToUint8Array(canvas);
    return insertTextChunk(pngBytes, textChunkData);
  }

  function base64EncodeUnicode(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
  }

  async function createCanvasFromImages(imageCandidates, characterName) {
    const candidates = Array.isArray(imageCandidates) ? imageCandidates : [imageCandidates].filter(Boolean);

    for (const imageUrl of candidates) {
      if (!imageUrl) continue;
      try {
        const dataUrl = await fetchImageAsDataUrl(imageUrl);
        if (dataUrl) {
          const canvas = await drawImageToCanvas(dataUrl);
          if (canvas) return canvas;
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} Unable to use image candidate ${imageUrl}:`, error);
      }
    }

    return createFallbackCanvas(characterName);
  }

  async function fetchImageAsDataUrl(url) {
    const buffer = await gmFetchArrayBuffer(url);
    const contentType = guessContentType(url);
    const blob = new Blob([buffer], { type: contentType });
    return blobToDataUrl(blob);
  }

  function gmFetchArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      const requestFn = typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function'
        ? GM.xmlHttpRequest
        : (typeof GM_xmlHttpRequest === 'function' ? GM_xmlHttpRequest : null);

      if (requestFn) {
        requestFn({
          method: 'GET',
          url,
          responseType: 'arraybuffer',
          anonymous: true,
          onload: (response) => {
            if (response.status >= 200 && response.status < 400 && response.response) {
              resolve(response.response);
            } else {
              reject(new Error(`HTTP ${response.status} while fetching image.`));
            }
          },
          onerror: () => reject(new Error('Network error while fetching image.'))
        });
        return;
      }

      fetch(url, { credentials: 'include' })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} while fetching image.`);
          }
          return response.arrayBuffer();
        })
        .then(resolve)
        .catch(reject);
    });
  }

  function gmFetchText(url) {
    return new Promise((resolve, reject) => {
      const requestFn = typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function'
        ? GM.xmlHttpRequest
        : (typeof GM_xmlHttpRequest === 'function' ? GM_xmlHttpRequest : null);

      if (requestFn) {
        requestFn({
          method: 'GET',
          url,
          responseType: 'text',
          anonymous: true,
          onload: (response) => {
            if (response.status >= 200 && response.status < 400) {
              resolve({
                text: response.responseText || response.response || '',
                status: response.status,
                headers: parseResponseHeaders(response.responseHeaders || '')
              });
            } else {
              reject(new Error(`HTTP ${response.status} while fetching ${url}`));
            }
          },
          onerror: () => reject(new Error(`Network error while fetching ${url}`))
        });
        return;
      }

      fetch(url, { credentials: 'include' })
        .then((response) => {
          return response.text().then((text) => ({
            text,
            status: response.status,
            headers: response.headers
          }));
        })
        .then((result) => {
          if (result.status >= 200 && result.status < 400) {
            resolve(result);
          } else {
            throw new Error(`HTTP ${result.status} while fetching ${url}`);
          }
        })
        .catch(reject);
    });
  }

  function parseResponseHeaders(headerString) {
    if (!headerString) return new Map();
    const map = new Map();
    const lines = headerString.split(/\r?\n/);
    for (const line of lines) {
      const index = line.indexOf(':');
      if (index === -1) continue;
      const name = line.slice(0, index).trim().toLowerCase();
      const value = line.slice(index + 1).trim();
      if (name) {
        if (map.has(name)) {
          map.set(name, `${map.get(name)}, ${value}`);
        } else {
          map.set(name, value);
        }
      }
    }
    return map;
  }

  function guessContentType(url) {
    const lower = url.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/png';
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read image data.'));
      reader.readAsDataURL(blob);
    });
  }

  function drawImageToCanvas(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const width = image.naturalWidth || image.width || 512;
        const height = image.naturalHeight || image.height || 768;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas);
      };
      image.onerror = () => reject(new Error('Failed to decode character image.'));
      image.src = dataUrl;
    });
  }

  function createFallbackCanvas(name) {
    const width = 1024;
    const height = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1f2937');
    gradient.addColorStop(1, '#312e81');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let i = 0; i < 16; i++) {
      const size = Math.random() * 120 + 40;
      const x = Math.random() * width;
      const y = Math.random() * height;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    }

    context.fillStyle = '#ffffff';
    context.font = 'bold 64px "Inter", "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const text = safeString(name || 'SillyTavern Card');
    wrapText(context, text, width / 2, height / 2, width * 0.7, 72);

    return canvas;
  }

  function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) {
      context.fillText('', x, y);
      return;
    }

    const lines = [];
    let current = '';

    for (const word of words) {
      const testLine = current ? `${current} ${word}` : word;
      const metrics = context.measureText(testLine);
      if (metrics.width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = testLine;
      }
    }

    if (current) {
      lines.push(current);
    }

    const totalHeight = (lines.length - 1) * lineHeight;
    let offsetY = y - totalHeight / 2;

    for (const line of lines) {
      context.fillText(line, x, offsetY);
      offsetY += lineHeight;
    }
  }

  function canvasToUint8Array(canvas) {
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function buildTextChunkData(keyword, text) {
    const keywordBytes = asciiToUint8Array(keyword);
    const textBytes = asciiToUint8Array(text);
    const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
    data.set(keywordBytes, 0);
    data[keywordBytes.length] = 0;
    data.set(textBytes, keywordBytes.length + 1);
    return data;
  }

  function asciiToUint8Array(str) {
    const array = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      array[i] = str.charCodeAt(i) & 0xff;
    }
    return array;
  }

  function insertTextChunk(pngBytes, chunkData) {
    let offset = 8;

    while (offset < pngBytes.length) {
      const length = readUint32(pngBytes, offset);
      const type = readChunkType(pngBytes, offset + 4);
      if (type === 'IEND') {
        break;
      }
      offset += 8 + length + 4;
    }

    const before = pngBytes.slice(0, offset);
    const after = pngBytes.slice(offset);
    const chunk = buildChunk('tEXt', chunkData);
    const result = new Uint8Array(before.length + chunk.length + after.length);
    result.set(before, 0);
    result.set(chunk, before.length);
    result.set(after, before.length + chunk.length);
    return result;
  }

  function readUint32(bytes, offset) {
    return (
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    ) >>> 0;
  }

  function readChunkType(bytes, offset) {
    return String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
  }

  function buildChunk(type, data) {
    const typeBytes = asciiToUint8Array(type);
    const chunk = new Uint8Array(8 + data.length + 4);
    writeUint32(chunk, 0, data.length);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    const crc = crc32(chunk.subarray(4, chunk.length - 4));
    writeUint32(chunk, chunk.length - 4, crc);
    return chunk;
  }

  function writeUint32(buffer, offset, value) {
    buffer[offset] = (value >>> 24) & 0xff;
    buffer[offset + 1] = (value >>> 16) & 0xff;
    buffer[offset + 2] = (value >>> 8) & 0xff;
    buffer[offset + 3] = value & 0xff;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      const index = (crc ^ bytes[i]) & 0xff;
      crc = (crc >>> 8) ^ CRC_TABLE[index];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function downloadBlob(bytes, filename) {
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 2000);
  }

  function slugify(text) {
    const normalized = safeString(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || 'character-card';
  }

  function getHeader(headers, name) {
    if (!headers || !name) return '';
    const lower = name.toLowerCase();
    if (typeof headers.get === 'function') {
      return headers.get(name) || headers.get(lower) || '';
    }
    if (headers instanceof Map) {
      return headers.get(lower) || headers.get(name) || '';
    }
    if (typeof headers === 'object') {
      return headers[name] || headers[lower] || '';
    }
    return '';
  }

  function interceptNetwork() {
    if (networkInterceptInstalled) return;
    networkInterceptInstalled = true;
    interceptFetch();
    interceptXhr();
  }

  function interceptFetch() {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;
    window.fetch = function fetchWithCapture() {
      const responsePromise = originalFetch.apply(this, arguments);
      responsePromise
        .then((response) => {
          processFetchResponse(response);
          return response;
        })
        .catch(() => {});
      return responsePromise;
    };
  }

  function processFetchResponse(response) {
    try {
      if (!response || typeof response.clone !== 'function') return;
      const cloned = response.clone();
      const contentType = (cloned.headers && cloned.headers.get && cloned.headers.get('content-type')) || '';
      if (!/application\/json/i.test(contentType || '')) return;
      cloned
        .json()
        .then((data) => {
          recordCharacterCandidateFromData(data);
        })
        .catch(() => {});
    } catch (error) {
      // ignore
    }
  }

  function interceptXhr() {
    if (typeof window.XMLHttpRequest !== 'function') return;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function openWithCapture(method, url) {
      this.__jaiRequestUrl = url;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function sendWithCapture() {
      this.addEventListener(
        'load',
        () => {
          try {
            const contentType = this.getResponseHeader && this.getResponseHeader('content-type');
            const isJsonType = /application\/json/i.test(contentType || '');
            const responseType = this.responseType;
            if (!isJsonType && responseType && responseType !== 'json' && responseType !== '') {
              return;
            }

            let data = null;

            if (responseType === '' || responseType === 'text' || responseType === undefined) {
              const text = this.responseText;
              if (!text) return;
              if (isJsonType || looksJsonLike(text)) {
                data = JSON.parse(text);
              }
            } else if (responseType === 'json') {
              data = this.response;
            }

            if (data) {
              recordCharacterCandidateFromData(data);
            }
          } catch (error) {
            // ignore network parsing issues
          }
        },
        { once: true }
      );
      return originalSend.apply(this, arguments);
    };
  }

  function looksJsonLike(text) {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }

  function recordCharacterCandidateFromData(data) {
    const candidate = findCharacterObject(data);
    if (!candidate) return null;
    return recordCharacterCandidate(candidate);
  }

  function recordCharacterCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;
    const snapshot = snapshotCharacter(candidate);
    latestCharacterData = snapshot;
    const identifiers = collectCandidateIdentifiers(snapshot);
    for (const id of identifiers) {
      const key = normalizeKey(id);
      if (key) {
        characterCache.set(key, snapshot);
      }
    }
    return snapshot;
  }

  function collectCandidateIdentifiers(character) {
    const identifiers = new Set();
    const idFields = [
      'id',
      '_id',
      'character_id',
      'uuid',
      'slug',
      'character_slug',
      'external_id',
      'public_id'
    ];

    for (const field of idFields) {
      if (character[field]) {
        identifiers.add(character[field]);
      }
    }

    if (character.user && typeof character.user === 'object') {
      const userId = character.user.id || character.user._id || character.user.uuid;
      if (userId) identifiers.add(`${userId}`);
      const userSlug = character.user.slug || character.user.username || character.user.handle;
      if (userSlug) identifiers.add(userSlug);
    }

    const name = character.name || character.title || character.display_name;
    if (name) identifiers.add(name);

    const pathKeys = getPathIdentifiers();
    for (const key of pathKeys) {
      identifiers.add(key);
    }

    return Array.from(identifiers);
  }

  function normalizeKey(value) {
    if (value === null || value === undefined) return '';
    const str = String(value).trim();
    return str ? str.toLowerCase() : '';
  }

  function snapshotCharacter(candidate) {
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(candidate);
      }
    } catch (error) {
      // ignore structuredClone failures
    }

    try {
      return JSON.parse(JSON.stringify(candidate));
    } catch (error) {
      // fallback to original reference
    }

    return candidate;
  }

  function getCachedCharacter() {
    const pathKeys = getPathIdentifiers();
    for (const key of pathKeys) {
      const normalized = normalizeKey(key);
      if (normalized && characterCache.has(normalized)) {
        return characterCache.get(normalized);
      }
    }
    return latestCharacterData;
  }

  function getPathIdentifiers() {
    const identifiers = new Set();
    const path = location.pathname || '';
    const segments = path.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    const slug = decodeURIComponent(lastSegment);
    if (slug) {
      identifiers.add(slug);
      const parts = slug.split('_');
      if (parts.length > 1) {
        identifiers.add(parts[0]);
      }
    }

    const params = new URLSearchParams(location.search || '');
    const idParam = params.get('id') || params.get('character_id');
    if (idParam) {
      identifiers.add(idParam);
    }

    return Array.from(identifiers);
  }
})();
