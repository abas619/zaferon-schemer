/* ==================================================================
 * Application bootstrap — chrome, documents, menus, dialogs,
 * keyboard shortcuts and the screen eyedropper.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { el, on, clear, clamp, qs } = CS.Util;
  const Color = CS.Color;
  const Store = CS.Store;
  const W = CS.Widgets;

  /* ================================================================== *
   * State
   * ================================================================== */

  const documents = {}; // id -> panel instance
  let activeDoc = 'matching';
  let statusTimer = null;

  const DOC_META = {
    matching: { label: 'Matching Colors', toolbar: 0 },
    gallery: { label: 'GalleryBrowser', toolbar: 1 },
    photo: { label: 'PhotoSchemer', toolbar: 2 },
    builder: { label: 'SchemeBuilder', toolbar: 3 },
    browser: { label: 'SchemeBrowser', toolbar: 4 }
  };

  const docFactories = {
    matching: () => CS.Panels.Matching.create(),
    gallery: () => CS.Panels.Gallery.create(),
    photo: () => CS.Panels.Photo.create(),
    builder: () => CS.Panels.Builder.create(),
    browser: () => CS.Panels.Browser.create()
  };

  /* ================================================================== *
   * Status bar
   * ================================================================== */

  function defaultStatus() {
    const rgb = Store.rgb();
    const safe = Color.isWebsafe(rgb);
    const label = safe ? 'Web Safe' : 'Not Websafe';
    return `${label}  ·  ${Store.hexUpper()}  ·  R ${rgb.r}  G ${rgb.g}  B ${rgb.b}`;
  }

  function setStatus(text, ms = 4200) {
    const node = qs('#status-left');
    if (!node) return;
    clearTimeout(statusTimer);
    node.textContent = text || defaultStatus();
    if (text && ms) {
      statusTimer = setTimeout(() => {
        node.textContent = defaultStatus();
      }, ms);
    }
  }

  function refreshStatus() {
    if (statusTimer) return;
    const node = qs('#status-left');
    if (node) node.textContent = defaultStatus();
  }

  /* ================================================================== *
   * Documents
   * ================================================================== */

  function getDocument(id) {
    if (!documents[id]) {
      const factory = docFactories[id];
      if (!factory) return null;
      documents[id] = factory();
      documents[id].root.classList.add('doc-panel');
    }
    return documents[id];
  }

  function openDocument(id) {
    if (!DOC_META[id]) return;
    const doc = getDocument(id);
    if (!doc) return;

    activeDoc = id;
    const host = qs('#doc-host');
    clear(host);
    host.appendChild(doc.root);

    Store.set('document', id);
    updateToolbarState();
    updatePaletteVisibility();
    refreshMenus();

    requestAnimationFrame(() => {
      if (doc.root.querySelector('canvas')) {
        doc.root.dispatchEvent(new Event('resize'));
      }
      window.dispatchEvent(new Event('resize'));
    });
  }

  function closeDocument(id) {
    if (id === 'matching') {
      setStatus('The Matching Colors workspace cannot be closed.');
      return;
    }
    const doc = documents[id];
    if (doc) {
      if (doc.destroy) doc.destroy();
      if (doc.root.parentNode) doc.root.parentNode.removeChild(doc.root);
      delete documents[id];
    }
    if (activeDoc === id) openDocument('matching');
  }

  function updatePaletteVisibility() {
    const host = qs('#palette-host');
    const splitter = qs('#splitter-palette');
    const show = activeDoc === 'matching' && Store.get('showPalette', true) !== false;
    host.classList.toggle('is-hidden', !show);
    splitter.classList.toggle('is-hidden', !show);
  }

  function togglePalette(show) {
    Store.set('showPalette', show == null ? !(Store.get('showPalette', true) !== false) : show);
    updatePaletteVisibility();
  }

  function togglePanel(which) {
    const map = {
      baseColor: { dock: '#dock-left', key: 'showBaseColor', node: 'baseColor' },
      matching: { dock: '#dock-left', key: 'showBaseColor', node: 'baseColor' },
      favorites: { dock: '#dock-right', key: 'showFavorites', node: 'favorites' }
    };
    const cfg = map[which];
    if (!cfg) return;
    const dock = qs(cfg.dock);
    const visible = !dock.classList.contains('is-hidden');
    dock.classList.toggle('is-hidden', visible);
    const splitter = dock.previousElementSibling;
    if (splitter && splitter.classList.contains('splitter')) splitter.classList.toggle('is-hidden', visible);
    Store.set(cfg.key, !visible);
  }

  /* ================================================================== *
   * Docks
   * ================================================================== */

  function buildDocks() {
    const left = qs('#dock-left');
    const right = qs('#dock-right');

    /* Each panel is mounted in isolation. A panel that throws on bad persisted
     * state used to abort the rest of buildDocks() — which blanked every dock
     * after it (the right dock and the palette strip went white, with the
     * reason only visible in the console). One broken panel is now one missing
     * panel, and the console says which. */
    const mount = (name, factory, host, id) => {
      try {
        const panel = factory.create();
        panel.root.classList.add('dock-panel');
        host.appendChild(panel.root);
        documents[id] = panel;
        return panel;
      } catch (err) {
        console.error(`[app] ${name} panel failed to build`, err);
        return null;
      }
    };

    mount('Base Color', CS.Panels.BaseColor, left, 'baseColor');
    mount('Favorite Colors', CS.Panels.Favorites, right, 'favorites');
    mount('Palette', CS.Panels.Palette, qs('#palette-host'), 'palette');

    if (Store.get('showBaseColor', true) === false) left.classList.add('is-hidden');
    if (Store.get('showFavorites', true) === false) right.classList.add('is-hidden');

    const sizes = Store.get('dockSizes', {});
    if (sizes.left) left.style.width = `${sizes.left}px`;
    if (sizes.right) right.style.width = `${sizes.right}px`;
    if (sizes.palette) qs('#palette-host').style.height = `${sizes.palette}px`;
  }

  function buildSplitters() {
    CS.Util.qsa('.splitter').forEach((sp) => {
      const kind = sp.dataset.split;
      on(sp, 'pointerdown', (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const left = qs('#dock-left');
        const right = qs('#dock-right');
        const palette = qs('#palette-host');
        const startLeft = left.offsetWidth;
        const startRight = right.offsetWidth;
        const startPal = palette.offsetHeight;

        document.body.classList.add('is-resizing');

        const move = (ev) => {
          if (kind === 'left') {
            left.style.width = `${clamp(startLeft + (ev.clientX - startX), 120, 380)}px`;
          } else if (kind === 'right') {
            right.style.width = `${clamp(startRight - (ev.clientX - startX), 140, 400)}px`;
          } else {
            palette.style.height = `${clamp(startPal - (ev.clientY - startY), 48, 360)}px`;
          }
          window.dispatchEvent(new Event('resize'));
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          document.body.classList.remove('is-resizing');
          Store.set('dockSizes', {
            left: left.offsetWidth,
            right: right.offsetWidth,
            palette: palette.offsetHeight
          });
          Object.keys(documents).forEach((k) => {
            if (documents[k].onResize) documents[k].onResize();
          });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    });
  }

  /* ================================================================== *
   * Toolbar
   * ================================================================== */

  /* Toolbar icons come from the generated Lucide set (js/ui/icons.js). They are
   * single-stroke, currentColor drawings, so the toolbar needs no per-icon
   * colour rules and both themes get them for free. */
  const TOOL_ICONS = ['palette', 'layout-grid', 'image', 'blocks', 'layers'].map((n) =>
    CS.Icons.svg(n, 20)
  );

  /* Utilities rather than documents — they live in the toolbar next to
   * SchemeBrowser, where every other always-available tool already sits. */
  const ACTION_ICONS = {
    contrast: CS.Icons.svg('contrast', 20),
    eyedropper: CS.Icons.svg('pipette', 20),
    open: CS.Icons.svg('folder-open', 20),
    undo: CS.Icons.svg('undo-2', 20),
    redo: CS.Icons.svg('redo-2', 20)
  };

  const TOOL_LABELS = ['Matching Colors', 'GalleryBrowser', 'PhotoSchemer', 'SchemeBuilder', 'SchemeBrowser'];
  const TOOL_ACCEL = ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+5', 'Ctrl+6'];

  let toolButtons = [];
  let toolUndo = null;
  let toolRedo = null;
  let swatchNode = null;
  let hexField = null;
  let themeToggle = null;

  function buildToolbar() {
    const tools = qs('#toolbar-tools');
    const right = qs('#toolbar-right');

    toolButtons = TOOL_LABELS.map((label, i) => {
      const b = el('button.tool-btn', { type: 'button', title: `${label}  (${TOOL_ACCEL[i]})`, html: TOOL_ICONS[i] });
      on(b, 'click', () => openDocument(Object.keys(DOC_META)[i]));
      tools.appendChild(b);
      return b;
    });

    /* Utilities sit immediately after SchemeBrowser — see the grouping note
     * where they are appended below. */
    const contrastBtn = el('button.tool-btn', {
      type: 'button',
      title: 'Contrast Analyzer  (Ctrl+A)',
      html: ACTION_ICONS.contrast
    });
    on(contrastBtn, 'click', contrastAnalyzer);

    const eyedropperBtn = el('button.tool-btn', {
      type: 'button',
      title: 'Pick a colour from the screen  (F3)',
      html: ACTION_ICONS.eyedropper
    });
    on(eyedropperBtn, 'click', pickFromScreen);

    const openBtn = el('button.tool-btn', {
      type: 'button',
      title: 'Open palette or image…',
      html: ACTION_ICONS.open
    });
    on(openBtn, 'click', () => {
      W.menu(openBtn, [
        { label: 'Open Image…', action: () => { openDocument('photo'); } },
        { label: 'Import Palette…', action: importPalette },
        { label: 'Open Workspace…', action: openWorkspace }
      ]);
    });

    toolUndo = el('button.tool-btn', {
      type: 'button',
      title: 'Undo colour change  (Ctrl+Z)',
      html: ACTION_ICONS.undo
    });
    toolRedo = el('button.tool-btn', {
      type: 'button',
      title: 'Redo colour change  (Shift+Ctrl+Z)',
      html: ACTION_ICONS.redo
    });
    on(toolUndo, 'click', () => Store.goBack());
    on(toolRedo, 'click', () => Store.goForward());

    /* Three groups, each with a job:
     *   documents  — what you are working on
     *   inspect    — read a colour out of the world (contrast, eyedropper)
     *   act        — bring something in, or step through history
     * The separators carry that meaning; a lone trailing rule next to the
     * flexible gap just looked like a rendering artefact. */
    tools.appendChild(el('div.toolbar-sep'));
    tools.append(contrastBtn, eyedropperBtn);
    tools.appendChild(el('div.toolbar-sep'));
    tools.append(openBtn, toolUndo, toolRedo);

    /* current colour swatch + hex + dropdown */
    swatchNode = el('div.current-color-swatch');
    hexField = el('input.current-color-value', { type: 'text', spellcheck: 'false', maxlength: '7' });
    on(hexField, 'change', () => {
      const c = Color.parse(hexField.value);
      if (c) Store.setColor(c);
      else hexField.value = Store.hexUpper();
    });
    on(hexField, 'keydown', (e) => {
      if (e.key === 'Enter') hexField.blur();
    });

    const arrow = el('button.current-color-arrow', {
      type: 'button',
      title: 'Colour options',
      html: CS.Icons.svg('chevron-down', 14)
    });
    on(arrow, 'click', () => openColorMenu(arrow));

    right.append(el('div.current-color', {}, [swatchNode, hexField, arrow]));

    /* theme switch */
    themeToggle = el('button.theme-toggle', { type: 'button' });
    function paintThemeToggle() {
      const dark = CS.Theme && CS.Theme.current === 'dark';
      CS.Icons.set(themeToggle, dark ? 'moon' : 'sun', 15);
      themeToggle.appendChild(
        el('span.tt-label', { text: dark ? 'Dark' : 'Light' })
      );
      themeToggle.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
    }
    on(themeToggle, 'click', () => {
      if (!CS.Theme) return;
      const next = CS.Theme.toggle();
      paintThemeToggle();
      setStatus(`${next === 'dark' ? 'Dark' : 'Light'} theme enabled.`);
    });
    right.append(themeToggle);
    paintThemeToggle();
    if (CS.Theme) {
      CS.Theme.onChange(paintThemeToggle);
    }
  }

  function openColorMenu(anchor) {
    W.menu(anchor, [
      { label: 'Copy Hex Value', accel: 'Ctrl+C', action: () => { window.cs.clipboard.writeText(Store.hexUpper()); setStatus(`Copied ${Store.hexUpper()}.`); } },
      { label: 'Copy RGB', action: () => copyText(Color.toCssRgb(Store.rgb())) },
      { label: 'Copy HSL', action: () => copyText(Color.toCssHsl(Store.rgb())) },
      {
        label: 'Copy',
        submenu: [
          { label: 'Hex', action: () => copyText(Store.hexUpper()) },
          { label: 'RGB triplet', action: () => copyText(`${Store.rgb().r}, ${Store.rgb().g}, ${Store.rgb().b}`) },
          { label: 'CSS variable', action: () => copyText(`--color: ${Store.hexUpper()};`) },
          { label: 'Full scheme', action: () => copyText(Color.harmonyRgb(Store.hsv(), Store.get('scheme', 'complementary')).map((c) => Color.toHexUpper(c)).join(', ')) }
        ]
      },
      { separator: true },
      { label: 'Add to Favourites', accel: 'Ctrl+D', action: () => { Store.addFavorite(Store.hex()); setStatus(`Added ${Store.hexUpper()} to Favourites.`); } },
      { label: 'Make Web Safe', action: () => Store.setColor(Color.toWebsafe(Store.rgb())) },
      { label: 'Randomize', action: () => Store.setColor(Color.randomRgb()) },
      { separator: true },
      { label: 'Pick Colour from Screen…', accel: 'F3', action: pickFromScreen },
      {
        label: 'Edit in Spectrum',
        action: () => {
          openDocument('matching');
          if (documents.baseColor && documents.baseColor.showTab) documents.baseColor.showTab('spectrum');
        }
      }
    ], { alignRight: true });
  }

  function copyText(t) {
    window.cs.clipboard.writeText(t);
    setStatus(`Copied: ${String(t).slice(0, 60)}${String(t).length > 60 ? '…' : ''}`);
  }

  function updateToolbarState() {
    toolButtons.forEach((b, i) => b.classList.toggle('is-active', Object.keys(DOC_META)[i] === activeDoc));
    if (toolUndo) toolUndo.disabled = !Store.canGoBack();
    if (toolRedo) toolRedo.disabled = !Store.canGoForward();
    if (swatchNode) swatchNode.style.background = Store.hex();
    if (hexField && document.activeElement !== hexField) hexField.value = Store.hexUpper();
  }

  /* ================================================================== *
   * Menu bar
   * ================================================================== */

  const MENUS = [
    {
      label: 'File',
      items: () => [
        { label: 'New', accel: 'Ctrl+N', action: newWorkspace },
        { label: 'Open…', accel: 'Ctrl+O', action: () => openWorkspace() },
        {
          label: 'Open Recent',
          submenu: recentList().length
            ? recentList().map((r) => ({ label: r.name, action: () => openRecent(r) }))
            : [{ label: '(nothing yet)', disabled: true }]
        },
        { separator: true },
        { label: 'Save', accel: 'Ctrl+S', action: () => saveWorkspace(false) },
        { label: 'Save As…', accel: 'Shift+Ctrl+S', action: () => saveWorkspace(true) },
        { separator: true },
        { label: 'Import Wizard…', action: importPalette },
        { label: 'Export Wizard…', action: () => exportPalette() },
        { separator: true },
        { label: 'Print…', accel: 'Ctrl+P', action: quickPreview },
        { separator: true },
        { label: 'Exit', action: () => window.cs.win.close() }
      ]
    },
    {
      label: 'Edit',
      items: () => [
        { label: 'Undo', accel: 'Ctrl+Z', disabled: !Store.canGoBack(), action: () => Store.goBack() },
        { label: 'Redo', accel: 'Shift+Ctrl+Z', disabled: !Store.canGoForward(), action: () => Store.goForward() },
        { separator: true },
        {
          label: 'Copy',
          submenu: [
            { label: 'Hex Value', action: () => copyText(Store.hexUpper()) },
            { label: 'RGB', action: () => copyText(Color.toCssRgb(Store.rgb())) },
            { label: 'HSL', action: () => copyText(Color.toCssHsl(Store.rgb())) },
            { label: 'CMYK', action: () => { const c = Color.rgbToCmyk(Store.rgb()); copyText(`cmyk(${Math.round(c.c * 100)}%, ${Math.round(c.m * 100)}%, ${Math.round(c.y * 100)}%, ${Math.round(c.k * 100)}%)`); } },
            { label: 'Lab', action: () => { const l = Color.rgbToLab(Store.rgb()); copyText(`lab(${l.L.toFixed(2)}, ${l.a.toFixed(2)}, ${l.b.toFixed(2)})`); } },
            { separator: true },
            { label: 'Whole Scheme', action: () => copyText(Color.harmonyRgb(Store.hsv(), Store.get('scheme', 'complementary')).map((c) => Color.toHexUpper(c)).join(', ')) },
            { label: 'Favourite Colours', action: () => copyText(Store.state.favorites.map((h) => h.toUpperCase()).join(', ')) }
          ]
        },
        { separator: true },
        { label: 'Color Settings…', action: colorSettings },
        { label: 'Preferences…', action: preferences }
      ]
    },
    {
      label: 'Adjust',
      items: () => [
        {
          label: 'Color Space',
          submenu: COLOR_SPACES.map((s) => ({
            label: s.label,
            checked: Store.get('prefs.colorSpace', 'srgb') === s.id,
            action: () => {
              Store.set('prefs.colorSpace', s.id);
              setStatus(`Working space: ${s.label}`);
              refreshStatus();
            }
          }))
        },
        {
          label: 'Primary Colors',
          submenu: [
            { label: 'Red / Green / Blue', checked: true, action: () => {} },
            { label: 'Cyan / Magenta / Yellow', action: () => setStatus('CMYK primaries shown in the Base Color panel.') },
            { label: 'Hue / Saturation / Value', action: () => setStatus('HSV primaries shown in the Base Color panel.') }
          ]
        },
        {
          label: 'Color Blindness Simulation',
          submenu: Color.CVD_TYPES.map((t) => ({
            label: t.label,
            checked: Store.get('cvd', 'none') === t.id,
            action: () => {
              Store.set('cvd', t.id);
              applyCvd();
              setStatus(`Colour blindness simulation: ${t.label}`);
            }
          }))
        },
        {
          label: 'Websafe Mode',
          submenu: [
            { label: 'Off', checked: !Store.get('websafeMode', false), action: () => { Store.set('websafeMode', false); refreshStatus(); setStatus('Websafe mode off.'); } },
            { label: 'Warn When Not Web Safe', checked: Store.get('websafeMode', false), action: () => { Store.set('websafeMode', true); refreshStatus(); setStatus('Websafe mode on.'); } },
            { separator: true },
            { label: 'Snap To Web Safe Now', action: () => Store.setColor(Color.toWebsafe(Store.rgb())) }
          ]
        },
        { separator: true },
        { label: 'Randomize!', accel: 'Ctrl+R', action: () => Store.setColor(Color.randomRgb()) },
        { label: 'Make Websafe', action: () => Store.setColor(Color.toWebsafe(Store.rgb())) }
      ]
    },
    {
      label: 'Tools',
      items: () => [
        { label: 'Screen Color Picker', accel: 'F3', action: pickFromScreen },
        { separator: true },
        { label: 'Matching Colors', accel: 'Ctrl+1', checked: activeDoc === 'matching', action: () => openDocument('matching') },
        { label: 'GalleryBrowser', accel: 'Ctrl+2', checked: activeDoc === 'gallery', action: () => openDocument('gallery') },
        { label: 'PhotoSchemer', accel: 'Ctrl+3', checked: activeDoc === 'photo', action: () => openDocument('photo') },
        { separator: true },
        { label: 'Color Wheel', accel: 'Ctrl+4', checked: activeDoc === 'matching' && Store.get('matchingTab') === 'wheel', action: () => { openDocument('matching'); documents.matching.showTab('wheel'); } },
        { label: 'SchemeBuilder', accel: 'Ctrl+5', checked: activeDoc === 'builder', action: () => openDocument('builder') },
        { label: 'SchemeBrowser', accel: 'Ctrl+6', checked: activeDoc === 'browser', action: () => openDocument('browser') },
        { label: 'Color Mixer', accel: 'Ctrl+7', checked: activeDoc === 'matching' && Store.get('matchingTab') === 'mixer', action: () => { openDocument('matching'); documents.matching.showTab('mixer'); } },
        { label: 'Variations', accel: 'Ctrl+8', checked: activeDoc === 'matching' && Store.get('matchingTab') === 'variations', action: () => { openDocument('matching'); documents.matching.showTab('variations'); } },
        { separator: true },
        { label: 'Contrast Analyzer', accel: 'Ctrl+A', action: contrastAnalyzer },
        { label: 'QuickPreview', accel: 'Ctrl+P', action: quickPreview },
        { separator: true },
        { label: 'Show Color Palette', checked: Store.get('showPalette', true) !== false, action: () => togglePalette() },
        { label: 'Show Base Color Panel', checked: Store.get('showBaseColor', true) !== false, action: () => togglePanel('baseColor') },
        { label: 'Show Favorite Colors Panel', checked: Store.get('showFavorites', true) !== false, action: () => togglePanel('favorites') },
        { separator: true },
        {
          label: 'Appearance',
          submenu: [
            { label: 'Light Theme', checked: Store.get('theme', 'light') === 'light', action: () => { CS.Theme.set('light'); setStatus('Light theme enabled.'); } },
            { label: 'Dark Theme', checked: Store.get('theme', 'light') === 'dark', action: () => { CS.Theme.set('dark'); setStatus('Dark theme enabled.'); } },
            { separator: true },
            { label: 'Toggle Theme', accel: 'Ctrl+Shift+T', action: () => { const t = CS.Theme.toggle(); setStatus(`${t === 'dark' ? 'Dark' : 'Light'} theme enabled.`); } }
          ]
        }
      ]
    },
    {
      label: 'Help',
      items: () => [
        { label: 'Saffron Scheme Help', accel: 'F1', action: helpDialog },
        { separator: true },
        { label: 'Website', action: () => window.cs.shell.openExternal('https://www.colorschemer.com/') },
        { label: 'Gallery', action: () => openDocument('gallery') },
        { label: 'Forums', action: () => openDocument('browser') },
        { separator: true },
        { label: 'Check for Updates…', action: () => setStatus('You are running the latest version (1.0.0).') },
        { separator: true },
        { label: 'About Saffron Scheme…', action: aboutDialog }
      ]
    }
  ];

  let menuButtons = [];

  function buildMenubar() {
    const bar = qs('#menubar');
    clear(bar);

    menuButtons = MENUS.map((m) => {
      const btn = el('button.menubar-item', { type: 'button', text: m.label });
      on(btn, 'click', (e) => {
        e.stopPropagation();
        menuButtons.forEach((b) => b.classList.remove('is-open'));
        btn.classList.add('is-open');
        W.menu(btn, m.items(), {});
        const closeWatch = setInterval(() => {
          if (!qs('.menu-popup')) {
            clearInterval(closeWatch);
            btn.classList.remove('is-open');
          }
        }, 120);
      });
      // Alt-less quick access: hovering with a menu open switches menus
      on(btn, 'pointerenter', () => {
        if (qs('.menu-popup')) btn.click();
      });
      bar.appendChild(btn);
      return btn;
    });
  }

  function refreshMenus() {
    // menus rebuild their items lazily on open, nothing to do here
  }

  /* ================================================================== *
   * Colour vision deficiency filter
   * ================================================================== */

  function buildCvdFilters() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';

    Object.keys(Color.CVD_MATRICES).forEach((key) => {
      const m = Color.CVD_MATRICES[key];
      const filter = document.createElementNS(NS, 'filter');
      filter.setAttribute('id', `cvd-${key}`);
      filter.setAttribute('color-interpolation-filters', 'linearRGB');

      const fe = document.createElementNS(NS, 'feColorMatrix');
      fe.setAttribute('type', 'matrix');
      fe.setAttribute(
        'values',
        [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0].join(' ')
      );
      filter.appendChild(fe);
      svg.appendChild(filter);
    });

    ['achromatopsia', 'grayscale'].forEach((key) => {
      const filter = document.createElementNS(NS, 'filter');
      filter.setAttribute('id', `cvd-${key}`);
      filter.setAttribute('color-interpolation-filters', 'linearRGB');
      const fe = document.createElementNS(NS, 'feColorMatrix');
      fe.setAttribute('type', 'saturate');
      fe.setAttribute('values', '0');
      filter.appendChild(fe);
      svg.appendChild(filter);
    });

    document.body.appendChild(svg);
  }

  function applyCvd() {
    const type = Store.get('cvd', 'none');
    const target = qs('#workspace');
    if (!target) return;
    target.style.filter = type && type !== 'none' ? `url(#cvd-${type})` : '';
  }

  /* ================================================================== *
   * Colour picker (eyedropper)
   * ================================================================== */

  let picking = false;

  async function pickFromScreen() {
    if (picking) return;
    if (!window.cs || !window.cs.picker) {
      setStatus('The screen colour picker is unavailable.');
      return;
    }
    picking = true;
    setStatus('Screen Color Picker: click anywhere to sample a colour. Press Esc to cancel.', 0);

    try {
      const hex = await window.cs.picker.start();
      if (hex) {
        Store.setColor(hex);
        const rgb = Store.rgb();
        setStatus(`Picked ${String(hex).toUpperCase()}  ·  R ${rgb.r}  G ${rgb.g}  B ${rgb.b}`);
        if (Store.get('prefs.autoCopyHex', true)) window.cs.clipboard.writeText(String(hex).toUpperCase());
      } else {
        setStatus('Screen colour picker cancelled.');
      }
    } catch (err) {
      setStatus('Could not capture the screen.');
      console.error(err);
    } finally {
      picking = false;
    }
  }

  /* ================================================================== *
   * Dialogs
   * ================================================================== */

  function aboutDialog() {
    const content = el('div.about');
    content.append(
      el('div.about-head', {}, [
        (() => {
          const img = el('img.about-icon', { src: 'assets/icon.png', alt: '' });
          return img;
        })(),
        el('div', {}, [
          el('div.about-title', { text: 'Saffron Scheme' }),
          el('div.about-version', { text: 'Version 1.0.0' }),
          el('div.about-sub', { text: 'Colour management for designers and developers.' })
        ])
      ]),
      el('div.about-body', {}, [
        el('p', { text: 'Build colour harmonies, mix and vary palettes, pull colours out of photographs, and sample any pixel on screen with the eyedropper.' }),
        el('div.about-grid', {}, [
          el('span', { text: 'Electron' }),
          el('span', { text: window.cs.version }),
          el('span', { text: 'Chromium' }),
          el('span', { text: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '—' }),
          el('span', { text: 'Platform' }),
          el('span', { text: window.cs.platform })
        ])
      ])
    );

    W.dialog({
      title: 'About Saffron Scheme',
      width: 430,
      content,
      buttons: [{ label: 'OK', value: 'ok', primary: true }]
    });
  }

  function helpDialog() {
    const content = el('div.help-body');
    const sections = [
      ['Screen Color Picker — F3', 'Freezes the desktop, then click any pixel to sample it. The magnifier shows the exact colour. Esc cancels.'],
      ['Contrast Analyzer — Ctrl+A', 'Checks a text/background pair against the WCAG AA and AAA thresholds.'],
      ['Matching Colors — Ctrl+1', 'Colour Wheel, LiveSchemes, Mixer and Variations. Click the arrows inside the wheel to cycle harmony types.'],
      ['Base Color panel', 'RGB sliders, a 2D spectrum picker and the named-colour library. The increment buttons set the arrow-key step.'],
      ['PhotoSchemer — Ctrl+3', 'Open an image or drop one onto the panel, then drag the sample markers. The Effect menu posterises, pixelates, blurs, desaturates, inverts and more — sampling always reads the untouched pixels.'],
      ['Favourite Colors', 'Drag colours in from anywhere, drag to reorder, right-click a chip for more options.'],
      ['Keyboard', 'Ctrl+1…8 switch tools · Ctrl+Z / Shift+Ctrl+Z step through colour history · Ctrl+D saves the current colour · Ctrl+C copies its hex value.']
    ];
    sections.forEach(([title, body]) => {
      content.append(el('div.help-section', {}, [el('div.help-title', { text: title }), el('div.help-text', { text: body })]));
    });

    W.dialog({
      title: 'Saffron Scheme Help',
      width: 520,
      content,
      buttons: [{ label: 'Close', value: null, primary: true }]
    });
  }

  const COLOR_SPACES = [
    { id: 'srgb', label: 'sRGB IEC61966-2.1' },
    { id: 'p3', label: 'Display P3' },
    { id: 'adobe', label: 'Adobe RGB (1998)' },
    { id: 'prophoto', label: 'ProPhoto RGB' },
    { id: 'xyz', label: 'CIE XYZ' },
    { id: 'lab', label: 'CIE Lab' }
  ];

  const RENDER_INTENTS = [
    { id: 'perceptual', label: 'Perceptual' },
    { id: 'relative', label: 'Relative Colorimetric' },
    { id: 'saturation', label: 'Saturation' },
    { id: 'absolute', label: 'Absolute Colorimetric' }
  ];

  function colorSettings() {
    const prefs = Store.get('prefs', {});
    const content = el('div.form-grid');

    const spaceSel = W.select({
      options: COLOR_SPACES,
      value: prefs.colorSpace || 'srgb',
      width: 200
    });
    const intentSel = W.select({
      options: RENDER_INTENTS,
      value: prefs.renderIntent || 'relative',
      width: 200
    });
    const bpc = el('input', { type: 'checkbox' });
    bpc.checked = prefs.blackPointCompensation !== false;
    const gamma = W.stepper({ value: prefs.gamma || 2.2, min: 1, max: 3, compact: true });
    gamma._stepper.set(prefs.gamma || 2.2);
    gamma.style.display = 'flex';

    content.append(
      el('label', { text: 'Working space:' }),
      spaceSel,
      el('label', { text: 'Rendering intent:' }),
      intentSel,
      el('label', { text: 'Gamma:' }),
      gamma,
      el('span.span', {}, [
        el('label.checkbox-row', {}, [bpc, el('span', { text: 'Use black point compensation' })])
      ]),
      el('div.form-hint.span', {
        text: 'These settings record the working space for exported palettes. Colour maths in the app is performed in sRGB with CIELAB interpolation.'
      })
    );

    W.dialog({
      title: 'Color Settings',
      width: 420,
      content,
      buttons: [
        { label: 'Cancel', value: null },
        { label: 'OK', value: 'ok', primary: true }
      ],
      onClose: (v) => {
        if (v !== 'ok') return;
        Store.set('prefs.colorSpace', spaceSel.value);
        Store.set('prefs.renderIntent', intentSel.value);
        Store.set('prefs.blackPointCompensation', bpc.checked);
        Store.set('prefs.gamma', gamma._stepper.value);
        setStatus(`Working space set to ${COLOR_SPACES.find((s) => s.id === spaceSel.value).label}.`);
      }
    });
  }

  function preferences() {
    const prefs = Store.get('prefs', {});
    const content = el('div.form-grid');

    const segs = W.select({
      options: [12, 18, 24, 36, 48].map((n) => ({ id: String(n), label: `${n} segments` })),
      value: String(prefs.colorWheelSegments || 24),
      width: 150
    });
    const baseTab = W.select({
      options: [
        { id: 'rgb', label: 'RGB' },
        { id: 'spectrum', label: 'Spectrum' },
        { id: 'library', label: 'Library' }
      ],
      value: prefs.defaultBaseTab || 'rgb',
      width: 150
    });
    const matchTab = W.select({
      options: [
        { id: 'wheel', label: 'Color Wheel' },
        { id: 'live', label: 'LiveSchemes' },
        { id: 'mixer', label: 'Mixer' },
        { id: 'variations', label: 'Variations' }
      ],
      value: prefs.defaultMatchingTab || 'wheel',
      width: 150
    });

    const autoCopy = el('input', { type: 'checkbox' });
    autoCopy.checked = prefs.autoCopyHex !== false;
    const confirmClear = el('input', { type: 'checkbox' });
    confirmClear.checked = prefs.confirmOnClear !== false;

    content.append(
      el('label', { text: 'Colour wheel:' }),
      segs,
      el('label', { text: 'Default Base Color tab:' }),
      baseTab,
      el('label', { text: 'Default Matching tab:' }),
      matchTab,
      el('span.span', {}, [el('label.checkbox-row', {}, [autoCopy, el('span', { text: 'Copy hex to the clipboard after picking a screen colour' })])]),
      el('span.span', {}, [el('label.checkbox-row', {}, [confirmClear, el('span', { text: 'Ask before clearing favourites' })])]),
      el('span.span', {}, [
        (() => {
          const b = el('button.btn.btn-mini', { type: 'button', text: 'Reset All Preferences & Data' });
          on(b, 'click', () => {
            W.dialog({
              title: 'Reset Everything',
              width: 340,
              content: el('div', { text: 'Reset the base colour, favourites, history and all preferences back to their defaults?' }),
              buttons: [
                { label: 'Cancel', value: null },
                { label: 'Reset', value: 'ok', primary: true }
              ],
              onClose: (v) => {
                if (v === 'ok') {
                  Store.reset();
                  location.reload();
                }
              }
            });
          });
          return b;
        })()
      ])
    );

    W.dialog({
      title: 'Preferences',
      width: 440,
      content,
      buttons: [
        { label: 'Cancel', value: null },
        { label: 'OK', value: 'ok', primary: true }
      ],
      onClose: (v) => {
        if (v !== 'ok') return;
        Store.set('prefs.colorWheelSegments', Number(segs.value));
        Store.set('prefs.defaultBaseTab', baseTab.value);
        Store.set('prefs.defaultMatchingTab', matchTab.value);
        Store.set('prefs.autoCopyHex', autoCopy.checked);
        Store.set('prefs.confirmOnClear', confirmClear.checked);
        Store.set('baseTab', baseTab.value);
        Store.set('matchingTab', matchTab.value);
        CS.App.refreshAll();
        setStatus('Preferences saved.');
      }
    });
  }

  function contrastAnalyzer() {
    let fg = Color.parse('#1b1b1b');
    let bg = Color.parse('#ffffff');

    const ratioOut = el('div.ca-ratio-value', { text: '—' });
    const badgeRow = el('div.ca-badges');
    const preview = el('div.ca-preview');
    const previewText = el('div.ca-preview-text', { text: 'The quick brown fox jumps over the lazy dog' });
    const previewSmall = el('div.ca-preview-small', { text: 'Large text sample — 18pt and above' });
    const previewUi = el('div.ca-preview-ui');

    const fgField = el('input', { type: 'text', value: Color.toHexUpper(fg), spellcheck: 'false' });
    const bgField = el('input', { type: 'text', value: Color.toHexUpper(bg), spellcheck: 'false' });
    const fgSwatch = el('span.ca-swatch');
    const bgSwatch = el('span.ca-swatch');

    function update() {
      const ratio = Color.contrastRatio(fg, bg);
      ratioOut.textContent = `${ratio.toFixed(2)} : 1`;

      preview.style.background = Color.toHex(bg);
      preview.style.color = Color.toHex(fg);
      fgSwatch.style.background = Color.toHex(fg);
      bgSwatch.style.background = Color.toHex(bg);
      previewUi.style.background = Color.toHex(bg);
      previewUi.style.borderColor = Color.toHex(fg);

      const checks = [
        { label: 'AA normal (4.5)', pass: ratio >= 4.5 },
        { label: 'AA large (3.0)', pass: ratio >= 3 },
        { label: 'AAA normal (7.0)', pass: ratio >= 7 },
        { label: 'AAA large (4.5)', pass: ratio >= 4.5 },
        { label: 'UI components (3.0)', pass: ratio >= 3 }
      ];
      clear(badgeRow);
      checks.forEach((c) => {
        const badge = el(`span.ca-badge${c.pass ? '.is-pass' : '.is-fail'}`, {
          html: CS.Icons.svg(c.pass ? 'check' : 'x', 12, { stroke: 2.5 })
        });
        badge.appendChild(el('span', { text: c.label }));
        badgeRow.appendChild(badge);
      });

      // rebuild the little UI mockup
      clear(previewUi);
      const btn = el('span.ca-ui-btn', { text: 'Button' });
      btn.style.background = Color.toHex(fg);
      btn.style.color = Color.toHex(bg);
      const btn2 = el('span.ca-ui-btn.ca-ui-ghost', { text: 'Secondary' });
      btn2.style.color = Color.toHex(fg);
      btn2.style.borderColor = Color.toHex(fg);
      previewUi.append(el('span.ca-ui-title', { text: 'Interface preview' }), btn, btn2);
    }

    on(fgField, 'change', () => {
      const c = Color.parse(fgField.value);
      if (c) {
        fg = c;
        fgField.value = Color.toHexUpper(c);
        update();
      }
    });
    on(bgField, 'change', () => {
      const c = Color.parse(bgField.value);
      if (c) {
        bg = c;
        bgField.value = Color.toHexUpper(c);
        update();
      }
    });

    preview.append(previewText, previewSmall, previewUi);

    const content = el('div.ca', {}, [
      el('div.ca-controls', {}, [
        el('div.ca-control', {}, [el('span.field-label', { text: 'Text colour' }), fgSwatch, fgField]),
        el('div.ca-control', {}, [el('span.field-label', { text: 'Background' }), bgSwatch, bgField]),
        (() => {
          const swap = el('button.btn.btn-mini', { type: 'button', text: '⇄ Swap' });
          on(swap, 'click', () => {
            const t = fg;
            fg = bg;
            bg = t;
            fgField.value = Color.toHexUpper(fg);
            bgField.value = Color.toHexUpper(bg);
            update();
          });
          return swap;
        })(),
        (() => {
          const use = el('button.btn.btn-mini', { type: 'button', text: 'Use Base Colour' });
          on(use, 'click', () => {
            bg = Store.rgb();
            bgField.value = Color.toHexUpper(bg);
            update();
          });
          return use;
        })()
      ]),
      el('div.ca-ratio', {}, [el('span.ca-ratio-label', { text: 'Contrast ratio' }), ratioOut]),
      badgeRow,
      preview
    ]);

    update();

    W.dialog({
      title: 'Contrast Analyzer',
      width: 560,
      content,
      buttons: [{ label: 'Close', value: null, primary: true }]
    });
  }

  function quickPreview() {
    const schemeId = Store.get('scheme', 'complementary');
    const colors = Color.harmonyRgb(Store.hsv(), schemeId);
    const base = Store.rgb();
    const text = Color.readableText(base);
    const deep = Color.mix(base, { r: 0, g: 0, b: 0 }, 0.45, 'lab');
    const soft = Color.mix(base, { r: 255, g: 255, b: 255 }, 0.82, 'lab');

    const mock = el('div.qp-mock');
    mock.style.background = Color.toHex(soft);
    mock.style.color = Color.toHex(deep);

    const header = el('div.qp-header', { text: 'Saffron Scheme' });
    header.style.background = Color.toHex(base);
    header.style.color = Color.toHex(text);

    const body = el('div.qp-body', {}, [
      el('div.qp-title', { text: 'Palette preview' }),
      el('div.qp-copy', {
        text: 'This mock interface uses the current scheme so you can judge how the colours behave together in a real layout.'
      })
    ]);

    const actions = el('div.qp-actions');
    const primary = el('span.qp-btn', { text: 'Primary action' });
    primary.style.background = Color.toHex(base);
    primary.style.color = Color.toHex(text);
    const secondary = el('span.qp-btn.qp-btn-ghost', { text: 'Secondary' });
    secondary.style.borderColor = Color.toHex(deep);
    secondary.style.color = Color.toHex(deep);
    actions.append(primary, secondary);

    const cards = el('div.qp-cards');
    colors.forEach((c, i) => {
      const card = el('div.qp-card');
      card.style.background = Color.toHex(c);
      card.style.color = Color.toHex(Color.readableText(c));
      card.append(el('div.qp-card-title', { text: `Colour ${i + 1}` }), el('div.qp-card-body', { text: Color.toHexUpper(c) }));
      cards.appendChild(card);
    });

    body.append(actions, cards);
    mock.append(header, body);

    const swatchRow = el('div.qp-swatches');
    colors.forEach((c) => {
      const hex = Color.toHex(c);
      swatchRow.appendChild(
        W.chip(hex, {
          size: 46,
          draggable: true,
          label: hex.toUpperCase().slice(1),
          onPick: () => Store.setColor(c)
        })
      );
    });

    const content = el('div.qp', {}, [
      swatchRow,
      mock,
      el('div.form-hint', {
        text: `Scheme: ${Color.SCHEMES.find((s) => s.id === schemeId)?.label || schemeId}  ·  Base ${Store.hexUpper()}  ·  Contrast against white ${Color.contrastRatio(base, {
          r: 255,
          g: 255,
          b: 255
        }).toFixed(2)}:1`
      })
    ]);

    W.dialog({
      title: 'QuickPreview',
      width: 620,
      content,
      buttons: [
        {
          label: 'Add to Favourites',
          value: 'fav'
        },
        { label: 'Copy CSS', value: 'css' },
        { label: 'Close', value: null, primary: true }
      ],
      onClose: (v) => {
        if (v === 'fav') {
          colors.forEach((c) => Store.addFavorite(c));
          setStatus('Scheme added to Favourites.');
        } else if (v === 'css') {
          copyText(
            colors.map((c, i) => `--color-${i + 1}: ${Color.toHexUpper(c)};`).join('\n')
          );
        }
      }
    });
  }

  /* ================================================================== *
   * Import / export
   * ================================================================== */

  const EXPORT_FORMATS = [
    { id: 'json', label: 'JSON (palette object)' },
    { id: 'css', label: 'CSS custom properties' },
    { id: 'scss', label: 'SCSS variables' },
    { id: 'tailwind', label: 'Tailwind config fragment' },
    { id: 'gpl', label: 'GIMP palette (.gpl)' },
    { id: 'ase', label: 'Adobe Swatch Exchange (.ase)' },
    { id: 'svg', label: 'SVG swatch sheet' },
    { id: 'txt', label: 'Plain hex list' },
    { id: 'csv', label: 'CSV with names' }
  ];

  function currentPalette(override) {
    if (override && override.length) return override.slice();
    const favs = Store.state.favorites;
    if (favs.length) return favs.map((h) => Color.parse(h));
    return Color.harmonyRgb(Store.hsv(), Store.get('scheme', 'complementary'));
  }

  function exportPalette(override) {
    const palette = currentPalette(override);
    const sel = W.select({ options: EXPORT_FORMATS, value: 'json', width: 230 });
    const area = el('textarea');
    area.rows = 13;
    area.style.width = '100%';
    area.style.marginTop = '8px';

    function build() {
      area.value = formatPalette(sel.value, palette);
    }

    on(sel, 'change', build);
    build();

    const content = el('div', {}, [
      el('div.row', {}, [el('span.field-label', { text: 'Format:' }), sel]),
      area,
      el('div.form-hint', {
        text: `${palette.length} colour${palette.length === 1 ? '' : 's'}. Exports the current favourite colours, or the current harmony when favourites are empty.`
      })
    ]);

    W.dialog({
      title: 'Export Wizard',
      width: 520,
      content,
      buttons: [
        { label: 'Close', value: null },
        { label: 'Copy', value: 'copy' },
        { label: 'Save…', value: 'save', primary: true }
      ],
      onClose: (v) => {
        if (v === 'copy') {
          copyText(area.value);
        } else if (v === 'save') {
          const fmt = EXPORT_FORMATS.find((f) => f.id === sel.value);
          const ext = { json: 'json', css: 'css', scss: 'scss', tailwind: 'js', gpl: 'gpl', ase: 'ase', svg: 'svg', txt: 'txt', csv: 'csv' }[sel.value];
          if (sel.value === 'ase') {
            const b64 = buildAse(palette);
            window.cs.file
              .save({
                title: 'Export Adobe Swatch Exchange',
                defaultName: 'zaferon-palette.ase',
                filters: [{ name: 'Adobe Swatch Exchange', extensions: ['ase'] }],
                content: b64,
                encoding: 'base64'
              })
              .then((p) => p && setStatus(`Exported ${palette.length} colours to ${p}`));
          } else {
            window.cs.file
              .save({
                title: 'Export Palette',
                defaultName: `zaferon-palette.${ext}`,
                filters: [{ name: fmt.label, extensions: [ext] }],
                content: area.value
              })
              .then((p) => p && setStatus(`Exported ${palette.length} colours to ${p}`));
          }
        }
      }
    });
  }

  function formatPalette(format, palette) {
    const hexes = palette.map((c) => Color.toHexUpper(c));
    switch (format) {
      case 'css':
        return [':root {'].concat(hexes.map((h, i) => `  --color-${i + 1}: ${h};`)).concat(['}']).join('\n');
      case 'scss':
        return hexes.map((h, i) => `$color-${i + 1}: ${h};`).join('\n');
      case 'tailwind':
        return `module.exports = {\n  theme: {\n    extend: {\n      colors: {\n${hexes
          .map((h, i) => `        'palette-${i + 1}': '${h}',`)
          .join('\n')}\n      }\n    }\n  }\n};`;
      case 'gpl': {
        const lines = ['GIMP Palette', 'Name: Saffron Scheme', 'Columns: 8', '#'];
        palette.forEach((c, i) => {
          const name = `Color ${i + 1}`;
          lines.push(`${String(c.r).padStart(3, ' ')} ${String(c.g).padStart(3, ' ')} ${String(c.b).padStart(3, ' ')}\t${name}`);
        });
        return lines.join('\n');
      }
      case 'svg': {
        const size = 64;
        const swatches = palette
          .map((c, i) => `  <rect x="${i * (size + 8) + 8}" y="8" width="${size}" height="${size}" fill="${Color.toHexUpper(c)}" />`)
          .join('\n');
        const width = palette.length * (size + 8) + 8;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size + 16}">\n${swatches}\n</svg>`;
      }
      case 'txt':
        return hexes.join('\n');
      case 'csv': {
        const rows = [['name', 'hex', 'r', 'g', 'b'].join(',')];
        palette.forEach((c, i) => rows.push([`Color ${i + 1}`, Color.toHexUpper(c), c.r, c.g, c.b].join(',')));
        return rows.join('\n');
      }
      case 'ase':
        return 'Adobe Swatch Exchange is a binary format — use “Save…” to write a .ase file.';
      case 'json':
      default:
        return JSON.stringify(
          {
            name: 'Saffron Scheme Palette',
            created: new Date().toISOString(),
            colors: palette.map((c, i) => ({
              name: `Color ${i + 1}`,
              hex: Color.toHexUpper(c),
              rgb: [c.r, c.g, c.b],
              hsl: (() => {
                const h = Color.rgbToHsl(c);
                return [Math.round(h.h), Math.round(h.s * 100), Math.round(h.l * 100)];
              })()
            }))
          },
          null,
          2
        );
    }
  }

  /** Build an Adobe Swatch Exchange file and return it as base64. */
  function buildAse(palette) {
    const bytes = [];
    const push = (n) => bytes.push(n & 0xff);
    const push16 = (n) => {
      push((n >> 8) & 0xff);
      push(n);
    };
    const push32 = (n) => {
      push((n >>> 24) & 0xff);
      push((n >> 16) & 0xff);
      push((n >> 8) & 0xff);
      push(n);
    };
    const pushStr = (s) => {
      for (let i = 0; i < s.length; i++) {
        push(s.charCodeAt(i) >> 8);
        push(s.charCodeAt(i) & 0xff);
      }
    };
    const pushFloat = (f) => {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(0, f, false);
      new Uint8Array(buf).forEach((b) => push(b));
    };

    pushStr('ASEF');
    push16(1);
    push16(0);
    push32(palette.length);

    palette.forEach((c, i) => {
      const name = `Color ${i + 1}`;
      const nameLen = name.length + 1;
      const blockLen = 2 + nameLen * 2 + 4 + 12 + 2;

      push16(0x0001);
      push32(blockLen);
      push16(nameLen);
      pushStr(name);
      push(0);
      push(0);
      pushStr('RGB ');
      pushFloat(c.r / 255);
      pushFloat(c.g / 255);
      pushFloat(c.b / 255);
      push16(0);
    });

    let binary = '';
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary);
  }

  function importPalette() {
    const area = el('textarea', { placeholder: '#4F86C6, #D96A4A, 2F8FD0\nor paste any text containing hex colours' });
    area.rows = 10;
    area.style.width = '100%';
    area.style.marginTop = '8px';

    const found = el('div.form-hint', { text: 'No colours detected yet.' });

    function scan() {
      const hexes = String(area.value).match(/#?\b[0-9a-fA-F]{6}\b|#\b[0-9a-fA-F]{3}\b/g) || [];
      const seen = new Set();
      const unique = [];
      hexes.forEach((h) => {
        const c = Color.parse(h);
        if (!c) return;
        const key = Color.toHex(c);
        if (seen.has(key)) return;
        seen.add(key);
        unique.push(key);
      });
      found.textContent = unique.length ? `${unique.length} colour${unique.length === 1 ? '' : 's'} detected.` : 'No colours detected yet.';
      return unique;
    }

    on(area, 'input', scan);

    const openBtn = el('button.btn.btn-mini', { type: 'button', text: 'Open File…' });
    on(openBtn, 'click', () => {
      window.cs.file
        .openText({
          title: 'Import Palette',
          filters: [
            { name: 'Palette Files', extensions: ['json', 'css', 'scss', 'txt', 'gpl', 'csv'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })
        .then((res) => {
          if (!res) return;
          area.value = res.text;
          scan();
        });
    });

    const content = el('div', {}, [
      el('div.form-hint', {
        text: 'Paste hex colours (with or without “#”) or load a JSON / CSS / GPL palette file. Every colour found is added to your favourites.'
      }),
      area,
      el('div.row', { style: { marginTop: '6px' } }, [openBtn, found])
    ]);

    W.dialog({
      title: 'Import Wizard',
      width: 520,
      content,
      buttons: [
        { label: 'Cancel', value: null },
        { label: 'Replace Favourites', value: 'replace' },
        { label: 'Add to Favourites', value: 'add', primary: true }
      ],
      onClose: (v) => {
        if (v !== 'add' && v !== 'replace') return;
        const colors = scan();
        if (!colors.length) {
          setStatus('No colours found to import.');
          return;
        }
        if (v === 'replace') Store.setFavorites(colors);
        else colors.forEach((c) => Store.addFavorite(c));
        setStatus(`Imported ${colors.length} colour${colors.length === 1 ? '' : 's'}.`);
      }
    });
  }

  /* --- workspace save / open ---------------------------------------- */

  const RECENT_KEY = 'zaferon-scheme/recent/v1';
  /* Pre-rename key — read once so an existing recent-files list survives. */
  const RECENT_KEY_LEGACY = 'colorschemer-studio/recent/v1';

  function recentList() {
    try {
      const raw =
        localStorage.getItem(RECENT_KEY) ||
        localStorage.getItem(RECENT_KEY_LEGACY) ||
        '[]';
      return JSON.parse(raw);
    } catch (_) {
      return [];
    }
  }

  function pushRecent(entry) {
    const list = recentList().filter((r) => r.path !== entry.path);
    list.unshift(entry);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  }

  function workspacePayload() {
    return JSON.stringify(
      {
        app: 'Saffron Scheme',
        version: 1,
        saved: new Date().toISOString(),
        baseColor: Store.hexUpper(),
        scheme: Store.get('scheme', 'complementary'),
        websafeMode: Store.get('websafeMode', false),
        favorites: Store.state.favorites.map((h) => h.toUpperCase()),
        harmony: Color.harmonyRgb(Store.hsv(), Store.get('scheme', 'complementary')).map((c) => Color.toHexUpper(c)),
        prefs: Store.get('prefs', {})
      },
      null,
      2
    );
  }

  let lastSavePath = null;

  function saveWorkspace(forceDialog) {
    const opts = {
      title: forceDialog || !lastSavePath ? 'Save Workspace As' : 'Save Workspace',
      defaultName: lastSavePath || `zaferon-${Store.hex().slice(1)}.json`,
      filters: [{ name: 'Saffron Scheme Workspace', extensions: ['json'] }],
      content: workspacePayload()
    };
    window.cs.file.save(opts).then((p) => {
      if (!p) return;
      lastSavePath = p;
      pushRecent({ name: p.split(/[\\/]/).pop(), path: p });
      setStatus(`Saved workspace to ${p}`);
    });
  }

  function openWorkspace() {
    window.cs.file
      .openText({
        title: 'Open Workspace',
        filters: [
          { name: 'Saffron Scheme Workspace', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      .then((res) => {
        if (!res) return;
        try {
          applyWorkspace(JSON.parse(res.text));
          pushRecent({ name: res.name, path: res.path });
          setStatus(`Opened ${res.name}.`);
        } catch (_) {
          setStatus('That file is not a Saffron Scheme workspace.');
        }
      });
  }

  function openRecent(entry) {
    if (!entry || !entry.path) {
      openWorkspace();
      return;
    }
    window.cs.file.openPath(entry.path).then((res) => {
      if (!res) return;
      try {
        applyWorkspace(JSON.parse(res.text));
        pushRecent({ name: res.name, path: res.path });
        setStatus(`Opened ${res.name}.`);
      } catch (_) {
        setStatus('That file is not a Saffron Scheme workspace.');
      }
    });
  }

  function applyWorkspace(data) {
    if (!data || typeof data !== 'object') return;
    if (data.baseColor) Store.setColor(data.baseColor);
    if (data.scheme) Store.set('scheme', data.scheme);
    if (data.websafeMode != null) Store.set('websafeMode', !!data.websafeMode);
    if (Array.isArray(data.favorites)) Store.setFavorites(data.favorites);
    if (data.prefs) Store.set('prefs', Object.assign({}, Store.get('prefs', {}), data.prefs));
    refreshAll();
  }

  function newWorkspace() {
    Store.setColor(Color.randomRgb({ sMin: 0.45, vMin: 0.55 }));
    openDocument('matching');
    documents.matching && documents.matching.showTab('wheel');
    setStatus('New scheme started.');
  }

  /* ================================================================== *
   * Status bar right side
   * ================================================================== */

  function buildStatusBar() {
    /* Everything that used to crowd this strip now lives where it is used:
     * Open palette or image / Undo / Redo moved up into the toolbar next to
     * the eyedropper, and Add to Favourites / Clear Favourites moved into the
     * Favorite Colors panel itself. What is left is the status text, the
     * palette toggle that belongs beside it, and the websafe pill. */
    const right = qs('#status-right');
    right.appendChild(el('span.status-pill#status-pill', { text: 'Ready' }));

    const left = qs('#status-left');
    const leftWrap = el('div.status-left-wrap');
    left.parentNode.insertBefore(leftWrap, left);

    const paletteBtn = el('button.status-btn', {
      type: 'button',
      title: 'Toggle the Color Palette panel',
      html: PALETTE_ICON
    });
    on(paletteBtn, 'click', () => togglePalette());

    leftWrap.append(paletteBtn, left);
  }

  function updateStatusPill() {
    const pill = qs('#status-pill');
    if (!pill) return;
    const safe = Color.isWebsafe(Store.rgb());
    const warn = Store.get('websafeMode', false);
    /* Colour comes from the state class, not inline styles, so the pill keeps
     * working when the theme flips underneath it. */
    pill.classList.toggle('is-safe', safe);
    pill.classList.toggle('is-warn', !safe && warn);
    pill.innerHTML =
      CS.Icons.svg(safe ? 'check' : warn ? 'triangle-alert' : 'circle-slash', 12, { stroke: 2.25 }) +
      `<span>${safe ? 'Web Safe' : warn ? 'Not Web Safe' : 'Web Safe: no'}</span>`;
  }

  /* The status strip only needs one glyph now — the palette toggle. */
  const PALETTE_ICON = CS.Icons.svg('swatch-book', 14);

  /* ================================================================== *
   * Keyboard shortcuts
   * ================================================================== */

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function bindShortcuts() {
    on(document, 'keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === 'F1') {
        e.preventDefault();
        helpDialog();
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        pickFromScreen();
        return;
      }
      if (e.key === 'Escape') {
        W.closeMenu();
        return;
      }

      if (!mod) {
        if (!isTyping(e) && e.key === ' ') {
          e.preventDefault();
          Store.setColor(Color.randomRgb());
        }
        return;
      }

      const key = e.key.toLowerCase();

      if (key === 't' && e.shiftKey) {
        e.preventDefault();
        if (CS.Theme) {
          const t = CS.Theme.toggle();
          setStatus(`${t === 'dark' ? 'Dark' : 'Light'} theme enabled.`);
        }
        return;
      }

      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) Store.goForward();
        else Store.goBack();
        return;
      }
      if (key === 'c' && !isTyping(e)) {
        e.preventDefault();
        window.cs.clipboard.writeText(Store.hexUpper());
        setStatus(`Copied ${Store.hexUpper()}.`);
        return;
      }
      if (key === 'd') {
        e.preventDefault();
        Store.addFavorite(Store.hex());
        setStatus(`Added ${Store.hexUpper()} to Favourites.`);
        return;
      }
      if (key === 'r' && !isTyping(e)) {
        e.preventDefault();
        Store.setColor(Color.randomRgb());
        return;
      }
      if (key === 'n') {
        e.preventDefault();
        newWorkspace();
        return;
      }
      if (key === 'o') {
        e.preventDefault();
        openWorkspace();
        return;
      }
      if (key === 's') {
        e.preventDefault();
        saveWorkspace(e.shiftKey);
        return;
      }
      if (key === 'a' && !isTyping(e)) {
        e.preventDefault();
        contrastAnalyzer();
        return;
      }
      if (key === 'p') {
        e.preventDefault();
        quickPreview();
        return;
      }

      const digits = {
        '1': () => openDocument('matching'),
        '2': () => openDocument('gallery'),
        '3': () => openDocument('photo'),
        '4': () => {
          openDocument('matching');
          documents.matching.showTab('wheel');
        },
        '5': () => openDocument('builder'),
        '6': () => openDocument('browser'),
        '7': () => {
          openDocument('matching');
          documents.matching.showTab('mixer');
        },
        '8': () => {
          openDocument('matching');
          documents.matching.showTab('variations');
        }
      };
      if (digits[key]) {
        e.preventDefault();
        digits[key]();
      }
    });
  }

  /* ================================================================== *
   * Window controls
   * ================================================================== */

  function bindWindowControls() {
    /* Lucide window glyphs — the Segoe MDL2 private-use codepoints the markup
     * shipped with only render on Windows and never matched the rest of the UI. */
    CS.Icons.set(qs('#win-min .wc-glyph'), 'minus', 15);
    CS.Icons.set(qs('#win-close .wc-glyph'), 'x', 15);
    CS.Icons.set(qs('#win-max-glyph'), 'square', 13);

    on(qs('#win-min'), 'click', () => window.cs.win.minimize());
    on(qs('#win-max'), 'click', () => window.cs.win.toggleMaximize());
    on(qs('#win-close'), 'click', () => window.cs.win.close());

    on(qs('#titlebar'), 'dblclick', (e) => {
      if (e.target.closest('.titlebar-controls')) return;
      window.cs.win.toggleMaximize();
    });

    window.cs.win.onState((s) => {
      CS.Icons.set(qs('#win-max-glyph'), s.maximized ? 'minimize-2' : 'square', 13);
    });
  }

  /* ================================================================== *
   * Refresh plumbing
   * ================================================================== */

  function refreshAll() {
    Object.keys(documents).forEach((k) => {
      if (documents[k].refresh) documents[k].refresh();
    });
    if (documents.matching && documents.matching.refreshAll) documents.matching.refreshAll();
    updateToolbarState();
    updateStatusPill();
    refreshStatus();
  }

  /* ================================================================== *
   * Boot
   * ================================================================== */

  function boot() {
    if (CS.Theme) CS.Theme.init();
    buildCvdFilters();
    bindWindowControls();
    buildMenubar();
    buildToolbar();
    buildStatusBar();
    buildDocks();
    buildSplitters();
    bindShortcuts();

    openDocument(Store.get('document', 'matching') || 'matching');
    applyCvd();

    Store.on('color', () => {
      updateToolbarState();
      updateStatusPill();
      refreshStatus();
      Object.keys(documents).forEach((k) => {
        if (documents[k].refresh) documents[k].refresh();
      });
    });
    Store.on('history', updateToolbarState);
    Store.on('favorites', () => setStatus(`${Store.state.favorites.length} favourite colour${Store.state.favorites.length === 1 ? '' : 's'}.`, 2200));
    Store.on('state', () => {
      updateStatusPill();
      applyCvd();
      updatePaletteVisibility();
    });

    on(window, 'resize', () => {
      Object.keys(documents).forEach((k) => {
        if (documents[k].onResize) documents[k].onResize();
      });
      const m = documents.matching;
      if (m && m.refresh) m.refresh();
    });

    // Panels redraw their canvases when they come back into view.
    const host = qs('#doc-host');
    new ResizeObserver(() => {
      if (documents.matching && documents.matching.refresh) documents.matching.refresh();
    }).observe(host);

    setTimeout(() => setStatus('Ready', 2000), 400);

    if (location.search.includes('dev') || (typeof process !== 'undefined' && process.argv && process.argv.includes('--dev'))) {
      // devtools are opened from the main process on F12
    }
  }

  CS.App = {
    openDocument,
    closeDocument,
    togglePanel,
    togglePalette,
    setStatus,
    refreshAll,
    exportPalette,
    importPalette,
    pickFromScreen,
    saveWorkspace,
    newWorkspace,
    contrastAnalyzer,
    quickPreview,
    aboutDialog,
    documents
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
