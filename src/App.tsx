import { lazy, Suspense } from 'react'
import { Route, Routes, Navigate } from 'react-router-dom'
import { Spinner } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RedirectIfAuthed, RequireAuth } from './components/RequireAuth'
import LoginPage from './pages/Login'
import { ForgotPasswordPage, ResetPasswordPage } from './pages/Recovery'
import AuthCallback from './pages/AuthCallback'
const GuestPage = lazy(() => import('./pages/Guest'))
import Home from './pages/Home'
const SettingsPage = lazy(() => import('./pages/Settings'))
const ProductsListPage = lazy(() => import('./products/ProductsList'))
const NewProductPage = lazy(() => import('./products/NewProduct'))
const ProductEditorPage = lazy(() => import('./products/ProductEditor'))
const QuestionsPage = lazy(() => import('./products/Questions'))
const CsvPage = lazy(() => import('./products/CsvPage'))
const PhoneLinkPage = lazy(() => import('./pages/PhoneLink'))
const InvitePage = lazy(() => import('./pages/teams/Invite'))
const ChooseAccount = lazy(() => import('./pages/teams/ChooseAccount'))
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
      <ErrorBoundary>
      <Suspense fallback={<div className="center"><Spinner /></div>}>
      <Routes>
        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/signup" element={<AccountStep />} />
        <Route path="/signup/verify" element={<VerifyStep />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/l/:token" element={<PhoneLinkPage />} />
        <Route path="/l" element={<PhoneLinkPage />} />
        <Route path="/guest" element={<GuestPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Home />} />
          <Route path="/settings/:tab?" element={<SettingsPage />} />
          <Route path="/accounts" element={<ChooseAccount />} />
          <Route path="/products" element={<ProductsListPage />} />
          <Route path="/products/new" element={<NewProductPage />} />
          <Route path="/products/import" element={<CsvPage />} />
          <Route path="/products/:id" element={<ProductEditorPage />} />
          <Route path="/questions" element={<QuestionsPage />} />
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
      </ErrorBoundary>
    </>
  )
}
