1. Real-Time транспорт: SSE + REST против WebSocket (ws)

Для мобильного Telegram WebView (особенно WKWebView на iOS) при хостинге на Render связка SSE + единый батч-эндпоинт мутаций (POST /api/sync/mutate) выигрывает у WebSocket по надежности, хотя уступает в красивом трекинге присутствия (Presence).

Критерий	SSE (/api/stream) + REST	WebSocket (ws)
Поведение при сне (iOS/Android)	Браузер сам управляет пулом HTTP/2. При пробуждении нативно кидает реконнект с заголовком Last-Event-ID.	Сокет «замерзает» без закрытия (half-open). Требует кастомного пинг-понга на клиенте, иначе мутации уходят в черную дыру до таймаута TCP.
Переключение Wi-Fi ⇄ LTE	REST-мутация атомарна: либо дошла, либо упала по таймауту (сразу понятен статус для Outbox).	Пакет, отправленный в ws.send() в момент смены сети, теряется в буфере ОС без колбэка ошибки. Приходится писать свой протокол ACK-подтверждений поверх сокета.
Память на Render (Node.js)	1 открытый http.ServerResponse в памяти на юзера (~15–20 КБ).	Инстанс ws + буферы фреймов (~40–60 КБ на соединение).
Контроль онлайна партнера	Требует редких heartbeat-запросов или привязки к активности (мутациям).	Мгновенный (по событию close + пинг каждые 15–20 сек).

Архитектурный вердикт:
Не переписывайте транспорт на WebSocket. Переход на ws заставит вас вручную изобретать поверх него то, что уже есть в HTTP: идемпотентные ретраи, таймауты запросов и подтверждения доставки (ACK) для Outbox-очереди.

Как докрутить текущий SSE до идеала:

Единый мультиплексированный стрим: один /api/stream на все 4 сущности.

Легковесный Presence без сокетов: когда клиент открывает /api/stream, сервер пишет в память Map<coupleId, Set<userId>> и шлет в стрим пары ивент partner_online: true. При срабатывании req.on('close') на SSE-коннекте — ждет 3 секунды (защита от мигания сети при переключении вышек) и, если реконнекта не было, шлет partner_online: false.

Защита от переполнения sync_log: используйте кольцевую зачистку в SQLite (хранить только последние 500 записей на пару или записи за 7 дней). Если клиент присылает Last-Event-ID, который уже удален из sync_log, сервер отвечает специальным SSE-событием event: force_full_pull, и клиент стягивает актуальный слепок таблиц.

2. Модель бесконфликтного слияния (Unified Sync Engine)

Тащить полноценные CRDT (Yjs / Automerge) ради карточек быта, вишлиста и дат — оверкилл. Они раздуют бандл и потребуют хранения бинарных векторов состояний. Ваша задача решается паттерном Field-Level LWW (Last-Write-Wins на уровне отдельных полей) + мягкое удаление (Tombstones).

Почему возникают конфликты сейчас

Вы версионируете карточку целиком ({ version, hash, payload }). Если Партнер А меняет title, а Партнер Б — date, базовая версия разъезжается.

Как устроена схема Field-Level LWW

Вместо перезаписи всего объекта клиент отправляет дельту измененных полей с меткой времени каждого поля. Сервер в рамках одной синхронной транзакции better-sqlite3 сравнивает таймстампы по каждому ключу отдельно.

Единая таблица сущностей в SQLite (entities):
Все 4 сущности (wish, chore, calendar_date, main_goal) ложатся в одну таблицу. Это убивает зоопарк из sync-client.js и household-sync.js.

SQL
CREATE TABLE entities (
    id TEXT PRIMARY KEY,               -- UUID v4 (генерируется на клиенте)
    couple_id TEXT NOT NULL,
    type TEXT NOT NULL,                -- 'wish' | 'chore' | 'date' | 'goal'
    data JSON NOT NULL,                -- {"title": "Отпуск", "amount": 100000}
    field_ts JSON NOT NULL,            -- {"title": 172998000100, "amount": 172998000500}
    deleted_at INTEGER DEFAULT NULL,   -- Tombstone (мягкое удаление)
    updated_at INTEGER NOT NULL
);
CREATE INDEX idx_entities_couple_updated ON entities(couple_id, updated_at);

Защита от рассинхрона часов (Clock Drift)

На телефонах партнеров часы могут спешить или отставать на пару минут. Чтобы не городить полноценные Hybrid Logical Clocks (HLC), используйте Monotonic Server-Clamped Timestamp:

