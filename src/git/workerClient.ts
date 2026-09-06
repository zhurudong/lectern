import type { CompareRequest, GitWorkerPayload, GitWorkerRequest, GitWorkerResponse } from './protocol'

type WorkerFactory = () => Worker
type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'id' | 'generation'> : never
type GitWorkerRequestPayload = WithoutEnvelope<GitWorkerRequest>

const defaultFactory: WorkerFactory = () => new Worker(new URL('./gitWorker.ts', import.meta.url), {
  type: 'module',
  name: 'lectern-git',
})

interface PendingRequest {
  resolve: (payload: GitWorkerPayload) => void
  reject: (error: unknown) => void
}

export class GitWorkerClient {
  private worker: Worker | null = null
  private generation = 0
  private requestId = 0
  private readonly pending = new Map<number, PendingRequest>()

  constructor(private readonly factory: WorkerFactory = defaultFactory) {}

  probe(root: FileSystemDirectoryHandle): Promise<GitWorkerPayload> {
    this.replaceGeneration()
    return this.send({ type: 'probe-and-list-refs', root })
  }

  compare(root: FileSystemDirectoryHandle, request: CompareRequest): Promise<GitWorkerPayload> {
    this.replaceGeneration()
    return this.send({ type: 'compare', root, request })
  }

  loadFilePair(path: string): Promise<GitWorkerPayload> {
    if (!this.worker) return Promise.reject(new DOMException('Git worker is not active', 'InvalidStateError'))
    return this.send({ type: 'load-file-pair', path })
  }

  resolveCommit(input: string): Promise<GitWorkerPayload> {
    if (!this.worker) return Promise.reject(new DOMException('Git worker is not active', 'InvalidStateError'))
    return this.send({ type: 'resolve-commit', input })
  }

  dispose(): void {
    this.rejectPending(new DOMException('Git worker disposed', 'AbortError'))
    this.worker?.terminate()
    this.worker = null
  }

  private replaceGeneration(): void {
    this.generation++
    this.rejectPending(new DOMException('Superseded by a newer Git comparison', 'AbortError'))
    this.worker?.terminate()
    const worker = this.factory()
    worker.onmessage = (event: MessageEvent<GitWorkerResponse>) => this.receive(event.data)
    worker.onerror = () => {
      this.rejectPending(new DOMException('Git worker failed', 'OperationError'))
      worker.terminate()
      if (this.worker === worker) this.worker = null
    }
    this.worker = worker
  }

  private send(request: GitWorkerRequestPayload): Promise<GitWorkerPayload> {
    if (!this.worker) return Promise.reject(new DOMException('Git worker is not active', 'InvalidStateError'))
    const id = ++this.requestId
    const message = { ...request, id, generation: this.generation } as GitWorkerRequest
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage(message)
    })
  }

  private receive(response: GitWorkerResponse): void {
    if (response.generation !== this.generation) return
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.error) pending.reject(response.error)
    else if (response.payload) pending.resolve(response.payload)
    else pending.reject(new DOMException('Git worker returned an empty response', 'OperationError'))
  }

  private rejectPending(error: unknown): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
