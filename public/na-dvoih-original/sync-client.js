(() => {
  const app = window.NaDvoihApp;
  const telegram = window.Telegram?.WebApp;
  let initData = typeof telegram?.initData === "string" ? telegram.initData : "";

  // Check URL hash fallback if Telegram put initData there
  if (!initData && window.location.hash.includes("tgWebAppData=")) {
    try {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      initData = hashParams.get("tgWebAppData") || "";
    } catch (_) {}
  }

  // Persistent web fallback user ID for browser testing / non-Telegram access
  let webUserId = localStorage.getItem("na-dvoih-web-user-id");
  if (!webUserId) {
    webUserId = "u_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("na-dvoih-web-user-id", webUserId);
  }

  // Browser dev-mode support / Web fallback: if outside Telegram, allow mock or web user
  if (!initData) {
    const urlParams = new URLSearchParams(window.location.search);
    const devUserParam = urlParams.get("dev_user");
    if (devUserParam) {
      localStorage.setItem("na-dvoih-dev-user", devUserParam);
    }
    const savedDevUser = localStorage.getItem("na-dvoih-dev-user") || (window.location.port ? "1" : "");
    if (savedDevUser) {
      initData = savedDevUser === "2"
        ? "dev_user:10000002:Partner"
        : "dev_user:10000001:Gennadiy";
    } else {
      initData = `web_user:${webUserId}:Пользователь`;
    }
  }

  let localUserId = String(app?.telegramUserId || telegram?.initDataUnsafe?.user?.id || (initData.startsWith("dev_user:") ? initData.split(":")[1] : (initData.startsWith("web_user:") ? initData.split(":")[1] : webUserId)));
  const legacyStoreKey = String(app?.legacyStoreKey || "na-dvoih-prototype-v1");
  const metaKey = `${app?.storeKey || legacyStoreKey}-online-sync`;
  const api = (path, options = {}) => request(path, options);
  const byId = (id) => document.getElementById(id);
  const defaultIllustration = { trip: "suitcase", place: "coffee", food: "ramen", event: "ticket", buy: "shopping", other: "home" };
  let botUsername = "Na_dvoix2bot";
  fetch("/api/config").then((r) => r.json()).then((c) => { if (c.botUsername) botUsername = c.botUsername; }).catch(() => {});
  let metadata = readMetadata();
  let sessionInfo = null;
  let remoteItems = [];
  let remoteDeleted = [];
  let active = false;
  let applyingRemote = false;
  let syncRunning = false;
  let cycleRunning = false;
  let localRevision = 0;
  let lastLocal = snapshotLocal();
  let dirtyIds = new Set();
  let deleteIds = new Set();
  let conflicts = new Set();
  let conflictDetails = new Map();
  let legacyPreview = null;
  let syncTimer = null;

  function readMetadata() {
    try {
      const value = JSON.parse(localStorage.getItem(metaKey) || "null");
      return value && typeof value === "object" && value.items ? value : { items: {} };
    } catch {
      return { items: {} };
    }
  }

  function persistMetadata() {
    try {
      localStorage.setItem(metaKey, JSON.stringify(metadata));
      return true;
    } catch {
      setStatus("Список сохранён, но не удалось сохранить маркеры синхронизации на этом устройстве. Освободите место в браузере.");
      return false;
    }
  }

  function setStatus(message) {
    const node = byId("syncStatus");
    if (node) node.textContent = message;
  }

  function localShape(item) {
    const url = safeUrl(item.url || "");
    const preview = item.linkPreview && item.linkPreview.url === url ? item.linkPreview : null;
    return {
      id: String(item.id || ""),
      title: String(item.title || "").trim(),
      category: String(item.category || "other"),
      scope: item.scope === "personal" ? "personal" : "together",
      owner: item.scope !== "personal" ? "both" : (item.owner === "her" ? "partner" : "self"),
      note: String(item.note || ""),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      done: Boolean(item.done),
      date: item.date == null || item.date === "" ? null : String(item.date),
      reminder: item.reminder !== false,
      image: String(item.image || ""),
      imageData: String(item.imageData || ""),
      linkPreview: preview ? {
        url,
        title: String(preview.title || ""),
        description: String(preview.description || ""),
        imageData: String(preview.imageData || ""),
      } : null,
      url,
      visual: {
        background: String(item.visual?.background || "butter"),
        illustration: String(item.visual?.illustration || defaultIllustration[item.category] || "home"),
      },
    };
  }

  function safeUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value).trim());
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  }

  function apiShape(item) {
    const { version, canEdit, ...shape } = item;
    return shape;
  }

  function toLocal(item) {
    return {
      ...apiShape(item),
      owner: item.scope === "together" ? "both" : (item.owner === "partner" ? "her" : "me"),
      _serverVersion: Number(item.version),
      _canEdit: item.canEdit !== false,
    };
  }

  function snapshotLocal() {
    const result = new Map();
    for (const item of app.getState().items || []) result.set(String(item.id), localShape(item));
    return result;
  }

  function digest(value) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))
      .then((buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
  }

  function safeHeader(value) {
    try {
      return /^[\x00-\x7F]*$/.test(value) ? value : encodeURIComponent(value);
    } catch {
      return encodeURIComponent(value);
    }
  }

  async function request(path, options = {}) {
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
    try { data = await response.json(); } catch { /* handled as a generic service response */ }
    if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { code: data.error || "request_failed", status: response.status });
    return data;
  }

  function updateControls() {
    const hasSession = Boolean(initData && sessionInfo && sessionInfo.user?.id);
    const pair = sessionInfo?.pair || null;
    const isPaired = Boolean(pair && pair.memberCount === 2);
    const isWaitingPartner = Boolean(pair && pair.memberCount === 1);

    const connectedCard = byId("syncConnectedCard");
    const pairingSection = byId("syncPairingSection");
    if (connectedCard) connectedCard.hidden = !isPaired;
    if (pairingSection) pairingSection.hidden = isPaired;

    const createBtn = byId("syncCreatePair");
    const inviteBox = byId("syncInviteBox");
    if (createBtn) createBtn.hidden = isWaitingPartner && Boolean(pair?.inviteCode);
    if (inviteBox) inviteBox.hidden = !isWaitingPartner || !pair?.inviteCode;

    if (isWaitingPartner && pair?.inviteCode) {
      showInvite(pair.inviteCode);
    }

    if (isPaired) {
      setStatus("Вы в паре 💕 Общие списки синхронизируются онлайн.");
    } else if (isWaitingPartner) {
      setStatus("Код создан! Отправьте его партнёру для соединения.");
    } else {
      setStatus("Создайте свой код или введите код партнёра.");
    }

    window.dispatchEvent(new CustomEvent("na-dvoih:sync-state", {
      detail: { active: Boolean(pair), pairId: pair?.id || null, userId: sessionInfo?.user?.id || null },
    }));
  }

  function hasLegacyData() {
    try { return Boolean(localStorage.getItem(legacyStoreKey)); } catch { return false; }
  }

  function readLegacyItems() {
    let raw;
    try { raw = localStorage.getItem(legacyStoreKey); } catch { throw new Error("Не удалось прочитать прежний локальный список."); }
    if (!raw) return { raw: null, items: [] };
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error("Прежний локальный список не удалось разобрать. Исходные данные не менялись."); }
    if (!parsed || !Array.isArray(parsed.items)) throw new Error("В прежнем локальном списке нет проверяемого массива записей.");
    return { raw, items: parsed.items };
  }

  function inspectLegacy() {
    try {
      legacyPreview = readLegacyItems();
      const summary = byId("legacyTransferSummary");
      summary.textContent = `Найдено записей: ${legacyPreview.items.length}. Они пока не скопированы и не отправлены.`;
      summary.hidden = false;
      byId("legacyCopyConfirm").hidden = legacyPreview.items.length === 0;
      setStatus("Проверьте число записей и отдельно подтвердите их копирование в этот аккаунт.");
    } catch (exception) {
      legacyPreview = null;
      byId("legacyCopyConfirm").hidden = true;
      byId("legacyTransferSummary").hidden = false;
      byId("legacyTransferSummary").textContent = exception.message;
      setStatus(exception.message);
    }
  }

  function normalizeLegacyItem(item) {
    const copy = structuredClone(item);
    const shape = localShape(item);
    copy.id = shape.id;
    copy.title = shape.title;
    copy.category = shape.category;
    copy.scope = shape.scope;
    copy.owner = shape.scope === "together" ? "both" : (shape.owner === "partner" ? "her" : "me");
    delete copy._serverVersion;
    delete copy._canEdit;
    return copy;
  }

  function copyLegacyToAccount() {
    if (!legacyPreview) { inspectLegacy(); return; }
    let latest;
    try { latest = readLegacyItems(); } catch (exception) { setStatus(exception.message); return; }
    if (latest.raw !== legacyPreview.raw) {
      legacyPreview = null;
      byId("legacyCopyConfirm").hidden = true;
      setStatus("Старый список изменился после проверки. Проверьте его заново; источник не изменялся.");
      return;
    }
    const currentState = app.getState();
    const currentItems = [...(currentState.items || [])];
    const nextItems = [...currentItems];
    const byIdMap = new Map(nextItems.map((item) => [String(item.id), item]));
    const additions = [];
    for (const legacyItem of latest.items) {
      if (!legacyItem || typeof legacyItem !== "object" || Array.isArray(legacyItem)) {
        setStatus("Копирование остановлено: в старом списке есть некорректная запись. Исходные данные сохранены.");
        return;
      }
      let normalized;
      try { normalized = normalizeLegacyItem(legacyItem); } catch {
        setStatus("Копирование остановлено: в старом списке есть некорректная запись. Исходные данные сохранены.");
        return;
      }
      if (!normalized.id) {
        setStatus("Копирование остановлено: запись без ID не переносится. Исходные данные сохранены.");
        return;
      }
      const existing = byIdMap.get(normalized.id);
      if (existing) {
        if (JSON.stringify(localShape(existing)) !== JSON.stringify(localShape(normalized))) {
          setStatus(`Копирование остановлено: ID «${normalized.id.slice(0, 40)}» уже занят другой записью. Ничего не заменено.`);
          return;
        }
        continue;
      }
      byIdMap.set(normalized.id, normalized);
      additions.push(normalized);
      nextItems.push(normalized);
    }
    if (!additions.length) {
      metadata.legacyImported = true;
      persistMetadata();
      legacyPreview = null;
      updateControls();
      setStatus("Старый список проверен: новых записей для копирования нет. Исходные данные сохранены.");
      return;
    }

    const wasActive = active;
    const oldEnabled = metadata.enabled;
    if (wasActive) {
      metadata.enabled = false;
      if (!persistMetadata()) { metadata.enabled = oldEnabled; return; }
      active = false;
    }
    currentState.items = nextItems;
    if (!app.save()) {
      currentState.items = currentItems;
      app.render();
      if (wasActive) { metadata.enabled = oldEnabled; persistMetadata(); active = Boolean(oldEnabled); }
      return;
    }
    app.render();
    lastLocal = snapshotLocal();
    metadata.legacyImported = true;
    persistMetadata();
    legacyPreview = null;
    byId("legacyCopyConfirm").hidden = true;
    byId("legacyTransferSummary").textContent = `Скопировано в этот аккаунт: ${additions.length}. Исходный список оставлен без изменений; для отправки в пару отдельно подключите онлайн-список.`;
    byId("legacyTransferSummary").hidden = false;
    updateControls();
    setStatus("Старые записи скопированы только в локальный список этого Telegram-аккаунта. В пару они не отправлялись.");
  }

  async function checkDeepLinkJoin() {
    const startParam = telegram?.initDataUnsafe?.start_param ||
      new URLSearchParams(window.location.search).get("startapp") ||
      new URLSearchParams(window.location.search).get("tgWebAppStartParam") || "";
    if (startParam && startParam.startsWith("join_") && !sessionInfo?.pair) {
      const code = startParam.replace(/^join_/, "").trim();
      if (code) {
        await joinPairWithCode(code);
      }
    }
  }

  async function refreshSession() {
    if (!initData) {
      sessionInfo = null;
      active = false;
      setStatus("Синхронизация работает внутри Telegram Mini App. Вне Telegram записи сохраняются на этом устройстве.");
      updateControls();
      return;
    }
    try {
      sessionInfo = await api("/api/session");
      if (sessionInfo.user?.id) {
        localUserId = String(sessionInfo.user.id);
      }
      if (!sessionInfo.pair) {
        await checkDeepLinkJoin();
      }
      if (sessionInfo.pair) {
        active = true;
        metadata.enabled = true;
        metadata.userId = sessionInfo.user.id;
        metadata.pairId = sessionInfo.pair.id;
        persistMetadata();
      }
      updateControls();
      if (sessionInfo.pair) {
        const list = await api("/api/wishes");
        remoteItems = list.items || [];
        remoteDeleted = list.deleted || [];
        byId("syncCloudState").textContent = `Онлайн-список подключён: ${remoteItems.length} записей. Проверка изменений выполняется автоматически.`;
        setStatus("Синхронизация активна.");
        if (active) {
          if (!syncTimer) {
            syncTimer = setInterval(() => {
              if (document.visibilityState !== "hidden") syncCycle();
            }, 4000); // 4-second fast sync
          }
          syncCycle();
        }
      } else {
        setStatus("Войдите в пару: создайте новую или присоединитесь по ссылке партнёра.");
      }
    } catch (exception) {
      active = false;
      updateControls();
      setStatus(exception.code === "telegram_auth_not_configured" || exception.code === "storage_not_configured"
        ? "Серверная синхронизация пока не настроена. Локальный список продолжает работать."
        : exception.code === "telegram_init_data_expired"
          ? "Данные входа Telegram устарели. Перезапустите Mini App, чтобы обновить сессию."
          : "Не удалось связаться с сервером. Локальные записи сохранены.");
    }
  }

  async function showInvite(code) {
    if (!code) return;
    const clean = String(code).trim().replace(/[\s-]/g, "");
    const inviteNode = byId("syncInviteCode");
    if (inviteNode) {
      inviteNode.textContent = clean.length === 6 ? `${clean.slice(0, 3)} ${clean.slice(3)}` : clean;
      inviteNode.dataset.rawCode = clean;
      inviteNode.style.cursor = "pointer";
      inviteNode.title = "Нажмите, чтобы скопировать код";
      inviteNode.onclick = async () => {
        try {
          await navigator.clipboard.writeText(clean);
          window.triggerHaptic?.("success");
          setStatus(`Код ${clean} скопирован в буфер обмена! 📋`);
          const toast = byId("toast");
          if (toast) {
            toast.textContent = `Код ${clean} скопирован! 📋`;
            toast.classList.add("show");
            setTimeout(() => toast.classList.remove("show"), 2000);
          }
        } catch {
          setStatus(`Код: ${clean}`);
        }
      };
    }
    const box = byId("syncInviteBox");
    if (box) box.hidden = false;
    const createBtn = byId("syncCreatePair");
    if (createBtn) createBtn.hidden = true;

    const shareBtn = byId("syncShareInvite") || byId("syncShareTelegram");
    if (shareBtn) {
      shareBtn.onclick = () => {
        const link = `https://t.me/${botUsername}/app?startapp=join_${clean}`;
        const text = `Присоединяйся ко мне в приложении «На двоих»! 💕\n\nКод для пары:\n\`${clean}\`\n(нажми на код, чтобы скопировать)\n\nИли открой ссылку:\n${link}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
        if (telegram && typeof telegram.openTelegramLink === "function") {
          telegram.openTelegramLink(shareUrl);
        } else {
          window.open(shareUrl, "_blank");
        }
      };
    }
  }

  async function createPair() {
    try {
      setStatus("Генерируем код...");
      const result = await api("/api/pair", { method: "POST", body: {} });
      sessionInfo = { ...(sessionInfo || {}), pair: result.pair };
      if (result.inviteCode) {
        sessionInfo.pair.inviteCode = result.inviteCode;
      }
      active = Boolean(result.pair && result.pair.memberCount === 2);
      metadata.enabled = true;
      metadata.userId = sessionInfo.user.id;
      metadata.pairId = result.pair.id;
      persistMetadata();
      await showInvite(result.inviteCode);
      updateControls();
      setStatus("Код успешно создан! Отправьте его партнёру.");
      if (active) syncCycle();
    } catch (exception) {
      setStatus(exception.code === "already_in_pair" ? "Вы уже состоите в паре." : ("Не удалось создать код: " + (exception.message || "попробуйте позже.")));
    }
  }

  async function refreshInvite() {
    try {
      setStatus("Обновляем код...");
      const result = await api("/api/pair/invite", { method: "POST", body: {} });
      if (sessionInfo?.pair) sessionInfo.pair.inviteCode = result.inviteCode;
      await showInvite(result.inviteCode);
      setStatus("Новый код создан!");
    } catch (exception) {
      setStatus(exception.code === "partner_already_joined" ? "Второй участник уже присоединился." : "Не удалось создать код приглашения.");
    }
  }

  async function leavePair() {
    if (!confirm("Вы уверены, что хотите отключить синхронизацию пары?")) return;
    try {
      setStatus("Отключаем...");
      await api("/api/pair", { method: "DELETE", body: {} });
      sessionInfo = { ...(sessionInfo || {}), pair: null };
      active = false;
      metadata.enabled = false;
      metadata.pairId = null;
      persistMetadata();
      const inviteNode = byId("syncInviteCode");
      if (inviteNode) {
        inviteNode.textContent = "--- ---";
        delete inviteNode.dataset.rawCode;
      }
      const box = byId("syncInviteBox");
      if (box) box.hidden = true;
      updateControls();
      setStatus("Синхронизация отключена. Вы можете создать новую пару или присоединиться по коду.");
    } catch (exception) {
      setStatus("Не удалось отключить пару. Попробуйте позже.");
    }
  }

  async function revokeInvite() {
    try {
      await api("/api/pair/invite", { method: "DELETE", body: {} });
      byId("syncInviteCode").textContent = "";
      byId("syncInviteBox").hidden = true;
      setStatus("Код отозван.");
    } catch (exception) {
      setStatus(exception.code === "partner_already_joined"
        ? "Партнёр уже присоединился."
        : "Не удалось отозвать код приглашения.");
    }
  }

  async function joinPairWithCode(code) {
    const inviteCode = String(code || "").trim().replace(/[\s-]/g, "").toUpperCase();
    if (!inviteCode) {
      setStatus("Введите 6-значный код от партнёра.");
      return;
    }
    try {
      setStatus("Подключаемся к паре...");
      const result = await api("/api/pair/join", { method: "POST", body: { inviteCode } });
      const input = byId("syncInviteInput");
      if (input) input.value = "";
      sessionInfo = { ...(sessionInfo || {}), pair: result.pair };
      active = true;
      metadata.enabled = true;
      metadata.userId = sessionInfo.user.id;
      metadata.pairId = result.pair.id;
      persistMetadata();
      updateControls();
      setStatus("Ура! Вы успешно соединились в пару 💕");
      syncCycle();
    } catch (exception) {
      setStatus(exception.code === "invite_not_found"
        ? "Код приглашения не найден или устарел. Проверьте цифры или попросите партнёра создать новый код."
        : exception.code === "already_in_pair"
          ? "Вы уже состоите в паре."
          : ("Не удалось присоединиться к паре: " + (exception.message || "попробуйте позже.")));
    }
  }

  async function joinPair() {
    const inviteCode = byId("syncInviteInput").value.trim();
    if (!inviteCode) { setStatus("Введите код приглашения второго участника."); return; }
    await joinPairWithCode(inviteCode);
  }

  async function enableSync() {
    if (!sessionInfo?.pair) return;
    const local = (app.getState().items || []).map(localShape);
    const seen = new Set();
    for (const item of local) {
      if (!item.id || seen.has(item.id)) { setStatus("Перенос остановлен: в локальном списке есть повторяющийся или пустой ID. Локальные данные не менялись."); return; }
      seen.add(item.id);
    }
    try {
      const remote = await api("/api/wishes");
      const remoteById = new Map((remote.items || []).map((item) => [item.id, item]));
      const additions = [];
      for (const item of local) {
        const existing = remoteById.get(item.id);
        if (!existing) { additions.push(item); continue; }
        if (JSON.stringify(item) !== JSON.stringify(apiShape(existing))) {
          setStatus(`Перенос остановлен: запись «${item.title.slice(0, 50)}» имеет такой же ID, но другое содержимое в онлайн-списке. Ничего не перезаписано; локальный список сохранён.`);
          return;
        }
      }
      if (additions.length) await api("/api/wishes/import", { method: "POST", body: { items: additions } });
      const latest = await api("/api/wishes");
      const nextItems = (latest.items || []).map(toLocal);
      const oldItems = app.getState().items;
      const oldMeta = metadata;
      const nextMeta = { enabled: true, userId: sessionInfo.user.id, pairId: sessionInfo.pair.id, items: {} };
      for (const item of latest.items || []) nextMeta.items[item.id] = { version: item.version, hash: await digest(apiShape(item)) };
      applyingRemote = true;
      app.getState().items = nextItems;
      const saved = app.save();
      applyingRemote = false;
      if (!saved) {
        app.getState().items = oldItems;
        app.render();
        setStatus("Сервер принял добавление, но браузер не смог сохранить локальное состояние. Локальный список восстановлен; повторите подключение после проверки хранилища.");
        return;
      }
      metadata = nextMeta;
      if (!persistMetadata()) {
        metadata = oldMeta;
        active = false;
        setStatus("Записи объединены на сервере без перезаписи, но локальный маркер подключения не сохранился. Повторите подключение; записи останутся на месте.");
        return;
      }
      active = true;
      conflicts.clear();
      updateControls();
      byId("syncCloudState").textContent = `Онлайн-список подключён: ${nextItems.length} записей.`;
      setStatus(`Синхронизация включена. Добавлено новых записей: ${additions.length}; совпадающие записи не перезаписывались.`);
      if (!syncTimer) syncTimer = setInterval(() => { if (document.visibilityState !== "hidden") syncCycle(); }, 30_000);
      lastLocal = snapshotLocal();
      await syncCycle();
    } catch (exception) {
      active = false;
      updateControls();
      setStatus(exception.code === "item_id_conflict"
        ? "Перенос остановлен из-за одновременного изменения записи на сервере. Ничего существующего не перезаписано; локальные записи сохранены. Обновите список и повторите проверку."
        : "Не удалось подключить онлайн-список. Локальные данные не заменялись; проверьте подключение и повторите попытку.");
    }
  }

  function rememberLocalChanges() {
    if (!applyingRemote) localRevision += 1;
    const current = snapshotLocal();
    const old = lastLocal;
    lastLocal = current;
    if (!active || applyingRemote) return;
    for (const [id, item] of current) {
      if (!old.has(id) || JSON.stringify(item) !== JSON.stringify(old.get(id))) dirtyIds.add(id);
    }
    for (const id of old.keys()) {
      if (!current.has(id)) deleteIds.add(id);
    }
    syncCycle();
  }

  async function persistServerVersion(id, version, sentShape, deleted = false) {
    if (!metadata.items) metadata.items = {};
    metadata.items[id] = deleted ? { version, deleted: true, hash: "" } : { version, hash: await digest(sentShape) };
    persistMetadata();
  }

  function recordConflict(id, remoteItem = null, tombstone = null, ready = true) {
    conflicts.add(String(id));
    conflictDetails.set(String(id), { remote: remoteItem, deleted: tombstone, ready });
  }

  function renderConflicts() {
    const box = byId("syncConflictBox");
    const list = byId("syncConflictList");
    box.hidden = conflicts.size === 0;
    list.replaceChildren();
    for (const id of conflicts) {
      const detail = conflictDetails.get(id) || { remote: null, deleted: null, ready: false };
      const local = (app.getState().items || []).find((item) => String(item.id) === id);
      const row = document.createElement("section");
      row.className = "sync-conflict-row";
      row.dataset.conflictId = id;
      const title = document.createElement("div");
      title.className = "sync-conflict-title";
      title.textContent = local?.title || detail.remote?.title || `Запись ${id.slice(0, 32)}`;
      const versions = document.createElement("div");
      versions.className = "sync-conflict-versions";
      const localLine = document.createElement("span");
      localLine.textContent = `На устройстве: ${local ? `«${String(local.title || "").slice(0, 70)}»` : "удалена"}`;
      const onlineLine = document.createElement("span");
      onlineLine.textContent = detail.remote
        ? `Онлайн v${detail.remote.version}: «${String(detail.remote.title || "").slice(0, 70)}»`
        : detail.deleted ? `Онлайн v${detail.deleted.version}: удалена` : "Онлайн: запись отсутствует";
      versions.append(localLine, onlineLine);
      const help = document.createElement("p");
      const canKeepLocal = detail.remote ? detail.remote.canEdit !== false : detail.deleted ? detail.deleted.canEdit !== false : true;
      help.textContent = !detail.ready
        ? "Проверяем актуальную онлайн-версию; выбор временно недоступен."
        : canKeepLocal
          ? "Выберите одну из версий. Автоматического объединения нет."
          : "Это личная запись другого автора: оставить локальную версию может только её автор.";
      const actions = document.createElement("div");
      actions.className = "sync-conflict-actions";
      for (const [choice, label] of [["online", "Использовать онлайн"], ["local", "Оставить эту версию"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.conflictChoice = choice;
        button.textContent = label;
        button.disabled = !detail.ready || (choice === "local" && !canKeepLocal);
        actions.append(button);
      }
      row.append(title, versions, help, actions);
      list.append(row);
    }
  }

  async function saveLocalItems(nextItems) {
    const state = app.getState();
    const previousItems = state.items;
    applyingRemote = true;
    state.items = nextItems;
    const saved = app.save();
    applyingRemote = false;
    if (!saved) {
      state.items = previousItems;
      app.render();
      return false;
    }
    localRevision += 1;
    app.render();
    lastLocal = snapshotLocal();
    return true;
  }

  async function resolveConflict(id, choice) {
    const detail = conflictDetails.get(id);
    if (!detail?.ready) return;
    const row = byId("syncConflictList").querySelector(`[data-conflict-id="${CSS.escape(id)}"]`);
    row?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    const state = app.getState();
    const oldItems = [...(state.items || [])];
    const local = oldItems.find((item) => String(item.id) === id);
    try {
      if (choice === "online") {
        const nextItems = oldItems.filter((item) => String(item.id) !== id);
        if (detail.remote) nextItems.push(toLocal(detail.remote));
        if (!await saveLocalItems(nextItems)) return;
        if (detail.remote) metadata.items[id] = { version: detail.remote.version, hash: await digest(apiShape(detail.remote)) };
        else if (detail.deleted) metadata.items[id] = { version: detail.deleted.version, hash: "", deleted: true };
        else delete metadata.items[id];
        dirtyIds.delete(id);
        deleteIds.delete(id);
      } else if (choice === "local") {
        if (local) {
          const shape = localShape(local);
          const previousServerVersion = local._serverVersion;
          let result;
          if (detail.remote) {
            result = await api(`/api/wishes/${encodeURIComponent(id)}`, { method: "PUT", body: { item: shape, version: Number(detail.remote.version) } });
          } else if (detail.deleted) {
            result = await api(`/api/wishes/${encodeURIComponent(id)}/restore`, { method: "POST", body: { item: shape, version: Number(detail.deleted.version) } });
          } else {
            result = await api(`/api/wishes/${encodeURIComponent(id)}`, { method: "PUT", body: { item: shape, version: null } });
          }
          local._serverVersion = result.item.version;
          local._canEdit = result.item.canEdit !== false;
          applyingRemote = true;
          const saved = app.save();
          applyingRemote = false;
          if (!saved) {
            if (previousServerVersion === undefined) delete local._serverVersion;
            else local._serverVersion = previousServerVersion;
            app.render();
            return;
          }
          lastLocal = snapshotLocal();
          metadata.items[id] = { version: result.item.version, hash: await digest(shape) };
          dirtyIds.delete(id);
          deleteIds.delete(id);
        } else if (detail.remote) {
          const result = await api(`/api/wishes/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "If-Match": String(detail.remote.version) } });
          metadata.items[id] = { version: result.version, hash: "", deleted: true };
          deleteIds.delete(id);
          dirtyIds.delete(id);
        } else if (detail.deleted) {
          metadata.items[id] = { version: detail.deleted.version, hash: "", deleted: true };
          deleteIds.delete(id);
          dirtyIds.delete(id);
        } else {
          delete metadata.items[id];
          deleteIds.delete(id);
          dirtyIds.delete(id);
        }
      }
      conflicts.delete(id);
      conflictDetails.delete(id);
      persistMetadata();
      renderConflicts();
      setStatus("Выбор конфликта сохранён с проверкой версии. Остальные записи не изменены.");
      if (active) await syncCycle();
    } catch (exception) {
      if (exception.status === 409) {
        setStatus("Онлайн-версия снова изменилась. Ничего конфликтующего не перезаписано; повторно загружаем актуальные версии.");
        try {
          const latest = await api("/api/wishes");
          await applyRemote(latest);
          renderConflicts();
        } catch { setStatus("Не удалось обновить конфликт. Локальная и серверная версии сохранены; попробуйте ещё раз."); }
      } else {
        setStatus("Не удалось применить выбор. Обе версии сохранены; повторите действие после проверки связи.");
      }
      row?.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    }
  }

  async function pushPending() {
    if (!active || syncRunning) return;
    syncRunning = true;
    try {
      for (const id of [...deleteIds]) {
        deleteIds.delete(id);
        const base = metadata.items?.[id];
        if (!base || base.deleted) continue;
        try {
          const result = await api(`/api/wishes/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "If-Match": String(base.version) } });
          await persistServerVersion(id, result.version, null, true);
        } catch (exception) {
          if (exception.status === 409) {
            recordConflict(id, null, null, false);
            renderConflicts();
            setStatus("Удаление не применено: партнёр изменил эту запись. Серверную запись не удаляли; проверьте список и повторите решение вручную.");
          } else {
            deleteIds.add(id);
            throw exception;
          }
        }
      }
      for (const id of [...dirtyIds]) {
        dirtyIds.delete(id);
        const local = app.getState().items.find((item) => String(item.id) === id);
        if (!local) continue;
        const shape = localShape(local);
        const base = metadata.items?.[id];
        const version = base && !base.deleted ? Number(base.version) : null;
        try {
          const result = await api(`/api/wishes/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: { item: shape, version },
          });
          const sent = JSON.stringify(shape);
          await persistServerVersion(id, result.item.version, shape);
          local._serverVersion = result.item.version;
          local._canEdit = result.item.canEdit !== false;
          const latest = app.getState().items.find((item) => String(item.id) === id);
          if (latest && JSON.stringify(localShape(latest)) !== sent) dirtyIds.add(id);
          try { localStorage.setItem(app.storeKey || legacyStoreKey, JSON.stringify(app.getState())); } catch { /* server remains authoritative */ }
        } catch (exception) {
          if (exception.status === 409) {
            recordConflict(id, null, null, false);
            renderConflicts();
            setStatus("Изменение не применено: эту запись уже изменил партнёр. Обе версии сохранены без автоматической перезаписи.");
          } else {
            dirtyIds.add(id);
            throw exception;
          }
        }
      }
    } finally {
      syncRunning = false;
    }
  }

  async function applyRemote(remote) {
    const revisionAtStart = localRevision;
    const currentState = app.getState();
    const currentItems = currentState.items;
    const byLocalId = new Map(currentItems.map((item) => [String(item.id), item]));
    const nextItems = [...currentItems];
    let changed = false;
    const seenRemote = new Set();
    const nextMetaItems = { ...(metadata.items || {}) };

    function stagePermission(id, local, remoteItem) {
      const canEdit = remoteItem.canEdit !== false;
      if (local._canEdit === canEdit) return;
      const index = nextItems.findIndex((item) => String(item.id) === id);
      if (index >= 0) {
        nextItems[index] = { ...nextItems[index], _canEdit: canEdit };
        changed = true;
      }
    }

    for (const remoteItem of remote.items || []) {
      const id = String(remoteItem.id);
      seenRemote.add(id);
      const serverShape = apiShape(remoteItem);
      const serverHash = await digest(serverShape);
      const local = byLocalId.get(id);
      const base = metadata.items?.[id];
      if (local) stagePermission(id, local, remoteItem);
      if (!local) {
        if (base && !base.deleted) {
          if (Number(base.version) === Number(remoteItem.version)) {
            deleteIds.add(id);
          } else {
            recordConflict(id, remoteItem, null);
            setStatus("Локальное удаление конфликтует с изменением партнёра. Серверная запись сохранена.");
          }
          continue;
        }
        nextItems.push(toLocal(remoteItem));
        nextMetaItems[id] = { version: remoteItem.version, hash: serverHash };
        changed = true;
        continue;
      }
      const localHash = await digest(localShape(local));
      if (!base) {
        if (localHash === serverHash) {
          local._serverVersion = remoteItem.version;
          nextMetaItems[id] = { version: remoteItem.version, hash: serverHash };
        } else {
          // Auto-merge: prefer online version to prevent endless conflict popups on initial pairing
          const index = nextItems.findIndex((item) => String(item.id) === id);
          if (index >= 0) nextItems[index] = toLocal(remoteItem);
          nextMetaItems[id] = { version: remoteItem.version, hash: serverHash };
          changed = true;
        }
      } else if (base.deleted) {
        recordConflict(id, remoteItem, null);
      } else if (localHash === base.hash) {
        if (Number(base.version) !== Number(remoteItem.version) || localHash !== serverHash) {
          const index = nextItems.findIndex((item) => String(item.id) === id);
          nextItems[index] = toLocal(remoteItem);
          changed = true;
        }
        nextMetaItems[id] = { version: remoteItem.version, hash: serverHash };
      } else if (Number(base.version) === Number(remoteItem.version)) {
        dirtyIds.add(id);
      } else if (localHash === serverHash) {
        local._serverVersion = remoteItem.version;
        nextMetaItems[id] = { version: remoteItem.version, hash: serverHash };
      } else {
        recordConflict(id, remoteItem, null);
      }
    }

    for (const tombstone of remote.deleted || []) {
      const id = String(tombstone.id);
      const local = byLocalId.get(id);
      const base = metadata.items?.[id];
      if (!local) {
        nextMetaItems[id] = { version: tombstone.version, hash: "", deleted: true };
        continue;
      }
      const localHash = await digest(localShape(local));
      if (base && !base.deleted && localHash === base.hash) {
        const index = nextItems.findIndex((item) => String(item.id) === id);
        if (index >= 0) { nextItems.splice(index, 1); changed = true; }
        nextMetaItems[id] = { version: tombstone.version, hash: "", deleted: true };
      } else if (base && Number(base.version) === Number(tombstone.version) && !base.deleted) {
        deleteIds.add(id);
      } else {
        recordConflict(id, null, tombstone);
      }
    }

    for (const id of conflicts) {
      const detail = conflictDetails.get(id);
      if (detail?.ready) continue;
      recordConflict(
        id,
        (remote.items || []).find((item) => String(item.id) === id) || null,
        (remote.deleted || []).find((item) => String(item.id) === id) || null,
      );
    }

    for (const local of nextItems) {
      const id = String(local.id);
      if (!seenRemote.has(id) && !metadata.items?.[id]) dirtyIds.add(id);
    }
    if (changed) {
      if (localRevision !== revisionAtStart || app.getState().items !== currentItems) {
        setStatus("Локальный список изменился во время синхронизации. Удалённые данные не применены поверх новых локальных записей; повторите проверку.");
        return;
      }
      applyingRemote = true;
      currentState.items = nextItems;
      const saved = app.save();
      applyingRemote = false;
      if (!saved) {
        currentState.items = currentItems;
        setStatus("Обновление партнёра получено, но браузер не смог его сохранить; локальное состояние не заменено.");
        app.render();
        return;
      }
      app.render();
    }
    metadata.items = nextMetaItems;
    persistMetadata();
    remoteItems = remote.items || [];
    remoteDeleted = remote.deleted || [];
    renderConflicts();
    if (conflicts.size) setStatus(`${conflicts.size} запись(ей) требуют ручного разрешения конфликта. Ни одна конфликтующая версия автоматически не перезаписана.`);
  }

  async function syncCycle() {
    if (!active || syncRunning || cycleRunning || !sessionInfo?.pair || !initData) return;
    const revisionAtStart = localRevision;
    cycleRunning = true;
    try {
      await pushPending();
      const remote = await api("/api/wishes");
      await applyRemote(remote);
      await pushPending();
      if (!conflicts.size) setStatus("Синхронизация выполнена.");
      byId("syncCloudState").textContent = `Онлайн-список: ${remoteItems.length} записей.`;
    } catch (exception) {
      if (exception.status === 401) setStatus("Авторизация Telegram устарела. Перезапустите Mini App; локальные записи сохранены.");
      else setStatus("Нет связи с сервером. Локальные изменения сохранены и будут повторены при следующей проверке.");
    } finally {
      cycleRunning = false;
      if (active && localRevision !== revisionAtStart) setTimeout(() => syncCycle(), 250);
    }
  }

  async function openPanel() {
    app.openSyncModal?.();
    if (!initData) { await refreshSession(); return; }
    await refreshSession();
  }

  byId("openSync").addEventListener("click", openPanel);
  byId("syncClose").addEventListener("click", () => app.closeSyncModal?.());
  byId("syncCreatePair")?.addEventListener("click", createPair);
  byId("syncInviteRefresh")?.addEventListener("click", refreshInvite);
  byId("syncInviteRevoke")?.addEventListener("click", revokeInvite);
  byId("syncJoinButton")?.addEventListener("click", joinPair);
  byId("syncLeavePair")?.addEventListener("click", leavePair);
  byId("syncInviteInput")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); joinPair(); } });
  byId("syncCopyInvite")?.addEventListener("click", async () => {
    const rawCode = byId("syncInviteCode")?.dataset?.rawCode || byId("syncInviteCode")?.textContent?.replace(/\s+/g, "") || "";
    if (!rawCode || rawCode.includes("-")) {
      setStatus("Сначала сгенерируйте код.");
      return;
    }
    try {
      await navigator.clipboard.writeText(rawCode);
      setStatus(`Код ${rawCode} скопирован в буфер обмена! 📋`);
    } catch {
      setStatus(`Код: ${rawCode} (скопируйте вручную)`);
    }
  });
  window.addEventListener("na-dvoih:remote-pair-joined", () => {
    refreshSession();
  });
  window.addEventListener("na-dvoih:remote-pair-left", () => {
    refreshSession();
  });
  byId("syncEnable")?.addEventListener("click", enableSync);
  byId("syncNow")?.addEventListener("click", syncCycle);
  byId("legacyTransferCheck")?.addEventListener("click", inspectLegacy);
  byId("legacyCopyConfirm")?.addEventListener("click", copyLegacyToAccount);
  byId("syncConflictList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-conflict-choice]");
    const row = button?.closest("[data-conflict-id]");
    if (button && row) resolveConflict(row.dataset.conflictId, button.dataset.conflictChoice);
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncCycle(); });
  window.addEventListener("na-dvoih:local-save", () => {
    rememberLocalChanges();
    if (active) {
      setTimeout(() => syncCycle(), 50);
    }
  });

  if (telegram && initData) {
    try { telegram.ready(); telegram.expand?.(); } catch { /* optional Telegram presentation helpers */ }
  }
  updateControls();
  if (initData) refreshSession();

  // Instant Delta applicator for SSE events
  function applyDelta(remoteItem, isDeleted = false) {
    if (!remoteItem || !remoteItem.id) return;
    const id = String(remoteItem.id);
    const currentState = app.getState();
    const currentItems = currentState.items || [];
    const index = currentItems.findIndex((it) => String(it.id) === id);

    if (isDeleted) {
      if (index >= 0) {
        currentItems.splice(index, 1);
        app.save();
        app.render();
      }
      return;
    }

    const localItem = toLocal(remoteItem);
    if (index >= 0) {
      currentItems[index] = localItem;
    } else {
      currentItems.unshift(localItem);
    }
    app.save();
    app.render();
    if (!metadata.items) metadata.items = {};
    metadata.items[id] = { version: remoteItem.version, hash: "" };
    persistMetadata();
  }

  window.NaDvoihWishesSync = {
    sync: syncCycle,
    refreshSession: refreshSession,
    applyDelta: applyDelta
  };
})();
