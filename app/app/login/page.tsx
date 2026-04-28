"use client"

import { signIn, useSession } from "next-auth/react"
import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}

function LoginInner() {
  const { status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const error = searchParams.get("error")

  useEffect(() => {
    if (status === "authenticated") router.push("/")
  }, [status, router])

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: "24px" }}>
      <div
        style={{
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "12px",
          padding: "32px",
          width: "100%",
          maxWidth: "360px",
        }}
      >
        <div style={{ fontSize: "20px", fontWeight: 600, marginBottom: "4px" }}>FleetHub</div>
        <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "24px" }}>
          PCC2K's homegrown RMM
        </div>
        <button
          onClick={() => signIn("azure-ad", { callbackUrl: "/" })}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: "6px",
            border: "none",
            background: "var(--color-text-primary)",
            color: "var(--color-background-primary)",
            fontWeight: 500,
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          Sign in with Microsoft
        </button>
        {error && (
          <div style={{ marginTop: "16px", color: "var(--color-danger)", fontSize: "12px" }}>
            Sign-in failed: {error}. If you should have access, ask Mike to add your email to the FleetHub allowlist.
          </div>
        )}
      </div>
    </div>
  )
}
