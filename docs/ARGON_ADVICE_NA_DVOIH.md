1. Мгновенная синхронизация (Real-Time Sync)

Для связки Node.js + Express + better-sqlite3 оптимальный выбор — Server-Sent Events (SSE) + стандартные REST-мутации (POST/PATCH/DELETE).

Сравнение подходов для вашего стека
Решение	Плюсы	Минусы	Вердикт
SSE + REST	Нативный авто-реконнект в браузере (EventSource), поддержка Last-Event-ID, работает поверх обычного HTTP без проблем с прокси и Nginx, ноль сторонних библиотек.	Односторонний канал (сервер -> клиент), мутации идут обычным fetch.	Оптимально. Идеально ложится на Express и мобильные сети.
WebSocket (ws)	Двусторонний канал с минимальным оверхедом.	Нужно вручную писать логику реконнекта, пинг-понгов, буферизации пропущенных пакетов и настраивать Upgrade-заголовки в Nginx.	Избыточно для задач/заметок на двоих (нет высокочастотного стриминга координат).
Supabase / Turso	Готовый инфраструктурный слой.	Требует переписывания синхронного слоя better-sqlite3 на асинхронные SDK, привязка к внешним лимитам и задержкам сети до облачной БД.	Неоправданный рефакторинг при наличии рабочего better-sqlite3.
Реализация Room-based SSE с поддержкой обрывов связи

Для защиты от потери данных при переключении Wi-Fi <-> LTE на смартфонах используется кольцевой буфер событий или таблица sync_events в SQLite. Браузерный EventSource при обрыве сам переподключается и автоматически отправляет заголовок Last-Event-ID.

Бэкенд (Express + better-sqlite3):

