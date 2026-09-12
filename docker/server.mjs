// 零依赖静态文件服务器：仅托管 dist/，无业务后端、不访问任何在线服务。
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const port = Number(process.env.PORT ?? 4173)
const host = process.env.HOST ?? '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'

  // 防目录穿越，只允许读取 dist 内文件
  const filePath = normalize(join(root, pathname))
  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA 回退到入口
    const index = join(root, 'index.html')
    if (existsSync(index)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] })
      return createReadStream(index).pipe(res)
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('404 Not Found')
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000'
  })
  createReadStream(filePath).pipe(res)
})

server.listen(port, host, () => {
  console.log(`registration-relay-board web serving ${root} on http://${host}:${port}`)
})
