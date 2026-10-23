// Local API server (the Vite dev server proxies /api to it): `npm run dev:api` + `npm run dev`
import { createServer } from 'node:http'
import { dispatch, type Req } from '../lib/http.js'
import { routes } from '../lib/routes.js'

const port = Number(process.env.PORT ?? 3000)
createServer(async (req: Req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString()
  try { req.body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : undefined } catch { req.body = undefined }
  await dispatch(routes, req, res)
}).listen(port, () => console.log(`API on http://localhost:${port}`))
