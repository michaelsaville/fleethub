import "server-only"

// Shared upload-storage roots. PHASE-5-DESIGN §4 calls out S3 streaming
// for large artifacts; today we write to local disk under UPLOADS_DIR.
// REPORTS_DIR (lib/reports/render.ts) shares the same /tmp ephemerality
// story — Phase 5.5 swaps both to durable storage.

export const UPLOADS_DIR = process.env.UPLOADS_DIR || "/tmp/fleethub-uploads"
