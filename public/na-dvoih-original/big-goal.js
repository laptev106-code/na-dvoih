(() => {
  "use strict";

  const app = window.NaDvoihApp;
  if (!app) return;
  const state = app.getState();
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (val) => String(val ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const DEFAULT_BIG_GOAL = {
    id: "bg-main",
    title: "Наш отпуск мечты",
    goalType: "money", // "money" | "steps"
    category: "trip",
    targetAmount: 200000,
    targetSteps: 40,
    stepUnit: "урок",
    currency: "₽",
    deadline: "2027-08-15",
    note: "Лазурный берег, тёплые вечера, морской бриз и закаты только для нас двоих.",
    contributions: {
      me: 65000,
      her: 55000
    },
    stepContributions: {
      me: 0,
      her: 0
    },
    history: [
      { id: "h1", author: "me", amount: 65000, note: "Аванс и накопления", date: "2026-10-15" },
      { id: "h2", author: "her", amount: 55000, note: "Премия на работе", date: "2026-10-18" }
    ],
    milestones: [
      { id: "m1", title: "Выбрать точные даты и проверить документы", cost: 10000, done: true, by: "me" },
      { id: "m2", title: "Купить авиабилеты туда и обратно", cost: 70000, done: true, by: "her" },
      { id: "m3", title: "Забронировать отель с видом на море", cost: 80000, done: false, by: "both" },
      { id: "m4", title: "Отложить на ужины, рестораны и экскурсии", cost: 40000, done: false, by: "both" }
    ]
  };

  if (!state.bigGoal || typeof state.bigGoal !== "object") {
    state.bigGoal = structuredClone(DEFAULT_BIG_GOAL);
  }
  if (!state.bigGoal.goalType) {
    state.bigGoal.goalType = "money";
  }
  if (!state.bigGoal.contributions) {
    state.bigGoal.contributions = { me: 0, her: 0 };
  }
  if (!state.bigGoal.stepContributions) {
    state.bigGoal.stepContributions = { me: 0, her: 0 };
  }
  if (!state.bigGoal.stepUnit) {
    state.bigGoal.stepUnit = "урок";
  }
  if (!state.bigGoal.targetSteps) {
    state.bigGoal.targetSteps = 40;
  }
  if (!Array.isArray(state.bigGoal.milestones)) {
    state.bigGoal.milestones = [];
  }
  if (!Array.isArray(state.bigGoal.history)) {
    state.bigGoal.history = [];
  }

  const CATEGORY_NAMES = {
    trip: "✈️ Поездка",
    home: "🏡 Дом и уют",
    wedding: "💍 Свадьба",
    buy: "🛍️ Покупка",
    auto: "🚗 Автомобиль",
    other: "✦ Мечта"
  };

  function formatMoney(amount, currency = "₽") {
    const num = Math.round(Number(amount) || 0);
    return num.toLocaleString("ru-RU") + " " + currency;
  }

  function getGoalProgress() {
    const goal = state.bigGoal;
    const isSteps = goal.goalType === "steps";
    const target = isSteps
      ? Math.max(1, Number(goal.targetSteps) || 1)
      : Math.max(1, Number(goal.targetAmount) || 1);
    const total = isSteps
      ? (Number(goal.stepContributions?.me) || 0) + (Number(goal.stepContributions?.her) || 0)
      : (Number(goal.contributions?.me) || 0) + (Number(goal.contributions?.her) || 0);
    const percent = Math.min(100, Math.round((total / target) * 100));
    const remaining = Math.max(0, target - total);
    const unit = isSteps ? (goal.stepUnit || "шаг") : (goal.currency || "₽");
    return { target, total, percent, remaining, isSteps, unit };
  }

  function ensureGoalStyles() {
    if (q("#bigGoalStyles")) return;
    const style = document.createElement("style");
    style.id = "bigGoalStyles";
    style.textContent = `
      .big-goal-page{display:grid;gap:15px;padding-bottom:16px}
      .big-goal-card{position:relative;border:1px solid var(--line);border-radius:22px;background:var(--card);box-shadow:0 3px 12px rgba(42,50,42,.04);padding:18px;overflow:hidden}
      .big-goal-head-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--soft);font-size:12px;font-weight:700;color:var(--ink);margin-bottom:10px}
      .big-goal-title{font-size:24px;font-weight:800;letter-spacing:-.03em;line-height:1.2;color:var(--ink);margin:0 0 6px 0}
      .big-goal-note{font-size:13.5px;line-height:1.45;color:var(--muted);margin:0 0 14px 0}
      
      /* Meadow / Celebration Art Widget */
      .big-goal-meadow{position:relative;height:120px;border-radius:16px;background:linear-gradient(180deg,color-mix(in srgb,var(--green2) 45%,var(--soft)) 0%,color-mix(in srgb,var(--green2) 80%,var(--soft)) 100%);display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:16px;border:1px solid var(--soft-line)}
      .big-goal-meadow svg{width:100%;height:100%}
      .meadow-badge{position:absolute;bottom:10px;right:12px;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border:1px solid rgba(0,0,0,.06);padding:5px 11px;border-radius:999px;font-size:12.5px;font-weight:750;color:var(--green)}
      :root[data-mode="dark"] .meadow-badge{background:rgba(30,30,35,.85);color:#9ac9a6;border-color:rgba(255,255,255,.1)}

      /* Progress Bar & Amounts */
      .goal-amounts-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
      .goal-saved-big{font-size:22px;font-weight:850;color:var(--green);font-variant-numeric:tabular-nums}
      .goal-target-label{font-size:13.5px;font-weight:650;color:var(--muted)}
      .goal-progress-track{position:relative;height:16px;background:var(--soft);border-radius:999px;overflow:hidden;border:1px solid var(--soft-line)}
      .goal-progress-fill{height:100%;background:linear-gradient(90deg,var(--green) 0%,var(--action-cta,var(--coral,#df5734)) 100%);border-radius:999px;transition:width 400ms ease;box-shadow:0 0 10px rgba(48,78,69,.25)}
      .goal-meta-sub{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:12.5px;font-weight:650;color:var(--muted)}

      /* Duo Contributions */
      .duo-contrib-box{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;padding:12px;border-radius:16px;background:var(--soft);border:1px solid var(--soft-line)}
      .duo-contrib-person{display:flex;align-items:center;gap:9px}
      .duo-contrib-avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-size:18px;background:var(--card);border:2px solid var(--paper);flex:none;box-shadow:0 2px 6px rgba(0,0,0,.08)}
      .duo-contrib-copy{display:flex;flex-direction:column;min-width:0}
      .duo-contrib-name{font-size:13px;font-weight:700;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .duo-contrib-sum{font-size:15.5px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
      .goal-action-btn-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:14px}
      .step-duo-btn{display:flex;align-items:center;justify-content:center;gap:6px;min-height:50px;border-radius:15px;font-size:14px;font-weight:750;border:0;cursor:pointer;transition:transform .14s}
      .step-duo-btn:active{transform:scale(.96)}

      /* Milestones */
      .milestone-section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
      .milestone-section-title{font-size:16.5px;font-weight:800;color:var(--ink)}
      .milestone-add-btn{border:0;background:var(--soft);color:var(--green);padding:7px 12px;border-radius:12px;font-size:13px;font-weight:750;cursor:pointer}
      .milestone-list{display:grid;gap:9px}
      .milestone-item{display:grid;grid-template-columns:26px minmax(0,1fr) auto 32px;align-items:center;gap:10px;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--card);transition:transform 140ms ease,background-color 140ms ease}
      .milestone-item.done{background:color-mix(in srgb,var(--green2) 30%,var(--card))}
      .milestone-item.done .milestone-text{text-decoration:line-through;color:var(--muted)}
      .milestone-check{width:22px;height:22px;accent-color:var(--green);cursor:pointer}
      .milestone-main{min-width:0;display:flex;flex-direction:column;gap:2px}
      .milestone-text{font-size:14px;font-weight:700;line-height:1.3;color:var(--ink)}
      .milestone-sub{font-size:12.5px;color:var(--muted)}
      .milestone-badge{font-size:12px;font-weight:750;padding:4px 8px;border-radius:8px;background:var(--soft);color:var(--ink);white-space:nowrap}
      .milestone-del{width:32px;height:32px;border:0;background:transparent;color:var(--muted);font-size:18px;cursor:pointer;display:grid;place-items:center;border-radius:8px}

      /* History Accordion */
      .goal-history-details{border:1px solid var(--line);border-radius:16px;background:var(--card);overflow:hidden;margin-top:2px}
      .goal-history-summary{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;cursor:pointer;font-size:14px;font-weight:750;color:var(--ink);user-select:none}
      .goal-history-summary::-webkit-details-marker{display:none}
      .goal-history-list{display:grid;gap:8px;padding:0 16px 14px 16px;border-top:1px solid var(--soft-line);padding-top:12px}
      .goal-history-item{display:flex;align-items:center;justify-content:space-between;padding:8px 0;font-size:13px;border-bottom:1px solid var(--soft-line)}
      .goal-history-item:last-child{border-bottom:0}
      .goal-history-copy strong{color:var(--ink)}
      .goal-history-copy small{display:block;color:var(--muted);font-size:11.5px}
      .goal-history-amount{font-weight:800;color:var(--green);font-size:14px}

      /* Quick chips in contribute modal */
      .quick-chip-row{display:flex;gap:7px;overflow-x:auto;padding-bottom:2px;margin-top:6px}
      .quick-chip{flex:1;min-height:40px;border:1px solid var(--line);border-radius:11px;background:var(--soft);color:var(--ink);font-size:13px;font-weight:750;cursor:pointer;white-space:nowrap;padding:0 10px}
      .quick-chip:active{transform:scale(.95)}
      .quick-chip:active{transform:scale(.95)}
    `;
    document.head.append(style);
  }

  function getPartnerProfiles() {
    const me = state.profiles?.find((p) => p.id === "me") || { name: "Я", emoji: "✨", color: "#dbe5d9" };
    const her = state.profiles?.find((p) => p.id === "her") || { name: "Половинка", emoji: "🌸", color: "#ead9df" };
    return { me, her };
  }

  function drawGooseSvg(x, y, scale = 1, crown = false) {
    return `
      <g transform="translate(${x}, ${y}) scale(${scale})" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,0.14))">
        <!-- Body -->
        <ellipse cx="14" cy="16" rx="10" ry="7" fill="#ffffff"/>
        <!-- Tail feather -->
        <path d="M4 14 Q1 11 6 12 Z" fill="#f1f5f9"/>
        <!-- Neck & Head -->
        <path d="M18 16 Q20 10 22 7 Q24 7 24 10 Q22 14 20 17 Z" fill="#ffffff"/>
        <circle cx="23" cy="7" r="4.2" fill="#ffffff"/>
        <!-- Orange Beak -->
        <path d="M26 6 L32 7.5 L26 9 Z" fill="#f97316"/>
        <!-- Eye -->
        <circle cx="23.5" cy="6.2" r="1.1" fill="#1e293b"/>
        <!-- Wing line -->
        <path d="M10 15 Q15 19 18 15" stroke="#cbd5e1" stroke-width="1.2" fill="none" stroke-linecap="round"/>
        <!-- Webbed feet -->
        <path d="M12 23 L12 26 M16 23 L16 26" stroke="#f97316" stroke-width="1.5" stroke-linecap="round"/>
        ${crown ? '<text x="18" y="3" font-size="9">👑</text>' : ''}
      </g>
    `;
  }

  function renderMeadowSvg(percent) {
    const geeseCount = Math.max(1, Math.min(10, Math.round(percent / 10)));
    return `
      <svg viewBox="0 0 360 120" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="grassGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#b4d7ba" stop-opacity="0.38"/>
            <stop offset="100%" stop-color="#89ba92" stop-opacity="0.65"/>
          </linearGradient>
        </defs>
        <!-- Soft hill slopes -->
        <path d="M0,120 Q90,75 180,95 T360,90 L360,120 L0,120 Z" fill="url(#grassGrad)"/>
        <path d="M0,120 Q120,60 240,80 T360,70 L360,120 L0,120 Z" fill="#9ac9a6" opacity="0.3"/>
        <!-- Sun / Dream Halo -->
        <circle cx="310" cy="35" r="22" fill="#fed679" opacity="0.55"/>
        <!-- Heart balloon or flag -->
        <path d="M50 40 Q55 25 65 25 Q75 25 80 40 Q80 55 65 70 Q50 55 50 40 Z" fill="#eb6b56" opacity="0.85"/>
        <line x1="65" y1="70" x2="65" y2="105" stroke="#755536" stroke-width="1.5" stroke-dasharray="2 2"/>
        <!-- Dynamic Geese vector illustrations -->
        <g id="geeseGroup">
          ${drawGooseSvg(110, 68, 1.15)}
          ${geeseCount >= 2 ? drawGooseSvg(155, 76, 1.0) : ''}
          ${geeseCount >= 4 ? drawGooseSvg(195, 66, 1.1) : ''}
          ${geeseCount >= 6 ? drawGooseSvg(235, 78, 0.95) : ''}
          ${geeseCount >= 8 ? drawGooseSvg(270, 70, 1.05) : ''}
          ${geeseCount >= 10 ? drawGooseSvg(75, 72, 1.25, true) : ''}
        </g>
      </svg>
      <div class="meadow-badge">🌱 На полянке цели: ${geeseCount} из 10 птиц</div>
    `;
  }

  function buildBigGoalPage() {
    const content = q(".content");
    if (!content || q("#bigGoalScreen")) return;

    const screen = document.createElement("section");
    screen.id = "bigGoalScreen";
    screen.className = "feature-page big-goal-page";
    screen.hidden = true;
    screen.setAttribute("aria-labelledby", "bigGoalHeaderTitle");
    content.append(screen);
  }

  function renderBigGoal() {
    const root = q("#bigGoalScreen");
    if (!root) return;

    const goal = state.bigGoal;
    const { target, total, percent, remaining, isSteps, unit } = getGoalProgress();
    const { me, her } = getPartnerProfiles();

    const categoryLabel = CATEGORY_NAMES[goal.category] || CATEGORY_NAMES.trip;

    root.innerHTML = `
      <div class="feature-head">
        <div>
          <h2 id="bigGoalHeaderTitle">Большая цель</h2>
          <p class="feature-subtitle">${isSteps ? "Совместные шаги, занятия и победы" : "Совместная мечта, накопления и шаги"}</p>
        </div>
      </div>

      <!-- Main Dream Card -->
      <article class="big-goal-card">
        <div class="big-goal-head-badge">${isSteps ? "🎯 Мульти-трекер" : categoryLabel} · дедлайн: ${escapeHtml(goal.deadline || "Не указан")}</div>
        <h3 class="big-goal-title">${escapeHtml(goal.title)}</h3>
        <p class="big-goal-note">${escapeHtml(goal.note || (isSteps ? "Двигаемся к общей цели шаг за шагом." : "Копим вместе на главное совместное событие."))}</p>

        <!-- Meadow Visualizer -->
        <div class="big-goal-meadow">
          ${renderMeadowSvg(percent)}
        </div>

        <!-- Amounts & Bar -->
        <div class="goal-amounts-row">
          <span class="goal-saved-big">${isSteps ? `${total} <small style="font-size:15px;font-weight:700;color:var(--muted)">${escapeHtml(unit)}</small>` : formatMoney(total, goal.currency)}</span>
          <span class="goal-target-label">Цель: ${isSteps ? `${target} ${escapeHtml(unit)}` : formatMoney(target, goal.currency)}</span>
        </div>

        <div class="goal-progress-track">
          <div class="goal-progress-fill" style="width: ${percent}%;"></div>
        </div>

        <div class="goal-meta-sub">
          <span>${isSteps ? "Пройдено" : "Собрано"}: <strong>${percent}%</strong></span>
          <span>Осталось: <strong>${isSteps ? `${remaining} ${escapeHtml(unit)}` : formatMoney(remaining, goal.currency)}</strong></span>
        </div>

        <!-- Duo Contributions Split -->
        <div class="duo-contrib-box">
          <div class="duo-contrib-person">
            <span class="duo-contrib-avatar" style="background:${escapeHtml(me.color)}">${escapeHtml(me.emoji)}</span>
            <div class="duo-contrib-copy">
              <span class="duo-contrib-name">${escapeHtml(me.name || "Я")}</span>
              <span class="duo-contrib-sum">${isSteps ? `${goal.stepContributions?.me || 0} ${escapeHtml(unit)}` : formatMoney(goal.contributions.me || 0, goal.currency)}</span>
            </div>
          </div>
          <div class="duo-contrib-person">
            <span class="duo-contrib-avatar" style="background:${escapeHtml(her.color)}">${escapeHtml(her.emoji)}</span>
            <div class="duo-contrib-copy">
              <span class="duo-contrib-name">${escapeHtml(her.name || "Половинка")}</span>
              <span class="duo-contrib-sum">${isSteps ? `${goal.stepContributions?.her || 0} ${escapeHtml(unit)}` : formatMoney(goal.contributions.her || 0, goal.currency)}</span>
            </div>
          </div>
        </div>

        ${isSteps ? `
          <div class="goal-action-btn-row" style="grid-template-columns:1fr 1fr;margin-top:14px;gap:8px">
            <button type="button" class="primary-btn step-duo-btn" data-add-step="me" style="margin-top:0">👤 ${escapeHtml(me.name || "Я")}: +1</button>
            <button type="button" class="primary-btn step-duo-btn" data-add-step="her" style="margin-top:0;background:linear-gradient(135deg,#c4627d,#df5734)">🌸 ${escapeHtml(her.name || "Половинка")}: +1</button>
          </div>
          <button type="button" class="secondary-btn" id="openGoalEdit" style="width:100%;height:46px;margin-top:8px">⚙️ Настройки цели</button>
        ` : `
          <div class="goal-action-btn-row">
            <button type="button" class="primary-btn" id="openGoalContribute" style="margin-top:0">💰 Внести в копилку</button>
            <button type="button" class="secondary-btn" id="openGoalEdit" style="height:52px;padding:0 14px">⚙️ Настройки</button>
          </div>
        `}
      </article>

      <!-- Milestones Card -->
      <article class="big-goal-card">
        <div class="milestone-section-head">
          <span class="milestone-section-title">Шаги и вехи к цели</span>
          <button type="button" class="milestone-add-btn" id="openAddMilestone">＋ Добавить шаг</button>
        </div>
        <div class="milestone-list" id="goalMilestonesList">
          ${goal.milestones.length === 0 ? '<div class="feature-empty" style="padding:18px 12px">Добавьте первый важный шаг на пути к цели.</div>' : goal.milestones.map((m) => `
            <div class="milestone-item ${m.done ? "done" : ""}" data-milestone-id="${escapeHtml(m.id)}">
              <input type="checkbox" class="milestone-check" data-toggle-milestone="${escapeHtml(m.id)}" ${m.done ? "checked" : ""} aria-label="Отметить шаг">
              <div class="milestone-main">
                <span class="milestone-text">${escapeHtml(m.title)}</span>
                <span class="milestone-sub">${m.by === "me" ? escapeHtml(me.name) : m.by === "her" ? escapeHtml(her.name) : "Вместе"} ${m.done ? "✓ Выполнено" : ""}</span>
              </div>
              ${m.cost ? `<span class="milestone-badge">${formatMoney(m.cost, goal.currency)}</span>` : ""}
              <button type="button" class="milestone-del" data-del-milestone="${escapeHtml(m.id)}" aria-label="Удалить шаг">×</button>
            </div>
          `).join("")}
        </div>
      </article>

      <!-- History Accordion -->
      <details class="goal-history-details">
        <summary class="goal-history-summary">
          <span>${isSteps ? "История шагов" : "История пополнений"} (${goal.history.length})</span>
          <span style="color:var(--green)">▾</span>
        </summary>
        <div class="goal-history-list">
          ${goal.history.length === 0 ? '<div style="color:var(--muted);font-size:12px;padding:8px 0">Пока записей не было.</div>' : goal.history.map((h) => `
            <div class="goal-history-item" data-history-id="${escapeHtml(h.id)}">
              <div class="goal-history-copy">
                <strong>${h.author === "her" ? escapeHtml(her.name) : escapeHtml(me.name)}: ${escapeHtml(h.note || (isSteps ? "Шаг" : "Взнос"))}</strong>
                <small>${escapeHtml(h.date || "")}</small>
              </div>
              <span class="goal-history-amount">${h.isStep ? `+${h.amount} ${escapeHtml(unit)}` : `+${formatMoney(h.amount, goal.currency)}`}</span>
            </div>
          `).join("")}
        </div>
      </details>
    `;
  }

  function buildGoalModals() {
    if (q("#goalContributeOverlay")) return;

    // 1. Contribute Modal
    const contOverlay = document.createElement("div");
    contOverlay.className = "overlay";
    contOverlay.id = "goalContributeOverlay";
    contOverlay.setAttribute("role", "dialog");
    contOverlay.setAttribute("aria-modal", "true");
    contOverlay.setAttribute("aria-labelledby", "contributeTitle");
    contOverlay.innerHTML = `
      <section class="sheet">
        <div class="sheet-drag-handle" aria-hidden="true"></div>
        <div class="sheet-head">
          <div class="sheet-title" id="contributeTitle">Внести сумму в цель</div>
          <button class="close-btn" data-close="goalContributeOverlay" type="button" aria-label="Закрыть">×</button>
        </div>
        <form class="form-grid" id="goalContributeForm">
          <div class="field">
            <label for="contributeAuthor">Кто вносит сумму?</label>
            <select id="contributeAuthor" name="author"></select>
          </div>
          <div class="field">
            <label for="contributeAmount">Сумма (₽)</label>
            <input id="contributeAmount" name="amount" type="number" min="1" step="any" placeholder="Например: 5000" inputmode="numeric" required>
            <div class="quick-chip-row">
              <button type="button" class="quick-chip" data-quick-sum="1000">+1 000</button>
              <button type="button" class="quick-chip" data-quick-sum="5000">+5 000</button>
              <button type="button" class="quick-chip" data-quick-sum="10000">+10 000</button>
              <button type="button" class="quick-chip" data-quick-sum="25000">+25 000</button>
            </div>
          </div>
          <div class="field">
            <label for="contributeNote">Заметка или источник <span style="font-weight:400">· необязательно</span></label>
            <input id="contributeNote" name="note" maxlength="60" placeholder="Например: премия, кэшбэк, зарплата">
          </div>
          <button type="submit" class="primary-btn">Пополнить копилку 💕</button>
        </form>
      </section>
    `;

    // 2. Edit Goal Modal
    const editOverlay = document.createElement("div");
    editOverlay.className = "overlay";
    editOverlay.id = "goalEditOverlay";
    editOverlay.setAttribute("role", "dialog");
    editOverlay.setAttribute("aria-modal", "true");
    editOverlay.setAttribute("aria-labelledby", "goalEditTitle");
    editOverlay.innerHTML = `
      <section class="sheet">
        <div class="sheet-drag-handle" aria-hidden="true"></div>
        <div class="sheet-head">
          <div class="sheet-title" id="goalEditTitle">Параметры цели</div>
          <button class="close-btn" data-close="goalEditOverlay" type="button" aria-label="Закрыть">×</button>
        </div>
        <form class="form-grid" id="goalEditForm">
          <div class="field">
            <label for="goalInputTitle">Название цели</label>
            <input id="goalInputTitle" name="title" maxlength="90" required placeholder="Например: Наш отпуск в Риме или 40 уроков английского">
          </div>
          <div class="field">
            <label>Тип цели</label>
            <div class="segmented" style="margin-bottom:0">
              <button type="button" class="scope-btn" id="goalTypeMoneyBtn">💰 Накопления (₽)</button>
              <button type="button" class="scope-btn" id="goalTypeStepsBtn">🎯 Занятия / Шаги</button>
            </div>
            <input type="hidden" id="goalInputType" name="goalType" value="money">
          </div>
          <div class="field" id="goalFieldMoney">
            <label for="goalInputTarget">Необходимая сумма (₽)</label>
            <input id="goalInputTarget" name="targetAmount" type="number" min="1000" step="1000" inputmode="numeric">
          </div>
          <div class="field" id="goalFieldSteps" style="display:none">
            <label for="goalInputTargetSteps">Сколько занятий / шагов нужно пройти?</label>
            <input id="goalInputTargetSteps" name="targetSteps" type="number" min="1" step="1" inputmode="numeric" placeholder="Например: 40">
            <label for="goalInputStepUnit" style="margin-top:8px">Что считаем? <span style="font-weight:400">· единица измерения</span></label>
            <input id="goalInputStepUnit" name="stepUnit" maxlength="30" placeholder="Например: урок, занятие, тренировка, шаг">
          </div>
          <div class="field">
            <label for="goalInputCategory">Категория цели</label>
            <select id="goalInputCategory" name="category">
              <option value="trip">✈️ Поездка и путешествие</option>
              <option value="home">🏡 Дом, ремонт и уют</option>
              <option value="wedding">💍 Свадьба и торжество</option>
              <option value="buy">🛍️ Большая покупка</option>
              <option value="auto">🚗 Автомобиль</option>
              <option value="other">✦ Мечта / Развитие</option>
            </select>
          </div>
          <div class="field">
            <label for="goalInputDeadline">Дедлайн цели</label>
            <input id="goalInputDeadline" name="deadline" type="date">
          </div>
          <div class="field">
            <label for="goalInputNote">Заметка или мечта</label>
            <input id="goalInputNote" name="note" maxlength="140" placeholder="Коротко о том, почему это важно для вас">
          </div>
          <button type="submit" class="primary-btn">Сохранить изменения</button>
        </form>
      </section>
    `;

    // 3. Add Milestone Modal
    const msOverlay = document.createElement("div");
    msOverlay.className = "overlay";
    msOverlay.id = "goalMilestoneOverlay";
    msOverlay.setAttribute("role", "dialog");
    msOverlay.setAttribute("aria-modal", "true");
    msOverlay.setAttribute("aria-labelledby", "milestoneAddTitle");
    msOverlay.innerHTML = `
      <section class="sheet">
        <div class="sheet-drag-handle" aria-hidden="true"></div>
        <div class="sheet-head">
          <div class="sheet-title" id="milestoneAddTitle">Новый шаг к цели</div>
          <button class="close-btn" data-close="goalMilestoneOverlay" type="button" aria-label="Закрыть">×</button>
        </div>
        <form class="form-grid" id="goalMilestoneForm">
          <div class="field">
            <label for="msTitle">Что нужно сделать?</label>
            <input id="msTitle" name="title" maxlength="90" placeholder="Например: Купить билеты" required>
          </div>
          <div class="field">
            <label for="msCost">Примерная стоимость (₽) <span style="font-weight:400">· если требуется</span></label>
            <input id="msCost" name="cost" type="number" min="0" step="500" placeholder="Например: 50000" inputmode="numeric">
          </div>
          <div class="field">
            <label for="msBy">Кто отвечает за шаг?</label>
            <select id="msBy" name="by">
              <option value="both">💕 Вместе</option>
              <option value="me">👤 Я</option>
              <option value="her">🌸 Вторая половинка</option>
            </select>
          </div>
          <button type="submit" class="primary-btn">Добавить шаг</button>
        </form>
      </section>
    `;

    document.body.append(contOverlay, editOverlay, msOverlay);

    // Event: Close modals via [data-close]
    qa("[data-close]", contOverlay).forEach((b) => b.addEventListener("click", () => app.closeModal("goalContributeOverlay")));
    qa("[data-close]", editOverlay).forEach((b) => b.addEventListener("click", () => app.closeModal("goalEditOverlay")));
    qa("[data-close]", msOverlay).forEach((b) => b.addEventListener("click", () => app.closeModal("goalMilestoneOverlay")));
  }

  function saveBigGoal() {
    app.save();
    if (window.syncEngine) {
      window.syncEngine.mutate("goal", "bg-main", state.bigGoal, false);
    }
  }

  function bindBigGoalEvents() {
    const root = q("#bigGoalScreen");
    if (!root) return;

    // Open Contribute
    root.addEventListener("click", (e) => {
      // Add Step Increment (+1)
      const addStepBtn = e.target.closest("[data-add-step]");
      if (addStepBtn) {
        window.triggerHaptic?.("success");
        const author = addStepBtn.dataset.addStep || "me";
        const unit = state.bigGoal.stepUnit || "шаг";
        const { me, her } = getPartnerProfiles();
        const authorName = author === "her" ? (her.name || "Половинка") : (me.name || "Я");
        state.bigGoal.stepContributions = state.bigGoal.stepContributions || { me: 0, her: 0 };
        state.bigGoal.stepContributions[author] = (state.bigGoal.stepContributions[author] || 0) + 1;
        const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
        state.bigGoal.history.unshift({
          id: "h" + Date.now(),
          author,
          amount: 1,
          isStep: true,
          note: `+1 ${unit}`,
          date: today
        });
        saveBigGoal();
        renderBigGoal();
        const { total, target, percent } = getGoalProgress();
        const toast = q("#toast");
        if (toast) {
          toast.textContent = `🎯 ${authorName}: +1 ${unit}! Всего: ${total} из ${target} (${percent}%)`;
          toast.classList.add("show");
          setTimeout(() => toast.classList.remove("show"), 2800);
        }
        return;
      }

      if (e.target.closest("#openGoalContribute")) {
        window.triggerHaptic?.("light");
        const { me, her } = getPartnerProfiles();
        const sel = q("#contributeAuthor");
        sel.innerHTML = `
          <option value="me">👤 ${escapeHtml(me.name || "Я")}</option>
          <option value="her">🌸 ${escapeHtml(her.name || "Вторая половинка")}</option>
        `;
        q("#contributeAmount").value = "";
        q("#contributeNote").value = "";
        app.openModal("goalContributeOverlay");
        return;
      }

      // Open Edit
      if (e.target.closest("#openGoalEdit")) {
        window.triggerHaptic?.("light");
        const goal = state.bigGoal;
        const isSteps = goal.goalType === "steps";
        q("#goalInputTitle").value = goal.title || "";
        q("#goalInputTarget").value = goal.targetAmount || 100000;
        q("#goalInputTargetSteps").value = goal.targetSteps || 30;
        q("#goalInputStepUnit").value = goal.stepUnit || "урок";
        q("#goalInputCategory").value = goal.category || "trip";
        q("#goalInputDeadline").value = goal.deadline || "";
        q("#goalInputNote").value = goal.note || "";
        const typeInp = q("#goalInputType");
        if (typeInp) typeInp.value = isSteps ? "steps" : "money";
        q("#goalTypeMoneyBtn")?.classList.toggle("active", !isSteps);
        q("#goalTypeStepsBtn")?.classList.toggle("active", isSteps);
        const fMoney = q("#goalFieldMoney");
        const fSteps = q("#goalFieldSteps");
        if (fMoney) fMoney.style.display = isSteps ? "none" : "";
        if (fSteps) fSteps.style.display = isSteps ? "" : "none";
        app.openModal("goalEditOverlay");
        return;
      }

      // Open Add Milestone
      if (e.target.closest("#openAddMilestone")) {
        window.triggerHaptic?.("light");
        q("#msTitle").value = "";
        q("#msCost").value = "";
        app.openModal("goalMilestoneOverlay");
        return;
      }

      // Toggle Milestone Checkbox
      const toggle = e.target.closest("[data-toggle-milestone]");
      if (toggle) {
        window.triggerHaptic?.("light");
        const id = toggle.dataset.toggleMilestone;
        const item = state.bigGoal.milestones.find((m) => m.id === id);
        if (item) {
          item.done = toggle.checked;
          saveBigGoal();
          renderBigGoal();
          window.triggerHaptic?.(item.done ? "success" : "light");
        }
        return;
      }

      // Delete Milestone
      const delMs = e.target.closest("[data-del-milestone]");
      if (delMs) {
        window.triggerHaptic?.("medium");
        const id = delMs.dataset.delMilestone;
        state.bigGoal.milestones = state.bigGoal.milestones.filter((m) => m.id !== id);
        saveBigGoal();
        renderBigGoal();
        return;
      }
    });

    // Quick chip clicks in contribute form
    q("#goalContributeForm")?.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-quick-sum]");
      if (chip) {
        window.triggerHaptic?.("light");
        const sum = Number(chip.dataset.quickSum) || 0;
        const input = q("#contributeAmount");
        const cur = Number(input.value) || 0;
        input.value = cur + sum;
      }
    });

    // Submit Contribute
    q("#goalContributeForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      console.log('CONTRIBUTE SUBMITTED');
      const form = e.currentTarget;
      const author = form.elements.author.value || "me";
      const amount = Math.max(1, parseInt(form.elements.amount.value, 10) || 0);
      const note = form.elements.note.value.trim();
      const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

      state.bigGoal.contributions[author] = (state.bigGoal.contributions[author] || 0) + amount;
      state.bigGoal.history.unshift({
        id: "h" + Date.now(),
        author,
        amount,
        note,
        date: today
      });

      saveBigGoal();
      app.closeModal("goalContributeOverlay");
      renderBigGoal();
      window.triggerHaptic?.("success");
      const toast = q("#toast");
      if (toast) {
        const { percent } = getGoalProgress();
        toast.textContent = `В копилку внесено +${amount.toLocaleString("ru-RU")} ₽! Собрано: ${percent}% 🎉`;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2800);
      }
    });

    // Type switcher in Goal Edit Modal
    q("#goalTypeMoneyBtn")?.addEventListener("click", () => {
      window.triggerHaptic?.("light");
      q("#goalTypeMoneyBtn")?.classList.add("active");
      q("#goalTypeStepsBtn")?.classList.remove("active");
      const inp = q("#goalInputType");
      if (inp) inp.value = "money";
      const fMoney = q("#goalFieldMoney");
      const fSteps = q("#goalFieldSteps");
      if (fMoney) fMoney.style.display = "";
      if (fSteps) fSteps.style.display = "none";
    });
    q("#goalTypeStepsBtn")?.addEventListener("click", () => {
      window.triggerHaptic?.("light");
      q("#goalTypeStepsBtn")?.classList.add("active");
      q("#goalTypeMoneyBtn")?.classList.remove("active");
      const inp = q("#goalInputType");
      if (inp) inp.value = "steps";
      const fMoney = q("#goalFieldMoney");
      const fSteps = q("#goalFieldSteps");
      if (fMoney) fMoney.style.display = "none";
      if (fSteps) fSteps.style.display = "";
    });

    // Submit Edit
    q("#goalEditForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      state.bigGoal.title = form.elements.title.value.trim() || state.bigGoal.title;
      state.bigGoal.goalType = form.elements.goalType?.value || "money";
      state.bigGoal.targetAmount = Math.max(1000, parseInt(form.elements.targetAmount.value, 10) || state.bigGoal.targetAmount);
      state.bigGoal.targetSteps = Math.max(1, parseInt(form.elements.targetSteps?.value, 10) || 30);
      state.bigGoal.stepUnit = (form.elements.stepUnit?.value || "урок").trim();
      state.bigGoal.category = form.elements.category.value;
      state.bigGoal.deadline = form.elements.deadline.value;
      state.bigGoal.note = form.elements.note.value.trim();

      saveBigGoal();
      app.closeModal("goalEditOverlay");
      renderBigGoal();
      window.triggerHaptic?.("success");
    });

    // Submit Milestone
    q("#goalMilestoneForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const title = form.elements.title.value.trim();
      const cost = parseInt(form.elements.cost.value, 10) || null;
      const by = form.elements.by.value || "both";

      state.bigGoal.milestones.push({
        id: "m" + Date.now(),
        title,
        cost,
        done: false,
        by
      });

      saveBigGoal();
      app.closeModal("goalMilestoneOverlay");
      renderBigGoal();
      window.triggerHaptic?.("success");
    });
  }

  function init() {
    ensureGoalStyles();
    buildBigGoalPage();
    buildGoalModals();
    renderBigGoal();
    bindBigGoalEvents();

    // Hook into app renders
    const origRender = app.render;
    app.render = function () {
      origRender();
      renderBigGoal();
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
