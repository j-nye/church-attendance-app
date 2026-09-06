import { signOut } from '@/lib/auth'

export function SignOutButton() {
  return (
    <form
      action={async () => {
        'use server'
        await signOut({ redirectTo: '/login' })
      }}
    >
      <button
        type="submit"
        style={{
          padding: 0,
          background: 'none',
          border: 'none',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-sm)',
          cursor: 'pointer',
        }}
      >
        Sign out
      </button>
    </form>
  )
}
