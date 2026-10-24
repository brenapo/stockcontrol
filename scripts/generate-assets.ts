// Generates the placeholder sweets (public/candy/a.svg … z.svg), the logo mark, PWA icons and iOS splash screens.
// Replace public/logo.svg and re-run `npm run assets` to rebuild the icons from your own logo.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'

// One flat, friendly illustration per menu item (same style: pastel tile, simple shapes, soft highlights).
const SWEETS: Record<string, { bg: string; art: string }> = {
  cannoli: {
    bg: '#fff3dc',
    art: `<g transform="rotate(-28 128 132)">
      <rect x="34" y="104" width="188" height="58" rx="29" fill="#e2a15a"/>
      <path d="M62 108 q16 26 0 50 M92 106 q16 28 0 54 M122 106 q16 28 0 54 M152 106 q16 28 0 54 M182 108 q16 26 0 50" stroke="#c98338" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>
      <rect x="44" y="110" width="170" height="12" rx="6" fill="#fff" opacity=".28"/>
      <ellipse cx="38" cy="133" rx="15" ry="27" fill="#fffaf0"/><ellipse cx="218" cy="133" rx="15" ry="27" fill="#fffaf0"/>
      <g fill="#7bc96f"><circle cx="34" cy="122" r="5"/><circle cx="41" cy="140" r="5"/><circle cx="216" cy="124" r="5"/><circle cx="222" cy="142" r="5"/></g>
      <g fill="#5b3322"><circle cx="40" cy="132" r="3.5"/><circle cx="214" cy="133" r="3.5"/></g>
    </g>
    <g fill="#fff" opacity=".9"><circle cx="86" cy="64" r="4"/><circle cx="118" cy="52" r="3"/><circle cx="168" cy="204" r="4"/><circle cx="196" cy="214" r="3"/></g>`,
  },
  kitkat: {
    bg: '#ffe3e6',
    art: `<g transform="rotate(-14 128 128)">
      <rect x="70" y="56" width="52" height="92" rx="9" fill="#6b3a22"/><rect x="132" y="56" width="52" height="92" rx="9" fill="#6b3a22"/>
      <rect x="78" y="62" width="10" height="70" rx="5" fill="#fff" opacity=".22"/><rect x="140" y="62" width="10" height="70" rx="5" fill="#fff" opacity=".22"/>
      <rect x="36" y="112" width="184" height="92" rx="14" fill="#e11d34"/>
      <path d="M36 112 l-12 -6 v28 l12 -6 M36 160 l-12 -6 v28 l12 -6 M220 112 l12 -6 v28 l-12 -6 M220 160 l12 -6 v28 l-12 -6" fill="#e11d34"/>
      <rect x="36" y="128" width="184" height="60" fill="#fff" opacity=".95"/>
      <rect x="36" y="140" width="184" height="36" fill="#e11d34"/>
      <rect x="46" y="120" width="60" height="6" rx="3" fill="#fff" opacity=".4"/>
    </g>`,
  },
  eclair: {
    bg: '#efe4ff',
    art: `<g transform="rotate(-12 128 130)">
      <rect x="30" y="108" width="196" height="64" rx="32" fill="#eeb472"/>
      <rect x="40" y="132" width="176" height="10" rx="5" fill="#fff6e8"/>
      <path d="M34 128 Q34 92 72 90 L184 90 Q224 92 222 128 Q214 142 198 130 Q184 146 168 130 Q152 148 136 130 Q120 146 104 130 Q88 146 72 130 Q56 142 34 128 Z" fill="#5b3322"/>
      <path d="M62 102 q60 -10 120 0" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none" opacity=".35"/>
      <g stroke-linecap="round" stroke-width="5"><path d="M92 112 l8 -3" stroke="#ff7ab0"/><path d="M130 108 l8 3" stroke="#ffd23f"/><path d="M166 114 l8 -3" stroke="#fff"/></g>
    </g>`,
  },
  macaron: {
    bg: '#ffe6f1',
    art: `<ellipse cx="128" cy="176" rx="76" ry="22" fill="#ff7fae"/>
      <ellipse cx="128" cy="170" rx="82" ry="12" fill="#ffb3cf"/>
      <rect x="52" y="140" width="152" height="26" rx="13" fill="#fffaf5"/>
      <g fill="#ff7fae"><rect x="58" y="162" width="140" height="12" rx="6"/></g>
      <path d="M48 138 Q48 76 128 76 Q208 76 208 138 Q208 150 190 150 L66 150 Q48 150 48 138 Z" fill="#ff8fb8"/>
      <ellipse cx="96" cy="100" rx="26" ry="10" fill="#fff" opacity=".45" transform="rotate(-18 96 100)"/>
      <rect x="52" y="146" width="152" height="10" rx="5" fill="#ffd0e1"/>`,
  },
  xocolat: {
    bg: '#f6e8dd',
    art: `<g transform="rotate(-16 128 128)">
      <rect x="50" y="62" width="160" height="124" rx="14" fill="#5b3322"/>
      ${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${60 + c * 49}" y="${72 + r * 38}" width="42" height="30" rx="7" fill="#7a4a2f"/><rect x="${64 + c * 49}" y="${75 + r * 38}" width="20" height="6" rx="3" fill="#fff" opacity=".22"/>`).join('')).join('')}
      <path d="M50 150 L210 130 L210 206 Q210 216 198 216 L62 216 Q50 216 50 204 Z" fill="#f3c64b"/>
      <path d="M50 150 L210 130 L210 144 L50 164 Z" fill="#ffe08a"/>
      <path d="M92 188 q36 -16 72 0" stroke="#c9962a" stroke-width="6" stroke-linecap="round" fill="none"/>
    </g>
    <g fill="#5b3322"><ellipse cx="206" cy="58" rx="9" ry="6" transform="rotate(30 206 58)"/><ellipse cx="52" cy="206" rx="9" ry="6" transform="rotate(-30 52 206)"/></g>`,
  },
  amorade: {
    bg: '#ffe8ee',
    art: `<path d="M128 208 C42 148 36 92 76 68 C102 54 124 70 128 88 C132 70 154 54 180 68 C220 92 214 148 128 208 Z" fill="#ff4f6e"/>
      <path d="M128 208 C42 148 36 92 76 68 C102 54 124 70 128 88 Z" fill="#ff6f88" opacity=".6"/>
      <ellipse cx="92" cy="92" rx="16" ry="9" fill="#fff" opacity=".55" transform="rotate(-32 92 92)"/>
      <g transform="translate(128 132)"><path d="M0 0 L-34 -20 Q-44 -2 -34 16 Z M0 0 L34 -20 Q44 -2 34 16 Z" fill="#ffd23f"/><circle r="9" fill="#f5b400"/></g>
      <g fill="#fff"><path d="M200 52 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" opacity=".95"/><circle cx="56" cy="176" r="5" opacity=".9"/></g>`,
  },
  other: {
    bg: '#e6efff',
    art: `<rect x="52" y="104" width="152" height="98" rx="14" fill="#3a86ff"/>
      <rect x="44" y="82" width="168" height="36" rx="12" fill="#5b9bff"/>
      <rect x="116" y="82" width="24" height="120" fill="#ffd23f"/>
      <path d="M128 82 C104 38 62 56 86 82 Z M128 82 C152 38 194 56 170 82 Z" fill="#ffd23f"/>
      <ellipse cx="86" cy="96" rx="22" ry="5" fill="#fff" opacity=".35"/>
      <text x="128" y="176" text-anchor="middle" font-family="Nunito, ui-rounded, Arial Rounded MT Bold, Arial, sans-serif" font-weight="900" font-size="52" fill="#fff" stroke="rgba(0,0,0,.18)" stroke-width="1.5">?</text>`,
  },
}

mkdirSync('public/candy', { recursive: true })
mkdirSync('public/icons', { recursive: true })
mkdirSync('public/splash', { recursive: true })

for (const [key, { bg, art }] of Object.entries(SWEETS)) {
  writeFileSync(`public/candy/${key}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="40" fill="${bg}"/>${art}</svg>`)
}

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ab0"/><stop offset="1" stop-color="#ff4f8b"/></linearGradient></defs>
<rect width="256" height="256" rx="56" fill="url(#g)"/>
<rect x="118" y="132" width="20" height="96" rx="10" fill="#fff"/>
<circle cx="128" cy="100" r="64" fill="#fff"/>
<circle cx="128" cy="100" r="52" fill="#ffd23f"/>
<path d="M128 100 m0 -40 a40 40 0 1 1 -30 66 M128 100 m0 -22 a22 22 0 1 0 16 38" stroke="#ff4f8b" stroke-width="12" fill="none" stroke-linecap="round"/>
<circle cx="196" cy="48" r="7" fill="#3a86ff"/><circle cx="62" cy="168" r="6" fill="#14b8a6"/><circle cx="208" cy="188" r="6" fill="#8e5cf7"/>
</svg>`
if (!existsSync('public/logo.svg')) writeFileSync('public/logo.svg', MARK)
const logo = readFileSync('public/logo.svg')

