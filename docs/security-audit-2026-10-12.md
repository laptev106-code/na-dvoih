# Security-аудит «На двоих» — 12 октября 2026

## Исправлено в коде

Telegram Mini App auth теперь ограничивает размер `initData`, проверяет безопасную числовую Telegram user ID, отклоняет будущую дату и сравнивает подпись constant-time. Все sync-операции изолированы по `coupleId`. Личные желания нельзя изменять или удалять партнёру. Update/delete требуют актуальную версию, а импорт отклоняет конфликтующий ID вместо перезаписи чужой записи. Добавлены лимиты body, rate limit для sync и link preview, CORS для `X-Telegram-Init-Data`, `no-store` для API и базовые security headers.

Восстановлен отсутствовавший endpoint `/api/preview`: он ограничивает URL и размер HTML, запрещает IP-литералы, приватные DNS-адреса и редиректы, использует таймаут и не сохраняет полученный HTML на сервере. Увеличена энтропия invite-кодов. Production-сервер раздаёт Expo Web/static routes вместе с API на одном адресе.

## Dependency hardening

Обновлены direct runtime dependencies: `@trpc/*` до 11.8.0, `axios` до 1.20.0, `mysql2` до 3.22.0 и `drizzle-orm` до 0.45.2. Через pnpm overrides закреплены исправленные версии `proxy-addr`, `path-to-regexp`, `postcss`, `nanoid`, `source-map-js`, `compression`, `browserslist`, `js-yaml`, `ws`, `form-data`, `@xmldom/xmldom`, `shell-quote`, `node-forge` и `picomatch`.

Финальный `pnpm audit --prod --audit-level high` показывает 15 advisories: 4 low, 9 moderate и 2 high; critical advisory больше нет. Два high advisory остаются в транзитивных Expo/Metro tooling-пакетах (`node-forge` и `braces`), для которых audit database не указывает безопасный patched release. Они не входят в серверный bundle и используются инструментами Expo/Metro во время разработки и сборки. Их нельзя безопасно подменить произвольной major-версией без обновления совместимого Expo SDK.

## Проверки

`pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`, Expo Web export и `git diff --check` проходят. Тесты: 25 успешно, 1 существующий auth-тест пропущен по условию окружения. Production smoke-test вернул HTTP 200 для `/api/health`, `/`, `/calendar` и исходного Mini App; запрос без auth к session endpoint отклонён, приватный URL в preview отклонён.

## Ограничения

Полная проверка двух реальных Telegram-пользователей требует опубликованного HTTPS URL, подключённого Telegram BotFather и двух аккаунтов. Календарные напоминания пока локальные, push-уведомления не заявлены. Для публичного link preview на высокой нагрузке желательно дополнительно закрепить egress/DNS pinning на инфраструктурном уровне, потому что проверка DNS перед запросом не исключает редкую DNS-rebinding гонку.
