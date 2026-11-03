import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { PIcon, type PIconName } from './ui'
import './products.css'

interface Item { to: string; label: string; icon: PIconName; end?: boolean; show?: boolean }

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
  const items: Item[] = [
    { to: '/products', label: 'Products', icon: 'box', end: true }, { to: '/products/import', label: 'Bulk upload', icon: 'upload' },
    { to: '/questions', label: 'Questions', icon: 'msg' },
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
  const link = (i: Item) => <li key={i.to}><NavLink to={i.to} end={i.end}><PIcon name={i.icon} />{i.label}</NavLink></li>
  return (
    <div className="seller-shell">
      <div className="side-bar-mobile">
        <button ref={btn} type="button" className="btn" aria-expanded={open} aria-controls="seller-nav" onClick={() => setOpen((o) => !o)}><PIcon name={open ? 'x' : 'menu'} /> Menu</button>
      </div>
      <nav id="seller-nav" className={`sidenav${open ? ' open' : ''}`} aria-label="Seller">
        <ul>{items.map(link)}</ul>
        <p className="sidenav-h">Account</p>
        <ul>{account.filter((i) => i.show !== false).map(link)}</ul>
      </nav>
      <div className="seller-main"><Outlet /></div>
    </div>
  )
}
