#!/usr/bin/env node
// Phase 1 dev test harness. Posts inventory.report / agent.heartbeat /
// alert.fire envelopes to FleetHub's /api/agent-ingest, signed with
// FLEETHUB_AGENT_SECRET. Mirrors the canonical bytes lib/bff-hmac.ts
// expects (sha256=<hex> over `${ts}.${rawBody}`, ±5min skew window).
//
// Usage:
//   node scripts/synthetic-agent.mjs once   --target https://fleethub.pcc2k.com  --secret <hex>
//   node scripts/synthetic-agent.mjs loop   --target ...  --secret ...     [--every 30]
//   node scripts/synthetic-agent.mjs alert  --target ...  --secret ...     [--severity warn]
//
// --target defaults to http://127.0.0.1:3011  (the local docker-compose port)
// --secret may also come from FLEETHUB_AGENT_SECRET env var.
//
// Replaces the WSS gateway for dev iteration. The Go agent (b2) will
// post to the same endpoint shape via the gateway (b3).

import { createHmac, randomUUID } from "node:crypto"
import { hostname as osHostname, platform, arch, totalmem, cpus } from "node:os"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0] ?? "once"
const target = (args.target ?? "http://127.0.0.1:3011").replace(/\/+$/, "")
const secret = args.secret ?? process.env.FLEETHUB_AGENT_SECRET
if (!secret) {
  console.error("missing --secret or FLEETHUB_AGENT_SECRET env var")
  process.exit(2)
}

const clientName = args.client ?? "Precision Computer Concepts"
const reportedHostname = args.hostname ?? osHostname()
const agentId = args.agentId ?? `dev-agent-${reportedHostname}`

if (cmd === "once") {
  await postInventory()
} else if (cmd === "loop") {
  const everySec = Number(args.every ?? 30)
  console.log(`loop: posting heartbeat every ${everySec}s, inventory.report every 5 heartbeats`)
  let i = 0
  while (true) {
    if (i % 5 === 0) await postInventory()
    else await postHeartbeat()
    i++
    await sleep(everySec * 1000)
  }
} else if (cmd === "alert") {
  const severity = args.severity ?? "warn"
  const kind = args.kind ?? "disk.high"
  const title = args.title ?? `Synthetic ${severity} alert (${kind})`
  await postAlert({ kind, severity, title })
} else {
  console.error(`unknown command: ${cmd}`)
  process.exit(2)
}

// ── senders ─────────────────────────────────────────────────────────

async function postInventory() {
  const inventory = collectInventorySnapshot()
  const env = {
    method: "inventory.report",
    agentId,
    ts: new Date().toISOString(),
    device: {
      clientName,
      hostname: reportedHostname,
      os: detectOsFamily(),
      osVersion: detectOsVersion(),
      ipAddress: detectIp(),
      role: args.role ?? "server",
    },
    inventory,
  }
  await postEnvelope(env)
}

async function postHeartbeat() {
  const env = {
    method: "agent.heartbeat",
    agentId,
    ts: new Date().toISOString(),
    device: { clientName, hostname: reportedHostname },
  }
  await postEnvelope(env)
}

async function postAlert(alert) {
  const env = {
    method: "alert.fire",
    agentId,
    ts: new Date().toISOString(),
    device: { clientName, hostname: reportedHostname },
    alert,
  }
  await postEnvelope(env)
}

async function postEnvelope(env) {
  const body = JSON.stringify(env)
  const ts = String(Date.now())
  const sig = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")
  const url = `${target}/api/agent-ingest`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pcc2k-signature": sig,
      "x-pcc2k-timestamp": ts,
      "x-pcc2k-cid": randomUUID(),
    },
    body,
  })
  const json = await res.json().catch(() => ({}))
  console.log(`${env.method} → ${res.status}`, JSON.stringify(json))
  if (!res.ok) process.exitCode = 1
}

// ── inventory collection (Linux best-effort, falls back to constants)

