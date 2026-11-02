import { Link } from 'react-router-dom'
import { StepFrame, useWizard } from './shared'

const TRACK = ['Sent', 'Review', 'Approved', 'Live'] as const

/** index of the tracker stage that is currently active */
export const trackerIndex = (status: string) =>
  ({ Draft: -1, PendingReview: 1, NeedsInfo: 1, Rejected: 1, Approved: 2, Suspended: 2, Live: 3 } as Record<string, number>)[status] ?? 1

export default function PendingStep() {
  const { app } = useWizard()
  const idx = trackerIndex(app.status)
  return (
    <StepFrame index={5}>
      <h1 tabIndex={-1}>Your application is pending</h1>
      {app.status === 'NeedsInfo' && <p role="status" className="alert info">We need more information. {app.statusNote} <Link to="/signup/business">Update your application</Link></p>}
      {app.status === 'Rejected' && <p role="status" className="alert error">Unfortunately your application was not approved.</p>}
      {app.status === 'Suspended' && <p role="status" className="alert error">Your account is suspended.</p>}
      <p>Thanks{app.business.vendorName ? `, ${app.business.vendorName}` : ''}! Management will reach out to you by email once your application has been reviewed.</p>
      <ol className="tracker" aria-label="Application status">
        {TRACK.map((t, i) => (
          <li key={t} className={i < idx ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>
            <span className="dot">{i < idx ? '✓' : i + 1}</span><span className="lbl">{t}</span>
          </li>
        ))}
      </ol>
      <div className="row">
        <a className="btn primary" href={app.marketplaceUrl} target="_blank" rel="noreferrer">Visit marketplace</a>
        <Link className="btn" to="/guest">Guest mode</Link>
      </div>
    </StepFrame>
  )
}
