/* ==================================================================
 * GalleryBrowser panel — browse the bundled scheme library.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { el, on, clear, debounce } = CS.Util;
  const Color = CS.Color;
  const Store = CS.Store;
  const W = CS.Widgets;

  const PAGE_SIZE = 12;

  function create() {
    let page = 0;
    let query = '';
    let connected = false;

    const panel = W.panel('GalleryBrowser', {
      onClose: () => CS.App.closeDocument('gallery'),
      onMenu: () => [
        { label: 'Reload Library', action: () => { page = 0; render(); } },
        { label: 'Open Matching Colors', action: () => CS.App.openDocument('matching') },
        { separator: true },
        { label: 'Close', action: () => CS.App.closeDocument('gallery') }
      ]
    });

    /* --- header --- */
    const prevBtn = el('button.gallery-nav', { type: 'button', text: '‹  Prev' });
    const nextBtn = el('button.gallery-nav', { type: 'button', text: 'Next  ›' });
    const searchInput = el('input', { type: 'text', placeholder: 'Search Schemes', spellcheck: 'false' });

    const searchField = el('div.search-field.gallery-search', {}, [
      (() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '11');
        svg.setAttribute('height', '11');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.innerHTML =
          '<circle cx="6.6" cy="6.6" r="4.4" fill="none" stroke="#666" stroke-width="1.6"/><path d="M10 10 L14 14" stroke="#666" stroke-width="1.8" stroke-linecap="round"/>';
        return svg;
      })(),
      searchInput
    ]);

    const head = el('div.gallery-head', {}, [
      el('div.gallery-nav-group', {}, [prevBtn, nextBtn]),
      el('div.spacer'),
      searchField
    ]);

    const scroll = el('div.panel-scroll.gallery-scroll');
    const grid = el('div.gallery-grid');
    const pageInfo = el('div.gallery-pageinfo');
    scroll.append(grid, pageInfo);

    panel.body.append(head, scroll);

    /* --- filtering --- */
    function filtered() {
      return CS.SchemeLibrary.search(query);
    }

    function render() {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      page = Math.max(0, Math.min(page, pages - 1));

      prevBtn.disabled = page <= 0;
      nextBtn.disabled = page >= pages - 1;

      clear(grid);

      if (!connected) {
        grid.appendChild(buildConnectCard());
      }

      const slice = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      if (!slice.length) {
        grid.appendChild(el('div.empty-note', { text: 'No schemes match your search.' }));
      }

      slice.forEach((scheme) => grid.appendChild(buildCard(scheme)));

      pageInfo.textContent = `${list.length} scheme${list.length === 1 ? '' : 's'}  ·  page ${page + 1} of ${pages}`;
    }

    function buildConnectCard() {
      const card = el('div.gallery-connect');
      card.append(
        el('div.gallery-connect-text', {
          text: 'Connect to COLOURlovers to explore over a million color palettes'
        })
      );
      const btn = el('button.btn.gallery-connect-btn', { type: 'button', text: 'Connect' });
      on(btn, 'click', () => {
        connected = true;
        CS.App.setStatus('Browsing the offline scheme library (no network connection required).');
        render();
      });
      card.appendChild(btn);
      return card;
    }

    function buildCard(scheme) {
      const card = el('div.scheme-card');

      const swatches = el('div.scheme-swatches');
      scheme.colors.forEach((hex) => {
        const sw = el('div.scheme-sw');
        sw.style.background = hex;
        sw.title = hex;
        on(sw, 'click', () => Store.setColor(hex));
        on(sw, 'contextmenu', (e) => {
          e.preventDefault();
          Store.addFavorite(hex);
          CS.App.setStatus(`Added ${hex} to Favourites.`);
        });
        swatches.appendChild(sw);
      });

      const apply = el('button.btn.btn-mini', { type: 'button', text: 'Use' });
      on(apply, 'click', () => {
        scheme.colors.forEach((h) => Store.addFavorite(h));
        Store.setColor(scheme.base);
        CS.App.setStatus(`Applied “${scheme.name}”.`);
      });

      card.append(
        el('div.scheme-card-head', {}, [
          el('span.scheme-name', { text: scheme.name }),
          el('div.spacer'),
          apply
        ]),
        swatches,
        el('div.scheme-meta', { text: `by ${scheme.author}  ·  ♥ ${scheme.likes}  ·  ${scheme.views.toLocaleString()} views` })
      );

      return card;
    }

    on(prevBtn, 'click', () => {
      page--;
      render();
    });
    on(nextBtn, 'click', () => {
      page++;
      render();
    });
    on(
      searchInput,
      'input',
      debounce(() => {
        query = searchInput.value;
        page = 0;
        render();
      }, 160)
    );

    render();

    return {
      root: panel.root,
      refresh() {},
      destroy() {}
    };
  }

  CS.Panels = CS.Panels || {};
  CS.Panels.Gallery = { create };
})();
