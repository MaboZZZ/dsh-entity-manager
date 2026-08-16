#!/usr/bin/env node
/**
 * LAN proxy: expose the loopback-only DSH agent GUI (127.0.0.1:3080) to the
 * local network, so other computers (e.g. a Windows PC on the same LAN) can
 * open the agent at http://<this-mac-ip>:3081/.
 *
 * ⚠️ Security: this makes the full agent (including its tools) reachable by
 * anything on the LAN. Only use on a trusted home/office network.
 *
 * Usage: node scripts/lan-proxy.mjs [listenPort] [targetPort]
 */
import { createServer, connect } from 'node:net'

const LISTEN = Number(process.argv[2] ?? 3081)
const TARGET = Number(process.argv[3] ?? 3080)

const server = createServer((client) => {
  const upstream = connect(TARGET, '127.0.0.1')
  client.pipe(upstream)
  upstream.pipe(client)
  client.on('error', () => upstream.destroy())
  upstream.on('error', () => client.destroy())
})

server.listen(LISTEN, '0.0.0.0', () => {
  console.log(`[lan-proxy] listening on 0.0.0.0:${LISTEN} -> 127.0.0.1:${TARGET}`)
  console.log(`[lan-proxy] other LAN devices: open http://<this-mac-ip>:${LISTEN}/`)
})

server.on('error', (error) => {
  console.error('[lan-proxy] failed:', error.message)
  process.exit(1)
})
