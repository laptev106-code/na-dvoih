/**
 * Unified Sync Engine for «На двоих»
 * Implements Field-Level LWW (Last-Write-Wins), Transactional Outbox (FIFO),
 * Zero Cross-Pair Leakage (Stateless Session Tokens), and Real-Time SSE Multiplexing.
 * Designed according to Argon Architectural Blueprint.
 */
(() => {
  "use strict";

  const telegram = window.Telegram?.WebApp;
  let initData = typeof telegram?.initData === "string" ? telegram.initData : "";

  if (!initData && window.location.hash.includes("tgWebAppData=")) {
    try {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      initData = hashParams.get("tgWebAppData") || "";
    } catch (_) {}
  }

  // Persistent web fallback user ID for browser testing
  let webUserId = localStorage.getItem("na-dvoih-web-user-id");
  if (!webUserId) {
    webUserId = "u_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("na-dvoih-web-user-id", webUserId);
  }

  // Browser dev-mode support
  if (!initData) {
    const urlParams = new URLSearchParams(window.location.search);
    const devUserParam = urlParams.get("dev_user");
    if (devUserParam) localStorage.setItem("na-dvoih-dev-user", devUserParam);
    const savedDevUser = localStorage.getItem("na-dvoih-dev-user") || (window.location.port ? "1" : "");
    if (savedDevUser) {
      initData = savedDevUser === "2" ? "dev_user:10000002:Partner" : "dev_user:10000001:Gennadiy";
    } else {
      initData = `web_user:${webUserId}:Пользователь`;
    }
  }

  class UnifiedSyncEngine {
    constructor() {
      this.outboxKey = "na_dvoix_outbox_v2";
      this.stateKey = "na_dvoix_state_v2";
      this.tokenKey = "na_dvoix_session_token_v2";
      this.sessionKey = "na_dvoix_session_info_v2";
      this.lastEventKey = "na_dvoix_last_event_id";
      this.lastPullKey = "na_dvoix_last_pull_ts";

      this.sessionToken = sessionStorage.getItem(this.tokenKey) || localStorage.getItem(this.tokenKey) || "";
      this.sessionInfo = null;
      this.isFlushing = false;
      this.retryCount = 0;
      this.partnerOnline = false;
      this.eventSource = null;
      this.listeners = new Set();

      this.initSession();

      window.addEventListener("online", () => this.flush());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          this.flush();
          this.connectSSE();
        }
      });
      window.addEventListener("focus", () => {
        this.flush();
        this.connectSSE();
      });
    }

    async initSession() {
      try {
        const res = await fetch("/api/sync/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Init-Data": initData,
          },
          body: JSON.stringify({ initData }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            this.sessionToken = data.token;
            sessionStorage.setItem(this.tokenKey, data.token);
            localStorage.setItem(this.tokenKey, data.token);
          }
          this.sessionInfo = { user: data.user, pair: data.pair };
          localStorage.setItem(this.sessionKey, JSON.stringify(this.sessionInfo));
          this.notifyListeners("session", this.sessionInfo);
          this.updateSyncUI();
          this.connectSSE();
          this.pull();
          this.flush();
          return;
        }
      } catch (err) {
        console.warn("[UnifiedSyncEngine] Session init error:", err.message);
      }

      // Fallback from cache
      try {
        const cached = localStorage.getItem(this.sessionKey);
        if (cached) {
          this.sessionInfo = JSON.parse(cached);
          this.notifyListeners("session", this.sessionInfo);
          this.updateSyncUI();
        }
      } catch {}
    }

    getSession() {
      return this.sessionInfo;
    }

    isPartnerOnline() {
      return this.partnerOnline;
    }

    subscribe(callback) {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }

    notifyListeners(event, payload) {
      for (const fn of this.listeners) {
        try { fn(event, payload); } catch (e) { console.error(e); }
      }
    }

    getOutbox() {
      try {
        return JSON.parse(localStorage.getItem(this.outboxKey) || "[]");
      } catch {
        return [];
      }
    }

    saveOutbox(queue) {
      try {
        localStorage.setItem(this.outboxKey, JSON.stringify(queue));
      } catch (err) {
        console.warn("[UnifiedSyncEngine] Failed to save outbox:", err.message);
      }
    }

    getStateCache() {
      try {
        return JSON.parse(localStorage.getItem(this.stateKey) || "{}");
      } catch {
        return {};
      }
    }

    saveStateCache(state) {
      try {
        localStorage.setItem(this.stateKey, JSON.stringify(state));
      } catch (err) {
        console.warn("[UnifiedSyncEngine] Failed to save state cache:", err.message);
      }
    }

    // Called on any user action: wish, chore, date, or goal
    mutate(entityType, entityId, patch = {}, isDelete = false) {
      const now = Date.now();
      const stateCache = this.getStateCache();
      const current = stateCache[entityId] || {
        id: entityId,
        type: entityType,
        data: {},
        fieldTs: {},
      };

      if (isDelete) {
        current._deleted = true; // Tombstone in localStorage
        current.deletedAt = now;
      } else {
        delete current._deleted;
        delete current.deletedAt;
        for (const [k, v] of Object.entries(patch)) {
          current.data[k] = v;
          current.fieldTs[k] = now;
        }
      }
      stateCache[entityId] = current;
      this.saveStateCache(stateCache);

      // Compact queue: merge changes for same entity in offline queue
      const queue = this.getOutbox();
      const existingIdx = queue.findIndex((m) => m.entityId === entityId && !m.inFlight);

      if (existingIdx !== -1 && !isDelete) {
        Object.assign(queue[existingIdx].patch, patch);
        for (const k of Object.keys(patch)) queue[existingIdx].clientFieldTs[k] = now;
      } else {
        const clientFieldTs = {};
        for (const k of Object.keys(patch)) clientFieldTs[k] = now;

        queue.push({
          mutationId: (crypto.randomUUID ? crypto.randomUUID() : "m_" + Math.random().toString(36).slice(2) + Date.now()),
          entityId,
          entityType,
          patch: patch || {},
          clientFieldTs,
          isDelete,
          createdAt: now,
        });
      }

      this.saveOutbox(queue);
      this.updateSyncUI();
      this.flush();
    }

    async flush() {
      if (this.isFlushing || !navigator.onLine) return;
      if (!this.sessionToken) {
        await this.initSession();
        if (!this.sessionToken) return;
      }

      const queue = this.getOutbox();
      if (queue.length === 0) {
        this.updateSyncUI();
        return;
      }

      this.isFlushing = true;
      this.updateSyncUI();

      try {
        const res = await fetch("/api/sync/batch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.sessionToken}`,
          },
          body: JSON.stringify({ mutations: queue }),
        });

        if (res.status === 401) {
          // Token expired, refresh
          this.sessionToken = "";
          await this.initSession();
          this.isFlushing = false;
          return;
        }

        if (res.status === 409) {
          // Not paired yet, keep in outbox until paired
          this.isFlushing = false;
          this.updateSyncUI();
          return;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const { processedIds } = await res.json();
        const currentQueue = this.getOutbox();
        const remaining = currentQueue.filter((m) => !processedIds.includes(m.mutationId));
        this.saveOutbox(remaining);

        // Clean local tombstones after server confirmed deletion
        const stateCache = this.getStateCache();
        for (const id of Object.keys(stateCache)) {
          if (stateCache[id]._deleted && !remaining.some((m) => m.entityId === id)) {
            delete stateCache[id];
          }
        }
        this.saveStateCache(stateCache);

        this.retryCount = 0;
        this.isFlushing = false;
        this.updateSyncUI();
      } catch (err) {
        this.isFlushing = false;
        const delay = Math.min(30000, 1000 * Math.pow(2, this.retryCount) + Math.random() * 500);
        this.retryCount++;
        setTimeout(() => this.flush(), delay);
        this.updateSyncUI();
      }
    }

    async pull() {
      if (!this.sessionToken || !navigator.onLine) return;
      try {
        const since = Number(localStorage.getItem(this.lastPullKey) || "0");
        const res = await fetch(`/api/sync/pull?since=${since}`, {
          headers: {
            "Authorization": `Bearer ${this.sessionToken}`,
          },
        });
        if (!res.ok) return;

        const { entities, maxEventId } = await res.json();
        if (Array.isArray(entities) && entities.length > 0) {
          this.applyIncomingDeltas(entities.map((e) => ({
            entityId: e.id,
            entityType: e.type,
            data: e.data,
            fieldTs: e.fieldTs,
            deletedAt: e.deletedAt,
            updatedAt: e.updatedAt,
          })));

          const maxTs = Math.max(...entities.map((e) => e.updatedAt || 0));
          if (maxTs > since) {
            localStorage.setItem(this.lastPullKey, String(maxTs));
          }
        }
        if (maxEventId) {
          localStorage.setItem(this.lastEventKey, String(maxEventId));
        }
      } catch (err) {
        console.warn("[UnifiedSyncEngine] Pull failed:", err.message);
      }
    }

    applyIncomingDeltas(deltas) {
      const stateCache = this.getStateCache();
      const outbox = this.getOutbox();
      let hasChanges = false;

      const app = window.NaDvoihApp;
      const appState = app?.getState?.();

      for (const delta of deltas) {
        const { entityId, entityType, data, fieldTs, deletedAt } = delta;

        // If client has an unconfirmed pending DELETE for this entity, outbox takes priority
        const pendingDelete = outbox.some((m) => m.entityId === entityId && m.isDelete);
        if (pendingDelete) continue;

        if (deletedAt) {
          if (stateCache[entityId]) {
            delete stateCache[entityId];
            hasChanges = true;
          }
          // Remove from app state
          if (appState) {
            if (entityType === "wish" || entityType === "date") {
              if (Array.isArray(appState.items)) {
                appState.items = appState.items.filter((x) => String(x.id) !== String(entityId));
              }
            } else if (entityType === "chore") {
              if (Array.isArray(appState.householdTasks)) {
                appState.householdTasks = appState.householdTasks.filter((x) => String(x.id) !== String(entityId));
              }
            }
          }
          continue;
        }

        // Field-Level LWW merge
        const local = stateCache[entityId] || { id: entityId, type: entityType, data: {}, fieldTs: {} };
        let entityUpdated = false;

        for (const [key, val] of Object.entries(data || {})) {
          const remoteTs = (fieldTs && fieldTs[key]) || 0;
          const localTs = (local.fieldTs && local.fieldTs[key]) || 0;

          if (remoteTs >= localTs) {
            local.data[key] = val;
            local.fieldTs[key] = remoteTs;
            entityUpdated = true;
          }
        }

        if (entityUpdated || !stateCache[entityId]) {
          stateCache[entityId] = local;
          hasChanges = true;

          // Project to appState
          if (appState) {
            if (entityType === "wish") {
              if (!Array.isArray(appState.items)) appState.items = [];
              const idx = appState.items.findIndex((x) => String(x.id) === String(entityId));
              const itemObj = { ...local.data, id: entityId };
              if (idx !== -1) appState.items[idx] = itemObj;
              else appState.items.unshift(itemObj);
            } else if (entityType === "chore") {
              if (!Array.isArray(appState.householdTasks)) appState.householdTasks = [];
              const idx = appState.householdTasks.findIndex((x) => String(x.id) === String(entityId));
              const taskObj = { ...local.data, id: entityId };
              if (idx !== -1) appState.householdTasks[idx] = taskObj;
              else appState.householdTasks.unshift(taskObj);
            } else if (entityType === "goal") {
              appState.bigGoal = { ...appState.bigGoal, ...local.data, id: entityId };
            }
          }
        }
      }

      if (hasChanges) {
        this.saveStateCache(stateCache);
        if (app?.save) app.save();
        if (app?.render) app.render();
        this.notifyListeners("change", { deltas });
      }
    }

    connectSSE() {
      if (!this.sessionToken || !navigator.onLine) return;
      if (this.eventSource) {
        try { this.eventSource.close(); } catch {}
        this.eventSource = null;
      }

      const lastEventId = localStorage.getItem(this.lastEventKey) || "0";
      const url = `/api/stream?token=${encodeURIComponent(this.sessionToken)}&lastEventId=${lastEventId}`;

      try {
        this.eventSource = new EventSource(url);

        this.eventSource.addEventListener("connected", (e) => {
          if (e.lastEventId) {
            localStorage.setItem(this.lastEventKey, e.lastEventId);
          }
          try {
            const parsed = JSON.parse(e.data);
            if (typeof parsed.partnerOnline === "boolean") {
              this.partnerOnline = parsed.partnerOnline;
              this.notifyListeners("presence", { partnerOnline: this.partnerOnline });
              this.updateSyncUI();
            }
          } catch {}
        });

        this.eventSource.addEventListener("entity:delta", (e) => {
          if (e.lastEventId) {
            localStorage.setItem(this.lastEventKey, e.lastEventId);
          }
          try {
            const payload = JSON.parse(e.data);
            if (payload.deltas && Array.isArray(payload.deltas)) {
              this.applyIncomingDeltas(payload.deltas);
              window.NaDvoihHaptics?.impact?.("light");
              this.showSyncBadgeToast("Синхронизировано ✨");
            }
          } catch (err) {
            console.error("[UnifiedSyncEngine] Delta error:", err);
          }
        });

        this.eventSource.addEventListener("presence:update", (e) => {
          try {
            const parsed = JSON.parse(e.data);
            if (typeof parsed.partnerOnline === "boolean") {
              this.partnerOnline = parsed.partnerOnline;
              this.notifyListeners("presence", { partnerOnline: this.partnerOnline });
              this.updateSyncUI();
              if (this.partnerOnline) {
                this.showSyncBadgeToast("Партнёр онлайн 💚");
              }
            }
          } catch {}
        });

        this.eventSource.addEventListener("pair:joined", () => {
          window.NaDvoihHaptics?.notification?.("success");
          this.showSyncBadgeToast("Партнёр подключился к паре! 🎉");
          this.initSession();
        });

        this.eventSource.addEventListener("pair:left", () => {
          this.showSyncBadgeToast("Партнёр отключил пару");
          this.initSession();
        });

        this.eventSource.onerror = () => {
          if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
            this.eventSource.close();
            this.eventSource = null;
            setTimeout(() => this.connectSSE(), 5000);
          }
        };
      } catch (err) {
        console.warn("[UnifiedSyncEngine] EventSource connect error:", err);
      }
    }

    showSyncBadgeToast(text) {
      let toast = document.getElementById("syncBadgeToast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "syncBadgeToast";
        toast.style.cssText = `
          position: fixed;
          top: calc(var(--safe-top, 14px) + 12px);
          left: 50%;
          transform: translate(-50%, -20px);
          background: var(--card, #fff);
          color: var(--green, #304e45);
          border: 1px solid var(--line, #ecebe4);
          padding: 7px 15px;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 700;
          box-shadow: 0 8px 24px rgba(44,55,47,.12);
          display: flex;
          align-items: center;
          gap: 6px;
          z-index: 1000;
          opacity: 0;
          pointer-events: none;
          transition: transform .25s cubic-bezier(.2,.8,.2,1), opacity .25s ease;
        `;
        document.body.appendChild(toast);
      }
      toast.textContent = text;
      requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translate(-50%, 0)";
      });
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translate(-50%, -15px)";
      }, 2500);
    }

    updateSyncUI() {
      // Sleek indicator in header or sync modal
      const badge = document.getElementById("realtimeSyncBadge");
      const outbox = this.getOutbox();
      const pair = this.sessionInfo?.pair;

      if (badge) {
        if (!navigator.onLine) {
          badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:#e09443;display:inline-block"></span> Офлайн (${outbox.length})`;
          badge.style.display = "inline-flex";
        } else if (this.isFlushing) {
          badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:#3e7788;display:inline-block;animation:pulse 1s infinite"></span> Синхронизация...`;
          badge.style.display = "inline-flex";
        } else if (pair && pair.memberCount === 2) {
          if (this.partnerOnline) {
            badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:#34c759;display:inline-block"></span> Партнёр в сети 💚`;
          } else {
            badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:#304e45;display:inline-block"></span> Синхронизировано ✦`;
          }
          badge.style.display = "inline-flex";
        } else if (pair && pair.memberCount === 1) {
          badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:#995d77;display:inline-block"></span> Код пары: <b>${pair.inviteCode || "..."}</b>`;
          badge.style.display = "inline-flex";
        } else {
          badge.style.display = "none";
        }
      }
    }

    // Auto-migration on first run
    migrateFromLegacyStorage() {
      if (localStorage.getItem("na_dvoix_migrated_v2") === "true") return;

      const app = window.NaDvoihApp;
      const appState = app?.getState?.();
      if (!appState) return;

      let count = 0;
      // Wishes
      if (Array.isArray(appState.items)) {
        for (const item of appState.items) {
          if (item && item.id) {
            this.mutate("wish", String(item.id), item, false);
            count++;
          }
        }
      }
      // Chores
      if (Array.isArray(appState.householdTasks)) {
        for (const task of appState.householdTasks) {
          if (task && task.id) {
            this.mutate("chore", String(task.id), task, false);
            count++;
          }
        }
      }
      // Big Goal
      if (appState.bigGoal && typeof appState.bigGoal === "object") {
        this.mutate("goal", "bg-main", appState.bigGoal, false);
        count++;
      }

      localStorage.setItem("na_dvoix_migrated_v2", "true");
      console.log(`[UnifiedSyncEngine] Migrated ${count} items to Unified Outbox v2.`);
      this.flush();
    }
  }

  // Instantiate singleton
  const engine = new UnifiedSyncEngine();
  window.syncEngine = engine;

  // Run migration slightly after boot
  setTimeout(() => {
    engine.migrateFromLegacyStorage();
  }, 1000);

  // Backwards compatibility shim for existing scripts
  window.NaDvoihWishesSync = {
    sync: () => engine.flush(),
    refreshSession: () => engine.initSession(),
    applyDelta: (item, isDelete) => {
      engine.applyIncomingDeltas([{
        entityId: item.id,
        entityType: "wish",
        data: item,
        fieldTs: {},
        deletedAt: isDelete ? Date.now() : null,
      }]);
    }
  };

  window.NaDvoihHouseholdSync = {
    sync: () => engine.flush(),
  };
})();
