import { Link } from 'react-router-dom'
import { Icon } from '../../components/ui'
import { StepFrame, useWizard } from './shared'

const TRACK = ['Sent', 'Review', 'Approved'] as const

/** index of the tracker stage that is currently active */
export const trackerIndex = (status: string) =>
  ({ Draft: -1, PendingReview: 1, NeedsInfo: 1, Rejected: 1, Approved: 2, Suspended: 2 } as Record<string, number>)[status] ?? 1

const HEADING: Record<string, string> = {
  Approved: 'Your application is approved',
  Rejected: 'Your application was not approved',
  Suspended: 'Your account is suspended',
}

export default function PendingStep() {
  const { app } = useWizard()
  const idx = trackerIndex(app.status)
  const decided = app.status === 'Approved'
  const reviewing = app.status === 'PendingReview' || app.status === 'NeedsInfo' // still being looked at: drafts are allowed meanwhile
  return (
    <StepFrame index={5}>
      <div className="pending-head">
      <span className="hero" aria-hidden="true"><Icon name={decided ? 'check' : 'clock'} /></span>
      <h1 tabIndex={-1}>{HEADING[app.status] ?? 'Your application is pending'}</h1>
      {app.status === 'NeedsInfo' && <p role="status" className="alert info">We need more information. {app.statusNote} <Link to="/signup/business">Update your application</Link></p>}
      {app.status === 'Rejected' && <p role="status" className="alert error">Unfortunately your application was not approved.</p>}
      {app.status === 'Suspended' && <p role="status" className="alert error">Your account is suspended.</p>}
      {decided
        ? <p role="status" className="alert success">{'You\u2019re approved \u2014 your shop is open and you can publish products.'}{app.business.vendorName ? ` Welcome, ${app.business.vendorName}!` : ''}</p>
        : <p>Thanks{app.business.vendorName ? `, ${app.business.vendorName}` : ''}! Management will reach out to you by email once your application has been reviewed. You can safely close this page.</p>}
      </div>
      <ol className="tracker" aria-label="Application status">
        {TRACK.map((t, i) => (
          <li key={t} className={i < idx || (decided && i === idx) ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>
            <span className="dot">{i < idx || (decided && i === idx) ? '✓' : i + 1}</span><span className="lbl">{t}</span>
          </li>
        ))}
      </ol>
      {decided ? (
        <div className="next">
          <h2>You&rsquo;re all set</h2>
          <p>Add your products, check how they look and publish them whenever you&rsquo;re ready.</p>
          <div className="row"><Link className="btn primary" to="/products">Go to your products</Link></div>
        </div>
      ) : reviewing ? (
        <div className="next">
          <h2>What happens next</h2>
          <ul>
            <li>Our team reviews your business details and kosher information.</li>
            <li>We email you at your account address with the decision, or if we need anything else.</li>
            <li>Once approved, your shop opens and you can publish products.</li>
          </ul>
          <p><Link to="/products">Start preparing your products (saved as drafts)</Link></p>
        </div>
      ) : app.status === 'Rejected' ? (
        <div className="next">
          <h2>Think we got this wrong?</h2>
          <p>You can ask us to take another look. Contact Solvelt support and tell us why you would like your application reviewed again.</p>
        </div>
      ) : (
        <div className="next">
          <h2>Your account is paused</h2>
          <p>Please contact Solvelt support to find out why and what happens next.</p>
        </div>
      )}
      <div className="row">
        <a className="btn" href={app.marketplaceUrl} target="_blank" rel="noreferrer">Visit marketplace</a>
        <Link className="btn" to="/guest">Guest mode</Link>
      </div>
    </StepFrame>
  )
}
