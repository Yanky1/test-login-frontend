import { Route, Routes, Navigate } from 'react-router-dom'
import { RedirectIfAuthed, RequireAuth } from './components/RequireAuth'
import LoginPage from './pages/Login'
import { ForgotPasswordPage, ResetPasswordPage } from './pages/Recovery'
import AuthCallback from './pages/AuthCallback'
import GuestPage from './pages/Guest'
import Home from './pages/Home'
import SettingsPage from './pages/Settings'
import { WizardLayout } from './pages/wizard/shared'
import AccountStep from './pages/wizard/AccountStep'
import VerifyStep from './pages/wizard/VerifyStep'
import BusinessStep from './pages/wizard/BusinessStep'
import KosherStep from './pages/wizard/KosherStep'
import ReviewStep from './pages/wizard/ReviewStep'
import PendingStep from './pages/wizard/PendingStep'

export default function App() {
  return (
    <>
      <a href="#page-title" className="skip">Skip to content</a>
      <Routes>
        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/signup" element={<AccountStep />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/guest" element={<GuestPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Home />} />
          <Route path="/settings/:tab?" element={<SettingsPage />} />
          <Route path="/signup" element={<WizardLayout />}>
            <Route path="verify" element={<VerifyStep />} />
            <Route path="business" element={<BusinessStep />} />
            <Route path="kosher" element={<KosherStep />} />
            <Route path="review" element={<ReviewStep />} />
            <Route path="pending" element={<PendingStep />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
