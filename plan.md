# План реализации «На двоих»

## Design read

Reading this as: приложение для пар и совместного планирования, для повседневного использования одной рукой, с тёплой editorial-подачей и спокойным social-продуктовым интерфейсом, targeting Android и iOS через Expo/React Native и Telegram Mini App WebView.

## Продуктовый фокус

Текущий этап превращает существующий браузерный кандидат «На двоих» в touch-first Telegram Mini App. Основной пользовательский результат — быстро добавить желание, увидеть его в нужной вкладке, отметить исполненным, открыть календарь и вести общие бытовые задачи. Лента будущих предложений «Для двоих» не показывается и не добавляет рекламных сущностей, но договорённость о расширяемой архитектуре фиксируется через feature flag и типы источников.

## Дизайн-система

- **Design movement:** warm editorial utility — личный планировщик с мягкими paper-поверхностями, живыми акцентными цветами и понятной native-навигацией.
- **Core principles:** ясность за пять секунд, совместность без лишнего шума, одно главное действие на экран, честные состояния offline/loading/error/empty.
- **Color philosophy:** молочный фон создаёт ощущение спокойного личного пространства; сливовый акцент обозначает действие и близость; мятный/персиковый используются только как семантические акценты статусов.
- **Layout paradigm:** контентная лента с крупным заголовком, горизонтальными сегментами для контекста и нижней навигацией для peer-разделов; без центрального desktop-grid.
- **Signature elements:** сливовая вертикальная метка на активной карточке, мягкие цветовые обложки желаний, нижний floating action button «Добавить» в зоне большого пальца.
- **Interaction philosophy:** крупные tappable rows, visible alternatives to gestures, reversible completion toggle, modal form with keyboard-aware scrolling.
- **Animation:** restrained 180–220ms native transitions and press opacity; no decorative motion; respect reduced-motion through platform defaults.
- **Typography:** system sans / SF Pro on iOS and Roboto/system on Android; display 30/34, section 20/24, body 16/22, metadata 13/18.
- **Brand essence:** «личное пространство пары для планов, которые хочется осуществить»; personality: тёплое, понятное, совместное.
- **Brand voice:** concrete and gentle. Examples: «Что однажды хочется сделать?» and «Добавьте идею, чтобы не потерять её».
- **Wordmark & logo:** текстовый wordmark «На двоих» с соединённым символом «+»/пары в native launcher asset; в интерфейсе используется типографический знак без отдельной иллюстрации.
- **Signature brand color:** plum `#6D3A63`.

## Архитектура

- `app/(tabs)/` — четыре top-level mobile destinations: «Желания», «Календарь», «Наш быт», «Настройки».
- `lib/wishlist-store.tsx` — локальное состояние, AsyncStorage persistence, CRUD желаний/задач и account-scoped preferences.
- `shared/wishlist.ts` — переносимые типы, категории, date helpers и задел источников будущих предложений.
- `lib/telegram.ts` — безопасный platform boundary для Telegram WebApp theme/initData без секретов в клиенте.
- `lib/feature-flags.ts` — централизованные флаги, включая скрытый `offersFeed: false`.
- `server/` и `drizzle/` — существующий managed backend остаётся совместимым; подключение реального Telegram Worker/D1 не выполняется без отдельного разрешения.

## Ограничения и решения

- Не переносить статический HTML напрямую в WebView; использовать native React Native primitives и Expo Router.
- Не добавлять fake wishes/tasks на чистой установке; показывать честные empty states.
- Не хранить токены в AsyncStorage; Telegram initData только краткоживущий runtime input, production секреты остаются на сервере.
- Будущая лента «Для двоих» будет отдельной сущностью `offer`, а добавление в wishlist — ссылкой `sourceId`, чтобы не смешивать предложения с обычными желаниями.
- Данные текущего кандидата не сбрасываются; локальный mobile storage имеет собственный namespace и отдельную миграцию-адаптер для будущего импорта web bucket.

## Реализуемый срез

1. Touch-first shell и нижняя навигация.
2. Желания: вкладки «Мои», «Партнёра», «Вместе», «Сбылось», поиск/фильтр, создание/редактирование/удаление, completion, дата/reminder, категории, owner rule.
3. Календарь: ближайшие и просроченные датированные желания, месяц и переход к исходной карточке.
4. «Наш быт»: включение из настроек, CRUD задач по фиксированным подкатегориям, completion.
5. Настройки: календарь/бытовые preferences, тема, Telegram readiness status и объяснение offline режима.
6. Future-ready contracts: offers flag false, source metadata и отдельные API route names в документации без UI и без fake content.

## Проверка

- `pnpm check`, `pnpm lint`, `pnpm test`.
- `pnpm dev` с readiness на портах 8081 и 3000.
- Web Preview через Expo Metro; визуальная проверка на 390×844 и desktop web.
- Проверка empty/loading/error/disabled states, keyboard-safe modal, dark mode, touch target >= 48dp и доступных label/role/state.
