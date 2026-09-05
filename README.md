# GameForTg

Мобильный игровой хаб внутри Telegram Mini App.

## Игры

- **Покер** — техасский холдем против бота
- **Дурак** — классика против бота
- **Шахматы** — полная доска с простым ИИ
- **Шашки** — обязательный бой
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

Деплой автоматически из `main` (workflow `Deploy to GitHub Pages`).

## Telegram-бот

1. В [@BotFather](https://t.me/BotFather) задайте имя бота: **GameForTg**
2. Main Mini App / Menu Button URL:

```text
https://ve1lers.github.io/gamefortg/
```

3. Аватар: `public/bot-avatar.png`
4. Автонастройка через API (нужен токен бота):

```bash
BOT_TOKEN=123:ABC npm run setup:bot
```

Мини-приложение само вызывает `expand()` + `requestFullscreen()` и подстраивает safe-area под вырез экрана.
