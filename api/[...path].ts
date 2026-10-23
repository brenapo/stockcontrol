import { dispatch, type Req, type Res } from '../lib/http.js'
import { routes } from '../lib/routes.js'

export default function handler(req: Req, res: Res) {
  return dispatch(routes, req, res)
}
