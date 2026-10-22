const { spawnSync } = require('child_process');

const promptText = `Я разрабатываю мобильное веб-приложение для пар в Telegram — «На двоих» (Personal Digital Space for Couples).

ТЕКУЩИЙ СТЕК И АРХИТЕКТУРА:
1. Фронтенд: Чистый Vanilla JS + HTML5/CSS3 (без тяжелых фреймворков), PWA-ready, Telegram WebApp (iOS / Android).
2. Бэкенд: Node.js + Express + SQLite, сессионная привязка через Telegram ID и код приглашения пары.
3. Модули: Заметки, Совместный список покупок, Календарь свиданий, Таймлайн отношений, Настройки дуо-тем.
4. Локальный запуск работает через SSH туннель localhost.run и привязан к боту @Na_dvoix2bot.

Мне нужен глубокий инженерный и продуктовый разбор по 4 ключевым направлениям:

1. Real-time синхронизация данных пары:
Какой стек и протокол оптимален для мгновенной синхронизации действий двух людей (добавил покупку, вычеркнул пункт, добавил событие в календарь) без чрезмерного оверинжиниринга? WebSocket (ws / socket.io), SSE (Server-Sent Events) или переход на облачную БД (Turso / Supabase / Firebase)?

2. Стабильный 24/7 хостинг (бесплатно или ультрабюджетно):
Сейчас проект крутится локально. Какая связка для production-деплоя даст надежную работу 24/7 без затрат или за минимальные деньги:
- Vercel (фронтенд + serverless api) + Turso (libSQL/SQLite edge)?
- Render.com / Fly.io / Railway (контейнер Node.js + SQLite на persistent volume)?
- Cloudflare Pages + Workers + D1?
Плюсы, минусы и рекомендуемый выбор для MVP на двоих.

3. Продуктовые Retention-механики для двоих:
Как сделать так, чтобы оба партнера возвращались в приложение каждый день? Предложи 3-5 проверенных механик:
- Деликатные Telegram-уведомления через бота (не навязчивые, а создающие тепло и контакт);
- Рандомайзер / генератор идей для свиданий и глубоких вопросов на вечер;
- Геймификация гармонии, совместные привычки и счетчик дней вместе.

4. Telegram WebApp UX-полировка:
Какие нативные возможности Telegram WebApp API (HapticFeedback при тапах, MainButton, BackButton, CloudStorage для кэша, themeParams) критически важно подключить в первую очередь, чтобы веб-приложение ощущалось как дорогой нативный iOS/Android апп?

Дай практичный, структурированный ответ с конкретными примерами кода и архитектурными рекомендациями.`;

const jsCode = `(() => {
  try {
    const editor = document.querySelector('.ql-editor');
    if (!editor) return 'NO_EDITOR';
    
    editor.focus();
    // Clear editor using DOM manipulation
    while (editor.firstChild) {
      editor.removeChild(editor.firstChild);
    }
    
    // Create paragraphs using Trusted DOM APIs
    const lines = ${JSON.stringify(promptText)}.split('\\n');
    for (const line of lines) {
      const p = document.createElement('p');
      if (line.trim().length > 0) {
        p.textContent = line;
      } else {
        p.appendChild(document.createElement('br'));
      }
      editor.appendChild(p);
    }
    
    editor.classList.remove('ql-blank');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    
    const richTa = document.querySelector('rich-textarea');
    if (richTa) {
      richTa.dispatchEvent(new Event('input', { bubbles: true }));
      richTa.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    return 'SUCCESS_LEN_' + editor.innerText.length;
  } catch(e) {
    return 'ERR: ' + e.message;
  }
})()`;

const res = spawnSync('bsk', ['evaluate', '--session', 'bneg', jsCode], { encoding: 'utf-8' });
console.log('Result:', res.stdout);
console.log('Stderr:', res.stderr);
