const SETTINGS_SOCIALS = [
  ['Telegram', 'https://t.me/vanta_hubx', 'social-telegram'],
  ['Discord', 'https://discord.gg/hcaQVThnmG', 'social-discord'],
];
function settingsCopy(ru, en) { return state.data?.settings?.appLanguage === 'ru' ? ru : en; }
function applyInterfaceScale(value) { document.documentElement.style.setProperty('--app-ui-scale', String(value || 1)); }

function applyVantaTheme(theme) {
  const colors = theme?.colors || {};
  const background = theme?.background || {};
  const effects = theme?.effects || {};
  const shape = theme?.shape || {};
  const root = document.documentElement;
  const color = (token, fallback) => colors[token] || fallback;
  const boundedNumber = (value, fallback, maximum) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : fallback;
  };
  const imageUrl = (() => {
    try {
      const url = new URL(background.imageUrl || '');
      return url.protocol === 'file:' && !url.hostname && /\.(?:png|jpe?g|webp)$/i.test(decodeURIComponent(url.pathname)) ? url.href : '';
    } catch { return ''; }
  })();
  const gradient = background.gradient && background.gradient.type === 'linear'
    && Array.isArray(background.gradient.colors) && background.gradient.colors.length >= 2 && background.gradient.colors.length <= 5
    ? `linear-gradient(${boundedNumber(background.gradient.angle, 180, 360)}deg, ${background.gradient.colors.join(', ')})`
    : '';
  const contrastInk = (value) => {
    const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(String(value || ''));
    if (!match) return color('text', '#f2f2f2');
    const hex = match[1].length === 3 ? match[1].split('').map((part) => part + part).join('') : match[1];
    const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.42 ? '#101010' : '#ffffff';
  };
  root.dataset.themeId = theme?.id || 'vanta-default';
  root.style.setProperty('--theme-background', color('background', '#070707'));
  root.style.setProperty('--theme-surface', color('surface', '#111111'));
  root.style.setProperty('--theme-surface-elevated', color('surfaceElevated', '#1a1a1a'));
  root.style.setProperty('--theme-surface-hover', color('surfaceHover', '#202020'));
  root.style.setProperty('--theme-surface-active', color('surfaceActive', '#2a2a2a'));
  root.style.setProperty('--theme-text', color('text', '#f2f2f2'));
  root.style.setProperty('--theme-muted', color('textMuted', '#929292'));
  root.style.setProperty('--theme-disabled', color('textDisabled', '#6a6a6a'));
  root.style.setProperty('--theme-border', color('border', '#2b2b2b'));
  root.style.setProperty('--theme-accent', color('accent', '#ffffff'));
  root.style.setProperty('--theme-accent-hover', color('accentHover', '#ffffff'));
  root.style.setProperty('--theme-accent-active', color('accentActive', '#d0d0d0'));
  root.style.setProperty('--theme-success', color('success', '#4ade80'));
  root.style.setProperty('--theme-warning', color('warning', '#facc15'));
  root.style.setProperty('--theme-danger', color('danger', '#ef4444'));
  root.style.setProperty('--theme-overlay', color('overlay', 'rgba(0,0,0,.65)'));
  root.style.setProperty('--theme-shadow', color('shadow', 'rgba(0,0,0,.55)'));
  root.style.setProperty('--theme-input', color('input', '#101010'));
  root.style.setProperty('--theme-button', color('button', color('accent', '#ffffff')));
  root.style.setProperty('--theme-button-ink', contrastInk(color('button', color('accent', '#ffffff'))));
  root.style.setProperty('--theme-card', color('card', '#171717'));
  root.style.setProperty('--theme-sidebar', color('sidebar', '#0d0d0d'));
  root.style.setProperty('--theme-modal', color('modal', '#171717'));
  root.style.setProperty('--theme-tooltip', color('tooltip', '#1f1f1f'));
  root.style.setProperty('--theme-scrollbar', color('scrollbar', '#5a5a5a'));
  root.style.setProperty('--theme-focus', color('focus', color('accent', '#ffffff')));
  root.style.setProperty('--theme-background-gradient', gradient || 'linear-gradient(180deg, var(--theme-surface), var(--theme-background) 50%, color-mix(in srgb, var(--theme-background) 82%, var(--theme-surface)) 100%)');
  root.style.setProperty('--theme-background-overlay', background.overlay || 'rgba(0, 0, 0, 0)');
  root.style.setProperty('--theme-wallpaper-image', imageUrl ? `url("${imageUrl}")` : 'none');
  root.style.setProperty('--theme-wallpaper-opacity', String(boundedNumber(background.opacity, 0, 1)));
  root.style.setProperty('--theme-wallpaper-position', background.position || 'center');
  root.style.setProperty('--theme-wallpaper-size', background.size || 'cover');
  root.style.setProperty('--theme-wallpaper-repeat', background.repeat || 'no-repeat');
  root.style.setProperty('--theme-blur-surface', `${boundedNumber(effects.blurSurface, 0, 24)}px`);
  root.style.setProperty('--theme-blur-sidebar', `${boundedNumber(effects.blurSidebar, 0, 24)}px`);
  root.style.setProperty('--theme-blur-modal', `${boundedNumber(effects.blurModal, 0, 24)}px`);
  root.style.setProperty('--theme-shadow-small', effects.shadowSmall || 'rgba(0, 0, 0, 0.25)');
  root.style.setProperty('--theme-shadow-medium', effects.shadowMedium || 'rgba(0, 0, 0, 0.4)');
  root.style.setProperty('--theme-shadow-large', effects.shadowLarge || color('shadow', 'rgba(0, 0, 0, 0.55)'));
  root.style.setProperty('--theme-radius-small', `${boundedNumber(shape.radiusSmall, 4, 32)}px`);
  root.style.setProperty('--theme-radius-medium', `${boundedNumber(shape.radiusMedium, 8, 32)}px`);
  root.style.setProperty('--theme-radius-large', `${boundedNumber(shape.radiusLarge, 14, 32)}px`);
  root.style.setProperty('--bg', color('background', '#070707'));
  root.style.setProperty('--panel', color('surface', '#111111'));
  root.style.setProperty('--panel-2', color('surfaceElevated', '#1a1a1a'));
  root.style.setProperty('--line', color('border', '#2b2b2b'));
  root.style.setProperty('--text', color('text', '#f2f2f2'));
  root.style.setProperty('--muted', color('textMuted', '#929292'));
  root.style.setProperty('--accent', color('accent', '#ffffff'));
  root.style.setProperty('--accent-ink', contrastInk(color('accent', '#ffffff')));
  root.style.setProperty('--danger', color('danger', '#ef4444'));
}
window.applyVantaTheme = applyVantaTheme;

