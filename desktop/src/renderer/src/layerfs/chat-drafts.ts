/** Per-window message drafts survive a visit to Settings. */
export function readDraft(id: string) {
  try { return sessionStorage.getItem(`lfs.message.${id}`) ?? '' } catch { return '' }
}
export function saveDraft(id: string, text: string) {
  try {
    if (text) sessionStorage.setItem(`lfs.message.${id}`, text)
    else sessionStorage.removeItem(`lfs.message.${id}`)
  } catch { /* restricted browser storage */ }
}
