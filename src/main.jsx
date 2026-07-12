import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import RootAuthProvider from './auth/RootAuthProvider'
import { RbacProvider } from './contexts/RbacContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AdsSetupProvider } from './contexts/AdsSetupContext'
import { ReportHistoryProvider } from './contexts/ReportHistoryContext'
import { AnalysisRunsProvider } from './contexts/AnalysisRunsContext'
import { BackendReadinessProvider } from './contexts/BackendReadinessContext'
import { UserProfileProvider } from './contexts/UserProfileContext'
import './index.css'
import App from './App.jsx'
import { initializeClientObservability, installSafeClientErrorHandlers } from './observability/client'

// Do not echo exception objects: provider payloads can contain customer data.
installSafeClientErrorHandlers()
void initializeClientObservability()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <RootAuthProvider>
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
        </RootAuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
