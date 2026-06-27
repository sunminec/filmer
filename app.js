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
     One-time bulk import — PRIVATE to a single Telegram account.
     Runs once (guarded by a flag stored in that account's own
     CloudStorage) and only for MY_TG_ID, so nobody else's data is
     touched. Safe to delete this whole block after it has run.
     ============================================================ */
  const MY_TG_ID = 552097382; // private import — only this account
  const IMPORT_ID = 'bulk-2026-06-27';
  const IMPORT_DATE = '2026-06-27'; // today, per request
  const IMPORT_GROUPS = [
    { name: 'Фільми', icon: '🎬', raw: `Не дыши
Пила
Ван хелсинг
Призрачний гонщик
Знакомтесь Джо блек
Мальчишник в Вегасе
Проект Х
Дежавю
Веном
Беславнные ублюдки
Парфюмер
Грань будущего
Я робот
Платформа
Живая сталь
Бетмен
Список Шиндлера
Джокер
Еквилибриум
Опенгеймер
Игры разума
Остров проклятых
Интерсталер
Великий уравнитель
Побег из Шоушенка
Законопослушний гражданин
Пираты карибского моря
Форд против Феррари
Тупой еще тупее
Екзамен
Время
Машинист
Брюс всемогущий
Шоу Трумана
Никто не выжил
Перелом
Бойцовский клуб
Семь
Місія Кандагар
Линкольн для адвоката
Невидимый гость
Пленници
Престиж
Крушение
Идеальний шторм
Дракула
Игра в имитацию
Дьявол в деталях
Джанго освобожденний
Зеленая книга
Третий лишний
На гребне волни
Исцезнувшая
Кошмар на улице В’язов
Метод Хитча
Я Легенда
Мертвая тишина
Милие кости
Башня
Зеленая мила
Достать ножи
Обдарованая
Мег
Аватар
Финч
Судная ночь
Подмена
Девушка из поезда
Игра
Тихое место
Гладиатор
Взаперти
Не стучи дважди
Крестний отец
Шестое чуство
Безлица
Начало
Хенкок
Реквием по мечте
Черний телефон
Битва титанов
Гнев титанов
Области тьмы
Стрингер
Власть страха
Падший
Троя
Отступники
Востанние зловещих мертвецов
Вышка
Граф Монте Кристо
Меч Короля Артура
Мотылёк
Темная башня
Наркоз
Золото
Обливион
Джон Уик
Немыслемое
Оленьи рога
Эффект бабочки
Аватар 2
Всегда говори да
Орудия
1+1
Формула 1` },
    { name: 'Серіали', icon: '📺', raw: `Ходячие мертвецы
Бойтесь ходячих мертвецов
Побег
Шерлок
Бумажный дом
Настоящий детектив
Скорпион
Игра в кальмара
Люпен
Джек ричер
Во все тяжкие
Северные воды
Сквозь снег
Очень странные дела
Ганибал
Сотня
Чернобыль
Игра престолов
Бункер
Извне
Дом драконов
Декстер
Лучше звоните Солу
Twin Peks
Пингвин
Кассандра
Снегопад
Lost
Гангстерленд
Ты
Менталист
День Шакала` },
    { name: 'Ігри', icon: '🎮', raw: `Френ боу
The Quorry
Салли кромсали
Athanasy
Зайчик
Until dawn
The last of us
Бесконечное лето
Detroit Become Human` },
    { name: 'Аніме', icon: '🎌', raw: `Обещанный неверленд
Атака титанов
Город в котором меня нет
Доктор стоун
Тетрадь смерти
Кибербанк на грани
Монстр
Первый шаг
Берсерк
Аркейн
7 смертных грехов
Каслвания
Клинок рассекающий демонов
Solo leveling
One punch men
Магическая битва
Токийский гуль` },
    { name: 'Мультфільми', icon: '🧸', raw: `Ріо
Тачки
Геркулес
Алладин
Как приручить дракона
Храброе сердце
Время приключений
Гравити фолз
Плохие парни
Суперсемейка
Мадагаскар
Гадкий Я
Холодное сердце
История игрушек
Рапунцель
Труп невесты
Король лев
Дев’ять
Мегамозг
Роботы
Город героев` },
  ];

  function isMe() {
    try {
      const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      return !!u && u.id === MY_TG_ID;
    } catch (e) { return false; }
  }

  // Map the default English seed categories onto the localized groups
  // so we adopt them instead of creating duplicates.
  function importAliasKey(name) {
    const n = String(name || '').trim().toLowerCase();
    if (n === 'films' || n === 'фильмы') return 'фільми';
    if (n === 'series' || n === 'сериалы') return 'серіали';
    if (n === 'games' || n === 'игры') return 'ігри';
    return n;
  }

  // Returns true if it actually changed state (caller should persist).
  function applyBulkImport() {
    if (!isMe()) return false;
    if (!state.imported) state.imported = {};
    if (state.imported[IMPORT_ID]) return false;

    for (const grp of IMPORT_GROUPS) {
      const target = grp.name.toLowerCase();
      let cat = state.categories.find((c) => importAliasKey(c.name) === target);
      if (!cat) {
        cat = { id: uid(), name: grp.name, icon: grp.icon, items: [] };
        state.categories.push(cat);
      } else if (!cat.items.length) {
        cat.name = grp.name;   // adopt empty default seed → localized name/icon
        cat.icon = grp.icon;
      }
      const seen = new Set(cat.items.map((i) => String(i.name).trim().toLowerCase()));
      const titles = grp.raw.split('\n').map((s) => s.trim()).filter(Boolean);
      for (const title of titles) {
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cat.items.push({
          id: uid(), createdAt: Date.now(), name: title,
          rating: 0, watchDate: IMPORT_DATE, description: '',
        });
      }
    }
    state.imported[IMPORT_ID] = true;
    return true;
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
    edit: document.getElementById('editBtn'),
    sortBtn: document.getElementById('sortBtn'),
    fab: document.getElementById('fab'),
    fabLabel: document.getElementById('fabLabel'),
    content: document.getElementById('content'),
  };

  let editMode = false; // category edit (delete) mode on the home screen
  let navDir = 'none';  // 'forward' | 'back' | 'none' — drives screen transition

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
    navDir = 'forward';
    screen.name = 'category';
    screen.categoryId = id;
    screen.itemId = null;
    render();
  }
  function goItem(id) {
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

    let h = '<div class="list">';
    for (const c of cats) {
      const n = c.items.length;
      if (editMode) {
        h += '<div class="row cat-row editing">' +
          '<div class="cat-icon">' + (c.icon || '🗂️') + '</div>' +
          '<div class="row-body"><div class="row-title">' + escapeHTML(c.name) + '</div></div>' +
          '<button class="cat-delete" data-del="' + c.id + '" aria-label="Delete">' + trashIcon() + '</button>' +
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
      els.content.querySelectorAll('[data-del]').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const cat = getCategory(el.dataset.del);
          if (cat) confirmDeleteCategory(cat);
        });
      });
    } else {
      els.content.querySelectorAll('[data-cat]').forEach((el) => {
        el.addEventListener('click', () => { haptic('light'); goCategory(el.dataset.cat); });
      });
    }
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
      els.content.innerHTML = emptyState('🎬', 'Nothing here yet', 'Add your first entry with a rating, date and notes.');
      return;
    }

    let h = '<div class="list">';
    for (const it of items) {
      h += '<div class="row item-row" data-item="' + it.id + '">' +
        '<div class="row-title">' + escapeHTML(it.name) + '</div>' +
        '<div class="item-meta">' +
          '<span class="item-rating">' + it.rating + '/10' + miniStar() + '</span>' +
          (it.watchDate ? '<span class="item-date">' + escapeHTML(fmtDate(it.watchDate)) + '</span>' : '') +
        '</div>' +
        chevron() +
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
  const SORT_OPTIONS = [['date', 'Date'], ['rating', 'Rating'], ['alpha', 'Name (A–Z)']];
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
  function openCategoryForm() {
    haptic('light');
    const overlay = buildOverlay(false);
    overlay.innerHTML =
      '<div class="sheet" role="dialog">' +
        '<h3 class="sheet-title">New Category</h3>' +
        '<div class="field">' +
          '<label class="field-label" for="catName">Name</label>' +
          '<input class="input" id="catName" type="text" placeholder="e.g. Books" maxlength="40" autocomplete="off" enterkeyhint="done" />' +
          '<div class="field-error" id="catErr">Please enter a name.</div>' +
        '</div>' +
        '<div class="sheet-actions">' +
          '<button class="btn btn-secondary" id="cancel">Cancel</button>' +
          '<button class="btn btn-primary" id="save">Create</button>' +
        '</div>' +
      '</div>';
    mountModal(overlay);
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
          '<label class="field-label" for="itDate">Watch date</label>' +
          '<input class="input" id="itDate" type="date" value="' + escapeHTML(data.watchDate || '') + '" />' +
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
    mountModal(overlay);
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
      if (applyBulkImport()) persist();
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