function themeMatchesSearch(theme, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return true;
  return [theme.name, theme.author, theme.description, localizedTheme(theme).name, localizedTheme(theme).description]
    .some((value) => String(value || '').toLocaleLowerCase().includes(needle));
}

function themeTokenDescription(token) {
  const descriptions = {
    background: ['Основной цвет приложения; изображение, overlay и градиент задаются отдельно.', 'Main app color; image, overlay, and gradient are configured separately.'],
    surface: ['Обычные панели и поверхности.', 'Standard panels and surfaces.'],
    surfaceElevated: ['Приподнятые панели и меню.', 'Raised panels and menus.'],
    surfaceHover: ['Поверхности при наведении.', 'Surfaces on hover.'],
    surfaceActive: ['Активные поверхности и вторичные кнопки.', 'Active surfaces and secondary buttons.'],
    text: ['Основной текст.', 'Primary text.'],
    textMuted: ['Вторичный, менее яркий текст.', 'Secondary, subdued text.'],
    textDisabled: ['Неактивный текст.', 'Disabled text.'],
    border: ['Границы карточек, полей и разделителей.', 'Card, input, and divider borders.'],
    accent: ['Главный цвет выделения и действий.', 'Primary highlight and action color.'],
    accentHover: ['Акцент кнопок при наведении.', 'Accent color for hovered actions.'],
    accentActive: ['Нажатый/активный вариант акцента.', 'Pressed or active accent color.'],
    success: ['Успешные состояния.', 'Success states.'],
    warning: ['Предупреждения.', 'Warnings.'],
    danger: ['Ошибки и опасные действия.', 'Errors and destructive actions.'],
    overlay: ['Затемнение за диалогами.', 'Backdrop behind dialogs.'],
    shadow: ['Тени карточек и диалогов.', 'Card and dialog shadows.'],
    input: ['Фон полей ввода и списков.', 'Input and select backgrounds.'],
    button: ['Фон основных кнопок.', 'Primary button background.'],
    card: ['Фон карточек и крупных панелей.', 'Cards and large panels.'],
    sidebar: ['Фон боковой панели и статусной строки.', 'Sidebar and status bar background.'],
    modal: ['Фон диалоговых окон.', 'Dialog backgrounds.'],
    tooltip: ['Фон уведомлений и подсказок.', 'Notifications and tooltip background.'],
    scrollbar: ['Ползунок полосы прокрутки.', 'Scrollbar thumb.'],
    focus: ['Обводка элемента в фокусе.', 'Focus outline color.'],
    blurSurface: ['Размытие поиска и отдельных панелей: 0–24 px; повторяющиеся карточки не размываются.', 'Blur for search and selected panels: 0–24 px; repeated card grids stay unfiltered.'],
    blurSidebar: ['Размытие боковой панели: 0–24 px.', 'Sidebar backdrop blur: 0–24 px.'],
    blurModal: ['Размытие компактных системных окон: 0–24 px. Большие окна и предпросмотр остаются без фильтра для плавности.', 'Blur for compact utility dialogs: 0–24 px. Large dialogs and previews stay unfiltered for smooth playback.'],
    shadowSmall: ['Цвет лёгких теней.', 'Color for subtle shadows.'],
    shadowMedium: ['Цвет теней карточек.', 'Color for card shadows.'],
    shadowLarge: ['Цвет теней модальных окон.', 'Color for modal shadows.'],
    radiusSmall: ['Скругление компактных контролов: 0–32 px.', 'Corner radius for compact controls: 0–32 px.'],
    radiusMedium: ['Скругление карточек и панелей: 0–32 px.', 'Corner radius for cards and panels: 0–32 px.'],
    radiusLarge: ['Скругление крупных панелей и диалогов: 0–32 px.', 'Corner radius for large panels and dialogs: 0–32 px.'],
  };
  const value = descriptions[token];
  return value ? settingsCopy(value[0], value[1]) : settingsCopy('Цветовой токен темы.', 'Theme color token.');
}

function closeThemeDialog(dialog) {
  if (!dialog.open) { dialog.remove(); return Promise.resolve(); }
  if (dialog.closePromise) return dialog.closePromise;
  dialog.classList.add('is-closing');
  dialog.closePromise = new Promise((resolve) => {
    let finished = false;
    let timer;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      dialog.removeEventListener('animationend', onAnimationEnd);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve();
    };
    const onAnimationEnd = (event) => { if (event.target === dialog) finish(); };
    dialog.addEventListener('animationend', onAnimationEnd);
    timer = setTimeout(finish, 220);
  });
  return dialog.closePromise;
}

