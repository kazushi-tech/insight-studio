import { useEffect } from 'react'

const PRIVATE_META = [
  { selector: 'meta[name="robots"]', attribute: 'name', name: 'robots', content: 'noindex,nofollow,noarchive' },
  { selector: 'meta[http-equiv="Cache-Control"]', attribute: 'http-equiv', name: 'Cache-Control', content: 'no-store, max-age=0' },
  { selector: 'meta[http-equiv="Pragma"]', attribute: 'http-equiv', name: 'Pragma', content: 'no-cache' },
  { selector: 'meta[http-equiv="Expires"]', attribute: 'http-equiv', name: 'Expires', content: '0' },
]

/**
 * Browser-side reinforcement for tokenized/private routes. HTTP response
 * headers remain authoritative; these tags also protect SPA navigations.
 */
export default function useDocumentPrivacyMeta(title = '共有レポート | Insight Studio') {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title

    const changes = PRIVATE_META.map((definition) => {
      let element = document.head.querySelector(definition.selector)
      const created = !element
      if (!element) {
        element = document.createElement('meta')
        element.setAttribute(definition.attribute, definition.name)
        document.head.appendChild(element)
      }
      const previousContent = element.getAttribute('content')
      element.setAttribute('content', definition.content)
      return { element, created, previousContent }
    })

    return () => {
      document.title = previousTitle
      changes.forEach(({ element, created, previousContent }) => {
        if (created) {
          element.remove()
        } else if (previousContent === null) {
          element.removeAttribute('content')
        } else {
          element.setAttribute('content', previousContent)
        }
      })
    }
  }, [title])
}
