export interface PasswordCheck { label: string; ok: boolean }

export function passwordChecks(pw: string): PasswordCheck[] {
  return [
    { label: 'At least 10 characters', ok: pw.length >= 10 },
    { label: 'An uppercase letter', ok: /\p{Lu}/u.test(pw) },
    { label: 'A lowercase letter', ok: /\p{Ll}/u.test(pw) },
    { label: 'A number', ok: /\d/.test(pw) },
    { label: 'A symbol', ok: /[^\p{L}\d\s]/u.test(pw) },
  ]
}

export const passwordValid = (pw: string) => passwordChecks(pw).every((c) => c.ok)
