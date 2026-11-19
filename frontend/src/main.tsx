import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Capacitor } from '@capacitor/core'
import { installViewportTracking } from './services/ios-native';

if (
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios'
) {
  document.documentElement.classList.add(
    'camplink-native-ios'
  )
}
installViewportTracking();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
