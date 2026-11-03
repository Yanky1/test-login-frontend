// Mirrors the backend's PinRules (the server stays the authority): 6 digits, not trivial.
const COMMON = new Set(['123456', '654321', '123123', '121212', '112233', '123321', '159753', '147258', '258369', '246810', '135790', '696969', '420420', '202020', '101010', '111222', '000111', '123654', '654123', '789456', '456789'])

export interface PinCheck { label: string; ok: boolean }

export function pinChecks(pin: string): PinCheck[] {
  const six = /^\d{6}$/.test(pin)
  const d = pin.split('').map(Number)
  const asc = six && d.every((x, i) => i === 0 || x - d[i - 1] === 1)
  const desc = six && d.every((x, i) => i === 0 || d[i - 1] - x === 1)
  const repeating = six && (pin.slice(0, 3) === pin.slice(3) || (pin[0] === pin[2] && pin[2] === pin[4] && pin[1] === pin[3] && pin[3] === pin[5]) || (pin[0] === pin[1] && pin[2] === pin[3] && pin[4] === pin[5]))
  return [
    { label: 'Exactly 6 digits', ok: six },
    { label: 'Not one digit repeated', ok: six && new Set(pin).size > 1 },
    { label: 'Not a sequence like 123456', ok: six && !asc && !desc },
    { label: 'Not a repeating pattern', ok: six && !repeating && !COMMON.has(pin) },
  ]
}

export const pinValid = (pin: string) => pinChecks(pin).every((c) => c.ok)
