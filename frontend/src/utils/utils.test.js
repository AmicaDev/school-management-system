import { describe, expect, it } from 'vitest'
import { errorMessage, fieldErrors, items } from '../services/api'

describe('api helpers', () => {
  it('unwraps paginated and plain lists', () => {
    expect(items({ results: [1, 2] })).toEqual([1, 2])
    expect(items([3])).toEqual([3])
    expect(items(null)).toEqual([])
  })
  it('gives a friendly message when offline', () => {
    expect(errorMessage({})).toMatch(/Cannot reach the server/)
  })
  it('explains a request timeout without hiding the failure', () => {
    expect(errorMessage({ code: 'ECONNABORTED' })).toMatch(/starting up/)
  })
  it('reads DRF detail and field errors', () => {
    expect(errorMessage({ response: { status: 403, data: { detail: 'Nope' } } })).toBe('Nope')
    expect(fieldErrors({ response: { status: 400, data: { name: ['Required.'] } } })).toEqual({ name: 'Required.' })
  })
})
