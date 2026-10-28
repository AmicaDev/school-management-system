import { Component, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { AppProvider } from './contexts/AppContext'
import { reportClientError } from './services/api'
import './styles/index.css'
import badgeImg from './assets/IMG-20261010-WA0012.jpg'

class Boundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error, info) { reportClientError(error.message, { stack: `${error.stack}\n${info.componentStack}`, module: 'ErrorBoundary' }) }
  render() {
    if (!this.state.failed) return this.props.children
    return <div className="state" style={{ minHeight: '70vh', display: 'grid', placeContent: 'center' }}><h2>Something went wrong</h2><p>The problem has been reported. Your saved work on this device is safe.</p><button className="btn primary" onClick={() => location.assign('/')}>Reload</button></div>
  }
}

function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading school management system">
      <div className="splash-inner">
        <img src={badgeImg} alt="Kiyingi Memorial Secondary School" className="splash-badge" />
        <p className="splash-slogan">Welcome back to Kiyingi Memorial SS Managemnt System</p>
      </div>
    </div>
  )
}

function AppBoot() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 3000)
    return () => clearTimeout(t)
  }, [])
  return (
    <>
      {!ready && <Splash />}
      <div style={{ display: ready ? 'contents' : 'none' }}><App /></div>
    </>
  )
}

function UpdateBanner() {
  const [reg, setReg] = useState(null)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const h = (e) => setReg(e.detail)
    window.addEventListener('sms:update', h)
    return () => window.removeEventListener('sms:update', h)
  }, [])
  if (!reg) return null
  return <div className="update-bar" role="status">A new version is available. <button className="btn sm" onClick={() => { reg.waiting?.postMessage('SKIP_WAITING') }}>Update now</button></div>
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const announce = () => reg.waiting && navigator.serviceWorker.controller && window.dispatchEvent(new CustomEvent('sms:update', { detail: reg }))
      announce()
      reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', announce))
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
    }).catch((e) => reportClientError(`Service worker registration failed: ${e.message}`, { module: 'pwa', level: 'WARNING' }))
    let reloaded = false
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload() } })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode><Boundary><BrowserRouter><AuthProvider><AppProvider><UpdateBanner /><AppBoot /></AppProvider></AuthProvider></BrowserRouter></Boundary></StrictMode>,
)