const png = (svg: Buffer | string, size: number, file: string) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(file)
await png(logo, 192, 'public/icons/icon-192.png')
await png(logo, 512, 'public/icons/icon-512.png')
await png(logo, 180, 'public/icons/apple-touch-icon.png')
await png(logo, 96, 'public/icons/badge-96.png')

// maskable: full-bleed background, logo scaled into the safe zone
const bleed = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#ff4f8b' } })
  .composite([{ input: await sharp(logo, { density: 300 }).resize(360, 360).png().toBuffer(), gravity: 'center' }])
  .png().toBuffer()
writeFileSync('public/icons/maskable-512.png', bleed)

// iOS splash screens (portrait) for common iPhone sizes
const splashes: [number, number, number][] = [
  [1290, 2796, 3], [1179, 2556, 3], [1284, 2778, 3], [1170, 2532, 3], [1125, 2436, 3], [828, 1792, 2], [750, 1334, 2],
]
for (const [w, h] of splashes) {
  const m = Math.round(w * 0.32)
  await sharp({ create: { width: w, height: h, channels: 4, background: '#ffffff' } })
    .composite([{ input: await sharp(logo, { density: 300 }).resize(m, m).png().toBuffer(), gravity: 'center' }])
    .png().toFile(`public/splash/${w}x${h}.png`)
}
console.log('assets generated')
