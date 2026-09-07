#!/usr/bin/env node
/**
 * Configure the Telegram bot for the Playfort Mini App.
 *
 * Usage:
 *   BOT_TOKEN=123:ABC node scripts/setup-bot.mjs
 *
 * Get the token from @BotFather → /mybots → API Token.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN = process.env.BOT_TOKEN
// Query param forces Telegram to drop a stale Mini App HTML shell.
const APP_URL =
  process.env.APP_URL || `https://ve1lers.github.io/gamefortg/play/?v=${Date.now().toString(36)}`

if (!TOKEN) {
  console.error('Missing BOT_TOKEN. Example:\n  BOT_TOKEN=123:ABC node scripts/setup-bot.mjs')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

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

const me = await api('getMe')
console.log(`Bot: @${me.username} (${me.first_name})`)
console.log(`Mini App URL: ${APP_URL}`)

// Default + localized names so Telegram clients drop a cached GameForTg title.
for (const language_code of [undefined, 'en', 'ru']) {
  const body = language_code ? { name: 'Playfort', language_code } : { name: 'Playfort' }
  await api('setMyName', body)
  console.log(`✓ setMyName${language_code ? ` (${language_code})` : ''}`)
}

await api('setMyDescription', {
  description:
    'Playfort — classic games in Telegram.\n\nPoker, Durak, chess, checkers, and Klondike solitaire. No installs — open and play.',
})
console.log('✓ setMyDescription')

await api('setMyShortDescription', {
  short_description: 'Playfort: poker, Durak, chess, checkers, solitaire in Telegram',
})
console.log('✓ setMyShortDescription')

await api('setChatMenuButton', {
  menu_button: {
    type: 'web_app',
    text: 'Играть',
    web_app: { url: APP_URL },
  },
})
console.log('✓ setChatMenuButton')

await api('setMyCommands', {
  commands: [
    { command: 'start', description: 'Open Playfort' },
    { command: 'play', description: 'Launch games' },
    { command: 'help', description: 'How to play' },
  ],
})
console.log('✓ setMyCommands')

const avatarPath = join(root, 'public', 'bot-avatar.jpg')
const avatarPng = join(root, 'public', 'bot-avatar.png')
const photoFile = existsSync(avatarPath) ? avatarPath : existsSync(avatarPng) ? avatarPng : null
if (photoFile) {
  const bytes = readFileSync(photoFile)
  const form = new FormData()
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }))
  form.append('avatar', new Blob([bytes], { type: photoFile.endsWith('.png') ? 'image/png' : 'image/jpeg' }), 'avatar.jpg')
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/setMyProfilePhoto`, {
    method: 'POST',
    body: form,
  })
  const data = await res.json()
  if (!data.ok) {
    console.warn(`setMyProfilePhoto skipped: ${data.description || JSON.stringify(data)}`)
  } else {
    console.log('✓ setMyProfilePhoto')
  }
}

console.log('\nDone. Open the bot and tap the menu button «Играть».')
console.log('In BotFather also set Main Mini App if needed: /mybots → Bot Settings → Configure Mini App')
