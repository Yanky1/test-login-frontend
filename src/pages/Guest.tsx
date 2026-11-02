import { Link } from 'react-router-dom'
import { Card } from '../components/ui'

/** Placeholder for the (future) guest mode. */
export default function GuestPage() {
  return (
    <Card title="Guest mode">
      <p>Guest mode is coming soon. For now this is a placeholder page.</p>
      <p><Link to="/login">Back to sign in</Link></p>
    </Card>
  )
}
