# 🧠 ПАМЯТЬ ПОЛЬЗОВАТЕЛЯ И АРХИТЕКТУРНЫЕ КОНСТАНТЫ (USER_MEMORY)

- **Роль пользователя:** Заказчик / Product Owner (не программист). Вся техническая ответственность на ведущем разработчике (агенте).
- **Роль агента:** Lead Developer / CTO. Автономное выполнение, фильтр неоптимальных решений, Closed-Loop Verification.
- **Главный инженерный закон деплоя:** Запрет рапорта о готовности без физической верификации через `curl` на живом URL продакшена.
- **Проект «На двоих»:**
  - Production URL: `https://na-dvoih.onrender.com/na-dvoih`
  - GitHub Repo: `https://github.com/laptev106-code/na-dvoih.git` (`main`)
  - Хостинг: Render Web Service (`srv-dbd974vavr4c7397mt0g`). Требует ручного деплоя через Dashboard или Deploy Hook, так как Auto-Deploy отключен.
  - Календарь: Просроченные события подсвечиваются коралловым (`var(--coral)`).
