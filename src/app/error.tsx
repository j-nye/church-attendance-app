'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'

/**
 * App-wide fallback for genuinely unexpected errors — anything that isn't an
 * AuthzError (those are redirected to /denied server-side in src/lib/authz.ts
 * before this ever mounts; see requireUserPage()/requireAdminPage()).
 *
 * Deliberately does NOT read error.message or check `error instanceof
 * AnythingSpecific`: in production, Next.js masks the message of any error
 * thrown in a Server Component or Server Action, forwarding only a generic
 * placeholder plus `error.digest` (see the "error.message" section of
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 * A design that branches on the message or type would work in `next dev` and
 * silently stop working the moment this ships.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // The digest (if present) matches this instance to the server-side log
    // entry that has the real, unmasked error.
    console.error('Unhandled error', error.digest ? `(digest: ${error.digest})` : '', error)
  }, [error])

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 'var(--space-4)' }}>
      <div className="card" style={{ textAlign: 'center', maxWidth: '26rem' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', marginTop: 0 }}>Something went wrong</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          An unexpected error occurred. Nothing you had entered elsewhere on this page was lost —
          try again, and if it keeps happening, let a church administrator know.
        </p>
        <button
          onClick={() => retry()}
          style={{
            padding: '0 var(--space-4)', height: 'var(--tap-target)',
            background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', fontWeight: 700,
          }}
        >
          Try again
        </button>
      </div>
    </main>
  )
}
