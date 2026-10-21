// Contract tests for Tester3 — no external dependencies.
// Validates DeployX contracts, HTML serving and the storage features.

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseCpuMax, parseLimit, readLimits } = require("./lib/limits");
const { createVolumeStore } = require("./lib/volume-store");

// Isolated volume + fake cgroup v2 limits (0.5 CPU, 256 MB, 128 pids)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tester3-"));
const DATA_DIR = path.join(TMP, "data");
const CGROUP_ROOT = path.join(TMP, "cgroup");
fs.mkdirSync(CGROUP_ROOT);
fs.writeFileSync(path.join(CGROUP_ROOT, "cpu.max"), "50000 100000\n");
fs.writeFileSync(path.join(CGROUP_ROOT, "memory.max"), String(256 * 1024 * 1024));
fs.writeFileSync(path.join(CGROUP_ROOT, "memory.current"), String(40 * 1024 * 1024));
fs.writeFileSync(path.join(CGROUP_ROOT, "pids.max"), "128\n");
fs.writeFileSync(path.join(CGROUP_ROOT, "pids.current"), "11\n");

const PORT = 4998;
let serverRef;

function fetchRaw(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${PORT}${path}`, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
          })
        );
      })
      .on("error", reject);
  });
}

function postJSON(urlPath, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      { host: "localhost", port: PORT, path: urlPath, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

function fetchJSON(path) {
  return fetchRaw(path).then(function (res) {
    return {
      status: res.status,
      headers: res.headers,
      body: JSON.parse(res.body),
    };
  });
}

async function runTests() {
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = DATA_DIR;
  process.env.CGROUP_ROOT = CGROUP_ROOT;
  process.env.DOCUMENT_PATHS = "welcome.txt, ../etc/passwd, guides/setup.pdf, bad path";
  const { server } = require("./server");
  serverRef = server;

  let passed = 0;
  let failed = 0;

  function assert(name, condition) {
    if (condition) {
      console.log("  PASS: " + name);
      passed++;
    } else {
      console.error("  FAIL: " + name);
      failed++;
    }
  }

  console.log("\nDeployX Demo Website — Contract Tests\n");

  // Test 1: Health endpoint
  const health = await fetchJSON("/health");
  assert("GET /health returns 200", health.status === 200);
  assert(
    'GET /health returns { status: "healthy" }',
    health.body.status === "healthy"
  );

  // Test 2: Root serves HTML (not JSON)
  const root = await fetchRaw("/");
  assert("GET / returns 200", root.status === 200);
  assert(
    "GET / content-type is HTML",
    root.headers["content-type"].includes("text/html")
  );
  assert(
    "GET / contains DeployX title",
    root.body.includes("<title>DeployX Demo</title>")
  );
  assert(
    "GET / contains hero section",
    root.body.includes('class="hero"')
  );

  // Test 3: API status endpoint
  const status = await fetchJSON("/api/status");
  assert("GET /api/status returns 200", status.status === 200);
  assert(
    "GET /api/status has app name",
    status.body.name === "deployx-demo-storage"
  );
  assert(
    "GET /api/status has version",
    typeof status.body.version === "string"
  );
  assert(
    "GET /api/status has uptime",
    typeof status.body.uptime_seconds === "number"
  );
  assert(
    "GET /api/status has environment",
    typeof status.body.environment === "string"
  );

  // Test 4: Deployments endpoint
  const deps = await fetchJSON("/api/deployments");
  assert("GET /api/deployments returns 200", deps.status === 200);
  assert(
    "GET /api/deployments has array",
    Array.isArray(deps.body.deployments)
  );
  assert(
    "GET /api/deployments has entries",
    deps.body.deployments.length > 0
  );
  assert(
    "Deployment has required fields",
    deps.body.deployments[0].id &&
      deps.body.deployments[0].version &&
      deps.body.deployments[0].strategy &&
      deps.body.deployments[0].status
  );

  // Test 5: Static assets served
  const css = await fetchRaw("/style.css");
  assert("GET /style.css returns 200", css.status === 200);
  assert(
    "GET /style.css is CSS",
    css.headers["content-type"].includes("text/css")
  );

  const js = await fetchRaw("/app.js");
  assert("GET /app.js returns 200", js.status === 200);

  // Test 6: cgroup parsing (deploy.resources)
  assert("cpu.max 50000/100000 → 0.5 CPU", parseCpuMax("50000 100000") === 0.5);
  assert("cpu.max max → unlimited", parseCpuMax("max 100000") === null);
  assert("limit 'max' → unlimited", parseLimit("max") === null);
  assert("missing cgroup → unavailable", readLimits(path.join(TMP, "nope")).cgroup === "unavailable");

  // Test 7: storage endpoint
  const storage = await fetchJSON("/api/storage");
  assert("GET /api/storage returns 200", storage.status === 200);
  assert("limits read from cgroup", storage.body.limits.cpus === 0.5 && storage.body.limits.memory_limit_mb === 256 && storage.body.limits.pids_limit === 128);
  assert("volume is writable", storage.body.volume.writable === true);
  assert("this boot is recorded", storage.body.volume.boot_count === 1 && storage.body.volume.boots.length === 1);
  assert(
    "unsafe document paths are dropped",
    JSON.stringify(storage.body.documents.paths) === JSON.stringify(["welcome.txt", "guides/setup.pdf"])
  );

  // Test 8: visits and guestbook persist on the volume
  const v1 = await postJSON("/api/visit", {});
  const v2 = await postJSON("/api/visit", {});
  assert("POST /api/visit counts", v2.body.visits === v1.body.visits + 1);
  const note = await postJSON("/api/notes", { name: "tester", text: "hello volume" });
  assert("POST /api/notes returns 201", note.status === 201 && note.body.note.text === "hello volume");
  const empty = await postJSON("/api/notes", { text: "   " });
  assert("empty note is rejected", empty.status === 400);
  const long = await postJSON("/api/notes", { text: "x".repeat(281) });
  assert("over-long note is rejected", long.status === 400);

  // Test 9: a new container (green) sees what the old one (blue) wrote
  const green = createVolumeStore(DATA_DIR, { hostname: "green-container" });
  green.recordBoot();
  const after = green.snapshot();
  assert("data survives a new container", after.visits === v2.body.visits && after.notes.length === 1);
  assert("boot history shows both containers", after.boot_count === 2 && after.boots[0].container === "green-container");

  // Summary
  console.log("\nResults: " + passed + " passed, " + failed + " failed\n");

  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(function (err) {
  console.error("Test runner error:", err);
  if (serverRef) serverRef.close();
  process.exit(1);
});
