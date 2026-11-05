import fs from 'node:fs'
import path from 'node:path'

/** Shared types and file locations of the UI sweep. */
export const OUT = path.resolve('sweep-out')
export const STATE_DIR = path.resolve('.e2e/sweep')
export const STATE_FILE = path.join(STATE_DIR, 'state.json')

export type Role = 'anon' | 'owner' | 'admin' | 'manager' | 'viewer' | 'driver' | 'pending' | 'superadmin' | 'support' | 'moderator' | 'readonly'
export const STAFF_ROLES: Role[] = ['superadmin', 'support', 'moderator', 'readonly']
export interface Account { email: string; password: string; secret?: string }
export interface SweepState {
  accounts: Partial<Record<Role, Account>>
  /** per role: the pages to sweep (pathname + search), found from the router config and the links on those pages */
  routes: Partial<Record<Role, string[]>>
}
export const readState = (): SweepState => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))

export type Check = 'clickables' | 'layout' | 'a11y' | 'keyboard' | 'visual' | 'speed' | 'console' | 'network'
export interface Finding {
  check: Check; rule: string; message: string
  role: Role; route: string; project: string; browser: string; viewport: number; theme: string
  shot?: string
}
export interface Stat { check: Check; role: Role; project: string; theme: string; pages: number; items: number }
export const slug = (route: string) => (route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '')) || 'home'
