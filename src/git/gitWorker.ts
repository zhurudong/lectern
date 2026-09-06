import { ComparisonSession, serializedError } from './comparisonService'
import type { GitWorkerRequest, GitWorkerResponse } from './protocol'

let session: ComparisonSession | null = null
let root: FileSystemDirectoryHandle | null = null

async function ensureSession(nextRoot: FileSystemDirectoryHandle) {
  if (session && root === nextRoot) return { kind: 'ready' as const, session, refs: session.refs }
  session?.dispose()
  const opened = await ComparisonSession.open(nextRoot)
  if (opened.kind === 'ready') {
    session = opened.session
    root = nextRoot
  }
  return opened
}

self.onmessage = async (event: MessageEvent<GitWorkerRequest>) => {
  const request = event.data
  const response: GitWorkerResponse = { id: request.id, generation: request.generation }
  try {
    if (request.type === 'probe-and-list-refs') {
      const opened = await ensureSession(request.root)
      response.payload = {
        type: 'probe-result',
        state: opened.kind === 'ready' ? { kind: 'ready', refs: opened.refs } : opened,
      }
    } else if (request.type === 'compare') {
      if (__CV_TEST_HOOK__ && request.request.debugDelayMs && request.request.debugDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, request.request.debugDelayMs))
      }
      const opened = await ensureSession(request.root)
      response.payload = {
        type: 'compare-result',
        state: opened.kind === 'ready' ? await opened.session.compare(request.request) : opened,
      }
    } else if (request.type === 'resolve-commit') {
      if (!session) throw new Error('Git comparison session is not initialized')
      response.payload = { type: 'resolve-commit-result', oid: await session.resolveCommit(request.input) }
    } else if (request.type === 'load-file-pair') {
      if (!session) throw new Error('Git comparison session is not initialized')
      response.payload = { type: 'file-pair-result', pair: await session.loadFilePair(request.path) }
    } else {
      session?.dispose()
      session = null
      root = null
      response.payload = { type: 'disposed' }
    }
  } catch (error) {
    response.error = serializedError(error, request.type)
  }
  self.postMessage(response)
  if (request.type === 'dispose') self.close()
}
