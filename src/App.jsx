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

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="compare" element={<Compare />} />
        <Route path="discovery" element={<Discovery />} />
        <Route path="creative-review" element={<CreativeReview />} />
        <Route path="ads/wizard" element={<SetupWizard />} />
        <Route path="ads/pack" element={<EssentialPack />} />
        <Route path="ads/graphs" element={<AnalysisGraphs />} />
        <Route path="ads/ai" element={<AiExplorer />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
