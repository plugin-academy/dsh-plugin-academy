import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

export async function startCatalogServer(port = 0) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    const catalog = catalogDocument()
    response.setHeader('Content-Type', 'application/json')
    if (path === '/catalog.json') {
      response.end(JSON.stringify(catalog))
    } else if (path === '/empty.json') {
      response.end('{"format":1,"sources":[]}')
    } else if (path === '/error.json') {
      response.writeHead(503).end('{"error":"Test catalog unavailable"}')
    } else if (path === '/redirect.json') {
      response.writeHead(302, { Location: '/catalog.json' }).end()
    } else if (path === '/invalid.json') {
      response.end('{"format":1,"sources":[{"title":"Invalid"}]}')
    } else if (path === '/malformed.json') {
      response.end('{')
    } else if (path === '/utf8.json') {
      response.end(Buffer.from([0xc3, 0x28]))
    } else if (path === '/slow.json') {
      response.write('{"format":1,')
      const timer = setTimeout(() => response.end('"sources":[]}'), 1000)
      response.on('close', () => clearTimeout(timer))
    } else if (path === '/chunked.json') {
      const body = JSON.stringify(catalog)
      response.write(body.slice(0, 64))
      response.end(body.slice(64))
    } else if (path === '/tools/index.json' || path === '/community/index.json') {
      const source = catalog.sources.find(source => source.url.endsWith(path))
      response.end(JSON.stringify({
        format: 1,
        title: source.title,
        plugins: source.topPlugins.map(plugin => ({
          name: plugin.name, title: plugin.title, description: plugin.description,
          author: source.publisher.name,
          versions: [{ version: '1.0.0', publishTimestamp: 1794787200, source: { type: 'npm' } }],
        })),
      }))
    } else {
      response.writeHead(404).end('{"error":"Not found"}')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const url = `http://127.0.0.1:${server.address().port}`
  function catalogDocument() {
    return {
      format: 1,
      sources: [
        {
          url: `${url}/tools/index.json`,
          title: 'Team Tools',
          description: 'Developer tools from the Team Labs publisher.',
          publisher: { name: 'Team Labs', url: 'https://publisher.example.org/team' },
          pluginCount: 1,
          topPlugins: [{
            name: '@example/dsh-tools', title: 'Workspace Tools',
            description: 'Inspect a workspace with focused tools.', version: '1.0.0',
          }],
          tags: ['development', 'tools'],
          updatedAt: '2026-11-16T00:00:00Z',
        },
        {
          url: `${url}/community/index.json`,
          title: 'Community Integrations',
          description: 'Connections contributed by the community.',
          publisher: { name: 'Community Publishers' },
          pluginCount: 1,
          topPlugins: [{
            name: '@example/dsh-integrations', title: 'Service Connector',
            description: 'Connect an external service.', version: '1.0.0',
          }],
          tags: ['integrations'],
        },
      ],
    }
  }
  return {
    server,
    url,
    catalog: catalogDocument,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await startCatalogServer(Number(process.argv[2] ?? 0))
  console.log(JSON.stringify({ url: fixture.url, catalogUrl: `${fixture.url}/catalog.json` }))
  process.once('SIGTERM', async () => { await fixture.close() })
  process.once('SIGINT', async () => { await fixture.close() })
}
