// Built-in product illustrations (SVG) so every item has a picture even
// before a real photo is uploaded. Chosen from the SKU / category.

const WOOD = { WAL: '#5b3a29', MAP: '#e2c596', CHR: '#9c4a2f', OAK: '#c39462', PIN: '#e9c98e' }
const GRAIN = { WAL: '#47291c', MAP: '#cfae78', CHR: '#7e3822', OAK: '#a87b4d', PIN: '#d4ae6e' }
const BG = {
  'Cutting Boards': '#f3ece2', 'Serving Boards': '#f4e9e3', 'Home Goods': '#eef0ea', 'Care Products': '#f5f1e1',
  'Gift Sets': '#f2ece4', 'Kitchen Tools': '#eceff2', Lumber: '#f1ebe1', Finishes: '#f3f0e6', Hardware: '#eceeef',
  Packaging: '#f2eee6', Abrasives: '#f1efe9',
}

const species = (sku = '') => (sku.match(/WAL|MAP|CHR|OAK|PIN/) || ['MAP'])[0]
const grain = (x, y, w, h, c, n = 5) => Array.from({ length: n }, (_, i) => {
  const yy = y + ((i + 1) * h) / (n + 1)
  return `<path d="M${x + 6} ${yy} C ${x + w * 0.3} ${yy - 4}, ${x + w * 0.6} ${yy + 4}, ${x + w - 6} ${yy - 1}" stroke="${c}" stroke-width="1.6" fill="none" opacity=".55"/>`
}).join('')
const shadow = (cx, cy, rx) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="6" fill="#000" opacity=".08"/>`

function board(sku, withHandle) {
  const s = species(sku), w = WOOD[s], g = GRAIN[s]
  return `${shadow(100, 122, 72)}
  <rect x="30" y="34" width="${withHandle ? 118 : 140}" height="80" rx="12" fill="${w}"/>
  ${withHandle ? `<rect x="144" y="62" width="34" height="24" rx="10" fill="${w}"/><circle cx="168" cy="74" r="5" fill="#f3ece2"/><rect x="150" y="68" width="14" height="12" rx="3" fill="#c9a43a"/>` : ''}
  ${grain(30, 34, withHandle ? 118 : 140, 80, g, 6)}
  ${withHandle ? '' : `<rect x="40" y="44" width="120" height="60" rx="8" fill="none" stroke="${g}" stroke-width="2.5" opacity=".7"/>`}`
}

function art(item) {
  const sku = item?.sku || ''
  const cat = item?.category || ''
  if (sku.startsWith('TTC-CB')) return board(sku, false)
  if (sku.startsWith('TTC-CHB')) return board('CHR', true)
  if (sku.startsWith('TTC-SHF')) return `${shadow(100, 118, 70)}<rect x="20" y="20" width="160" height="96" rx="6" fill="#e6e2da"/>
    <rect x="28" y="58" width="144" height="16" rx="3" fill="${WOOD.OAK}"/>${grain(28, 58, 144, 16, GRAIN.OAK, 2)}
    <path d="M52 74 v20 h18" stroke="#2b2b2b" stroke-width="5" fill="none"/><path d="M148 74 v20 h-18" stroke="#2b2b2b" stroke-width="5" fill="none"/>
    <rect x="54" y="36" width="14" height="22" rx="2" fill="#7a8b6f"/><circle cx="130" cy="48" r="9" fill="#b85c38"/>`
  if (sku.startsWith('TTC-STL')) return `${shadow(100, 126, 60)}
    <rect x="50" y="88" width="100" height="12" rx="3" fill="${WOOD.PIN}"/><rect x="70" y="56" width="80" height="12" rx="3" fill="${WOOD.PIN}"/>
    <path d="M56 100 l-6 24 M144 100 l6 24 M76 68 v20 M144 68 v20" stroke="${GRAIN.PIN}" stroke-width="8" stroke-linecap="round"/>
    ${grain(50, 88, 100, 12, GRAIN.PIN, 1)}${grain(70, 56, 80, 12, GRAIN.PIN, 1)}`
  if (sku.startsWith('TTC-BB') || sku === 'PK-TIN-4OZ') return `${shadow(100, 120, 46)}
    <ellipse cx="100" cy="92" rx="46" ry="22" fill="#9aa1a8"/><rect x="54" y="66" width="92" height="26" fill="#b8bec4"/>
    <ellipse cx="100" cy="66" rx="46" ry="22" fill="#d6dade"/><ellipse cx="100" cy="66" rx="30" ry="14" fill="${sku.startsWith('TTC') ? '#5f422a' : '#c3c8cd'}"/>
    ${sku.startsWith('TTC') ? '<text x="100" y="64" font-size="6.5" text-anchor="middle" fill="#f6f3ee" font-family="sans-serif" font-weight="700">BOARD</text><text x="100" y="72" font-size="6.5" text-anchor="middle" fill="#f6f3ee" font-family="sans-serif" font-weight="700">BUTTER</text>' : ''}`
  if (sku.startsWith('TTC-GS') || sku === 'PK-BOX-LG') return `${shadow(100, 124, 66)}
    <rect x="40" y="50" width="120" height="70" rx="4" fill="#c49a6c"/><rect x="34" y="40" width="132" height="20" rx="3" fill="#b5895a"/>
    <rect x="94" y="40" width="12" height="80" fill="#8b6b43" opacity=".55"/>
    ${sku.startsWith('TTC') ? '<path d="M100 40 c-18 -22 -34 -4 -14 0 M100 40 c18 -22 34 -4 14 0" stroke="#7a5c3a" stroke-width="4" fill="none"/>' : ''}
    <rect x="118" y="78" width="30" height="16" rx="2" fill="#f6f3ee"/><text x="133" y="89" font-size="6" text-anchor="middle" fill="#5f422a" font-family="sans-serif">TIMBER</text>`
  if (sku.startsWith('TTC-CST')) return `${shadow(100, 122, 64)}
    ${[[62, 78], [100, 70], [138, 78], [100, 96]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="26" fill="${WOOD.WAL}"/><circle cx="${x}" cy="${y}" r="20" fill="none" stroke="${GRAIN.WAL}" stroke-width="2"/>`).join('')}`
  if (sku === 'TTC-R-SCRP') return `${shadow(100, 120, 60)}<rect x="50" y="46" width="100" height="56" rx="4" fill="#c9ced3"/><rect x="50" y="46" width="100" height="10" fill="#e3e7ea"/>
    <rect x="44" y="30" width="112" height="22" rx="8" fill="${WOOD.WAL}"/>${grain(44, 30, 112, 22, GRAIN.WAL, 2)}`
  if (sku === 'TTC-R-SHRP') return `${shadow(100, 122, 62)}<rect x="40" y="70" width="120" height="44" rx="12" fill="#2f3439"/>
    <path d="M86 70 l7 -28 h14 l7 28" fill="#3d444b"/><path d="M93 50 l7 18 l7 -18" stroke="#c9ced3" stroke-width="3" fill="none"/><rect x="120" y="84" width="28" height="10" rx="5" fill="#c0392b"/>`
  if (cat === 'Lumber') {
    const s = species(sku)
    return `${shadow(100, 124, 74)}${[0, 1, 2].map((i) => `<rect x="${26 + i * 4}" y="${94 - i * 22}" width="148" height="20" rx="2" fill="${WOOD[s]}" stroke="${GRAIN[s]}"/>${grain(26 + i * 4, 94 - i * 22, 148, 20, GRAIN[s], 2)}`).join('')}`
  }
  if (sku === 'RM-OIL-16' || sku === 'RM-GLUE-16') return `${shadow(100, 124, 30)}
    <rect x="78" y="46" width="44" height="76" rx="10" fill="${sku === 'RM-OIL-16' ? '#eaf3f6' : '#f3efe2'}" stroke="#b9c3c8"/><rect x="90" y="30" width="20" height="18" rx="3" fill="${sku === 'RM-OIL-16' ? '#2f7a55' : '#c8a13a'}"/>
    <rect x="82" y="70" width="36" height="26" fill="#fff"/><text x="100" y="86" font-size="7" text-anchor="middle" fill="#333" font-family="sans-serif">${sku === 'RM-OIL-16' ? 'OIL' : 'GLUE'}</text>`
  if (sku === 'RM-WAX-1LB') return `${shadow(100, 120, 50)}<path d="M54 70 l46 -22 l46 22 v34 l-46 18 l-46 -18z" fill="#e3b23c"/><path d="M54 70 l46 18 l46 -18" stroke="#c9952a" stroke-width="2" fill="none"/><path d="M100 88 v34" stroke="#c9952a" stroke-width="2"/>`
  if (sku === 'RM-POLY-QT') return `${shadow(100, 124, 40)}<rect x="62" y="44" width="76" height="76" rx="6" fill="#9aa1a8"/><rect x="62" y="40" width="76" height="10" rx="4" fill="#b8bec4"/><rect x="68" y="64" width="64" height="34" fill="#1f5c8a"/><text x="100" y="85" font-size="9" text-anchor="middle" fill="#fff" font-family="sans-serif">POLY</text>`
  if (sku === 'RM-SAND-DSC') return `${shadow(100, 122, 50)}<circle cx="100" cy="78" r="44" fill="#c96f3b"/>${[0, 60, 120, 180, 240, 300].map((a) => `<circle cx="${100 + 26 * Math.cos(a * Math.PI / 180)}" cy="${78 + 26 * Math.sin(a * Math.PI / 180)}" r="4" fill="#8a4a24"/>`).join('')}<circle cx="100" cy="78" r="5" fill="#8a4a24"/>`
  if (sku === 'PK-TWINE-YD') return `${shadow(100, 122, 46)}<ellipse cx="100" cy="80" rx="44" ry="36" fill="#c9a66b"/>${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="100" cy="80" rx="${40 - i * 7}" ry="${32 - i * 6}" fill="none" stroke="#a88650" stroke-width="2"/>`).join('')}`
  if (sku === 'PK-LABEL') return `${shadow(100, 120, 50)}<rect x="52" y="44" width="96" height="66" rx="10" fill="#f6f3ee" stroke="#d8cbb7"/><circle cx="100" cy="66" r="12" fill="#5f422a"/><path d="M100 57 l-8 13 h16z" fill="#f6f3ee"/><text x="100" y="98" font-size="9" text-anchor="middle" fill="#5f422a" font-family="sans-serif" font-weight="700">TIMPANOGOS</text>`
  if (sku === 'PK-CORK-4') return `${shadow(100, 120, 56)}${[[74, 74], [126, 74], [100, 92]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="26" fill="#c79a63"/><circle cx="${x}" cy="${y}" r="26" fill="none" stroke="#a87d48" stroke-dasharray="2 3"/>`).join('')}`
  if (sku === 'RM-FELT-8') return `${shadow(100, 120, 56)}<rect x="44" y="44" width="112" height="70" rx="6" fill="#fff" stroke="#ddd"/>${[0, 1, 2, 3].flatMap((c) => [0, 1].map((r) => `<circle cx="${64 + c * 24}" cy="${64 + r * 30}" r="9" fill="#8a8f96"/>`)).join('')}`
  if (sku === 'RM-DOWEL-50') return `${shadow(100, 122, 56)}${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${52 + i * 6}" y="${40 + i * 12}" width="90" height="9" rx="4" fill="${WOOD.MAP}" stroke="${GRAIN.MAP}" transform="rotate(-8 100 80)"/>`).join('')}`
  if (sku === 'RM-BRKT-PR') return `${shadow(100, 122, 56)}<path d="M60 40 v60 h40" stroke="#2b2b2b" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M118 40 v60 h40" stroke="#2b2b2b" stroke-width="12" fill="none" stroke-linecap="round"/>`
  if (sku === 'RM-HNDL-BR') return `${shadow(100, 118, 60)}<path d="M50 96 v-20 q0 -22 22 -22 h56 q22 0 22 22 v20" stroke="#c9a43a" stroke-width="12" fill="none" stroke-linecap="round"/>`
  if (sku === 'RM-FEET-4') return `${shadow(100, 120, 60)}${[60, 88, 116, 144].map((x) => `<ellipse cx="${x}" cy="88" rx="12" ry="6" fill="#222"/><rect x="${x - 12}" y="70" width="24" height="18" fill="#2f2f2f"/><ellipse cx="${x}" cy="70" rx="12" ry="6" fill="#444"/>`).join('')}`
  // screws, keyhole hangers, misc hardware
  return `${shadow(100, 120, 56)}${[0, 1, 2].map((i) => `<g transform="translate(${62 + i * 30} 40) rotate(12)"><circle cx="0" cy="0" r="9" fill="#9aa1a8"/><path d="M-5 0 h10 M0 -5 v10" stroke="#555" stroke-width="2"/><path d="M-3 8 l3 60 l3 -60z" fill="#b8bec4"/></g>`).join('')}`
}

const cache = new Map()
export function productArt(item) {
  const key = `${item?.sku}|${item?.category}`
  if (!cache.has(key)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect width="200" height="150" fill="${BG[item?.category] || '#f1efe9'}"/>${art(item)}</svg>`
    cache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  }
  return cache.get(key)
}

export const productImage = (item) => item?.image_url || productArt(item)
