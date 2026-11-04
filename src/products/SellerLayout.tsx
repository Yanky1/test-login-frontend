import { useEffect, useRef, useState } from 'react'
import { servicesApi } from '../services/api'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { PIcon, type PIconName } from './ui'
import { useBadgeCounts } from '../orders/live'
import './products.css'
import '../services/services.css'

interface Item { to: string; label: string; icon: PIconName; end?: boolean; show?: boolean; badge?: number; badgeLabel?: string }

/**
 * Seller area shell: sidebar (drawer on small screens) around the pages. It sits UNDER the app-wide header (account + brand switchers),
 * which RequireAuth renders for every signed-in page; it does not replace or touch it.
 */
export default function SellerLayout() {
  const { user } = useAuth()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const admin = user?.role === 'Owner' || user?.role === 'Admin' || user?.role == null
  const { orders, messages } = useBadgeCounts()
  const [badge, setBadge] = useState(0)
  useEffect(() => {
    let alive = true
    const poll = () => servicesApi.counts().then((c) => alive && setBadge(c.needsAction)).catch(() => undefined)
    void poll(); const t = setInterval(poll, 60_000); return () => { alive = false; clearInterval(t) }
  }, [loc.pathname])
  const items: Item[] = [
    { to: '/orders', label: 'Orders', icon: 'box', badge: orders?.needsAction, badgeLabel: 'need action' },
    { to: '/messages', label: 'Messages', icon: 'msg', badge: messages?.unread, badgeLabel: 'unread' },
    { to: '/products', label: 'Products', icon: 'box', end: true }, { to: '/products/import', label: 'Bulk upload', icon: 'upload' },
    { to: '/questions', label: 'Questions', icon: 'msg' },
    { to: '/delivery', label: 'Local delivery', icon: 'box' },
    { to: '/payments', label: 'Payments', icon: 'wallet', show: admin },
  ]
  const scheduling: Item[] = [
    { to: '/calendar', label: 'Calendar', icon: 'calendar' }, { to: '/bookings', label: 'Bookings', icon: 'inbox', badge: badge, badgeLabel: 'need your attention' }, { to: '/settings/availability', label: 'Availability', icon: 'clock' },
  ]
  const account: Item[] = [
    { to: '/settings/security', label: 'Account & security', icon: 'check' },
    { to: '/settings/team', label: 'Team', icon: 'plus', show: admin && user?.role != null }, { to: '/settings/brands', label: 'Brands', icon: 'star', show: admin && user?.role != null },
  ]
  const wasOpen = useRef(false); wasOpen.current = open
  useEffect(() => {
    if (wasOpen.current) requestAnimationFrame(() => document.getElementById('page-title')?.focus())  // a drawer link was used: land on the new page's heading
    setOpen(false)
  }, [loc.pathname])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [open])
  const link = (i: Item) => (
    <li key={i.to}><NavLink to={i.to} end={i.end} aria-label={i.badge ? `${i.label} ${i.badge > 99 ? '99+' : i.badge} ${i.badgeLabel}` : undefined}><PIcon name={i.icon} />{i.label}{!!i.badge && <>{' '}<span className="nav-badge" aria-hidden="true">{i.badge > 99 ? '99+' : i.badge}</span></>}</NavLink></li>
  )
  return (
    <div className="seller-shell">
      <div className="side-bar-mobile">
        <button ref={btn} type="button" className="btn" aria-expanded={open} aria-controls="seller-nav" onClick={() => setOpen((o) => !o)}><PIcon name={open ? 'x' : 'menu'} /> Menu</button>
      </div>
      <nav id="seller-nav" className={`sidenav${open ? ' open' : ''}`} aria-label="Seller">
        <ul>{items.filter((i) => i.show !== false).map(link)}</ul>
        <p className="sidenav-h">Schedule</p>
        <ul>{scheduling.map(link)}</ul>
        <p className="sidenav-h">Account</p>
        <ul>{account.filter((i) => i.show !== false).map(link)}</ul>
      </nav>
      <div className="seller-main"><Outlet /></div>
    </div>
  )
}
