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
import { useAdsSetup } from './contexts/AdsSetupContext'

function SetupGuard({ children }) {
  const { isSetupComplete } = useAdsSetup()
  if (!isSetupComplete) return <Navigate to="/ads/wizard" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="compare" element={<Compare />} />
        <Route path="discovery" element={<Discovery />} />
        <Route path="creative-review" element={<CreativeReview />} />
        <Route path="ads/wizard" element={<SetupWizard />} />
        <Route path="ads/pack" element={<SetupGuard><EssentialPack /></SetupGuard>} />
        <Route path="ads/graphs" element={<SetupGuard><AnalysisGraphs /></SetupGuard>} />
        <Route path="ads/ai" element={<SetupGuard><AiExplorer /></SetupGuard>} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
