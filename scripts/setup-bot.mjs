#!/usr/bin/env node
/**
 * Configure @steamtg_bot (or any bot) for GameForTg Mini App.
 *
 * Usage:
 *   BOT_TOKEN=123:ABC node scripts/setup-bot.mjs
 *
 * Get the token from @BotFather → /mybots → API Token.
 */

const TOKEN = process.env.BOT_TOKEN
// Query param forces Telegram to drop a stale Mini App HTML shell.
const APP_URL =
  process.env.APP_URL || `https://ve1lers.github.io/gamefortg/?v=${Date.now().toString(36)}`

if (!TOKEN) {
  console.error('Missing BOT_TOKEN. Example:\n  BOT_TOKEN=123:ABC node scripts/setup-bot.mjs')
  process.exit(1)
}

const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json()
  if (!data.ok) {
    throw new Error(`${method}: ${data.description || JSON.stringify(data)}`)
  }
  return data.result
}

const steps = [
  ['setMyName', { name: 'GameForTg' }],
  [
    'setMyDescription',
    {
      description:
        'GameForTg — мобильный игровой хаб в Telegram.\n\nПокер, дурак, шахматы, шашки и косынка. Без установок — просто откройте и играйте.',
    },
  ],
  [
    'setMyShortDescription',
    {
      short_description: 'Игры в Telegram: покер, дурак, шахматы, шашки, косынка',
    },
  ],
  [
    'setChatMenuButton',
    {
      menu_button: {
        type: 'web_app',
        text: 'Играть',
        web_app: { url: APP_URL },
      },
    },
  ],
  [
    'setMyCommands',
    {
      commands: [
        { command: 'start', description: 'Открыть GameForTg' },
        { command: 'play', description: 'Запустить игры' },
        { command: 'help', description: 'Как играть' },
      ],
    },
  ],
]

const me = await api('getMe')
console.log(`Bot: @${me.username} (${me.first_name})`)
console.log(`Mini App URL: ${APP_URL}`)

for (const [method, body] of steps) {
  await api(method, body)
  console.log(`✓ ${method}`)
}

console.log('\nDone. Open the bot and tap the menu button «Играть».')
console.log('In BotFather also set Main Mini App if needed: /mybots → Bot Settings → Configure Mini App')
