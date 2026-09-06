import type { Metadata } from 'next'
import { LegalPageLayout } from '@/components/LegalPageLayout'

export const metadata: Metadata = {
  title: 'Terms of Service — Church Attendance',
}

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service" effectiveDate="September 6, 2026">
      <p>
        These Terms of Service govern your use of the Church Attendance app (the
        &ldquo;App&rdquo;), operated by Manna Church. By signing in, you agree to these
        terms.
      </p>

      <h2>What the App is for</h2>
      <p>
        The App is an internal tool for recording and reporting Sunday attendance
        counts across Manna Church&rsquo;s services, sections, and programs. It is not a
        public product and is not intended for use outside this purpose.
      </p>

      <h2>Who can use it</h2>
      <p>
        Access is limited to volunteers and staff explicitly authorized by a church
        administrator. You must sign in with the specific Google account your
        administrator approved. Sharing your access with someone else, or attempting to
        access the App with an account that hasn&rsquo;t been authorized, isn&rsquo;t
        allowed.
      </p>

      <h2>Your responsibilities</h2>
      <p>
        When recording attendance, enter counts accurately and in good faith. Recording
        a count attributes it to your account, and if you have administrator access and
        delete a count, that action is logged and attributed to your account as well.
      </p>

      <h2>Access can be revoked</h2>
      <p>
        Manna Church may remove your access to the App at any time, for any reason,
        without notice — for example, if you stop volunteering or if your access is no
        longer needed. Revoking access takes effect immediately.
      </p>

      <h2>No warranty</h2>
      <p>
        The App is provided &ldquo;as is,&rdquo; without warranties of any kind. We do
        our best to keep it available and accurate, but we don&rsquo;t guarantee
        uninterrupted access or that it will be error-free.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Manna Church is not liable for any
        indirect, incidental, or consequential damages arising from your use of the
        App. This is a small, internally-run tool, not a commercial product with
        service-level guarantees.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If these terms change, we&rsquo;ll update the effective date at the top of this
        page. Continued use of the App after a change means you accept the updated
        terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms? Email{' '}
        <a href="mailto:privacy@mannachurch.app">privacy@mannachurch.app</a>.
      </p>
    </LegalPageLayout>
  )
}
