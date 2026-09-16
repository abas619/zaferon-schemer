/* ==================================================================
 * Bundled scheme / palette gallery used by the GalleryBrowser panel.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});

  const AUTHORS = [
    'pixel & pine',
    'studio hue',
    'lumen',
    'atlas colour',
    'cobalt',
    'wren design',
    'palette co.',
    'north light',
    'ferro',
    'bloomfield',
    'arcadia',
    'quill'
  ];

  const RAW = [
    ['Sunlit Meadow', ['#F6E27A', '#8CC63F', '#3E8E41', '#1F5F3A', '#FFF8DC']],
    ['Deep Ocean', ['#0B3C5D', '#1D65A6', '#328CC1', '#4FA5D6', '#D9F1FF']],
    ['Citrus Punch', ['#FF6B35', '#F7B801', '#F9E784', '#F45B69', '#2E1F27']],
    ['Muted Clay', ['#B5651D', '#D9A066', '#E8D5B7', '#8C5A2B', '#4A3423']],
    ['Neon Nights', ['#FF2E97', '#7B2FF7', '#1B1B3A', '#00E5FF', '#F5F5F5']],
    ['Rose Garden', ['#F7CAC9', '#F1A7A4', '#D96C7B', '#8C3A4A', '#4A1F2B']],
    ['Forest Floor', ['#2D4A22', '#4F7942', '#7FA650', '#B8C97A', '#E8E3C8']],
    ['Arctic Blue', ['#E8F4F8', '#A8D5E2', '#5C9EAD', '#326273', '#1B3A44']],
    ['Autumn Leaf', ['#8B3A0E', '#C4622D', '#E08A3C', '#F2B85C', '#F7E1B5']],
    ['Berry Smoothie', ['#5B2A86', '#9B4F96', '#D77BA0', '#F2A2B4', '#FDE8EC']],
    ['Desert Sand', ['#EDC9AF', '#D9A679', '#B87B4B', '#8A5533', '#4E2F1D']],
    ['Mint Fresh', ['#D8F3DC', '#95D5B2', '#52B788', '#2D6A4F', '#1B4332']],
    ['Retro Sunset', ['#F72585', '#B5179E', '#7209B7', '#3A0CA3', '#4361EE']],
    ['Charcoal Grey', ['#212529', '#343A40', '#495057', '#6C757D', '#ADB5BD']],
    ['Blush Studio', ['#FFF0F3', '#FFCCD5', '#FF8FA3', '#C9184A', '#590D22']],
    ['Lemon Zest', ['#FFFACD', '#FFF176', '#FFD54F', '#FFB300', '#FF8F00']],
    ['Sea Glass', ['#CDEDE3', '#9DD9CB', '#6BBFAB', '#3E8E7E', '#245C52']],
    ['Royal Velvet', ['#2B2D42', '#3D405B', '#6A4C93', '#9D4EDD', '#E0AAFF']],
    ['Terra Cotta', ['#F4E3D7', '#E5B299', '#C97B5A', '#A0522D', '#6B3410']],
    ['Cyberpunk', ['#0D0221', '#3B0F70', '#8C1C9E', '#FF2A6D', '#05D9E8']],
    ['Lavender Fields', ['#F3E8FF', '#D8B4FE', '#A855F7', '#7E22CE', '#4C1D95']],
    ['Coastal Fog', ['#F0F4F8', '#D9E2EC', '#9FB3C8', '#486581', '#243B53']],
    ['Papaya Pop', ['#FFE066', '#FFB020', '#FF6B35', '#D62828', '#7A1C1C']],
    ['Emerald City', ['#D1FAE5', '#6EE7B7', '#10B981', '#047857', '#064E3B']],
    ['Dusty Peach', ['#FDF0E4', '#F7D3B5', '#E7A97D', '#C57C50', '#8A5233']],
    ['Midnight Jazz', ['#0B132B', '#1C2541', '#3A506B', '#5BC0BE', '#FFFFFF']],
    ['Candy Shop', ['#FFE5EC', '#FFC2D1', '#FF8FAB', '#FB6F92', '#C9184A']],
    ['Olive Branch', ['#F4F1DE', '#E0DFC7', '#A3A380', '#6B705C', '#3F4238']],
    ['Electric Lime', ['#1A1A1A', '#3D3D3D', '#A8FF3E', '#64D400', '#F0FFF0']],
    ['Wine Cellar', ['#2B0B14', '#5C1A2B', '#8E2C48', '#C46A7E', '#F2D5DC']],
    ['Paper & Ink', ['#FDFCF8', '#E8E4D9', '#9A9A8E', '#3E3E3A', '#101010']],
    ['Tropical Punch', ['#FFD166', '#06D6A0', '#118AB2', '#073B4C', '#EF476F']],
    ['Morning Haze', ['#FDF6EC', '#F5DFC9', '#DDB892', '#B08968', '#7F5539']],
    ['Nordic Frost', ['#ECEFF4', '#D8DEE9', '#81A1C1', '#5E81AC', '#2E3440']],
    ['Sunflower', ['#FFF3B0', '#FFDD57', '#F4C430', '#C79400', '#6B4E00']],
    ['Plum Velvet', ['#2E1A47', '#4B2E83', '#7B4B94', '#B57EDC', '#EBD9F5']],
    ['Fresh Basil', ['#F0F7EE', '#C4E3C0', '#82B77A', '#4A7C45', '#24421F']],
    ['Copper Rose', ['#F9E9E5', '#EBC0B5', '#C98B7E', '#9A5B4F', '#5E3029']],
    ['Iceberg', ['#F7FBFC', '#D6E6F2', '#B9D6E8', '#769FCD', '#3A5A78']],
    ['Golden Hour', ['#FFF1D0', '#FFD98E', '#F9A03F', '#D1495B', '#6D2E46']],
    ['Slate & Rust', ['#33414D', '#5A6B78', '#94A5B1', '#C1663F', '#E8A87C']],
    ['Bubblegum', ['#FFF5FA', '#FFD6E8', '#FFA3C7', '#F76BA3', '#B3246D']],
    ['Deep Forest', ['#0E1B14', '#1F3A2B', '#356B4B', '#63A375', '#C9E4CA']],
    ['Sakura', ['#FFF7F8', '#FFE0E6', '#FFB7C5', '#E87B9A', '#9E3B5A']],
    ['Marine Layer', ['#1B2A41', '#324A5F', '#4F7C9E', '#8EC5D6', '#D6EAF1']],
    ['Amber Glow', ['#3D2200', '#7A4A0E', '#C07A1C', '#E9A83A', '#F8DE9B']],
    ['Cool Graphite', ['#F2F3F5', '#D7DADF', '#A0A6AF', '#5C636E', '#2B2F36']],
    ['Coral Reef', ['#0B3B47', '#14666E', '#2E9C9C', '#F7A072', '#FFD3B6']],
    ['Violet Storm', ['#1A1035', '#331C63', '#5B3A9B', '#8B6DD6', '#C9B8F0']],
    ['Harvest', ['#4A2C0F', '#8C5A21', '#C98B3A', '#E5B96B', '#F7E3B5']]
  ];

  const SCHEMES = RAW.map(([name, colors], i) => {
    const rgb = colors.map((h) => CS.Color.parse(h));
    const base = rgb[Math.floor(rgb.length / 2)];
    return {
      id: `scheme-${i}`,
      name,
      colors: rgb.map((c) => CS.Color.toHexUpper(c)),
      base: CS.Color.toHexUpper(base),
      author: AUTHORS[i % AUTHORS.length],
      likes: 40 + ((i * 137) % 960),
      views: 1200 + ((i * 7919) % 48000)
    };
  });

  function hexToRgbList(list) {
    return list.map((h) => CS.Color.parse(h));
  }

  CS.SchemeLibrary = {
    all: SCHEMES,
    colorsOf(scheme) {
      return hexToRgbList(scheme.colors);
    },
    search(query, source = SCHEMES) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return source.slice();
      return source.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.author.toLowerCase().includes(q) ||
          s.colors.some((c) => c.toLowerCase().includes(q))
      );
    }
  };
})();