JavaScript
// Серверная функция слияния в better-sqlite3 (внутри db.transaction)
const mergeEntityMutation = db.transaction((coupleId, mutation) => {
  const { entityId, entityType, patch, clientFieldTs, isDelete, mutationId } = mutation;
  
  // 1. Защита от дублей (идемпотентность Outbox)
  const alreadyProcessed = db.prepare(
    'SELECT 1 FROM processed_mutations WHERE mutation_id = ?'
  ).get(mutationId);
  if (alreadyProcessed) return { status: 'duplicate' };

  const now = Date.now();
  const existing = db.prepare(
    'SELECT data, field_ts, deleted_at FROM entities WHERE id = ? AND couple_id = ?'
  ).get(entityId, coupleId);

  let currentData = existing ? JSON.parse(existing.data) : {};
  let currentFieldTs = existing ? JSON.parse(existing.field_ts) : {};
  let deletedAt = existing ? existing.deleted_at : null;

  if (isDelete) {
    // Удаление всегда выигрывает, если его timestamp свежее создания
    deletedAt = Math.max(now, deletedAt || 0);
  } else {
    // Поэлементное слияние полей (Field-Level LWW)
    for (const [key, value] of Object.entries(patch)) {
      // Ограничиваем клиентский таймстамп сверху серверным временем + 5 сек (защита от часов в будущем)
      const incomingTs = Math.min(clientFieldTs[key] || now, now + 5000);
      const existingTs = currentFieldTs[key] || 0;

      if (incomingTs >= existingTs) {
        currentData[key] = value;
        currentFieldTs[key] = incomingTs;
      }
    }
  }

  // Сохраняем сущность
  db.prepare(`
    INSERT INTO entities (id, couple_id, type, data, field_ts, deleted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data,
      field_ts = excluded.field_ts,
      deleted_at = COALESCE(excluded.deleted_at, entities.deleted_at),
      updated_at = excluded.updated_at
  `).run(entityId, coupleId, entityType, JSON.stringify(currentData), JSON.stringify(currentFieldTs), deletedAt, now);

  // Фиксируем мутацию и пишем в sync_log для SSE
  db.prepare('INSERT INTO processed_mutations (mutation_id, couple_id, created_at) VALUES (?, ?, ?)').run(mutationId, coupleId, now);
  
  const logResult = db.prepare(`
    INSERT INTO sync_log (couple_id, event_type, payload, created_at)
    VALUES (?, 'ENTITY_DELTA', ?, ?)
  `).run(coupleId, JSON.stringify({ entityId, entityType, data: currentData, fieldTs: currentFieldTs, deletedAt }), now);

  return { status: 'applied', eventId: logResult.lastInsertRowid, mergedData: currentData };
});


Результат: Один партнер в метро меняет название цели, второй дома меняет сумму. Оба пакета приходят на сервер с разными ключами в patch. Слияние проходит автоматически, оба получают по SSE итоговый объединенный JSON. Никаких модалок конфликта.

3. Транзакционная Outbox-очередь и защита от «зомби»-записей

Причина «воскрешения» удаленных карточек при перезагрузке страницы в офлайне — хранение dirtyIds и deleteIds в памяти (Set) отдельно от основного стейта и попытка синхронизировать состояние, а не журнал операций.

Правильная архитектура на клиенте

Даже если вы остаетесь на localStorage (для 4 текстовых сущностей пары его лимита в 5 МБ хватит с головой, а синхронный API проще IndexedDB), структуру нужно разделить на два ключа:

app_state_v2 — локальная проекция данных (для мгновенного рендера UI).У удаленных в офлайне карточек ставится флаг _deleted: true прямо внутри app_state_v2, а не в оперативной памяти. UI просто фильтрует items.filter(x => !x._deleted).

sync_outbox_v2 — строго упорядоченный массив (FIFO) несинхронизированных мутаций.

Компактификация очереди (Queue Compaction) на клиенте

Если юзер в метро создал задачу, 3 раза переименовал её и потом удалил, не нужно слать 5 запросов после выхода на связь:

При добавлении новой мутации в sync_outbox_v2 ищем в очереди еще не отправленную мутацию с тем же entityId.

Если в очереди лежит CREATE или UPDATE, а новая операция — UPDATE, просто мержим их patch и обновляем clientFieldTs в существующей записи очереди.

Если в очереди лежит CREATE (запись создана в этом же офлайн-сеансе и сервер о ней вообще не знает), а юзер жмет DELETE — просто удаляем CREATE из очереди и стираем запись из app_state_v2.

