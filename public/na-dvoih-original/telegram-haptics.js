(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  const haptic = tg?.HapticFeedback;

  const Haptics = {
    impact(style = "light") {
      try { haptic?.impactOccurred(style); } catch {}
    },
    notification(type = "success") {
      try { haptic?.notificationOccurred(type); } catch {}
    },
    selection() {
      try { haptic?.selectionChanged(); } catch {}
    },
  };

  window.NaDvoihHaptics = Haptics;

  if (tg) {
    try {
      tg.ready();
      tg.expand?.();
      if (typeof tg.enableClosingConfirmation === "function") {
        tg.enableClosingConfirmation();
      }
      if (typeof tg.disableVerticalSwipes === "function" || (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7"))) {
        tg.disableVerticalSwipes?.();
      }
    } catch {}
  }

  // Sync Telegram header and background colors with app theme
  function syncTelegramTheme() {
    if (!tg) return;
    try {
      const styles = getComputedStyle(document.documentElement);
      const paper = styles.getPropertyValue("--paper").trim() || "#f8f7f2";
      const outer = styles.getPropertyValue("--outer").trim() || "#ecefe9";
      tg.setHeaderColor?.(paper);
      tg.setBackgroundColor?.(outer);
    } catch {}
  }

  // Update Telegram native BackButton depending on current screen & modals
  function updateBackButton() {
    if (!tg?.BackButton) return;
    const openModal = document.querySelector(".overlay.open:not(.closing)");
    const app = window.NaDvoihApp;
    const currentScreen = app?.getFeatureScreen?.() || "ideas";

    if (openModal) {
      tg.BackButton.show();
      return;
    }

    if (currentScreen !== "ideas") {
      tg.BackButton.show();
      return;
    }

    tg.BackButton.hide();
  }

  if (tg?.BackButton) {
    tg.BackButton.onClick(() => {
      const openModal = document.querySelector(".overlay.open:not(.closing)");
      const app = window.NaDvoihApp;
      if (openModal) {
        Haptics.impact("light");
        app?.closeModal?.(openModal.id);
        setTimeout(updateBackButton, 220);
        return;
      }
      if (app?.getFeatureScreen?.() !== "ideas") {
        Haptics.impact("light");
        app?.setFeatureScreen?.("ideas");
        setTimeout(updateBackButton, 100);
      }
    });
  }

  // Delegated Haptics listeners on interactions
  document.addEventListener("click", (e) => {
    const target = e.target;

    // Scope & category switches
    if (target.closest(".scope-btn, .cat-chip, .feature-tab, .household-filter")) {
      Haptics.selection();
      return;
    }

    // Tab navigation buttons
    if (target.closest(".nav-btn:not(.nav-add)")) {
      Haptics.impact("light");
      setTimeout(updateBackButton, 50);
      return;
    }

    // Hero or Floating Add button
    if (target.closest(".nav-add, #heroAdd, #householdAdd")) {
      Haptics.impact("medium");
      setTimeout(updateBackButton, 150);
      return;
    }

    // Done checkmark toggle
    if (target.closest('[data-action="toggle"], .household-task button')) {
      Haptics.notification("success");
      return;
    }

    // Theme or Mode trigger
    if (target.closest(".theme-trigger, .mode-trigger, .theme-choice")) {
      Haptics.selection();
      setTimeout(syncTelegramTheme, 100);
      return;
    }

    // Modal open / close triggers
    if (target.closest("[data-close], .close-btn, #openProfiles, #openSync, #openThemes")) {
      Haptics.impact("light");
      setTimeout(updateBackButton, 220);
      return;
    }

    // Delete wish
    if (target.closest("#deleteWish")) {
      Haptics.notification("warning");
      setTimeout(updateBackButton, 220);
      return;
    }
  }, true);

  // Form submit success haptic
  document.addEventListener("submit", () => {
    Haptics.notification("success");
    setTimeout(updateBackButton, 220);
  }, true);

  // Observer on overlay modals to keep BackButton state synchronized
  const modalObserver = new MutationObserver(() => {
    updateBackButton();
  });
  document.querySelectorAll(".overlay").forEach((el) => {
    modalObserver.observe(el, { attributes: true, attributeFilter: ["class"] });
  });

  window.addEventListener("na-dvoih:render", () => {
    syncTelegramTheme();
    updateBackButton();
  });

  // Initial sync
  document.addEventListener("DOMContentLoaded", () => {
    syncTelegramTheme();
    updateBackButton();
  });
  setTimeout(() => {
    syncTelegramTheme();
    updateBackButton();
  }, 300);
})();
