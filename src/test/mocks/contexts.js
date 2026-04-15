import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../contexts/AuthContext.jsx'
import { AnalysisRunsProvider } from '../../contexts/AnalysisRunsContext.jsx'

/**
 * Wraps children with all required context providers for testing.
 * Usage: render(<MyComponent />, { wrapper: TestProviders })
 *
 * BackendReadinessProvider is not needed here because
 * useBackendReadiness() works with module-level state, not React context.
 */
export function TestProviders({ children }) {
  return createElement(
    MemoryRouter,
    null,
    createElement(
      AuthProvider,
      null,
      createElement(
        AnalysisRunsProvider,
        null,
        children,
      ),
    ),
  )
}
