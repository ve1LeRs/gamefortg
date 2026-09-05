# GameFort

Мобильный игровой хаб (Steam-like) внутри Telegram Mini App.

## Игры

- **Покер** — техасский холдем против бота
- **Дурак** — классика против бота
- **Шахматы** — полная доска с простым ИИ
- **Шашки** — русские шашки, бить обязательно
- **Косынка** — пасьянс Klondike

## Запуск

```bash
npm install
npm run dev
```

Сборка:

```bash
npm run build
```

## GitHub Pages

Сайт: **https://ve1lers.github.io/gamefortg/**

Деплой идёт автоматически из `main` через Actions (workflow `Deploy to GitHub Pages`).

## Telegram Mini App

1. Создайте бота через [@BotFather](https://t.me/BotFather)
2. Команда `/newapp` — укажите URL: `https://ve1lers.github.io/gamefortg/`
3. Откройте мини-приложение из бота

Локально приложение работает и без Telegram (режим гостя).
