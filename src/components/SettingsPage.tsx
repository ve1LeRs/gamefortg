import { useCallback, useEffect, useState } from 'react'
import {
  ACCENT_OPTIONS,
  CARD_BACK_OPTIONS,
  DEFAULT_SETTINGS,
  FELT_OPTIONS,
  type AnimLevel,
  type AppSettings,
  type CardBack,
  type DealSpeed,
  type FeltStyle,
  type AccentTheme,
  applySettingsToDom,
  loadSettings,
  playUiSound,
  playPokerSound,
  saveSettings,
} from '../lib/settings'
import { BOT_DIFFICULTIES, BOT_DIFFICULTY_HINT, BOT_DIFFICULTY_LABEL, type BotDifficulty } from '../games/botDifficulty'
import { hardReloadApp } from '../lib/reloadApp'

const PLAYS_KEY = 'gamefortg-plays'

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      className={`settings-toggle${on ? ' is-on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => {
        onChange(!on)
        playUiSound('tap')
      }}
    >
      <span className="settings-toggle-knob" />
    </button>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="settings-segmented" role="group">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`settings-seg${value === opt.id ? ' is-active' : ''}`}
          onClick={() => {
            onChange(opt.id)
            playUiSound('tap')
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsPage({ onHaptic }: { onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    applySettingsToDom(settings)
  }, [settings])

  const patch = useCallback(
    (partial: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...partial }
        saveSettings(next)
        return next
      })
      onHaptic?.('light')
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 900)
    },
    [onHaptic],
  )

  const resetSettings = () => {
    saveSettings({ ...DEFAULT_SETTINGS })
    setSettings({ ...DEFAULT_SETTINGS })
    playUiSound('warn')
    onHaptic?.('medium')
  }

  const resetStats = () => {
    localStorage.removeItem(PLAYS_KEY)
    playUiSound('warn')
    onHaptic?.('error')
  }

  return (
    <div className="settings-page">
      <header className="settings-hero">
        <div className="settings-hero-glow" aria-hidden />
        <p className="settings-kicker">Play<em>fort</em></p>
        <h1>Настройки</h1>
        <p className="settings-lead">Подкрутите ощущение стола под себя — всё сохраняется на этом устройстве.</p>
        {savedFlash && <span className="settings-saved">Сохранено</span>}
      </header>

      <section className="settings-section">
        <h2>Ощущения</h2>
        <div className="settings-row">
          <div>
            <strong>Вибрация</strong>
          </div>
          <Toggle label="Вибрация" on={settings.haptics} onChange={(haptics) => patch({ haptics })} />
        </div>
        <div className="settings-row">
          <div>
            <strong>Звуки</strong>
          </div>
          <Toggle
            label="Звуки"
            on={settings.sounds}
            onChange={(sounds) => {
              patch({ sounds })
              if (sounds) {
                playUiSound('ok')
                window.setTimeout(() => playPokerSound('chips'), 120)
              }
            }}
          />
        </div>
        <div className="settings-block">
          <strong>Анимации</strong>
          <Segmented<AnimLevel>
            value={settings.animations}
            onChange={(animations) => patch({ animations })}
            options={[
              { id: 'full', label: 'Полные' },
              { id: 'reduced', label: 'Мягче' },
              { id: 'off', label: 'Выкл' },
            ]}
          />
        </div>
        <div className="settings-block">
          <strong>Скорость раздачи</strong>
          <Segmented<DealSpeed>
            value={settings.dealSpeed}
            onChange={(dealSpeed) => patch({ dealSpeed })}
            options={[
              { id: 'slow', label: 'Медленно' },
              { id: 'normal', label: 'Норма' },
              { id: 'fast', label: 'Быстро' },
            ]}
          />
        </div>
        <div className="settings-row">
          <div>
            <strong>Не гасить экран</strong>
          </div>
          <Toggle label="Не гасить экран" on={settings.keepAwake} onChange={(keepAwake) => patch({ keepAwake })} />
        </div>
      </section>

      <section className="settings-section">
        <h2>Внешний вид</h2>
        <div className="settings-block">
          <strong>Акцент</strong>
          <div className="settings-swatches" role="listbox" aria-label="Цвет акцента">
            {ACCENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`settings-swatch${settings.accent === opt.id ? ' is-active' : ''}`}
                style={{ ['--swatch' as string]: opt.color }}
                aria-label={opt.label}
                onClick={() => {
                  patch({ accent: opt.id as AccentTheme })
                  playUiSound('ok')
                }}
              >
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="settings-block">
          <strong>Рубашка карт</strong>
          <div className="settings-cardbacks">
            {CARD_BACK_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`settings-cardback settings-cardback--${opt.id}${settings.cardBack === opt.id ? ' is-active' : ''}`}
                onClick={() => {
                  patch({ cardBack: opt.id as CardBack })
                  playUiSound('deal')
                }}
              >
                <span className="settings-cardback-face" aria-hidden />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="settings-block">
          <strong>Сукно стола</strong>
          <Segmented<FeltStyle>
            value={settings.felt}
            onChange={(felt) => patch({ felt })}
            options={FELT_OPTIONS}
          />
        </div>
        <div className="settings-row">
          <div>
            <strong>Эффекты стола</strong>
            <p>Блики, пульсации и лёгкое свечение активных зон</p>
          </div>
          <Toggle
            label="Эффекты стола"
            on={settings.tableEffects}
            onChange={(tableEffects) => patch({ tableEffects })}
          />
        </div>
        <div className="settings-row">
          <div>
            <strong>Крупный козырь</strong>
            <p>В дураке козырная масть заметнее у колоды</p>
          </div>
          <Toggle label="Крупный козырь" on={settings.largeTrump} onChange={(largeTrump) => patch({ largeTrump })} />
        </div>
      </section>

      <section className="settings-section">
        <h2>Игры</h2>
        <div className="settings-block">
          <strong>Сложность бота по умолчанию</strong>
          <p>{BOT_DIFFICULTY_HINT[settings.botDifficulty]}</p>
          <Segmented<BotDifficulty>
            value={settings.botDifficulty}
            onChange={(botDifficulty) => patch({ botDifficulty })}
            options={BOT_DIFFICULTIES.map((id) => ({ id, label: BOT_DIFFICULTY_LABEL[id] }))}
          />
        </div>
        <div className="settings-row">
          <div>
            <strong>Подтверждать фолд</strong>
            <p>В покере спросить ещё раз перед сбросом карт</p>
          </div>
          <Toggle label="Подтверждать фолд" on={settings.confirmFold} onChange={(confirmFold) => patch({ confirmFold })} />
        </div>
        <div className="settings-row">
          <div>
            <strong>Автосбор косынки</strong>
            <p>Когда всё открыто — сразу предлагать «Собрать»</p>
          </div>
          <Toggle
            label="Автосбор косынки"
            on={settings.autoClearSolitaire}
            onChange={(autoClearSolitaire) => patch({ autoClearSolitaire })}
          />
        </div>
        <div className="settings-row">
          <div>
            <strong>Яркие подсказки</strong>
            <p>Подсветка хода в косынке заметнее</p>
          </div>
          <Toggle
            label="Яркие подсказки"
            on={settings.highlightHints}
            onChange={(highlightHints) => patch({ highlightHints })}
          />
        </div>
      </section>

      <section className="settings-section">
        <h2>Приложение</h2>
        <button type="button" className="btn btn-soft settings-action" onClick={hardReloadApp}>
          Обновить приложение
        </button>
        <button type="button" className="btn btn-soft settings-action" onClick={resetStats}>
          Сбросить статистику запусков
        </button>
        <button type="button" className="btn btn-soft settings-action is-danger" onClick={resetSettings}>
          Сбросить все настройки
        </button>
        <p className="settings-build" aria-hidden>
          {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}
        </p>
      </section>
    </div>
  )
}
