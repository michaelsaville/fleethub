// No-op shim for the "server-only" package so vitest can import
// server-only modules without choking. Production code resolves
// the real "server-only" package (which throws if imported from a
// client component); tests get this empty module instead.
export {}
