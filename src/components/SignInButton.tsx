import { signIn } from '@/lib/auth'

export function SignInButton() {
  return (
    <form
      action={async () => {
        'use server'
        await signIn('google', { redirectTo: '/dashboard' })
      }}
    >
      <button type="submit" style={{ padding: '0.75rem 1.5rem', fontSize: 'var(--text-lg)' }}>
        Sign in with Google
      </button>
    </form>
  )
}
