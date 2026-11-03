import { lazy, Suspense } from 'react'
import { Route, Routes, Navigate } from 'react-router-dom'
import { Spinner } from './components/ui'
import { RedirectIfAuthed, RequireAuth } from './components/RequireAuth'
import LoginPage from './pages/Login'
import { ForgotPasswordPage, ResetPasswordPage } from './pages/Recovery'
import AuthCallback from './pages/AuthCallback'
const GuestPage = lazy(() => import('./pages/Guest'))
import Home from './pages/Home'
const SettingsPage = lazy(() => import('./pages/Settings'))
const PhoneLinkPage = lazy(() => import('./pages/PhoneLink'))
import { WizardLayout } from './pages/wizard/shared'
import AccountStep from './pages/wizard/AccountStep'
import VerifyStep from './pages/wizard/VerifyStep'
const BusinessStep = lazy(() => import('./pages/wizard/BusinessStep'))
const KosherStep = lazy(() => import('./pages/wizard/KosherStep'))
const ReviewStep = lazy(() => import('./pages/wizard/ReviewStep'))
const PendingStep = lazy(() => import('./pages/wizard/PendingStep'))

export default function App() {
  return (
    <>
      <a href="#page-title" className="skip">Skip to content</a>
      <Suspense fallback={<div className="center"><Spinner /></div>}>
      <Routes>
        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/signup" element={<AccountStep />} />
        <Route path="/signup/verify" element={<VerifyStep />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/l/:token" element={<PhoneLinkPage />} />
        <Route path="/guest" element={<GuestPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Home />} />
          <Route path="/settings/:tab?" element={<SettingsPage />} />
          <Route path="/signup" element={<WizardLayout />}>
            <Route path="business" element={<BusinessStep />} />
            <Route path="kosher" element={<KosherStep />} />
            <Route path="review" element={<ReviewStep />} />
            <Route path="pending" element={<PendingStep />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  )
}
