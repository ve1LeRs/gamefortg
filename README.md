# Playfort

Mobile game hub inside a Telegram Mini App (repo `gamefortg`).

## Игры

- **Покер** — техасский холдем против бота
- **Дурак** — против бота или **онлайн**: открытые комнаты в лобби (или по ссылке)
- **Шахматы** — с ботом или **онлайн** (комнаты в лобби)
- **Шашки** — с ботом или **онлайн** (комнаты в лобби)
- **Косынка** — пасьянс Klondike

## Дурак онлайн

1. Откройте Дурак → **С другом онлайн** → **Создать комнату**
2. Комната появляется в списке **Открытые комнаты** у других игроков
3. Друг нажимает на комнату в списке → **войти**

Можно по-прежнему пригласить по ссылке («Пригласить по ссылке») или войти по коду (скрыто в меню).

Deep link (если задан `VITE_BOT_USERNAME`):

```text
https://t.me/<bot>?startapp=durak_<CODE>
```

Связь через MQTT (WebSocket): канал лобби для списка комнат + шина комнаты для партии. Хост ведёт игру.
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

1. В [@BotFather](https://t.me/BotFather) задайте имя бота: **Playfort**
2. Описание (или через `npm run setup:bot`):
   - Description: `Playfort — classic games in Telegram…`
   - Short description: `Playfort: poker, Durak, chess, checkers, solitaire in Telegram`
3. Main Mini App / Menu Button URL (новый путь — сбрасывает кэш Telegram):

```text
https://ve1lers.github.io/gamefortg/play/?v=mqtt1
```

Старый URL `.../gamefortg/` тоже работает, но Telegram часто кэширует PeerJS-оболочку.
4. Аватар: `public/bot-avatar.png`
5. Автонастройка через API (нужен токен бота) — ставит имя Playfort, английские описания, меню «Играть»:

```bash
BOT_TOKEN=123:ABC npm run setup:bot
```

Мини-приложение само вызывает `expand()` + `requestFullscreen()` и подстраивает safe-area под вырез экрана.
