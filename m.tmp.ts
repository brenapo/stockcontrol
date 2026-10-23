import sharp from 'sharp'
const S = process.argv[2]
const names = process.argv.slice(3)
const imgs = await Promise.all(names.map((n) => sharp(`${S}/${n}.png`).resize({ height: 900 }).toBuffer({ resolveWithObject: true })))
let x = 0
const comp = imgs.map((i) => { const c = { input: i.data, left: x, top: 0 }; x += i.info.width + 10; return c })
await sharp({ create: { width: x, height: 900, channels: 4, background: '#888' } }).composite(comp).png().toFile(`${S}/m-${names.join('_').slice(0,20)}.png`)
console.log(`${S}/m-${names.join('_').slice(0,20)}.png`)
