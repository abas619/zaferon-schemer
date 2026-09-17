/* ==================================================================
 * Named colour libraries.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});

  /* --- HTML / CSS named colours (the classic 140) ------------------- */
  const HTML_NAMED = [
    ['Alice Blue', 'F0F8FF'],
    ['Antique White', 'FAEBD7'],
    ['Aqua', '00FFFF'],
    ['Aquamarine', '7FFFD4'],
    ['Azure', 'F0FFFF'],
    ['Beige', 'F5F5DC'],
    ['Bisque', 'FFE4C4'],
    ['Black', '000000'],
    ['Blanched Almond', 'FFEBCD'],
    ['Blue', '0000FF'],
    ['Blue Violet', '8A2BE2'],
    ['Brown', 'A52A2A'],
    ['Burly Wood', 'DEB887'],
    ['Cadet Blue', '5F9EA0'],
    ['Chartreuse', '7FFF00'],
    ['Chocolate', 'D2691E'],
    ['Coral', 'FF7F50'],
    ['Cornflower Blue', '6495ED'],
    ['Cornsilk', 'FFF8DC'],
    ['Crimson', 'DC143C'],
    ['Cyan', '00FFFF'],
    ['Dark Blue', '00008B'],
    ['Dark Cyan', '008B8B'],
    ['Dark Goldenrod', 'B8860B'],
    ['Dark Gray', 'A9A9A9'],
    ['Dark Green', '006400'],
    ['Dark Khaki', 'BDB76B'],
    ['Dark Magenta', '8B008B'],
    ['Dark Olive Green', '556B2F'],
    ['Dark Orange', 'FF8C00'],
    ['Dark Orchid', '9932CC'],
    ['Dark Red', '8B0000'],
    ['Dark Salmon', 'E9967A'],
    ['Dark Sea Green', '8FBC8F'],
    ['Dark Slate Blue', '483D8B'],
    ['Dark Slate Gray', '2F4F4F'],
    ['Dark Turquoise', '00CED1'],
    ['Dark Violet', '9400D3'],
    ['Deep Pink', 'FF1493'],
    ['Deep Sky Blue', '00BFFF'],
    ['Dim Gray', '696969'],
    ['Dodger Blue', '1E90FF'],
    ['Fire Brick', 'B22222'],
    ['Floral White', 'FFFAF0'],
    ['Forest Green', '228B22'],
    ['Fuchsia', 'FF00FF'],
    ['Gainsboro', 'DCDCDC'],
    ['Ghost White', 'F8F8FF'],
    ['Gold', 'FFD700'],
    ['Goldenrod', 'DAA520'],
    ['Gray', '808080'],
    ['Green', '008000'],
    ['Green Yellow', 'ADFF2F'],
    ['Honeydew', 'F0FFF0'],
    ['Hot Pink', 'FF69B4'],
    ['Indian Red', 'CD5C5C'],
    ['Indigo', '4B0082'],
    ['Ivory', 'FFFFF0'],
    ['Khaki', 'F0E68C'],
    ['Lavender', 'E6E6FA'],
    ['Lavender Blush', 'FFF0F5'],
    ['Lawn Green', '7CFC00'],
    ['Lemon Chiffon', 'FFFACD'],
    ['Light Blue', 'ADD8E6'],
    ['Light Coral', 'F08080'],
    ['Light Cyan', 'E0FFFF'],
    ['Light Goldenrod', 'FAFAD2'],
    ['Light Gray', 'D3D3D3'],
    ['Light Green', '90EE90'],
    ['Light Pink', 'FFB6C1'],
    ['Light Salmon', 'FFA07A'],
    ['Light Sea Green', '20B2AA'],
    ['Light Sky Blue', '87CEFA'],
    ['Light Slate Gray', '778899'],
    ['Light Steel Blue', 'B0C4DE'],
    ['Light Yellow', 'FFFFE0'],
    ['Lime', '00FF00'],
    ['Lime Green', '32CD32'],
    ['Linen', 'FAF0E6'],
    ['Magenta', 'FF00FF'],
    ['Maroon', '800000'],
    ['Medium Aquamarine', '66CDAA'],
    ['Medium Blue', '0000CD'],
    ['Medium Orchid', 'BA55D3'],
    ['Medium Purple', '9370DB'],
    ['Medium Sea Green', '3CB371'],
    ['Medium Slate Blue', '7B68EE'],
    ['Medium Spring Green', '00FA9A'],
    ['Medium Turquoise', '48D1CC'],
    ['Medium Violet Red', 'C71585'],
    ['Midnight Blue', '191970'],
    ['Mint Cream', 'F5FFFA'],
    ['Misty Rose', 'FFE4E1'],
    ['Moccasin', 'FFE4B5'],
    ['Navajo White', 'FFDEAD'],
    ['Navy', '000080'],
    ['Old Lace', 'FDF5E6'],
    ['Olive', '808000'],
    ['Olive Drab', '6B8E23'],
    ['Orange', 'FFA500'],
    ['Orange Red', 'FF4500'],
    ['Orchid', 'DA70D6'],
    ['Pale Goldenrod', 'EEE8AA'],
    ['Pale Green', '98FB98'],
    ['Pale Turquoise', 'AFEEEE'],
    ['Pale Violet Red', 'DB7093'],
    ['Papaya Whip', 'FFEFD5'],
    ['Peach Puff', 'FFDAB9'],
    ['Peru', 'CD853F'],
    ['Pink', 'FFC0CB'],
    ['Plum', 'DDA0DD'],
    ['Powder Blue', 'B0E0E6'],
    ['Purple', '800080'],
    ['Rebecca Purple', '663399'],
    ['Red', 'FF0000'],
    ['Rosy Brown', 'BC8F8F'],
    ['Royal Blue', '4169E1'],
    ['Saddle Brown', '8B4513'],
    ['Salmon', 'FA8072'],
    ['Sandy Brown', 'F4A460'],
    ['Sea Green', '2E8B57'],
    ['Sea Shell', 'FFF5EE'],
    ['Sienna', 'A0522D'],
    ['Silver', 'C0C0C0'],
    ['Sky Blue', '87CEEB'],
    ['Slate Blue', '6A5ACD'],
    ['Slate Gray', '708090'],
    ['Snow', 'FFFAFA'],
    ['Spring Green', '00FF7F'],
    ['Steel Blue', '4682B4'],
    ['Tan', 'D2B48C'],
    ['Teal', '008080'],
    ['Thistle', 'D8BFD8'],
    ['Tomato', 'FF6347'],
    ['Turquoise', '40E0D0'],
    ['Violet', 'EE82EE'],
    ['Wheat', 'F5DEB3'],
    ['White', 'FFFFFF'],
    ['White Smoke', 'F5F5F5'],
    ['Yellow', 'FFFF00'],
    ['Yellow Green', '9ACD32']
  ];

  /* --- Material Design 2014 ----------------------------------------
   *
   * Held as ramps rather than as a flat list of names, because that is how the
   * palette is defined and how it is used: pick a hue, then pick a weight. The
   * previous version listed only the 500s plus a handful of 900s, so Red 100
   * was simply absent from the library.
   *
   * Each row runs 50, 100, 200 … 900 — see MATERIAL_SHADES for the order. */
  const MATERIAL_RAMPS = {
    Red: ['FFEBEE', 'FFCDD2', 'EF9A9A', 'E57373', 'EF5350', 'F44336', 'E53935', 'D32F2F', 'C62828', 'B71C1C'],
    Pink: ['FCE4EC', 'F8BBD0', 'F48FB1', 'F06292', 'EC407A', 'E91E63', 'D81B60', 'C2185B', 'AD1457', '880E4F'],
    Purple: ['F3E5F5', 'E1BEE7', 'CE93D8', 'BA68C8', 'AB47BC', '9C27B0', '8E24AA', '7B1FA2', '6A1B9A', '4A148C'],
    'Deep Purple': ['EDE7F6', 'D1C4E9', 'B39DDB', '9575CD', '7E57C2', '673AB7', '5E35B1', '512DA8', '4527A0', '311B92'],
    Indigo: ['E8EAF6', 'C5CAE9', '9FA8DA', '7986CB', '5C6BC0', '3F51B5', '3949AB', '303F9F', '283593', '1A237E'],
    Blue: ['E3F2FD', 'BBDEFB', '90CAF9', '64B5F6', '42A5F5', '2196F3', '1E88E5', '1976D2', '1565C0', '0D47A1'],
    'Light Blue': ['E1F5FE', 'B3E5FC', '81D4FA', '4FC3F7', '29B6F6', '03A9F4', '039BE5', '0288D1', '0277BD', '01579B'],
    Cyan: ['E0F7FA', 'B2EBF2', '80DEEA', '4DD0E1', '26C6DA', '00BCD4', '00ACC1', '0097A7', '00838F', '006064'],
    Teal: ['E0F2F1', 'B2DFDB', '80CBC4', '4DB6AC', '26A69A', '009688', '00897B', '00796B', '00695C', '004D40'],
    Green: ['E8F5E9', 'C8E6C9', 'A5D6A7', '81C784', '66BB6A', '4CAF50', '43A047', '388E3C', '2E7D32', '1B5E20'],
    'Light Green': ['F1F8E9', 'DCEDC8', 'C5E1A5', 'AED581', '9CCC65', '8BC34A', '7CB342', '689F38', '558B2F', '33691E'],
    Lime: ['F9FBE7', 'F0F4C3', 'E6EE9C', 'DCE775', 'D4E157', 'CDDC39', 'C0CA33', 'AFB42B', '9E9D24', '827717'],
    Yellow: ['FFFDE7', 'FFF9C4', 'FFF59D', 'FFF176', 'FFEE58', 'FFEB3B', 'FDD835', 'FBC02D', 'F9A825', 'F57F17'],
    Amber: ['FFF8E1', 'FFECB3', 'FFE082', 'FFD54F', 'FFCA28', 'FFC107', 'FFB300', 'FFA000', 'FF8F00', 'FF6F00'],
    Orange: ['FFF3E0', 'FFE0B2', 'FFCC80', 'FFB74D', 'FFA726', 'FF9800', 'FB8C00', 'F57C00', 'EF6C00', 'E65100'],
    'Deep Orange': ['FBE9E7', 'FFCCBC', 'FFAB91', 'FF8A65', 'FF7043', 'FF5722', 'F4511E', 'E64A19', 'D84315', 'BF360C'],
    Brown: ['EFEBE9', 'D7CCC8', 'BCAAA4', 'A1887F', '8D6E63', '795548', '6D4C41', '5D4037', '4E342E', '3E2723'],
    Grey: ['FAFAFA', 'F5F5F5', 'EEEEEE', 'E0E0E0', 'BDBDBD', '9E9E9E', '757575', '616161', '424242', '212121'],
    'Blue Grey': ['ECEFF1', 'CFD8DC', 'B0BEC5', '90A4AE', '78909C', '607D8B', '546E7A', '455A64', '37474F', '263238']
  };

  const MATERIAL_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

  /* Accents. Only the chromatic families have them, and the weights are a
   * different set from the main ramp — A100 is lighter than 100 but A700 is
   * darker than 900, so they cannot be folded into the same row. */
  const MATERIAL_ACCENTS = {
    Red: ['FF8A80', 'FF5252', 'FF1744', 'D50000'],
    Pink: ['FF80AB', 'FF4081', 'F50057', 'C51162'],
    Purple: ['EA80FC', 'E040FB', 'D500F9', 'AA00FF'],
    'Deep Purple': ['B388FF', '7C4DFF', '651FFF', '6200EA'],
    Indigo: ['8C9EFF', '536DFE', '3D5AFE', '304FFE'],
    Blue: ['82B1FF', '448AFF', '2979FF', '2962FF'],
    'Light Blue': ['80D8FF', '40C4FF', '00B0FF', '0091EA'],
    Cyan: ['84FFFF', '18FFFF', '00E5FF', '00B8D4'],
    Teal: ['A7FFEB', '64FFDA', '1DE9B6', '00BFA5'],
    Green: ['B9F6CA', '69F0AE', '00E676', '00C853'],
    'Light Green': ['CCFF90', 'B2FF59', '76FF03', '64DD17'],
    Lime: ['F4FF81', 'EEFF41', 'C6FF00', 'AEEA00'],
    Yellow: ['FFFF8D', 'FFFF00', 'FFEA00', 'FFD600'],
    Amber: ['FFE57F', 'FFD740', 'FFC400', 'FFAB00'],
    Orange: ['FFD180', 'FFAB40', 'FF9100', 'FF6D00'],
    'Deep Orange': ['FF9E80', 'FF6E40', 'FF3D00', 'DD2C00']
  };

  const ACCENT_SHADES = ['A100', 'A200', 'A400', 'A700'];

  function materialList() {
    const out = [];
    Object.keys(MATERIAL_RAMPS).forEach((family) => {
      MATERIAL_RAMPS[family].forEach((hex, i) => {
        out.push([`${family} ${MATERIAL_SHADES[i]}`, hex]);
      });
      const accents = MATERIAL_ACCENTS[family];
      if (accents) {
        accents.forEach((hex, i) => out.push([`${family} ${ACCENT_SHADES[i]}`, hex]));
      }
    });
    return out;
  }

  /* --- Retro -------------------------------------------------------
   *
   * Period colour by decade. The names carry the decade so a search for "80s"
   * narrows the list, which is the only way to use this library — nobody looks
   * for "Neon Pink" by name, they scroll the eighties. */
  const RETRO = [
    // Seventies — warm, earthy, everything slightly faded.
    ['70s Harvest Gold', 'E3A72F'],
    ['70s Avocado', 'A8B545'],
    ['70s Burnt Orange', 'C0562A'],
    ['70s Rust', '9C4722'],
    ['70s Mustard', 'D4A017'],
    ['70s Olive', '6B6B2E'],
    ['70s Teal', '2E7B7B'],
    ['70s Faded Denim', '4A6FA5'],
    ['70s Cocoa', '6B4226'],
    ['70s Cream', 'F2E3C6'],
    ['70s Paprika', 'B33A2B'],
    ['70s Sage', '9CAF88'],

    // Eighties — saturated, synthetic, deliberately loud.
    ['80s Neon Pink', 'FF2E88'],
    ['80s Hot Magenta', 'E0218A'],
    ['80s Electric Blue', '1F51FF'],
    ['80s Neon Cyan', '00F0FF'],
    ['80s Laser Lemon', 'F2F230'],
    ['80s Purple Rain', '7B2FF7'],
    ['80s Miami Teal', '00D9C0'],
    ['80s Sunset Orange', 'FF6B35'],
    ['80s Bubblegum', 'FF6EC7'],
    ['80s Grid Purple', '3A0CA3'],

    // Nineties — the saturation drops back out; dusty and muted.
    ['90s Dusty Rose', 'C08A8A'],
    ['90s Muted Teal', '6FA8A0'],
    ['90s Denim Blue', '3B5F8A'],
    ['90s Mustard', 'C9A227'],
    ['90s Plum', '7A4E6E'],
    ['90s Sage Green', 'A3B18A'],
    ['90s Terracotta', 'C97B63'],
    ['90s Off White', 'EFE7D6'],
    ['90s Slate Blue', '5B6C8F'],
    ['90s Forest', '2F5D3A']
  ];

  /* --- Pantone-ish / classic design swatches ------------------------ */
  const CLASSIC = [
    ['Tangerine Tango', 'DD4124'],
    ['Honeysuckle', 'D94F70'],
    ['Turquoise', '45B5AA'],
    ['Mimosa', 'EFC050'],
    ['Blue Iris', '5A5B9F'],
    ['Greenery', '88B04B'],
    ['Ultra Violet', '5F4B8B'],
    ['Living Coral', 'FF6F61'],
    ['Classic Blue', '0F4C81'],
    ['Illuminating', 'F5DF4D'],
    ['Very Peri', '6667AB'],
    ['Viva Magenta', 'BE3455'],
    ['Peach Fuzz', 'FFBE98'],
    ['Mocha Mousse', 'A47864'],
    ['Marsala', '955251'],
    ['Serenity', '91A8D0'],
    ['Rose Quartz', 'F7CAC9'],
    ['Emerald', '009473'],
    ['Radiant Orchid', 'B163A3'],
    ['Sand Dollar', 'DECDBE']
  ];

  /* --- Tailwind-ish utility palettes -------------------------------- */
  const UTILITY = [
    ['Slate 900', '0F172A'],
    ['Slate 700', '334155'],
    ['Slate 500', '64748B'],
    ['Slate 300', 'CBD5E1'],
    ['Slate 100', 'F1F5F9'],
    ['Red 600', 'DC2626'],
    ['Orange 500', 'F97316'],
    ['Amber 400', 'FBBF24'],
    ['Lime 400', 'A3E635'],
    ['Emerald 500', '10B981'],
    ['Teal 500', '14B8A6'],
    ['Cyan 500', '06B6D4'],
    ['Sky 500', '0EA5E9'],
    ['Blue 600', '2563EB'],
    ['Indigo 600', '4F46E5'],
    ['Violet 600', '7C3AED'],
    ['Purple 600', '9333EA'],
    ['Fuchsia 600', 'C026D3'],
    ['Pink 600', 'DB2777'],
    ['Rose 600', 'E11D48']
  ];

  function build(list) {
    return list.map(([name, hex]) => Object.assign({ name, hex: '#' + hex }, CS.Color.parse(hex)));
  }

  const LIBRARIES = [
    { id: 'html', label: 'HTML Named Colors', colors: build(HTML_NAMED) },
    { id: 'material', label: 'Material Design', colors: build(materialList()) },
    { id: 'classic', label: 'Classic Design', colors: build(CLASSIC) },
    { id: 'utility', label: 'Utility Palettes', colors: build(UTILITY) },
    { id: 'retro', label: 'Retro', colors: build(RETRO) }
  ];

  CS.NamedColors = {
    LIBRARIES,
    get(id) {
      return LIBRARIES.find((l) => l.id === id) || LIBRARIES[0];
    },
    all() {
      return LIBRARIES.reduce((acc, l) => acc.concat(l.colors), []);
    }
  };
})();
