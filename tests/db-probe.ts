import net from 'node:net'

/**
 * Quick TCP reachability probe for a Postgres connection string.
 *
 * Live-database test suites (see tests/seed.test.ts) skip themselves when
 * DATABASE_URL is unset — that's how CI stays green without a database. But
 * a *set-and-unreachable* DATABASE_URL (e.g. Neon down, or no outbound
 * network from a sandboxed dev environment) isn't caught by that check: the
 * first query just hangs until Vitest's per-test timeout fires, and that
 * cascades into every test in the file failing instead of skipping cleanly.
 *
 * This does a bare TCP connect to the connection string's host:port with a
 * short timeout, so callers can decide to skip in ~2s instead of failing
 * after 5s-per-test. It only proves the port accepts connections, not that
 * Postgres auth/TLS succeeds — that's an intentional tradeoff for speed;
 * the real queries in the suite still exercise the rest.
 */
export async function isDatabaseReachable(databaseUrl: string, timeoutMs = 2000): Promise<boolean> {
  let host: string
  let port: number
  try {
    const url = new URL(databaseUrl)
    host = url.hostname
    port = url.port ? Number(url.port) : 5432
  } catch {
    return false
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })

    const finish = (result: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}
