/* ==================================================================
 * Reusable UI widgets: sliders, tabs, dropdown menus, modals,
 * colour chips, drag & drop helpers.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { el, clamp, on, drag, num } = CS.Util;
  const Color = CS.Color;

  const DRAG_MIME = 'application/x-zaferon-color';

  /* ------------------------------------------------------------------ *
   * Gradient slider with a numeric field
   * ------------------------------------------------------------------ */

  /**
   * @param {object} opts
   *   label      – text shown left of the track
   *   min, max   – numeric range (default 0..255)
   *   value      – initial value
   *   gradient   – css gradient string OR function(value) => string
   *   decimals   – digits in the number field
   *   compact    – smaller track
   *   onInput(v, live)
   */
  function slider(opts = {}) {
    const min = opts.min == null ? 0 : opts.min;
    const max = opts.max == null ? 255 : opts.max;
    const decimals = opts.decimals == null ? 0 : opts.decimals;

    let value = clamp(opts.value == null ? min : opts.value, min, max);

    const track = el('div.cslider-track');
    const thumb = el('div.cslider-thumb');
    track.appendChild(thumb);

    const field = el('input.cslider-num', {
      type: 'text',
      inputmode: 'decimal',
      spellcheck: 'false'
    });

    const root = el(`div.cslider${opts.compact ? '.is-compact' : ''}`, {}, [
      opts.label != null ? el('span.cslider-label', { text: opts.label }) : null,
      el('div.cslider-body', {}, [track, field])
    ]);

    function paintGradient() {
      const g = typeof opts.gradient === 'function' ? opts.gradient(value) : opts.gradient;
      track.style.background = g || 'linear-gradient(90deg,#000,#fff)';
    }

    /* `force` repaints the number field even while it holds focus.
     *
     * The focus guard exists so a drag never clobbers a value the user is
     * part-way through typing. But it must not apply when the change came
     * *from* that field — otherwise ArrowUp/ArrowDown in the number box move
     * the value (and the thumb, and the colour) while the visible number sits
     * frozen, which reads as "the arrows do nothing". */
    function paint(force) {
      const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
      thumb.style.left = `calc(${clamp(pct, 0, 100)}% - 4px)`;
      if (force || document.activeElement !== field) field.value = num(value, decimals);
      paintGradient();
    }

    /**
     * `silent` skips onInput — used when the caller is syncing the widget
     * from state, which would otherwise bounce back and recurse.
     * `force` repaints the number field even when it is focused.
     */
    function set(v, live = true, silent = false, force = false) {
      const next = clamp(Number(v), min, max);
      if (Number.isNaN(next)) return;
      value = next;
      paint(force);
      if (!silent && opts.onInput) opts.onInput(value, live);
    }

    const trackPos = (clientX) => {
      const r = track.getBoundingClientRect();
      const t = clamp((clientX - r.left) / Math.max(1, r.width));
      return min + t * (max - min);
    };

    drag(track, {
      onStart: (e) => set(trackPos(e.clientX)),
      onMove: (e) => set(trackPos(e.clientX))
    });

    /* Every path that originates in the number field forces a repaint, so the
     * box always shows the value that was actually committed (including the
     * clamped one when the user types out of range). */
    on(field, 'change', () => set(field.value, true, false, true));
    on(field, 'keydown', (e) => {
      if (e.key === 'Enter') {
        set(field.value, true, false, true);
        field.blur();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        set(value + (opts.step || 1), true, false, true);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        set(value - (opts.step || 1), true, false, true);
      }
    });
    on(field, 'focus', () => field.select());

    // scroll wheel nudges the value
    on(track, 'wheel', (e) => {
      e.preventDefault();
      set(value + (e.deltaY < 0 ? 1 : -1) * (opts.step || 1));
    }, { passive: false });

    paint();

    root._slider = {
      get value() {
        return value;
      },
      set: (v) => {
        set(v, false);
      },
      /* Wrapped, not passed by reference: `paint` now takes a `force` flag, so
       * handing it straight to a listener would treat the event as truthy. */
      refresh: () => paint()
    };
    return root;
  }

  /* ------------------------------------------------------------------ *
   * Tab strip
   * ------------------------------------------------------------------ */

  /**
   * tabs([{ id, label }], activeId, onChange) -> HTMLElement
   */
  function tabs(items, activeId, onChange) {
    const root = el('div.tabs');
    const buttons = new Map();

    items.forEach((item) => {
      const btn = el('button.tab', { type: 'button', text: item.label, title: item.title || item.label });
      btn.dataset.id = item.id;
      if (item.id === activeId) btn.classList.add('is-active');
      on(btn, 'click', () => {
        buttons.forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        if (onChange) onChange(item.id);
      });
      buttons.set(item.id, btn);
      root.appendChild(btn);
    });

    root._tabs = {
      select(id) {
        const btn = buttons.get(id);
        if (!btn) return;
        buttons.forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
      }
    };
    return root;
  }

  /* ------------------------------------------------------------------ *
   * Dropdown menu
   * ------------------------------------------------------------------ */

  let openMenu = null;

  function closeMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onDocKey, true);
    }
  }

  function onDocDown(e) {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  }

  function onDocKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  }

  /**
   * menu(anchorRect | HTMLElement, items)
   * item: { label, accel, action, checked, disabled, separator, submenu }
   */
  function menu(anchor, items, opts = {}) {
    closeMenu();

    const root = el('div.menu-popup');

    /* Close every open submenu that does NOT contain `node`.
     *
     * The old implementation tracked a single `submenuOpen` wrap and closed it
     * from the pointerenter of any plain row. That also fired for rows *inside*
     * the open submenu, so the moment the pointer crossed into the submenu the
     * row it landed on closed its own parent — the submenu vanished right as you
     * reached it. Sweeping by ancestry instead keeps every wrapper that encloses
     * the hovered row (its ancestors) open, and closes only sibling branches. */
    const closeSubmenusExcept = (node) => {
      root.querySelectorAll('.menu-subwrap.is-open').forEach((wrap) => {
        if (wrap.contains(node)) return; // this is the branch we're standing in
        wrap.classList.remove('is-open');
        const owner = wrap.parentElement;
        if (owner) owner.classList.remove('is-subopen');
      });
    };

    /** Flip a submenu that would overflow the window, and clamp its height. */
    const placeSubmenu = (sub) => {
      requestAnimationFrame(() => {
        const wrap = sub.parentElement;

        // Measure from the default right-opening position every time. The
        // wrapper is anchored to the owning row; flipping only the popup with
        // `right: 0` would align it with that row's right edge and cover the
        // parent menu instead of placing it beside it.
        wrap.style.left = '100%';
        wrap.style.right = 'auto';
        sub.style.left = '0';
        sub.style.right = 'auto';

        let r = sub.getBoundingClientRect();
        const flip = r.right > window.innerWidth - 4;
        if (flip) {
          wrap.style.left = 'auto';
          wrap.style.right = '100%';
          sub.style.left = 'auto';
          sub.style.right = '0';
          r = sub.getBoundingClientRect();
        }

        if (r.bottom > window.innerHeight - 4) {
          sub.style.top = 'auto';
          sub.style.bottom = '0';
        } else {
          sub.style.top = '0';
          sub.style.bottom = 'auto';
        }

        // A long submenu should scroll rather than run off-screen.
        const top = Math.max(4, Math.min(r.top, 4));
        sub.style.maxHeight = `${Math.max(80, window.innerHeight - top - 6)}px`;
        sub.style.overflowY = 'auto';
      });
    };

    const buildItems = (list, parent) => {
      list.forEach((item) => {
        if (!item || item.separator) {
          parent.appendChild(el('div.menu-sep'));
          return;
        }

        // Rendered as a div rather than a button so items carrying a submenu
        // never nest interactive elements.
        const row = el('div.menu-item', { role: 'menuitem', tabindex: '-1' });
        if (item.checked) row.classList.add('is-checked');
        if (item.disabled) row.classList.add('is-disabled');

        row.appendChild(
          el('span.menu-check', {
            html: item.checked ? CS.Icons.svg('check', 13, { stroke: 2.5 }) : ''
          })
        );
        row.appendChild(el('span.menu-label', { text: item.label }));
        if (item.accel) row.appendChild(el('span.menu-accel', { text: item.accel }));
        if (item.submenu) {
          row.appendChild(el('span.menu-arrow', { html: CS.Icons.svg('chevron-right', 13) }));
        }

        if (item.submenu) {
          const sub = buildItems(item.submenu, el('div.menu-popup.menu-sub'));
          const wrap = el('div.menu-subwrap', {}, sub);
          row.appendChild(wrap);

          const open = () => {
            closeSubmenusExcept(row);
            wrap.classList.add('is-open');
            row.classList.add('is-subopen');
            placeSubmenu(sub);
          };
          // pointerenter is the mouse path; focus covers keyboard traversal.
          on(row, 'pointerenter', open);
          on(row, 'focus', open);
          on(row, 'click', (e) => {
            e.stopPropagation();
            open();
          });
        } else {
          on(row, 'pointerenter', () => {
            // Keep the submenu we are standing inside; close any sibling branch.
            closeSubmenusExcept(row);
          });
          on(row, 'click', (e) => {
            e.stopPropagation();
            closeMenu();
            if (item.action) item.action();
          });
        }

        parent.appendChild(row);
      });
      return parent;
    };

    buildItems(items, root);
    root.style.visibility = 'hidden';
    document.body.appendChild(root);

    const anchorRect =
      anchor instanceof Element
        ? anchor.getBoundingClientRect()
        : { left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.bottom, width: anchor.width, height: anchor.height };

    const r = root.getBoundingClientRect();
    let left = opts.alignRight ? anchorRect.right - r.width : anchorRect.left;
    let top = anchorRect.bottom + 1;

    if (left + r.width > window.innerWidth - 4) left = window.innerWidth - r.width - 4;
    if (left < 4) left = 4;
    if (top + r.height > window.innerHeight - 4) {
      top = Math.max(4, anchorRect.top - r.height - 1);
    }

    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
    root.style.visibility = '';

    openMenu = root;
    setTimeout(() => {
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onDocKey, true);
    }, 0);

    return root;
  }

  /* ------------------------------------------------------------------ *
   * Modal dialog
   * ------------------------------------------------------------------ */

  function dialog(opts = {}) {
    const layer = el('div.modal-layer');
    const body = el('div.modal-body');

    const buttons = (opts.buttons || [{ label: 'Close', value: null, primary: true }]).map((b) => {
      const btn = el(`button.btn${b.primary ? '.btn-primary' : ''}`, { type: 'button', text: b.label });
      on(btn, 'click', () => finish(b.value));
      return btn;
    });

    const box = el('div.modal', { style: { width: (opts.width || 460) + 'px' } }, [
      el('div.modal-title', {}, [
        el('span', { text: opts.title || 'Zaferon Schemer' }),
        (() => {
          const x = el('button.modal-close', { type: 'button', title: 'Close', html: CS.Icons.svg('x', 16) });
          on(x, 'click', () => finish(null));
          return x;
        })()
      ]),
      body,
      el('div.modal-actions', {}, buttons)
    ]);

    if (opts.content) body.appendChild(opts.content);

    layer.appendChild(box);
    document.body.appendChild(layer);

    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      layer.remove();
      document.removeEventListener('keydown', onKey, true);
      if (opts.onClose) opts.onClose(value);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(null);
      } else if (e.key === 'Enter' && document.activeElement && document.activeElement.tagName !== 'TEXTAREA') {
        const primary = buttons[buttons.length - 1];
        if (primary) primary.click();
      }
    }

    setTimeout(() => document.addEventListener('keydown', onKey, true), 0);

    const firstField = body.querySelector('input,select,textarea,button');
    if (firstField) setTimeout(() => firstField.focus(), 30);

    return { el: box, body, close: () => finish(null), finish };
  }

  /* ------------------------------------------------------------------ *
   * Colour chip
   * ------------------------------------------------------------------ */

  /**
   * chip(hex, opts) -> HTMLElement
   *   size, radius, label, title, draggable, removable
   *   onPick(hex, event), onRemove(hex), onContext(hex, event)
   */
  function chip(hexValue, opts = {}) {
    const hex = Color.toHex(Color.parse(hexValue) || { r: 0, g: 0, b: 0 });
    const node = el('div.color-chip', {
      title: opts.title || hex,
      draggable: opts.draggable !== false ? 'true' : null
    });
    node.style.background = hex;
    const dim = (v) => (typeof v === 'number' ? v + 'px' : v);
    if (opts.size) {
      node.style.width = dim(opts.size);
      node.style.height = dim(opts.size);
    }
    if (opts.width) node.style.width = dim(opts.width);
    if (opts.height) node.style.height = dim(opts.height);
    if (opts.radius) node.style.borderRadius = opts.radius;
    if (opts.className) node.classList.add(opts.className);
    node.dataset.hex = hex;

    // readable inner text
    if (opts.label) {
      node.classList.add('has-label');
      node.style.color = Color.isDark(Color.parse(hex)) ? '#fff' : '#000';
      node.appendChild(el('span.chip-label', { text: opts.label }));
    }

    if (opts.removable) {
      const x = el('button.chip-remove', { type: 'button', title: 'Remove', html: CS.Icons.svg('x', 12, { stroke: 2.5 }) });
      on(x, 'click', (e) => {
        e.stopPropagation();
        if (opts.onRemove) opts.onRemove(hex);
      });
      node.appendChild(x);
    }

    on(node, 'click', (e) => {
      if (opts.onPick) opts.onPick(hex, e);
    });

    if (opts.onContext) {
      on(node, 'contextmenu', (e) => {
        e.preventDefault();
        opts.onContext(hex, e);
      });
    }

    if (opts.draggable !== false) makeDraggable(node, hex);

    return node;
  }

  /** Read a colour out of a drop event. */
  function readDrop(e) {
    const dt = e.dataTransfer;
    if (!dt) return null;
    let raw = '';
    try {
      raw = dt.getData(DRAG_MIME) || dt.getData('text/plain') || '';
    } catch (_) {
      raw = '';
    }
    if (!raw) return null;
    return Color.parse(raw.trim());
  }

  /**
   * Make any element a colour drag source for HTML5 drag & drop.
   *
   * `getHex` is a string or a function, so a swatch that tracks the current
   * colour can resolve its payload lazily at dragstart.
   */
  function makeDraggable(node, getHex, opts = {}) {
    const cls = opts.draggingClass || 'is-dragging';
    node.draggable = true;
    on(node, 'dragstart', (e) => {
      const hex = Color.toHex(Color.parse(typeof getHex === 'function' ? getHex() : getHex) || { r: 0, g: 0, b: 0 });
      e.dataTransfer.setData('text/plain', hex);
      e.dataTransfer.setData(DRAG_MIME, hex);
      e.dataTransfer.effectAllowed = 'copyMove';
      node.classList.add(cls);
    });
    on(node, 'dragend', () => node.classList.remove(cls));
    return node;
  }

  /** Wire a container as a drop target for colours. */
  function dropZone(node, handler) {
    on(node, 'dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      node.classList.add('is-drop-target');
    });
    on(node, 'dragleave', (e) => {
      if (!node.contains(e.relatedTarget)) node.classList.remove('is-drop-target');
    });
    on(node, 'drop', (e) => {
      e.preventDefault();
      node.classList.remove('is-drop-target');
      const rgb = readDrop(e);
      if (rgb) handler(Color.toHex(rgb), e);
    });
  }

  /* ------------------------------------------------------------------ *
   * Pointer-based colour drag — for sources that are not DOM elements
   * ------------------------------------------------------------------ */

  /**
   * An HTML5 drag cannot be started from a <canvas>, and the scheme wedges on
   * the color wheel are painted into one. Canvas sources therefore use this
   * pointer drag instead: a ghost follows the cursor and the drop is resolved
   * with elementFromPoint against the zones registered below. Both paths end
   * up calling the same handlers, so a zone behaves identically either way.
   */
  const colourZones = new Set();

  /** Register a node as a drop target for pointer colour drags. */
  function colourDropZone(node, handler) {
    const zone = { node, handler };
    colourZones.add(zone);
    return () => colourZones.delete(zone);
  }

  function colourZoneAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return null;
    for (const z of colourZones) {
      if (z.node.contains(hit)) return z;
    }
    return null;
  }

  /**
   * Begin a pointer colour drag at (x, y). Resolves on pointerup.
   * @returns {boolean} always true — the caller has committed to the gesture.
   */
  function colourDrag(hex, opts = {}) {
    const ghost = el('div.colour-ghost', { title: hex });
    ghost.style.background = hex;
    /* Pick the label colour from the swatch, or a pale colour drags a
     * white-on-white hex around the window. */
    const rgb = Color.parse(hex);
    ghost.style.color = rgb && Color.isDark(rgb) ? '#ffffff' : '#000000';
    if (opts.label) ghost.appendChild(el('span.colour-ghost-label', { text: opts.label }));
    document.body.appendChild(ghost);
    document.body.classList.add('is-colour-dragging');

    let zone = null;

    const move = (x, y) => {
      ghost.style.left = `${x}px`;
      ghost.style.top = `${y}px`;
      const next = colourZoneAt(x, y);
      if (next !== zone) {
        if (zone) zone.node.classList.remove('is-drop-target');
        zone = next;
        if (zone) zone.node.classList.add('is-drop-target');
      }
    };

    const up = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-colour-dragging');
      if (zone) zone.node.classList.remove('is-drop-target');
      ghost.remove();
      const target = zone;
      zone = null;
      if (target && target.handler) target.handler(hex, e);
    };

    const onMove = (e) => move(e.clientX, e.clientY);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    if (opts.x != null) move(opts.x, opts.y);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Small labelled numeric stepper
   * ------------------------------------------------------------------ */

  function stepper(opts = {}) {
    const min = opts.min == null ? 0 : opts.min;
    const max = opts.max == null ? 999 : opts.max;
    let value = clamp(opts.value == null ? 0 : opts.value, min, max);

    const field = el('input.stepper-num', { type: 'text', value: String(value), spellcheck: 'false' });
    const up = el('button.stepper-btn', { type: 'button', html: CS.Icons.svg('chevron-up', 12, { stroke: 2.5 }) });
    const down = el('button.stepper-btn', { type: 'button', html: CS.Icons.svg('chevron-down', 12, { stroke: 2.5 }) });

    const root = el(`div.stepper${opts.compact ? '.is-compact' : ''}`, {}, [
      opts.label != null ? el('span.stepper-label', { text: opts.label }) : null,
      field,
      el('div.stepper-arrows', {}, [up, down])
    ]);

    function set(v, silent) {
      const next = clamp(Math.round(Number(v) || 0), min, max);
      value = next;
      field.value = String(next);
      if (opts.onChange && !silent) opts.onChange(next);
    }

    on(up, 'click', () => set(value + 1));
    on(down, 'click', () => set(value - 1));
    on(field, 'change', () => set(field.value));
    on(field, 'keydown', (e) => {
      if (e.key === 'Enter') {
        set(field.value);
        field.blur();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        set(value + 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        set(value - 1);
      }
    });

    root._stepper = {
      get value() {
        return value;
      },
      /** Programmatic sync — never fires onChange. */
      set: (v) => set(v, true)
    };
    return root;
  }

  /* ------------------------------------------------------------------ *
   * Styled select
   * ------------------------------------------------------------------ */

  function select(opts = {}) {
    const node = el('select.cselect');
    (opts.options || []).forEach((o) => {
      const opt = el('option', { value: o.id, text: o.label });
      if (o.id === opts.value) opt.selected = true;
      node.appendChild(opt);
    });
    if (opts.onChange) on(node, 'change', () => opts.onChange(node.value));
    if (opts.width) node.style.width = typeof opts.width === 'number' ? opts.width + 'px' : opts.width;
    return node;
  }

  /* ------------------------------------------------------------------ *
   * Panel title bar
   * ------------------------------------------------------------------ */

  /**
   * panel(title, { onClose, onMenu, extra }) -> { root, body, setTitle }
   */
  function panel(title, opts = {}) {
    const titleNode = el('span.panel-title-text', { text: title });
    const head = el('div.panel-head', {}, [titleNode, el('div.panel-head-spacer')]);

    if (opts.extra) head.appendChild(opts.extra);

    const menuBtn = opts.onMenu
      ? (() => {
          const btn = el('button.panel-btn.panel-btn-menu', {
            type: 'button',
            title: 'Panel options',
            html: CS.Icons.svg('more-horizontal', 15)
          });
          on(btn, 'click', (e) => {
            e.stopPropagation();
            const items = typeof opts.onMenu === 'function' ? opts.onMenu() : opts.onMenu;
            menu(btn, items);
          });
          return btn;
        })()
      : null;

    // The reference UI puts the dropdown right after the title for most
    // panels, but at the far right for the docked docks.
    if (menuBtn && opts.menuAlign !== 'end') head.appendChild(menuBtn);

    const actions = el('div.panel-head-actions');
    if (menuBtn && opts.menuAlign === 'end') actions.appendChild(menuBtn);
    if (opts.onClose) {
      const btn = el('button.panel-btn.panel-btn-close', { type: 'button', title: 'Close', html: CS.Icons.svg('x', 15) });
      on(btn, 'click', () => opts.onClose());
      actions.appendChild(btn);
    }
    head.appendChild(actions);

    const body = el('div.panel-body');
    const root = el('div.panel', {}, [head, body]);
    if (opts.className) root.classList.add(opts.className);

    return {
      root,
      head,
      body,
      setTitle(t) {
        titleNode.textContent = t;
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Section header inside a panel ("Color Palette ▾")
   * ------------------------------------------------------------------ */

  function subPanel(title, opts = {}) {
    const titleNode = el('span.panel-title-text', { text: title });
    const head = el('div.panel-head.panel-head-sub', {}, [titleNode]);
    const toggle = el('button.panel-btn.panel-btn-menu', {
      type: 'button',
      title: 'Options',
      html: CS.Icons.svg('chevron-down', 14)
    });
    head.appendChild(el('div.panel-head-actions', {}, [toggle]));

    const body = el('div.panel-body');
    const root = el('div.panel.panel-sub', {}, [head, body]);

    if (opts.onMenu) {
      on(toggle, 'click', (e) => {
        e.stopPropagation();
        menu(toggle, typeof opts.onMenu === 'function' ? opts.onMenu() : opts.onMenu);
      });
    }
    if (opts.collapsible !== false) {
      on(head, 'click', () => {
        root.classList.toggle('is-collapsed');
        CS.Icons.set(toggle, root.classList.contains('is-collapsed') ? 'chevron-right' : 'chevron-down', 14);
      });
    }

    return { root, head, body, setTitle: (t) => (titleNode.textContent = t) };
  }

  /* ------------------------------------------------------------------ *
   * Canvas helper — DPR aware
   * ------------------------------------------------------------------ */

  function fitCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr };
  }

  /* Largest ImageData we are ever willing to allocate (px). The widest pane in
   * this app is a few thousand CSS pixels; anything past this is a transient
   * layout artefact, not a real canvas, and allocating it throws
   * `RangeError: Out of memory at ImageData creation` straight out of a
   * Store listener — which takes every listener registered after it down
   * with it. Bail instead, and say so once per site. */
  const MAX_IMAGE_PX = 16 * 1024 * 1024;
  const refused = Object.create(null);

  /**
   * `ctx.createImageData` with the dimensions actually validated.
   * Returns null when the request is degenerate (non-finite, empty, or
   * absurdly large), so callers can simply `if (!img) return;`.
   */
  function imageData(ctx, w, h, tag) {
    const pw = Math.round(Number(w));
    const ph = Math.round(Number(h));
    const bad =
      !Number.isFinite(pw) || !Number.isFinite(ph) ||
      pw < 1 || ph < 1 || pw * ph > MAX_IMAGE_PX;
    if (bad) {
      const key = tag || 'canvas';
      if (!refused[key]) {
        refused[key] = true;
        console.warn(`[canvas] refusing ImageData ${pw}x${ph} for ${key}`);
      }
      return null;
    }
    return ctx.createImageData(pw, ph);
  }

  /** Draw a checkerboard so translucent colours read correctly. */
  function checkerboard(ctx, w, h, size = 8) {
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#ffffff' : '#e2e2e2';
        ctx.fillRect(x, y, size, size);
      }
    }
  }

  /* ------------------------------------------------------------------ */

  CS.Widgets = {
    slider,
    tabs,
    menu,
    closeMenu,
    dialog,
    chip,
    makeDraggable,
    dropZone,
    readDrop,
    colourDropZone,
    colourDrag,
    stepper,
    select,
    panel,
    subPanel,
    fitCanvas,
    imageData,
    checkerboard,
    DRAG_MIME
  };
})();
