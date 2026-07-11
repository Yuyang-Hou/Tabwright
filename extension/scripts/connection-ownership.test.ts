import assert from 'node:assert/strict'
import test from 'node:test'
import { ConnectionOwnership } from '../src/connection-ownership'

type TestSocket = { id: 'a' | 'b' }

test('a timed-out attempt cannot replace the newer connection', () => {
  const socketA: TestSocket = { id: 'a' }
  const socketB: TestSocket = { id: 'b' }
  const ownership = new ConnectionOwnership<TestSocket>()

  const attemptA = ownership.beginAttempt()
  assert.equal(ownership.invalidateAttempt(attemptA), true)

  const attemptB = ownership.beginAttempt()
  assert.equal(ownership.claimOpenedConnection({ generation: attemptB, connection: socketB }), true)
  assert.equal(ownership.current, socketB)

  // A opens and closes only after its timeout and after B became current.
  assert.equal(ownership.claimOpenedConnection({ generation: attemptA, connection: socketA }), false)
  assert.equal(ownership.current, socketB)
  assert.equal(ownership.isCurrentConnection(socketA), false)
  assert.equal(ownership.releaseConnection(socketA), false)
  assert.equal(ownership.current, socketB)
})

test('a replaced socket cannot clear the current connection', () => {
  const socketA: TestSocket = { id: 'a' }
  const socketB: TestSocket = { id: 'b' }
  const ownership = new ConnectionOwnership<TestSocket>()

  const attemptA = ownership.beginAttempt()
  assert.equal(ownership.claimOpenedConnection({ generation: attemptA, connection: socketA }), true)

  const attemptB = ownership.beginAttempt()
  assert.equal(ownership.claimOpenedConnection({ generation: attemptB, connection: socketB }), true)
  assert.equal(ownership.releaseConnection(socketA), false)
  assert.equal(ownership.current, socketB)
})
