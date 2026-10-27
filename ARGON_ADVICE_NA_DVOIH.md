1. Архитектура фоновых напоминаний через Telegram Bot API

В связке Node.js + better-sqlite3 на одном инстансе Render внешние очереди (Redis/BullMQ) и системные cron-демоны избыточны. Оптимальное решение — Персистентная таблица расписания в SQLite (scheduled_notifications) + внутренний тикер (setInterval раз в 30 секунд).

Почему не считать напоминания на лету по таблице entities? В entities данные лежат в JSON (data), и парсить даты всех пар каждую минуту дорого. Специализированная таблица с B-Tree индексом по (status, notify_at) опрашивается в better-sqlite3 за ~0.05 мс (ноль нагрузки на CPU).

Схема таблицы и идемпотентный триггер

Когда mergeEntityMutation обновляет сущность с полем date или remindAt, в той же транзакции обновляется строка в scheduled_notifications.

SQL
CREATE TABLE scheduled_notifications (
    id TEXT PRIMARY KEY,               -- Детерминированный ключ: `${entityId}_${remindType}`
    couple_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    notify_at INTEGER NOT NULL,        -- Unix timestamp (ms)
    status TEXT DEFAULT 'pending',     -- 'pending' | 'processing' | 'sent' | 'failed'
    payload JSON NOT NULL,             -- {"title": "Годовщина", "remindType": "1d_before"}
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_sched_due ON scheduled_notifications(status, notify_at) 
WHERE status = 'pending';


Защита от дублей при редактировании: так как id строится детерминированно (${entityId}_morning), если партнер трижды передвинет дату события, INSERT ... ON CONFLICT(id) DO UPDATE просто перезапишет notify_at и вернет status = 'pending'.

Воркер доставки + Deep Linking (startapp)

Для открытия сразу нужной карточки используется формат прямой ссылки на Mini App: [https://t.me/Na_dvoix2bot/app?startapp=ent_$](https://t.me/Na_dvoix2bot/app?startapp=ent_$){entityType}_${entityId} (где app — short_name вашего WebApp в @BotFather), либо кнопка web_app с параметром в URL. Параметр startapp позволяет передавать только A-Z, a-z, 0-9, _, - (до 64 символов).

JavaScript
// notification-worker.js
const claimDueNotifications = db.transaction((now, batchSize = 25) => {
  // Атомарно забираем пачку и лочим статус, чтобы при лаге сети не отправить дважды
  const rows = db.prepare(`
    SELECT sn.*, c.user1_tg_id, c.user2_tg_id
    FROM scheduled_notifications sn
    JOIN couples c ON c.id = sn.couple_id
    WHERE sn.status = 'pending' AND sn.notify_at <= ?
    LIMIT ?
  `).all(now, batchSize);

  const markProcessing = db.prepare(`
    UPDATE scheduled_notifications SET status = 'processing', updated_at = ? WHERE id = ?
  `);
  for (const r of rows) markProcessing.run(now, r.id);
  return rows;
});

async function processNotificationsTick() {
  const now = Date.now();
  const dueList = claimDueNotifications(now);
  if (dueList.length === 0) return;

  for (const item of dueList) {
    const { title } = JSON.parse(item.payload);
    const tgIds = [item.user1_tg_id, item.user2_tg_id].filter(Boolean);
    
    // Формируем Deep Link с параметром start_param
    const startParam = `${item.entity_type}_${item.entity_id}`;
    const replyMarkup = {
      inline_keyboard: [[{
        text: '✨ Открыть карточку',
        url: `https://t.me/Na_dvoix2bot?startapp=${startParam}`
      }]]
    };

    // Параллельная отправка обоим партнерам
    const results = await Promise.allSettled(
      tgIds.map(chatId => sendTelegramMessage(chatId, `🔔 Напоминание: *${escapeMd(title)}*`, replyMarkup))
    );

    // Если хотя бы одному ушло успешно (второй мог заблокировать бота) — считаем доставленным
    const anySuccess = results.some(r => r.status === 'fulfilled');
    db.prepare(`
      UPDATE scheduled_notifications 
      SET status = ?, updated_at = ? 
      WHERE id = ?
    `).run(anySuccess ? 'sent' : 'failed', Date.now(), item.id);
  }
}

setInterval(processNotificationsTick, 30_000);

Перехват Deep Link на клиенте (Роутер)

При старте приложения проверяем initDataUnsafe.start_param:

JavaScript
// app-init.js
const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
if (startParam) {
  // Формат: "date_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  const [entityType, ...idParts] = startParam.split('_');
  const entityId = idParts.join('_');
  
  // Даем стейту отрендериться из localStorage и открываем шторку/карточку
  requestAnimationFrame(() => {
    switchTabForEntityType(entityType);
    openEntityModalAndHighlight(entityId);
  });
}

2. Жизненный цикл событий: State Machine и раздел «История»
Computed View против фиксации expired в БД

Никогда не пишите фоновый джоб, который в полночь меняет в БД статус planned -> expired.

Проблема часовых поясов: на сервере UTC, пара живет в Москве или Владивостоке (или один партнер в командировке).

Лишний трафик: полуночный апдейт сгенерирует пачку мутаций в sync_log и заставит клиентов качать пустые дельты.

Правильное решение: Гибридная модель (Explicit Storage + Computed Runtime State).

В data сущности хранятся только явные действия человека: status: 'planned' | 'completed' | 'archived' и dueDate: '2026-10-27' (строка YYYY-MM-DD в локальном времени пары, без привязки к часам, если время не задано).

Состояние expired вычисляется на лету на клиенте через чистую функцию-селектор при рендере.

JavaScript
// state-selectors.js
export function getComputedLifecycle(entity, todayLocalStr = getLocalYYYYMMDD()) {
  const { status = 'planned', dueDate } = entity.data;

  // 1. Явные терминальные статусы
  if (status === 'completed') return 'COMPLETED';
  if (status === 'archived')  return 'ARCHIVED';

  // 2. События без даты — вечные в активном списке (Someday / Backlog)
  if (!dueDate) return 'ACTIVE_SOMEDAY';

  // 3. Сравнение строк YYYY-MM-DD лексикографически корректно
  if (dueDate < todayLocalStr) {
    // Grace-период: вчерашние события еще висят в активных с мягкой плашкой «Вчера»,
    // а всё что старше — улетает в Историю (Пропущенные)
    const diffDays = calcDaysDiff(dueDate, todayLocalStr);
    return diffDays === 1 ? 'ACTIVE_YESTERDAY' : 'EXPIRED_HISTORY';
  }

  return 'ACTIVE_UPCOMING';
}

Схема переходов (State Machine)

Активный экран («Планы / Даты»): показывает ACTIVE_UPCOMING, ACTIVE_YESTERDAY (подсвечены теплым янтарным бейджем «Вчера — получилось сделать?») и ниже блок ACTIVE_SOMEDAY («Без даты / Идеи»).

Экран «История» (две вкладки или два блока):

«Ждут решения» (EXPIRED_HISTORY): карточки, дата которых прошла более 24 часов назад, но галочка completed не нажата.

«Тёплый архив» (COMPLETED + ARCHIVED): выполненные дела и прошедшие памятные даты.

UX-паттерны для просроченных карточек (Zero Guilt Design)

В парном приложении нельзя использовать агрессивный красный цвет и слово «Просрочено» (это превращает уютное пространство в корпоративный Jira/Битрикс24). Используйте формулировку «Осталось позади» и панель быстрых действий в 1 тап прямо на карточке:

[ ✓ Было сделано ] — переводит status: 'completed', но оставляет старую dueDate, чтобы в истории сохранилась реальная дата события, а не день, когда о нем вспомнили.

[ ↻ Перенести ] — вызывает микро-поповер с 3 чипсами: На завтра, На выходные, Без даты (в идеи). Одно нажатие отправляет дельту { dueDate: newDate } через syncEngine.mutate(), и карточка с пружинной анимацией возвращается в активный список.

[ ✕ Неактуально ] — ставит status: 'archived' (скрывает без безвозвратного удаления).

3. Большая цель: Архитектура Composite Goal (Мульти-трекер)

Чтобы «Большая цель» (например, «Переезд к морю» или «Свадьба мечты») не ломала ваш Field-Level LWW движок при одновременных нажатиях +1 двумя партнерами, нельзя хранить общий счетчик одним числом currentStep: 15. Если оба в метро нажмут +1, оба пришлют currentStep: 16, и один шаг потеряется.

Бесконфликтная структура данных (Partner-Split Counters)

Внутри JSON карточки main_goal каждый под-трек хранит вклады партнеров в разных ключах (u1 и u2). Так как field_ts отслеживает верхнеуровневые ключи data, вынесите прогресс каждого трека и каждого партнера в плоские ключи data с префиксом track_${trackId}_${userId}, либо храните под-треки как дочерние сущности entityType = 'goal_track' с parentGoalId.

Вариант с плоскими ключами внутри одной сущности goal идеален: 0 новых таблиц, мгновенная работа вашего текущего Field-Level LWW!

JSON
{
  "id": "goal_main_01",
  "type": "goal",
  "data": {
    "title": "Переезд в Испанию 🇪🇸",
    "deadline": "2027-06-01",
    "createdAt": 1727740800000,

    "tracks_meta": {
      "tr_budget": { "title": "Подушка безопасности", "type": "finance", "target": 500000, "unit": "₽", "weight": 0.5 },
      "tr_eng":    { "title": "Уроки испанского",     "type": "step",    "target": 45,     "unit": "ур.", "weight": 0.3 },
      "tr_docs":   { "title": "Сбор документов",      "type": "check",   "target": 5,      "unit": "док.", "weight": 0.2 }
    },

    "val_tr_budget_u1": 140000,
    "val_tr_budget_u2": 110000,
    "val_tr_eng_u1": 12,
    "val_tr_eng_u2": 8,
    "val_tr_docs_u1": 2,
    "val_tr_docs_u2": 1,

    "history_tr_budget": [
      { "ts": 1728000000000, "uid": "u1", "delta": 50000 },
      { "ts": 1729500000000, "uid": "u2", "delta": 60000 }
    ]
  }
}


Почему это гениально ложится на ваш движок:

Когда Гена жмет +1 урок, клиент вызывает:syncEngine.mutate('goal', 'goal_main_01', { val_tr_eng_u1: currentU1 + 1 }).

Если партнерша в ту же секунду жмет +1 урок у себя, её клиент шлет:syncEngine.mutate('goal', 'goal_main_01', { val_tr_eng_u2: currentU2 + 1 }).

Ключи val_tr_eng_u1 и val_tr_eng_u2 разные! Серверный Field-Level LWW сливает их без единого конфликта. Итоговая сумма трека всегда равна val_u1 + val_u2.

Из коробки вы получаете красивую визуализацию долей участия: прогресс-бар трека красится в два оттенка (например, теплый коралловый — вклад партнера А, мятный — вклад партнера Б).

Формулы расчета общего прогресса и прогноза (ETA)

На клиенте пишется чистый вычислитель прогресса и скорости (Velocity):

𝑃
total
=
∑
𝑖
=
1
𝑁
𝑤
𝑖
⋅
min
⁡
(
1
,
𝑉
𝑖
,
𝑢
1
+
𝑉
𝑖
,
𝑢
2
𝑇
𝑖
)
P
total
	​

=
i=1
∑
N
	​

w
i
	​

⋅min(1,
T
i
	​

V
i,u1
	​

+V
i,u2
	​

	​

)

Где 
𝑤
𝑖
w
i
	​

 — вес трека (если веса не заданы вручную, 
𝑤
𝑖
=
1
𝑁
w
i
	​

=
N
1
	​

), а 
𝑇
𝑖
T
i
	​

 — целевое значение target.

JavaScript
// goal-analytics.js
export function calculateGoalMetrics(goalData) {
  const meta = goalData.tracks_meta || {};
  const trackIds = Object.keys(meta);
  if (trackIds.length === 0) return { totalPercent: 0, etaDate: null, isOnTrack: true };

  let weightedSum = 0;
  let totalWeight = 0;

  const tracksComputed = trackIds.map(tid => {
    const cfg = meta[tid];
    const u1Val = Number(goalData[`val_${tid}_u1`] || 0);
    const u2Val = Number(goalData[`val_${tid}_u2`] || 0);
    const current = u1Val + u2Val;
    const progress = Math.min(1, current / cfg.target);
    const weight = cfg.weight || (1 / trackIds.length);

    weightedSum += progress * weight;
    totalWeight += weight;

    return { id: tid, ...cfg, u1Val, u2Val, current, progressPercent: Math.round(progress * 100) };
  });

  const totalProgress = totalWeight > 0 ? (weightedSum / totalWeight) : 0; // 0.0 .. 1.0
  const totalPercent = Math.round(totalProgress * 100);

  // Расчет темпа (Velocity) и прогнозной даты закрытия (ETA)
  const now = Date.now();
  const elapsedDays = Math.max(1, (now - (goalData.createdAt || now)) / 86_400_000);
  const progressPerDay = totalProgress / elapsedDays;

  let etaDate = null;
  let daysRemainingEstimate = null;
  if (totalProgress > 0.02 && totalProgress < 1) {
    daysRemainingEstimate = Math.ceil((1 - totalProgress) / progressPerDay);
    etaDate = new Date(now + daysRemainingEstimate * 86_400_000).toISOString().slice(0, 10);
  }

  // Сравнение с дедлайном
  const isOnTrack = (!goalData.deadline || !etaDate) ? true : (etaDate <= goalData.deadline);

  return {
    totalPercent,
    tracksComputed,
    etaDate,
    daysRemainingEstimate,
    isOnTrack
  };
}

Тактильный UX для шаговых треков (+1)

Для треков типа step (уроки, тренировки, вождение) вместо скучного инпута сделайте кнопку [ +1 шаг ] прямо на карточке:

При нажатии вызывается Telegram.WebApp.HapticFeedback.impactOccurred('medium').

Если с этим нажатием трек достиг 100% — вызывайте HapticFeedback.notificationOccurred('success') и легкий всплеск конфетти.

4. Унификация Top Bar: переход к тактильной Duotone-системе

Проблема классических Material-иконок — одинаковая жесткая толщина линии (2px), острые углы и пустота внутри контура. Рядом с теплой иконкой обратной связи они выглядят как технический интерфейс из настроек роутера.

3 правила «Уютного парного UI» для иконок и топбара:

Duotone-заливка (Двухслойный SVG): каждая иконка состоит из двух частей:

Фоновый мягкий шейп с прозрачностью fill="currentColor" fill-opacity="0.16" (дает объем и «теплоту»).

Основной контур со скругленными концами (stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8").

Мягкие островки (Pills / Squircle) вместо голых иконок: иконка в топбаре не должна висеть в воздухе. Поместите её в тактильную капсулу с полупрозрачным фоном, легким внутренним бликом сверху (inset 0 1px 0 rgba(255,255,255,0.25)) и пружинным сжатием при тапе (transform: scale(0.92)).

Единая оптическая сетка 22×22px внутри кнопки 38×38px.

Готовый CSS + SVG-пак для Top Bar
CSS
/* topbar-tactile.css */
.na-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: rgba(255, 250, 246, 0.78); /* Теплый молочный оттенок вместо холодного белого */
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border-bottom: 1px solid rgba(230, 215, 205, 0.45);
}

/* Группа иконок в форме единого или раздельных мягких островков */
.na-topbar-actions {
  display: flex;
  gap: 8px;
}

.na-icon-pill {
  position: relative;
  width: 38px;
  height: 38px;
  border-radius: 13px; /* Мягкий squircle-эффект */
  border: 1px solid rgba(225, 205, 195, 0.5);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(252, 244, 238, 0.75) 100%);
  box-shadow: 
    0 2px 6px rgba(140, 100, 80, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  color: #6E564B; /* Теплый кофейно-графитовый вместо черного #000 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.na-icon-pill:active {
  transform: scale(0.91);
}

/* Акцентное состояние (например, когда открыта История или есть уведомление) */
.na-icon-pill.is-active {
  color: #E06D53; /* Теплый терракотово-коралловый */
  border-color: rgba(224, 109, 83, 0.35);
  background: rgba(255, 238, 232, 0.85);
}

Единый набор Duotone SVG-иконок для топбара (в одном стиле с фидбеком):
HTML
<!-- 1. Иконка «История / Тёплый архив» (Часы с мягким сердечком/листом внутри) -->
<button class="na-icon-pill" id="btn-history" aria-label="История">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.5" fill="currentColor" fill-opacity="0.14"/>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.3-5.8M3.5 4.5v2.2h2.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M12 8.5v3.8l2.5 1.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
</button>

<!-- 2. Иконка «Статус пары / Связь» (Два переплетенных мягких кольца с заливкой) -->
<button class="na-icon-pill" id="btn-pair-status" aria-label="Пара">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="9.5" cy="12" r="5.5" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="14.5" cy="12" r="5.5" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="1.8"/>
  </svg>
</button>

<!-- 3. Иконка «Обратная связь / Идеи» (Уютный баббл с искрой/сердцем в том же Duotone-стиле) -->
<button class="na-icon-pill is-active" id="btn-feedback" aria-label="Отзыв">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M12 20.2c4.7 0 8.5-3.4 8.5-7.6S16.7 5 12 5 3.5 8.4 3.5 12.6c0 2.1.9 4 2.5 5.4l-1.1 2.5 3.1-1c1.2.5 2.6.7 4 .7Z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M12 14.8s-2.5-1.6-2.5-3.1c0-.8.6-1.4 1.4-1.4.5 0 .9.3 1.1.7.2-.4.6-.7 1.1-.7.8 0 1.4.6 1.4 1.4 0 1.5-2.5 3.1-2.5 3.1Z" fill="currentColor"/>
  </svg>
</button>


Если в топбаре также отображается индикатор partner_online (из вашего SSE-стрима), встройте его прямо в капсулу пары (#btn-pair-status) как маленькую пульсирующую точку #34C759 с мягким свечением box-shadow: 0 0 8px rgba(52, 199, 89, 0.6) — это сэкономит место в шапке и добавит ощущение живого присутствия партнера.
