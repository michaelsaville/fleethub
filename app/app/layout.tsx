import type { Metadata } from "next"
import { SessionProvider } from "@/components/SessionProvider"
import "./globals.css"

export const metadata: Metadata = {
  title: "FleetHub",
  description: "PCC2K's homegrown RMM — per-host fleet management",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