JavaScript
// sync-engine.js (Клиентский единый движок)
class UnifiedSyncEngine {
  constructor() {
    this.outboxKey = 'na_dvoix_outbox';
    this.stateKey = 'na_dvoix_state';
    this.isFlushing = false;
    this.retryCount = 0;

    window.addEventListener('online', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.flush();
    });
  }

  getOutbox() {
    return JSON.parse(localStorage.getItem(this.outboxKey) || '[]');
  }

  saveOutbox(queue) {
    localStorage.setItem(this.outboxKey, JSON.stringify(queue));
  }

  // Вызывается из UI при любом изменении любой из 4-х сущностей
  mutate(entityType, entityId, patch, isDelete = false) {
    const now = Date.now();
    
    // 1. Оптимистичное обновление локального стейта (переживает F5)
    const state = JSON.parse(localStorage.getItem(this.stateKey) || '{}');
    const current = state[entityId] || { id: entityId, type: entityType, data: {}, fieldTs: {} };

    if (isDelete) {
      current._deleted = true; // Tombstone прямо в localStorage!
      current.deletedAt = now;
    } else {
      for (const [k, v] of Object.entries(patch)) {
        current.data[k] = v;
        current.fieldTs[k] = now;
      }
    }
    state[entityId] = current;
    localStorage.setItem(this.stateKey, JSON.stringify(state));

    // 2. Компактификация и запись в Outbox
    const queue = this.getOutbox();
    const existingIdx = queue.findIndex(m => m.entityId === entityId && !m.inFlight);

    if (existingIdx !== -1 && !isDelete) {
      // Склеиваем дельты для одной и той же карточки в офлайне
      Object.assign(queue[existingIdx].patch, patch);
      for (const k of Object.keys(patch)) queue[existingIdx].clientFieldTs[k] = now;
    } else {
      const clientFieldTs = {};
      if (patch) for (const k of Object.keys(patch)) clientFieldTs[k] = now;

      queue.push({
        mutationId: crypto.randomUUID(),
        entityId,
        entityType,
        patch: patch || {},
        clientFieldTs,
        isDelete,
        createdAt: now
      });
    }

    this.saveOutbox(queue);
    this.renderUI();
    this.flush();
  }

  async flush() {
    if (this.isFlushing || !navigator.onLine) return;
    const queue = this.getOutbox();
    if (queue.length === 0) return;

    this.isFlushing = true;

    try {
      // Отправляем всю очередь одним батчем (строго FIFO на сервере)
      const res = await fetch('/api/sync/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionStorage.getItem('jwt')}`
        },
        body: JSON.stringify({ mutations: queue })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { processedIds } = await res.json();

      // Удаляем из очереди только подтвержденные сервером mutationId
      const currentQueue = this.getOutbox();
      const remaining = currentQueue.filter(m => !processedIds.includes(m.mutationId));
      this.saveOutbox(remaining);

      // Зачищаем локальные Tombstones после подтверждения сервера
      const state = JSON.parse(localStorage.getItem(this.stateKey) || '{}');
      for (const id of Object.keys(state)) {
        if (state[id]._deleted && !remaining.some(m => m.entityId === id)) {
          delete state[id];
        }
      }
      localStorage.setItem(this.stateKey, JSON.stringify(state));
      this.retryCount = 0;

    } catch (err) {
      // Экспоненциальный бэкофф с джиттером (1s, 2s, 4s, 8s... max 30s)
      const delay = Math.min(30000, (1000 * Math.pow(2, this.retryCount)) + Math.random() * 500);
      this.retryCount++;
      setTimeout(() => { this.isFlushing = false; this.flush(); }, delay);
      return;
    }

    this.isFlushing = false;
  }
}

Как защититься от «воскрешения» при входящем Pull / SSE

Когда клиент делает GET /api/sync/pull?since=timestamp, сервер возвращает в том числе записи с deleted_at IS NOT NULL. Клиент, видя deleted_at, удаляет ключ из localStorage. Но если в sync_outbox_v2 прямо сейчас лежит неотправленная операция isDelete: true по карточке X, а с сервера пришел старый стейт карточки X — локальный Outbox всегда имеет приоритет над входящим Pull до тех пор, пока мутация не подтверждена.

4. Защищенная сессионная авторизация в TMA (Zero Cross-Pair Leakage)

