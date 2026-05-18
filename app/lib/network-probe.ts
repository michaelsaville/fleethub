import "server-only"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import snmp from "net-snmp"
import { unsealForSystemUse } from "@/lib/credential-vault"

// Phase 12 WS-A.2 — ICMP + SNMP probing for Fl_NetworkDevice.
//
// Two probe kinds in v1:
//   - ICMP via system `ping` (works in any Linux container; no
//     native dep needed). Single packet, 2s timeout.
//   - SNMP v3 via net-snmp library. Probes sysUpTime (1.3.6.1.2.1.1.3.0)
//     as a liveness check. Authoritative engine ID + priv key
//     resolved from Fl_Credential where kind='snmp-v3'.
//
// SNMP v2c is supported as a fallback when snmpVersion='v2c' on the
// device but no v3 cred is configured. v1 is intentionally not
// supported (clear-text + outdated).

const execFileP = promisify(execFile)

export type ProbeResult = {
  ok: boolean
  rttMs: number | null
  kind: "icmp" | "snmp-get"
  errorMsg: string | null
  payload?: Record<string, unknown>
}

const ICMP_TIMEOUT_MS = 2000
const SNMP_TIMEOUT_MS = 3000

/** Single-packet ICMP echo via system `ping`. Returns the round-trip
 *  time in ms or sets `ok=false` with an error message. */
export async function probeIcmp(host: string): Promise<ProbeResult> {
  const start = Date.now()
  try {
    const { stdout } = await execFileP(
      "ping",
      ["-c", "1", "-W", "2", "-q", host],
      { timeout: ICMP_TIMEOUT_MS },
    )
    // Parse the rtt= line; portable across busybox + iputils.
    // Examples:
    //   busybox: "round-trip min/avg/max = 0.512/0.512/0.512 ms"
    //   iputils: "rtt min/avg/max/mdev = 0.512/0.512/0.512/0.000 ms"
    const m = /=\s*([0-9.]+)\/([0-9.]+)/.exec(stdout)
    const rtt = m ? Number(m[2]) : Date.now() - start
    return {
      ok: true,
      rttMs: rtt,
      kind: "icmp",
      errorMsg: null,
    }
  } catch (err) {
    return {
      ok: false,
      rttMs: null,
      kind: "icmp",
      errorMsg: err instanceof Error ? err.message : String(err),
    }
  }
}

const SYS_UPTIME_OID = "1.3.6.1.2.1.1.3.0"

interface SnmpV3CredentialShape {
  user: string
  authProtocol?: "MD5" | "SHA"
  authKey?: string
  privProtocol?: "DES" | "AES"
  privKey?: string
  level?: "noAuthNoPriv" | "authNoPriv" | "authPriv"
}

function snmpV3OptionsFromCred(plaintext: string): SnmpV3CredentialShape | null {
  try {
    const obj = JSON.parse(plaintext) as SnmpV3CredentialShape
    if (!obj || typeof obj !== "object" || typeof obj.user !== "string") return null
    return obj
  } catch {
    return null
  }
}

/** SNMP get of sysUpTime against `host`. Returns ok+rtt on success.
 *  For snmpVersion='v3', credentialId must resolve to a JSON blob
 *  with user/auth/priv fields. For 'v2c', credentialId resolves to
 *  a community-string. Both decrypt via vault. */
export async function probeSnmp(
  host: string,
  opts: {
    snmpVersion: "v2c" | "v3"
    credentialId: string
  },
): Promise<ProbeResult> {
  const start = Date.now()
  let plaintext: string
  try {
    const result = await unsealForSystemUse({
      credentialId: opts.credentialId,
      context: "system:network-probe",
    })
    plaintext = result.plaintext
  } catch (err) {
    return {
      ok: false,
      rttMs: null,
      kind: "snmp-get",
      errorMsg: `vault unseal failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return new Promise<ProbeResult>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        session.close()
      } catch {
        // ignore close errors
      }
      resolve({
        ok: false,
        rttMs: null,
        kind: "snmp-get",
        errorMsg: "SNMP timeout",
      })
    }, SNMP_TIMEOUT_MS)
    type SnmpSession = {
      close(): void
      get(oids: string[], cb: (error: Error | null, varbinds?: unknown) => void): void
    }
    let session: SnmpSession
    try {
      if (opts.snmpVersion === "v3") {
        const v3 = snmpV3OptionsFromCred(plaintext)
        if (!v3) {
          clearTimeout(timer)
          settled = true
          resolve({
            ok: false,
            rttMs: null,
            kind: "snmp-get",
            errorMsg: "invalid v3 credential JSON",
          })
          return
        }
        session = snmp.createV3Session(host, {
          name: v3.user,
          level: snmp.SecurityLevel[v3.level ?? "authPriv"],
          authProtocol: v3.authProtocol === "SHA" ? snmp.AuthProtocols.sha : snmp.AuthProtocols.md5,
          authKey: v3.authKey ?? "",
          privProtocol: v3.privProtocol === "AES" ? snmp.PrivProtocols.aes : snmp.PrivProtocols.des,
          privKey: v3.privKey ?? "",
        }) as SnmpSession
      } else {
        // v2c: plaintext IS the community string.
        session = snmp.createSession(host, plaintext.trim(), {
          version: snmp.Version2c,
        }) as SnmpSession
      }
    } catch (err) {
      clearTimeout(timer)
      settled = true
      resolve({
        ok: false,
        rttMs: null,
        kind: "snmp-get",
        errorMsg: `session create failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return
    }
    session.get([SYS_UPTIME_OID], (error, varbinds) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        session.close()
      } catch {
        /* ignore */
      }
      const rtt = Date.now() - start
      if (error) {
        resolve({
          ok: false,
          rttMs: null,
          kind: "snmp-get",
          errorMsg: error instanceof Error ? error.message : String(error),
        })
        return
      }
      resolve({
        ok: true,
        rttMs: rtt,
        kind: "snmp-get",
        errorMsg: null,
        payload: { sysUpTime: JSON.stringify(varbinds) },
      })
    })
  })
}

/** Pretty error class for probe-not-configured cases — callers
 *  surface this to the operator as a config issue, not a runtime
 *  failure. */
export class ProbeConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProbeConfigError"
  }
}
