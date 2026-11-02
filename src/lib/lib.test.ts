import { describe, expect, it } from 'vitest'
import { suggestEmail } from './emailTypo'
import { safeNext } from './safeNext'
import { passwordChecks, passwordValid } from './password'
import { pruneAnswers, visibleKeys, type FieldConfig } from './kosher'

describe('email typo suggestion', () => {
  it.each([
    ['a@gmial.com', 'a@gmail.com'], ['a@gmai.com', 'a@gmail.com'], ['a@gamil.com', 'a@gmail.com'],
    ['a@hotmial.com', 'a@hotmail.com'], ['a@yahooo.com', 'a@yahoo.com'], ['a@outlok.com', 'a@outlook.com'], ['a@gmail.con', 'a@gmail.com'],
  ])('%s -> %s', (input, out) => expect(suggestEmail(input)?.email).toBe(out))
  it.each(['a@gmail.com', 'a@example.com', 'a@company.io', 'nope', 'a@me.com'])('no suggestion for %s', (e) => expect(suggestEmail(e)).toBeNull())
})

describe('safeNext (open redirect protection)', () => {
  it.each(['/dashboard', '/a/b?x=1#h', '/'])('allows %s', (p) => expect(safeNext(p)).toBe(p))
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil', 'javascript:alert(1)', '', null, undefined, '/a://b', '/x\r\ny'])('rejects %s', (p) => expect(safeNext(p as string)).toBeNull())
})

describe('password rules', () => {
  it('requires 10+ chars with upper, lower, number, symbol', () => {
    expect(passwordValid('Tr1cky-Horse!')).toBe(true)
    for (const bad of ['Short1!a', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoNumbers!!!!', 'NoSymbols12345']) expect(passwordValid(bad)).toBe(false)
    expect(passwordChecks('abc').filter((c) => c.ok).length).toBe(1)
  })
})

const cfg: FieldConfig[] = [
  { key: 'sells_food', label: '', type: 'yesno', parentKey: null, parentValue: null, required: true, sortOrder: 1, options: null },
  { key: 'is_kosher', label: '', type: 'yesno', parentKey: 'sells_food', parentValue: 'yes', required: true, sortOrder: 2, options: null },
  { key: 'agency', label: '', type: 'select', parentKey: 'is_kosher', parentValue: 'yes', required: true, sortOrder: 3, options: ['OU'] },
]
describe('kosher branching', () => {
  it('shows children only when the parent answer matches', () => {
    expect([...visibleKeys(cfg, {})]).toEqual(['sells_food'])
    expect([...visibleKeys(cfg, { sells_food: 'yes' })]).toEqual(['sells_food', 'is_kosher'])
    expect([...visibleKeys(cfg, { sells_food: 'yes', is_kosher: 'yes' })]).toEqual(['sells_food', 'is_kosher', 'agency'])
  })
  it('prunes hidden answers (grandchildren go when the grandparent flips)', () => {
    expect(pruneAnswers(cfg, { sells_food: 'no', is_kosher: 'yes', agency: 'OU' })).toEqual({ sells_food: 'no' })
  })
})
