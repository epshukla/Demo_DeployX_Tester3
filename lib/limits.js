// Reads the container's own resource limits from the Linux cgroup
// filesystem. DeployX applies `deploy.resources` (cpus, memory_mb, pids)
// as Docker --cpus / --memory / --pids-limit, which land here.

const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = "/sys/fs/cgroup";

/** cgroup v2 cpu.max: "50000 100000" → 0.5 cores; "max 100000" → null (unlimited). */
function parseCpuMax(text) {
  const [quota, period] = String(text).trim().split(/\s+/);
  if (!quota || quota === "max") return null;
  const q = Number(quota);
  const p = Number(period || 100000);
  if (!Number.isFinite(q) || !Number.isFinite(p) || p <= 0) return null;
  return Math.round((q / p) * 100) / 100;
}

/** "max" → null, otherwise a byte/count integer. */
function parseLimit(text) {
  const value = String(text).trim();
  if (value === "" || value === "max") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const MB = 1024 * 1024;
// cgroup v1 reports "unlimited" memory as a huge page-aligned number
const V1_UNLIMITED = 2 ** 60;

function readFile(root, name) {
  try {
    return fs.readFileSync(path.join(root, name), "utf8");
  } catch {
    return null;
  }
}

/**
 * Current limits and usage. Every field is null when it can't be read
 * (not on Linux, or no limit set).
 */
function readLimits(root = DEFAULT_ROOT) {
  const v2 = readFile(root, "cpu.max") !== null;
  if (v2) {
    const memMax = parseLimit(readFile(root, "memory.max") || "");
    const memNow = parseLimit(readFile(root, "memory.current") || "");
    return {
      cgroup: "v2",
      cpus: parseCpuMax(readFile(root, "cpu.max")),
      memory_limit_mb: memMax === null ? null : Math.round(memMax / MB),
      memory_used_mb: memNow === null ? null : Math.round((memNow / MB) * 10) / 10,
      pids_limit: parseLimit(readFile(root, "pids.max") || ""),
      pids_current: parseLimit(readFile(root, "pids.current") || ""),
    };
  }

  const quota = parseLimit(readFile(root, "cpu/cpu.cfs_quota_us") || "");
  const period = parseLimit(readFile(root, "cpu/cpu.cfs_period_us") || "");
  const memMax = parseLimit(readFile(root, "memory/memory.limit_in_bytes") || "");
  const memNow = parseLimit(readFile(root, "memory/memory.usage_in_bytes") || "");
  const known = quota !== null || memMax !== null;
  return {
    cgroup: known ? "v1" : "unavailable",
    cpus: quota !== null && quota > 0 && period ? Math.round((quota / period) * 100) / 100 : null,
    memory_limit_mb: memMax !== null && memMax < V1_UNLIMITED ? Math.round(memMax / MB) : null,
    memory_used_mb: memNow === null ? null : Math.round((memNow / MB) * 10) / 10,
    pids_limit: parseLimit(readFile(root, "pids/pids.max") || ""),
    pids_current: parseLimit(readFile(root, "pids/pids.current") || ""),
  };
}

module.exports = { readLimits, parseCpuMax, parseLimit };