function openThemeCreationGuide() {
  const template = state.data.themeTemplate;
  if (!template?.colors) return toast(settingsCopy('Шаблон темы пока не загружен. Перезапустите страницу.', 'The theme template has not loaded. Refresh the page.'));
  const templateText = JSON.stringify(template, null, 2);
  const tokens = Array.isArray(state.data.themeTokens) ? state.data.themeTokens : Object.keys(template.colors);
  document.querySelector('#theme-creation-guide')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'theme-creation-guide';
  dialog.className = 'theme-guide-dialog';
  dialog.innerHTML = `<button class="theme-details-close" data-guide-close aria-label="${settingsCopy('Закрыть', 'Close')}">×</button>
    <div class="theme-guide-content">
      <p class="theme-store-kicker">${settingsCopy('ПЕРСОНАЛИЗАЦИЯ VANTA', 'VANTA PERSONALIZATION')}</p>
      <h2>${settingsCopy('Создать собственную тему', 'Create your own theme')}</h2>
      <p class="theme-guide-intro">${settingsCopy('Создавайте собственный внешний вид VANTA через безопасные поля theme.json: цвета, фон и визуальные эффекты — без CSS и JavaScript.', 'Create your own VANTA look through safe theme.json fields: colors, backgrounds, and visual effects—no CSS or JavaScript.')}</p>
      <ol class="theme-guide-steps">
        <li><strong>${settingsCopy('Скопируйте готовый шаблон', 'Copy the ready-to-use template')}</strong><span>${settingsCopy('Ниже приведён полный JSON, который соответствует текущей проверке VANTA.', 'The complete JSON below matches VANTA’s current validator.')}</span></li>
        <li><strong>${settingsCopy('Сохраните его как theme.json', 'Save it as theme.json')}</strong><span>${settingsCopy('Создайте папку для работы и сохраните файл в UTF-8. Замените id на уникальный вариант; в translations.ru и translations.en задайте описание для обоих языков.', 'Create a working folder and save it as UTF-8. Choose a unique id; use translations.ru and translations.en for language-specific names and descriptions.')}</span></li>
        <li><strong>${settingsCopy('Настройте цвета и форму', 'Tune colors and shape')}</strong><span>${settingsCopy('Поддерживаются HEX, rgb(), rgba(), hsl() и hsla(). rgba() сохраняет прозрачность поверхностей. radiusSmall/Medium/Large задают три уровня скругления от 0 до 32 px.', 'Supported colors are HEX, rgb(), rgba(), hsl(), and hsla(); rgba() keeps surfaces translucent. radiusSmall/Medium/Large set three corner levels from 0 to 32 px.')}</span></li>
        <li><strong>${settingsCopy('Настройте градиенты и эффекты', 'Configure gradients and effects')}</strong><span>${settingsCopy('Безопасный linear gradient задаётся типом, углом 0–360° и 2–5 цветами. blurSurface/blurSidebar/blurModal ограничены 0–24 px; shadowSmall/Medium/Large задают цвета теней.', 'Safe linear gradients use a type, 0–360° angle, and 2–5 colors. blurSurface/blurSidebar/blurModal are limited to 0–24 px; shadowSmall/Medium/Large set shadow colors.')}</span></li>
        <li><strong>${settingsCopy('Импортируйте тему', 'Import the theme')}</strong><span>${settingsCopy('Выберите theme.json с соседним background.png/.jpg/.webp либо ZIP/.vanta-theme с файлами темы. Фон ограничен 10 MB, preview.png — 5 MB.', 'Choose theme.json with a sibling background.png/.jpg/.webp or a ZIP/.vanta-theme package. Backgrounds are limited to 10 MB and preview.png to 5 MB.')}</span></li>
      </ol>
      <div class="theme-guide-preview-note"><strong>${settingsCopy('Фоновое изображение и overlay', 'Wallpaper and overlay')}</strong><span>${settingsCopy('В background укажите только имя файла и настройте position, size, repeat, opacity (0–1) и overlay. Обои должны находиться рядом с theme.json; пути наружу из темы запрещены.', 'Under background, set only a file name plus position, size, repeat, opacity (0–1), and overlay. The image must sit beside theme.json; paths outside the theme are rejected.')}</span></div>
      <div class="theme-guide-preview-note"><strong>${settingsCopy('Предпросмотр темы', 'Theme preview')}</strong><span>${settingsCopy('preview.png необязателен и используется только в каталоге тем. Без него VANTA сгенерирует карточку из палитры.', 'preview.png is optional and used only in the theme catalog. Without it, VANTA generates a preview from the palette.')}</span></div>
      <section class="theme-guide-template"><div class="theme-guide-section-heading"><div><h3>${settingsCopy('Шаблон theme.json', 'theme.json template')}</h3><p>${settingsCopy('Все обязательные поля и цветовые токены уже включены.', 'All required fields and color tokens are included.')}</p></div><button class="action" data-guide-copy>${settingsCopy('Скопировать шаблон', 'Copy template')}</button></div><pre><code>${escapeHtml(templateText)}</code></pre></section>
      <section class="theme-guide-token-section"><h3>${settingsCopy('Что меняет каждый токен', 'What each token changes')}</h3><div class="theme-guide-token-table"><div class="theme-guide-token-row theme-guide-token-head"><strong>${settingsCopy('Токен', 'Token')}</strong><strong>${settingsCopy('Назначение', 'Purpose')}</strong><strong>${settingsCopy('Пример', 'Example')}</strong></div>${tokens.map((token) => `<div class="theme-guide-token-row"><code>${escapeHtml(token)}</code><span>${escapeHtml(themeTokenDescription(token))}</span><code>${escapeHtml(template.colors[token] || '')}</code></div>`).join('')}</div></section>
      <footer class="theme-guide-actions"><button class="action secondary" data-guide-open-folder>${settingsCopy('Открыть папку тем', 'Open themes folder')}</button><button class="action" data-guide-import>${settingsCopy('Импортировать тему', 'Import theme')}</button></footer>
    </div>`;
  const close = () => closeThemeDialog(dialog);
  dialog.querySelector('[data-guide-close]').onclick = close;
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  dialog.querySelector('[data-guide-copy]').onclick = async () => {
    try {
      await call('themes:copy-template', { text: templateText });
      toast(settingsCopy('Шаблон скопирован. Сохраните его в файл theme.json.', 'Template copied. Save it as theme.json.'));
    } catch (error) { toast(error.message); }
  };
  dialog.querySelector('[data-guide-open-folder]').onclick = async () => {
    try { await call('themes:open-folder'); }
    catch (error) { toast(error.message); }
  };
  dialog.querySelector('[data-guide-import]').onclick = async () => {
    await close();
    try {
      const response = await call('themes:import');
      if (response.cancelled) return;
      state.data = { ...state.data, ...response, settings: { ...state.data.settings, ...response.settings } };
      renderThemesPage();
      toast(settingsCopy('Тема импортирована. Откройте её карточку, чтобы применить.', 'Theme imported. Open its card to apply it.'));
    } catch (error) { toast(error.message); }
  };
  document.body.appendChild(dialog);
  dialog.showModal();
}

