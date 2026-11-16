/**
 * @fileoverview 宝可梦矢量 SVG 头像与角色映射引擎（经典浏览器脚本 + 全局命名空间）。
 * 全部采用内联高清矢量 SVG 绘制，不依赖外网 CDN，避免模块脚本 CORS 问题。
 */
(function initPokeSwarmPokemon(root) {
  const POKEMON_CATALOG = [
    { id: 'charizard', name: '喷火龙', en: 'Charizard', bg: 'radial-gradient(circle at 35% 30%, #4b3126 0%, #241918 100%)', accent: '#ff7a45' },
    { id: 'eevee', name: '伊布', en: 'Eevee', bg: 'radial-gradient(circle at 35% 30%, #47392b 0%, #231d19 100%)', accent: '#d89b56' },
    { id: 'rotom', name: '洛托姆', en: 'Rotom', bg: 'radial-gradient(circle at 35% 30%, #233c4b 0%, #16212a 100%)', accent: '#38bdf8' },
    { id: 'gengar', name: '耿鬼', en: 'Gengar', bg: 'radial-gradient(circle at 35% 30%, #3d3154 0%, #1d1829 100%)', accent: '#9d7aff' },
    { id: 'pikachu', name: '皮卡丘', en: 'Pikachu', bg: 'radial-gradient(circle at 35% 30%, #4b4322 0%, #242116 100%)', accent: '#facc15' },
    { id: 'bulbasaur', name: '妙蛙种子', en: 'Bulbasaur', bg: 'radial-gradient(circle at 35% 30%, #244338 0%, #16241f 100%)', accent: '#34d399' },
    { id: 'squirtle', name: '杰尼龟', en: 'Squirtle', bg: 'radial-gradient(circle at 35% 30%, #23424d 0%, #152228 100%)', accent: '#60a5fa' },
    { id: 'jigglypuff', name: '胖丁', en: 'Jigglypuff', bg: 'radial-gradient(circle at 35% 30%, #4d2e42 0%, #261822 100%)', accent: '#f472b6' },
    { id: 'snorlax', name: '卡比兽', en: 'Snorlax', bg: 'radial-gradient(circle at 35% 30%, #283b44 0%, #182026 100%)', accent: '#5eead4' },
    { id: 'lucario', name: '路卡利欧', en: 'Lucario', bg: 'radial-gradient(circle at 35% 30%, #263954 0%, #161e2b 100%)', accent: '#3b82f6' },
  ];

  const ROLE_MATCHERS = [
    [/coordinator|lead|master|chief|queen/i, 'charizard'],
    [/monitor|watch|guard|health/i, 'rotom'],
    [/narrator|summary|overview/i, 'bulbasaur'],
    [/ui|front|web|css|view|design/i, 'eevee'],
    [/core|back|api|server|parser|engine|rust|go/i, 'gengar'],
    [/doc|readme|test|verify|verifier|qa|check/i, 'pikachu'],
    [/build|infra|cli|script|ops|db|sql/i, 'squirtle'],
    [/ml|ai|model|data/i, 'lucario'],
  ];

  function hashName(str) {
    let h = 2166136261;
    for (const ch of String(str || '')) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /**
   * 为成员匹配默认的宝可梦 ID（支持用户手动覆写）。
   * @param {string} memberName 成员名
   * @param {Record<string, string>} overrides 用户自定义映射
   */
  function resolvePokemonId(memberName, overrides = {}) {
    if (overrides && overrides[memberName]) {
      const exists = POKEMON_CATALOG.some((p) => p.id === overrides[memberName]);
      if (exists) return overrides[memberName];
    }
    for (const [re, id] of ROLE_MATCHERS) {
      if (re.test(memberName)) return id;
    }
    const pool = POKEMON_CATALOG.slice(1);
    return pool[hashName(memberName) % pool.length].id;
  }

  function getPokemonMeta(pokemonId) {
    return POKEMON_CATALOG.find((p) => p.id === pokemonId) || POKEMON_CATALOG[0];
  }

  function eyesSvg(status, left, right, style = {}) {
    const { size = 4.2, color = '#1b1d24', iris = '#ffffff' } = style;
    if (status === 'waiting') {
      return `
        <path d="M ${left.x - size} ${left.y} Q ${left.x} ${left.y + 3} ${left.x + size} ${left.y}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
        <path d="M ${right.x - size} ${right.y} Q ${right.x} ${right.y + 3} ${right.x + size} ${right.y}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
      `;
    }
    if (status === 'killed' || status === 'error' || status === 'quota') {
      const s = size * 0.72;
      return `
        <path d="M ${left.x - s} ${left.y - s} L ${left.x + s} ${left.y + s} M ${left.x + s} ${left.y - s} L ${left.x - s} ${left.y + s}" stroke="${color}" stroke-width="2.1" stroke-linecap="round"/>
        <path d="M ${right.x - s} ${right.y - s} L ${right.x + s} ${right.y + s} M ${right.x + s} ${right.y - s} L ${right.x - s} ${right.y + s}" stroke="${color}" stroke-width="2.1" stroke-linecap="round"/>
      `;
    }
    return `
      <ellipse cx="${left.x}" cy="${left.y}" rx="${size * 0.85}" ry="${size}" fill="${color}"/>
      <circle cx="${left.x - size * 0.28}" cy="${left.y - size * 0.35}" r="${size * 0.36}" fill="${iris}"/>
      <ellipse cx="${right.x}" cy="${right.y}" rx="${size * 0.85}" ry="${size}" fill="${color}"/>
      <circle cx="${right.x - size * 0.28}" cy="${right.y - size * 0.35}" r="${size * 0.36}" fill="${iris}"/>
    `;
  }

  /**
   * 生成宝可梦头像内联 SVG 字符串。
   * @param {string} pokemonId 宝可梦 ID
   * @param {string} status 成员状态
   * @returns {string}
   */
  function renderPokemonSvg(pokemonId, status = 'working') {
    const sleepBadge = status === 'waiting'
      ? `<text x="72" y="25" font-size="11" font-weight="700" fill="#94a3b8" font-family="system-ui, sans-serif">zZ</text>`
      : '';

    const art = {
      charizard: () => `
        <path d="M 16 58 L 28 36 L 40 52 Z" fill="#2c7a7b" stroke="#182026" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 84 58 L 72 36 L 60 52 Z" fill="#2c7a7b" stroke="#182026" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 76 78 C 86 72 90 60 83 51 C 80 56 76 55 75 61 C 72 68 72 74 76 78 Z" fill="#ff9f1c"/>
        <path d="M 77 75 C 83 71 84 63 80 57 C 77 62 75 69 77 75 Z" fill="#ffe66d"/>
        <ellipse cx="50" cy="69" rx="19" ry="18" fill="#f3722c" stroke="#182026" stroke-width="2.2"/>
        <ellipse cx="50" cy="71" rx="12" ry="13" fill="#f9dcc4"/>
        <path d="M 35 35 L 28 19 L 42 29 Z" fill="#f3722c" stroke="#182026" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 65 35 L 72 19 L 58 29 Z" fill="#f3722c" stroke="#182026" stroke-width="2.2" stroke-linejoin="round"/>
        <ellipse cx="50" cy="43" rx="17" ry="15" fill="#f3722c" stroke="#182026" stroke-width="2.2"/>
        <ellipse cx="50" cy="48" rx="13" ry="8" fill="#f8961e"/>
        ${eyesSvg(status, { x: 42, y: 40 }, { x: 58, y: 40 }, { size: 3.6, color: '#1b1d24' })}
        <path d="M 43 51 Q 50 55 57 51" stroke="#182026" stroke-width="2" stroke-linecap="round" fill="none"/>
        <path d="M 45 52 L 46.5 55 L 48 52 M 52 52 L 53.5 55 L 55 52" fill="#ffffff"/>
      `,
      eevee: () => `
        <path d="M 36 39 L 20 15 L 43 29 Z" fill="#b87b44" stroke="#231914" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 34 35 L 24 19 L 39 29 Z" fill="#4a3222"/>
        <path d="M 64 39 L 80 15 L 57 29 Z" fill="#b87b44" stroke="#231914" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 66 35 L 76 19 L 61 29 Z" fill="#4a3222"/>
        <path d="M 28 65 Q 35 55 44 61 Q 50 53 56 61 Q 65 55 72 65 Q 66 80 50 82 Q 34 80 28 65 Z" fill="#f5e3c3" stroke="#231914" stroke-width="2.2" stroke-linejoin="round"/>
        <ellipse cx="50" cy="46" rx="18" ry="16" fill="#c78a52" stroke="#231914" stroke-width="2.2"/>
        ${eyesSvg(status, { x: 42, y: 45 }, { x: 58, y: 45 }, { size: 4.1, color: '#2b1d14' })}
        <ellipse cx="50" cy="50" rx="1.8" ry="1.2" fill="#231914"/>
        <path d="M 46 53 Q 50 56 54 53" stroke="#231914" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      `,
      rotom: () => `
        <path d="M 50 26 L 50 13 L 55 20 L 50 26" stroke="#7dd3fc" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M 29 52 L 15 44 L 22 54 L 14 60 L 30 58" fill="#38bdf8" stroke="#0c4a6e" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M 71 52 L 85 44 L 78 54 L 86 60 L 70 58" fill="#38bdf8" stroke="#0c4a6e" stroke-width="1.8" stroke-linejoin="round"/>
        <ellipse cx="50" cy="52" rx="22" ry="20" fill="rgba(56,189,248,0.22)"/>
        <ellipse cx="50" cy="52" rx="16" ry="17" fill="#fb923c" stroke="#1e293b" stroke-width="2.2"/>
        ${eyesSvg(status, { x: 43, y: 48 }, { x: 57, y: 48 }, { size: 4.2, color: '#0f172a', iris: '#bae6fd' })}
        <path d="M 44 58 L 48 61 L 52 58 L 56 61" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      `,
      gengar: () => `
        <path d="M 33 34 L 24 16 L 44 26 Z" fill="#6d59a8" stroke="#1b1429" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 67 34 L 76 16 L 56 26 Z" fill="#6d59a8" stroke="#1b1429" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 43 26 L 47 18 L 50 25 L 54 18 L 57 26" fill="#6d59a8" stroke="#1b1429" stroke-width="2" stroke-linejoin="round"/>
        <ellipse cx="50" cy="54" rx="26" ry="24" fill="#6d59a8" stroke="#1b1429" stroke-width="2.2"/>
        ${status === 'waiting' || status === 'killed' ? eyesSvg(status, { x: 39, y: 46 }, { x: 61, y: 46 }, { size: 4.3, color: '#1b1429' }) : `
          <path d="M 32 41 L 45 48 Q 37 52 32 41 Z" fill="#ef4444" stroke="#1b1429" stroke-width="1.6"/>
          <path d="M 68 41 L 55 48 Q 63 52 68 41 Z" fill="#ef4444" stroke="#1b1429" stroke-width="1.6"/>
          <circle cx="39" cy="46" r="1.4" fill="#1b1429"/>
          <circle cx="61" cy="46" r="1.4" fill="#1b1429"/>
        `}
        <path d="M 33 59 Q 50 71 67 59 Q 50 64 33 59 Z" fill="#ffffff" stroke="#1b1429" stroke-width="1.8"/>
        <path d="M 41 61 L 41 65 M 47 62 L 47 67 M 53 62 L 53 67 M 59 61 L 59 65" stroke="#1b1429" stroke-width="1.4"/>
      `,
      pikachu: () => `
        <path d="M 35 37 L 23 14 L 42 29 Z" fill="#facc15" stroke="#231f10" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 28 23 L 23 14 L 32 20 Z" fill="#1f2937"/>
        <path d="M 65 37 L 77 14 L 58 29 Z" fill="#facc15" stroke="#231f10" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 72 23 L 77 14 L 68 20 Z" fill="#1f2937"/>
        <ellipse cx="50" cy="69" rx="18" ry="15" fill="#facc15" stroke="#231f10" stroke-width="2.2"/>
        <ellipse cx="50" cy="47" rx="19" ry="17" fill="#facc15" stroke="#231f10" stroke-width="2.2"/>
        ${eyesSvg(status, { x: 41, y: 45 }, { x: 59, y: 45 }, { size: 4, color: '#1b1d24' })}
        <circle cx="34" cy="52" r="4.2" fill="#ef4444"/>
        <circle cx="66" cy="52" r="4.2" fill="#ef4444"/>
        <polygon points="48.5,48.5 51.5,48.5 50,50.5" fill="#1b1d24"/>
        <path d="M 45 53 Q 48 56 50 53 Q 52 56 55 53" stroke="#1b1d24" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      `,
      bulbasaur: () => `
        <path d="M 34 38 C 34 22 50 15 50 15 C 50 15 66 22 66 38 Z" fill="#22c55e" stroke="#14291c" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 31 44 L 27 32 L 38 38 Z" fill="#4fd1c5" stroke="#14291c" stroke-width="2.1"/>
        <path d="M 69 44 L 73 32 L 62 38 Z" fill="#4fd1c5" stroke="#14291c" stroke-width="2.1"/>
        <ellipse cx="50" cy="56" rx="22" ry="19" fill="#4fd1c5" stroke="#14291c" stroke-width="2.2"/>
        <ellipse cx="38" cy="63" rx="3.5" ry="2.5" fill="#0f766e"/>
        <ellipse cx="62" cy="60" rx="3" ry="2" fill="#0f766e"/>
        ${eyesSvg(status, { x: 40, y: 50 }, { x: 60, y: 50 }, { size: 4.2, color: '#991b1b', iris: '#ffffff' })}
        <path d="M 42 59 Q 50 64 58 59" stroke="#14291c" stroke-width="2" stroke-linecap="round" fill="none"/>
      `,
      squirtle: () => `
        <ellipse cx="50" cy="68" rx="21" ry="16" fill="#b45309" stroke="#1e293b" stroke-width="2.2"/>
        <ellipse cx="50" cy="70" rx="15" ry="12" fill="#fde68a"/>
        <circle cx="50" cy="45" r="18" fill="#60a5fa" stroke="#1e293b" stroke-width="2.2"/>
        ${eyesSvg(status, { x: 42, y: 43 }, { x: 58, y: 43 }, { size: 4, color: '#1e293b' })}
        <path d="M 43 52 Q 50 57 57 52" stroke="#1e293b" stroke-width="2" stroke-linecap="round" fill="none"/>
      `,
      jigglypuff: () => `
        <path d="M 32 39 L 26 20 L 43 30 Z" fill="#f9a8d4" stroke="#3b1d2e" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 68 39 L 74 20 L 57 30 Z" fill="#f9a8d4" stroke="#3b1d2e" stroke-width="2.2" stroke-linejoin="round"/>
        <circle cx="50" cy="53" r="24" fill="#fbcfe8" stroke="#3b1d2e" stroke-width="2.2"/>
        <path d="M 45 31 Q 51 22 57 30 Q 59 37 51 37 Q 45 37 46 32" fill="#fbcfe8" stroke="#3b1d2e" stroke-width="2" stroke-linecap="round"/>
        ${eyesSvg(status, { x: 39, y: 50 }, { x: 61, y: 50 }, { size: 5.2, color: '#0284c7', iris: '#ffffff' })}
        <path d="M 46 60 Q 50 63 54 60" stroke="#3b1d2e" stroke-width="1.9" stroke-linecap="round" fill="none"/>
      `,
      snorlax: () => `
        <path d="M 31 38 L 28 21 L 42 30 Z" fill="#1e3a4c" stroke="#101820" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 69 38 L 72 21 L 58 30 Z" fill="#1e3a4c" stroke="#101820" stroke-width="2.2" stroke-linejoin="round"/>
        <ellipse cx="50" cy="68" rx="25" ry="18" fill="#1e3a4c" stroke="#101820" stroke-width="2.2"/>
        <ellipse cx="50" cy="72" rx="18" ry="13" fill="#fef3c7"/>
        <ellipse cx="50" cy="46" rx="20" ry="17" fill="#1e3a4c" stroke="#101820" stroke-width="2.2"/>
        <path d="M 35 44 Q 42 36 50 41 Q 58 36 65 44 Q 67 57 50 58 Q 33 57 35 44 Z" fill="#fef3c7"/>
        <path d="M 38 46 H 45 M 55 46 H 62" stroke="#101820" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M 44 53 Q 50 55 56 53" stroke="#101820" stroke-width="1.8" stroke-linecap="round" fill="none"/>
      `,
      lucario: () => `
        <path d="M 36 37 L 28 15 L 44 29 Z" fill="#3b82f6" stroke="#172554" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M 64 37 L 72 15 L 56 29 Z" fill="#3b82f6" stroke="#172554" stroke-width="2.2" stroke-linejoin="round"/>
        <ellipse cx="50" cy="69" rx="17" ry="16" fill="#fef3c7" stroke="#172554" stroke-width="2.2"/>
        <ellipse cx="50" cy="46" rx="17" ry="16" fill="#3b82f6" stroke="#172554" stroke-width="2.2"/>
        <path d="M 35 42 L 48 45 L 50 40 L 52 45 L 65 42 L 62 50 L 38 50 Z" fill="#1e293b"/>
        ${eyesSvg(status, { x: 42, y: 45 }, { x: 58, y: 45 }, { size: 3.4, color: '#ef4444', iris: '#ffffff' })}
      `,
    };

    const draw = art[pokemonId] || art.pikachu;
    return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">${draw()}${sleepBadge}</svg>`;
  }

  root.PokeSwarmPokemon = {
    POKEMON_CATALOG,
    resolvePokemonId,
    getPokemonMeta,
    renderPokemonSvg,
  };
})(globalThis);
