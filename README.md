# DeployX Tester3 — Storage & Virtualization

The [Tester2](https://github.com/epshukla/Demo_DeployX_Tester2) website, deployed through
[DeployX](https://github.com/epshukla/DevOps-Deployment-Tool), plus a **Storage & Virtualization**
section that shows, live from the running container:

| Panel | DeployX feature | What you see |
|---|---|---|
| **Documents** | Project Documents tab → runner's S3 object store (RustFS) → `/files/` on the deployment URL | Each configured file with "published / not uploaded", links that open it |
| **Persistent volume** | `deploy.volumes` (named Docker volume at `/data`) | Visit counter, guestbook, and every container that has served the app — data survives blue→green redeploys |
| **Resource limits** | `deploy.resources` (cgroup CPU / memory / pids caps) | 0.5 CPU, 256 MB memory with live usage, 128 processes |
| **Placement & security** | `driver: auto` broker + `deploy.security_scan` (Trivy) | Target picked by the runner; image scanned for HIGH/CRITICAL CVEs before deploy |

## Use it with DeployX

1. Create a DeployX project from this repo and a pipeline from [`deployx.yaml`](deployx.yaml).
2. On the project's **Documents** tab, upload the files in [`sample-documents/`](sample-documents)
   with these paths, as **public**:
   - `welcome.txt`
   - `cc-notes.pdf`
   - `images/architecture.png`
3. Trigger the pipeline (needs a runner with Docker). Open the deployment's public URL.
4. Redeploy (or push a commit): the guestbook and visit count are still there, and the
   container history gains a new entry.

The document paths the page checks come from `DOCUMENT_PATHS` in `deployx.yaml` (the store
serves files but doesn't allow listing them).

## Run locally

```bash
npm ci
npm test          # 33 contract tests (fake cgroup + temp volume)
DATA_DIR=./data npm start   # http://localhost:3000
```

Locally `/files/` is not served (that is the DeployX proxy's job) and limits show as
"unlimited" unless you run the image with `--cpus/--memory`:

```bash
docker build -t demo-storage .
docker run --rm -p 3000:3000 --cpus 0.5 --memory 256m --pids-limit 128 -v demo-data:/data demo-storage
```

## API

| Endpoint | |
|---|---|
| `GET /health` | `{ "status": "healthy" }` (DeployX health check) |
| `GET /api/status` | App name, version, uptime, container id |
| `GET /api/storage` | Volume state, cgroup limits, document paths, deploy driver |
| `POST /api/visit` | Count a visit on the volume |
| `POST /api/notes` | `{ name?, text }` guestbook entry (text ≤ 280 chars) |