function localizedTheme(theme) {
  const language = state.data.settings?.appLanguage === 'ru' ? 'ru' : 'en';
  const bundledTranslations = {
    'vanta-default': { ru: { name: 'VANTA Стандартная', description: 'Стандартная тёмная тема VANTA с нейтральным акцентом.' } },
    'vanta-midnight-red': { ru: { name: 'Полночный рубин', description: 'Глубокие графитовые поверхности и яркий малиновый акцент.' } },
    'vanta-cyberpunk': { ru: { name: 'Неоновый киберпанк', description: 'Электрические голубые и фиолетовые акценты на фоне ночного города.' } },
    'vanta-ocean': { ru: { name: 'Океанская бездна', description: 'Холодные синие поверхности и яркие бирюзовые кнопки.' } },
    'vanta-emerald': { ru: { name: 'Изумрудная роща', description: 'Спокойная лесная палитра с изумрудными акцентами.' } },
    'vanta-glass': { ru: { name: 'Стекло', description: 'Полупрозрачные поверхности, локальные обои и мягкое размытие.' } },
    'vanta-amoled': { ru: { name: 'AMOLED Минимализм', description: 'Почти чёрная палитра, тонкие границы и контрастный акцент.' } },
  };
  const builtIn = bundledTranslations[theme.id]?.[language] || {};
  const localized = theme.translations?.[language] || {};
  return {
    name: localized.name || builtIn.name || theme.name,
    description: localized.description || builtIn.description || theme.description,
  };
}

function themeCardMarkup(theme, activeThemeId) {
  const active = theme.id === activeThemeId;
  const display = localizedTheme(theme);
  const source = theme.source === 'builtin' ? settingsCopy('Встроенная', 'Built-in') : theme.source === 'catalog' ? settingsCopy('Каталог', 'Catalog') : settingsCopy('Моя тема', 'My theme');
  const status = settingsCopy('✓ Активна', '✓ Active');
  return `<article class="theme-store-card ${active ? 'is-active' : ''}" data-theme-card="${escapeHtml(theme.id)}" tabindex="0" role="button" aria-label="${escapeHtml(settingsCopy('Подробнее о теме', 'Theme details'))}: ${escapeHtml(theme.name)}">
    <div class="theme-store-preview"><img src="${escapeHtml(theme.preview || '')}" alt="${escapeHtml(settingsCopy('Предпросмотр темы', 'Theme preview'))}: ${escapeHtml(display.name)}" loading="lazy"><span class="theme-store-source">${source}</span>${active ? `<span class="theme-store-active">${status}</span>` : ''}</div>
    <div class="theme-store-card-body"><div class="theme-store-title-row"><div><h3>${escapeHtml(display.name || settingsCopy('Пользовательская тема', 'Custom theme'))}</h3><p>${escapeHtml(theme.author || 'VANTA')}</p></div><span class="theme-store-arrow" aria-hidden="true">↗</span></div>
      <p class="theme-store-description">${escapeHtml(display.description || settingsCopy('Пользовательская тема интерфейса.', 'Custom interface theme.'))}</p>
      <div class="theme-store-card-footer"><span class="theme-store-version">v${escapeHtml(theme.version || '1.0.0')}</span><button class="action ${active ? 'secondary' : ''}" data-theme-details="${escapeHtml(theme.id)}">${settingsCopy('Подробнее', 'Details')}</button></div>
    </div>
  </article>`;
}

