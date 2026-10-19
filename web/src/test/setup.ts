import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach } from 'vitest'

function evaluateMediaQuery(query: string): boolean {
  if (!query || typeof query !== 'string') return false
  const trimmed = query.trim()
  if (trimmed === 'all' || trimmed === 'screen') return true
  if (trimmed === 'print') return false

  const width = typeof window.innerWidth === 'number' ? window.innerWidth : 1024
  const height = typeof window.innerHeight === 'number' ? window.innerHeight : 768

  const orParts = trimmed.split(/\s*,\s*/)
  return orParts.some((part) => {
    const branch = part.trim()
    const isNegated = branch.toLowerCase().startsWith('not ')
    const positiveBranch = isNegated ? branch.slice(4).trim() : branch

    const expressions = positiveBranch.split(/\s+and\s+/i)
    const branchMatches = expressions.every((expr) => {
      const clean = expr.trim().toLowerCase()
      if (clean === 'all' || clean === 'screen') return true
      if (clean === 'print') return false

      const maxWidthMatch = clean.match(/\(max-width:\s*(\d+(?:\.\d+)?)\s*(?:px)?\)/)
      if (maxWidthMatch) {
        return width <= parseFloat(maxWidthMatch[1] ?? '0')
      }

      const minWidthMatch = clean.match(/\(min-width:\s*(\d+(?:\.\d+)?)\s*(?:px)?\)/)
      if (minWidthMatch) {
        return width >= parseFloat(minWidthMatch[1] ?? '0')
      }

      const maxHeightMatch = clean.match(/\(max-height:\s*(\d+(?:\.\d+)?)\s*(?:px)?\)/)
      if (maxHeightMatch) {
        return height <= parseFloat(maxHeightMatch[1] ?? '0')
      }

      const minHeightMatch = clean.match(/\(min-height:\s*(\d+(?:\.\d+)?)\s*(?:px)?\)/)
      if (minHeightMatch) {
        return height >= parseFloat(minHeightMatch[1] ?? '0')
      }

      const orientationMatch = clean.match(/\(orientation:\s*(portrait|landscape)\)/)
      if (orientationMatch) {
        const isPortrait = height >= width
        return orientationMatch[1] === (isPortrait ? 'portrait' : 'landscape')
      }

      return true
    })

    return isNegated ? !branchMatches : branchMatches
  })
}

class MockMediaQueryList extends EventTarget {
  readonly media: string
  private _lastMatches: boolean
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => void) | null = null

  constructor(query: string) {
    super()
    this.media = query
    this._lastMatches = evaluateMediaQuery(query)
  }

  get matches(): boolean {
    return evaluateMediaQuery(this.media)
  }

  checkMatchesChange(): void {
    const current = this.matches
    if (current !== this._lastMatches) {
      this._lastMatches = current
      const ev = new Event('change') as MediaQueryListEvent
      Object.defineProperties(ev, {
        matches: { value: current, enumerable: true },
        media: { value: this.media, enumerable: true },
      })
      this.dispatchEvent(ev)
    }
  }

  addListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void): void {
    this.addEventListener('change', listener as EventListener)
  }

  removeListener(listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void): void {
    this.removeEventListener('change', listener as EventListener)
  }

  override dispatchEvent(event: Event): boolean {
    if (event.type === 'change' && typeof this.onchange === 'function') {
      try {
        this.onchange.call(this as unknown as MediaQueryList, event as MediaQueryListEvent)
      } catch (err) {
        console.error(err)
      }
    }
    return super.dispatchEvent(event)
  }
}

const activeMediaQueries = new Set<MockMediaQueryList>()

function handleResize(): void {
  for (const mql of activeMediaQueries) {
    mql.checkMatchesChange()
  }
}

const originalMatchMedia = typeof window !== 'undefined' ? window.matchMedia : undefined
const originalResizeTo = typeof window !== 'undefined' ? window.resizeTo : undefined
const originalScrollTo = typeof window !== 'undefined' ? window.scrollTo : undefined

if (typeof window !== 'undefined') {
  if (typeof window.innerWidth !== 'number' || window.innerWidth === 0) {
    window.innerWidth = 1024
  }
  if (typeof window.innerHeight !== 'number' || window.innerHeight === 0) {
    window.innerHeight = 768
  }

  window.addEventListener('resize', handleResize)

  window.matchMedia = function matchMedia(query: string): MediaQueryList {
    const mql = new MockMediaQueryList(query)
    activeMediaQueries.add(mql)
    return mql as unknown as MediaQueryList
  }

  window.resizeTo = function resizeTo(width: number, height: number): void {
    Object.assign(window, {
      innerWidth: width,
      innerHeight: height,
      outerWidth: width,
      outerHeight: height,
    })
    window.dispatchEvent(new Event('resize'))
  }

  // jsdom emits a "Not implemented" console error for scrollTo; the teams drill-down scrolls to top on open.
  window.scrollTo = function scrollTo(): void {}
}

afterEach(() => {
  activeMediaQueries.clear()
  if (typeof window !== 'undefined') {
    window.innerWidth = 1024
    window.innerHeight = 768
  }
})

afterAll(() => {
  activeMediaQueries.clear()
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleResize)
    if (originalMatchMedia !== undefined) {
      window.matchMedia = originalMatchMedia
    } else {
      Reflect.deleteProperty(window, 'matchMedia')
    }
    if (originalResizeTo !== undefined) {
      window.resizeTo = originalResizeTo
    } else {
      Reflect.deleteProperty(window, 'resizeTo')
    }
    if (originalScrollTo !== undefined) {
      window.scrollTo = originalScrollTo
    } else {
      Reflect.deleteProperty(window, 'scrollTo')
    }
  }
})
