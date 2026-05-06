import { NextRequest, NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { UPLOADS_DIR } from "@/lib/uploads"

// Serve uploaded tenant logos. Public — anyone with the URL can fetch
// (logos are not sensitive). The PDF renderer also reads from disk
// directly via lib/pdf-image.ts at render time, but this endpoint is
// what the admin UI <img src=...> uses to preview.

export const dynamic = "force-dynamic"

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params
  // Path-traversal guard: filename only, no slashes or `..`
  if (!file || file.includes("/") || file.includes("\\") || file.includes("..")) {
    return NextResponse.json({ error: "invalid filename" }, { status: 400 })
  }
  const ext = file.split(".").pop()?.toLowerCase() ?? ""
  const contentType = TYPE_BY_EXT[ext]
  if (!contentType) {
    return NextResponse.json({ error: "unsupported type" }, { status: 400 })
  }
  try {
    const data = await readFile(join(UPLOADS_DIR, "tenant-logos", file))
    return new NextResponse(data as unknown as BodyInit, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=300",
      },
    })
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
}
