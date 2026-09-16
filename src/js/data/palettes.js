/* ==================================================================
 * Colour Palette panel — swatch grids.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const Color = CS.Color;

  /** Spectrum grid: 32 hue columns × 6 shade rows. */
  function spectrumGrid(cols = 32, rows = 6) {
    const grid = [];
    const shades = [
      { s: 1.0, v: 0.5 },
      { s: 1.0, v: 0.68 },
      { s: 1.0, v: 0.86 },
      { s: 0.8, v: 1.0 },
      { s: 0.55, v: 1.0 },
      { s: 0.28, v: 1.0 }
    ];
    for (let r = 0; r < rows; r++) {
      const row = [];
      const sh = shades[r % shades.length];
      for (let c = 0; c < cols; c++) {
        const h = (c / cols) * 360;
        row.push(Color.toHex(Color.hsvToRgb({ h, s: sh.s, v: sh.v })));
      }
      grid.push(row);
    }
    return grid;
  }

  /** The classic 216 web-safe colours, laid out 6 columns of 36. */
  function websafeGrid() {
    const grid = [];
    for (let g = 0; g < 6; g++) {
      const row = [];
      for (let r = 0; r < 6; r++) {
        for (let b = 0; b < 6; b++) {
          row.push(Color.toHex({ r: r * 51, g: g * 51, b: b * 51 }));
        }
      }
      grid.push(row);
    }
    return grid;
  }

  /** Greyscale ramp. */
  function grayGrid(rows = 6, cols = 32) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const t = c / (cols - 1);
        const v = Math.round(255 * t);
        row.push(Color.toHex({ r: v, g: v, b: v }));
      }
      grid.push(row);
    }
    return grid;
  }

  /** Pastel grid — low saturation, high value. */
  function pastelGrid(cols = 32, rows = 6) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const h = (c / cols) * 360;
        row.push(Color.toHex(Color.hsvToRgb({ h, s: 0.85 - r * 0.13, v: 1 - r * 0.03 })));
      }
      grid.push(row);
    }
    return grid;
  }

  /** Named-color rows pulled from the libraries. */
  function libraryGrid(libId) {
    const lib = CS.NamedColors.get(libId);
    const cols = 32;
    const grid = [];
    for (let i = 0; i < lib.colors.length; i += cols) {
      grid.push(lib.colors.slice(i, i + cols).map((c) => c.hex.toUpperCase()));
    }
    return grid;
  }

  const SETS = [
    { id: 'default', label: 'Spectrum', build: () => spectrumGrid(32, 6) },
    { id: 'websafe', label: 'Web Safe 216', build: () => websafeGrid() },
    { id: 'pastel', label: 'Pastels', build: () => pastelGrid(32, 6) },
    { id: 'gray', label: 'Grayscale', build: () => grayGrid(6, 32) },
    { id: 'html', label: 'HTML Named', build: () => libraryGrid('html') },
    { id: 'material', label: 'Material', build: () => libraryGrid('material') },
    { id: 'classic', label: 'Classic Design', build: () => libraryGrid('classic') },
    { id: 'utility', label: 'Utility', build: () => libraryGrid('utility') }
  ];

  CS.Palettes = {
    SETS,
    build(id) {
      const set = SETS.find((s) => s.id === id) || SETS[0];
      return set.build();
    },
    spectrumGrid,
    websafeGrid,
    grayGrid,
    pastelGrid,
    libraryGrid
  };
})();
