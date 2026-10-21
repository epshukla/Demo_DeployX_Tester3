const express = require("express");
const os = require("os");
const path = require("path");
const { readLimits } = require("./lib/limits");
const { createVolumeStore } = require("./lib/volume-store");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || "/data";
const CGROUP_ROOT = process.env.CGROUP_ROOT || "/sys/fs/cgroup";
const startTime = Date.now();

const store = createVolumeStore(DATA_DIR);
store.recordBoot();

// Documents uploaded on the DeployX project's Documents tab are served by the
// project proxy at /files/<path> (the object store allows reads, not listing),
// so the paths to show come from config: deploy.env.DOCUMENT_PATHS.
const SAFE_DOC_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const DOCUMENT_PATHS = (process.env.DOCUMENT_PATHS || "welcome.txt,cc-notes.pdf,images/architecture.png")
  .split(",")
  .map((p) => p.trim())
  .filter((p) => p && p.length <= 200 && SAFE_DOC_PATH.test(p) && !p.includes(".."))
  .slice(0, 20);

app.use(express.json({ limit: "4kb" }));

// Serve static files from public/
app.use(express.static(path.join(__dirname, "public")));

// Health check — required by DeployX
app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

// API: live server status (fetched by client JS)
app.get("/api/status", (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  res.json({
    name: "deployx-demo-storage",
    version: "3.0.0",
    status: "healthy",
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    uptime_seconds: uptimeSeconds,
    environment: process.env.NODE_ENV || "development",
    node_version: process.version,
    platform: process.platform,
    container: os.hostname(),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    timestamp: new Date().toISOString(),
  });
});

// API: mock deployment history
app.get("/api/deployments", (_req, res) => {
  res.json({
    deployments: [
      { id: "d-002", version: "3.0.0", strategy: "blue-green", status: "active", deployed_at: new Date().toISOString() },
      { id: "d-001", version: "2.0.0", strategy: "blue-green", status: "stopped", deployed_at: "2026-10-20T10:30:00Z" },
    ],
  });
});

// API: storage + virtualization — persistent volume, cgroup limits, documents
app.get("/api/storage", (_req, res) => {
  res.json({
    volume: store.snapshot(),
    limits: readLimits(CGROUP_ROOT),
    documents: { base: "/files/", paths: DOCUMENT_PATHS },
    deploy: {
      driver: process.env.DEPLOY_DRIVER || "auto",
      host_cpus: os.cpus().length,
      host_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
    },
  });
});

app.post("/api/visit", (_req, res) => {
  const state = store.recordVisit();
  res.json({ visits: state.visits });
});

app.post("/api/notes", (req, res) => {
  const result = store.addNote(req.body);
  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json({ note: result.note });
});

// Start
const server = app.listen(PORT, () => {
  console.log(`Demo storage site listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Persistent data: ${DATA_DIR}`);
});

// Graceful shutdown — required for blue-green/rolling deploys
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

module.exports = { app, server };
