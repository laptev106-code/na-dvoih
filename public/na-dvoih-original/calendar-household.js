(() => {
  "use strict";

  const app = window.NaDvoihApp;
  if (!app) return;
  const state = app.getState();
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const DEFAULT_HOUSEHOLD_CATEGORIES = [
    { id: "shopping", label: "Покупки", icon: "🛍️" },
    { id: "cleaning", label: "Уборка", icon: "🧹" },
    { id: "home", label: "Дом и уют", icon: "🪴" },
  ];
  state.deletedHouseholdCats = Array.isArray(state.deletedHouseholdCats) ? state.deletedHouseholdCats : [];
  state.householdCategories = Array.isArray(state.householdCategories) ? state.householdCategories : [];
  function getHouseholdCategories() {
    return [...DEFAULT_HOUSEHOLD_CATEGORIES, ...state.householdCategories].filter((c) => !state.deletedHouseholdCats.includes(c.id));
  }

  if (!Array.isArray(state.items)) state.items = [];
  if (!Array.isArray(state.householdTasks)) state.householdTasks = [];
  const savedPrefs = state.featurePrefs && typeof state.featurePrefs === "object" ? state.featurePrefs : {};
  state.featurePrefs = {
    calendar: typeof savedPrefs.calendar === "boolean" ? savedPrefs.calendar : true,
    household: typeof savedPrefs.household === "boolean" ? savedPrefs.household : true,
  };

  let screen = "ideas";
  let calendarMode = "soon";
  let monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  let selectedDate = localDateString(new Date());
  let householdFilter = "all";
  let toastTimer = 0;

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function isIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function shiftIsoDate(value, days) {
    if (!isIsoDate(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12);
    date.setDate(date.getDate() + days);
    return localDateString(date);
  }

  function calendarDateLabel(value, options = { day: "numeric", month: "long" }) {
    if (!isIsoDate(value)) return "";
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12).toLocaleDateString("ru-RU", options);
  }

  function compareDated(left, right) {
    return left.date.localeCompare(right.date, "en")
      || String(left.title || "").localeCompare(String(right.title || ""), "ru")
      || String(left.id).localeCompare(String(right.id), "en");
  }

  function datedWishes() {
    return state.items.filter((item) => isIsoDate(item.date));
  }

  function upcomingWishes(today = localDateString(new Date())) {
    return datedWishes().filter((item) => !item.done && item.date >= today).sort(compareDated);
  }

  function overdueWishes(today = localDateString(new Date())) {
    return datedWishes().filter((item) => !item.done && item.date < today).sort(compareDated);
  }

  function dueReminders(today = localDateString(new Date())) {
    return datedWishes()
      .filter((item) => !item.done && item.reminder !== false && today >= shiftIsoDate(item.date, -(Number(item.reminderDays) || 1)))
      .sort(compareDated);
  }

  function ensureStyle() {
    if (q("#calendarHouseholdStyles")) return;
    const style = document.createElement("style");
    style.id = "calendarHouseholdStyles";
    style.textContent = `
      .bottom-nav{display:grid!important;align-items:center!important;justify-content:center!important;padding-left:12px!important;padding-right:12px!important;gap:6px!important;width:100%!important}
      .bottom-nav .nav-btn[hidden]{display:none!important}
      .bottom-nav[data-visible-count="5"]{grid-template-columns:repeat(5,minmax(0,1fr))!important}
      .bottom-nav[data-visible-count="4"]{grid-template-columns:repeat(4,minmax(0,1fr))!important;max-width:390px!important;margin:0 auto!important}
      .bottom-nav[data-visible-count="3"]{grid-template-columns:repeat(3,minmax(0,1fr))!important;max-width:320px!important;margin:0 auto!important}
      .bottom-nav .nav-btn{min-width:0;white-space:nowrap;font-size:12px}
      .bottom-nav .nav-btn svg{width:24px;height:24px}
      .bottom-nav .nav-add{width:54px;height:54px}
      .feature-page[hidden],.feature-settings[hidden],.feature-calendar-view[hidden]{display:none!important}
      .feature-page{min-width:0}
      .feature-page.screen-enter{animation:screen-enter var(--motion-duration) var(--motion-easing) both}
      .feature-head{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:3px!important;margin:4px 2px 14px!important}
      .feature-head h2{margin:0!important;font-size:22px!important;letter-spacing:-.03em!important;font-weight:780!important;color:var(--ink)!important;line-height:1.2!important}
      .feature-subtitle{margin:0!important;color:var(--muted)!important;font-size:12px!important;font-weight:550!important;line-height:1.3!important}
      .feature-note{padding:9px 11px;margin:0 0 12px;border:1px solid var(--line);border-radius:12px;background:var(--soft);color:var(--muted-strong);font-size:10px;line-height:1.45}
      .feature-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin:0 0 13px;border:1px solid var(--soft-line);border-radius:13px;background:var(--soft)}
      .feature-tab{min-height:36px;border:0;border-radius:10px;background:transparent;color:var(--muted);font-size:11px;font-weight:700}
      .feature-tab.active{background:var(--card);color:var(--green);box-shadow:0 2px 7px #2d39200c}
      .calendar-reminders{display:grid;gap:7px;margin:0 0 13px;padding:11px;border:1px solid #eadac2;border-radius:15px;background:color-mix(in srgb,#f7ecd8 55%,var(--card));}
      .calendar-reminders[hidden]{display:none!important}.calendar-reminders>strong{font-size:11px;color:var(--ink)}
      .calendar-reminder-row{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:7px 9px;border:1px solid #eadfcb;border-radius:10px;background:var(--card);text-align:left;font-size:10px}
      .calendar-reminder-row span:first-child{flex:1;min-width:0;font-weight:700;overflow-wrap:anywhere}.calendar-reminder-row small{color:var(--muted);white-space:nowrap}
      .calendar-list-group{display:grid;gap:7px;margin:14px 0}
      .calendar-group-title{display:flex;align-items:center;justify-content:space-between;margin:0 2px 2px;font-size:11px;font-weight:750}
      .calendar-group-title small{color:var(--muted);font-weight:550}
      .calendar-event{display:grid;grid-template-columns:54px minmax(0,1fr) auto;align-items:center;gap:9px;padding:9px 10px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
      .calendar-event-date{color:var(--muted-strong);font-size:9px;font-weight:700;line-height:1.35}
      .calendar-event-open{min-width:0;padding:0;border:0;background:transparent;text-align:left}
      .calendar-event-open strong{display:block;overflow:hidden;text-overflow:ellipsis;font-size:11px;line-height:1.35;font-weight:730;white-space:nowrap}
      .calendar-event-open small{display:block;margin-top:3px;color:var(--muted);font-size:9px}
      .calendar-event.done{opacity:1}.calendar-event.done .calendar-event-open strong{text-decoration:line-through}
      .calendar-event-action{min-height:30px;padding:5px 7px;border:1px solid var(--line);border-radius:9px;background:var(--soft);color:var(--green);font-size:9px;font-weight:700;white-space:nowrap}
      .calendar-event-action:disabled{opacity:1;color:var(--polish-muted);border-style:dashed;cursor:not-allowed}
      .calendar-month-controls{display:flex;align-items:center;justify-content:space-between;gap:9px;margin:4px 0 10px}
      .calendar-month-controls strong{font-size:13px;font-weight:750;text-transform:capitalize}
      .calendar-month-controls button{width:34px;height:32px;border:1px solid var(--line);border-radius:10px;background:var(--card);font-size:18px;line-height:1}
      .calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
      .calendar-weekday{padding:4px 0;text-align:center;color:var(--muted);font-size:8px;font-weight:700}
      .calendar-day{position:relative;min-height:43px;padding:4px 2px;border:1px solid transparent;border-radius:10px;background:var(--card);color:var(--ink);font-size:10px}
      .calendar-day.has-events{border-color:var(--line);background:var(--field-bg)}.calendar-day.selected{border-color:var(--green);box-shadow:0 0 0 2px var(--green2);color:var(--green);font-weight:750}
      .calendar-day.today>span:first-child{display:inline-grid;place-items:center;width:19px;height:19px;border-radius:50%;background:var(--green);color:#fff}
      .calendar-day-dot{display:block;width:5px;height:5px;margin:3px auto 0;border-radius:50%;background:var(--accent-soft)}
      .calendar-day-count{position:absolute;top:2px;right:3px;color:var(--muted);font-size:7px}
      .calendar-selected{display:grid;gap:7px;margin-top:13px}.calendar-selected>strong{font-size:11px}
      .feature-empty{padding:22px 14px;border:1px dashed var(--line);border-radius:14px;background:var(--field-bg);text-align:center;color:var(--muted);font-size:10px;line-height:1.5}
      .calendar-source-highlight{outline:2px solid var(--green);outline-offset:3px;transition:outline-color var(--motion-duration) var(--motion-easing)}
      .wish-date-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border:1px solid var(--line);border-radius:999px;background:var(--soft);color:var(--muted-strong);font-size:8px;font-weight:700;white-space:nowrap}
      .calendar-date-field .reminder-choice{display:flex;align-items:center;gap:7px;margin-top:8px;color:var(--muted-strong);font-size:10px;font-weight:650}
      .calendar-date-field .reminder-choice input,.feature-toggle input{accent-color:var(--green)}
      .feature-settings{display:grid;gap:9px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
      .feature-settings-title{margin:0;font-size:12px;font-weight:750}.feature-settings-note{margin:-5px 0 2px;color:var(--muted);font-size:9px;line-height:1.4}
      .feature-toggle{display:flex;align-items:center;justify-content:space-between;gap:9px;min-height:43px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--field-bg);font-size:11px;font-weight:650}
      .feature-toggle input{width:17px;height:17px;flex:none}
      .household-toolbar{display:grid;gap:10px;margin-bottom:12px}
      .household-add{min-height:40px;padding:0 12px;border:0;border-radius:12px;background:var(--action-cta, var(--green))!important;color:#fff!important;box-shadow:0 4px 12px var(--action-cta-shadow, rgba(0,0,0,.1));font-size:11px;font-weight:750}
      .household-filters{display:flex;gap:6px;overflow:auto;padding:0 1px 3px;scrollbar-width:none}
      .household-filter{flex:none;min-height:31px;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--muted);font-size:9px;font-weight:650;white-space:nowrap}
      .household-filter.active{border-color:var(--green);background:var(--green);color:#fff}
      .household-list{display:grid;gap:8px}
      .household-task{display:grid;grid-template-columns:26px minmax(0,1fr) 38px 38px;align-items:center;gap:8px;padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
      .household-task input[type=checkbox]{width:22px;height:22px;accent-color:var(--action-cta, var(--green));cursor:pointer}
      .household-task-main{min-width:0}.household-task-main strong{display:block;overflow-wrap:anywhere;font-size:12px;line-height:1.35}
      .household-task-main small{display:block;margin-top:3px;color:var(--muted);font-size:10px}
      .household-task.done .household-task-main strong{text-decoration:line-through;color:var(--muted)}
      .household-task button{width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:10px;background:transparent;color:var(--muted);font-size:15px;touch-action:manipulation;transition:transform 80ms ease,background-color 80ms ease}
      .household-task button:active{transform:scale(.92);background:var(--soft)}
      .household-task button:hover{background:var(--soft);color:var(--green)}
      .household-task-overlay .sheet{max-height:90vh}
      .feature-status{min-height:15px;margin:9px 2px;color:var(--muted);font-size:9px;line-height:1.4}
      .calendar-event,.household-task{border-color:var(--line);border-radius:16px;background:linear-gradient(145deg,var(--card) 0%,var(--paper) 165%);box-shadow:var(--polish-shadow)}
      .calendar-reminder-row{border-color:var(--line);border-radius:12px;background:linear-gradient(145deg,var(--card),var(--paper));box-shadow:var(--polish-shadow)}
      .calendar-reminders{border-color:var(--line);border-radius:16px;box-shadow:var(--polish-shadow)}
      :root[data-mode="dark"] .calendar-reminders{border-color:var(--line);background:var(--soft)}
      .feature-note,.feature-toggle,.feature-empty{border-radius:14px;background-image:linear-gradient(145deg,rgba(255,255,255,.32),rgba(255,255,255,0) 80%);box-shadow:var(--polish-shadow)}
      :root[data-mode="dark"] .feature-note,:root[data-mode="dark"] .feature-toggle,:root[data-mode="dark"] .feature-empty{background-image:linear-gradient(145deg,rgba(255,255,255,.06),rgba(255,255,255,0) 80%)!important}
      .feature-page.screen-enter{animation:screen-enter var(--motion-duration) var(--motion-easing) both}
      .feature-subtitle,.calendar-event-date,.calendar-reminder-row small,.calendar-group-title small,.calendar-event-open small,.calendar-weekday,.calendar-day-count,.feature-empty,.feature-settings-note,.household-task-main small,.feature-status,.feature-note,.wish-date-chip{color:var(--polish-muted)}
      .calendar-event-action{border-radius:11px;background-image:linear-gradient(145deg,rgba(255,255,255,.3),rgba(255,255,255,0) 78%);color:var(--ink)}
      :root[data-mode="dark"] .calendar-event-action{background-image:linear-gradient(145deg,rgba(255,255,255,.06),rgba(255,255,255,0) 78%)!important}
      .calendar-month-controls button,.calendar-day{background-image:linear-gradient(145deg,rgba(255,255,255,.28),rgba(255,255,255,0) 78%)}
      .calendar-day{border-radius:11px;box-shadow:inset 0 1px 0 rgba(255,255,255,.42)}
      .calendar-day.selected{color:var(--ink);box-shadow:0 0 0 2px var(--green2),inset 0 1px 0 rgba(255,255,255,.42)}
      .calendar-day.today>span:first-child{background:var(--action-bg,var(--green));color:var(--action-ink,#fff)}
      .household-add,.household-filter.active{background-color:var(--action-bg,var(--green));background-image:linear-gradient(145deg,rgba(255,255,255,.04),rgba(255,255,255,0) 74%);color:var(--action-ink,#fff)}
      .household-add{border-radius:13px;box-shadow:0 4px 12px rgba(36,65,49,.16),inset 0 1px 0 rgba(255,255,255,.18)}
      @media(max-width:360px){.bottom-nav{padding-left:5px;padding-right:5px;gap:0}.bottom-nav .nav-btn{font-size:7px}.bottom-nav .nav-btn svg{width:17px;height:17px}.calendar-event{grid-template-columns:48px minmax(0,1fr) auto;gap:6px;padding:8px}.calendar-event-action{padding:4px 5px;font-size:8px}.calendar-day{min-height:39px}}
      @media(min-width:600px){.feature-page{padding-bottom:8px}}
      /* iPhone safe-area card sizing: keep dynamic feature CSS aligned with the main mobile scale. */
      @media(max-width:599px){
        .feature-head{margin:4px 2px 16px;gap:14px}.feature-head h2{font-size:22px}.feature-subtitle{font-size:13px;line-height:1.45}
        .feature-note{padding:12px 14px;margin-bottom:15px;font-size:13px}.feature-tabs{min-height:58px;margin-bottom:16px;border-radius:16px}.feature-tab{min-height:48px;font-size:14px;border-radius:12px}
        .calendar-reminders{gap:9px;margin-bottom:16px;padding:13px;border-radius:16px}.calendar-reminders>strong{font-size:14px}.calendar-reminder-row{min-height:48px;padding:10px 12px;font-size:13px}.calendar-reminder-row small{font-size:12px}
        .calendar-list-group{gap:9px;margin:16px 0}.calendar-group-title{font-size:14px}.calendar-event{grid-template-columns:70px minmax(0,1fr) auto;gap:11px;min-height:68px;padding:12px 13px;border-radius:16px}.calendar-event-date{font-size:12px}.calendar-event-open strong{font-size:14px;line-height:1.35}.calendar-event-open small{font-size:12px}.calendar-event-action{min-height:44px;padding:8px 10px;border-radius:11px;font-size:12px}
        .calendar-month-controls{margin:5px 0 13px}.calendar-month-controls strong{font-size:16px}.calendar-month-controls button{width:44px;height:44px;font-size:24px}.calendar-grid{gap:5px}.calendar-weekday{padding:5px 0;font-size:11px}.calendar-day{min-height:52px;padding:5px 2px;border-radius:12px;font-size:13px}.calendar-day.today>span:first-child{width:24px;height:24px}.calendar-day-dot{width:6px;height:6px;margin-top:4px}.calendar-day-count{top:3px;right:4px;font-size:9px}.calendar-selected{gap:9px;margin-top:16px}.calendar-selected>strong{font-size:14px}.feature-empty{padding:28px 16px;font-size:13px}
        .household-toolbar{gap:12px;margin-bottom:16px}.household-add{min-height:52px;padding:0 15px;border-radius:15px;font-size:14px}.household-filters{gap:8px;padding-bottom:4px}.household-filter{min-height:44px;padding:9px 14px;font-size:13px}.household-list{gap:10px}.household-task{grid-template-columns:28px minmax(0,1fr) 44px 44px;gap:8px;min-height:70px;padding:13px;border-radius:16px}.household-task input[type=checkbox]{width:22px;height:22px}.household-task-main strong{font-size:15px;line-height:1.35}.household-task-main small{margin-top:4px;font-size:12px}.household-task button{width:44px;height:44px;border-radius:11px;font-size:20px}.feature-status{min-height:18px;margin:11px 2px;font-size:12px}
        .bottom-nav{gap:6px}.bottom-nav[data-visible-count="5"]{grid-template-columns:repeat(5,minmax(0,1fr))!important}.bottom-nav[data-visible-count="4"]{grid-template-columns:repeat(4,minmax(0,1fr))!important;max-width:390px!important;margin:0 auto!important}.bottom-nav[data-visible-count="3"]{grid-template-columns:repeat(3,minmax(0,1fr))!important;max-width:320px!important;margin:0 auto!important}.bottom-nav .nav-btn{min-height:56px;font-size:12px}.bottom-nav .nav-btn svg{width:26px;height:26px}.bottom-nav .nav-add{width:56px;height:56px}
      }
      @media(max-width:360px){.calendar-event{grid-template-columns:62px minmax(0,1fr) auto;gap:8px;padding:10px}.calendar-event-action{padding:7px 8px;font-size:11px}.calendar-day{min-height:48px}.household-task{grid-template-columns:26px minmax(0,1fr) 40px 40px;padding:11px}.household-task button{width:40px;height:40px}.bottom-nav .nav-btn{font-size:11px}.bottom-nav .nav-btn svg{width:24px;height:24px}.bottom-nav .nav-add{width:52px;height:52px}}

    `;
    document.head.append(style);
  }

  function buildNav() {
    const nav = q(".bottom-nav");
    if (!nav || q("#navCalendar")) return;
    const calendarButton = document.createElement("button");
    calendarButton.className = "nav-btn";
    calendarButton.id = "navCalendar";
    calendarButton.type = "button";
    calendarButton.setAttribute("aria-label", "Календарь событий");
    calendarButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect><path d="M7.5 3v4M16.5 3v4M4 9.5h16"></path><path d="M8 13h2M14 13h2M8 17h2"></path></svg><span>Календарь</span>';
    const householdButton = document.createElement("button");
    householdButton.className = "nav-btn";
    householdButton.id = "navHousehold";
    householdButton.type = "button";
    householdButton.setAttribute("aria-label", "Быт");
    householdButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-7 9 7"></path><path d="M5.5 10v10h13V10M9 20v-6h6v6"></path><path d="M16 7V4h3v5"></path></svg><span>Быт</span>';
    const ideas = q("#navIdeas", nav);
    const done = q("#navDone", nav);
    const add = q("#navAdd", nav);
    const pair = q("#navPair", nav);
    nav.replaceChildren(ideas, calendarButton, add, householdButton, done);
  }

  function wrapIdeaScreen() {
    const content = q(".content");
    if (!content || q("#ideasScreen")) return;
    const ideaScreen = document.createElement("div");
    ideaScreen.id = "ideasScreen";
    ideaScreen.className = "feature-page";
    while (content.firstChild) ideaScreen.append(content.firstChild);
    content.append(ideaScreen);
  }

  function addDateFields() {
    const form = q("#wishForm");
    const note = q("#wishNote", form);
    if (!form || !note || q("#wishDate", form)) return;
    const field = document.createElement("div");
    field.className = "field calendar-date-field";
    field.innerHTML = '<label for="wishDate">Дата события <span style="font-weight:400">· необязательно</span></label><input id="wishDate" name="date" type="date"><label class="reminder-choice"><input id="wishReminder" name="reminder" type="checkbox" checked><span>Напомнить за день в приложении</span></label>';
    note.closest(".field").before(field);
  }

  function buildFeaturePages() {
    const content = q(".content");
    if (!content || q("#calendarScreen")) return;
    const calendar = document.createElement("section");
    calendar.id = "calendarScreen";
    calendar.className = "feature-page";
    calendar.hidden = true;
    calendar.setAttribute("aria-labelledby", "calendarTitle");
    calendar.innerHTML = `
      <div class="feature-head"><div><h2 id="calendarTitle">Календарь</h2><p class="feature-subtitle">События и важные даты</p></div></div>
      <div class="calendar-reminders" id="calendarReminders" aria-live="polite" hidden></div>
      <div class="feature-tabs" role="tablist" aria-label="Вид календаря"><button class="feature-tab active" type="button" data-calendar-mode="soon" role="tab" aria-selected="true">Скоро</button><button class="feature-tab" type="button" data-calendar-mode="month" role="tab" aria-selected="false">Месяц</button></div>
      <div class="feature-calendar-view" id="calendarSoonView"></div>
      <div class="feature-calendar-view" id="calendarMonthView" hidden></div>`;
    const household = document.createElement("section");
    household.id = "householdScreen";
    household.className = "feature-page";
    household.hidden = true;
    household.setAttribute("aria-labelledby", "householdTitle");
    household.innerHTML = `
      <div class="feature-head"><div><h2 id="householdTitle">Быт</h2><p class="feature-subtitle">Совместные дела и заботы</p></div></div>
      <div class="household-toolbar"><button class="household-add" id="householdAdd" type="button">＋ Новое дело</button><div class="household-filters" id="householdFilters" aria-label="Подкатегории бытовых дел"></div></div>
      <div class="household-list" id="householdList"></div>
      <div class="feature-status" id="householdSyncStatus" aria-live="polite">Синхронизировано</div>`;
    content.append(calendar, household);
  }

  function addFeatureSettings() {
    const sheet = q("#themeOverlay .sheet");
    if (!sheet || q("#featureSettings")) return;
    const block = document.createElement("section");
    block.id = "featureSettings";
    block.className = "feature-settings";
    block.setAttribute("aria-labelledby", "featureSettingsTitle");
    block.innerHTML = `
      <h3 class="feature-settings-title" id="featureSettingsTitle">Разделы приложения</h3>
      <p class="feature-settings-note">Включите или скройте разделы, которые вам нужны.</p>
      <label class="feature-toggle" for="featureCalendarToggle"><span>Календарь событий</span><input id="featureCalendarToggle" type="checkbox"></label>
      <label class="feature-toggle" for="featureHouseholdToggle"><span>Наш быт</span><input id="featureHouseholdToggle" type="checkbox"></label>`;
    sheet.append(block);
    const trigger = q("#openThemes");
    if (trigger) {
      trigger.setAttribute("aria-label", "Настройки оформления и разделов");
      trigger.title = "Настройки";
    }
  }

  function buildTaskOverlay() {
    if (q("#householdTaskOverlay")) return;
    const overlay = document.createElement("div");
    overlay.className = "overlay household-task-overlay";
    overlay.id = "householdTaskOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "householdTaskTitle");
    overlay.innerHTML = `
      <section class="sheet">
        <div class="sheet-drag-handle" aria-hidden="true"></div>
        <div class="sheet-head"><div class="sheet-title" id="householdTaskTitle">Новое дело</div><button class="close-btn" id="householdTaskClose" type="button" aria-label="Закрыть">×</button></div>
        <form class="form-grid" id="householdTaskForm">
        <input type="hidden" name="id">
        <div class="field"><label for="householdTaskCategory">Подкатегория</label><select id="householdTaskCategory" name="subcategory">${getHouseholdCategories().map((category) => `<option value="${category.id}">${category.label}</option>`).join("")}</select></div>
        <div class="field"><label for="householdTaskName">Дело</label><input id="householdTaskName" name="title" maxlength="90" placeholder="Например, купить молоко" required></div>
        <button class="primary-btn" id="householdTaskSave" type="submit">Сохранить</button>
        <button class="secondary-btn" id="householdTaskDelete" type="button" hidden>Удалить дело</button>
      </form></section>`;
    document.body.append(overlay);
  }

  function showToast(message) {
    const toast = q("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function formatDayDifference(value, today) {
    if (value === today) return "сегодня";
    if (value < today) return "дата прошла";
    const delta = Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (delta === 1) return "завтра";
    return `через ${delta} дн.`;
  }

  function renderEventRow(item, today = localDateString(new Date()), reminder = false) {
    const label = calendarDateLabel(item.date);
    const canEdit = item._canEdit !== false;
    const markButton = !item.done
      ? `<button type="button" class="calendar-event-action" data-mark-done="${escapeHtml(item.id)}" ${canEdit ? "" : "disabled aria-disabled=\"true\" title=\"Это личная запись другого автора\""}>Сбылось</button>`
      : `<span class="calendar-event-action" aria-label="Сбылось">Готово</span>`;
    return `<article class="calendar-event ${item.done ? "done" : ""}" data-calendar-item="${escapeHtml(item.id)}"><div class="calendar-event-date">${escapeHtml(label)}</div><button type="button" class="calendar-event-open" data-open-wish="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(reminder ? `Напоминание · ${formatDayDifference(item.date, today)}` : item.done ? "Сбылось" : item.date < today ? "Просрочено" : formatDayDifference(item.date, today))}</small></button>${markButton}</article>`;
  }

  function renderReminders(today) {
    const box = q("#calendarReminders");
    const items = dueReminders(today);
    box.replaceChildren();
    box.hidden = items.length === 0;
    if (!items.length) return;
    const heading = document.createElement("strong");
    heading.textContent = "Напоминания";
    box.append(heading);
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-reminder-row";
      button.dataset.openWish = String(item.id);
      const title = document.createElement("span");
      title.textContent = item.title;
      const date = document.createElement("small");
      date.textContent = `${calendarDateLabel(item.date)} · ${formatDayDifference(item.date, today)}`;
      button.append(title, date);
      box.append(button);
    }
  }

  function renderSoon(today) {
    const container = q("#calendarSoonView");
    const overdue = overdueWishes(today);
    const upcoming = upcomingWishes(today);
    container.replaceChildren();
    if (!overdue.length && !upcoming.length) {
      container.innerHTML = '<div class="feature-empty">Здесь появятся незавершённые желания с датой. Добавьте дату исходной карточке — отдельная календарная запись не создаётся.</div>';
      return;
    }
    if (overdue.length) {
      const group = document.createElement("div");
      group.className = "calendar-list-group";
      group.innerHTML = `<div class="calendar-group-title"><span>Просрочено</span><small>${overdue.length}</small></div>${overdue.map((item) => renderEventRow(item, today)).join("")}`;
      container.append(group);
    }
    if (upcoming.length) {
      const group = document.createElement("div");
      group.className = "calendar-list-group";
      group.innerHTML = `<div class="calendar-group-title"><span>Дальше</span><small>${upcoming.length}</small></div>${upcoming.map((item) => renderEventRow(item, today)).join("")}`;
      container.append(group);
    }
  }

  function renderMonth() {
    const container = q("#calendarMonthView");
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const firstDay = new Date(year, month, 1, 12);
    const firstWeekday = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const inMonth = datedWishes().filter((item) => item.date.startsWith(`${monthKey}-`));
    const labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    let cells = labels.map((label) => `<div class="calendar-weekday" role="columnheader">${label}</div>`).join("");
    for (let blank = 0; blank < firstWeekday; blank += 1) cells += '<span aria-hidden="true"></span>';
    const today = localDateString(new Date());
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${monthKey}-${String(day).padStart(2, "0")}`;
      const count = inMonth.filter((item) => item.date === iso).length;
      cells += `<button type="button" class="calendar-day ${count ? "has-events" : ""} ${iso === selectedDate ? "selected" : ""} ${iso === today ? "today" : ""}" data-calendar-date="${iso}" aria-label="${escapeHtml(calendarDateLabel(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}" aria-pressed="${iso === selectedDate}"><span>${day}</span>${count ? `<span class="calendar-day-count">${count}</span><span class="calendar-day-dot" aria-hidden="true"></span>` : ""}</button>`;
    }
    const monthName = firstDay.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    const selected = inMonth.filter((item) => item.date === selectedDate).sort(compareDated);
    container.innerHTML = `
      <div class="calendar-month-controls"><button type="button" data-month-shift="-1" aria-label="Предыдущий месяц">‹</button><strong>${escapeHtml(monthName)}</strong><button type="button" data-month-shift="1" aria-label="Следующий месяц">›</button></div>
      <div class="calendar-grid" role="grid" aria-label="${escapeHtml(monthName)}">${cells}</div>
      <div class="calendar-selected"><strong>${escapeHtml(calendarDateLabel(selectedDate, { weekday: "long", day: "numeric", month: "long" }))}</strong>${selected.length ? selected.map((item) => renderEventRow(item, today)).join("") : '<div class="feature-empty">На эту дату событий нет.</div>'}</div>`;
  }

  function renderCalendar() {
    if (!q("#calendarScreen")) return;
    const today = localDateString(new Date());
    renderReminders(today);
    q("#calendarSoonView").hidden = calendarMode !== "soon";
    q("#calendarMonthView").hidden = calendarMode !== "month";
    qa("[data-calendar-mode]").forEach((button) => {
      const active = button.dataset.calendarMode === calendarMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    renderSoon(today);
    renderMonth();
  }

  function renderHousehold() {
    if (!q("#householdScreen")) return;
    const houseCats = getHouseholdCategories();
    const filters = q("#householdFilters");
    filters.innerHTML = `<button class="household-filter ${householdFilter === "all" ? "active" : ""}" type="button" data-household-filter="all">Все</button>`
      + houseCats.map((category) => `<button class="household-filter ${householdFilter === category.id ? "active" : ""}" type="button" data-household-filter="${category.id}">${category.label}</button>`).join("");
    const tasks = state.householdTasks.filter((task) => householdFilter === "all" || task.subcategory === householdFilter)
      .sort((a, b) => Number(a.done) - Number(b.done) || String(a.title).localeCompare(String(b.title), "ru") || String(a.id).localeCompare(String(b.id), "en"));
    const list = q("#householdList");
    if (!tasks.length) {
      list.innerHTML = '<div class="feature-empty">Пока дел нет. Добавьте небольшую задачу для вас двоих.</div>';
      return;
    }
    list.innerHTML = tasks.map((task) => `<article class="household-task ${task.done ? "done" : ""}" data-household-id="${escapeHtml(task.id)}"><input type="checkbox" data-household-toggle="${escapeHtml(task.id)}" aria-label="${task.done ? "Вернуть в дела" : "Отметить выполненным"}" ${task.done ? "checked" : ""}><div class="household-task-main"><strong>${escapeHtml(task.title)}</strong><small>${houseCats.find((category) => category.id === task.subcategory)?.label || "Другие дела"}</small></div><button type="button" data-household-edit="${escapeHtml(task.id)}" aria-label="Редактировать дело">✎</button><button type="button" data-household-delete="${escapeHtml(task.id)}" aria-label="Удалить дело">×</button></article>`).join("");
  }

  function decorateWishCards() {
    qa(".wish-card[data-id]").forEach((card) => {
      const item = state.items.find((wish) => String(wish.id) === card.dataset.id);
      if (!item || !isIsoDate(item.date)) return;
      const bottom = q(".wish-bottom", card);
      if (!bottom || q(".wish-date-chip", bottom)) return;
      const chip = document.createElement("span");
      chip.className = "wish-date-chip";
      chip.textContent = `◷ ${calendarDateLabel(item.date)}`;
      chip.setAttribute("aria-label", `Дата события: ${calendarDateLabel(item.date, { day: "numeric", month: "long", year: "numeric" })}`);
      bottom.append(chip);
    });
  }

  function updateNavLayout() {
    const nav = q(".bottom-nav");
    if (!nav) return;
    const preferences = state.featurePrefs;
    const calBtn = q("#navCalendar");
    const houseBtn = q("#navHousehold");
    if (calBtn) calBtn.hidden = !preferences.calendar;
    if (houseBtn) houseBtn.hidden = !preferences.household;
    const visibleCount = Array.from(nav.children).filter((el) => !el.hidden && el.style.display !== "none").length;
    nav.dataset.visibleCount = String(visibleCount);
    nav.classList.toggle("household-enabled", !!preferences.household);
    nav.classList.toggle("calendar-enabled", !!preferences.calendar);
  }

  function renderScreens() {
    if (!q("#ideasScreen")) return;
    const preferences = state.featurePrefs;
    updateNavLayout();

    if (typeof app.getFeatureScreen === "function") {
      const appScreen = app.getFeatureScreen();
      if (appScreen) screen = appScreen;
    }

    if (!preferences.calendar && screen === "calendar") screen = "ideas";
    if (!preferences.household && screen === "household") screen = "ideas";
    q("#ideasScreen").hidden = screen !== "ideas";
    q("#calendarScreen").hidden = screen !== "calendar";
    q("#householdScreen").hidden = screen !== "household";
    q("#navCalendar")?.classList.toggle("active", screen === "calendar");
    q("#navHousehold")?.classList.toggle("active", screen === "household");
    if (screen !== "ideas") {
      q("#navIdeas")?.classList.remove("active");
      q("#navDone")?.classList.remove("active");
    }
    const hero = q(".hero");
    if (hero) hero.hidden = screen !== "ideas";
    q("#featureCalendarToggle").checked = preferences.calendar;
    q("#featureHouseholdToggle").checked = preferences.household;
    renderCalendar();
    renderHousehold();
    decorateWishCards();
  }

  function enterScreen(name) {
    if (name === "calendar" && !state.featurePrefs.calendar) return;
    if (name === "household" && !state.featurePrefs.household) return;
    window.triggerHaptic?.('light');
    screen = name;
    app.setFeatureScreen(name);
    renderScreens();
    app.animateScreen(q(`#${name}Screen`));
  }

  function openOriginalWish(id) {
    const item = state.items.find((wish) => String(wish.id) === String(id));
    if (!item) return;
    screen = "ideas";
    const targetNav = item.done ? q("#navDone") : q("#navIdeas");
    targetNav.click();
    const scopeSelect = q("#scopeSelect");
    if (scopeSelect) {
      scopeSelect.value = "all";
      scopeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    q('#categoryTabs [data-category="all"]')?.click();
    const search = q("#searchInput");
    if (search) {
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
    app.render();
    requestAnimationFrame(() => {
      const card = q(`#cards .wish-card[data-id="${CSS.escape(String(id))}"]`);
      if (!card) return;
      card.classList.add("calendar-source-highlight");
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => card.classList.remove("calendar-source-highlight"), 2400);
    });
  }
  app.showWishCard = openOriginalWish;

  function saveTaskMutation(nextTasks, oldTasks, successMessage) {
    state.householdTasks = nextTasks;
    if (!app.save()) {
      state.householdTasks = oldTasks;
      app.render();
      showToast("Не удалось сохранить на этом устройстве; исходные данные оставлены.");
      return false;
    }
    app.render();
    if (successMessage) showToast(successMessage);
    return true;
  }

  function openTaskEditor(task = null) {
    const form = q("#householdTaskForm");
    form.reset();
    form.elements.id.value = task?.id || "";
    form.elements.title.value = task?.title || "";
    form.elements.subcategory.value = task?.subcategory || "shopping";
    q("#householdTaskTitle").textContent = task ? "Редактировать дело" : "Новое дело";
    q("#householdTaskSave").textContent = task ? "Сохранить" : "Добавить дело";
    q("#householdTaskDelete").hidden = !task;
    app.openModal("householdTaskOverlay");
  }

  function closeTaskEditor() {
    app.closeModal("householdTaskOverlay");
  }

  function setFeaturePreference(name, enabled) {
    const old = { ...state.featurePrefs };
    state.featurePrefs = { ...state.featurePrefs, [name]: Boolean(enabled) };
    if (!app.save()) {
      state.featurePrefs = old;
      renderScreens();
      showToast("Не удалось сохранить настройку; прежнее значение восстановлено.");
      return;
    }
    if ((name === "calendar" && !enabled && screen === "calendar") || (name === "household" && !enabled && screen === "household")) {
      screen = "ideas";
      app.setFeatureScreen("ideas");
    }
    renderScreens();
  }

  function init() {
    ensureStyle();
    buildNav();
    wrapIdeaScreen();
    addDateFields();
    buildFeaturePages();
    addFeatureSettings();
    buildTaskOverlay();

    q("#navCalendar").addEventListener("click", () => enterScreen("calendar"));
    q("#navHousehold").addEventListener("click", () => enterScreen("household"));
    q("#navIdeas").addEventListener("click", () => { screen = "ideas"; renderScreens(); });
    q("#navDone").addEventListener("click", () => { screen = "ideas"; renderScreens(); });
    q("#navAdd").addEventListener("click", () => { screen = "ideas"; renderScreens(); });
    q("#heroAdd")?.addEventListener("click", () => { screen = "ideas"; renderScreens(); });

    q("#featureCalendarToggle").addEventListener("change", (event) => setFeaturePreference("calendar", event.currentTarget.checked));
    q("#featureHouseholdToggle").addEventListener("change", (event) => setFeaturePreference("household", event.currentTarget.checked));

    q("#calendarScreen").addEventListener("click", (event) => {
      const mode = event.target.closest("[data-calendar-mode]");
      if (mode) {
        window.triggerHaptic?.('light');
        calendarMode = mode.dataset.calendarMode;
        renderCalendar();
        return;
      }
      const shift = event.target.closest("[data-month-shift]");
      if (shift) {
        window.triggerHaptic?.('light');
        monthCursor.setMonth(monthCursor.getMonth() + Number(shift.dataset.monthShift));
        selectedDate = localDateString(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1, 12));
        renderCalendar();
        return;
      }
      const day = event.target.closest("[data-calendar-date]");
      if (day) {
        window.triggerHaptic?.('light');
        selectedDate = day.dataset.calendarDate;
        renderCalendar();
        return;
      }
      const mark = event.target.closest("[data-mark-done]");
      if (mark) {
        const item = state.items.find((wish) => String(wish.id) === mark.dataset.markDone);
        if (!item || item._canEdit === false) return;
        const old = { ...item };
        item.done = true;
        if (!app.save()) Object.assign(item, old);
        window.triggerHaptic?.('success');
        app.render();
        return;
      }
      const open = event.target.closest("[data-open-wish]");
      if (open) {
        window.triggerHaptic?.('light');
        openOriginalWish(open.dataset.openWish);
      }
    });

    q("#householdAdd").addEventListener("click", () => {
      window.triggerHaptic?.('light');
      openTaskEditor();
    });
    q("#householdFilters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-household-filter]");
      if (!button) return;
      window.triggerHaptic?.('light');
      householdFilter = button.dataset.householdFilter;
      renderHousehold();
    });
    q("#householdList").addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-household-toggle]");
      if (!checkbox) return;
      const task = state.householdTasks.find((item) => String(item.id) === checkbox.dataset.householdToggle);
      if (!task) return;
      const old = task.done;
      task.done = checkbox.checked;
      if (!app.save()) task.done = old;
      window.triggerHaptic?.(checkbox.checked ? 'success' : 'light');
      app.render();
    });
    q("#householdList").addEventListener("click", (event) => {
      const edit = event.target.closest("[data-household-edit]");
      if (edit) {
        window.triggerHaptic?.('light');
        const task = state.householdTasks.find((item) => String(item.id) === edit.dataset.householdEdit);
        if (task) openTaskEditor(task);
        return;
      }
      const remove = event.target.closest("[data-household-delete]");
      if (remove) {
        window.triggerHaptic?.('medium');
        const old = state.householdTasks;
        state.householdTasks = old.filter((task) => String(task.id) !== remove.dataset.householdDelete);
        saveTaskMutation(state.householdTasks, old, "Дело удалено.");
      }
    });

    q("#householdTaskForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const id = form.elements.id.value || `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const title = form.elements.title.value.trim();
      if (!title) return;
      window.triggerHaptic?.('success');
      const existing = state.householdTasks.find((task) => String(task.id) === id);
      const task = { ...(existing || {}), id, title, subcategory: form.elements.subcategory.value, done: existing?.done || false };
      const old = [...state.householdTasks];
      const next = existing ? old.map((item) => item.id === id ? task : item) : [task, ...old];
      if (saveTaskMutation(next, old, existing ? "Дело обновлено." : "Дело добавлено.")) closeTaskEditor();
    });
    q("#householdTaskDelete").addEventListener("click", () => {
      const id = q("#householdTaskForm").elements.id.value;
      if (!id) return;
      const old = state.householdTasks;
      state.householdTasks = old.filter((task) => String(task.id) !== id);
      if (saveTaskMutation(state.householdTasks, old, "Дело удалено.")) closeTaskEditor();
    });
    q("#householdTaskClose").addEventListener("click", closeTaskEditor);
    q("#householdTaskOverlay").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeTaskEditor();
    });

    window.addEventListener("na-dvoih:render", renderScreens);
    window.addEventListener("na-dvoih:local-save", renderScreens);
    window.addEventListener("na-dvoih:household-sync-status", (event) => {
      const status = q("#householdSyncStatus");
      if (status) status.textContent = String(event.detail?.message || "");
    });
    renderScreens();
    app.render();
  }

  init();
  window.NaDvoihCalendarHousehold = {
    isIsoDate,
    shiftIsoDate,
    upcomingWishes,
    overdueWishes,
    dueReminders,
    getScreen: () => screen,
  };
})();
