import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import '@/styles/global.css'

export const metadata: Metadata = {
  title: 'Church Attendance',
  description: 'Sunday attendance tracking',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f1115',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
