/**
 * Browser Notification API Service
 * Handles notification permission checks and web notifications.
 */

export const isNotificationSupported = () => {
  return typeof window !== 'undefined' && 'Notification' in window
}

export const getNotificationPermission = () => {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

export const requestNotificationPermission = async () => {
  if (!isNotificationSupported()) return 'unsupported'
  try {
    const perm = await Notification.requestPermission()
    return perm
  } catch (err) {
    console.warn('Failed to request notification permission:', err)
    return 'default'
  }
}

export const sendBrowserNotification = (title, options = {}) => {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return null
  try {
    const n = new Notification(title, {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      ...options
    })
    return n
  } catch (err) {
    console.warn('Failed to display browser notification:', err)
    return null
  }
}

