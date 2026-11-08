import '@/styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/App'

// Native vibrancy is used only for the sidebar; the main work surface stays solid.
document.documentElement.dataset.platform = window.connect.platform

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