JavaScript
// Таблица для лога событий (позволяет дослать пропущенное при реконнекте)
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_sync_ws_id ON sync_log(workspace_id, id);
`);

// Хранилище активных подключений: Map<workspaceId, Set<Response>>
const rooms = new Map();

// SSE-эндпоинт
app.get('/api/stream', authMiddleware, (req, res) => {
  const { workspaceId } = req.user;
  // Поддержка заголовка при авто-реконнекте или query-параметра при первом старте
  const lastEventId = parseInt(req.headers['last-event-id'] || req.query.lastEventId || '0', 10);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Критично для Nginx: отключает буферизацию ответа
  });

  // Регистрация клиента в комнате
  if (!rooms.has(workspaceId)) rooms.set(workspaceId, new Set());
  rooms.get(workspaceId).add(res);

  // Досылка пропущенных за время оффлайна событий
  if (lastEventId > 0) {
    const missedEvents = db.prepare(
      'SELECT id, event_type, payload FROM sync_log WHERE workspace_id = ? AND id > ? ORDER BY id ASC LIMIT 100'
    ).all(workspaceId, lastEventId);

    for (const ev of missedEvents) {
      res.write(`id: ${ev.id}\nevent: ${ev.event_type}\ndata: ${ev.payload}\n\n`);
    }
  } else {
    // Отправка текущего максимального ID при свежем подключении
    const lastRow = db.prepare('SELECT MAX(id) as maxId FROM sync_log WHERE workspace_id = ?').get(workspaceId);
    res.write(`id: ${lastRow?.maxId || 0}\nevent: connected\ndata: {"status":"ok"}\n\n`);
  }

  // Heartbeat каждые 25 сек, чтобы мобильный оператор или Nginx не закрыли сокет по таймауту
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const room = rooms.get(workspaceId);
    if (room) {
      room.delete(res);
      if (room.size === 0) rooms.delete(workspaceId);
    }
  });
});

// Функция бродкаста (вызывается внутри POST/PATCH/DELETE роутов)
function broadcastToWorkspace(workspaceId, eventType, data) {
  const payload = JSON.stringify(data);
  
  // 1. Записываем событие в БД (синхронно за доли миллисекунды)
  const info = db.prepare(
    'INSERT INTO sync_log (workspace_id, event_type, payload) VALUES (?, ?, ?)'
  ).run(workspaceId, eventType, payload);
  
  const eventId = info.lastInsertRowid;

  // 2. Отправляем активным клиентам в комнате
  const clients = rooms.get(workspaceId);
  if (!clients) return;

  const message = `id: ${eventId}\nevent: ${eventType}\ndata: ${payload}\n\n`;
  for (const clientRes of clients) {
    clientRes.write(message);
  }
}

// Очистка старых логов раз в сутки (оставляем только последние 24 часа)
setInterval(() => {
  db.prepare('DELETE FROM sync_log WHERE created_at < unixepoch() - 86400').run();
}, 3600000);


Фронтенд (Vanilla JS):

JavaScript
class SyncManager {
  constructor(initData, onUpdate) {
    this.initData = initData;
    this.onUpdate = onUpdate;
    this.es = null;
    this.lastEventId = localStorage.getItem('last_sync_id') || 0;
    this.connect();

    // При сворачивании/разворачивании Telegram WebView на iOS сокет часто засыпает
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (!this.es || this.es.readyState === EventSource.CLOSED)) {
        this.connect();
      }
    });
  }

  connect() {
    if (this.es) this.es.close();
    const url = `/api/stream?initData=${encodeURIComponent(this.initData)}&lastEventId=${this.lastEventId}`;
    this.es = new EventSource(url);

    const handleEvent = (e) => {
      if (e.lastEventId) {
        this.lastEventId = e.lastEventId;
        localStorage.setItem('last_sync_id', e.lastEventId);
      }
      this.onUpdate(e.type, JSON.parse(e.data));
    };

    ['todo:updated', 'note:created', 'calendar:changed'].forEach(type => {
      this.es.addEventListener(type, handleEvent);
    });

    this.es.onerror = () => {
      // Браузер сам переподключится через ~3 секунды, передав Last-Event-ID
    };
  }
}

2. Выбор хостинга для 24/7 Production

Для стека Node.js + better-sqlite3 + постоянные соединения (SSE/WS) архитектура бессерверных функций (Vercel) не подходит.

Сравнение вариантов
Критерий	а) Render / Railway / Fly.io	б) Vercel + Turso	в) Дешевый VPS (1 vCPU, 1GB RAM)
Поддержка SQLite	Нативная только при платном подключении Persistent Volume (на Free-тарифах диск стирается при ребилде или засыпании).	Требует отказа от better-sqlite3 и переписывания всех запросов на асинхронный @libsql/client.	Идеальная. Локальный SSD, режим PRAGMA journal_mode = WAL, нулевая сетевая задержка до БД.
Работа с SSE / WS	На бесплатных тарифах контейнер засыпает через 15 минут простоя — холодный старт занимает до 30–50 секунд.	Serverless-функции имеют жесткий таймаут выполнения и не держат долгие SSE/WS-соединения.	Без ограничений. Процесс живет постоянно в памяти, отклик мгновенный.
Доступность из РФ	Fly.io и Render периодически попадают под блокировки подсетей ТСПУ (Cloudflare/Fastly диапазоны).	Частые проблемы с доступностью edge-узлов без VPN.	Любой локальный или европейский хостер с чистым IP работает стабильно.
Бюджет	$5–7/мес за отсутствие сна и диск.	$0, но требует смены архитектуры БД и отказа от SSE.	150–300 ₽/мес ($2–3).
Рекомендуемая конфигурация: Вариант В (VPS + Nginx + PM2)

Для приложения на двоих 1 vCPU и 1 GB RAM выдержат тысячи подобных комнат, так как Node.js + better-sqlite3 потребляют около 45–60 МБ RAM.

Настройка SQLite для продакшена (при старте сервера):

JavaScript
db.pragma('journal_mode = WAL'); // Неблокирующее чтение и запись одновременно
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');


Конфигурация Nginx для корректной работы SSE и статики:

Nginx
server {
    listen 443 ssl http2;
    server_name app.yourdomain.ru;

    # SSL сертификаты от Let's Encrypt (Certbot)

    root /var/www/tma-planner/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Настройки специально для SSE (/api/stream)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}


Автоматический бэкап SQLite:
Добавьте в crontab -e команду безопасного горячего бэкапа без остановки сервера:

Bash
0 4 * * * sqlite3 /var/www/tma-planner/data/app.db ".backup '/var/backups/app_$(date +\%F).db'" && find /var/backups/ -mtime +7 -delete

3. Продуктовые Retention-механики и фоновые уведомления

Главный враг уведомлений в совместных списках — спам. Если один партнер отмечает в магазине 10 купленных продуктов подряд, второй не должен получить 10 отдельных сообщений в Telegram.

4 эффективные Retention-механики для двоих

Умная агрегация уведомлений (Debounced Batching + Edit-in-Place):
Когда партнер меняет список покупок или закрывает задачи, сервер ждет 45 секунд тишины (debounce) и отправляет одно сводное сообщение. Если в течение следующих 15 минут партнер снова что-то меняет — бот не шлет новое сообщение, а вызывает editMessageText у предыдущего, дополняя сводку.

Silence-on-Active (Подавление пушей при открытом WebApp):
Бэкенд проверяет таблицу активных SSE-соединений (rooms.get(workspaceId)). Если у второго партнера прямо сейчас открыт Mini App (в комнате 2 активных соединения), пуш в чат бота не отправляется — партнер и так видит изменения на экране в реальном времени.

Контекстный «Пинг одной кнопкой» (Quick Nudge):
Внутри интерфейса списка покупок кнопка «Я в магазине — проверь список». Отправляет партнеру сообщение в Telegram с Inline-кнопкой web_app, которая сразу открывает приложение на вкладке покупок (?startapp=shopping).

Еженедельная капсула / Дайджест по воскресеньям:
Раз в неделю крон-скрипт собирает статистику из БД: сколько задач закрыто вместе, какое событие близко в календаре, и достает 1 случайное фото/запись из модуля «Таймлайн воспоминаний» («Ровно 3 месяца назад: ...»).

Техническая реализация Debounced-уведомлений с Edit-in-Place

Не требует сторонних очередей (Redis/BullMQ), реализуется нативным Map в памяти Node.js и встроенным fetch (Node 18+):

JavaScript
const BOT_TOKEN = process.env.BOT_TOKEN;
const pendingBatches = new Map(); // Key: `${workspaceId}:${targetTelegramId}`

/**
 * Вызывается при любом действии пользователя
 * @param {Object} params - { workspaceId, actorName, targetChatId, actionText }
 */
function queuePartnerNotification({ workspaceId, actorName, targetChatId, actionText }) {
  // 1. Если партнер сейчас онлайн в приложении (в комнате >= 2 человек) — не шлем пуш в ТГ
  const activeClients = rooms.get(workspaceId);
  if (activeClients && activeClients.size >= 2) return;

  const key = `${workspaceId}:${targetChatId}`;
  const now = Date.now();

  if (!pendingBatches.has(key)) {
    pendingBatches.set(key, {
      actions: [],
      timer: null,
      lastMessageId: null,
      lastSentAt: 0
    });
  }

  const batch = pendingBatches.get(key);
  batch.actions.push(actionText);

  if (batch.timer) clearTimeout(batch.timer);

  // Ждем 30 секунд после последнего действия перед отправкой
  batch.timer = setTimeout(async () => {
    const lines = batch.actions.map(a => `• ${a}`).join('\n');
    const text = `🔔 <b>${actorName}</b> обновил(а) планер:\n\n${lines}`;
    
    const replyMarkup = {
      inline_keyboard: [[
        { text: 'Открыть планер', web_app: { url: process.env.WEBAPP_URL } }
      ]]
    };

    try {
      // Если с момента прошлого пуша прошло меньше 10 минут — редактируем старое сообщение
      const canEdit = batch.lastMessageId && (Date.now() - batch.lastSentAt < 600000);
      const method = canEdit ? 'editMessageText' : 'sendMessage';
      const body = {
        chat_id: targetChatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
        ...(canEdit && { message_id: batch.lastMessageId })
      };

      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const result = await res.json();
      if (result.ok && !canEdit) {
        batch.lastMessageId = result.result.message_id;
        batch.lastSentAt = Date.now();
        // Сохраняем накопленные действия на случай последующего редактирования
      } else if (!canEdit) {
        batch.actions = [];
      }
    } catch (err) {
      console.error('TG Notify Error:', err.message);
      batch.actions = [];
    }
  }, 30000);
}

4. Нативная интеграция Telegram WebApp API
4.1. Обертка над HapticFeedback

Вызовы виброотклика нужно оборачивать в хелпер с проверкой версии API, чтобы избежать ошибок в десктопном клиенте или старых версиях.

JavaScript
const tg = window.Telegram.WebApp;

export const Haptic = {
  // Клик по чекбоксу задачи, переключение вкладки
  tap: () => tg.HapticFeedback?.impactOccurred('light'),
  // Перетаскивание элемента, смена дуо-темы
  medium: () => tg.HapticFeedback?.impactOccurred('medium'),
  // Завершение всех покупок в списке, создание важного события
  success: () => tg.HapticFeedback?.notificationOccurred('success'),
  // Удаление заметки или отмена действия
  warning: () => tg.HapticFeedback?.notificationOccurred('warning'),
  // Ошибка валидации или сети
  error: () => tg.HapticFeedback?.notificationOccurred('error'),
  // Прокрутка пикера дат/времени
  selection: () => tg.HapticFeedback?.selectionChanged()
};

4.2. Контроллер стека навигации для BackButton и MainButton

В SPA без фреймворков частая ошибка — навешивать несколько onClick слушателей на MainButton, которые начинают срабатывать одновременно при переходе между экранами. Решается единым контроллером состояния.

JavaScript
class UIController {
  constructor() {
    this.historyStack = [];
    this.mainBtnCallback = null;

    tg.BackButton.onClick(() => this.popView());
    tg.MainButton.onClick(() => {
      if (this.mainBtnCallback) {
        Haptic.tap();
        this.mainBtnCallback();
      }
    });
  }

  // Вызывать при открытии модалки, заметки или вложенного экрана
  pushView(onBackCallback) {
    this.historyStack.push(onBackCallback);
    tg.BackButton.show();
  }

  popView() {
    const fn = this.historyStack.pop();
    if (fn) {
      Haptic.tap();
      fn();
    }
    if (this.historyStack.length === 0) {
      tg.BackButton.hide();
    }
  }

  // Безопасная установка главной кнопки (заменяет предыдущий обработчик)
  setMainButton({ text, color, textColor, onClick, isVisible = true }) {
    this.mainBtnCallback = onClick;
    if (!isVisible) {
      tg.MainButton.hide();
      return;
    }
    tg.MainButton.setParams({
      text,
      color: color || tg.themeParams.button_color,
      text_color: textColor || tg.themeParams.button_text_color,
      is_active: true,
      is_visible: true
    });
  }

  hideMainButton() {
    this.mainBtnCallback = null;
    tg.MainButton.hide();
  }
}

export const ui = new UIController();

4.3. Стратегия работы с CloudStorage

У Telegram.WebApp.CloudStorage жесткие лимиты: максимум 1024 ключа на пользователя, значение до 4096 байт. Он привязан к конкретному user_id, а не к вашему общему workspace_id.

Что хранить в CloudStorage: Персональные настройки отображения (выбранная дуо-тема, стартовая вкладка по умолчанию, состояние онбординга, сохраненный workspace_id и last_sync_id для кросс-девайс входа с телефона и ПК).

Что хранить в localStorage / IndexedDB: Полный JSON-слепок списков покупок, заметок и календаря для мгновенного старта (Offline-First рендер за 0 мс до ответа сервера) и черновики недописанных заметок.

Промисифицированная обертка для CloudStorage:

JavaScript
export const CloudStore = {
  get(key) {
    return new Promise((resolve, reject) => {
      tg.CloudStorage.getItem(key, (err, value) => {
        if (err) return reject(err);
        try { resolve(value ? JSON.parse(value) : null); }
        catch { resolve(value); }
      });
    });
  },
  set(key, value) {
    return new Promise((resolve, reject) => {
      const payload = typeof value === 'string' ? value : JSON.stringify(value);
      tg.CloudStorage.setItem(key, payload, (err, saved) => {
        if (err) return reject(err);
        resolve(saved);
      });
    });
  }
};

4.4. Обработка Safe Area (iOS Dynamic Island, Home Indicator, Android Cutouts)

Начиная с Bot API 7.7 / 8.0+, Telegram предоставляет отдельные CSS-переменные для системных отступов экрана (--tg-safe-area-inset-*) и для нативных кнопок шапки самого Telegram (--tg-content-safe-area-inset-*).

Инициализация при старте (app.js):

JavaScript
tg.ready();
tg.expand();
// Отключаем случайное закрытие приложения свайпом вниз при скролле списков (Bot API 7.7+)
if (tg.isVersionAtLeast('7.7')) {
  tg.disableVerticalSwipes();
}


Универсальный CSS для полноэкранного режима и нижних таббаров (styles.css):

CSS
:root {
  /* Системные вырезы (челка iPhone, полоска Home снизу) с фоллбэком на стандартные env() */
  --safe-top: var(--tg-safe-area-inset-top, env(safe-area-inset-top, 0px));
  --safe-bottom: var(--tg-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
  
  /* Отступ под нативные кнопки Telegram (Закрыть / Три точки) в режиме Fullscreen */
  --content-top: var(--tg-content-safe-area-inset-top, 0px);
}

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  /* Привязка к стабильной высоте вьюпорта Telegram (не прыгает при открытии клавиатуры) */
  height: var(--tg-viewport-stable-height, 100dvh);
  overflow: hidden;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* Верхний отступ суммирует системный статус-бар и шапку элементов управления ТГ */
  padding-top: calc(var(--safe-top) + var(--content-top));
}

.scrollable-content {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.bottom-nav {
  display: flex;
  /* Нижний таббар никогда не перекрывается полоской Home на iOS */
  padding-bottom: max(var(--safe-bottom), 12px);
  background: var(--surface-color);
  border-top: 1px solid var(--border-color);
}

5. Пошаговый план внедрения

База данных и SSE-шина (День 1):

Включить WAL-режим в better-sqlite3.

Добавить таблицу sync_log и эндпоинт /api/stream.

Встроить вызов broadcastToWorkspace() во все существующие мутирующие роуты (POST/PATCH/DELETE).

Клиентский слой синхронизации и кэша (День 2):

При старте приложения рендерить данные из localStorage мгновенно, параллельно открывая EventSource с lastEventId.

Перенести хранение дуо-темы и настроек пользователя в CloudStorage.

Нативный UX и Safe Area (День 3):

Подключить tg.disableVerticalSwipes(), прописать CSS-переменные --tg-safe-area-inset-* и --tg-viewport-stable-height.

Внедрить UIController для BackButton/MainButton и расставить вызовы Haptic на чекбоксы и кнопки удаления.

Фоновые уведомления бота (День 4):

Внедрить модуль queuePartnerNotification с проверкой rooms.get(workspaceId).size < 2 и 30-секундным дебаунсом.

Деплой на VPS (День 5):

Поднять VPS (Ubuntu 24.04), настроить Nginx с proxy_buffering off для /api/, выпустить SSL через Certbot, запустить приложение через pm2 start ecosystem.config.js и добавить ежедневный .backup SQLite в cron.
