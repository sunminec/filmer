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

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ============================================================
     Navigation — simple screen stack
     ============================================================ */
  const screen = { name: 'categories', categoryId: null, itemId: null, sort: 'date' };

  const els = {
    title: document.getElementById('title'),
    back: document.getElementById('backBtn'),
    addBtn: document.getElementById('addBtn'),
    addLabel: document.getElementById('addLabel'),
    sortBar: document.getElementById('sortBar'),
    content: document.getElementById('content'),
  };

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
    screen.name = 'category';
    screen.categoryId = id;
    screen.itemId = null;
    render();
  }
  function goItem(id) {
    screen.name = 'item';
    screen.itemId = id;
    render();
  }
  function back() {
    haptic('light');
    if (screen.name === 'item') { screen.name = 'category'; screen.itemId = null; render(); }
    else if (screen.name === 'category') goCategories();
  }

  /* ============================================================
     Render
     ============================================================ */
  function render() {
    syncTelegramBackButton();
    if (screen.name === 'categories') renderCategories();
    else if (screen.name === 'category') renderCategory();
    else if (screen.name === 'item') renderItem();
  }

  function renderCategories() {
    els.title.textContent = 'Filmer';
    els.addLabel.textContent = 'Add';
    els.addBtn.hidden = false;
    els.sortBar.hidden = true;

    const cats = state.categories;
    if (!cats.length) {
      els.content.innerHTML = emptyState('🗂️', 'No categories yet', 'Tap “Add” to create your first list — Films, Books, anything.');
      return;
    }
    let h = '<div class="list">';
    for (const c of cats) {
      const n = c.items.length;
      h += '<div class="row" data-cat="' + c.id + '">' +
        '<div class="cat-icon">' + (c.icon || '🗂️') + '</div>' +
        '<div class="row-body"><div class="row-title">' + escapeHTML(c.name) + '</div></div>' +
        '<div class="row-meta"><span class="count-pill">' + n + ' item' + (n === 1 ? '' : 's') + '</span>' +
        chevron() + '</div></div>';
    }
    h += '</div>';
    els.content.innerHTML = h;

    els.content.querySelectorAll('[data-cat]').forEach((el) => {
      el.addEventListener('click', () => { haptic('light'); goCategory(el.dataset.cat); });
    });
  }

  function renderCategory() {
    const cat = getCategory(screen.categoryId);
    if (!cat) return goCategories();

    els.title.textContent = cat.name;
    els.addLabel.textContent = 'Add';
    els.addBtn.hidden = false;
    els.sortBar.hidden = false;

    // sort chips
    els.sortBar.querySelectorAll('.sort-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.sort === screen.sort);
    });

    const items = sortedItems(cat.items, screen.sort);
    if (!items.length) {
      els.content.innerHTML = emptyState('🎬', 'Nothing here yet', 'Add your first entry with a rating, date and notes.');
      return;
    }

    let h = '<div class="list">';
    for (const it of items) {
      const sub = [];
      if (it.watchDate) sub.push(escapeHTML(fmtDate(it.watchDate)));
      h += '<div class="row item-row" data-item="' + it.id + '">' +
        '<div class="row-body">' +
          '<div class="row-title">' + escapeHTML(it.name) + '</div>' +
          '<div class="row-sub">' +
            '<span class="item-rating-inline">' + starsHTML(it.rating, 'sm') +
              '<span class="num">' + it.rating + '</span></span>' +
            (sub.length ? '<span>·</span><span>' + sub.join('') + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="row-meta">' + chevron() + '</div>' +
      '</div>';
    }
    h += '</div>';
    els.content.innerHTML = h;

    els.content.querySelectorAll('[data-item]').forEach((el) => {
      el.addEventListener('click', () => { haptic('light'); goItem(el.dataset.item); });
    });
  }

  function renderItem() {
    const cat = getCategory(screen.categoryId);
    if (!cat) return goCategories();
    const it = cat.items.find((x) => x.id === screen.itemId);
    if (!it) return goCategory(cat.id);

    els.title.textContent = cat.name;
    els.addBtn.hidden = true;
    els.sortBar.hidden = true;

    let h = '<div class="detail">' +
      '<div class="detail-hero">' +
        '<h2 class="detail-name">' + escapeHTML(it.name) + '</h2>' +
        '<div class="detail-stars">' + starsHTML(it.rating, 'lg') + '</div>' +
        '<div class="detail-rating-num">' + it.rating + ' / 10</div>' +
      '</div>';

    h += '<div class="detail-block">' +
      '<div class="detail-block-label">Watch date</div>' +
      '<div class="detail-block-value">' + (it.watchDate ? escapeHTML(fmtDate(it.watchDate)) : '—') + '</div>' +
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

  /* ---------- Sorting ---------- */
  function sortedItems(items, sort) {
    const arr = items.slice();
    if (sort === 'rating') arr.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
    else if (sort === 'alpha') arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    else arr.sort((a, b) => { // date, newest first
      const da = a.watchDate || '', db = b.watchDate || '';
      if (da && db) return db.localeCompare(da);
      if (da) return -1;
      if (db) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return arr;
  }

  /* ============================================================
     Modals
     ============================================================ */
  const modalRoot = document.getElementById('modalRoot');

  function closeModal() {
    modalRoot.innerHTML = '';
  }
  function buildOverlay(center) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay' + (center ? ' center' : '');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    return overlay;
  }

  /* ---- Add category (name only) ---- */
  function openCategoryForm() {
    haptic('light');
    const overlay = buildOverlay(false);
    overlay.innerHTML =
      '<div class="sheet" role="dialog">' +
        '<div class="sheet-grabber"></div>' +
        '<h3 class="sheet-title">New Category</h3>' +
        '<div class="field">' +
          '<label class="field-label" for="catName">Name</label>' +
          '<input class="input" id="catName" type="text" placeholder="e.g. Books" maxlength="40" autocomplete="off" />' +
          '<div class="field-error" id="catErr">Please enter a name.</div>' +
        '</div>' +
        '<div class="sheet-actions">' +
          '<button class="btn btn-secondary" id="cancel">Cancel</button>' +
          '<button class="btn btn-primary" id="save">Create</button>' +
        '</div>' +
      '</div>';
    modalRoot.appendChild(overlay);
    const input = overlay.querySelector('#catName');
    setTimeout(() => input.focus(), 60);
    overlay.querySelector('#cancel').addEventListener('click', closeModal);
    overlay.querySelector('#save').addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) { overlay.querySelector('#catErr').classList.add('show'); haptic('warning'); return; }
      state.categories.push({ id: uid(), name, icon: guessIcon(name), items: [] });
      persist();
      haptic('success');
      closeModal();
      render();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') overlay.querySelector('#save').click(); });
  }

  /* ---- Add / edit item ---- */
  function openItemForm(cat, existing) {
    haptic('light');
    const isEdit = !!existing;
    const data = existing || { name: '', rating: 0, watchDate: '', description: '' };
    let rating = data.rating || 0;

    const overlay = buildOverlay(false);
    overlay.innerHTML =
      '<div class="sheet" role="dialog">' +
        '<div class="sheet-grabber"></div>' +
        '<h3 class="sheet-title">' + (isEdit ? 'Edit Entry' : 'New Entry') + '</h3>' +
        '<div class="field">' +
          '<label class="field-label" for="itName">Name</label>' +
          '<input class="input" id="itName" type="text" placeholder="Title" maxlength="120" autocomplete="off" value="' + escapeHTML(data.name) + '" />' +
          '<div class="field-error" id="itErr">Please enter a name.</div>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label">Rating</label>' +
          '<div class="star-input">' +
            '<div class="star-input-stars" id="starInput"></div>' +
            '<div class="star-input-val"><span id="ratingVal">' + rating + '</span><span class="max"> / 10</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="itDate">Watch date</label>' +
          '<input class="input" id="itDate" type="date" value="' + escapeHTML(data.watchDate || '') + '" />' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label" for="itDesc">Description</label>' +
          '<textarea class="textarea" id="itDesc" placeholder="Notes, thoughts, review…" maxlength="2000">' + escapeHTML(data.description || '') + '</textarea>' +
        '</div>' +
        '<div class="sheet-actions">' +
          '<button class="btn btn-secondary" id="cancel">Cancel</button>' +
          '<button class="btn btn-primary" id="save">' + (isEdit ? 'Save' : 'Add') + '</button>' +
        '</div>' +
      '</div>';
    modalRoot.appendChild(overlay);

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
    overlay.querySelector('#cancel').addEventListener('click', closeModal);
    overlay.querySelector('#save').addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { overlay.querySelector('#itErr').classList.add('show'); haptic('warning'); return; }
      const payload = {
        name,
        rating,
        watchDate: overlay.querySelector('#itDate').value || '',
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
    modalRoot.appendChild(overlay);
    overlay.querySelector('#cancel').addEventListener('click', closeModal);
    overlay.querySelector('#ok').addEventListener('click', () => {
      const idx = cat.items.findIndex((x) => x.id === it.id);
      if (idx >= 0) cat.items.splice(idx, 1);
      persist();
      haptic('success');
      closeModal();
      back(); // return to category list
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
    els.addBtn.addEventListener('click', onAdd);
    els.back.addEventListener('click', back);
    els.sortBar.querySelectorAll('.sort-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        screen.sort = chip.dataset.sort;
        haptic('select');
        renderCategory();
      });
    });
    if (canBackButton) { try { tg.BackButton.onClick(back); } catch (e) {} }
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
