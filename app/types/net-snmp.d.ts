// Phase 12 WS-A.2 — minimal declarations for net-snmp v3.x.
// The package ships JS only. We declare just what lib/network-probe.ts
// uses; widen as more SNMP work lands in Phase 13+.

declare module "net-snmp" {
  export const Version1: number
  export const Version2c: number
  export const Version3: number

  export const SecurityLevel: {
    noAuthNoPriv: number
    authNoPriv: number
    authPriv: number
  }

  export const AuthProtocols: {
    md5: number
    sha: number
  }

  export const PrivProtocols: {
    des: number
    aes: number
  }

  export interface Varbind {
    oid: string
    type: number
    value: unknown
  }

  export interface SessionLike {
    close(): void
    get(
      oids: string[],
      callback: (error: Error | null, varbinds?: Varbind[]) => void,
    ): void
  }

  export interface SessionOptions {
    version?: number
    timeout?: number
    retries?: number
    port?: number
    transport?: string
  }

  export interface V3SessionOptions {
    name: string
    level: number
    authProtocol?: number
    authKey?: string
    privProtocol?: number
    privKey?: string
  }

  export function createSession(
    host: string,
    community: string,
    options?: SessionOptions,
  ): SessionLike

  export function createV3Session(
    host: string,
    user: V3SessionOptions,
    options?: SessionOptions,
  ): SessionLike

  const _default: {
    Version1: number
    Version2c: number
    Version3: number
    SecurityLevel: typeof SecurityLevel
    AuthProtocols: typeof AuthProtocols
    PrivProtocols: typeof PrivProtocols
    createSession: typeof createSession
    createV3Session: typeof createV3Session
  }
  export default _default
}
