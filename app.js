/* ============================================================
   Filmer — Telegram Mini App
   Personal tracker for films, series, games and anything else.
   ============================================================ */

(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const inTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');

  function versionAtLeast(v) {
    if (!tg) return false;
    if (typeof tg.isVersionAtLeast === 'function') {
      try { return tg.isVersionAtLeast(v); } catch (e) { return false; }
    }
    return false;
  }
  // Feature gates — older Telegram clients throw on unsupported methods.
  const canCloud = inTelegram && versionAtLeast('6.9');
  const canBackButton = inTelegram && versionAtLeast('6.1') && tg && tg.BackButton;

  /* ---------- Telegram helpers ---------- */
  function haptic(type) {
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (type === 'select') tg.HapticFeedback.selectionChanged();
      else if (type === 'warning') tg.HapticFeedback.notificationOccurred('warning');
      else if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
      else tg.HapticFeedback.impactOccurred(type || 'light');
    } catch (e) {}
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ============================================================
     Storage — Telegram CloudStorage (synced across devices) with
     localStorage fallback. Data is chunked to respect CloudStorage's
     ~4 KB per-value limit.
     ============================================================ */
  const Storage = {
    LS_KEY: 'filmer.data.v1',
    CLOUD_PREFIX: 'filmer_',
    CHUNK_SIZE: 3800,

    hasCloud() {
      return canCloud && tg.CloudStorage && typeof tg.CloudStorage.getItem === 'function';
    },

    saveLocal(data) {
      try { localStorage.setItem(this.LS_KEY, JSON.stringify(data)); } catch (e) {}
    },
    loadLocal() {
      try {
        const raw = localStorage.getItem(this.LS_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },

    // Load: prefer cloud, fall back to local. Any failure → local.
    load() {
      const self = this;
      return new Promise((resolve) => {
        if (!self.hasCloud()) return resolve(self.loadLocal());
        try {
          tg.CloudStorage.getItem(self.CLOUD_PREFIX + 'meta', (err, metaRaw) => {
            if (err || !metaRaw) return resolve(self.loadLocal());
            let meta;
            try { meta = JSON.parse(metaRaw); } catch (e) { return resolve(self.loadLocal()); }
            const keys = [];
            for (let i = 0; i < meta.chunks; i++) keys.push(self.CLOUD_PREFIX + 'c' + i);
            if (!keys.length) return resolve(self.loadLocal());
            try {
              tg.CloudStorage.getItems(keys, (err2, values) => {
                if (err2 || !values) return resolve(self.loadLocal());
                let joined = '';
                for (let i = 0; i < meta.chunks; i++) joined += values[self.CLOUD_PREFIX + 'c' + i] || '';
                try {
                  const data = JSON.parse(joined);
                  self.saveLocal(data); // keep local mirror fresh
                  resolve(data);
                } catch (e) { resolve(self.loadLocal()); }
              });
            } catch (e) { resolve(self.loadLocal()); }
          });
        } catch (e) { resolve(self.loadLocal()); }
      });
    },

    // Save: write local immediately, then best-effort cloud sync.
    save(data) {
      this.saveLocal(data);
      if (!this.hasCloud()) return;
      const str = JSON.stringify(data);
      const chunks = [];
      for (let i = 0; i < str.length; i += this.CHUNK_SIZE) chunks.push(str.slice(i, i + this.CHUNK_SIZE));
      const meta = { chunks: chunks.length, ts: Date.now() };
      try {
        tg.CloudStorage.setItem(this.CLOUD_PREFIX + 'meta', JSON.stringify(meta), () => {});
        chunks.forEach((c, i) => tg.CloudStorage.setItem(this.CLOUD_PREFIX + 'c' + i, c, () => {}));
      } catch (e) {}
    },
  };

  /* ============================================================
     State
     ============================================================ */
  let state = { categories: [] };

  function seed() {
    return {
      categories: [
        { id: uid(), name: 'Films', icon: '🎬', items: [] },
        { id: uid(), name: 'Series', icon: '📺', items: [] },
        { id: uid(), name: 'Games', icon: '🎮', items: [] },
      ],
    };
  }

  function persist() { Storage.save(state); }

  function getCategory(id) { return state.categories.find((c) => c.id === id) || null; }

  /* Guess a friendly emoji for a new category from its name. */
  function guessIcon(name) {
    const n = ' ' + name.toLowerCase() + ' ';
    const map = [
      [/film|movie|cinema/, '🎬'], [/serie|show|tv/, '📺'], [/game|gaming|play/, '🎮'],
      [/book|read|novel/, '📚'], [/anime|manga/, '🎌'], [/music|song|album/, '🎵'],
      [/podcast/, '🎙️'], [/food|recipe|cook/, '🍳'], [/travel|trip|place/, '✈️'],
      [/sport|gym|workout/, '🏅'], [/art|paint|draw/, '🎨'], [/course|learn|study/, '🎓'],
      [/board/, '🎲'], [/comic/, '💥'], [/wish|buy|shop/, '🛍️'], [/doc|paper/, '📄'],
    ];
    for (const [re, ic] of map) if (re.test(n)) return ic;
    return '🗂️';
  }

  /* ============================================================
     Star rendering (0–10 scale, shown as 10 stars)
     ============================================================ */
  const STAR_PATH = 'M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.6l-5.8 3.05 1.1-6.47-4.7-4.58 6.5-.95z';
  function starSVG(filled) {
    return '<svg viewBox="0 0 24 24" class="' + (filled ? 'star-full' : 'star-empty') +
      '"><path d="' + STAR_PATH + '" fill="currentColor"/></svg>';
  }
  function starsHTML(rating, size) {
    let h = '<span class="stars' + (size === 'lg' ? ' lg' : '') + '">';
    for (let i = 1; i <= 10; i++) h += starSVG(i <= rating);
    return h + '</span>';
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ============================================================
     Navigation — simple screen stack
     ============================================================ */
  const screen = { name: 'categories', categoryId: null, itemId: null, sort: 'added' };

  const els = {
    title: document.getElementById('title'),
    back: document.getElementById('backBtn'),
    edit: document.getElementById('editBtn'),
    sortBtn: document.getElementById('sortBtn'),
    fab: document.getElementById('fab'),
    fabLabel: document.getElementById('fabLabel'),
    content: document.getElementById('content'),
  };

  let editMode = false; // category edit (delete) mode on the home screen
  let navDir = 'none';  // 'forward' | 'back' | 'none' — drives screen transition
  const listScroll = {}; // remembered scroll position of each category's item list
  function pageScrollY() { return window.scrollY || document.documentElement.scrollTop || 0; }

  const PENCIL_SVG = '<svg viewBox="0 0 24 24"><path d="M4 20.5l4.2-1 9.1-9.1a1.8 1.8 0 0 0 0-2.6l-1.1-1.1a1.8 1.8 0 0 0-2.6 0L4.5 15.8l-1 4.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 7.2l3.3 3.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function userName() {
    try {
      const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      if (u) return u.first_name || u.username || 'there';
    } catch (e) {}
    return 'there';
  }

  function syncTelegramBackButton() {
    const atRoot = screen.name === 'categories';
    if (canBackButton) {
      // Use Telegram's native back button; keep our in-app one hidden.
      try { atRoot ? tg.BackButton.hide() : tg.BackButton.show(); } catch (e) {}
      els.back.hidden = true;
    } else {
      // Browser / older-client fallback: show our own back button.
      els.back.hidden = atRoot;
    }
  }

  function goCategories() {
    screen.name = 'categories';
    screen.categoryId = null;
    screen.itemId = null;
    render();
  }
  function goCategory(id) {
    editMode = false;
    listScroll[id] = 0; // fresh entry from home starts at the top
    navDir = 'forward';
    screen.name = 'category';
    screen.categoryId = id;
    screen.itemId = null;
    render();
  }
  function goItem(id) {
    // remember where we were in the list so we can return to the same spot
    if (screen.name === 'category' && screen.categoryId) listScroll[screen.categoryId] = pageScrollY();
    navDir = 'forward';
    screen.name = 'item';
    screen.itemId = id;
    render();
  }
  function back() {
    if (screen.name === 'item') {
      haptic('light');
      navDir = 'back';
      screen.name = 'category';
      screen.itemId = null;
      render();
    } else if (screen.name === 'category') {
      haptic('light');
      navDir = 'back';
      goCategories();
    }
  }

  /* ============================================================
     Render
     ============================================================ */
  function render() {
    syncTelegramBackButton();
    const cls = navDir === 'forward' ? 'nav-forward' : navDir === 'back' ? 'nav-back' : 'nav-fade';
    els.content.className = 'content ' + cls; // set before innerHTML so fresh nodes animate
    navDir = 'none';
    if (screen.name === 'categories') renderCategories();
    else if (screen.name === 'category') renderCategory();
    else if (screen.name === 'item') renderItem();
  }

  function renderCategories() {
    const cats = state.categories;
    if (!cats.length) editMode = false; // nothing to edit

    els.title.textContent = 'Hi, ' + userName();
    els.sortBtn.hidden = true;
    els.fabLabel.textContent = 'Add Section';
    els.fab.hidden = editMode;               // hide Add while editing
    els.edit.hidden = cats.length === 0;     // no Edit button when empty
    els.edit.innerHTML = editMode ? CHECK_SVG : PENCIL_SVG;
    els.edit.classList.toggle('active', editMode);

    if (!cats.length) {
      els.content.innerHTML = emptyState('🗂️', 'No sections yet', 'Tap “Add Section” to create your first list — Films, Books, anything.');
      return;
    }

    let h = '<div class="list' + (editMode ? ' editing' : '') + '">';
    for (const c of cats) {
      const n = c.items.length;
      if (editMode) {
        h += '<div class="row cat-row editing" data-id="' + c.id + '">' +
          '<span class="drag-handle" aria-label="Reorder">' + dragIcon() + '</span>' +
          '<div class="cat-icon">' + (c.icon || '🗂️') + '</div>' +
          '<div class="row-body"><div class="row-title">' + escapeHTML(c.name) + '</div></div>' +
          '<div class="cat-actions">' +
            '<button class="cat-rename" data-rename="' + c.id + '" aria-label="Rename">' + PENCIL_SVG + '</button>' +
            '<button class="cat-delete" data-del="' + c.id + '" aria-label="Delete">' + trashIcon() + '</button>' +
          '</div>' +
        '</div>';
      } else {
        h += '<div class="row cat-row" data-cat="' + c.id + '">' +
          '<div class="cat-icon">' + (c.icon || '🗂️') + '</div>' +
          '<div class="row-body"><div class="row-title">' + escapeHTML(c.name) + '</div></div>' +
          '<div class="row-meta"><span class="count-pill">' + n + ' item' + (n === 1 ? '' : 's') + '</span>' +
          chevron() + '</div></div>';
      }
    }
    h += '</div>';
    els.content.innerHTML = h;

    if (editMode) {
      els.content.querySelectorAll('[data-rename]').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const cat = getCategory(el.dataset.rename);
          if (cat) openCategoryForm(cat);
        });
      });
      els.content.querySelectorAll('[data-del]').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const cat = getCategory(el.dataset.del);
          if (cat) confirmDeleteCategory(cat);
        });
      });
      const listEl = els.content.querySelector('.list');
      if (listEl) enableCatReorder(listEl);
    } else {
      els.content.querySelectorAll('[data-cat]').forEach((el) => {
        el.addEventListener('click', () => { haptic('light'); goCategory(el.dataset.cat); });
      });
    }
  }

  /* ---------- Drag-to-reorder sections (edit mode) ----------
     Touch/pointer based: drag the ≡ handle to move a section. Other
     rows shift to open a gap; on drop we commit the new order. */
  function dragIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M4 8h16M4 12h16M4 16h16" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  function enableCatReorder(listEl) {
    const GAP = 10; // keep in sync with .list gap
    let dragEl = null, handleEl = null, rows = [];
    let fromIndex = -1, toIndex = -1, slot = 0, startY = 0;

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      const handle = e.target.closest('.drag-handle');
      if (!handle || !listEl.contains(handle)) return;
      const row = handle.closest('.cat-row');
      if (!row) return;
      e.preventDefault();
      rows = Array.prototype.slice.call(listEl.querySelectorAll('.cat-row'));
      fromIndex = rows.indexOf(row);
      if (fromIndex < 0) return;
      toIndex = fromIndex;
      dragEl = row;
      handleEl = handle;
      slot = row.getBoundingClientRect().height + GAP;
      startY = e.clientY;
      row.classList.add('dragging');
      haptic('select');
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    }

    function onMove(e) {
      if (!dragEl) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      dragEl.style.transform = 'translateY(' + dy + 'px)';
      let idx = fromIndex + Math.round(dy / slot);
      idx = Math.max(0, Math.min(rows.length - 1, idx));
      if (idx === toIndex) return;
      toIndex = idx;
      haptic('light');
      rows.forEach((el, i) => {
        if (el === dragEl) return;
        let shift = 0;
        if (fromIndex < toIndex && i > fromIndex && i <= toIndex) shift = -slot;
        else if (fromIndex > toIndex && i >= toIndex && i < fromIndex) shift = slot;
        el.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      });
    }

    function onUp() {
      if (!dragEl) return;
      if (handleEl) {
        handleEl.removeEventListener('pointermove', onMove);
        handleEl.removeEventListener('pointerup', onUp);
        handleEl.removeEventListener('pointercancel', onUp);
      }
      const from = fromIndex, to = toIndex;
      dragEl = null; handleEl = null;
      if (from !== to) {
        const arr = state.categories;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        persist();
        haptic('success');
      }
      renderCategories();
    }

    listEl.addEventListener('pointerdown', onDown);
  }

  function renderCategory() {
    const cat = getCategory(screen.categoryId);
    if (!cat) return goCategories();

    els.title.textContent = cat.name;
    els.fabLabel.textContent = 'Add ' + cat.name;
    els.fab.hidden = false;
    els.edit.hidden = true;
    els.sortBtn.hidden = cat.items.length === 0; // nothing to sort when empty

    const items = sortedItems(cat.items, screen.sort);
    if (!items.length) {
      els.content.innerHTML = emptyState('🎬', 'Nothing here yet', 'Add your first entry with a rating and notes.');
      return;
    }

    let h = '<div class="list">';
    for (const it of items) {
      h += '<div class="row item-row" data-item="' + it.id + '">' +
        '<div class="row-title">' + escapeHTML(it.name) + '</div>' +
        '<div class="item-meta">' +
          '<span class="item-rating">' + it.rating + '/10' + miniStar() + '</span>' +
        '</div>' +
        chevron() +
      '</div>';
    }
    h += '</div>';
    els.content.innerHTML = h;

    els.content.querySelectorAll('[data-item]').forEach((el) => {
      el.addEventListener('click', () => { haptic('light'); goItem(el.dataset.item); });
    });

    // restore the remembered scroll position (modal-locked renders are
    // handled by the scroll lock itself, so skip those)
    if (!scrollLocked) {
      const y = listScroll[cat.id] || 0;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }

  function renderItem() {
    const cat = getCategory(screen.categoryId);
    if (!cat) return goCategories();
    const it = cat.items.find((x) => x.id === screen.itemId);
    if (!it) return goCategory(cat.id);

    els.title.textContent = cat.name;
    els.fab.hidden = true;
    els.edit.hidden = true;
    els.sortBtn.hidden = true;

    let h = '<div class="detail">' +
      '<div class="detail-hero">' +
        '<h2 class="detail-name">' + escapeHTML(it.name) + '</h2>' +
        '<div class="detail-stars">' + starsHTML(it.rating, 'lg') + '</div>' +
        '<div class="detail-rating-num">' + it.rating + ' / 10</div>' +
      '</div>';

    h += '<div class="detail-block">' +
      '<div class="detail-block-label">Description</div>' +
      '<div class="detail-block-value">' + (it.description ? escapeHTML(it.description) : '—') + '</div>' +
    '</div>';

    h += '<div class="detail-actions">' +
      '<button class="btn btn-danger" id="delItem">Delete</button>' +
      '<button class="btn btn-primary" id="editItem">Edit</button>' +
    '</div></div>';

    els.content.innerHTML = h;
    document.getElementById('editItem').addEventListener('click', () => openItemForm(cat, it));
    document.getElementById('delItem').addEventListener('click', () => confirmDeleteItem(cat, it));
  }

  function emptyState(emoji, title, text) {
    return '<div class="empty"><div class="empty-emoji">' + emoji + '</div>' +
      '<div class="empty-title">' + title + '</div>' +
      '<div class="empty-text">' + text + '</div></div>';
  }
  function chevron() {
    return '<span class="chevron"><svg viewBox="0 0 24 24" width="18" height="18">' +
      '<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  }
  function trashIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' +
      'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" ' +
      'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function miniStar() {
    return '<svg viewBox="0 0 24 24"><path d="' + STAR_PATH + '" fill="currentColor"/></svg>';
  }

  /* ---------- Sorting ---------- */
  function sortedItems(items, sort) {
    const arr = items.slice();
    if (sort === 'rating') arr.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
    else if (sort === 'alpha') arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    else arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); // added: oldest first, newest last
    return arr;
  }

  /* ============================================================
     Modals
     ============================================================ */
  const modalRoot = document.getElementById('modalRoot');

  /* ---- background scroll lock (freeze page while a modal/menu is open) ---- */
  let scrollLockY = 0;
  let scrollLocked = false;
  function lockScroll() {
    if (scrollLocked) return;
    scrollLocked = true;
    scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = (-scrollLockY) + 'px';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.classList.add('modal-open');
  }
  function unlockScroll() {
    if (!scrollLocked) return;
    scrollLocked = false;
    document.body.classList.remove('modal-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, scrollLockY);
  }
  function mountModal(overlay) {
    modalRoot.appendChild(overlay);
    lockScroll();
  }

  function closeModal() {
    const overlay = modalRoot.querySelector('.modal-overlay');
    if (!overlay) { modalRoot.innerHTML = ''; unlockScroll(); return; }
    overlay.classList.add('closing');
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); unlockScroll(); }, 180);
  }
  function buildOverlay(center) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay' + (center ? ' center' : '');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    return overlay;
  }
  function checkIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ---- Sort dropdown ---- */
  const SORT_OPTIONS = [['added', 'Date added'], ['rating', 'Rating'], ['alpha', 'Name (A–Z)']];
  function openSortMenu() {
    haptic('light');
    const rect = els.sortBtn.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.className = 'menu-overlay';
    const menu = document.createElement('div');
    menu.className = 'sort-menu';
    menu.innerHTML = '<div class="sort-menu-label">Sort by</div>' +
      SORT_OPTIONS.map(([k, label]) =>
        '<button class="sort-item' + (screen.sort === k ? ' active' : '') + '" data-sort="' + k + '">' +
          '<span>' + label + '</span><span class="check">' + checkIcon() + '</span>' +
        '</button>').join('');
    overlay.appendChild(menu);
    mountModal(overlay);
    const closeSort = () => { if (overlay.parentNode) overlay.remove(); unlockScroll(); };
    // anchor under the sort button, right-aligned
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSort(); });
    menu.querySelectorAll('.sort-item').forEach((b) => {
      b.addEventListener('click', () => {
        screen.sort = b.dataset.sort;
        haptic('select');
        closeSort();
        navDir = 'none';
        renderCategory();
      });
    });
  }

  /* ---- Add category (name only) ---- */
  function openCategoryForm(existing) {
    haptic('light');
    const isEdit = !!existing;
    const overlay = buildOverlay(false);
    overlay.innerHTML =
      '<div class="sheet" role="dialog">' +
        '<h3 class="sheet-title">' + (isEdit ? 'Rename Section' : 'New Category') + '</h3>' +
        '<div class="field">' +
          '<label class="field-label" for="catName">Name</label>' +
          '<input class="input" id="catName" type="text" placeholder="e.g. Books" maxlength="40" autocomplete="off" enterkeyhint="done" value="' + (isEdit ? escapeHTML(existing.name) : '') + '" />' +
          '<div class="field-error" id="catErr">Please enter a name.</div>' +
        '</div>' +
        '<div class="sheet-actions">' +
          '<button class="btn btn-secondary" id="cancel">Cancel</button>' +
          '<button class="btn btn-primary" id="save">' + (isEdit ? 'Save' : 'Create') + '</button>' +
        '</div>' +
      '</div>';
    mountModal(overlay);
    const input = overlay.querySelector('#catName');
    setTimeout(() => input.focus(), 60);
    overlay.querySelector('#cancel').addEventListener('click', closeModal);
    overlay.querySelector('#save').addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) { overlay.querySelector('#catErr').classList.add('show'); haptic('warning'); return; }
      if (isEdit) {
        existing.name = name; // keep the existing icon
      } else {
        state.categories.push({ id: uid(), name, icon: guessIcon(name), items: [] });
      }
      persist();
      haptic('success');
      closeModal();
      if (isEdit) renderCategories(); // stay in edit mode
      else render();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') overlay.querySelector('#save').click(); });
  }

  /* ---- Add / edit item ---- */
  function openItemForm(cat, existing) {
    haptic('light');
    const isEdit = !!existing;
    const data = existing || { name: '', rating: 0, description: '' };
    let rating = data.rating || 0;

    const overlay = buildOverlay(false);
    overlay.innerHTML =
      '<div class="sheet" role="dialog">' +
        '<h3 class="sheet-title">' + (isEdit ? 'Edit Entry' : 'New Entry') + '</h3>' +
        '<div class="field">' +
          '<label class="field-label" for="itName">Name</label>' +
          '<input class="input" id="itName" type="text" placeholder="Title" maxlength="120" autocomplete="off" enterkeyhint="done" value="' + escapeHTML(data.name) + '" />' +
          '<div class="field-error" id="itErr">Please enter a name.</div>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-label rating-label"><span>Rating</span>' +
            '<span class="rating-num"><b id="ratingVal">' + rating + '</b> / 10</span></div>' +
          '<div class="star-input-stars" id="starInput"></div>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="itDesc">Description</label>' +
          '<textarea class="textarea" id="itDesc" placeholder="Notes, thoughts, review…" maxlength="2000" enterkeyhint="done">' + escapeHTML(data.description || '') + '</textarea>' +
        '</div>' +
        '<div class="sheet-actions">' +
          '<button class="btn btn-secondary" id="cancel">Cancel</button>' +
          '<button class="btn btn-primary" id="save">' + (isEdit ? 'Save' : 'Add') + '</button>' +
        '</div>' +
      '</div>';
    mountModal(overlay);

    const starBox = overlay.querySelector('#starInput');
    const ratingVal = overlay.querySelector('#ratingVal');
    function paintStars() {
      let h = '';
      for (let i = 1; i <= 10; i++) {
        h += '<span class="s" data-v="' + i + '">' + starSVG(i <= rating) + '</span>';
      }
      starBox.innerHTML = h;
      ratingVal.textContent = rating;
      starBox.querySelectorAll('.s').forEach((s) => {
        s.addEventListener('click', () => {
          const v = parseInt(s.dataset.v, 10);
          rating = (v === rating) ? v - 1 : v; // tap same star again to decrement
          if (rating < 0) rating = 0;
          haptic('select');
          paintStars();
        });
      });
    }
    paintStars();

    const nameInput = overlay.querySelector('#itName');
    if (!isEdit) setTimeout(() => nameInput.focus(), 60);

    // Return key dismisses the keyboard instead of inserting a newline.
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
    });
    const descInput = overlay.querySelector('#itDesc');
    descInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); descInput.blur(); }
    });

    overlay.querySelector('#cancel').addEventListener('click', closeModal);
    overlay.querySelector('#save').addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { overlay.querySelector('#itErr').classList.add('show'); haptic('warning'); return; }
      const payload = {
        name,
        rating,
        description: overlay.querySelector('#itDesc').value.trim(),
      };
      if (isEdit) {
        Object.assign(existing, payload);
      } else {
        cat.items.push(Object.assign({ id: uid(), createdAt: Date.now() }, payload));
      }
      persist();
      haptic('success');
      closeModal();
      render();
    });
  }

  /* ---- Confirm delete item ---- */
  function confirmDeleteItem(cat, it) {
    haptic('warning');
    const overlay = buildOverlay(true);
    overlay.innerHTML =
      '<div class="confirm" role="dialog">' +
        '<div class="confirm-title">Delete entry?</div>' +
        '<div class="confirm-text">“' + escapeHTML(it.name) + '” will be removed permanently.</div>' +
        '<div class="confirm-actions">' +
          '<button class="btn btn-secondary" id="cancel">Cancel</button>' +
          '<button class="btn btn-danger" id="ok">Delete</button>' +
        '</div>' +
      '</div>';
    mountModal(overlay);
    overlay.querySelector('#cancel').addEventListener('click', closeModal);
    overlay.querySelector('#ok').addEventListener('click', () => {
      const idx = cat.items.findIndex((x) => x.id === it.id);
      if (idx >= 0) cat.items.splice(idx, 1);
      persist();
      haptic('success');
      closeModal();
      back(); // return to category list
      scrollLockY = listScroll[cat.id] || 0; // let the unlock land us back where we were
    });
  }

  /* ---- Confirm delete category ---- */
  function confirmDeleteCategory(cat) {
    haptic('warning');
    const n = cat.items.length;
    const note = n
      ? 'This will also remove ' + n + ' item' + (n === 1 ? '' : 's') + ' inside.'
      : '';
    const overlay = buildOverlay(true);
    overlay.innerHTML =
      '<div class="confirm" role="dialog">' +
        '<div class="confirm-title">Delete section?</div>' +
        '<div class="confirm-text">Are you sure you want to delete “' + escapeHTML(cat.name) + '”? ' + note + '</div>' +
        '<div class="confirm-actions">' +
          '<button class="btn btn-red" id="no">No</button>' +
          '<button class="btn btn-green" id="yes">Yes</button>' +
        '</div>' +
      '</div>';
    mountModal(overlay);
    overlay.querySelector('#no').addEventListener('click', () => { haptic('light'); closeModal(); });
    overlay.querySelector('#yes').addEventListener('click', () => {
      const idx = state.categories.findIndex((c) => c.id === cat.id);
      if (idx >= 0) state.categories.splice(idx, 1);
      persist();
      haptic('success');
      closeModal();
      renderCategories(); // stay in edit mode
    });
  }

  /* ============================================================
     Wiring
     ============================================================ */
  function onAdd() {
    if (screen.name === 'categories') openCategoryForm();
    else if (screen.name === 'category') {
      const cat = getCategory(screen.categoryId);
      if (cat) openItemForm(cat, null);
    }
  }

  function bindStaticUI() {
    els.fab.addEventListener('click', onAdd);
    els.back.addEventListener('click', back);
    els.sortBtn.addEventListener('click', openSortMenu);
    els.edit.addEventListener('click', () => {
      if (screen.name !== 'categories') return;
      editMode = !editMode;
      haptic(editMode ? 'medium' : 'light');
      navDir = 'none';
      renderCategories();
    });
    if (canBackButton) { try { tg.BackButton.onClick(back); } catch (e) {} }
    bindSwipeBack();
  }

  /* Swipe right to go back (mobile gesture). */
  function bindSwipeBack() {
    let sx = 0, sy = 0, tracking = false;
    els.content.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || screen.name === 'categories') { tracking = false; return; }
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    els.content.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      // mostly-horizontal right swipe, started anywhere in the content
      if (dx > 70 && Math.abs(dy) < 50 && Math.abs(dx) > Math.abs(dy) * 1.6) back();
    }, { passive: true });
  }

  /* ============================================================
     Init
     ============================================================ */
  function init() {
    if (tg) {
      try {
        tg.ready();
        tg.expand();
        if (tg.setHeaderColor) tg.setHeaderColor('#ffffff');
        if (tg.setBackgroundColor) tg.setBackgroundColor('#ffffff');
        if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
      } catch (e) {}
    }
    bindStaticUI();

    Storage.load().then((data) => {
      if (data && Array.isArray(data.categories)) {
        state = data;
        // backfill missing fields defensively
        state.categories.forEach((c) => {
          if (!c.id) c.id = uid();
          if (!Array.isArray(c.items)) c.items = [];
          c.items.forEach((it) => {
            if (!it.id) it.id = uid();
            if (typeof it.rating !== 'number') it.rating = 0;
          });
        });
      } else {
        state = seed();
        persist();
      }
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
