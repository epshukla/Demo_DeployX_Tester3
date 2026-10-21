(function () {
  "use strict";

  // Fetch live server status and update the page
  function fetchStatus() {
    fetch("/api/status")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setText("uptime", data.uptime);
        setText("version", data.version);
        setText("env", data.environment);
        setText("s-name", data.name);
        setText("s-version", data.version);
        setText("s-status", data.status);
        setText("s-uptime", data.uptime);
        setText("s-node", data.node_version);
        setText("s-platform", data.platform);
        setText("s-container", data.container);
        setText("s-memory", data.memory_mb + " MB");
        setText("s-time", new Date(data.timestamp).toLocaleTimeString());
      })
      .catch(function () {
        setText("uptime", "offline");
      });
  }

  // Fetch deployment history and render the table
  function fetchDeployments() {
    fetch("/api/deployments")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var tbody = document.getElementById("deploy-tbody");
        if (!tbody) return;

        // Clear existing rows
        while (tbody.firstChild) {
          tbody.removeChild(tbody.firstChild);
        }

        if (!data.deployments || data.deployments.length === 0) {
          var emptyRow = document.createElement("tr");
          var emptyCell = document.createElement("td");
          emptyCell.setAttribute("colspan", "5");
          emptyCell.className = "loading";
          emptyCell.textContent = "No deployments found";
          emptyRow.appendChild(emptyCell);
          tbody.appendChild(emptyRow);
          return;
        }

        data.deployments.forEach(function (dep) {
          var row = document.createElement("tr");

          var idCell = document.createElement("td");
          idCell.textContent = dep.id;
          row.appendChild(idCell);

          var versionCell = document.createElement("td");
          versionCell.textContent = dep.version;
          row.appendChild(versionCell);

          var strategyCell = document.createElement("td");
          var stratBadge = document.createElement("span");
          stratBadge.className = "badge badge-strategy";
          stratBadge.textContent = dep.strategy;
          strategyCell.appendChild(stratBadge);
          row.appendChild(strategyCell);

          var statusCell = document.createElement("td");
          var statusBadge = document.createElement("span");
          statusBadge.className = "badge " + (dep.status === "active" ? "badge-active" : "badge-stopped");
          statusBadge.textContent = dep.status;
          statusCell.appendChild(statusBadge);
          row.appendChild(statusCell);

          var timeCell = document.createElement("td");
          timeCell.textContent = new Date(dep.deployed_at).toLocaleString();
          row.appendChild(timeCell);

          tbody.appendChild(row);
        });
      })
      .catch(function () {
        var tbody = document.getElementById("deploy-tbody");
        if (!tbody) return;
        while (tbody.firstChild) {
          tbody.removeChild(tbody.firstChild);
        }
        var errRow = document.createElement("tr");
        var errCell = document.createElement("td");
        errCell.setAttribute("colspan", "5");
        errCell.className = "loading";
        errCell.textContent = "Failed to load deployments";
        errRow.appendChild(errCell);
        errRow.appendChild(errCell);
        tbody.appendChild(errRow);
      });
  }

  // Safe text setter
  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = value || "--";
    }
  }

  // Initial load
  fetchStatus();
  fetchDeployments();

  // Refresh status every 5 seconds
  setInterval(fetchStatus, 5000);

  // ── Storage & Virtualization ──────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function formatMb(mb) {
    if (mb === null || mb === undefined) return "--";
    return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB";
  }

  function timeAgo(iso) {
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  function renderVolume(v) {
    setText("vol-path", v.path);
    setText("vol-boots", String(v.boot_count));
    setText("vol-visits", String(v.visits));
    setText("vol-since", v.first_boot_at ? new Date(v.first_boot_at).toLocaleString() : "--");
    var state = document.getElementById("vol-state");
    if (state) {
      state.textContent = v.writable ? "writable" : "not mounted" + (v.error ? " (" + v.error + ")" : "");
      state.className = v.writable ? "ok" : "warn";
    }

    var boots = document.getElementById("boot-list");
    clear(boots);
    (v.boots || []).forEach(function (b, i) {
      var li = el("li", b.container === v.container ? "current" : "");
      li.appendChild(el("span", "", b.container + (b.container === v.container ? "  (this one)" : "")));
      li.appendChild(el("span", "muted", i === 0 ? "started " + timeAgo(b.at) : timeAgo(b.at)));
      boots && boots.appendChild(li);
    });

    var notes = document.getElementById("note-list");
    clear(notes);
    (v.notes || []).forEach(function (n) {
      var li = el("li");
      li.appendChild(el("span", "", n.text));
      li.appendChild(el("span", "note-meta", n.name + " · via " + n.container + " · " + timeAgo(n.at)));
      notes && notes.appendChild(li);
    });
  }

  function renderLimits(l, deploy) {
    setText("cg-version", l.cgroup);
    setText("lim-cpu", l.cpus === null ? "unlimited" : l.cpus + " CPU");
    setText("host-cpus", String(deploy.host_cpus));
    setText("lim-mem", l.memory_limit_mb === null ? "unlimited" : formatMb(l.memory_limit_mb) + " cap");
    setText("mem-used", formatMb(l.memory_used_mb));
    setText("host-mem", formatMb(deploy.host_memory_mb));
    setText("lim-pids", l.pids_limit === null ? "unlimited" : (l.pids_current || 0) + " / " + l.pids_limit);

    var pct = l.memory_limit_mb && l.memory_used_mb !== null
      ? Math.min(100, Math.round((l.memory_used_mb / l.memory_limit_mb) * 100))
      : 0;
    var fill = document.getElementById("mem-fill");
    if (fill) {
      fill.style.width = pct + "%";
      fill.className = "meter-fill" + (pct >= 80 ? " high" : "");
    }
    var meter = document.getElementById("mem-meter");
    if (meter) meter.setAttribute("aria-valuenow", String(pct));
  }

  // The object store allows reads but not listing, so check each configured path
  function renderDocuments(docs) {
    var list = document.getElementById("doc-list");
    clear(list);
    if (!docs.paths.length) {
      list && list.appendChild(el("li", "muted", "No document paths configured (DOCUMENT_PATHS)"));
      return;
    }
    docs.paths.forEach(function (p) {
      var li = el("li");
      var url = docs.base + p.split("/").map(encodeURIComponent).join("/");
      var link = el("a", "", "/files/" + p);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      var status = el("span", "muted", "checking…");
      li.appendChild(link);
      li.appendChild(status);
      list && list.appendChild(li);
      fetch(url, { method: "HEAD" })
        .then(function (res) {
          var size = res.headers.get("content-length");
          status.textContent = res.ok
            ? "published" + (size ? " · " + formatMb(Number(size) / 1048576).replace("0 MB", "<1 MB") : "")
            : "not uploaded";
          status.className = res.ok ? "ok" : "muted";
        })
        .catch(function () {
          status.textContent = "unreachable";
        });
    });
  }

  var documentsRendered = false;

  function fetchStorage() {
    fetch("/api/storage")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        renderVolume(data.volume);
        renderLimits(data.limits, data.deploy);
        setText("dep-driver", data.deploy.driver);
        setText("dep-container", data.volume.container);
        if (!documentsRendered) {
          documentsRendered = true;
          renderDocuments(data.documents);
        }
      })
      .catch(function () {
        setText("vol-state", "unavailable");
      });
  }

  var docForm = document.getElementById("doc-open");
  if (docForm) {
    docForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("doc-path");
      var p = (input.value || "").trim().replace(/^\/+/, "");
      if (!p) return;
      window.open("/files/" + p.split("/").map(encodeURIComponent).join("/"), "_blank", "noopener");
    });
  }

  var noteForm = document.getElementById("note-form");
  if (noteForm) {
    noteForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = document.getElementById("note-name");
      var text = document.getElementById("note-text");
      var error = document.getElementById("note-error");
      error.textContent = "";
      fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.value, text: text.value }),
      })
        .then(function (res) {
          return res.json().then(function (body) { return { ok: res.ok, body: body }; });
        })
        .then(function (r) {
          if (!r.ok) {
            error.textContent = r.body.error || "Could not save the note";
            return;
          }
          text.value = "";
          fetchStorage();
        })
        .catch(function () {
          error.textContent = "Could not save the note";
        });
    });
  }

  // Count this visit on the volume, then show the storage panels
  fetch("/api/visit", { method: "POST" }).finally(fetchStorage);
  setInterval(fetchStorage, 5000);

})();
