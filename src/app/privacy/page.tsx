import type { Metadata } from 'next'
import { LegalPageLayout } from '@/components/LegalPageLayout'

export const metadata: Metadata = {
  title: 'Privacy Policy — Church Attendance',
}

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" effectiveDate="September 6, 2026">
      <p>
        This Privacy Policy explains what information the Church Attendance app (the
        &ldquo;App&rdquo;) collects, why, and how it&rsquo;s used. The App is operated by
        Manna Church for internal use by its authorized volunteers and administrators.
      </p>

      <h2>Who can use the App</h2>
      <p>
        The App is invitation-only. Access is granted by a church administrator adding
        your email address to an internal allowlist. Signing in with a Google account
        that isn&rsquo;t on that allowlist will not grant access, regardless of any
        information Google shares during sign-in.
      </p>

      <h2>Information we collect</h2>
      <p>
        When you sign in with Google, we receive your email address and use it to check
        against our allowlist and to identify you inside the App. We also store
        Google&rsquo;s stable account identifier (a &ldquo;subject&rdquo; ID) for your
        account, so that your access stays correctly linked to your allowlist entry even
        if your email address changes later. We do not store or display your name,
        profile picture, or any other Google profile information.
      </p>
      <p>
        Once signed in, the App stores the attendance counts you or other volunteers
        enter (a number per category per church service), which email address recorded
        each count, and timestamps. If a count is later deleted, we keep a record of who
        deleted it and what the value was beforehand, for accountability.
      </p>
      <p>
        When a volunteer records the speaker(s) for a service, the speaker&rsquo;s name is
        also stored, along with which email address entered it, for the same
        record-keeping purpose as attendance counts. A speaker does not need to be a user
        of the App for their name to be recorded this way.
      </p>

      <h2>Google user data &amp; Limited Use</h2>
      <p>
        The App&rsquo;s use and transfer of information received from Google APIs adheres
        to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We use your Google account only to
        verify your identity and check it against our allowlist, and only to provide the
        App&rsquo;s own features to you. We do not use it for advertising of any kind, do
        not sell or transfer it to data brokers or other third parties for their own
        purposes, do not use it to make credit or lending decisions, and do not use it to
        develop, improve, or train any AI or machine learning models, generalized or
        personalized.
      </p>

      <h2>How we protect your information</h2>
      <p>
        Access to the App is restricted to email addresses explicitly authorized on our
        allowlist — no one else can sign in, regardless of what Google account they use.
        Your data is stored on infrastructure provided by Vercel and Neon, both of which
        encrypt data in transit and at rest. Only administrators can export data or view
        the full accountability log of who recorded or deleted a count.
      </p>

      <h2>Analytics</h2>
      <p>
        The App uses Vercel Web Analytics to understand overall usage (like which pages
        are visited and how often). This is privacy-friendly, cookie-free analytics that
        does not track you individually across sites or sessions.
      </p>

      <h2>Who else sees this information</h2>
      <p>
        We don&rsquo;t sell or rent your information to anyone. It&rsquo;s shared only
        with the service providers that make the App run: Google (for sign-in), Vercel
        (application hosting), and Neon (database hosting). Within the App itself,
        administrators can see who recorded or deleted a given count, as part of the
        App&rsquo;s built-in accountability feature.
      </p>

      <h2>How long we keep it, and your deletion rights</h2>
      <p>
        Attendance records are kept indefinitely as part of the church&rsquo;s
        historical record-keeping. If your access is revoked (removed from the
        allowlist), your past entries remain associated with your email address for
        accountability purposes, but you can no longer sign in or record new data. You
        can request that we review, correct, or delete the personal information we hold
        about you (your email address and its association with past entries) at any
        time by contacting us using the details below; we&rsquo;ll respond and act on
        reasonable requests, balanced against the church&rsquo;s need to keep an accurate
        historical attendance and accountability record.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes, we&rsquo;ll update the effective date at the top of this
        page.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your data? Email{' '}
        <a href="mailto:privacy@mannachurch.app">privacy@mannachurch.app</a>.
      </p>
    </LegalPageLayout>
  )
}
