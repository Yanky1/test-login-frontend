import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import './products.css'

/**
 * Temporary in-page navigation for the product area. The app-wide sidebar/shell is added around the shared header once the teams frontend
 * (account + brand switchers) is on main; until then these tabs keep Products, Questions and CSV one click apart.
 */
export function ProductsFrame({ children }: { children: ReactNode }) {
  return (
    <div className="pframe">
      <nav className="ptabs" aria-label="Catalog">
        <NavLink to="/products" end>Products</NavLink>
        <NavLink to="/questions">Questions</NavLink>
        <NavLink to="/products/import">Bulk upload</NavLink>
      </nav>
      {children}
    </div>
  )
}
