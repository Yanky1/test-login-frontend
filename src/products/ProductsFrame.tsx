import type { ReactNode } from 'react'

/** Kept so every page can stay `<ProductsFrame>`-wrapped; the sidebar now lives in SellerLayout (route-level), so this is a pass-through. */
export function ProductsFrame({ children }: { children: ReactNode }) { return <>{children}</> }
