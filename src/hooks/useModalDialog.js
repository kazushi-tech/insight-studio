import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Keep a body-level modal isolated from the application and keyboard-safe. */
export function useModalDialog(onRequestClose) {
  const dialogRef = useRef(null)
  const initialFocusRef = useRef(null)
  const closeHandlerRef = useRef(onRequestClose)

  useEffect(() => {
    closeHandlerRef.current = onRequestClose
  }, [onRequestClose])

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const appRoot = document.getElementById('root')
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden')
    const wasInert = Boolean(appRoot?.inert)
    if (appRoot) {
      appRoot.inert = true
      appRoot.setAttribute('aria-hidden', 'true')
    }
    initialFocusRef.current?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeHandlerRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) ?? [])
        .filter((element) => element instanceof HTMLElement && !element.hidden)
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (appRoot) {
        appRoot.inert = wasInert
        if (previousAriaHidden == null) appRoot.removeAttribute('aria-hidden')
        else appRoot.setAttribute('aria-hidden', previousAriaHidden)
      }
      returnFocus?.focus?.()
    }
  }, [])

  return { dialogRef, initialFocusRef }
}
