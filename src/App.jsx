import { Component, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { useAdsSetup } from './contexts/AdsSetupContext'
import { useRbac } from './contexts/RbacContext'
import { isProjectManagementEnabled } from './config/features'

const Layout = lazy(() => import('./components/Layout'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const AnalysisHub = lazy(() => import('./pages/AnalysisHub'))
const Compare = lazy(() => import('./pages/Compare'))
const Discovery = lazy(() => import('./pages/Discovery'))
const CreativeReview = lazy(() => import('./pages/CreativeReview'))
const SetupWizard = lazy(() => import('./pages/SetupWizard'))
const BeginnerReport = lazy(() => import('./pages/BeginnerReport'))
const AnalysisGraphs = lazy(() => import('./pages/AnalysisGraphs'))
const AiExplorer = lazy(() => import('./pages/AiExplorer'))
const Settings = lazy(() => import('./pages/Settings'))
const ProjectManagement = lazy(() => import('./pages/ProjectManagement'))
const Login = lazy(() => import('./pages/Login'))
const LpLayout = lazy(() => import('./pages/landing/LpLayout'))
const LandingPage = lazy(() => import('./pages/landing/LandingPage'))
const LpPricing = lazy(() => import('./pages/landing/LpPricing'))
const LpCompare = lazy(() => import('./pages/landing/LpCompare'))
const LpPerformance = lazy(() => import('./pages/landing/LpPerformance'))
const LpCreative = lazy(() => import('./pages/landing/LpCreative'))
const LpDiscovery = lazy(() => import('./pages/landing/LpDiscovery'))
const ReportV2Debug = import.meta.env.DEV ? lazy(() => import('./pages/debug/ReportV2Debug')) : null
const UiUxReview = import.meta.env.DEV ? lazy(() => import('./pages/debug/UiUxReview')) : null

function RouteLoading() {
  return (
    <div className="grid min-h-48 place-items-center px-6 py-12" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm font-bold text-on-surface-variant japanese-text">
        <span className="material-symbols-outlined animate-spin text-xl text-primary motion-reduce:animate-none" aria-hidden="true">
          progress_activity
        </span>
        画面を準備しています
      </div>
    </div>
  )
}

function RouteSuspense({ children }) {
  return <Suspense fallback={<RouteLoading />}>{children}</Suspense>
}

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

function AuthGuard({ children }) {
  const { isAuthenticated } = useRbac()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function AdminGuard({ children }) {
  const { isAdmin } = useRbac()
  if (!isAdmin) return <Navigate to="/" replace />
  return children
}

function LegacyAdsAiRedirect() {
  const location = useLocation()
  const search = location.search || (typeof window !== 'undefined' ? window.location.search : '') || ''
  return <Navigate to={`/insights/ai${search}`} replace />
}


export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Login — outside Layout, brand-aligned standalone page */}
        <Route path="login" element={<RouteSuspense><Login /></RouteSuspense>} />
        {/* LP pages — outside Layout, own navbar/footer */}
        <Route path="lp" element={<RouteSuspense><LpLayout /></RouteSuspense>}>
          <Route index element={<RouteSuspense><LandingPage /></RouteSuspense>} />
          <Route path="pricing" element={<RouteSuspense><LpPricing /></RouteSuspense>} />
          <Route path="compare" element={<RouteSuspense><LpCompare /></RouteSuspense>} />
          <Route path="performance" element={<RouteSuspense><LpPerformance /></RouteSuspense>} />
          <Route path="creative" element={<RouteSuspense><LpCreative /></RouteSuspense>} />
          <Route path="discovery" element={<RouteSuspense><LpDiscovery /></RouteSuspense>} />
        </Route>
        {/* App pages — require login */}
        <Route element={<AuthGuard><RouteSuspense><Layout /></RouteSuspense></AuthGuard>}>
          <Route index element={<RouteSuspense><Dashboard /></RouteSuspense>} />
          <Route path="analysis" element={<RouteSuspense><AnalysisHub /></RouteSuspense>} />
          <Route path="compare" element={<AdminGuard><RouteSuspense><Compare /></RouteSuspense></AdminGuard>} />
          <Route path="discovery" element={<AdminGuard><RouteSuspense><Discovery /></RouteSuspense></AdminGuard>} />
          <Route path="creative-review" element={<AdminGuard><RouteSuspense><CreativeReview /></RouteSuspense></AdminGuard>} />
          <Route path="ads/wizard" element={<RouteSuspense><SetupWizard /></RouteSuspense>} />
          <Route path="ads/pack" element={<Navigate to="/ads/report" replace />} />
          <Route path="ads/report" element={<SetupGuard><RouteSuspense><BeginnerReport /></RouteSuspense></SetupGuard>} />
          <Route path="ads/graphs" element={<SetupGuard><RouteSuspense><AnalysisGraphs /></RouteSuspense></SetupGuard>} />
          <Route path="ads/ai" element={<SetupGuard><LegacyAdsAiRedirect /></SetupGuard>} />
          <Route path="insights/ai" element={<SetupGuard><RouteSuspense><AiExplorer /></RouteSuspense></SetupGuard>} />
          <Route path="cases" element={<Navigate to={isProjectManagementEnabled ? '/projects' : '/settings'} replace />} />
          <Route
            path="projects"
            element={isProjectManagementEnabled
              ? <AdminGuard><RouteSuspense><ProjectManagement /></RouteSuspense></AdminGuard>
              : <Navigate to="/settings" replace />}
          />
          <Route path="settings" element={<RouteSuspense><Settings /></RouteSuspense>} />
          {import.meta.env.DEV && (
            <>
              <Route path="debug/report-v2" element={<RouteSuspense><ReportV2Debug /></RouteSuspense>} />
              <Route path="debug/ui-ux-review" element={<RouteSuspense><UiUxReview /></RouteSuspense>} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
