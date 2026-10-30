import { useCallback, useSyncExternalStore } from 'react'
import { commonZh } from './common'
import { chatZh } from './chat'
import { settingsZh } from './settings'
import { resourcesZh } from './resources'

export type Locale = 'zh-CN' | 'en'
export type TranslationValues = Record<string, string | number>
const STORAGE_KEY = 'connect.language'
const chinese = { ...resourcesZh, ...settingsZh, ...chatZh, ...commonZh }
const english = Object.fromEntries(Object.entries(chinese).map(([key, value]) => [value, key]))
const listeners = new Set<() => void>()
const systemLocale = (): Locale => navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
const saved = localStorage.getItem(STORAGE_KEY)
let current: Locale = saved === 'zh-CN' || saved === 'en' ? saved : systemLocale()
document.documentElement.lang = current

export const getLocale = () => current
export const localeTag = () => current === 'en' ? 'en-US' : 'zh-CN'

/** Only explicitly marked interface strings pass through this dictionary. */
export function translate(locale: Locale, source: string, values?: TranslationValues): string {
  const template = locale === 'zh-CN' ? chinese[source] ?? source : english[source] ?? source
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values?.[key] === undefined ? match : String(values[key]))
}

export const t = (source: string, values?: TranslationValues) => translate(current, source, values)

export function setLocale(locale: Locale) {
  localStorage.setItem(STORAGE_KEY, locale)
  if (locale === current) return
  current = locale
  document.documentElement.lang = locale
  listeners.forEach((listener) => listener())
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return
  const next = event.newValue === 'zh-CN' || event.newValue === 'en' ? event.newValue : systemLocale()
  if (next === current) return
  current = next
  document.documentElement.lang = current
  listeners.forEach((listener) => listener())
})

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** Locale updates re-render subscribers without replacing any page or draft state. */
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale)
  const translateCurrent = useCallback((source: string, values?: TranslationValues) => translate(locale, source, values), [locale])
  return { locale, setLocale, t: translateCurrent }
}