function collectInventorySnapshot() {
  const ramGb = Math.round(totalmem() / 1024 ** 3)
  const cpuList = cpus()
  const cpuModel = cpuList[0]?.model ?? `${arch()} cpu`
  const cpuCores = cpuList.length
  const diskInfo = readDiskInfo()
  const apps = listApps()
  return {
    hardware: {
      manufacturer: tryRead("/sys/class/dmi/id/sys_vendor") || "unknown",
      model: tryRead("/sys/class/dmi/id/product_name") || "synthetic",
      serial: tryRead("/sys/class/dmi/id/product_serial") || "SYNTH-0001",
      cpu: `${cpuModel} (${cpuCores}c)`,
      ramGb,
      diskGb: diskInfo.totalGb,
      diskFreeGb: diskInfo.freeGb,
      biosVersion: tryRead("/sys/class/dmi/id/bios_version") || "n/a",
      biosDate: tryRead("/sys/class/dmi/id/bios_date") || "1970-01-01",
      purchaseDate: "1970-01-01",
    },
    os: {
      family: detectOsFamily(),
      version: detectOsVersion(),
      build: detectKernel(),
      installedAt: detectInstallTime(),
      lastBootAt: detectBootTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    },
    patches: { lastChecked: new Date().toISOString(), pending: 0, failed: 0 },
    software: { totalInstalled: apps.length, sample: apps.slice(0, 6) },
    health: { cpu7d: 0, ramPct: ramUsagePct(), diskPct: diskInfo.usedPct },
  }
}

function detectOsFamily() {
  const p = platform()
  if (p === "win32") return "windows"
  if (p === "darwin") return "darwin"
  return "linux"
}

function detectOsVersion() {
  if (platform() === "linux") {
    const os = parseOsRelease()
    return os.PRETTY_NAME || `${os.NAME ?? "Linux"} ${os.VERSION_ID ?? ""}`.trim()
  }
  return `${platform()} ${process.version}`
}

function detectKernel() {
  return tryExec("uname -r") || ""
}

function detectInstallTime() {
  const stat = tryExec("stat -c %Y /lost+found 2>/dev/null") || tryExec("stat -c %Y /var/log/installer 2>/dev/null")
  if (stat) return new Date(Number(stat) * 1000).toISOString()
  return new Date().toISOString()
}

function detectBootTime() {
  const out = tryExec("uptime -s")
  if (out) return new Date(out).toISOString()
  return new Date(Date.now() - process.uptime() * 1000).toISOString()
}

function detectIp() {
  return tryExec("hostname -I 2>/dev/null").split(/\s+/)[0] || "127.0.0.1"
}

function readDiskInfo() {
  const out = tryExec("df --output=size,used,avail,pcent -BG / 2>/dev/null | tail -n1")
  if (!out) return { totalGb: 0, freeGb: 0, usedPct: 0 }
  const parts = out.trim().split(/\s+/)
  const totalGb = Number(parts[0]?.replace("G", "")) || 0
  const usedGb = Number(parts[1]?.replace("G", "")) || 0
  const freeGb = Number(parts[2]?.replace("G", "")) || 0
  const usedPct = Number(parts[3]?.replace("%", "")) || 0
  return { totalGb: totalGb + usedGb || totalGb, freeGb, usedPct }
}

function ramUsagePct() {
  const out = tryExec("free -m | awk '/^Mem:/{ printf \"%.0f\", ($2-$7)/$2*100 }'")
  return Number(out) || 0
}

function listApps() {
  if (platform() === "linux") {
    const dpkg = tryExec("dpkg-query -W -f='${Package} ${Version}\\n' 2>/dev/null")
    if (dpkg) return dpkg.trim().split("\n").filter(Boolean).slice(0, 500)
    const rpm = tryExec("rpm -qa 2>/dev/null")
    if (rpm) return rpm.trim().split("\n").filter(Boolean).slice(0, 500)
  }
  return ["synthetic-app v0.1"]
}

function parseOsRelease() {
  const txt = tryRead("/etc/os-release")
  if (!txt) return {}
  const out = {}
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function tryRead(p) {
  try { return readFileSync(p, "utf8").trim() } catch { return "" }
}

function tryExec(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() } catch { return "" }
}

// ── arg parser ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (!next || next.startsWith("--")) { out[key] = true } else { out[key] = next; i++ }
    } else {
      out._.push(a)
    }
  }
  return out
}
