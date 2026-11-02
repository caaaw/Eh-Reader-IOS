// ==UserScript==
// @name         EH Reader
// @namespace    eh-reader
// @version      0.13.1
// @description  A mobile-friendly E-Hentai / ExHentai for iPhone and iPad Safari: gallery lists, search filters, saved searches, a full-screen reader, favorites, My Tags and History.
// @author       caaaw
// @license      MIT
// @homepageURL  https://github.com/caaaw/Eh-Reader-iOS
// @supportURL   https://github.com/caaaw/Eh-Reader-iOS/issues
// @updateURL    https://raw.githubusercontent.com/caaaw/Eh-Reader-iOS/main/eh-reader-iOS.user.js
// @downloadURL  https://raw.githubusercontent.com/caaaw/Eh-Reader-iOS/main/eh-reader-iOS.user.js
// @match        https://e-hentai.org/*
// @match        https://forums.e-hentai.org/*
// @match        https://exhentai.org/*
// @run-at       document-end
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.13.1';  // keep in sync with @version; shown under the Read button and in the menu
  const CONCURRENCY = 3;  // simultaneous image-page fetches; the site rate-limits aggressive clients
  const PRELOAD = 4;      // pages resolved ahead of the current one
  const MAX_RETRIES = 2;  // retries via the site's alternate-server ("nl") key

  // ---------- ExHentai sign-in ----------
  // Same approach as EhViewer: logging in on the E-Hentai forums sets ipb_member_id and
  // ipb_pass_hash on e-hentai.org; ExHentai accepts the same two cookies on exhentai.org.
  // igneous is ExHentai's own cookie, issued once those two are valid.
  // Credentials are kept in this script's GM storage (on this device only) because
  // Safari caps cookies written by scripts at 7 days, so they get re-applied as needed.

  const AUTH_KEYS = ['ipb_member_id', 'ipb_pass_hash', 'igneous'];
  const ONE_YEAR = 60 * 60 * 24 * 365;
  const isEx = location.hostname === 'exhentai.org';

  const readCookies = () => Object.fromEntries(document.cookie.split(';')
    .map(c => c.trim().split('='))
    .filter(([name]) => name)
    .map(([name, ...rest]) => [name, rest.join('=')]));

  const setCookie = (name, value) => {
    document.cookie = `${name}=${value}; domain=.exhentai.org; path=/; max-age=${ONE_YEAR}; secure; samesite=lax`;
  };
  // ExHentai may set its own cookies host-only (no domain attribute), so clear both variants.
  const deleteCookie = name => {
    document.cookie = `${name}=; domain=.exhentai.org; path=/; max-age=0; secure; samesite=lax`;
    document.cookie = `${name}=; path=/; max-age=0; secure; samesite=lax`;
  };

  async function loadAuth() {
    try { return JSON.parse(await GM.getValue('auth', '{}')) || {}; } catch { return {}; }
  }
  const saveAuth = auth => GM.setValue('auth', JSON.stringify(auth));

  // Sad Panda = an image served instead of the page; a blank page = bad or missing igneous.
  const exBlocked = () => isEx && (document.contentType?.startsWith('image/') ||
    !document.body || !document.body.innerHTML.trim());

  async function syncAuth() {
    const jar = readCookies();
    const saved = await loadAuth();

    if (!isEx) {
      // Capture the login after a normal sign-in on e-hentai.org / the forums.
      if (jar.ipb_member_id && jar.ipb_pass_hash &&
          (jar.ipb_member_id !== saved.ipb_member_id || jar.ipb_pass_hash !== saved.ipb_pass_hash)) {
        await saveAuth({ ...saved, ipb_member_id: jar.ipb_member_id, ipb_pass_hash: jar.ipb_pass_hash });
      }
      return;
    }

    if (saved.ipb_member_id && saved.ipb_pass_hash) {
      const missing = AUTH_KEYS.filter(k => saved[k] && !jar[k]);
      // Copy once per tab session so a rejected login can't cause a reload loop.
      if (missing.length && !sessionStorage.getItem('ehr:synced')) {
        sessionStorage.setItem('ehr:synced', '1');
        missing.forEach(k => setCookie(k, saved[k]));
        location.reload();
        return;
      }
    }
    // Keep the igneous ExHentai hands out, so it can be restored after Safari expires it.
    if (jar.igneous && jar.igneous !== 'mystery' && jar.igneous !== saved.igneous) {
      await saveAuth({ ...saved, igneous: jar.igneous });
    }
    if (exBlocked()) showLoginPanel(saved, true);
  }

  function showLoginPanel(saved, blocked) {
    if (document.getElementById('ehr-login')) return;
    const style = document.createElement('style');
    style.textContent = `
      #ehr-login { position: fixed; inset: 0; z-index: 2147483647; overflow-y: auto; background: #111; color: #ddd;
        font: 15px -apple-system, system-ui, sans-serif; padding: max(16px, env(safe-area-inset-top)) 16px 32px; box-sizing: border-box; }
      #ehr-login * { box-sizing: border-box; }
      #ehr-login h2 { margin: 0 0 8px; font-size: 20px; color: #fff; }
      #ehr-login p { margin: 0 0 12px; line-height: 1.45; color: #aaa; }
      #ehr-login .warn { color: #f0b37e; }
      #ehr-login label { display: block; margin: 12px 0 4px; font-size: 13px; color: #999; }
      #ehr-login input, #ehr-login textarea { width: 100%; padding: 10px; border: 1px solid #333; border-radius: 6px;
        background: #1c1c1c; color: #eee; font: 15px ui-monospace, Menlo, monospace; }
      #ehr-login textarea { height: 64px; }
      #ehr-login .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
      #ehr-login button { padding: 10px 14px; border: 0; border-radius: 6px; background: #333; color: #eee; font: inherit; }
      #ehr-login button.primary { background: #5c0d12; color: #fff; }
    `;
    const panel = document.createElement('div');
    panel.id = 'ehr-login';
    panel.innerHTML = `
      <h2>ExHentai sign-in</h2>
      <p class="warn" hidden data-el="blocked">ExHentai didn't accept this browser yet. A blank page usually means a bad
        igneous cookie; a Sad Panda means the login cookies are missing or your account isn't eligible yet.</p>
      <p class="warn" hidden data-el="diag"></p>
      <p><b>Easiest way:</b> sign in at forums.e-hentai.org in Safari, then open any e-hentai.org page.
        This script picks up your login automatically. Then open exhentai.org.</p>
      <p data-el="status"></p>
      <p><b>Or enter cookies by hand</b> (the same fields as EhViewer's cookie sign-in):</p>
      <label>Paste a cookie string (optional, fills the fields below)</label>
      <textarea data-el="paste" placeholder="ipb_member_id=…; ipb_pass_hash=…; igneous=…"></textarea>
      <label>ipb_member_id</label><input data-el="ipb_member_id" autocapitalize="off" autocomplete="off">
      <label>ipb_pass_hash</label><input data-el="ipb_pass_hash" autocapitalize="off" autocomplete="off">
      <label>igneous (optional)</label><input data-el="igneous" autocapitalize="off" autocomplete="off">
      <div class="row">
        <button class="primary" data-act="save">Save &amp; open ExHentai</button>
        <button data-act="igneous" hidden>Clear igneous &amp; retry</button>
        <button data-act="forget">Forget saved login</button>
        <button data-act="close">Close</button>
      </div>`;
    const el = name => panel.querySelector(`[data-el="${name}"]`);

    el('blocked').hidden = !blocked;
    if (blocked) {
      // What this page actually got, so you can tell which case you're in.
      const jar = readCookies();
      const seen = k => jar[k] ? (k === 'igneous' ? `"${jar[k] === 'mystery' ? 'mystery' : 'set'}"` : 'yes') : 'no';
      el('diag').hidden = false;
      el('diag').textContent =
        `Diagnosis: ${document.contentType?.startsWith('image/') ? 'Sad Panda image' : 'blank page'}. ` +
        `Cookies this page can see: member ID ${seen('ipb_member_id')}, pass hash ${seen('ipb_pass_hash')}, ` +
        `igneous ${seen('igneous')}.` +
        (jar.igneous === 'mystery' ? ' igneous "mystery" usually means ExHentai is refusing this account.' : '');
    }
    panel.querySelector('[data-act=igneous]').hidden = !isEx;
    el('status').textContent = saved.ipb_member_id
      ? `Saved login: member ${saved.ipb_member_id}${saved.igneous ? ', igneous saved' : ''}.`
      : 'No login saved yet.';
    for (const k of AUTH_KEYS) el(k).value = saved[k] || '';

    el('paste').addEventListener('input', () => {
      for (const part of el('paste').value.split(/[;\n]/)) {
        const [name, ...rest] = part.trim().split('=');
        if (AUTH_KEYS.includes(name)) el(name).value = rest.join('=').trim();
      }
    });

    panel.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') {
        panel.remove();
        if (location.hash === '#ehr-login') history.replaceState(null, '', location.pathname + location.search);
      } else if (act === 'save') {
        const auth = Object.fromEntries(AUTH_KEYS.map(k => [k, el(k).value.trim()]).filter(([, v]) => v));
        if (!auth.ipb_member_id || !auth.ipb_pass_hash) return alert('ipb_member_id and ipb_pass_hash are both required.');
        await saveAuth(auth);
        sessionStorage.removeItem('ehr:synced');
        if (!isEx) return void (location.href = 'https://exhentai.org/');
        AUTH_KEYS.forEach(k => auth[k] ? setCookie(k, auth[k]) : deleteCookie(k));
        location.replace('https://exhentai.org/');
      } else if (act === 'igneous') {
        // Lets ExHentai issue a fresh igneous on the next load.
        await saveAuth({ ...(await loadAuth()), igneous: undefined });
        deleteCookie('igneous');
        sessionStorage.removeItem('ehr:synced');
        location.replace('https://exhentai.org/');
      } else if (act === 'forget') {
        if (!confirm('Forget the saved login? (Your e-hentai.org session stays signed in.)')) return;
        await GM.deleteValue('auth');
        if (isEx) AUTH_KEYS.forEach(deleteCookie);
        location.reload();
      }
    });

    (document.head || document.documentElement).append(style);
    (document.body || document.documentElement).append(panel);
  }

  // Open the panel manually by visiting any of the sites with #ehr-login on the end.
  const checkHash = async () => {
    if (location.hash === '#ehr-login') showLoginPanel(await loadAuth(), exBlocked());
  };
  window.addEventListener('hashchange', checkHash);
  syncAuth().then(checkHash);

  // ---------- page setup ----------

  if (location.hostname === 'forums.e-hentai.org' || exBlocked()) return;
  const [, , gid, token] = location.pathname.split('/');
  const isGallery = location.pathname.startsWith('/g/') && Boolean(gid && token);
  const galleryUrl = `${location.origin}/g/${gid}/${token}/`;

  // ---------- storage ----------

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem('ehr:' + key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('ehr:' + key, JSON.stringify(value)); } catch {}
    },
  };
  const settings = { mode: 'scroll', rtl: false, ...store.get('settings', {}) };

  const THEMES = [
    { id: 'classic', name: 'Classic' },
    { id: 'midnight', name: 'Midnight' },
    { id: 'retrowave', name: 'Retrowave' },
  ];
  const applyTheme = id => {
    document.documentElement.dataset.ehrTheme = THEMES.some(t => t.id === id) ? id : 'classic';
  };
  applyTheme(store.get('theme', 'classic'));

  // ---------- fetching ----------

  const abs = href => new URL(href, location.href).href;

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }

  function imagePageLinks(doc) {
    return [...doc.querySelectorAll('#gdt a[href*="/s/"]')].map(a => abs(a.getAttribute('href')));
  }

  // Number of thumbnail pages, read from the gallery's ?p= pagination links.
  function thumbPageCount(doc) {
    let max = 0;
    for (const a of doc.querySelectorAll('a[href*="?p="]')) {
      const u = new URL(a.getAttribute('href'), location.href);
      if (!u.pathname.startsWith(`/g/${gid}/`)) continue;
      max = Math.max(max, Number(u.searchParams.get('p')) || 0);
    }
    return max + 1;
  }

  // "Length: 123 pages" from the gallery details table; 0 if it can't be found.
  function galleryLength(doc) {
    for (const td of doc.querySelectorAll('#gdd td.gdt1')) {
      if (/length/i.test(td.textContent)) return parseInt(td.nextElementSibling?.textContent, 10) || 0;
    }
    return 0;
  }

  // Walks the thumbnail pages in order, handing each batch of image-page links to onLinks.
  // One request at a time on purpose: it's the same load as paging through the gallery by hand.
  async function collectPages(onLinks, shouldStop) {
    const count = thumbPageCount(document);
    const currentP = Number(new URLSearchParams(location.search).get('p')) || 0;
    for (let p = 0; p < count; p++) {
      const doc = p === currentP ? document : await fetchDoc(`${galleryUrl}?p=${p}`);
      if (shouldStop()) return;
      onLinks(imagePageLinks(doc), p + 1, count);
    }
  }

  // Fetches an image page (/s/...) and returns the full image URL plus the
  // key the site uses to request the same image from a different server.
  async function resolveImage(pageUrl, nl) {
    const url = nl ? `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}nl=${encodeURIComponent(nl)}` : pageUrl;
    const doc = await fetchDoc(url);
    const img = doc.querySelector('#img');
    if (!img) throw new Error('no image found');
    const retry = doc.querySelector('#loadfail')?.getAttribute('onclick')?.match(/nl\('([^']+)'\)/);
    return { src: abs(img.getAttribute('src')), nl: retry?.[1] ?? null };
  }

  // ---------- UI ----------

  const style = document.createElement('style');
  style.textContent = `
    /* ----- styles (themes), picked from the menu; every colour below goes through these ----- */
    :root, :root[data-ehr-theme="classic"] {
      --ehr-bg: #111; --ehr-reader-bg: #000; --ehr-surface: #1b1b1b; --ehr-bar: rgba(20, 20, 20, .92);
      --ehr-control: #2a2a2a; --ehr-line: #333; --ehr-sunken: #222; --ehr-tag: #262626;
      --ehr-text: #ddd; --ehr-strong: #fff; --ehr-subtle: #bbb; --ehr-muted: #888; --ehr-faint: #555;
      --ehr-accent: #5c0d12; --ehr-accent-soft: #c0505a;
    }
    :root[data-ehr-theme="midnight"] {
      --ehr-bg: #0d0b14; --ehr-reader-bg: #06050a; --ehr-surface: #17132a; --ehr-bar: rgba(23, 19, 42, .92);
      --ehr-control: #272046; --ehr-line: #352c5c; --ehr-sunken: #1c1733; --ehr-tag: #241d40;
      --ehr-text: #e0dbf3; --ehr-strong: #fff; --ehr-subtle: #bdb3e0; --ehr-muted: #8f86b0; --ehr-faint: #5a5378;
      --ehr-accent: #5b2a9e; --ehr-accent-soft: #a47de6;
    }
    :root[data-ehr-theme="retrowave"] {
      --ehr-bg: linear-gradient(180deg, #2b0a4a 0%, #14052b 45%, #07021a 100%);
      --ehr-reader-bg: #07021a; --ehr-surface: #1b0636; --ehr-bar: rgba(27, 6, 54, .9);
      --ehr-control: #2e0d55; --ehr-line: #4a1a7a; --ehr-sunken: #1f0840; --ehr-tag: #2a0b4d;
      --ehr-text: #f6e8ff; --ehr-strong: #fff; --ehr-subtle: #e0b8ff; --ehr-muted: #b48ad8; --ehr-faint: #7a55a0;
      --ehr-accent: linear-gradient(90deg, #ff2a6d, #d300c5); --ehr-accent-soft: #05d9e8;
    }
    /* Retrowave extras: neon cyan edges and glowing pink headings. */
    :root[data-ehr-theme="retrowave"] .ehm-header { border-bottom-color: #05d9e8;
      box-shadow: 0 2px 16px rgba(5, 217, 232, .35); }
    :root[data-ehr-theme="retrowave"] .ehm-pagetitle,
    :root[data-ehr-theme="retrowave"] .ehm-drawer-title,
    :root[data-ehr-theme="retrowave"] .ehm-dtitle { text-shadow: 0 0 6px #ff2a6d, 0 0 18px rgba(255, 42, 109, .55); }
    :root[data-ehr-theme="retrowave"] .ehm-pagetitle,
    :root[data-ehr-theme="retrowave"] .ehm-drawer-title { text-transform: uppercase; letter-spacing: 2px; }
    :root[data-ehr-theme="retrowave"] .ehm-tag { border: 1px solid rgba(5, 217, 232, .45); }
    :root[data-ehr-theme="retrowave"] .ehm-cell { box-shadow: 0 0 0 1px rgba(255, 42, 109, .45); }
    :root[data-ehr-theme="retrowave"] .ehm-card { border-bottom-color: rgba(5, 217, 232, .18); }
    :root[data-ehr-theme="retrowave"] .ehm-btn.primary,
    :root[data-ehr-theme="retrowave"] #ehr-open { box-shadow: 0 0 14px rgba(255, 42, 109, .6); }
    :root[data-ehr-theme="retrowave"] #ehr-top { border-bottom: 1px solid #05d9e8; }
    /* While reading, the reader is the page itself (the gallery page is hidden, not covered),
       so swipes scroll the document and Safari tucks its toolbar away as it would on any site. */
    html.ehr-open, html.ehr-open body { margin: 0 !important; background: var(--ehr-reader-bg) !important; }
    html.ehr-open body > *:not(#ehr) { display: none !important; }
    #ehr { position: relative; min-height: 100vh; min-height: 100lvh; background: var(--ehr-reader-bg); color: var(--ehr-text);
      font: 14px -apple-system, system-ui, sans-serif; -webkit-user-select: none; user-select: none; }
    #ehr-view { position: relative; }
    #ehr-status { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      padding: 24px; text-align: center; }
    .ehr-page { position: relative; max-width: 1000px; margin: 0 auto; }
    .ehr-page img { display: block; width: 100%; height: auto; }
    .ehr-page.pending, .ehr-page.failed { aspect-ratio: 7 / 10; display: flex; flex-direction: column; gap: 10px;
      align-items: center; justify-content: center; color: var(--ehr-faint); text-align: center; padding: 16px; box-sizing: border-box; }
    .ehr-page.pending img, .ehr-page.failed img { display: none; }
    .ehr-stage, .ehr-load { display: none; }
    .ehr-page.pending .ehr-stage { display: block; font-size: 14px; color: var(--ehr-muted); }
    .ehr-page.pending[data-loading] .ehr-load { display: block; width: 60%; max-width: 240px; height: 4px;
      border-radius: 2px; background: linear-gradient(90deg, var(--ehr-control) 30%, var(--ehr-accent-soft) 50%, var(--ehr-control) 70%);
      background-size: 300% 100%; animation: ehr-load 1.1s linear infinite; }
    @keyframes ehr-load { from { background-position: 100% 0; } to { background-position: 0 0; } }
    .ehr-page.pending::before { content: attr(data-n); font-size: 32px; }
    .ehr-page.failed::before { content: attr(data-msg); }
    /* One page per screen, sized to the toolbar-hidden height. While Safari's toolbar is showing
       the page is slightly taller than the screen, so one small swipe up scrolls and hides it. */
    #ehr.paged #ehr-view { height: 100vh; height: 100lvh; }
    #ehr.paged .ehr-page { display: none; }
    #ehr.paged .ehr-page.cur { display: flex; align-items: center; justify-content: center; height: 100%;
      max-width: none; aspect-ratio: auto; }
    #ehr.paged .ehr-page.cur img { width: auto; max-width: 100%; max-height: 100%; object-fit: contain; }
    .ehr-bar { position: fixed; z-index: 1; left: 0; right: 0; display: flex; gap: 10px; align-items: center;
      padding: 10px 12px; background: var(--ehr-bar); transition: transform .2s; }
    #ehr-top { top: 0; padding-top: max(10px, env(safe-area-inset-top)); }
    /* No background behind the slider so it never hides the image; the shadow keeps it visible on light pages. */
    #ehr-bottom { bottom: 0; padding-bottom: max(10px, env(safe-area-inset-bottom)); background: transparent; }
    #ehr-slider { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .8)); opacity: .35; transition: opacity .2s; }
    #ehr-slider.held { opacity: 1; }
    #ehr.hide-ui #ehr-top { transform: translateY(-100%); }
    #ehr.hide-ui #ehr-bottom { transform: translateY(100%); }
    .ehr-bar button { min-width: 52px; min-height: 48px; padding: 10px 16px; border: 0; border-radius: 10px;
      background: var(--ehr-control); color: var(--ehr-text); font: 600 17px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehr-bar button[data-act=close] { font-size: 20px; }
    .ehr-bar button[hidden] { display: none; }
    #ehr-count { flex: 1; text-align: center; font-size: 16px; }

    /* Phone in landscape: the buttons stack in a narrow rail on the right edge, and the pages
       are laid out beside it (never under it). The space stays reserved when the controls are
       hidden so pages don't jump sideways. */
    @media (orientation: landscape) and (max-height: 540px) {
      #ehr-view { padding-right: 60px; box-sizing: border-box; }
      #ehr-top { top: 0; bottom: 0; left: auto; right: 0; width: 60px; flex-direction: column; gap: 6px;
        padding: 8px 6px; background: var(--ehr-surface); }
      #ehr-top button { width: 100%; min-width: 0; min-height: 52px; padding: 6px 2px; border-radius: 8px;
        font-size: 12px; }
      #ehr-top button[data-act=close] { font-size: 18px; }
      #ehr-count { flex: 0 0 auto; font-size: 11px; line-height: 1.3; word-break: break-word; }
      #ehr.hide-ui #ehr-top { transform: translateX(100%); }
      #ehr-bottom { right: 60px; padding-top: 6px; padding-bottom: max(6px, env(safe-area-inset-bottom)); }
    }
    #ehr-slider { flex: 1; }
    #ehr-bubble { position: absolute; bottom: calc(100% + 10px); transform: translateX(-50%); padding: 8px 14px;
      border-radius: 10px; background: var(--ehr-accent); color: var(--ehr-strong); font: 700 20px -apple-system, system-ui, sans-serif;
      white-space: nowrap; pointer-events: none; box-shadow: 0 2px 10px rgba(0, 0, 0, .5); }
    #ehr-bubble[hidden] { display: none; }
    #ehr-open { position: fixed; right: 16px; bottom: calc(20px + env(safe-area-inset-bottom)); z-index: 2147483646;
      min-width: 120px; min-height: 60px; padding: 16px 28px; border: 0; border-radius: 30px;
      background: var(--ehr-accent); color: var(--ehr-strong); font: 700 19px -apple-system, system-ui, sans-serif;
      box-shadow: 0 3px 12px rgba(0, 0, 0, .5); touch-action: manipulation; }
    #ehr-open small { display: block; margin-top: 2px; font-size: 10px; font-weight: 400; opacity: .7; }
  `;
  document.head.append(style);

  const readLabel = () => {
    const saved = store.get('progress:' + gid, 0);
    return saved > 0 ? `Resume p.${saved + 1}` : 'Read';
  };
  const openBtn = document.createElement('button');
  openBtn.id = 'ehr-open';
  openBtn.onclick = () => openReader();
  // Refreshes every Read button (the floating one and the mobile gallery page's) after reading.
  const updateOpenBtn = () => {
    openBtn.textContent = readLabel();
    const ver = document.createElement('small');
    ver.textContent = 'v' + VERSION;
    openBtn.append(ver);
    for (const btn of document.querySelectorAll('[data-ehr-read]')) btn.textContent = readLabel();
  };
  updateOpenBtn();
  if (isGallery) document.body.append(openBtn);

  let links = null;  // image page URLs, cached so reopening is instant

  // startAt: 0-based page to open at; defaults to the saved reading position.
  async function openReader(startAt) {
    if (document.getElementById('ehr')) return;

    const root = document.createElement('div');
    root.id = 'ehr';
    root.innerHTML = `
      <div id="ehr-view"></div>
      <div id="ehr-status">Loading…</div>
      <div class="ehr-bar" id="ehr-top">
        <button data-act="close">✕</button>
        <span id="ehr-count"></span>
        <button data-act="mode"></button>
        <button data-act="dir"></button>
      </div>
      <div class="ehr-bar" id="ehr-bottom">
        <input id="ehr-slider" type="range" min="1" value="1">
        <div id="ehr-bubble" hidden></div>
      </div>`;
    const $ = sel => root.querySelector(sel);
    const view = $('#ehr-view');
    const status = $('#ehr-status');
    const count = $('#ehr-count');
    const slider = $('#ehr-slider');

    // Hide the gallery page and let the reader be the page (see the html.ehr-open CSS).
    const pageScrollY = window.scrollY;
    document.body.append(root);
    document.documentElement.classList.add('ehr-open');
    window.scrollTo(0, 0);
    history.pushState({ ehr: true }, '');  // lets the iOS back swipe close the reader

    let pages = null;     // set once the reader starts showing pages
    let cur = 0;
    let closed = false;
    let listing = '';     // background page-list progress, shown next to the page counter

    const onPop = () => close(true);
    const onKey = e => {
      if (e.key === 'Escape') close();
      else if (pages && settings.mode === 'paged' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft'))
        step((e.key === 'ArrowRight') !== settings.rtl ? 1 : -1);
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);

    function close(fromPop) {
      if (closed) return;
      closed = true;
      root.remove();
      document.documentElement.classList.remove('ehr-open');
      window.scrollTo(0, pageScrollY);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      if (!fromPop && history.state?.ehr) history.back();
      updateOpenBtn();
      recordHistory();  // keeps the page number shown in History current
    }

    function syncControls() {
      const paged = settings.mode === 'paged';
      root.classList.toggle('paged', paged);
      $('[data-act=mode]').textContent = paged ? 'Paged' : 'Scroll';
      $('[data-act=dir]').textContent = settings.rtl ? 'RTL' : 'LTR';
      $('[data-act=dir]').hidden = !paged;
      slider.dir = paged && settings.rtl ? 'rtl' : 'ltr';
    }

    function applySettings() {
      store.set('settings', settings);
      syncControls();
      if (!pages) return;
      window.scrollTo(0, 0);
      setCurrent(cur, { scroll: true });
    }

    // ----- page loading -----
    // Queued pages are served nearest-to-the-current-page first, and ones you've moved far
    // away from are dropped (they re-queue if you come back). Otherwise fast scrolling or a
    // mode switch leaves the page you're looking at stuck behind dozens of others.

    const waiting = new Set();
    let active = 0;
    const indexOf = page => page.wrap.dataset.n - 1;

    // The label and animated bar under a placeholder's page number. Byte-level progress isn't
    // available for plain <img> loads in Safari, so this shows which step the page is on.
    function setStage(page, text, loading) {
      page.stage.textContent = text;
      page.wrap.toggleAttribute('data-loading', loading);
    }

    function pump() {
      for (const page of waiting) {
        const i = indexOf(page);
        if (i < cur - 1 || i > cur + PRELOAD * 2) {
          waiting.delete(page);
          page.state = 'idle';
          setStage(page, '', false);
        }
      }
      while (active < CONCURRENCY && waiting.size) {
        let next = null;
        let best = Infinity;
        for (const page of waiting) {
          const d = Math.abs(indexOf(page) - cur);
          if (d < best) { best = d; next = page; }
        }
        waiting.delete(next);
        fetchImage(next);
      }
    }

    function fetchImage(page) {
      active++;
      page.state = 'loading';
      setStage(page, 'Finding image…', true);
      resolveImage(page.url, page.retryKey)
        .then(({ src, nl: nextNl }) => {
          if (closed) return;
          page.nl = nextNl;
          if (/\/509s?\.gif$/.test(src)) return fail(page, 'Image quota exceeded (509). Tap to retry later.');
          setStage(page, 'Downloading…', true);
          page.img.src = src;
        })
        .catch(() => fail(page))
        .finally(() => {
          active--;
          if (!closed) pump();
        });
    }

    function load(page, nl) {
      page.state = 'queued';
      page.retryKey = nl;
      setStage(page, 'Queued', false);
      page.wrap.classList.remove('failed');
      page.wrap.classList.add('pending');
      waiting.add(page);
      pump();
    }

    function retry(page) {
      if (page.retries < MAX_RETRIES && page.nl) {
        page.retries++;
        load(page, page.nl);
      } else {
        fail(page);
      }
    }

    function fail(page, msg) {
      if (closed) return;
      page.state = 'failed';
      setStage(page, '', false);
      page.wrap.classList.remove('pending');
      page.wrap.classList.add('failed');
      page.wrap.dataset.msg = msg || `Page ${page.wrap.dataset.n} failed. Tap to retry.`;
    }

    const ensure = i => {
      const page = pages[i];
      if (!page || page.state !== 'idle') return;
      if (page.url) load(page);
      else setStage(page, 'Waiting for page list…', false);
    };

    const updateCount = () => { count.textContent = `${cur + 1} / ${pages.length}${listing}`; };

    function setCurrent(i, { scroll = false } = {}) {
      if (!pages.length) return;
      cur = Math.max(0, Math.min(i, pages.length - 1));
      updateCount();
      slider.value = cur + 1;
      store.set('progress:' + gid, cur);
      for (let k = cur; k <= cur + PRELOAD; k++) ensure(k);
      pump();  // re-prioritise anything already queued around the new position
      if (settings.mode === 'paged') {
        view.querySelector('.ehr-page.cur')?.classList.remove('cur');
        pages[cur].wrap.classList.add('cur');
      } else if (scroll) {
        jumpTo(cur);
      }
    }

    // Scrolls a page into view without the scroll tracker second-guessing it: near the end of
    // a gallery the page can't reach the top of the screen, which would read as the page before.
    // Tracking resumes on the next touch or wheel.
    let jumped = false;
    function jumpTo(i) {
      jumped = true;
      pages[i].wrap.scrollIntoView();
    }
    root.addEventListener('touchstart', () => { jumped = false; }, { passive: true });
    root.addEventListener('wheel', () => { jumped = false; }, { passive: true });

    const step = d => setCurrent(cur + d);

    // ----- input -----

    root.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') return close();
      if (act === 'mode') {
        settings.mode = settings.mode === 'paged' ? 'scroll' : 'paged';
        return applySettings();
      }
      if (act === 'dir') {
        settings.rtl = !settings.rtl;
        return applySettings();
      }
      if (!pages || e.target.closest('.ehr-bar')) return;

      const failed = e.target.closest('.ehr-page.failed');
      if (failed) {
        const page = pages[failed.dataset.n - 1];
        page.retries = 0;
        return load(page, page.nl);
      }
      if (settings.mode === 'paged') {
        const x = e.clientX / window.innerWidth;
        if (x < 1 / 3) return step(settings.rtl ? 1 : -1);
        if (x > 2 / 3) return step(settings.rtl ? -1 : 1);
      }
      root.classList.toggle('hide-ui');
    });

    let touchX = null;
    let touchY = 0;
    view.addEventListener('touchstart', e => {
      touchX = e.touches.length === 1 ? e.touches[0].clientX : null;
      touchY = e.touches[0]?.clientY ?? 0;
    }, { passive: true });
    view.addEventListener('touchend', e => {
      if (touchX === null || !pages || settings.mode !== 'paged') return;
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      touchX = null;
      // Only mostly-sideways swipes turn pages; vertical ones scroll (and hide Safari's toolbar).
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step((dx < 0) !== settings.rtl ? 1 : -1);
    });

    // Rotating re-flows every page, so keep the one you were reading in view. Resizes that
    // only change the height are Safari's toolbar sliding in or out, and are ignored.
    let lastWidth = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      if (pages && settings.mode === 'scroll') jumpTo(cur);
    };

    // In scroll mode the current page is whichever one crosses the upper third of the screen.
    let ticking = false;
    const onScroll = () => {
      if (!pages || settings.mode !== 'scroll' || ticking || jumped) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (window.innerWidth !== lastWidth) return;  // mid-rotation; onResize re-anchors
        const line = window.innerHeight / 3;
        let i = cur;
        while (i > 0 && pages[i].wrap.getBoundingClientRect().top > line) i--;
        while (i < pages.length - 1 && pages[i].wrap.getBoundingClientRect().bottom <= line) i++;
        if (i !== cur) setCurrent(i);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    // While the slider is dragged, a bubble above the thumb shows which page you'd land on.
    const bubble = $('#ehr-bubble');
    function showBubble() {
      const max = Number(slider.max) || 1;
      const frac = max > 1 ? (slider.value - 1) / (max - 1) : 0;
      const pos = slider.dir === 'rtl' ? 1 - frac : frac;
      const thumb = 28;  // approximate width of the iOS slider thumb
      const bar = slider.parentElement.getBoundingClientRect();
      const track = slider.getBoundingClientRect();
      const x = track.left - bar.left + thumb / 2 + pos * (track.width - thumb);
      bubble.textContent = `${slider.value} / ${max}`;
      bubble.hidden = false;
      const half = bubble.offsetWidth / 2;
      bubble.style.left = `${Math.min(Math.max(x, half + 4), bar.width - half - 4)}px`;
    }
    const hideBubble = () => { bubble.hidden = true; };

    slider.addEventListener('input', () => {
      count.textContent = `${slider.value} / ${pages?.length ?? 0}${listing}`;
      showBubble();
    });
    slider.addEventListener('change', () => {
      hideBubble();
      if (pages) setCurrent(slider.value - 1, { scroll: true });
    });
    // The slider is faded at rest and fully opaque only while a finger is on it.
    const holdSlider = on => slider.classList.toggle('held', on);
    slider.addEventListener('touchstart', () => holdSlider(true), { passive: true });
    slider.addEventListener('pointerdown', () => holdSlider(true));
    for (const type of ['touchend', 'touchcancel', 'pointerup', 'pointercancel']) {
      slider.addEventListener(type, () => {
        holdSlider(false);
        hideBubble();
      });
    }

    syncControls();

    // ----- build -----
    // The reader opens on the first batch of links with a placeholder per page, and the
    // remaining image-page links are filled in as the thumbnail pages load in the background.

    const list = [];
    const seen = new Set();
    let filled = 0;
    const target = Number.isInteger(startAt) ? startAt : store.get('progress:' + gid, 0);

    function addPage() {
      const wrap = document.createElement('div');
      wrap.className = 'ehr-page pending';
      wrap.dataset.n = list.length + 1;
      const img = document.createElement('img');
      const stage = document.createElement('span');
      stage.className = 'ehr-stage';
      const bar = document.createElement('i');
      bar.className = 'ehr-load';
      wrap.append(img, stage, bar);
      view.append(wrap);
      const page = { url: null, wrap, img, stage, nl: null, retries: 0, state: 'idle' };
      img.onload = () => {
        page.state = 'done';
        setStage(page, '', false);
        wrap.classList.remove('pending');
      };
      img.onerror = () => retry(page);
      list.push(page);
    }

    function start() {
      pages = list;
      status.remove();
      setCurrent(Math.min(target, list.length - 1), { scroll: true });
    }

    function addLinks(urls) {
      for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        if (filled === list.length) addPage();
        list[filled++].url = url;
      }
      slider.max = list.length;
      if (!pages && list.length > target) start();
      else if (pages) setCurrent(cur);  // starts loading links that just arrived near the current page
    }

    const cacheKey = 'ehr:links:' + gid;
    let cached = links;
    try { cached ??= JSON.parse(sessionStorage.getItem(cacheKey)); } catch {}

    if (cached?.length) {
      addLinks(cached);
    } else {
      try {
        await collectPages((urls, p, n) => {
          if (!pages) {
            // Make enough placeholders to open at the saved page right away. The thumbnail
            // page count gives an upper bound even if the "Length" line can't be read;
            // extras are trimmed once the real list is known.
            const expected = Math.max(galleryLength(document), urls.length * n, target + 1);
            while (list.length < expected) addPage();
          }
          listing = p < n ? ` · listing ${p}/${n}` : '';
          addLinks(urls);
        }, () => closed);
      } catch (err) {
        if (!pages) {
          status.textContent = `Couldn't load the gallery (${err.message}).`;
          return;
        }
        listing = ` · list failed (${err.message})`;
        updateCount();
        return;
      }
      if (closed) return;
      links = list.slice(0, filled).map(page => page.url);
      try { sessionStorage.setItem(cacheKey, JSON.stringify(links)); } catch {}
    }

    // Drop any placeholders the gallery length over-counted.
    while (list.length > filled) list.pop().wrap.remove();
    slider.max = list.length;
    if (!filled) {
      root.append(status);
      status.textContent = 'No pages found. If the gallery shows a content warning, accept it first, then tap Read again.';
      return;
    }
    if (!pages) start();
    else setCurrent(cur);
  }

  // ---------- mobile site UI (gallery lists and gallery pages) ----------
  // EhViewer-style screens built over the site's own pages. List cards take their details
  // from the site's JSON API (the same "gdata" call EhViewer uses), so they work whichever
  // list layout your account has selected. The site's nav links move into a slide-out drawer.

  const mobileUi = store.get('mobileUi', true);
  const LIST_PATH = /^\/(watched|popular|favorites\.php|tag\/.+|uploader\/.+)?$/;
  const GALLERY_RE = /\/g\/(\d+)\/([0-9a-f]{10})\/?/;
  const API_URL = isEx ? 'https://s.exhentai.org/api.php' : 'https://api.e-hentai.org/api.php';
  const CATEGORY_COLORS = {
    'Doujinshi': '#9e2720', 'Manga': '#db6c24', 'Artist CG': '#d38f1d', 'Game CG': '#6a936d',
    'Western': '#ab9f60', 'Non-H': '#5f5fff', 'Image Set': '#325ca2', 'Cosplay': '#6a32a2',
    'Asian Porn': '#a23282', 'Misc': '#777777',
  };
  // Colours of favorite categories 0-9, matching the site's.
  const FAV_COLORS = ['#666', '#e00', '#f80', '#dd0', '#080', '#9e4', '#3bd', '#22d', '#828', '#e8c'];

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style') el.style.cssText = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value);
    }
    el.append(...children.flat().filter(c => c != null && c !== false && c !== ''));
    return el;
  }

  // API titles come HTML-escaped; a <textarea> decodes entities without running anything.
  const decode = s => {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  };

  // Lets a cover drop its portrait placeholder shape and take its real one. (onload is listed
  // before src in h() props so the listener is in place even for cached images.)
  const markLoaded = e => e.target.classList.add('loaded');

  const stars = rating => h('span', { class: 'ehm-stars', style: `--r:${(Number(rating) || 0) / 5}` });

  const language = tags =>
    tags?.find(t => t.startsWith('language:') && !/:(translated|rewrite|speechless)$/.test(t))?.slice(9) ?? '';

  async function gdata(items) {
    const out = new Map();
    for (let i = 0; i < items.length; i += 25) {
      // Plain-text body (no JSON content type) keeps this a simple cross-origin request.
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ method: 'gdata', gidlist: items.slice(i, i + 25).map(g => [g.gid, g.token]), namespace: 1 }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      for (const g of (await res.json()).gmetadata || []) if (!g.error) out.set(g.gid, g);
    }
    return out;
  }

  // Gallery links on a list page, in order, with the page's own title and thumbnail as fallbacks.
  function listGalleries(doc) {
    const scope = doc.querySelector('.itg') || doc;
    const found = new Map();
    for (const a of scope.querySelectorAll('a[href*="/g/"]')) {
      const m = a.getAttribute('href').match(GALLERY_RE);
      if (!m || found.has(m[1])) continue;
      const row = a.closest('tr, .gl1t, .gl1e, .gl1m, .gl1c') || a;
      const img = row.querySelector('img');
      const thumb = img && (img.getAttribute('data-src') || img.getAttribute('src'));
      found.set(m[1], {
        gid: Number(m[1]),
        token: m[2],
        url: abs(a.getAttribute('href')),
        title: (row.querySelector('.glink')?.textContent || img?.title || img?.alt || a.textContent).trim(),
        pageThumb: thumb ? abs(thumb) : '',
      });
    }
    return [...found.values()];
  }

  // The site pages results with "Next" links (?next=…); older pages use numbered ones.
  function nextPageUrl(doc) {
    const a = doc.querySelector('#dnext[href], #unext[href]') ||
      [...doc.querySelectorAll('.searchnav a[href]')].find(x => /[?&]next=/.test(x.getAttribute('href'))) ||
      doc.querySelector('.ptt td.ptds + td a[href]');
    return a ? abs(a.getAttribute('href')) : null;
  }

  // entry (optional) is the saved-list record for this card: the cover's shape is stored in it
  // once known, and reused on restore so the page lays out at the same height before covers load.
  function galleryCard(item, meta, entry = {}) {
    const cat = meta?.category ?? '';
    const lang = language(meta?.tags);
    return h('a', { class: 'ehm-card', href: item.url, 'data-gid': item.gid },
      h('img', {
        class: entry.ratio ? 'ehm-thumb loaded' : 'ehm-thumb',
        style: entry.ratio ? `aspect-ratio:${entry.ratio}` : null,
        onload: e => {
          markLoaded(e);
          entry.ratio = e.target.naturalWidth / e.target.naturalHeight || entry.ratio;
        },
        src: meta?.thumb || item.pageThumb, loading: 'lazy', alt: '',
        onerror: e => { if (item.pageThumb && e.target.src !== item.pageThumb) e.target.src = item.pageThumb; },
      }),
      h('div', { class: 'ehm-info' },
        h('div', { class: 'ehm-title' }, decode(meta?.title || item.title)),
        meta?.uploader && h('div', { class: 'ehm-muted' }, meta.uploader),
        meta && h('div', { class: 'ehm-row' }, stars(meta.rating), h('span', { class: 'ehm-muted' }, `${meta.filecount} pages`)),
        h('div', { class: 'ehm-row ehm-bottom' },
          cat && h('span', { class: 'ehm-cat', style: `background:${CATEGORY_COLORS[cat] || '#777'}` }, cat),
          lang && h('span', { class: 'ehm-muted ehm-lang' }, lang),
          meta && h('span', { class: 'ehm-muted ehm-date' }, new Date(meta.posted * 1000).toLocaleDateString()))));
  }

  // Calls fn when el comes within ~2 screens of view, and again after each call while it still is.
  function whenNear(el, fn) {
    const near = () => el.getBoundingClientRect().top < window.innerHeight * 2.5;
    let busy = false;
    const run = async () => {
      if (busy || !near()) return;
      busy = true;
      const more = await fn();
      busy = false;
      if (more) run();
    };
    new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) run(); },
      { rootMargin: '1500px 0px' }).observe(el);
    run();
  }

  function navLinks() {
    const links = [...document.querySelectorAll('#nb a[href]')]
      .map(a => ({ text: a.textContent.trim(), href: abs(a.getAttribute('href')) }))
      .filter(l => l.text);
    return links.length ? links : [
      { text: 'Front Page', href: `${location.origin}/` },
      { text: 'Watched', href: `${location.origin}/watched` },
      { text: 'Popular', href: `${location.origin}/popular` },
      { text: 'Torrents', href: `${location.origin}/torrents.php` },
      { text: 'Favorites', href: `${location.origin}/favorites.php` },
      { text: 'Settings', href: `${location.origin}/uconfig.php` },
    ];
  }

  // ---------- history ----------
  // The last 200 galleries opened on either site, newest first, kept in GM storage on this
  // device only. Turning History off in the menu deletes the list and stops recording.

  const HISTORY_MAX = 200;
  const historyOn = async () => (await GM.getValue('historyOn', 'true')) !== 'false';
  async function loadHistory() {
    try { return JSON.parse(await GM.getValue('history', '[]')) || []; } catch { return []; }
  }
  const saveHistory = entries => GM.setValue('history', JSON.stringify(entries.slice(0, HISTORY_MAX)));
  const sameGallery = (a, b) => a.gid === b.gid && a.ex === b.ex;

  async function recordHistory() {
    if (!isGallery || !document.getElementById('gdt') || !(await historyOn())) return;
    const text = sel => document.querySelector(sel)?.textContent.trim() ?? '';
    const cover = document.querySelector('#gd1 div')?.style.backgroundImage.match(/url\(["']?([^"')]+)/)?.[1];
    const entry = {
      gid: Number(gid), token, ex: isEx,
      title: text('#gn') || document.title,
      cover: cover ? abs(cover) : '',  // absolute, so it still loads when History is opened from the other site
      category: text('#gdc'),
      pages: galleryLength(document),
      page: store.get('progress:' + gid, null),  // null until you've opened the viewer
      time: Date.now(),
    };
    await saveHistory([entry, ...(await loadHistory()).filter(e => !sameGallery(e, entry))]);
  }

  function timeAgo(time) {
    const secs = (Date.now() - time) / 1000;
    for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400],
      ['hour', 3600], ['minute', 60]]) {
      const n = Math.floor(secs / size);
      if (n >= 1) return `${n} ${unit}${n > 1 ? 's' : ''} ago`;
    }
    return 'just now';
  }

  // Full-screen History view over the current page; ‹ or the iOS back swipe closes it.
  function openHistory(root) {
    if (document.getElementById('ehm-history')) return;
    const list = h('div', { class: 'ehm-list' });
    const view = h('div', { id: 'ehm-history' },
      h('header', { class: 'ehm-header' },
        h('button', { class: 'ehm-icon', 'aria-label': 'Close history', onclick: () => history.back() }, '‹'),
        h('div', { class: 'ehm-htitle' }, 'History')),
      list);
    root.append(view);
    history.pushState({ ehmHistory: true }, '');
    const onPop = () => {
      view.remove();
      window.removeEventListener('popstate', onPop);
    };
    window.addEventListener('popstate', onPop);

    const card = e => {
      const progress = e.page == null ? 'Not started' : `Page ${e.page + 1}${e.pages ? ` of ${e.pages}` : ''}`;
      return h('div', { class: 'ehm-hist-row' },
        h('a', { class: 'ehm-card', href: `https://${e.ex ? 'exhentai.org' : 'e-hentai.org'}/g/${e.gid}/${e.token}/` },
          h('img', { class: 'ehm-thumb', onload: markLoaded, src: e.cover || null, alt: '', loading: 'lazy' }),
          h('div', { class: 'ehm-info' },
            h('div', { class: 'ehm-title' }, e.title),
            h('div', { class: 'ehm-muted' }, progress),
            h('div', { class: 'ehm-row ehm-bottom' },
              e.category && h('span', { class: 'ehm-cat', style: `background:${CATEGORY_COLORS[e.category] || '#777'}` }, e.category),
              h('span', { class: 'ehm-site-badge' }, e.ex ? 'EX' : 'EH'),
              h('span', { class: 'ehm-muted ehm-date' }, timeAgo(e.time))))),
        h('button', {
          class: 'ehm-hist-del', 'aria-label': 'Remove from history',
          onclick: async () => {
            await saveHistory((await loadHistory()).filter(x => !sameGallery(x, e)));
            render();
          },
        }, '✕'));
    };

    async function render() {
      if (!(await historyOn())) {
        list.replaceChildren(h('div', { class: 'ehm-more' }, 'History is off. Turn it on in the ☰ menu.'));
        return;
      }
      const entries = await loadHistory();
      list.replaceChildren(...(entries.length ? entries.map(card)
        : [h('div', { class: 'ehm-more' }, 'Galleries you open will appear here.')]));
    }
    render();
  }

  // An On/Off switch for the menu's settings area. read() gives the current state; write(on)
  // applies a change and may return false to cancel it.
  function onOffSwitch(label, read, write) {
    const opts = h('div', {
      class: 'ehm-style-opts',
      onclick: async e => {
        const btn = e.target.closest('[data-on]');
        if (!btn) return;
        const on = btn.dataset.on === 'true';
        if (on === (await read()) || (await write(on)) === false) return;
        mark(on);
      },
    }, h('button', { 'data-on': 'true' }, 'On'), h('button', { 'data-on': 'false' }, 'Off'));
    const mark = on => { for (const b of opts.children) b.classList.toggle('on', (b.dataset.on === 'true') === on); };
    read().then(mark);
    return h('div', { class: 'ehm-style' }, h('div', { class: 'ehm-style-label' }, label), opts);
  }

  // Off deletes the saved history (after confirming) and stops recording.
  const historySwitch = () => onOffSwitch('History', historyOn, async on => {
    if (!on) {
      const n = (await loadHistory()).length;
      if (n && !confirm(`Turn off History? This deletes ${n} saved galler${n === 1 ? 'y' : 'ies'}.`)) return false;
      await GM.setValue('history', '[]');
    }
    await GM.setValue('historyOn', String(on));
    if (on) recordHistory();  // start with the gallery you're on, if any
  });

  const skipWarnings = async () => (await GM.getValue('skipWarnings', 'true')) !== 'false';
  const warningSwitch = () => onOffSwitch('Skip content warnings', skipWarnings,
    on => GM.setValue('skipWarnings', String(on)));

  // Swipe gestures setting, also kept in a variable so a swipe doesn't wait on storage.
  let swipesOn = true;
  const readSwipes = async () => (swipesOn = (await GM.getValue('swipes', 'true')) !== 'false');
  readSwipes();
  const swipeSwitch = () => onOffSwitch('Swipe gestures', readSwipes, on => {
    swipesOn = on;
    return GM.setValue('swipes', String(on));
  });

  // Sideways swipes across the middle of the screen: right opens the menu, left opens Saved
  // searches (where the page has them), and the opposite swipe closes whichever is open.
  // Swipes starting near either edge are left to Safari's own back/forward gesture, and only
  // quick, clearly sideways movements count, so scrolling never opens anything.
  const SWIPE_EDGE = 30;    // px from each screen edge that belong to Safari
  const SWIPE_MIN = 70;     // px of sideways travel needed
  function enableSwipes(root, openMenu) {
    let start = null;
    document.addEventListener('touchstart', e => {
      const t = e.touches[0];
      start = e.touches.length === 1 && !e.target.closest('input, textarea')
        ? { x: t.clientX, y: t.clientY, time: Date.now() } : null;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (!start || !swipesOn) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const { x, time } = start;
      start = null;
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - time > 800) return;
      if (x < SWIPE_EDGE || x > window.innerWidth - SWIPE_EDGE) return;
      // Not while reading, or over a bottom sheet or the History view.
      if (document.documentElement.classList.contains('ehr-open') || root.querySelector('.ehm-sheet-wrap, #ehm-history')) return;
      const menuOpen = root.classList.contains('drawer-open');
      const savedOpen = root.classList.contains('saved-open');
      if (dx > 0) {
        if (savedOpen) root.classList.remove('saved-open');
        else if (!menuOpen) openMenu();
      } else if (menuOpen) {
        root.classList.remove('drawer-open');
      } else if (!savedOpen) {
        root.openSaved?.();
      }
    }, { passive: true });
  }

  function buildDrawer(root) {
    const close = () => root.classList.remove('drawer-open', 'saved-open');
    const other = isEx ? 'https://e-hentai.org' : 'https://exhentai.org';
    const here = location.origin + location.pathname;
    return [
      h('div', { class: 'ehm-scrim', onclick: close }),
      h('nav', { class: 'ehm-drawer', onclick: e => { if (e.target.closest('a')) close(); } },
        h('div', { class: 'ehm-drawer-title' }, isEx ? 'ExHentai' : 'E-Hentai'),
        // Front Page and Watched open with your search filters applied.
        navLinks().map(l => h('a', {
          href: /^\/(watched)?$/.test(new URL(l.href).pathname) ? withFilters(l.href) : l.href,
          class: l.href.split(/[?#]/)[0] === here ? 'active' : null,
        }, l.text)),
        h('button', { onclick: () => { close(); openHistory(root); } }, 'History'),
        h('hr'),
        h('a', { href: other + location.pathname + location.search }, isEx ? 'Switch to E-Hentai' : 'Switch to ExHentai'),
        h('a', { href: '#ehr-login' }, 'ExHentai sign-in'),
        h('button', { onclick: () => { store.set('mobileUi', false); location.reload(); } }, 'Use classic site layout'),
        historySwitch(),
        warningSwitch(),
        swipeSwitch(),
        h('div', { class: 'ehm-style' },
          h('div', { class: 'ehm-style-label' }, 'Style'),
          h('div', {
            class: 'ehm-style-opts',
            onclick: e => {
              const btn = e.target.closest('[data-theme]');
              if (!btn) return;
              store.set('theme', btn.dataset.theme);
              applyTheme(btn.dataset.theme);
              for (const b of e.currentTarget.children) b.classList.toggle('on', b === btn);
            },
          }, THEMES.map(t => h('button', {
            'data-theme': t.id,
            class: document.documentElement.dataset.ehrTheme === t.id ? 'on' : null,
          }, t.name)))),
        h('div', { class: 'ehm-version' }, `EH Reader v${VERSION}`)),
    ];
  }

  // Without a phone-width viewport, iOS lays the page out desktop-wide and shrinks it to fit,
  // which makes everything tiny in portrait. Any viewport tag the site has is overridden too.
  function ensureViewport() {
    const metas = [...document.querySelectorAll('meta[name=viewport]')];
    if (!metas.length) {
      metas.push(h('meta', { name: 'viewport' }));
      document.head.prepend(metas[0]);
    }
    for (const meta of metas) meta.setAttribute('content', 'width=device-width, initial-scale=1');
  }

  function mountShell(headerItems, content) {
    ensureViewport();
    document.documentElement.classList.add('ehm-on');
    const root = h('div', { id: 'ehm' });
    const openMenu = () => {
      // The layout width helps diagnose sizing: on a phone in portrait it should be ~375-430px.
      root.querySelector('.ehm-version').textContent = `EH Reader v${VERSION} · ${window.innerWidth}px wide`;
      root.classList.add('drawer-open');
    };
    const menu = h('button', { class: 'ehm-icon ehm-menu', 'aria-label': 'Menu', onclick: openMenu },
      h('span', { class: 'ehm-site' }, isEx ? 'EX' : 'EH'), h('span', { class: 'ehm-burger' }, '☰'));
    enableSwipes(root, openMenu);

    // Floating "Back to top", shown once you've scrolled about a screen and a half down.
    const toTop = h('button', { class: 'ehm-totop', onclick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
      '↑ Back to top');
    let toTopShown = false;
    window.addEventListener('scroll', () => {
      const show = window.scrollY > window.innerHeight * 1.5;
      if (show !== toTopShown) toTop.classList.toggle('show', (toTopShown = show));
    }, { passive: true });

    root.append(h('header', { class: 'ehm-header' }, menu, headerItems), ...content.filter(Boolean), toTop, ...buildDrawer(root));
    document.body.append(root);
    return root;
  }

  // Favorite categories 0-9 with your names for them and their gallery counts, read from the
  // Favorites page's own category picker (rows that link to ?favcat=N).
  function favCategories() {
    const cats = Array.from({ length: 10 }, (_, i) => ({ value: String(i), name: `Favorites ${i}`, count: '' }));
    for (const el of document.querySelectorAll('[onclick*="favcat="], a[href*="favcat="]')) {
      if (el.closest('#ehm')) continue;  // our own links (e.g. saved searches) aren't the site's picker
      const n =(el.getAttribute('onclick') || el.getAttribute('href')).match(/favcat=(\d)\b/)?.[1];
      if (!n) continue;
      let bits = [...el.querySelectorAll('*')].filter(c => !c.children.length)
        .map(c => c.textContent.trim()).filter(Boolean);
      if (!bits.length) bits = [el.textContent.trim()].filter(Boolean);
      const isCount = s => /^\d[\d,]*$/.test(s);
      const name = bits.find(b => !isCount(b)) || el.querySelector('[title]')?.getAttribute('title');
      if (name) cats[n].name = name;
      const count = bits.find(isCount);
      if (count) cats[n].count = count;
    }
    return cats;
  }

  // ---------- search filters ----------
  // Category, language and minimum-rating filters, kept until changed. Categories and rating
  // use the site's own search parameters (f_cats is a bitmask of excluded categories); language
  // is added to the search text as a language: tag. Favorites only supports the language one.

  const FILTER_CATS = [['Doujinshi', 2], ['Manga', 4], ['Artist CG', 8], ['Game CG', 16], ['Western', 512],
    ['Non-H', 256], ['Image Set', 32], ['Cosplay', 64], ['Asian Porn', 128], ['Misc', 1]];
  const FILTER_LANGS = ['japanese', 'english', 'chinese', 'korean', 'french', 'german', 'spanish', 'italian',
    'russian', 'portuguese', 'thai', 'vietnamese'];
  const loadFilters = () => ({ excluded: [], language: '', minRating: 0, ...store.get('filters', {}) });
  const filtersActive = f => Boolean(f.excluded.length || f.language || f.minRating);
  const langToken = f => (f.language ? `language:${f.language}$` : '');
  // The search text without the language tag the filter added, for showing in the search box.
  const stripFilterLang = (q, f = loadFilters()) =>
    (f.language ? q.split(langToken(f)).join(' ') : q).replace(/\s+/g, ' ').trim();

  function filterSummary(f, favorites) {
    const parts = [];
    if (f.language) parts.push(f.language[0].toUpperCase() + f.language.slice(1));
    if (!favorites && f.minRating) parts.push(`${f.minRating}★+`);
    if (!favorites && f.excluded.length) parts.push(`${f.excluded.length} categor${f.excluded.length === 1 ? 'y' : 'ies'} hidden`);
    return parts.join(' · ');
  }

  function withFilters(href, f = loadFilters()) {
    const url = new URL(href);
    if (url.pathname !== '/favorites.php') {
      const bits = FILTER_CATS.filter(([name]) => f.excluded.includes(name)).reduce((sum, [, bit]) => sum + bit, 0);
      if (bits) url.searchParams.set('f_cats', bits);
      if (f.minRating >= 2) {
        url.searchParams.set('advsearch', '1');
        url.searchParams.set('f_sr', 'on');
        url.searchParams.set('f_srdd', f.minRating);
      }
    }
    if (f.language) {
      const q = stripFilterLang(url.searchParams.get('f_search') || '', f);
      url.searchParams.set('f_search', `${q} ${langToken(f)}`.trim());
    }
    return url.href;
  }

  const FUNNEL_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v5l-4 2v-7z"/></svg>';

  // Heading shown under the search bar: the menu entry you came from, or what's being searched.
  function listTitle() {
    const path = location.pathname;
    const query = stripFilterLang(new URLSearchParams(location.search).get('f_search') || '');
    const unslug = s => decodeURIComponent(s).replace(/\+/g, ' ');
    if (path.startsWith('/tag/')) return `Tag: ${unslug(path.slice(5))}`;
    if (path.startsWith('/uploader/')) return `Uploader: ${unslug(path.slice(10))}`;
    if (query) return path === '/favorites.php' ? `Favorites: “${query}”` : `Search: “${query}”`;
    const here = location.origin + path;
    return navLinks().find(l => l.href.split(/[?#]/)[0] === here)?.text ||
      { '/': 'Front Page', '/watched': 'Watched', '/popular': 'Popular', '/favorites.php': 'Favorites' }[path] ||
      document.title;
  }

  function initListPage() {
    const params = new URLSearchParams(location.search);
    const tagPath = location.pathname.startsWith('/tag/')
      ? decodeURIComponent(location.pathname.slice(5)).replace(/\+/g, ' ') : '';
    // Searches stay within the section you're in where the site supports it (Front Page,
    // Watched, Favorites); everywhere else they search the front page.
    const SEARCHABLE = { '/': 'Front Page', '/watched': 'Watched', '/favorites.php': 'Favorites' };
    const searchPath = SEARCHABLE[location.pathname] ? location.pathname : '/';
    const sectionName = navLinks().find(l => l.href.split(/[?#]/)[0] === location.origin + searchPath)?.text ||
      SEARCHABLE[searchPath];
    const filters = loadFilters();
    const input = h('input', {
      type: 'search', placeholder: `Search ${sectionName}`, enterkeyhint: 'search', autocapitalize: 'off',
      value: stripFilterLang(params.get('f_search') || '', filters) || tagPath,
    });
    const isFavorites = location.pathname === '/favorites.php';
    const favcat = isFavorites ? params.get('favcat') ?? 'all' : null;
    const searchUrl = term => {
      const url = new URL(searchPath, location.origin);
      if (isFavorites && favcat !== 'all') url.searchParams.set('favcat', favcat);  // search within the chosen category
      if (term) url.searchParams.set('f_search', term);
      return withFilters(url.href);
    };

    // ----- filter button and panel
    const filterBtn = h('button', { class: 'ehm-icon ehm-filter', 'aria-label': 'Search filters', onclick: () => openFilters() });
    filterBtn.innerHTML = FUNNEL_SVG;
    if (filtersActive(filters)) filterBtn.append(h('span', { class: 'ehm-filter-dot' }));
    // Only pages that the filters actually apply to say they're filtered.
    const summary = SEARCHABLE[location.pathname] && filterSummary(filters, isFavorites);
    const summaryLine = summary && h('button', { class: 'ehm-filter-summary', onclick: () => openFilters() }, `Filters: ${summary}`);

    function openFilters() {
      const draft = { excluded: new Set(filters.excluded), language: filters.language, minRating: filters.minRating };
      const pick = (box, attr, value) => { for (const b of box.children) b.classList.toggle('on', b.dataset[attr] === String(value)); };

      const cats = h('div', {
        class: 'ehm-cat-grid',
        onclick: e => {
          const chip = e.target.closest('[data-cat]');
          if (!chip) return;
          const name = chip.dataset.cat;
          draft.excluded.has(name) ? draft.excluded.delete(name) : draft.excluded.add(name);
          chip.classList.toggle('off', draft.excluded.has(name));
        },
      }, FILTER_CATS.map(([name]) => h('button', {
        type: 'button', 'data-cat': name, style: `--c:${CATEGORY_COLORS[name]}`,
        class: `ehm-cat-chip${draft.excluded.has(name) ? ' off' : ''}`,
      }, name)));
      const setAll = off => {
        draft.excluded = new Set(off ? FILTER_CATS.map(([name]) => name) : []);
        for (const chip of cats.children) chip.classList.toggle('off', off);
      };

      const langs = h('div', {
        class: 'ehm-chips',
        onclick: e => {
          const chip = e.target.closest('[data-lang]');
          if (!chip) return;
          draft.language = chip.dataset.lang;
          pick(langs, 'lang', draft.language);
        },
      }, ['', ...FILTER_LANGS].map(l => h('button', {
        type: 'button', 'data-lang': l, class: `ehm-chip${draft.language === l ? ' on' : ''}`,
      }, l || 'Any')));

      const rating = h('div', {
        class: 'ehm-seg',
        onclick: e => {
          const b = e.target.closest('[data-r]');
          if (!b) return;
          draft.minRating = Number(b.dataset.r);
          pick(rating, 'r', draft.minRating);
        },
      }, [0, 2, 3, 4, 5].map(r => h('button', {
        type: 'button', 'data-r': r, class: draft.minRating === r ? 'on' : null,
      }, r ? `${r}★+` : 'Any')));

      const status = h('div', { class: 'ehm-status' });
      const go = () => { location.href = searchUrl(stripFilterLang(input.value.trim(), filters)); };
      const apply = () => {
        if (!isFavorites && draft.excluded.size === FILTER_CATS.length) {
          status.textContent = 'Pick at least one category.';
          return;
        }
        store.set('filters', { excluded: [...draft.excluded], language: draft.language, minRating: draft.minRating });
        go();
      };

      const label = (text, ...extra) => h('div', { class: 'ehm-fl-label' }, h('span', {}, text), ...extra);
      const wrap = h('div', { class: 'ehm-sheet-wrap' },
        h('div', { class: 'ehm-sheet-scrim', onclick: () => wrap.remove() }),
        h('div', { class: 'ehm-sheet' },
          h('div', { class: 'ehm-sheet-title' }, 'Search filters'),
          isFavorites
            ? h('div', { class: 'ehm-muted ehm-fl-note' }, 'Favorites can only be filtered by language. Category and rating filters still apply on the Front Page and Watched.')
            : [
              label('Categories', h('span', { class: 'ehm-quick' },
                h('button', { type: 'button', onclick: () => setAll(false) }, 'All'),
                h('button', { type: 'button', onclick: () => setAll(true) }, 'None'))),
              cats,
            ],
          label('Language'), langs,
          !isFavorites && [label('Minimum rating'), rating],
          status,
          h('div', { class: 'ehm-actions' },
            h('button', { class: 'ehm-btn', onclick: () => { store.set('filters', {}); go(); } }, 'Reset'),
            h('button', { class: 'ehm-btn primary', onclick: apply }, 'Apply'))));
      root.append(wrap);
    }
    const form = h('form', {
      class: 'ehm-search',
      onsubmit: e => {
        e.preventDefault();
        location.href = searchUrl(input.value.trim());
      },
    }, input);

    // ----- saved searches: a ☆ button opens a panel from the right. The list is kept in GM
    // storage, so it's shared by every section and by both E-Hentai and ExHentai; tapping a
    // term searches whichever section you're currently in.
    const currentQuery = stripFilterLang(params.get('f_search') || '', filters);
    const star = h('button', { class: 'ehm-icon ehm-star', 'aria-label': 'Saved searches', onclick: () => openSaved() }, '☆');
    const savedList = h('div', { class: 'ehm-saved-list' });
    const newTerm = h('input', {
      type: 'text', placeholder: 'Add a search term', autocapitalize: 'off', autocomplete: 'off', enterkeyhint: 'done',
    });
    const savedPanel = h('aside', { class: 'ehm-saved' },
      h('div', { class: 'ehm-drawer-title' }, 'Saved searches'),
      h('div', { class: 'ehm-muted ehm-saved-hint' }, `Tap a search to run it in ${sectionName}.`),
      savedList,
      h('form', {
        class: 'ehm-saved-add',
        onsubmit: async e => {
          e.preventDefault();
          const term = newTerm.value.trim();
          if (!term) return;
          const terms = await loadSaved();
          if (!terms.includes(term)) await storeSaved([...terms, term]);
          newTerm.value = '';
          renderSaved();
        },
      }, h('span', { class: 'ehm-plus', 'aria-hidden': 'true' }, '+'), newTerm, h('button', { type: 'submit' }, 'Add')));

    async function loadSaved() {
      try { return JSON.parse(await GM.getValue('savedSearches', '[]')) || []; } catch { return []; }
    }
    const storeSaved = terms => GM.setValue('savedSearches', JSON.stringify(terms));

    async function renderSaved() {
      const terms = await loadSaved();
      savedList.replaceChildren(...(terms.length ? terms.map(term => h('div', { class: 'ehm-saved-row' },
        h('a', { class: 'ehm-saved-term', href: searchUrl(term) }, term),
        h('button', {
          class: 'ehm-saved-del', 'aria-label': `Delete ${term}`,
          onclick: async () => {
            await storeSaved((await loadSaved()).filter(t => t !== term));
            renderSaved();
          },
        }, '✕'))) : [h('div', { class: 'ehm-muted ehm-saved-empty' }, 'No saved searches yet.')]));
      star.textContent = currentQuery && terms.includes(currentQuery) ? '★' : '☆';
    }

    function openSaved() {
      // Offer the current search as the term to add, unless it's already saved.
      if (!newTerm.value && input.value.trim()) newTerm.value = input.value.trim();
      renderSaved();
      root.classList.add('saved-open');
    }

    const list = h('div', { class: 'ehm-list' });
    const more = h('div', { class: 'ehm-more', onclick: () => loadMore() });
    // On Favorites the heading doubles as a category picker.
    const heading = isFavorites
      ? h('h1', { class: 'ehm-pagetitle' }, h('button', { class: 'ehm-title-btn', onclick: () => openFavCategories() },
        `${listTitle()} · ${favcat === 'all' ? 'All' : favCategories()[favcat]?.name ?? `Favorites ${favcat}`}`,
        h('span', { class: 'ehm-caret' }, '▾')))
      : h('h1', { class: 'ehm-pagetitle' }, listTitle());

    function openFavCategories() {
      const go = value => {
        const url = new URL('/favorites.php', location.origin);
        if (value !== 'all') url.searchParams.set('favcat', value);
        if (currentQuery) url.searchParams.set('f_search', currentQuery);
        location.href = currentQuery ? withFilters(url.href) : url.href;
      };
      const row = (value, name, count, color) => h('button', {
        type: 'button', class: `ehm-fav-row${value === favcat ? ' on' : ''}`, onclick: () => go(value),
      }, h('span', { class: 'ehm-fav-dot', style: `background:${color}` }), name,
      count && h('span', { class: 'ehm-fav-count' }, count));
      const wrap = h('div', { class: 'ehm-sheet-wrap' },
        h('div', { class: 'ehm-sheet-scrim', onclick: () => wrap.remove() }),
        h('div', { class: 'ehm-sheet' },
          h('div', { class: 'ehm-sheet-title' }, 'Favorite categories'),
          h('div', { class: 'ehm-fav-list' },
            row('all', 'All favorites', '', 'conic-gradient(' + FAV_COLORS.join(', ') + ')'),
            favCategories().map(c => row(c.value, c.name, c.count, FAV_COLORS[c.value])))));
      root.append(wrap);
    }

    const root = mountShell([form, filterBtn, star], [heading, summaryLine, list, more]);
    root.append(savedPanel);
    root.openSaved = openSaved;  // for the swipe-left gesture
    renderSaved();

    const shown = new Set();
    let nextUrl = null;

    // ----- coming back to a list. Safari often reloads a page on Back, which would lose
    // everything infinite scroll had loaded. So the cards and the one at the top of the screen
    // are saved for this tab when you leave, and restored on a back/forward visit.
    const stateKey = 'ehm:list:' + location.href;
    const entries = [];  // { item, meta, ratio } in display order
    const slim = m => m && {
      title: m.title, thumb: m.thumb, uploader: m.uploader, rating: m.rating, filecount: m.filecount,
      category: m.category, posted: m.posted, tags: (m.tags || []).filter(t => t.startsWith('language:')),
    };
    // Leaving by tapping a gallery card marks the list for restoring on the next visit. iPhone
    // Safari doesn't always report a Back as a back/forward navigation, so this is the main signal.
    let returnPending = false;
    let spot = null;  // the card at the top of the screen when last saved, and its offset

    function saveState() {
      const top = root.querySelector('.ehm-header').getBoundingClientRect().bottom;
      const anchor = [...list.children].find(c => c.getBoundingClientRect().bottom > top);
      spot = anchor ? { gid: anchor.dataset.gid, offset: anchor.getBoundingClientRect().top } : null;
      try {
        sessionStorage.setItem(stateKey, JSON.stringify({
          entries, nextUrl, returnPending, anchor: spot?.gid, offset: spot?.offset ?? 0,
        }));
      } catch {}  // storage full: Back will just reload the list
    }

    // Safari's back cache: on Back it may show the page exactly as it was, without running the
    // script again. Put you back on the card you tapped in case it lands somewhere else.
    window.addEventListener('pageshow', e => {
      if (!e.persisted || !returnPending || !spot) return;
      returnPending = false;
      returnTo(spot.gid, spot.offset);
    });
    // Backup in case that event doesn't reach userscripts either: the page becoming visible
    // again right after a card tap, landed at the top.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !returnPending || !spot || window.scrollY > 50) return;
      returnPending = false;
      returnTo(spot.gid, spot.offset);
    });

    // Saved the moment a card is tapped and whenever scrolling stops, not only as the page is
    // left: on iPhone the page-leaving event doesn't reliably reach userscripts.
    list.addEventListener('click', e => {
      if (!e.target.closest('.ehm-card')) return;
      returnPending = true;
      saveState();
    });
    let saveTimer;
    window.addEventListener('scroll', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveState, 400);
    }, { passive: true });
    window.addEventListener('pagehide', saveState);

    async function addPage(doc) {
      const items = listGalleries(doc).filter(g => !shown.has(g.gid));
      items.forEach(g => shown.add(g.gid));
      const prevUrl = nextUrl;
      nextUrl = nextPageUrl(doc);
      // A page with nothing new, or one linking to itself, would otherwise loop forever.
      if (doc !== document && (!items.length || nextUrl === prevUrl)) nextUrl = null;
      let meta = new Map();
      try { meta = await gdata(items); } catch (err) { console.warn('[EH Reader] gallery API failed', err); }
      list.append(...items.map(g => {
        const entry = { item: g, meta: slim(meta.get(g.gid)) };
        entries.push(entry);
        return galleryCard(g, entry.meta, entry);
      }));
      more.textContent = nextUrl ? '' : shown.size ? 'End of results' : 'No galleries found';
    }

    function restoreList(saved) {
      for (const e of saved.entries) {
        shown.add(e.item.gid);
        entries.push(e);
      }
      list.append(...saved.entries.map(e => galleryCard(e.item, e.meta, e)));
      nextUrl = saved.nextUrl;
      more.textContent = nextUrl ? '' : 'End of results';
      if (saved.anchor) returnTo(saved.anchor, saved.offset);
    }

    // Scrolls the given card back to where it was on screen. Safari's own scroll restoring is
    // paused only while this runs, since leaving it off also breaks Safari's back cache.
    function returnTo(gid, offset) {
      const card = list.querySelector(`[data-gid="${gid}"]`);
      if (!card) return;
      history.scrollRestoration = 'manual';
      const place = () => window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - offset);
      place();
      // Late layout changes (fonts, covers, the viewport switch) can still move the card, so put
      // it back a few times while the page settles, stopping as soon as you touch or scroll.
      let touched = false;
      const stop = () => { touched = true; };
      window.addEventListener('touchstart', stop, { once: true, passive: true });
      window.addEventListener('wheel', stop, { once: true, passive: true });
      for (const ms of [50, 300, 800, 1500, 2500]) setTimeout(() => touched || place(), ms);
      window.addEventListener('load', () => touched || place(), { once: true });
      setTimeout(() => { history.scrollRestoration = 'auto'; }, 2600);
      // A brief note that this ran: if you land at the top without seeing it, the restore
      // didn't trigger at all, which helps tell the failure cases apart.
      const toast = h('div', { class: 'ehm-toast' }, 'Back where you left off');
      root.append(toast);
      setTimeout(() => toast.remove(), 2200);
    }

    // Returns true while there are more pages, so whenNear keeps filling the screen.
    async function loadMore() {
      if (!nextUrl) return false;
      more.textContent = 'Loading…';
      try {
        await addPage(await fetchDoc(nextUrl));
        return Boolean(nextUrl);
      } catch (err) {
        more.textContent = `Couldn't load more (${err.message}). Tap to retry.`;
        return false;
      }
    }

    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(stateKey)); } catch {}
    const cameBack = performance.getEntriesByType('navigation')[0]?.type === 'back_forward';
    if (saved?.entries?.length && (cameBack || saved.returnPending)) {
      restoreList(saved);
      whenNear(more, loadMore);
    } else {
      addPage(document).then(() => whenNear(more, loadMore));
    }
  }

  function initGalleryPage() {
    const text = sel => document.querySelector(sel)?.textContent.trim() ?? '';
    const details = Object.fromEntries([...document.querySelectorAll('#gdd tr')].map(tr => [
      tr.querySelector('.gdt1')?.textContent.replace(':', '').trim().toLowerCase(),
      tr.querySelector('.gdt2')?.textContent.replace(/\s+/g, ' ').trim(),
    ]));
    const cover = document.querySelector('#gd1 div')?.style.backgroundImage.match(/url\(["']?([^"')]+)/)?.[1];
    const category = text('#gdc');
    const uploader = document.querySelector('#gdn a');
    const rating = parseFloat(text('#rating_label').replace(/[^\d.]/g, '')) || 0;
    const favLink = document.querySelector('#favoritelink');
    const torrents = [...document.querySelectorAll('#gd5 a')].find(a => /torrent/i.test(a.textContent));
    const siteBg = getComputedStyle(document.body).backgroundColor;

    const back = h('button', {
      class: 'ehm-icon', 'aria-label': 'Back',
      onclick: () => (document.referrer.startsWith(location.origin) ? history.back() : (location.href = '/')),
    }, '‹');

    const tagRows = [...document.querySelectorAll('#taglist tr')].map(tr =>
      h('div', { class: 'ehm-tagrow' },
        h('span', { class: 'ehm-ns' }, tr.querySelector('.tc')?.textContent.replace(':', '') ?? ''),
        [...tr.querySelectorAll('a[href]')].map(a => h('a', { class: 'ehm-tag', href: a.href }, a.textContent))));

    const grid = h('div', {
      class: 'ehm-thumbs',
      onclick: e => {
        const a = e.target.closest('a[href*="/s/"]');
        if (!a) return;
        e.preventDefault();
        const n = Number(a.getAttribute('href').match(/-(\d+)\/?$/)?.[1]);
        openReader(n ? n - 1 : undefined);
      },
    });
    const thumbStatus = h('div', { class: 'ehm-more', onclick: () => loadThumbs() });

    const comments = document.getElementById('cdiv');
    const commentCount = comments?.querySelectorAll('.c1').length ?? 0;

    // ----- favorites: a bottom sheet instead of the site's desktop pop-up page. It reads the
    // categories (with your names for them) and note from that page's form, then posts the
    // same form in the background, so you never leave the gallery.
    const popupUrl = `${location.origin}/gallerypopups.php?gid=${gid}&t=${token}&act=addfav`;
    const favBtn = favLink && h('button', { class: 'ehm-btn', onclick: () => openFavorites() },
      favLink.textContent.trim() || 'Add to Favorites');

    // A category's name is the text of the smallest element around its radio button that
    // holds no other category.
    function favLabel(radio) {
      for (let el = radio.parentElement; el && el.tagName !== 'FORM'; el = el.parentElement) {
        if (el.querySelectorAll('input[name=favcat]').length > 1) break;
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      return `Favorites ${radio.value}`;
    }

    async function openFavorites() {
      const sheet = h('div', { class: 'ehm-sheet' }, h('div', { class: 'ehm-more' }, 'Loading…'));
      const wrap = h('div', { class: 'ehm-sheet-wrap' }, h('div', { class: 'ehm-sheet-scrim', onclick: () => wrap.remove() }), sheet);
      document.getElementById('ehm').append(wrap);

      let form;
      try {
        form = (await fetchDoc(popupUrl)).querySelector('form');
        if (!form?.querySelector('input[name=favcat]')) throw new Error('no favorites form');
      } catch {
        location.href = popupUrl;  // can't read the form: fall back to the site's own page
        return;
      }

      const radios = [...form.querySelectorAll('input[name=favcat]')];
      const labels = Object.fromEntries(radios.map(r => [r.value, r.value === 'favdel' ? 'Remove from favorites' : favLabel(r)]));
      const isFav = 'favdel' in labels;
      let choice = (radios.find(r => r.checked) || radios[0]).value;

      const rows = radios.map(r => h('button', {
        type: 'button', 'data-v': r.value,
        class: `ehm-fav-row${r.value === choice ? ' on' : ''}${r.value === 'favdel' ? ' del' : ''}`,
      }, r.value !== 'favdel' && h('span', { class: 'ehm-fav-dot', style: `background:${FAV_COLORS[r.value] || '#777'}` }),
      labels[r.value]));
      const list = h('div', {
        class: 'ehm-fav-list',
        onclick: e => {
          const row = e.target.closest('[data-v]');
          if (!row) return;
          choice = row.dataset.v;
          for (const x of rows) x.classList.toggle('on', x === row);
        },
      }, rows);
      const note = h('textarea', { class: 'ehm-fav-note', rows: '3', placeholder: 'Note (optional)' });
      note.value = form.querySelector('[name=favnote]')?.value ?? '';
      const status = h('div', { class: 'ehm-muted ehm-fav-status' });
      const save = h('button', { class: 'ehm-btn primary', onclick: () => submit() }, isFav ? 'Save' : 'Add');

      sheet.replaceChildren(
        h('div', { class: 'ehm-sheet-title' }, isFav ? 'Edit favorite' : 'Add to favorites'),
        list, note, status,
        h('div', { class: 'ehm-actions' }, h('button', { class: 'ehm-btn', onclick: () => wrap.remove() }, 'Cancel'), save));

      async function submit() {
        save.disabled = true;
        status.textContent = 'Saving…';
        // Send the form as the site's page would: its hidden fields and first submit button,
        // with the chosen category and note.
        const data = new URLSearchParams();
        let sentButton = false;
        for (const el of form.querySelectorAll('input, textarea, select')) {
          if (!el.name || el.name === 'favcat' || el.name === 'favnote') continue;
          if (el.type === 'submit') {
            if (!sentButton) data.append(el.name, el.value);
            sentButton = true;
          } else if (!['checkbox', 'radio'].includes(el.type) || el.checked) {
            data.append(el.name, el.value);
          }
        }
        data.set('favcat', choice);
        data.set('favnote', note.value);
        try {
          const res = await fetch(new URL(form.getAttribute('action') || popupUrl, popupUrl).href,
            { method: 'POST', credentials: 'include', body: data });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          favBtn.textContent = choice === 'favdel' ? 'Add to Favorites' : labels[choice];
          wrap.remove();
        } catch (err) {
          status.textContent = `Couldn't save (${err.message}). Try again.`;
          save.disabled = false;
        }
      }
    }

    mountShell([back, h('div', { class: 'ehm-htitle' }, text('#gn'))], [
      h('div', { class: 'ehm-detail' },
        h('div', { class: 'ehm-top' },
          h('img', { class: 'ehm-cover', onload: markLoaded, src: cover, alt: '' }),
          h('div', { class: 'ehm-info' },
            h('div', { class: 'ehm-dtitle' }, text('#gn')),
            text('#gj') && h('div', { class: 'ehm-muted' }, text('#gj')),
            uploader && h('a', { class: 'ehm-muted', href: uploader.href }, uploader.textContent),
            h('div', { class: 'ehm-row' }, stars(rating), h('span', { class: 'ehm-muted' }, rating ? rating.toFixed(2) : '')),
            h('div', { class: 'ehm-row' },
              category && h('span', { class: 'ehm-cat', style: `background:${CATEGORY_COLORS[category] || '#777'}` }, category),
              details.language && h('span', { class: 'ehm-muted' }, details.language)),
            h('div', { class: 'ehm-muted' }, [details.length, details.posted].filter(Boolean).join(' · ')))),
        h('div', { class: 'ehm-actions' },
          h('button', { class: 'ehm-btn primary', 'data-ehr-read': '', onclick: () => openReader() }, readLabel()),
          favBtn,
          torrents && h('a', { class: 'ehm-btn', href: `${location.origin}/gallerytorrents.php?gid=${gid}&t=${token}` }, 'Torrents')),
        tagRows.length > 0 && h('details', { class: 'ehm-fold' },
          h('summary', { class: 'ehm-section' }, `Tags (${document.querySelectorAll('#taglist a[href]').length})`),
          h('div', { class: 'ehm-tags' }, tagRows)),
        comments && h('details', { class: 'ehm-fold' },
          h('summary', { class: 'ehm-section' }, `Comments (${commentCount})`),
          h('div', { class: 'ehm-comments', style: `background:${siteBg}` }, comments)),
        h('div', { class: 'ehm-section' }, 'Pages'),
        grid,
        thumbStatus),
    ]);

    // Thumbnails load page by page as you scroll, instead of the site's ?p= pages. The site's
    // thumbnail elements are cloned as-is, since they carry their own sprite styling.
    const count = thumbPageCount(document);
    const currentP = Number(new URLSearchParams(location.search).get('p')) || 0;
    const thumbLinks = [];
    let nextP = 0;

    // Two thumbnails per row (keep in sync with .ehm-thumbs columns). The site's thumbnails are
    // fixed-size crops of a sprite sheet, so they're scaled with CSS zoom, which scales the
    // sprite offsets along with the box. Plain <img> thumbnails ("large" setting) use CSS instead.
    const COLS = 2;
    const GAP = 10;
    const cellWidth = () => (grid.clientWidth - (COLS - 1) * GAP) / COLS;
    function fitThumb(thumb) {
      const sized = thumb.matches('[style*="width"]') ? thumb : thumb.querySelector('[style*="width"]');
      const natural = parseFloat(sized?.style.width);
      if (!natural) {
        thumb.classList.add('ehm-fluid');
        return;
      }
      thumb.dataset.w = natural;
      thumb.style.zoom = String(cellWidth() / natural);
    }
    let thumbsWidth = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === thumbsWidth) return;  // height-only: Safari's toolbar moving
      thumbsWidth = window.innerWidth;
      for (const t of grid.querySelectorAll('[data-w]')) t.style.zoom = String(cellWidth() / t.dataset.w);
    });

    async function loadThumbs() {
      if (nextP >= count) return false;
      thumbStatus.textContent = 'Loading…';
      try {
        const doc = nextP === currentP ? document : await fetchDoc(`${galleryUrl}?p=${nextP}`);
        for (const a of doc.querySelectorAll('#gdt a[href*="/s/"]')) {
          const n = Number(a.getAttribute('href').match(/-(\d+)\/?$/)?.[1]) || thumbLinks.length + 1;
          const thumb = (a.closest('#gdt > *') || a).cloneNode(true);
          grid.append(h('div', { class: 'ehm-cell' }, thumb, h('span', { class: 'ehm-pnum' }, String(n))));
          fitThumb(thumb);
          thumbLinks.push(abs(a.getAttribute('href')));
        }
        nextP++;
        thumbStatus.textContent = '';
        if (nextP >= count && !links) {
          // Every page link is known now, so the reader can open without fetching them again.
          links = [...new Set(thumbLinks)];
          try { sessionStorage.setItem('ehr:links:' + gid, JSON.stringify(links)); } catch {}
        }
        return nextP < count;
      } catch (err) {
        thumbStatus.textContent = `Couldn't load more pages (${err.message}). Tap to retry.`;
        return false;
      }
    }

    whenNear(thumbStatus, loadThumbs);
  }

  // ---------- My Tags ----------
  // A mobile version of the site's My Tags page: your tags with their watch/hide state, colour
  // and weight, plus add, edit and delete. Adding and deleting post the page's own form, as
  // EhViewer does. Editing uses the site's "setusertag" API call (what its page does), and
  // falls back to deleting the tag and adding it back with the new settings.

  const TAG_COLORS = ['', '#ee3333', '#ff8800', '#eedd00', '#33bb33', '#33bbdd', '#3366ff', '#aa44ff', '#ff66cc', '#999999'];

  function parseMyTags(doc) {
    const scripts = [...doc.querySelectorAll('script')].map(s => s.textContent).join('\n');
    const select = doc.querySelector('select[name="tagset"]');
    const tagsets = select ? [...select.options].map(o => ({ value: o.value, name: o.textContent.trim(), on: o.selected })) : [];
    const tags = [...doc.querySelectorAll('#usertags_outer [id^="usertag_"]')]
      .filter(row => /^usertag_\d+$/.test(row.id))
      .map(row => {
        const id = row.id.slice(8);
        const field = name => row.querySelector(`#${name}_${id}`);
        const preview = field('tagpreview');
        const color = field('tagcolor');
        return {
          id,
          name: (preview?.getAttribute('title') || preview?.textContent || '').trim(),
          watched: Boolean(field('tagwatch')?.hasAttribute('checked')),
          hidden: Boolean(field('taghide')?.hasAttribute('checked')),
          color: color?.getAttribute('value') || '',  // '' means the site's default colour
          shownColor: color?.getAttribute('value') || color?.getAttribute('placeholder') || '',
          weight: Number(field('tagweight')?.getAttribute('value')) || 0,
        };
      })
      .filter(t => t.name);
    return {
      tags,
      tagsets,
      tagset: tagsets.find(t => t.on)?.value ?? new URLSearchParams(location.search).get('tagset') ?? '0',
      apiuid: scripts.match(/apiuid\s*=\s*(\d+)/)?.[1],
      apikey: scripts.match(/apikey\s*=\s*["']([0-9a-f]+)["']/)?.[1],
    };
  }

  const myTagsUrl = tagset => {
    const url = new URL('/mytags', location.origin);
    if (tagset && tagset !== '0') url.searchParams.set('tagset', tagset);
    return url.href;
  };

  // Posts the My Tags form and returns the page the site answers with.
  async function postMyTags(fields, tagset) {
    const res = await fetch(myTagsUrl(tagset), { method: 'POST', credentials: 'include', body: new URLSearchParams(fields) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    if (!doc.getElementById('usertags_outer')) throw new Error(doc.querySelector('.d p')?.textContent.trim() || 'unexpected reply');
    return doc;
  }

  const addTag = (t, tagset) => postMyTags({
    usertag_action: 'add', tagname_new: t.name,
    ...(t.watched && { tagwatch_new: 'on' }), ...(t.hidden && { taghide_new: 'on' }),
    tagcolor_new: t.color, tagweight_new: String(t.weight), usertag_target: tagset,
  }, tagset);

  const deleteTag = (t, tagset) => postMyTags({
    usertag_action: 'mass', tagname_new: '', tagcolor_new: '', tagweight_new: String(t.weight),
    'modify_usertags[]': t.id, usertag_target: tagset,
  }, tagset);

  async function editTag(ctx, tag, next) {
    try {
      if (!ctx.apiuid || !ctx.apikey) throw new Error('no API key on the page');
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          method: 'setusertag', apiuid: Number(ctx.apiuid), apikey: ctx.apikey, tagid: Number(tag.id),
          tagwatch: next.watched ? 1 : 0, taghide: next.hidden ? 1 : 0, tagcolor: next.color, tagweight: next.weight,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `API ${res.status}`);
      return null;  // edited in place; the caller reloads the list
    } catch (err) {
      console.warn('[EH Reader] setusertag failed, re-adding the tag instead', err);
      await deleteTag(tag, ctx.tagset);
      return addTag({ ...next, name: tag.name }, ctx.tagset);
    }
  }

  // Watch / Hide / Neither, colour swatches and weight, shared by the Add card and the edit sheet.
  function tagControls(initial) {
    const state = { watched: false, hidden: false, color: '', weight: 10, ...initial };
    const mode = () => (state.watched ? 'watch' : state.hidden ? 'hide' : 'none');
    const seg = h('div', {
      class: 'ehm-seg',
      onclick: e => {
        const b = e.target.closest('[data-mode]');
        if (!b) return;
        state.watched = b.dataset.mode === 'watch';
        state.hidden = b.dataset.mode === 'hide';
        for (const x of seg.children) x.classList.toggle('on', x === b);
      },
    }, [['watch', 'Watch'], ['hide', 'Hide'], ['none', 'Neither']].map(([m, label]) =>
      h('button', { type: 'button', 'data-mode': m, class: mode() === m ? 'on' : null }, label)));

    const colors = TAG_COLORS.includes(state.color) ? TAG_COLORS : [...TAG_COLORS, state.color];
    const swatches = h('div', {
      class: 'ehm-swatches',
      onclick: e => {
        const s = e.target.closest('[data-color]');
        if (!s) return;
        state.color = s.dataset.color;
        for (const x of swatches.children) x.classList.toggle('on', x === s);
      },
    }, colors.map(c => h('button', {
      type: 'button', 'data-color': c, 'aria-label': c || 'Default colour',
      class: `ehm-swatch${c ? '' : ' none'}${c === state.color ? ' on' : ''}`,
      style: c ? `background:${c}` : null,
    }, c ? '' : '∅')));

    const weight = h('input', { class: 'ehm-input', type: 'number', inputmode: 'numeric', min: '-99', max: '99' });
    weight.value = state.weight;
    const nudge = d => { weight.value = Math.max(-99, Math.min(99, (Number(weight.value) || 0) + d)); };
    const el = h('div', {},
      seg, swatches,
      h('div', { class: 'ehm-weight' }, h('span', { class: 'ehm-muted' }, 'Weight'),
        h('button', { type: 'button', onclick: () => nudge(-1) }, '−'), weight,
        h('button', { type: 'button', onclick: () => nudge(1) }, '+')));
    return { el, values: () => ({ ...state, weight: Math.max(-99, Math.min(99, Number(weight.value) || 0)) }) };
  }

  function initMyTagsPage() {
    const body = h('div', { class: 'ehm-detail' });
    const root = mountShell([h('div', { class: 'ehm-htitle' }, 'My Tags')], [body]);
    let ctx = parseMyTags(document);
    let filter = '';

    const tagUrl = name => `${location.origin}/tag/${name.replace(/ /g, '+')}`;

    async function run(status, label, action) {
      status.textContent = label;
      root.classList.add('ehm-busy');
      try {
        const doc = await action();
        ctx = parseMyTags(doc || await fetchDoc(myTagsUrl(ctx.tagset)));
        render();
        return true;
      } catch (err) {
        status.textContent = `Couldn't save (${err.message}). Try again.`;
        return false;
      } finally {
        root.classList.remove('ehm-busy');
      }
    }

    function openTagsets() {
      const wrap = h('div', { class: 'ehm-sheet-wrap' },
        h('div', { class: 'ehm-sheet-scrim', onclick: () => wrap.remove() }),
        h('div', { class: 'ehm-sheet' },
          h('div', { class: 'ehm-sheet-title' }, 'Tag sets'),
          h('div', { class: 'ehm-fav-list' }, ctx.tagsets.map(t => h('button', {
            type: 'button', class: `ehm-fav-row${t.on ? ' on' : ''}`,
            onclick: () => { location.href = myTagsUrl(t.value); },
          }, t.name)))));
      root.append(wrap);
    }

    function openEdit(tag) {
      const controls = tagControls(tag);
      const status = h('div', { class: 'ehm-status' });
      const wrap = h('div', { class: 'ehm-sheet-wrap' },
        h('div', { class: 'ehm-sheet-scrim', onclick: () => wrap.remove() }),
        h('div', { class: 'ehm-sheet' },
          h('div', { class: 'ehm-sheet-title' }, tag.name),
          controls.el, status,
          h('div', { class: 'ehm-actions' },
            h('button', {
              class: 'ehm-btn danger',
              onclick: async () => {
                if (!confirm(`Delete "${tag.name}" from My Tags?`)) return;
                if (await run(status, 'Deleting…', () => deleteTag(tag, ctx.tagset))) wrap.remove();
              },
            }, 'Delete'),
            h('button', { class: 'ehm-btn', onclick: () => wrap.remove() }, 'Cancel'),
            h('button', {
              class: 'ehm-btn primary',
              onclick: async () => {
                if (await run(status, 'Saving…', () => editTag(ctx, tag, controls.values()))) wrap.remove();
              },
            }, 'Save'))));
      root.append(wrap);
    }

    function render() {
      const name = h('input', {
        class: 'ehm-input', type: 'text', placeholder: 'e.g. female:glasses', autocapitalize: 'off',
        autocomplete: 'off', enterkeyhint: 'done',
      });
      const controls = tagControls({});
      const status = h('div', { class: 'ehm-status' });
      const add = h('form', {
        class: 'ehm-mt-card',
        onsubmit: async e => {
          e.preventDefault();
          const tagName = name.value.trim();
          if (!tagName) return;
          await run(status, 'Adding…', () => addTag({ ...controls.values(), name: tagName }, ctx.tagset));
        },
      }, h('h2', {}, 'Add a tag'), name, controls.el, status, h('button', { class: 'ehm-btn primary ehm-mt-add', type: 'submit' }, 'Add tag'));

      // Only the rows are redrawn while filtering, so the keyboard stays up.
      const listBox = h('div');
      const fillRows = () => {
        const rows = ctx.tags.filter(t => t.name.toLowerCase().includes(filter.toLowerCase())).map(t =>
          h('div', { class: 'ehm-mt-row' },
            h('span', { class: 'ehm-mt-dot', style: t.shownColor ? `background:${t.shownColor}` : null }),
            h('a', { class: 'ehm-mt-name', href: tagUrl(t.name) }, t.name),
            t.watched && h('span', { class: 'ehm-badge watch' }, 'Watched'),
            t.hidden && h('span', { class: 'ehm-badge hide' }, 'Hidden'),
            h('span', { class: 'ehm-badge weight' }, String(t.weight)),
            h('button', { class: 'ehm-mt-edit', 'aria-label': `Edit ${t.name}`, onclick: () => openEdit(t) }, '✎')));
        listBox.replaceChildren(...(rows.length ? rows
          : [h('div', { class: 'ehm-more' }, ctx.tags.length ? 'No tags match.' : 'No tags yet. Add one above.')]));
      };
      fillRows();

      const search = ctx.tags.length > 8 && h('input', {
        class: 'ehm-input ehm-mt-filter', type: 'search', placeholder: `Filter ${ctx.tags.length} tags`,
        autocapitalize: 'off', value: filter,
        oninput: e => {
          filter = e.target.value;
          fillRows();
        },
      });

      const current = ctx.tagsets.find(t => t.on);
      body.replaceChildren(...[
        ctx.tagsets.length > 1 && h('button', { class: 'ehm-title-btn ehm-mt-set', onclick: openTagsets },
          `Tag set: ${current?.name ?? ctx.tagset}`, h('span', { class: 'ehm-caret' }, '▾')),
        add,
        h('div', { class: 'ehm-section' }, `Your tags (${ctx.tags.length})`),
        search,
        listBox,
      ].filter(Boolean));
    }

    render();
  }

  const mobileStyle = document.createElement('style');
  mobileStyle.textContent = `
    html.ehm-on, html.ehm-on body { margin: 0 !important; padding: 0 !important; min-width: 0 !important;
      background: var(--ehr-bg) !important; }
    html.ehm-on body > *:not(#ehm):not(#ehr):not(#ehr-login) { display: none !important; }
    #ehm { color: var(--ehr-text); font: 15px -apple-system, system-ui, sans-serif; -webkit-text-size-adjust: 100%; text-align: left; }
    #ehm a { color: inherit; text-decoration: none; }
    #ehm * { box-sizing: border-box; }
    .ehm-header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; background: var(--ehr-surface); border-bottom: 1px solid var(--ehr-control); }
    .ehm-icon { flex: none; width: 60px; height: 60px; border: 0; border-radius: 14px; background: var(--ehr-control);
      color: var(--ehr-text); font: 34px/1 -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    /* Menu button: a small EX/EH site label above the ☰. */
    .ehm-menu { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
    .ehm-site { font: 700 11px/1 -apple-system, system-ui, sans-serif; letter-spacing: 1px; color: var(--ehr-accent-soft); }
    .ehm-burger { font-size: 28px; line-height: 1; }
    .ehm-search { flex: 1; min-width: 0; display: flex; margin: 0; }
    /* 16px text stops iOS zooming in when the field is focused. */
    .ehm-search input { flex: 1; min-width: 0; height: 60px; padding: 0 14px; border: 1px solid var(--ehr-line);
      border-radius: 12px; background: var(--ehr-sunken); color: var(--ehr-text); font-size: 18px; }
    .ehm-htitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .ehm-list { display: flex; flex-direction: column; }
    .ehm-card { display: flex; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--ehr-sunken); }
    /* Covers keep their real shape (landscape ones aren't cropped). Until an image loads it
       holds a portrait-shaped placeholder, so the list doesn't jump; very tall covers are capped
       and shown whole. */
    .ehm-thumb { flex: none; align-self: flex-start; width: 42%; max-width: 220px; height: auto; max-height: 320px;
      aspect-ratio: 7 / 10; object-fit: contain; border-radius: 8px; background: var(--ehr-sunken); }
    .ehm-thumb.loaded, .ehm-cover.loaded { aspect-ratio: auto; background: none; }
    .ehm-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .ehm-title { font-size: 15px; line-height: 1.3; color: var(--ehr-text); overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .ehm-muted { color: var(--ehr-muted); font-size: 13px; }
    .ehm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ehm-bottom { margin-top: auto; }
    .ehm-date { margin-left: auto; }
    .ehm-lang { text-transform: capitalize; }
    .ehm-cat { padding: 2px 8px; border-radius: 4px; color: var(--ehr-strong); font-size: 12px; font-weight: 600; }
    .ehm-stars { font-size: 14px; letter-spacing: 1px; }
    .ehm-stars::before { content: '★★★★★'; color: transparent; -webkit-background-clip: text; background-clip: text;
      background-image: linear-gradient(90deg, #f5b301 calc(var(--r) * 100%), #4a4a4a 0); }
    .ehm-more { padding: 24px; text-align: center; color: var(--ehr-muted); min-height: 20px; }
    .ehm-scrim { position: fixed; inset: 0; z-index: 20; background: rgba(0, 0, 0, .5); opacity: 0;
      pointer-events: none; transition: opacity .2s; }
    .ehm-drawer { position: fixed; top: 0; bottom: 0; left: 0; z-index: 21; width: min(320px, 85vw); overflow-y: auto;
      display: flex; flex-direction: column; padding: 16px 0 calc(16px + env(safe-area-inset-bottom));
      background: var(--ehr-surface); transform: translateX(-100%); transition: transform .22s; }
    #ehm.drawer-open .ehm-scrim, #ehm.saved-open .ehm-scrim { opacity: 1; pointer-events: auto; }
    .ehm-star { font-size: 32px; color: var(--ehr-accent-soft); }
    /* Saved searches panel: slides in from the right. */
    .ehm-saved { position: fixed; top: 0; bottom: 0; right: 0; z-index: 21; width: min(340px, 88vw); overflow-y: auto;
      display: flex; flex-direction: column; padding: 16px 0 calc(16px + env(safe-area-inset-bottom));
      background: var(--ehr-surface); transform: translateX(100%); transition: transform .22s; }
    #ehm.saved-open .ehm-saved { transform: none; }
    .ehm-saved-hint { padding: 0 24px 12px; font-size: 15px; }
    .ehm-saved-list { flex: 1; border-top: 1px solid var(--ehr-control); }
    .ehm-saved-row { display: flex; align-items: center; border-bottom: 1px solid var(--ehr-control); }
    .ehm-saved-term { flex: 1; min-width: 0; padding: 18px 8px 18px 24px; color: var(--ehr-text); font-size: 19px;
      overflow-wrap: anywhere; }
    .ehm-saved-term:active { background: var(--ehr-control); }
    .ehm-saved-del { flex: none; width: 60px; height: 60px; border: 0; background: none; color: var(--ehr-muted);
      font: 22px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehm-saved-empty { padding: 18px 24px; font-size: 16px; }
    .ehm-saved-add { display: flex; gap: 8px; align-items: center; margin: 0; padding: 14px 16px 0; }
    .ehm-plus { flex: none; width: 30px; text-align: center; color: var(--ehr-accent-soft); font: 300 34px/1 -apple-system, system-ui, sans-serif; }
    .ehm-saved-add input { flex: 1; min-width: 0; height: 54px; padding: 0 12px; border: 1px solid var(--ehr-line);
      border-radius: 12px; background: var(--ehr-sunken); color: var(--ehr-text); font-size: 17px; }
    .ehm-saved-add button { flex: none; height: 54px; padding: 0 18px; border: 0; border-radius: 12px;
      background: var(--ehr-accent); color: var(--ehr-strong); font: 600 17px -apple-system, system-ui, sans-serif; }
    #ehm.drawer-open .ehm-drawer { transform: none; }
    .ehm-drawer-title { padding: max(12px, env(safe-area-inset-top)) 24px 18px; font-size: 26px; font-weight: 700; color: var(--ehr-strong); }
    .ehm-drawer a, .ehm-drawer button { display: flex; align-items: center; width: 100%; min-height: 66px;
      padding: 14px 24px; border: 0; background: none; color: var(--ehr-text); text-align: left;
      font: 21px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehm-drawer a:active, .ehm-drawer button:active { background: var(--ehr-control); }
    .ehm-drawer a.active { background: var(--ehr-accent); color: var(--ehr-strong); }
    .ehm-drawer hr { width: 100%; border: 0; border-top: 1px solid var(--ehr-control); margin: 8px 0; }
    /* Style picker, pinned to the bottom of the drawer just above the version line. */
    .ehm-style { margin-top: auto; padding: 16px 20px 0; border-top: 1px solid var(--ehr-control); }
    .ehm-style-label { margin-bottom: 10px; color: var(--ehr-muted); font-size: 15px; font-weight: 600; }
    .ehm-style-opts { display: flex; gap: 8px; }
    .ehm-drawer .ehm-style-opts button { flex: 1; justify-content: center; min-height: 52px; padding: 0 4px;
      border: 2px solid var(--ehr-line); border-radius: 12px; background: var(--ehr-control);
      color: var(--ehr-text); font: 600 15px -apple-system, system-ui, sans-serif; text-align: center; }
    .ehm-drawer .ehm-style-opts button.on { border-color: var(--ehr-accent-soft); background: var(--ehr-accent);
      color: var(--ehr-strong); }
    .ehm-version { padding: 16px 20px 0; color: var(--ehr-faint); font-size: 12px; }
    .ehm-detail { padding: 12px; }
    .ehm-top { display: flex; gap: 14px; }
    .ehm-cover { flex: none; align-self: flex-start; width: 38%; max-width: 220px; height: auto; max-height: 340px;
      aspect-ratio: 7 / 10; object-fit: contain; border-radius: 8px; background: var(--ehr-sunken); }
    .ehm-dtitle { font-size: 17px; font-weight: 600; line-height: 1.3; color: var(--ehr-strong); }
    .ehm-actions { display: flex; gap: 10px; margin: 14px 0; }
    .ehm-btn { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 10px;
      border: 0; border-radius: 10px; background: var(--ehr-control); color: var(--ehr-text); text-align: center;
      font: 600 15px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehm-btn.primary { flex: 2; background: var(--ehr-accent); color: var(--ehr-strong); font-size: 17px; }
    .ehm-tags { display: flex; flex-direction: column; gap: 8px; margin: 6px 0 12px; }
    .ehm-tagrow { display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; }
    .ehm-ns { min-width: 70px; color: var(--ehr-muted); font-size: 13px; }
    .ehm-tag { padding: 5px 10px; border-radius: 14px; background: var(--ehr-tag); color: var(--ehr-text); font-size: 13px; }
    .ehm-section { margin: 18px 0 10px; font-weight: 600; color: var(--ehr-subtle); }
    .ehm-pagetitle { margin: 0; padding: 16px 16px 8px; color: var(--ehr-strong); font-size: 24px; font-weight: 700;
      overflow-wrap: anywhere; }
    /* Collapsible Tags / Comments sections: a full-width, finger-sized header row. */
    .ehm-fold { border-top: 1px solid var(--ehr-sunken); }
    .ehm-fold > summary.ehm-section { margin: 0; padding: 16px 4px; font-size: 18px; cursor: pointer; }
    .ehm-fold[open] > summary.ehm-section { padding-bottom: 10px; }
    .ehm-comments { padding: 8px; border-radius: 8px; overflow-x: auto; }
    .ehm-thumbs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .ehm-cell { position: relative; overflow: hidden; border-radius: 6px; background: var(--ehr-sunken); }
    .ehm-cell > * { display: block; float: none !important; margin: 0 !important; }
    .ehm-fluid, .ehm-fluid div, .ehm-fluid a, .ehm-fluid img { width: 100% !important; height: auto !important; }
    .ehm-pnum { position: absolute; right: 6px; bottom: 6px; padding: 3px 9px; border-radius: 10px;
      background: rgba(0, 0, 0, .75); color: var(--ehr-strong); font: 600 15px -apple-system, system-ui, sans-serif;
      pointer-events: none; }
    /* The classic layout keeps the site's desktop width, which iOS shrinks to fit, so this button
       is sized in vmin (a share of the screen) to stay large in either orientation. */
    #ehm-restore { position: fixed; left: 4vmin; bottom: calc(5vmin + env(safe-area-inset-bottom)); z-index: 2147483646;
      padding: 3.5vmin 6vmin; border: 0; border-radius: 8vmin; background: var(--ehr-accent); color: var(--ehr-strong);
      box-shadow: 0 0.5vmin 2vmin rgba(0, 0, 0, .5); font: 700 5.5vmin -apple-system, system-ui, sans-serif;
      touch-action: manipulation; }
    .ehm-totop { position: fixed; top: calc(env(safe-area-inset-top) + 92px); right: 12px; z-index: 15;
      padding: 11px 18px; border: 0; border-radius: 24px; background: var(--ehr-accent); color: var(--ehr-strong);
      font: 600 16px -apple-system, system-ui, sans-serif; box-shadow: 0 2px 12px rgba(0, 0, 0, .5);
      opacity: 0; pointer-events: none; transform: translateY(-8px); transition: opacity .2s, transform .2s;
      touch-action: manipulation; }
    .ehm-totop.show { opacity: 1; pointer-events: auto; transform: none; }
    .ehm-toast { position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); z-index: 16;
      padding: 12px 20px; border-radius: 24px; background: var(--ehr-surface); color: var(--ehr-text);
      font: 600 15px -apple-system, system-ui, sans-serif; white-space: nowrap; pointer-events: none;
      box-shadow: 0 2px 14px rgba(0, 0, 0, .6); transform: translateX(-50%); animation: ehm-toast 2.2s both; }
    @keyframes ehm-toast { 0% { opacity: 0; } 10%, 80% { opacity: 1; } 100% { opacity: 0; } }
    /* Search filters: funnel button beside the search bar, and the filter panel. */
    .ehm-header .ehm-star, .ehm-header .ehm-filter { width: 50px; }
    .ehm-filter { position: relative; display: flex; align-items: center; justify-content: center; color: var(--ehr-accent-soft); }
    .ehm-filter-dot { position: absolute; top: 9px; right: 8px; width: 10px; height: 10px; border-radius: 50%;
      background: var(--ehr-accent-soft); box-shadow: 0 0 0 2px var(--ehr-control); }
    .ehm-filter-summary { display: block; margin: -4px 16px 10px; padding: 0; border: 0; background: none;
      color: var(--ehr-accent-soft); font: 600 15px -apple-system, system-ui, sans-serif; text-align: left; }
    .ehm-fl-label { display: flex; align-items: center; justify-content: space-between; margin: 18px 0 10px;
      color: var(--ehr-subtle); font: 600 15px -apple-system, system-ui, sans-serif; }
    .ehm-fl-note { margin: 0 0 4px; font-size: 14px; line-height: 1.4; }
    .ehm-quick button { margin-left: 8px; padding: 8px 14px; border: 0; border-radius: 10px; background: var(--ehr-control);
      color: var(--ehr-text); font: 600 14px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehm-cat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .ehm-cat-chip { min-height: 46px; border: 0; border-radius: 10px; background: var(--c); color: #fff;
      font: 600 15px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehm-cat-chip.off { background: var(--ehr-control); color: var(--ehr-faint); text-decoration: line-through; }
    .ehm-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .ehm-chip { min-height: 42px; padding: 0 14px; border: 2px solid var(--ehr-line); border-radius: 21px;
      background: var(--ehr-control); color: var(--ehr-text); font: 600 15px -apple-system, system-ui, sans-serif;
      text-transform: capitalize; touch-action: manipulation; }
    .ehm-chip.on { border-color: var(--ehr-accent-soft); background: var(--ehr-accent); color: var(--ehr-strong); }
    /* My Tags page. */
    .ehm-mt-card { margin: 4px 0 8px; padding: 16px; border-radius: 14px; background: var(--ehr-surface); }
    .ehm-mt-card h2 { margin: 0 0 12px; color: var(--ehr-strong); font-size: 19px; }
    .ehm-input { width: 100%; height: 50px; padding: 0 12px; border: 1px solid var(--ehr-line); border-radius: 12px;
      background: var(--ehr-sunken); color: var(--ehr-text); font: 17px -apple-system, system-ui, sans-serif; }
    .ehm-seg { display: flex; gap: 6px; margin-top: 12px; }
    .ehm-seg button { flex: 1; min-height: 46px; border: 2px solid var(--ehr-line); border-radius: 12px;
      background: var(--ehr-control); color: var(--ehr-text); font: 600 15px -apple-system, system-ui, sans-serif;
      touch-action: manipulation; }
    .ehm-seg button.on { border-color: var(--ehr-accent-soft); background: var(--ehr-accent); color: var(--ehr-strong); }
    .ehm-swatches { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    .ehm-swatch { width: 40px; height: 40px; padding: 0; border: 3px solid transparent; border-radius: 50%;
      box-shadow: 0 0 0 1px var(--ehr-line); color: var(--ehr-muted); font: 18px -apple-system, system-ui, sans-serif;
      touch-action: manipulation; }
    .ehm-swatch.none { background: var(--ehr-control); }
    .ehm-swatch.on { border-color: var(--ehr-strong); }
    .ehm-weight { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
    .ehm-weight .ehm-muted { flex: 1; font-size: 15px; }
    .ehm-weight .ehm-input { width: 84px; text-align: center; }
    .ehm-weight button { width: 50px; height: 50px; border: 0; border-radius: 12px; background: var(--ehr-control);
      color: var(--ehr-text); font: 24px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehm-mt-add { width: 100%; margin-top: 4px; }
    .ehm-status { min-height: 20px; margin-top: 10px; color: var(--ehr-muted); font-size: 14px; }
    .ehm-title-btn.ehm-mt-set { margin: 4px 0 12px; color: var(--ehr-strong); font: 700 20px -apple-system, system-ui, sans-serif; }
    .ehm-mt-filter { margin-bottom: 6px; }
    .ehm-mt-row { display: flex; align-items: center; gap: 10px; min-height: 62px; padding: 6px 2px;
      border-bottom: 1px solid var(--ehr-control); }
    .ehm-mt-dot { flex: none; width: 16px; height: 16px; border-radius: 50%; background: var(--ehr-control);
      box-shadow: 0 0 0 1px var(--ehr-line); }
    .ehm-mt-name { flex: 1; min-width: 0; color: var(--ehr-text); font-size: 17px; overflow-wrap: anywhere; }
    .ehm-badge { flex: none; padding: 3px 8px; border-radius: 10px; font: 600 12px -apple-system, system-ui, sans-serif; }
    .ehm-badge.watch { background: #1d5a36; color: #d4ffe4; }
    .ehm-badge.hide { background: #6a1f1f; color: #ffdede; }
    .ehm-badge.weight { background: var(--ehr-control); color: var(--ehr-muted); }
    .ehm-mt-edit { flex: none; width: 48px; height: 48px; border: 0; border-radius: 12px; background: var(--ehr-control);
      color: var(--ehr-text); font: 20px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehm-btn.danger { background: #7a1d1d; color: #fff; }
    #ehm.ehm-busy .ehm-btn, #ehm.ehm-busy .ehm-mt-edit { opacity: .5; pointer-events: none; }
    /* Favorites bottom sheet on the gallery page. */
    .ehm-sheet-wrap { position: fixed; inset: 0; z-index: 40; }
    .ehm-sheet-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, .55); }
    .ehm-sheet { position: absolute; left: 0; right: 0; bottom: 0; max-height: 88vh; overflow-y: auto;
      padding: 20px 16px calc(18px + env(safe-area-inset-bottom)); border-radius: 18px 18px 0 0;
      background: var(--ehr-surface); box-shadow: 0 -4px 24px rgba(0, 0, 0, .5); }
    .ehm-sheet-title { margin-bottom: 14px; color: var(--ehr-strong); font-size: 21px; font-weight: 700; }
    .ehm-fav-list { display: flex; flex-direction: column; gap: 6px; }
    .ehm-fav-row { display: flex; align-items: center; gap: 14px; min-height: 54px; padding: 0 16px;
      border: 2px solid transparent; border-radius: 12px; background: var(--ehr-control); color: var(--ehr-text);
      text-align: left; font: 17px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehm-fav-row.on { border-color: var(--ehr-accent-soft); color: var(--ehr-strong); }
    .ehm-fav-row.del { color: var(--ehr-accent-soft); }
    .ehm-fav-dot { flex: none; width: 18px; height: 18px; border-radius: 50%; }
    .ehm-fav-note { display: block; width: 100%; margin-top: 12px; padding: 12px; border: 1px solid var(--ehr-line);
      border-radius: 12px; background: var(--ehr-sunken); color: var(--ehr-text); resize: vertical;
      font: 16px -apple-system, system-ui, sans-serif; }
    .ehm-fav-status { min-height: 18px; margin-top: 8px; }
    .ehm-fav-count { margin-left: auto; color: var(--ehr-muted); font-size: 15px; }
    .ehm-title-btn { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none;
      color: inherit; font: inherit; text-align: left; touch-action: manipulation; }
    .ehm-caret { color: var(--ehr-accent-soft); font-size: 22px; }
    /* Cancel / Save stay pinned to the bottom of the sheet while the categories scroll. */
    .ehm-sheet .ehm-actions { position: sticky; bottom: calc(-18px - env(safe-area-inset-bottom)); margin: 8px -16px 0;
      padding: 10px 16px calc(18px + env(safe-area-inset-bottom)); background: var(--ehr-surface); }
    /* The History switch and Style picker share the drawer's bottom block. */
    .ehm-style + .ehm-style { margin-top: 0; border-top: 0; }
    #ehm-history { position: fixed; inset: 0; z-index: 30; overflow-y: auto; -webkit-overflow-scrolling: touch;
      background: var(--ehr-bg); }
    .ehm-hist-row { position: relative; }
    .ehm-hist-row .ehm-card { padding-right: 52px; }
    .ehm-hist-del { position: absolute; top: 6px; right: 2px; width: 50px; height: 50px; border: 0; background: none;
      color: var(--ehr-muted); font: 22px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
    .ehm-site-badge { padding: 1px 6px; border: 1px solid var(--ehr-line); border-radius: 4px;
      color: var(--ehr-accent-soft); font: 700 11px -apple-system, system-ui, sans-serif; letter-spacing: 1px; }
  `;
  document.head.append(mobileStyle);

  // Content-warning page shown in front of some galleries: follow its "View Gallery" link
  // (this browsing session only) unless "Skip content warnings" is off in the menu.
  // Only once: if the warning shows again after following its link, stay put rather than loop.
  const warningLink = isGallery && !document.getElementById('gdt') && !/[?&]nw=/.test(location.search) &&
    document.querySelector('a[href*="nw=session"], a[href*="nw=always"]');
  if (warningLink) {
    skipWarnings().then(skip => {
      if (!skip) return;
      const href = document.querySelector('a[href*="nw=session"]')?.getAttribute('href');
      location.replace(href ? abs(href) : `${galleryUrl}?nw=session`);
    });
  }

  // Galleries are added to History whether or not the mobile layout is on.
  if (isGallery && document.getElementById('gdt')) recordHistory();

  if (!mobileUi) {
    // Classic layout chosen from the drawer: offer a way back.
    if (isGallery || LIST_PATH.test(location.pathname)) {
      document.body.append(h('button', {
        id: 'ehm-restore', onclick: () => { store.set('mobileUi', true); location.reload(); },
      }, 'EH Reader'));
    }
  } else if (location.pathname === '/mytags' && document.getElementById('usertags_outer')) {
    initMyTagsPage();
  } else if (isGallery && document.getElementById('gdt')) {
    initGalleryPage();
  } else if (!isGallery && location.pathname !== '/torrents.php' &&
      (document.querySelector('.itg') || LIST_PATH.test(location.pathname))) {
    initListPage();
  }
})();