function renderThemesPage() {
  const settings = state.data.settings || {};
  const themes = Array.isArray(state.data.themes) ? state.data.themes : [];
  const activeThemeId = settings.activeThemeId || 'vanta-default';
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) || themes[0];
  if (activeTheme) applyVantaTheme(activeTheme);
  const filteredThemes = () => {
    const sourceThemes = state.themeFilter === 'my'
      ? themes.filter((theme) => theme.source === 'local' || theme.source === 'user')
      : state.themeFilter === 'catalog'
        ? themes.filter((theme) => theme.source === 'catalog')
        : themes;
    return sourceThemes.filter((theme) => themeMatchesSearch(theme, state.themeQuery));
  };
  const renderCards = () => {
    const grid = $('#theme-store-grid');
    if (!grid) return;
    const items = filteredThemes();
    grid.innerHTML = items.length ? items.map((theme) => themeCardMarkup(theme, activeThemeId)).join('') : `<div class="theme-store-empty"><strong>${settingsCopy('Темы не найдены', 'No themes found')}</strong><p>${settingsCopy('Измените запрос или импортируйте тему.', 'Change the search or import a theme.')}</p></div>`;
    bindThemeCards(grid, themes);
  };
  $('#content').innerHTML = `<section class="theme-store-page">
    <button class="theme-store-back" id="theme-store-back"><span aria-hidden="true">←</span>${settingsCopy('Назад', 'Back')}</button>
    <header class="theme-store-heading"><div><p class="theme-store-kicker">${settingsCopy('ПЕРСОНАЛИЗАЦИЯ VANTA', 'VANTA PERSONALIZATION')}</p><h2>${settingsCopy('Магазин тем', 'Theme store')}</h2><p>${settingsCopy('Коллекция тем для VANTA', 'A curated collection of themes for VANTA')}</p></div><div class="theme-store-heading-actions"><button id="theme-create-guide" class="action secondary">${settingsCopy('＋ Создать тему', '＋ Create theme')}</button><button id="theme-open-folder" class="action secondary">${settingsCopy('Папка тем', 'Theme folder')}</button><button id="theme-import" class="action">${settingsCopy('Импортировать тему', 'Import theme')}</button></div></header>
    <div class="theme-store-toolbar"><div class="theme-store-tabs" role="tablist"><button class="theme-store-tab ${state.themeFilter === 'all' ? 'active' : ''}" data-theme-filter="all">${settingsCopy('Все', 'All')}<span>${themes.length}</span></button><button class="theme-store-tab ${state.themeFilter === 'catalog' ? 'active' : ''}" data-theme-filter="catalog">${settingsCopy('Каталог', 'Catalog')}<span>${themes.filter((theme) => theme.source === 'catalog').length}</span></button><button class="theme-store-tab ${state.themeFilter === 'my' ? 'active' : ''}" data-theme-filter="my">${settingsCopy('Мои темы', 'My themes')}<span>${themes.filter((theme) => theme.source === 'local' || theme.source === 'user').length}</span></button></div><label class="theme-store-search"><span aria-hidden="true">⌕</span><input id="theme-store-search" type="search" value="${escapeHtml(state.themeQuery || '')}" placeholder="${settingsCopy('Поиск по названию, автору или описанию', 'Search by name, author, or description')}" aria-label="${settingsCopy('Поиск тем', 'Search themes')}"><kbd>Ctrl K</kbd></label></div>
    <div id="theme-store-grid" class="theme-store-grid"></div>
    <footer class="theme-store-footer">${settingsCopy('Темы каталога опубликованы отдельно от модов и появляются только здесь. Локальные темы хранятся на этом устройстве.', 'Catalog themes are published separately from mods and appear only here. Local themes stay on this device.')}</footer>
  </section>`;
  renderCards();
  $('#theme-store-search').oninput = (event) => { state.themeQuery = event.target.value; renderCards(); };
  $('#theme-store-search').onkeydown = (event) => { if (event.key === 'Escape' && event.currentTarget.value) { event.currentTarget.value = ''; state.themeQuery = ''; renderCards(); } };
  $('#theme-create-guide').onclick = openThemeCreationGuide;
  window.onThemeSearchShortcut = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && state.view === 'themes') {
      event.preventDefault();
      $('#theme-store-search')?.focus();
    }
  };
  document.querySelectorAll('[data-theme-filter]').forEach((button) => button.onclick = () => { state.themeFilter = button.dataset.themeFilter || 'all'; renderThemesPage(); });
  $('#theme-store-back').onclick = () => {
    state.view = state.themeReturnView || 'discover';
    state.themeReturnView = null;
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
    state.view === 'settings' ? render() : loadCatalog();
  };
  $('#theme-import').onclick = async () => {
    try {
      const response = await call('themes:import');
      if (response.cancelled) return;
      state.data = { ...state.data, ...response, settings: { ...state.data.settings, ...response.settings } };
      render();
      toast(settingsCopy('Тема импортирована.', 'Theme imported.'));
    } catch (error) { toast(error.message); }
  };
  $('#theme-open-folder').onclick = async () => { try { await call('themes:open-folder'); } catch (error) { toast(error.message); } };
}

function bindThemeCards(container, themes) {
  const openDetails = (id) => showThemeDetails(themes.find((theme) => theme.id === id));
  container.querySelectorAll('[data-theme-card]').forEach((card) => {
    card.onclick = (event) => { if (!event.target.closest('button')) openDetails(card.dataset.themeCard); };
    card.onkeydown = (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === card) { event.preventDefault(); openDetails(card.dataset.themeCard); } };
  });
  container.querySelectorAll('[data-theme-details]').forEach((button) => button.onclick = () => openDetails(button.dataset.themeDetails));
}

