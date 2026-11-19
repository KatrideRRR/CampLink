import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Capacitor } from '@capacitor/core'

if (
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios'
) {
  document.documentElement.classList.add(
    'camplink-native-ios'
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
