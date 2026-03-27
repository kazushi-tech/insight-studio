import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AdsSetupProvider } from './contexts/AdsSetupContext'
import { AnalysisRunsProvider } from './contexts/AnalysisRunsContext'
import { UserProfileProvider } from './contexts/UserProfileContext'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <UserProfileProvider>
            <AdsSetupProvider>
              <AnalysisRunsProvider>
                <App />
              </AnalysisRunsProvider>
            </AdsSetupProvider>
          </UserProfileProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
