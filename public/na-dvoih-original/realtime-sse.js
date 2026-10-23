/**
 * Real-Time SSE Synchronization Engine for «На двоих»
 * Implemented based on Argon Architectural Blueprint (Section 1).
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

  const localUserId = String(telegram?.initDataUnsafe?.user?.id || (initData.startsWith("dev_user:") ? initData.split(":")[1] : (initData.startsWith("web_user:") ? initData.split(":")[1] : webUserId)));
  let eventSource = null;
  let reconnectTimer = null;
  let lastEventId = localStorage.getItem("na-dvoih-last-event-id") || "0";
  let toastTimer = null;

  function showPartnerToast(message) {
    let toast = document.getElementById("partnerRealtimeToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "partnerRealtimeToast";
      toast.style.cssText = `
        position: fixed;
        top: calc(var(--safe-top, 12px) + 14px);
        left: 50%;
        transform: translate(-50%, -20px);
        background: var(--card, #fff);
        color: var(--green, #304e45);
        border: 1px solid var(--line, #ecebe4);
        padding: 8px 16px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 700;
        box-shadow: 0 8px 24px rgba(44,55,47,.15);
        display: flex;
        align-items: center;
        gap: 8px;
        z-index: 100;
        opacity: 0;
        pointer-events: none;
        transition: transform .25s cubic-bezier(.2,.8,.2,1), opacity .25s ease;
      `;
      document.body.appendChild(toast);
    }

    toast.innerHTML = `<span style="font-size: 14px;">⚡</span> ${message}`;
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translate(-50%, 0)";
    });

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translate(-50%, -15px)";
    }, 2800);
  }

  function connectSSE() {
    if (!initData) return;
    if (eventSource) {
      try { eventSource.close(); } catch {}
      eventSource = null;
    }

    const encodedInit = encodeURIComponent(initData);
    const url = `/api/stream?initData=${encodedInit}&clientUserId=${encodeURIComponent(webUserId)}&lastEventId=${lastEventId}`;

    try {
      eventSource = new EventSource(url);

      eventSource.addEventListener("connected", (e) => {
        if (e.lastEventId) {
          lastEventId = e.lastEventId;
          localStorage.setItem("na-dvoih-last-event-id", lastEventId);
        }
      });

      // Household / Tasks events
      const onHouseholdEvent = (e) => {
        if (e.lastEventId) {
          lastEventId = e.lastEventId;
          localStorage.setItem("na-dvoih-last-event-id", lastEventId);
        }
        let data = {};
        try { data = JSON.parse(e.data); } catch {}
        
        // If the action was done by partner, trigger immediate sync & haptic
        if (data.authorTelegramId && String(data.authorTelegramId) !== localUserId) {
          window.NaDvoihHaptics?.impact?.("light");
          const isDone = data.task?.completed;
          const msg = isDone ? "Партнёр выполнил пункт ✨" : "Партнёр обновил дела / покупки 🛒";
          showPartnerToast(msg);
        }
        
        window.NaDvoihHouseholdSync?.sync?.();
      };

      eventSource.addEventListener("household:created", onHouseholdEvent);
      eventSource.addEventListener("household:updated", onHouseholdEvent);
      eventSource.addEventListener("household:deleted", onHouseholdEvent);

      // Wishes / Notes events
      const onWishesEvent = (e) => {
        if (e.lastEventId) {
          lastEventId = e.lastEventId;
          localStorage.setItem("na-dvoih-last-event-id", lastEventId);
        }
        let data = {};
        try { data = JSON.parse(e.data); } catch {}

        if (data.authorTelegramId && String(data.authorTelegramId) !== localUserId) {
          window.NaDvoihHaptics?.impact?.("light");
          showPartnerToast("Партнёр обновил общее пространство 💌");
        }

        window.NaDvoihWishesSync?.sync?.();
      };

      eventSource.addEventListener("wishes:created", onWishesEvent);
      eventSource.addEventListener("wishes:updated", onWishesEvent);
      eventSource.addEventListener("wishes:deleted", onWishesEvent);

      // Pair joined event
      eventSource.addEventListener("pair:joined", (e) => {
        window.NaDvoihHaptics?.notification?.("success");
        showPartnerToast("Партнёр подключился к паре! 🎉");
        window.NaDvoihWishesSync?.refreshSession?.();
      });

      // Pair left / unpair event
      eventSource.addEventListener("pair:left", (e) => {
        showPartnerToast("Партнёр отключил пару");
        window.NaDvoihWishesSync?.refreshSession?.();
      });

      eventSource.onerror = () => {
        // EventSource automatically retries, but if connection is closed:
        if (eventSource && eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();
          eventSource = null;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectSSE, 4000);
        }
      };
    } catch (err) {
      console.warn("[Realtime SSE] Connection error:", err.message);
    }
  }

  // Auto-reconnect on visibility change (wake up from sleep)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
        connectSSE();
      }
    }
  });

  window.addEventListener("focus", () => {
    if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
      connectSSE();
    }
  });

  // Start connection
  if (initData) {
    // Delay slightly to let initial app mount finish
    setTimeout(connectSSE, 300);
  }

  window.NaDvoihRealtime = {
    connect: connectSSE,
    disconnect: () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }
  };
})();
