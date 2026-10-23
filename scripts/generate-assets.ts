// Generates the placeholder sweets (public/candy/a.svg … z.svg), the logo mark, PWA icons and iOS splash screens.
// Replace public/logo.svg and re-run `npm run assets` to rebuild the icons from your own logo.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'

const PALETTE = [
  ['#ff4f8b', '#ffe0ec'], ['#ff9f1c', '#fff0d9'], ['#ffd23f', '#fff8d6'], ['#14b8a6', '#d9f7f3'], ['#3a86ff', '#dce9ff'],
  ['#8e5cf7', '#ebe1ff'], ['#ff6b6b', '#ffe3e3'], ['#2ec27e', '#dcf7e9'], ['#f78fb3', '#ffe6ef'], ['#00b4d8', '#d8f4fb'],
] as const

const SHAPES: ((c: string, l: string) => string)[] = [
  // wrapped candy (twist ends + striped body)
  (c, l) => `<g stroke="${c}" stroke-width="8" stroke-linecap="round"><path d="M70 128 L34 100 M70 128 L30 128 M70 128 L34 156"/><path d="M186 128 L222 100 M186 128 L226 128 M186 128 L222 156"/></g><rect x="64" y="78" width="128" height="100" rx="50" fill="${c}"/><path d="M96 82 q-16 46 0 92 M160 82 q16 46 0 92" stroke="#fff" stroke-width="7" fill="none" opacity=".45"/>${letter(l, 116)}`,
  // lollipop
  (c, l) => `<rect x="120" y="150" width="16" height="80" rx="8" fill="#fff" stroke="#e4d9d0" stroke-width="3"/><circle cx="128" cy="104" r="62" fill="${c}"/><path d="M128 104 m0 -48 a48 48 0 1 1 -34 82 M128 104 m0 -28 a28 28 0 1 0 20 48" stroke="#fff" stroke-width="10" fill="none" opacity=".6" stroke-linecap="round"/>${letter(l, 92, '#fff', 0)}`,
  // gumdrop
  (c, l) => `<path d="M58 190 Q58 80 128 70 Q198 80 198 190 Z" fill="${c}"/><g fill="#fff" opacity=".55"><circle cx="100" cy="110" r="5"/><circle cx="140" cy="96" r="5"/><circle cx="160" cy="130" r="5"/><circle cx="110" cy="150" r="5"/><circle cx="148" cy="168" r="5"/></g><rect x="50" y="186" width="156" height="14" rx="7" fill="#000" opacity=".12"/>${letter(l, 172)}`,
  // peppermint disc
  (c, l) => `<circle cx="128" cy="128" r="78" fill="#fff"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<path d="M128 128 L${128 + 74 * Math.cos((k * Math.PI) / 4)} ${128 + 74 * Math.sin((k * Math.PI) / 4)} A74 74 0 0 1 ${128 + 74 * Math.cos(((k + 1) * Math.PI) / 4)} ${128 + 74 * Math.sin(((k + 1) * Math.PI) / 4)} Z" fill="${k % 2 ? 'none' : c}"/>`).join('')}<circle cx="128" cy="128" r="78" fill="none" stroke="${c}" stroke-width="6"/><circle cx="128" cy="128" r="28" fill="#fff"/>${letter(l, 116, c)}`,
  // donut
  (c, l) => `<circle cx="128" cy="132" r="78" fill="#e9a463"/><circle cx="128" cy="124" r="72" fill="${c}"/><circle cx="128" cy="124" r="30" fill="#fff"/><g stroke-width="7" stroke-linecap="round"><path d="M80 90 l12 -6" stroke="#fff"/><path d="M168 96 l10 8" stroke="#ffd23f"/><path d="M96 168 l12 6" stroke="#14b8a6"/><path d="M170 160 l-10 8" stroke="#fff"/><path d="M128 60 l0 12" stroke="#3a86ff"/></g>${letter(l, 112, c)}`,
  // heart
  (c, l) => `<path d="M128 206 C50 150 40 100 76 76 C102 60 122 76 128 92 C134 76 154 60 180 76 C216 100 206 150 128 206 Z" fill="${c}"/><ellipse cx="96" cy="94" rx="14" ry="8" fill="#fff" opacity=".45" transform="rotate(-30 96 94)"/>${letter(l, 112, '#fff')}`,
  // star
  (c, l) => `<path d="M128 40 L152 98 L214 102 L166 142 L182 204 L128 170 L74 204 L90 142 L42 102 L104 98 Z" fill="${c}" stroke="${c}" stroke-width="10" stroke-linejoin="round"/>${letter(l, 112, '#fff')}`,
  // jelly bean
  (c, l) => `<rect x="52" y="82" width="152" height="92" rx="46" fill="${c}" transform="rotate(-18 128 128)"/><ellipse cx="100" cy="102" rx="26" ry="8" fill="#fff" opacity=".5" transform="rotate(-24 100 102)"/>${letter(l, 116, '#fff', -18)}`,
  // sprinkle cookie
  (c, l) => `<circle cx="128" cy="128" r="76" fill="${c}"/><g fill="#fff" opacity=".8"><circle cx="86" cy="96" r="8"/><circle cx="160" cy="86" r="8"/><circle cx="176" cy="150" r="8"/><circle cx="92" cy="170" r="8"/><circle cx="130" cy="64" r="6"/></g><circle cx="128" cy="128" r="30" fill="#fff"/>${letter(l, 116, c)}`,
]

function letter(l: string, y = 140, fill = '#fff', rot = 0) {
  return `<text x="128" y="${y + 12}" text-anchor="middle" font-family="Nunito, ui-rounded, Arial Rounded MT Bold, Arial, sans-serif" font-weight="900" font-size="44" fill="${fill}" stroke="rgba(0,0,0,.18)" stroke-width="1.5" transform="rotate(${rot} 128 ${y})">${l}</text>`
}

mkdirSync('public/candy', { recursive: true })
mkdirSync('public/icons', { recursive: true })
mkdirSync('public/splash', { recursive: true })

'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((l, i) => {
  const [c, bg] = PALETTE[i % PALETTE.length]
  const shape = SHAPES[i % SHAPES.length]
  writeFileSync(
    `public/candy/${l.toLowerCase()}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="40" fill="${bg}"/>${shape(c, l)}</svg>`,
  )
})

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
  await sharp({ create: { width: w, height: h, channels: 4, background: '#fff5f9' } })
    .composite([{ input: await sharp(logo, { density: 300 }).resize(m, m).png().toBuffer(), gravity: 'center' }])
    .png().toFile(`public/splash/${w}x${h}.png`)
}
console.log('assets generated')
