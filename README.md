# GameForTg

Мобильный игровой хаб внутри Telegram Mini App.

## Игры

- **Покер** — техасский холдем против бота
- **Дурак** — против бота или **онлайн с другом** по коду/ссылке
- **Шахматы** — полная доска с простым ИИ
- **Шашки** — обязательный бой
- **Косынка** — пасьянс Klondike

## Дурак онлайн

1. Откройте Дурак → **С другом онлайн** → **Создать комнату**
2. Отправьте другу код (или ссылку)
3. Друг открывает Дурак → вводит код → **Войти**

Deep link (если задан `VITE_BOT_USERNAME`):

```text
https://t.me/<bot>?startapp=durak_<CODE>
```

Связь через MQTT (WebSocket), без WebRTC — так стабильнее в Telegram на LTE. Хост комнаты ведёт партию.
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
