import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: "ok", app: "fleethub", phase: 0, ts: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json(
      { status: "error", app: "fleethub", error: e instanceof Error ? e.message : "db unreachable", ts: new Date().toISOString() },
      { status: 503 },
    )
  }
}
