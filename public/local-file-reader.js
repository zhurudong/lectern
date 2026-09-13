// This module ships unchanged. Its exact SHA-256 is pinned by check-invariants.mjs.
// Keep validation and transport together: callers cannot turn it into an HTTP reader.
export async function readLocalFile(input, signal) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new Error('文件地址无效。')
  }
  if (url.protocol !== 'file:' || url.hostname !== '' || url.pathname.startsWith('//')) {
    throw new Error('仅支持本机 file:// 文件地址。')
  }
  const encodedName = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
  let name
  try {
    name = decodeURIComponent(encodedName)
  } catch {
    throw new Error('文件名编码无效。')
  }
  if (!name || /[\u0000/\\]/.test(name)) throw new Error('请选择本地文件，不能打开目录。')
  url.search = ''
  url.hash = ''
  const limit = 64 * 1024 * 1024
  const tooLarge = () => new Error('文件超过自动打开的 64 MiB 上限，请使用“打开文件”选择。')
  const response = await fetch(url.href, { cache: 'no-store', redirect: 'manual', signal })
  // Chrome's file loader returns a basic status-0 response for directory
  // redirects in manual mode. Restore its trailing-slash directory URL without
  // following or accepting a redirect destination from the response.
  if (response.status === 0 && response.type === 'basic') {
    await response.body?.cancel()
    url.pathname += '/'
    return { directoryUrl: url.href }
  }
  if (!response.ok || !response.body) throw new Error('无法读取文件，文件可能已移动、删除或未授权。')
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel()
    throw tooLarge()
  }
  const reader = response.body.getReader()
  const parts = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw tooLarge()
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new File(parts, name, {
    type: response.headers.get('content-type') || '',
    lastModified: Date.parse(response.headers.get('last-modified') || '') || Date.now(),
  })
}
