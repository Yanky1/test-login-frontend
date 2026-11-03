import { useAuth } from '../auth'

/** Viewer is read-only (the server enforces it too: 403). Unknown role (old server) is treated as able to write. */
export function useCanWrite() {
  const { user } = useAuth()
  return user?.role !== 'Viewer'
}