function showThemeDetails(theme) {
  if (!theme) return;
  document.querySelector('#theme-details-dialog')?.remove();
  const active = theme.id === (state.data.settings?.activeThemeId || 'vanta-default');
  const display = localizedTheme(theme);
  const canRemove = theme.source !== 'builtin' && theme.source !== 'catalog' && theme.id !== 'vanta-default';
  const dialog = document.createElement('dialog');
  dialog.id = 'theme-details-dialog';
  dialog.className = 'theme-details-dialog';
  const sourceLabel = theme.source === 'builtin' ? settingsCopy('Встроенная тема', 'Built-in theme') : theme.source === 'catalog' ? settingsCopy('Тема каталога', 'Catalog theme') : settingsCopy('Пользовательская тема', 'User theme');
  const sourceShortLabel = theme.source === 'builtin' ? settingsCopy('Встроенная', 'Built-in') : theme.source === 'catalog' ? settingsCopy('Каталог', 'Catalog') : settingsCopy('Моя тема', 'My theme');
  const authorName = String(theme.author || 'VANTA');
  const author = typeof getAuthorCardProfile === 'function' ? getAuthorCardProfile(authorName) : null;
  const authorMarkup = author ? `<button type="button" class="author-link theme-details-author" data-theme-author="${escapeHtml(authorName)}" aria-label="${escapeHtml(settingsCopy('Открыть профиль автора', 'Open author profile'))}">${author.avatarUrl ? `<img src="${escapeHtml(author.avatarUrl)}" alt="">` : `<span class="author-fallback">${escapeHtml(authorName.slice(0, 1).toUpperCase())}</span>`}<span>${escapeHtml(authorName)}</span></button>` : `<span class="theme-details-author-name">${escapeHtml(authorName)}</span>`;
  dialog.innerHTML = `<button class="theme-details-close" aria-label="${settingsCopy('Закрыть', 'Close')}">×</button><img class="theme-details-preview" src="${escapeHtml(theme.preview || '')}" alt="${escapeHtml(display.name)}"><div class="theme-details-copy"><p class="theme-store-kicker">${escapeHtml(sourceLabel)}</p><h2>${escapeHtml(display.name)}</h2><div class="theme-details-author-row">${authorMarkup}<span>v${escapeHtml(theme.version || '1.0.0')}</span></div><p class="theme-details-description">${escapeHtml(display.description || settingsCopy('Пользовательская тема интерфейса.', 'Custom interface theme.'))}</p><div class="theme-details-meta"><span>${settingsCopy('Источник', 'Source')}</span><strong>${escapeHtml(sourceShortLabel)}</strong><span>${settingsCopy('Статус', 'Status')}</span><strong>${active ? settingsCopy('Активна', 'Active') : settingsCopy('Не активна', 'Inactive')}</strong></div><div class="theme-details-actions"><button class="action ${active ? 'secondary' : ''}" data-detail-apply>${active ? settingsCopy('Тема применена', 'Theme applied') : settingsCopy('Применить тему', 'Apply theme')}</button>${canRemove ? `<button class="action secondary" data-detail-remove>${settingsCopy('Удалить тему', 'Remove theme')}</button>` : ''}</div></div>`;
  const close = () => closeThemeDialog(dialog);
  dialog.querySelector('.theme-details-close').onclick = close;
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.querySelector('[data-theme-author]')?.addEventListener('click', async (event) => {
    state.author = event.currentTarget.dataset.themeAuthor;
    state.authorQuery = '';
    state.authorSort = 'default';
    state.view = 'authors';
    state.category = 'all';
    state.hero = '';
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === 'authors'));
    window.scrollTo(0, 0);
    await close();
    loadCatalog();
  });
  dialog.querySelector('[data-detail-apply]').onclick = async () => {
    try {
      const response = await call('themes:apply', { themeId: theme.id });
      state.data = { ...state.data, ...response, settings: { ...state.data.settings, ...response.settings } };
      await close();
      renderThemesPage();
      toast(settingsCopy('Тема применена.', 'Theme applied.'));
    } catch (error) { toast(error.message); }
  };
  dialog.querySelector('[data-detail-remove]')?.addEventListener('click', async () => {
    const confirmation = await showAppConfirmDialog({ title: settingsCopy('Удалить тему?', 'Remove theme?'), message: settingsCopy('Тема будет удалена с диска. Если она активна, VANTA вернётся к стандартной теме.', 'This theme will be deleted. If active, VANTA will return to the default theme.'), confirmLabel: settingsCopy('Удалить', 'Remove'), destructive: true });
    if (!confirmation.confirmed) return;
    try {
      const response = await call('themes:remove', { themeId: theme.id });
      state.data = { ...state.data, ...response, settings: { ...state.data.settings, ...response.settings } };
      await close();
      renderThemesPage();
      toast(settingsCopy('Тема удалена.', 'Theme removed.'));
    } catch (error) { toast(error.message); }
  });
  document.body.appendChild(dialog);
  dialog.showModal();
}

