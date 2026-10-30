import { Check, Languages } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n, type Locale } from '@/i18n'

const languages: { value: Locale; label: string; short: string }[] = [
  { value: 'zh-CN', label: '简体中文', short: '中文' },
  { value: 'en', label: 'English', short: 'EN' },
]

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()
  return <DropdownMenu>
    <DropdownMenuTrigger data-testid="language-switcher" aria-label={t('Interface language')} title={t('Language')} className="app-no-drag flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-xs text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      <Languages className="size-4" />
      <span className="flex-1 text-left">{t('Language')}</span>
      <span className="rounded-md bg-foreground/[0.04] px-1.5 py-0.5 text-[10px] font-medium">{languages.find((item) => item.value === locale)!.short}</span>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" className="glass-strong min-w-44 rounded-xl p-1.5">
      <DropdownMenuLabel className="text-[11px] text-muted-foreground">{t('Interface language')}</DropdownMenuLabel>
      {languages.map((language) => <DropdownMenuItem key={language.value} data-locale={language.value} onSelect={() => setLocale(language.value)} className="gap-2 rounded-lg text-xs">
        <span lang={language.value} className="flex-1">{language.label}</span>
        {locale === language.value && <Check className="size-3.5 text-primary" />}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
