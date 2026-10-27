import '@/styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/App'

// Follow the system's light or dark setting.
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)')
const applyScheme = () => {
  document.documentElement.classList.toggle('dark', darkScheme.matches)
  // native controls and scrollbars follow too
  document.documentElement.style.colorScheme = darkScheme.matches ? 'dark' : 'light'
}
applyScheme()
darkScheme.addEventListener('change', applyScheme)

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