function renderSettings() {
  const gamePath = state.data.gamePath || settingsCopy('Не настроено', 'Not configured');
  const settings = state.data.settings || {};
  const themes = Array.isArray(state.data.themes) ? state.data.themes : [];
  const activeTheme = themes.find((theme) => theme.id === (settings.activeThemeId || 'vanta-default')) || themes[0] || { id: 'vanta-default', name: 'VANTA Default', author: 'VANTA', source: 'local', preview: '' };
  applyInterfaceScale(settings.interfaceScale || 1);
  const enabled = (value) => value ? settingsCopy('Включено', 'Enabled') : settingsCopy('Выключено', 'Disabled');
  $('#content').innerHTML = `<div class="settings-panel settings-page">
    <div class="settings-page-heading"><div><p class="eyebrow">VANTA DOTA2 HUB</p><h2>${settingsCopy('Настройки', 'Settings')}</h2><p>${settingsCopy('Подключение игры, поведение интерфейса и обновления приложения.', 'Game connection, interface behavior and application updates.')}</p></div></div>
    <div class="settings-grid">
      <section class="settings-category settings-category-appearance"><h3>${settingsCopy('Внешний вид', 'Appearance')}</h3><p class="settings-category-description">${settingsCopy('Тема и плотность интерфейса VANTA.', 'Theme and interface density of VANTA.')}</p>
        <div class="setting-row"><div><strong>${settingsCopy('Текущая тема', 'Current theme')}</strong><div class="setting-value">${escapeHtml(localizedTheme(activeTheme).name || settingsCopy('VANTA Стандартная', 'VANTA Default'))}<br><small>${escapeHtml(activeTheme.author || 'VANTA')}</small></div></div><div class="setting-actions"><button id="open-theme-store" class="action">${settingsCopy('Открыть магазин тем', 'Open theme catalog')}</button></div></div>
        <div class="setting-row"><div><strong>${settingsCopy('Язык интерфейса', 'Application language')}</strong><div class="setting-value">${settingsCopy('Язык интерфейса VANTA', 'VANTA interface language')}</div></div><select id="app-language"><option value="en">${settingsCopy('Английский', 'English')}</option><option value="ru">Русский</option></select></div>
        <div class="setting-row"><div><strong>${settingsCopy('Масштаб интерфейса', 'Interface scale')}</strong><div class="setting-value">${settingsCopy('Настройка плотности интерфейса', 'Adjust interface density')}</div></div><div class="scale-control"><input id="interface-scale" type="range" min="0.8" max="1.4" step="0.05" value="${settings.interfaceScale || 1}"><output id="interface-scale-value">${Number(settings.interfaceScale || 1).toFixed(2)}×</output><button id="reset-interface-scale" class="action secondary">${settingsCopy('Сбросить', 'Reset')}</button></div></div>
      </section>
      <section class="settings-category settings-category-dota"><h3>${settingsCopy('Dota 2 и моды', 'Dota 2 and mods')}</h3><p class="settings-category-description">${settingsCopy('Путь к игре и папка, в которую устанавливаются моды.', 'Game path and the folder used for installed mods.')}</p>
        <div class="setting-row"><div><strong>${settingsCopy('Путь к Dota 2', 'Dota 2 installation')}</strong><div class="setting-value setting-path" title="${gamePath}">${gamePath}</div></div><div class="setting-actions"><button id="detect-game" class="action secondary">${settingsCopy('Определить автоматически', 'Auto detect')}</button><button id="browse-game" class="action">${settingsCopy('Выбрать папку', 'Browse')}</button></div></div>
        <div class="setting-row"><div><strong>${settingsCopy('Папка языка', 'Language folder')}</strong><div class="setting-value">${settingsCopy('Папка файлов модов', 'Mod files language folder')}</div></div><select id="language-folder"><option value="russian">${settingsCopy('Русский', 'Russian')}</option><option value="english">${settingsCopy('Английский', 'English')}</option><option value="schinese">${settingsCopy('Китайский (упрощённый)', 'Simplified Chinese')}</option></select></div>
      </section>
      <section class="settings-category settings-category-activity"><h3>${settingsCopy('Обновления и активность', 'Updates and activity')}</h3><p class="settings-category-description">${settingsCopy('Фоновая проверка обновлений и статус VANTA в Discord.', 'Update checks and VANTA activity in Discord.')}</p>
        <div class="setting-row"><div><strong>${settingsCopy('Автообновление', 'Auto update')}</strong><div class="setting-value">${settingsCopy('Проверять обновления VANTA', 'Check for VANTA updates')}</div></div><button id="auto-update" class="toggle-button ${settings.autoUpdateEnabled !== false ? 'on' : ''}">${enabled(settings.autoUpdateEnabled !== false)}</button></div>
        <div class="setting-row"><div><strong>${settingsCopy('Активность в Discord', 'Discord activity')}</strong><div class="setting-value">${settingsCopy('Показывать активность VANTA в Discord', 'Show VANTA activity in Discord')}</div></div><button id="discord-activity" class="toggle-button ${settings.discordActivityEnabled ? 'on' : ''}">${enabled(settings.discordActivityEnabled)}</button></div>
      </section>
      <section class="settings-category settings-category-about">
        <div class="settings-category-header">
          <span class="app-version-badge">${settingsCopy('Версия', 'Version')} · ${state.data.appVersion || '—'}</span>
          <h3>${settingsCopy('О программе', 'About')}</h3>
        </div>
        <p class="settings-category-description">${settingsCopy('Источник каталога, обновление данных и связь с сообществом.', 'Catalog source, data refresh, and community links.')}</p>
        <div class="setting-row"><div><strong>${settingsCopy('Источник каталога', 'Catalog source')}</strong><div class="setting-value">GitHub · artem-prime42/dota2-mod-manager-catalog</div></div><span class="badge">External</span></div>
        <div class="setting-row"><div><strong>${settingsCopy('Обновление каталога', 'Catalog update')}</strong><div class="setting-value">${settingsCopy('Получить последнюю версию каталога', 'Get the latest catalog version')}</div></div><button id="settings-refresh-catalog" class="action">${settingsCopy('Обновить каталог', 'Refresh catalog')}</button></div>
        <div class="setting-row"><div><strong>${settingsCopy('Обновление VANTA', 'VANTA update')}</strong><div class="setting-value">${settingsCopy('Проверить новую версию приложения', 'Check for a new application version')}</div></div><button id="settings-check-updates" class="action">${settingsCopy('Проверить обновления', 'Check for updates')}</button></div>
        <div class="setting-row"><div><strong>${settingsCopy('Архивы модов', 'Mod archives')}</strong><div class="setting-value">${settingsCopy('Сохраняются для быстрой переустановки без повторной загрузки.', 'Kept for quick reinstalls without downloading again.')}</div><div id="settings-archive-size" class="setting-value">${settingsCopy('Подсчёт размера...', 'Calculating size...')}</div><div id="settings-archive-path" class="setting-value">${settingsCopy('Определение папки...', 'Locating archive folder...')}</div></div><div class="setting-actions"><button id="settings-browse-archives" class="action">${settingsCopy('Обзор', 'Browse')}</button><button id="settings-clear-archives" class="action secondary">${settingsCopy('Удалить все архивы', 'Delete all archives')}</button></div></div>
        <div class="settings-diagnostics"><div><strong>${settingsCopy('Диагностика и логи', 'Diagnostics and logs')}</strong><p>${settingsCopy('Сохранить диагностику, логи и списки файлов в ZIP-архив. Перед отправкой проверьте его: внутри могут быть пути к игре и имена модов.', 'Save diagnostics, logs, and file listings in a ZIP archive. Review it before sharing: it may contain game paths and mod names.')}</p></div><div class="setting-actions"><button id="settings-export-linux-diagnostic" class="action secondary">${settingsCopy('Linux отчёт JSON', 'Linux JSON report')}</button><button id="settings-export-diagnostics" class="action secondary">${settingsCopy('Экспортировать отчёт', 'Export report')}</button></div></div>
        <div class="setting-row requested-socials"><div><strong>${settingsCopy('Социальные сети', 'Social networks')}</strong><div class="setting-value">${settingsCopy('Новости и поддержка проекта', 'Project news and support')}</div></div><div class="social-actions">${SETTINGS_SOCIALS.map(([name, url, tone]) => `<a class="social-button ${tone}" href="${url}" target="_blank" rel="noreferrer">${name}</a>`).join('')}</div></div>
      </section>
    </div>
  </div>`;

  $('#open-theme-store').onclick = () => { state.themeReturnView = 'settings'; state.themeFilter = 'all'; state.themeQuery = ''; state.view = 'themes'; window.scrollTo(0, 0); document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === 'themes')); render(); };
  const set = async (key, value) => { state.data = await call('settings:set', { key, value }); renderSettings(); };
  $('#detect-game').onclick = async () => { try { state.data = await call('game:detect'); updateGameStatus(state.data.gamePath); renderSettings(); toast(state.data.gamePath ? settingsCopy('Dota 2 найдена.', 'Dota 2 installation detected.') : settingsCopy('Dota 2 не найдена.', 'Dota 2 was not found.')); } catch (error) { toast(error.message); } };
  $('#browse-game').onclick = async () => { try { state.data = await call('game:set-path'); updateGameStatus(state.data.gamePath); renderSettings(); } catch (error) { toast(error.message); } };
  $('#language-folder').value = settings.langSuffix || 'russian';
  $('#app-language').value = settings.appLanguage || 'en';
  $('#language-folder').onchange = (event) => set('langSuffix', event.target.value);
  $('#app-language').onchange = (event) => set('appLanguage', event.target.value);
  $('#auto-update').onclick = () => set('autoUpdateEnabled', settings.autoUpdateEnabled === false);
  $('#discord-activity').onclick = () => set('discordActivityEnabled', !settings.discordActivityEnabled);
  $('#interface-scale').oninput = (event) => { document.documentElement.style.setProperty('--app-ui-scale', event.target.value); $('#interface-scale-value').value = `${Number(event.target.value).toFixed(2)}×`; };
  $('#interface-scale').onchange = (event) => set('interfaceScale', Number(event.target.value));
  $('#reset-interface-scale').onclick = () => { applyInterfaceScale(1); set('interfaceScale', 1); };
  $('#settings-refresh-catalog').onclick = async (event) => { const button = event.currentTarget; button.disabled = true; try { state.data = await call('catalog:refresh'); toast(settingsCopy('Каталог обновлён.', 'Catalog updated.')); } catch (error) { toast(error.message); } finally { button.disabled = false; } };
  $('#settings-check-updates').onclick = async (event) => { const button = event.currentTarget; button.disabled = true; try { const result = await call('update:check', { manual: true }); if (result.status === 'not-available') toast(settingsCopy('Новых обновлений нет.', 'No updates are available.')); } catch (error) { toast(error.message); } finally { button.disabled = false; } };
  $('#settings-export-diagnostics').onclick = async (event) => { const button = event.currentTarget; button.disabled = true; try { const result = await call('diagnostics:export'); if (!result.canceled) toast(settingsCopy('ZIP-архив диагностики сохранён.', 'Diagnostic ZIP archive saved.')); } catch (error) { toast(error.message); } finally { button.disabled = false; } };
  $('#settings-export-linux-diagnostic').onclick = async (event) => { const button = event.currentTarget; button.disabled = true; try { const result = await call('diagnostics:linux-export'); if (!result.canceled) toast(settingsCopy('Linux-отчёт сохранён.', 'Linux diagnostic report saved.')); } catch (error) { toast(error.message); } finally { button.disabled = false; } };
  if (!navigator.userAgent.includes('Linux')) $('#settings-export-linux-diagnostic').hidden = true;
  const formatArchiveSize = (bytes) => { const value = Number(bytes || 0); if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`; return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`; };
  const updateArchiveStats = async () => { try { const stats = await call('downloads:stats'); const label = settingsCopy('архивов', 'archives'); $('#settings-archive-size').textContent = `${stats.count} ${label} · ${formatArchiveSize(stats.bytes)}`; $('#settings-archive-path').textContent = `${settingsCopy('Хранятся здесь:', 'Stored in:')} ${(stats.directories || []).join(' · ')}`; } catch { $('#settings-archive-size').textContent = settingsCopy('Размер недоступен', 'Size unavailable'); $('#settings-archive-path').textContent = settingsCopy('Папка недоступна', 'Folder unavailable'); } };
  updateArchiveStats();
  $('#settings-browse-archives').onclick = () => { state.view = 'download-archives'; state.archiveSelection.clear(); loadCatalog(); };
  $('#settings-clear-archives').onclick = async (event) => { const button = event.currentTarget; const confirmation = await showAppConfirmDialog({ title: settingsCopy('Удалить архивы?', 'Delete archives?'), message: settingsCopy('Удалить все сохранённые архивы модов?', 'Delete all saved mod archives?'), confirmLabel: settingsCopy('Удалить', 'Delete'), destructive: true }); if (!confirmation.confirmed) return; button.disabled = true; try { await call('downloads:clear'); await updateArchiveStats(); toast(settingsCopy('Архивы удалены.', 'Archives deleted.')); } catch (error) { toast(error.message); } finally { button.disabled = false; } };
}

renderSettings = renderSettings;
