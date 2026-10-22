# Проверка публикации Telegram Mini App — 12 октября 2026

## Фактическое состояние бота

Read-only запросы к Bot API подтвердили, что токен действителен и бот существует:

- имя: `Na_dvoix`
- username: `@Na_dvoix2bot`
- Telegram ID: `8981337067`
- `getMe`: успешно
- `getWebhookInfo`: webhook URL пустой, ожидающих обновлений нет
- `getChatMenuButton`: стандартная кнопка `commands`
- `getMyCommands`: список команд пустой

Это объясняет, почему после `/start` в чате не появляется приложение: Telegram не открывает Mini App автоматически только от факта создания бота.

## Состояние Webdev-проекта

Текущий preview доступен по HTTPS и отвечает HTTP 200. Проверенные адреса:

- Preview: `https://8328-ixd9jawnbk74ceew02cm8-037d95f6.us3.manus.computer/`
- API health: `https://3000-ixd9jawnbk74ceew02cm8-037d95f6.us3.manus.computer/api/health`

Это preview-адрес рабочей сессии, а не стабильный production URL. В конфигурации Webdev нет сохранённых `build`/`deploy` declarations и нет подтверждённого published URL. Поэтому бот сейчас не может быть настроен на постоянный адрес приложения.

## Что требуется для личного теста

Telegram Mini App — это HTTPS-веб-приложение, которое запускается из Telegram через один из механизмов: Main Mini App, menu button, inline button, keyboard button или direct link. Для полноценного приложения «На двоих» достаточно стабильного HTTPS URL и настройки menu button либо Main Mini App в @BotFather. Webhook для самого открытия Mini App не обязателен. Он нужен только если бот должен принимать и обрабатывать сообщения, команды или события через Bot API.

Минимальный порядок такой:

1. Опубликовать web/API-сборку проекта на стабильном HTTPS URL.
2. В @BotFather выбрать `@Na_dvoix2bot` и настроить Main Mini App либо `Bot Settings → Menu Button`, указав этот URL.
3. Открыть чат с ботом, нажать `/start`, затем нажать появившуюся кнопку меню или `Launch app` в профиле бота.
4. Для проверки синхронизации использовать два Telegram-аккаунта и одну пару: первый аккаунт создаёт/показывает код приглашения, второй подключается по коду; затем проверяется создание, изменение и завершение общей записи.

Для разовой проверки можно временно указать текущий HTTPS Preview URL в menu button, но это не рекомендуется как рабочее решение: preview может измениться после перезапуска или замены сессии.

## Официальные источники

[1]: https://core.telegram.org/bots/webapps "Telegram Mini Apps — способы запуска и настройка через BotFather"
[2]: https://core.telegram.org/bots/api "Telegram Bot API — WebAppInfo и MenuButtonWebApp"
[3]: https://core.telegram.org/bots/features "Telegram Bot Features — Main Mini App и BotFather"
