// IndexedDB 极简封装:仅一个 object store,存最近项目(含目录句柄,句柄可结构化克隆)。

// **持久化标识,产品改名时不要跟着改。**
//
// 一改,现有用户存量的"最近项目"句柄就全成了孤儿:数据还躺在旧库里,界面上却空了。
// 用户不会理解成"它换了个数据库名",只会理解成"升级把我的东西弄丢了" ——
// 真要改,就得配迁移,而不是让数据无声蒸发。
//
// 这个字符串用户永远看不到,与产品叫什么无关。**它长得像改名漏网的残留,但不是** ——
// 顺手"清理"它不会报错、不会有测试变红,只会让某个人的最近项目列表在某次更新后空掉。
const DB_NAME = 'code-viewer'
const DB_VERSION = 1
export const STORE_RECENT = 'recent-projects'

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_RECENT)) {
          db.createObjectStore(STORE_RECENT, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

export async function idbPut(store: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
