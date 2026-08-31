'use client'

import { useActionState, useEffect, useRef } from 'react'
import { addAllowlistEntryAction, type AllowlistFormState } from '@/lib/actions/allowlist'

const initialState: AllowlistFormState = { ok: true }

export function AddAllowlistForm() {
  const [state, formAction, pending] = useActionState(addAllowlistEntryAction, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}
    >
      <input name="email" type="email" placeholder="person@example.com" required style={{ padding: 'var(--space-3)' }} />
      <select name="role" required style={{ padding: 'var(--space-3)' }}>
        <option value="VOLUNTEER">Volunteer</option>
        <option value="ADMIN">Admin</option>
      </select>
      {!state.ok && state.message && (
        <p
          role="alert"
          style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}
        >
          <span aria-hidden="true">⚠</span>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending}>{pending ? 'Authorizing…' : 'Authorize'}</button>
    </form>
  )
}