Валидировать initData при каждом запросе — плохая практика: строка initData длинная (гонять лишний трафик в каждом заголовке), плюс её auth_date протухает, если юзер не закрывал мини-апп сутки. Использование HttpOnly Cookie в Telegram WebView на iOS часто ломается из-за политики ITP (Intelligent Tracking Prevention блокирует куки в сторонних WebView/iframe).

Оптимальный паттерн: Обмен initData один раз при старте аппа (POST /api/auth/session) на короткоживущий Stateless JWT (или HMAC-подписанный токен), который передается в заголовке Authorization: Bearer <token> и для SSE — через query-параметр /api/stream?token=<token> (нативный EventSource не умеет ставить кастомные заголовки).

Архитектура Zero Cross-Pair Leakage

Главное правило безопасности для парных приложений: клиент НИКОГДА не передает coupleId или userId в теле запроса или URL мутаций. Они зашиты внутрь подписанного серверного токена.

JavaScript
// auth.js (Node.js Валидация + Выпуск токена)
import crypto from 'node:crypto';

const BOT_TOKEN = process.env.BOT_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET; // 32+ байт криптостойкой строки

// 1. Проверка подписи Telegram WebApp initData
export function verifyTelegramInitData(initDataRaw) {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) return null;

  // Защита от Replay-атак: initData старше 1 часа не принимаем для логина
  const authDate = Number(params.get('auth_date'));
  if (Math.floor(Date.now() / 1000) - authDate > 3600) return null;

  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Сравнение за константное время (защита от timing attacks)
  const hashBuf = Buffer.from(hash, 'hex');
  const calcBuf = Buffer.from(calculatedHash, 'hex');
  if (hashBuf.length !== calcBuf.length || !crypto.timingSafeEqual(hashBuf, calcBuf)) {
    return null;
  }

  return JSON.parse(params.get('user'));
}

// 2. Сверхбыстрый нативный токен без внешних зависимостей (быстрее jsonwebtoken)
export function signSessionToken(payload) {
  const data = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24 // 24 часа
  })).toString('base64url');
  
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  
  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (Date.now() > payload.exp) return null;
  return payload; // { uid: 123456, cid: "couple_uuid_88", ver: 1 }
}

Нюанс смены пары (Token Invalidation при связывании)

Когда юзер заходит впервые, он одиночка (cid: null). Когда партнер принимает инвайт, в БД у обоих меняется couple_id. Чтобы не делать запрос в БД на каждый чих, но и не держать старый cid в токене:

Храните в памяти Node.js легкий Map<userId, coupleId> (кэш связок).

В middleware авторизации сверяйте req.user.cid с этим in-memory Map (операция занимает наносекунды, 0 дискового I/O).

Безопасное разделение Dev и Prod без бэкдоров

Никогда не делайте в коде проверок вида if (req.headers['x-dev-user-id']) — рано или поздно переменная окружения на Render слетит или забудется, и любой школьник сможет читать чужие пары, подставив заголовок.

Как сделать железобетонно:

На проде и в деве работает один и тот же пайплайн проверки криптографической подписи verifyTelegramInitData.Никаких обходных веток if (isDev) в middleware авторизации!

Для локальной разработки в браузере (вне Telegram) напишите маленький npm-скрипт npm run gen:dev-initdata, который берет ваш тестовый BOT_TOKEN_DEV из локального .env.development и генерирует по стандарту Telegram валидную подписанную строку initData для фейковых юзеров id: 111 и id: 222.

На Render в переменных окружения лежит боевой BOT_TOKEN. Даже если кто-то попытается скормить проду сгенерированную дев-строку, HMAC-подпись не сойдется, потому что токены ботов разные.

План миграции без даунтайма (Cutover Checklist)

На сервере: Создайте таблицы entities и processed_mutations. Напишите одноразовый скрипт миграции при старте сервера, который перегонит старые таблицы вишлиста и быта в entities, выставив всем полям текущий Date.now() в field_ts.

На клиенте (первый запуск после апдейта):

Проверьте наличие старых ключей localStorage для «Календаря дат» и «Главной цели».

Если они есть и флаг migrated_to_v2 не стоит — прогоните их через syncEngine.mutate(), чтобы они попали в новый sync_outbox_v2 и автоматически улетели на сервер при первом flush().

Поставьте localStorage.setItem('migrated_to_v2', 'true').

Удалите sync-client.js и household-sync.js, заменив их вызовы на syncEngine.mutate(type, id, patch). Архитектура сожмется в один предсказуемый конечный автомат.
