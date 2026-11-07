// Optional wallpaper (Cindy's Settings > Appearance > Wallpaper). Off by default and
// nothing is bundled: set one with ?wallpaper=<url> or localStorage 'wallpaper'.
export function applyWallpaper(): void {
  const root = document.documentElement
  let url = new URLSearchParams(location.search).get('wallpaper')
  try {
    if (url) localStorage.setItem('wallpaper', url)
    else url = localStorage.getItem('wallpaper')
  } catch {
    // Storage may be unavailable; the query parameter still applies for this load.
  }
  if (!url || url === 'none') {
    root.removeAttribute('data-wallpaper-active')
    root.style.removeProperty('--app-wallpaper-image')
    return
  }
  root.dataset.wallpaperActive = 'true'
  root.style.setProperty('--app-wallpaper-image', `url("${url.replace(/"/g, '%22')}")`)
}
