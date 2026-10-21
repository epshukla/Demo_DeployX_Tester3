// State kept on the persistent volume DeployX mounts at DATA_DIR
// (`deploy.volumes`). Because the volume outlives containers, the boot
// history shows every blue/green container that has served this app.

const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_BOOTS = 10;
const MAX_NOTES = 20;
const MAX_NOTE_LENGTH = 280;
const MAX_NAME_LENGTH = 40;

const EMPTY_STATE = Object.freeze({
  first_boot_at: null,
  boot_count: 0,
  boots: [],
  visits: 0,
  notes: [],
});

function createVolumeStore(dataDir, { now = () => new Date(), hostname = os.hostname() } = {}) {
  const file = path.join(dataDir, "state.json");
  let writable = false;
  let lastError = null;

  function load() {
    try {
      return { ...EMPTY_STATE, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  // Write to a temp file and rename, so a crash never leaves half a file
  function save(state) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
      writable = true;
      lastError = null;
    } catch (err) {
      writable = false;
      lastError = err.code || err.message;
    }
    return state;
  }

  function update(change) {
    return save(change(load()));
  }

  /** Record that this container started (called once at startup). */
  function recordBoot() {
    const at = now().toISOString();
    return update((s) => ({
      ...s,
      first_boot_at: s.first_boot_at || at,
      boot_count: s.boot_count + 1,
      boots: [{ container: hostname, at }, ...s.boots].slice(0, MAX_BOOTS),
    }));
  }

  function recordVisit() {
    return update((s) => ({ ...s, visits: s.visits + 1 }));
  }

  /** Validated guestbook entry; returns { error } for bad input. */
  function addNote(input) {
    const text = typeof input?.text === "string" ? input.text.trim() : "";
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    if (!text) return { error: "Note text is required" };
    if (text.length > MAX_NOTE_LENGTH) return { error: `Note must be at most ${MAX_NOTE_LENGTH} characters` };
    if (name.length > MAX_NAME_LENGTH) return { error: `Name must be at most ${MAX_NAME_LENGTH} characters` };
    const note = { name: name || "anonymous", text, container: hostname, at: now().toISOString() };
    update((s) => ({ ...s, notes: [note, ...s.notes].slice(0, MAX_NOTES) }));
    return { note };
  }

  function snapshot() {
    return {
      path: dataDir,
      writable,
      error: lastError,
      container: hostname,
      ...load(),
    };
  }

  return { recordBoot, recordVisit, addNote, snapshot };
}

module.exports = { createVolumeStore, MAX_NOTE_LENGTH };
