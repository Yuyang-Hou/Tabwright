import http from 'node:http'

export const DEBUGGING_FIXTURE_SCRIPT = `async function loadItems() {
  const discount = Number(document.getElementById('discount').value);
  const response = await fetch('/api/items');
  const payload = await response.json();
  const total = payload.items.reduce((sum, item) => sum + item.price, 0) - discount;
  document.getElementById('result').textContent = payload.items.length + ' items, total ' + total;
}
document.getElementById('load').addEventListener('click', loadItems);
`

/** Local, account-free fixture shared by the browser acceptance test and manual demonstrations. */
export async function createDebuggingFixture(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    if (pathname === '/api/session') {
      const authenticated =
        request.headers.cookie?.split(';').some((cookie) => {
          return cookie.trim() === 'fixture-session=fixture-only'
        }) || false
      response.writeHead(authenticated ? 200 : 401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ authenticated }))
      return
    }
    if (pathname === '/app.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' })
      response.end(DEBUGGING_FIXTURE_SCRIPT)
      return
    }
    if (pathname === '/api/items') {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Auth-Token': 'fixture-private-token',
      })
      response.end(
        JSON.stringify({
          items: [
            { id: 'book', price: 100 },
            { id: 'pen', price: 25 },
          ],
        }),
      )
      return
    }
    if (pathname === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': 'fixture-session=fixture-only; HttpOnly; SameSite=Strict; Path=/',
      })
      response.end(`<!doctype html><html><head><title>Agent debugging acceptance</title></head><body>
        <label>Discount <input id="discount" type="number" value="0"></label>
        <button id="load">Load items</button><output id="result">Not loaded</output>
        <script src="/app.js"></script></body></html>`)
      return
    }
    response.writeHead(404)
    response.end('Not found')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Debugging fixture has no TCP address')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
        server.closeAllConnections()
      })
    },
  }
}
