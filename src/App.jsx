import { Component } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Compare from './pages/Compare'
import Discovery from './pages/Discovery'
import CreativeReview from './pages/CreativeReview'
import SetupWizard from './pages/SetupWizard'
import EssentialPack from './pages/EssentialPack'
import AnalysisGraphs from './pages/AnalysisGraphs'
import AiExplorer from './pages/AiExplorer'
import Settings from './pages/Settings'
import CaseManagement from './pages/CaseManagement'
import ProjectManagement from './pages/ProjectManagement'
import LpLayout from './pages/landing/LpLayout'
import LandingPage from './pages/landing/LandingPage'
import LpPricing from './pages/landing/LpPricing'
import LpCompare from './pages/landing/LpCompare'
import LpPerformance from './pages/landing/LpPerformance'
import LpCreative from './pages/landing/LpCreative'
import LpDiscovery from './pages/landing/LpDiscovery'
import { useAuth } from './contexts/AuthContext'
import { useAdsSetup } from './contexts/AdsSetupContext'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-surface">
          <div className="panel-card text-center space-y-4 max-w-md">
            <span className="material-symbols-outlined text-5xl text-error">error</span>
            <h2 className="text-xl font-bold japanese-text">予期しないエラーが発生しました</h2>
            <p className="text-sm text-on-surface-variant japanese-text">
              問題が解決しない場合は、ページを再読み込みしてください。
            </p>
            <button
              onClick={() => window.location.reload()}
              className="button-primary mx-auto"
            >
              ページを再読み込み
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function SetupGuard({ children }) {
  const { isAdsAuthenticated } = useAuth()
  const { isSetupComplete, isCaseAuthenticated, setupState, currentCase } = useAdsSetup()
  if (!isAdsAuthenticated || !isSetupComplete) return <Navigate to="/ads/wizard" replace />
  if (!isCaseAuthenticated) return <Navigate to="/ads/wizard" replace />
  if (setupState?.datasetId && currentCase?.dataset_id && setupState.datasetId !== currentCase.dataset_id) {
    return <Navigate to="/ads/wizard" replace />
  }
  return children
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* LP pages — outside Layout, own navbar/footer */}
        <Route path="lp" element={<LpLayout />}>
          <Route index element={<LandingPage />} />
          <Route path="pricing" element={<LpPricing />} />
          <Route path="compare" element={<LpCompare />} />
          <Route path="performance" element={<LpPerformance />} />
          <Route path="creative" element={<LpCreative />} />
          <Route path="discovery" element={<LpDiscovery />} />
        </Route>
        {/* App pages */}
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="compare" element={<Compare />} />
          <Route path="discovery" element={<Discovery />} />
          <Route path="creative-review" element={<CreativeReview />} />
          <Route path="ads/wizard" element={<SetupWizard />} />
          <Route path="ads/pack" element={<SetupGuard><EssentialPack /></SetupGuard>} />
          <Route path="ads/graphs" element={<SetupGuard><AnalysisGraphs /></SetupGuard>} />
          <Route path="ads/ai" element={<SetupGuard><AiExplorer /></SetupGuard>} />
          <Route path="cases" element={<CaseManagement />} />
          <Route path="projects" element={<ProjectManagement />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
