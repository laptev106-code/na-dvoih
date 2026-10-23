(() => {
  "use strict";
  const app = window.NaDvoihApp;
  if (!app) return;
  const q = (selector, root = document) => root.querySelector(selector);
  const state = app.getState();
  const telegram = window.Telegram?.WebApp;
  let initData = String(telegram?.initData || "");
  if (!initData && window.location.hash.includes("tgWebAppData=")) {
    try {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      initData = hashParams.get("tgWebAppData") || "";
    } catch (_) {}
  }
  const webUserId = localStorage.getItem("na-dvoih-web-user-id") || "";
  if (!initData) {
    const urlParams = new URLSearchParams(window.location.search);
    const devParam = urlParams.get("dev_user");
    if (devParam) localStorage.setItem("na-dvoih-dev-user", devParam);
    const savedDevUser = localStorage.getItem("na-dvoih-dev-user") || (window.location.port ? "1" : "");
    if (savedDevUser) {
      initData = savedDevUser === "2" ? "dev_user:10000002:Partner" : "dev_user:10000001:Gennadiy";
    } else if (webUserId) {
      initData = `web_user:${webUserId}:Пользователь`;
    }
  }
  const localUserId = String(app.telegramUserId || telegram?.initDataUnsafe?.user?.id || (initData.startsWith("dev_user:") ? initData.split(":")[1] : (initData.startsWith("web_user:") ? initData.split(":")[1] : webUserId)));
  const META_KEY = `${app.storeKey || "na-dvoih"}-household-sync-v1`;
  let pairId = null;
  let active = false;
  let running = false;
  let applyingRemote = false;
  let localRevision = 0;
  let lastLocal = snapshotLocal();
  let meta = readMeta();
  const dirtyIds = new Set();
  const deleteIds = new Set();
  const conflicts = new Map();
  let timer = 0;

  function shape(task) {
    return {
      id: String(task.id || ""),
      title: String(task.title || ""),
      subcategory: String(task.subcategory || "other"),
      done: Boolean(task.done),
    };
  }

  function snapshotLocal() {
    const result = new Map();
    for (const task of app.getState().householdTasks || []) result.set(String(task.id), shape(task));
    return result;
  }

  function hash(value) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))
      .then((buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
  }

  function readMeta() {
    try {
      const parsed = JSON.parse(localStorage.getItem(META_KEY) || "null");
      return parsed && typeof parsed === "object" && parsed.tasks && typeof parsed.tasks === "object"
        ? parsed
        : { pairId: null, userId: null, tasks: {}, initialized: false };
    } catch {
      return { pairId: null, userId: null, tasks: {}, initialized: false };
    }
  }

  function saveMeta() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      return true;
    } catch {
      report("Задачи синхронизированы, но локальная метаинформация не сохранилась. Локальные данные оставлены; проверьте хранилище.");
      return false;
    }
  }

  function report(message) {
    window.dispatchEvent(new CustomEvent("na-dvoih:household-sync-status", { detail: { message } }));
  }

  function safeHeader(value) {
    try {
      return /^[\x00-\x7F]*$/.test(value) ? value : encodeURIComponent(value);
    } catch {
      return encodeURIComponent(value);
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (initData) headers.set("X-Telegram-Init-Data", safeHeader(initData));
    if (webUserId) headers.set("X-Client-User-Id", webUserId);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
    let data = {};
    try { data = await response.json(); } catch { /* handled as a generic response */ }
    if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { code: data.error || "request_failed", status: response.status });
    return data;
  }

  function taskPath(id) {
    return `/api/household/${encodeURIComponent(String(id))}`;
  }

  function localTask(serverTask) {
    return { ...shape(serverTask), _serverVersion: Number(serverTask.version) };
  }

  function setServerVersion(localTaskValue, version) {
    localTaskValue._serverVersion = Number(version);
    return localTaskValue;
  }

  function dispatchSave(nextTasks, previousTasks) {
    applyingRemote = true;
    state.householdTasks = nextTasks;
    const saved = app.save();
    applyingRemote = false;
    if (!saved) {
      state.householdTasks = previousTasks;
      app.render();
      return false;
    }
    localRevision += 1;
    app.render();
    lastLocal = snapshotLocal();
    return true;
  }

  function recordConflict(id, remote = null, deleted = null, ready = true) {
    conflicts.set(String(id), { remote, deleted, ready });
    renderConflicts();
  }

  function ensureConflictBox() {
    if (q("#householdSyncConflicts")) return;
    const screen = q("#householdScreen");
    const list = q("#householdList");
    if (!screen || !list) return;
    const box = document.createElement("section");
    box.id = "householdSyncConflicts";
    box.className = "sync-conflicts household-sync-conflicts";
    box.hidden = true;
    box.innerHTML = '<strong>Конфликт изменения бытового дела</strong><p class="feature-subtitle">Ни одна версия не перезаписывается автоматически.</p><div id="householdSyncConflictList"></div>';
    screen.insertBefore(box, list);
    const style = document.createElement("style");
    style.textContent = '.household-sync-conflicts{margin:8px 0}.household-sync-conflicts>strong{font-size:11px}.household-sync-conflicts #householdSyncConflictList{display:grid;gap:8px}.household-sync-conflicts .sync-conflict-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.household-sync-conflicts button{min-height:34px;border:1px solid var(--line);border-radius:9px;background:var(--card);font-size:9px;font-weight:700}';
    document.head.append(style);
  }

  function renderConflicts() {
    ensureConflictBox();
    const box = q("#householdSyncConflicts");
    const list = q("#householdSyncConflictList");
    if (!box || !list) return;
    box.hidden = conflicts.size === 0;
    list.replaceChildren();
    for (const [id, detail] of conflicts) {
      const local = (state.householdTasks || []).find((task) => String(task.id) === id);
      const row = document.createElement("section");
      row.className = "sync-conflict-row";
      row.dataset.householdConflictId = id;
      const title = document.createElement("div");
      title.className = "sync-conflict-title";
      title.textContent = local?.title || detail.remote?.title || `Дело ${id.slice(0, 32)}`;
      const versions = document.createElement("div");
      versions.className = "sync-conflict-versions";
      const localVersion = document.createElement("span");
      localVersion.textContent = `На устройстве: ${local ? `«${local.title}»` : "удалено"}`;
      const remoteVersion = document.createElement("span");
      remoteVersion.textContent = detail.remote ? `Онлайн v${detail.remote.version}: «${detail.remote.title}»` : detail.deleted ? `Онлайн v${detail.deleted.version}: удалено` : "Онлайн: запись отсутствует";
      versions.append(localVersion, remoteVersion);
      const actions = document.createElement("div");
      actions.className = "sync-conflict-actions";
      for (const [choice, label] of [["online", "Использовать онлайн"], ["local", "Оставить эту версию"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.householdConflictChoice = choice;
        button.textContent = label;
        button.disabled = !detail.ready;
        actions.append(button);
      }
      row.append(title, versions, actions);
      list.append(row);
    }
  }

  async function getRemote() {
    const result = await api("/api/household");
    return { tasks: Array.isArray(result.tasks) ? result.tasks : [], deleted: Array.isArray(result.deleted) ? result.deleted : [] };
  }

  async function bootstrap(remote) {
    const local = [...(state.householdTasks || [])].map((task) => ({ ...task, ...shape(task) }));
    const localById = new Map(local.map((task) => [String(task.id), task]));
    const remoteById = new Map(remote.tasks.map((task) => [String(task.id), task]));
    const deletedById = new Map(remote.deleted.map((item) => [String(item.id), item]));
    const additions = [];
    for (const [id, task] of localById) {
      const server = remoteById.get(id);
      if (server) {
        if (JSON.stringify(shape(task)) !== JSON.stringify(shape(server))) recordConflict(id, server, null);
      } else if (deletedById.has(id)) {
        recordConflict(id, null, deletedById.get(id));
      } else additions.push(shape(task));
    }
    if (additions.length) {
      try {
        await api("/api/household/import", { method: "POST", body: { tasks: additions } });
      } catch (exception) {
        if (exception.status !== 409) throw exception;
      }
    }
    const latest = await getRemote();
    const next = [...(state.householdTasks || [])];
    const indexById = new Map(next.map((task, index) => [String(task.id), index]));
    const nextMeta = {};
    for (const server of latest.tasks) {
      const id = String(server.id);
      const localTaskValue = indexById.has(id) ? next[indexById.get(id)] : null;
      if (localTaskValue && JSON.stringify(shape(localTaskValue)) !== JSON.stringify(shape(server))) {
        recordConflict(id, server, null);
        nextMeta[id] = meta.tasks[id] || { version: Number(server.version), hash: await hash(shape(server)) };
        continue;
      }
      const mapped = localTask(server);
      if (indexById.has(id)) next[indexById.get(id)] = mapped;
      else { indexById.set(id, next.length); next.push(mapped); }
      nextMeta[id] = { version: Number(server.version), hash: await hash(shape(server)) };
    }
    for (const tombstone of latest.deleted) {
      const id = String(tombstone.id);
      nextMeta[id] = { version: Number(tombstone.version), hash: "", deleted: true };
      if (indexById.has(id)) recordConflict(id, null, tombstone);
    }
    const previous = state.householdTasks;
    if (JSON.stringify(next.map(shape)) !== JSON.stringify((previous || []).map(shape)) || next.length !== (previous || []).length) {
      if (!dispatchSave(next, previous)) {
        report("Онлайн-задачи получены, но локальный браузер отказал в сохранении. Местные записи восстановлены.");
        return;
      }
    }
    meta = { pairId, userId: localUserId, tasks: nextMeta, initialized: true };
    saveMeta();
    dirtyIds.clear();
    deleteIds.clear();
    lastLocal = snapshotLocal();
    if (conflicts.size) report(`Нужно вручную сравнить ${conflicts.size} бытовое дело: версии сохранены отдельно.`);
    else report(`Онлайн-задачи пары синхронизированы: ${latest.tasks.length}.`);
  }

  async function currentRemoteFor(id) {
    const remote = await getRemote();
    return {
      remote: remote.tasks.find((task) => String(task.id) === id) || null,
      deleted: remote.deleted.find((task) => String(task.id) === id) || null,
    };
  }

  async function pushPending() {
    if (!active) return;
    for (const id of [...deleteIds]) {
      if (conflicts.has(id)) continue;
      const base = meta.tasks[id];
      if (!base || base.deleted) { deleteIds.delete(id); continue; }
      try {
        const result = await api(taskPath(id), { method: "DELETE", headers: { "If-Match": String(base.version) } });
        meta.tasks[id] = { version: Number(result.version), hash: "", deleted: true };
        deleteIds.delete(id);
        dirtyIds.delete(id);
      } catch (exception) {
        if (exception.status === 409) {
          const current = await currentRemoteFor(id);
          recordConflict(id, current.remote, current.deleted);
          return;
        }
        throw exception;
      }
    }
    for (const id of [...dirtyIds]) {
      if (conflicts.has(id)) continue;
      const local = (state.householdTasks || []).find((task) => String(task.id) === id);
      if (!local) { dirtyIds.delete(id); continue; }
      const task = shape(local);
      const base = meta.tasks[id];
      const version = base?.deleted ? Number(base.version) : base ? Number(base.version) : null;
      try {
        const response = base?.deleted
          ? await api(`${taskPath(id)}/restore`, { method: "POST", body: { task, version } })
          : await api(taskPath(id), { method: "PUT", body: { task, version } });
        const synced = response.task;
        const old = state.householdTasks;
        const next = old.map((item) => String(item.id) === id ? setServerVersion({ ...item }, synced.version) : item);
        if (!dispatchSave(next, old)) throw Object.assign(new Error("local_storage_failed"), { code: "local_storage_failed" });
        meta.tasks[id] = { version: Number(synced.version), hash: await hash(task) };
        dirtyIds.delete(id);
        deleteIds.delete(id);
      } catch (exception) {
        if (exception.status === 409) {
          const current = await currentRemoteFor(id);
          recordConflict(id, current.remote, current.deleted);
          return;
        }
        throw exception;
      }
    }
    saveMeta();
  }

  async function applyRemote(remote, revisionAtStart) {
    const current = state.householdTasks || [];
    const previous = current;
    const next = [...current];
    const localById = new Map(next.map((task, index) => [String(task.id), { task, index }]));
    const nextMeta = { ...meta.tasks };
    let changed = false;
    const seen = new Set();

    for (const remoteTask of remote.tasks) {
      const id = String(remoteTask.id);
      seen.add(id);
      const serverShape = shape(remoteTask);
      const serverHash = await hash(serverShape);
      const localEntry = localById.get(id);
      const base = meta.tasks[id];
      if (deleteIds.has(id)) {
        nextMeta[id] = base || { version: Number(remoteTask.version), hash: serverHash };
        continue;
      }
      if (!localEntry) {
        if (base && !base.deleted && !dirtyIds.has(id)) {
          deleteIds.add(id);
          nextMeta[id] = base;
          continue;
        }
        if (dirtyIds.has(id)) {
          recordConflict(id, remoteTask, null);
          continue;
        }
        next.push(localTask(remoteTask));
        localById.set(id, { task: next[next.length - 1], index: next.length - 1 });
        changed = true;
        nextMeta[id] = { version: Number(remoteTask.version), hash: serverHash };
        continue;
      }
      const localShape = shape(localEntry.task);
      const localHash = await hash(localShape);
      if (localHash === serverHash) {
        const nextTask = setServerVersion({ ...localEntry.task }, remoteTask.version);
        next[localEntry.index] = nextTask;
        if (Number(localEntry.task._serverVersion) !== Number(remoteTask.version)) changed = true;
        nextMeta[id] = { version: Number(remoteTask.version), hash: serverHash };
      } else if (!base || (Number(base.version) !== Number(remoteTask.version) && localHash !== base.hash)) {
        recordConflict(id, remoteTask, null);
        nextMeta[id] = base || { version: Number(remoteTask.version), hash: serverHash };
      } else if (localHash === base.hash) {
        const mapped = localTask(remoteTask);
        next[localEntry.index] = mapped;
        changed = changed || JSON.stringify(shape(localEntry.task)) !== JSON.stringify(serverShape);
        nextMeta[id] = { version: Number(remoteTask.version), hash: serverHash };
      } else {
        dirtyIds.add(id);
        nextMeta[id] = base;
      }
    }

    for (const tombstone of remote.deleted) {
      const id = String(tombstone.id);
      seen.add(id);
      const localEntry = localById.get(id);
      const base = meta.tasks[id];
      if (!localEntry) {
        nextMeta[id] = { version: Number(tombstone.version), hash: "", deleted: true };
      } else if (base && !base.deleted && (await hash(shape(localEntry.task))) === base.hash) {
        const index = next.findIndex((task) => String(task.id) === id);
        if (index >= 0) { next.splice(index, 1); changed = true; }
        nextMeta[id] = { version: Number(tombstone.version), hash: "", deleted: true };
      } else {
        recordConflict(id, null, tombstone);
        nextMeta[id] = base || { version: Number(tombstone.version), hash: "", deleted: true };
      }
    }

    for (const localTaskValue of next) {
      const id = String(localTaskValue.id);
      if (!seen.has(id) && !meta.tasks[id] && !deleteIds.has(id)) dirtyIds.add(id);
    }

    if (changed) {
      if (localRevision !== revisionAtStart || state.householdTasks !== previous) {
        report("Локальные бытовые дела изменились во время синхронизации; серверный снимок не применён поверх новых данных.");
        return;
      }
      if (!dispatchSave(next, previous)) {
        report("Партнёрские задачи получены, но локальное хранилище не приняло обновление; прежние дела оставлены.");
        return;
      }
    }
    meta.tasks = nextMeta;
    saveMeta();
    if (conflicts.size) renderConflicts();
  }

  async function syncCycle() {
    if (!active || !initData || running || !pairId) return;
    running = true;
    const revisionAtStart = localRevision;
    try {
      if (!meta.initialized || meta.pairId !== pairId || meta.userId !== localUserId) {
        const remote = await getRemote();
        await bootstrap(remote);
      } else {
        await pushPending();
        const remote = await getRemote();
        await applyRemote(remote, revisionAtStart);
        await pushPending();
        if (conflicts.size) report(`Нужно вручную выбрать версию для ${conflicts.size} бытового дела; изменения сохранены.`);
        else report(`Онлайн-задачи пары синхронизированы (${remote.tasks.length}).`);
      }
    } catch (exception) {
      report(exception.status === 401
        ? "Сессия Telegram устарела; локальные бытовые дела сохранены. Перезапустите Mini App."
        : "Не удалось синхронизировать бытовые дела. Локальные изменения сохранены для следующей проверки.");
    } finally {
      running = false;
      if (active && localRevision !== revisionAtStart && !conflicts.size) setTimeout(syncCycle, 150);
    }
  }

  async function resolveConflict(id, choice) {
    const detail = conflicts.get(id);
    if (!detail) return;
    const row = q(`[data-household-conflict-id="${CSS.escape(id)}"]`);
    row?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      let nextMeta;
      const local = (state.householdTasks || []).find((task) => String(task.id) === id);
      if (choice === "online") {
        const next = (state.householdTasks || []).filter((task) => String(task.id) !== id);
        if (detail.remote) next.push(localTask(detail.remote));
        if (!dispatchSave(next, state.householdTasks)) throw new Error("local_storage_failed");
        nextMeta = detail.remote
          ? { version: Number(detail.remote.version), hash: await hash(shape(detail.remote)) }
          : { version: Number(detail.deleted?.version || 1), hash: "", deleted: true };
      } else if (local) {
        const task = shape(local);
        let response;
        if (detail.deleted) response = await api(`${taskPath(id)}/restore`, { method: "POST", body: { task, version: Number(detail.deleted.version) } });
        else response = await api(taskPath(id), { method: "PUT", body: { task, version: detail.remote ? Number(detail.remote.version) : null } });
        const next = state.householdTasks.map((item) => String(item.id) === id ? setServerVersion({ ...item }, response.task.version) : item);
        if (!dispatchSave(next, state.householdTasks)) throw new Error("local_storage_failed");
        nextMeta = { version: Number(response.task.version), hash: await hash(task) };
      } else if (detail.remote) {
        const response = await api(taskPath(id), { method: "DELETE", headers: { "If-Match": String(detail.remote.version) } });
        nextMeta = { version: Number(response.version), hash: "", deleted: true };
      } else {
        nextMeta = { version: Number(detail.deleted?.version || 1), hash: "", deleted: true };
      }
      meta.tasks[id] = nextMeta;
      dirtyIds.delete(id);
      deleteIds.delete(id);
      conflicts.delete(id);
      saveMeta();
      renderConflicts();
      report("Конфликт бытового дела разрешён выбранной версией.");
      syncCycle();
    } catch {
      const current = await currentRemoteFor(id).catch(() => ({ remote: null, deleted: null }));
      recordConflict(id, current.remote, current.deleted, true);
      report("Не удалось применить выбор: версии изменились или локальное хранилище недоступно. Обновите состояние и попробуйте снова.");
    }
  }

  function onLocalSave() {
    if (applyingRemote) {
      lastLocal = snapshotLocal();
      return;
    }
    localRevision += 1;
    const current = snapshotLocal();
    const old = lastLocal;
    lastLocal = current;
    for (const [id, task] of current) {
      if (!old.has(id) || JSON.stringify(task) !== JSON.stringify(old.get(id))) {
        dirtyIds.add(id);
        conflicts.delete(id);
      }
    }
    for (const id of old.keys()) {
      if (!current.has(id)) {
        deleteIds.add(id);
        dirtyIds.delete(id);
        conflicts.delete(id);
      }
    }
    renderConflicts();
    if (active) syncCycle();
  }

  function onSyncState(event) {
    const detail = event.detail || {};
    const wasActive = active;
    active = Boolean(detail.active && detail.pairId && initData && String(detail.userId || "") === localUserId);
    pairId = active ? String(detail.pairId) : null;
    if (active && (!wasActive || meta.pairId !== pairId || meta.userId !== localUserId)) {
      if (meta.pairId !== pairId || meta.userId !== localUserId) meta = { pairId, userId: localUserId, tasks: {}, initialized: false };
      syncCycle();
    } else if (!active) {
      report("В локальном режиме бытовые дела сохраняются на этом устройстве; онлайн-синхронизация не активна.");
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-household-conflict-choice]");
    const row = button?.closest("[data-household-conflict-id]");
    if (button && row) resolveConflict(row.dataset.householdConflictId, button.dataset.householdConflictChoice);
  });
  window.addEventListener("na-dvoih:local-save", onLocalSave);
  window.addEventListener("na-dvoih:sync-state", onSyncState);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncCycle(); });
  window.addEventListener("focus", syncCycle);
  // With Real-Time SSE enabled, fallback polling is reduced to a relaxed 30s heartbeat
  timer = setInterval(() => { if (document.visibilityState !== "hidden") syncCycle(); }, 30_000);
  renderConflicts();

  window.NaDvoihHouseholdSync = {
    sync: syncCycle,
    forceRefresh: () => syncCycle()
  };
})();
