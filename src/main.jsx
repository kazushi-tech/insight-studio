import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { RbacProvider } from './contexts/RbacContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AdsSetupProvider } from './contexts/AdsSetupContext'
import { ReportHistoryProvider } from './contexts/ReportHistoryContext'
import { AnalysisRunsProvider } from './contexts/AnalysisRunsContext'
import { BackendReadinessProvider } from './contexts/BackendReadinessContext'
import { UserProfileProvider } from './contexts/UserProfileContext'
import './index.css'
import App from './App.jsx'

// Global error handlers — catch unhandled errors that slip through component boundaries
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Insight Studio] Unhandled promise rejection:', event.reason)
  event.preventDefault() // Prevent default browser error logging noise
})

window.addEventListener('error', (event) => {
  console.error('[Insight Studio] Uncaught error:', event.error || event.message)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <RbacProvider>
            <UserProfileProvider>
              <AdsSetupProvider>
                <ReportHistoryProvider>
                  <BackendReadinessProvider>
                    <AnalysisRunsProvider>
                      <App />
                    </AnalysisRunsProvider>
                  </BackendReadinessProvider>
                </ReportHistoryProvider>
              </AdsSetupProvider>
            </UserProfileProvider>
          </RbacProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
