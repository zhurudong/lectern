export interface AgentProject { id: string; name: string }
interface StoredProject extends AgentProject { handle: FileSystemDirectoryHandle }

// A display name is not an identity: /work/a and /archive/a must never share
// a terminal cwd. Structured-cloned handles survive reloads and are compared
// using the browser's actual filesystem identity.
export async function projectIdentity(handle: FileSystemDirectoryHandle | null): Promise<AgentProject> {
  if (!handle) return { id: 'standalone', name: '独立终端' }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lectern-ai-projects', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const projects = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db.transaction('projects').objectStore('projects').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    for (const project of projects) {
      try { if (await handle.isSameEntry(project.handle)) return { id: project.id, name: handle.name } }
      catch { /* obsolete handle does not authorize reuse by name */ }
    }
    const project = { id: crypto.randomUUID(), name: handle.name, handle }
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite')
      transaction.objectStore('projects').put(project)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    return { id: project.id, name: project.name }
  } finally { db.close() }
}
