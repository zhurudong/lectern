import { accessSync, constants, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
export const PROTOCOL = 1
export const VERSION = '0.2.1'
export function executable(command, envPath = process.env.PATH ?? '') {
  if (typeof command !== 'string' || !command || command.length > 4096 || command.includes('\0')) return null
  const paths = isAbsolute(command) ? [command] : command.includes('/') ? []
    : [...new Set([...envPath.split(':'), join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/Applications/ChatGPT.app/Contents/Resources'])].filter(Boolean).map((dir) => join(dir, command))
  return paths.find((path) => { try { accessSync(path, constants.X_OK); return statSync(path).isFile() } catch { return false } }) ?? null
}
const size = (m) => Number.isInteger(m.cols) && m.cols >= 2 && m.cols <= 500 && Number.isInteger(m.rows) && m.rows >= 1 && m.rows <= 300
export function nativeSession({ origin, preferences, chooseProject, spawn, send, finish, findExecutable = executable }) {
  let hello = false, child = null, closed = false, selected = null
  const abort = new AbortController()
  const error = (code, message) => send({ type: 'error', code, message })
  return {
    async receive(m) {
      if (closed) return
      if (!m || typeof m !== 'object') return error('protocol', 'Invalid message')
      if (!hello) {
        if (m.type !== 'hello' || m.protocol !== PROTOCOL) return error('version', '本机程序与扩展版本不兼容，请更新伴随程序。')
        hello = true
        send({ type: 'hello', protocol: PROTOCOL, version: VERSION, agents: ['codex', 'claude'].filter((cmd) => findExecutable(cmd)), platform: process.platform, arch: process.arch })
        return
      }
      if (m.type === 'project' && !child) {
        if (typeof m.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(m.id) || typeof m.name !== 'string' || m.name.length > 200) return error('protocol', 'Invalid project')
        let cwd = preferences.project(origin, m.id)
        try { if (!cwd || !statSync(cwd).isDirectory()) cwd = null } catch { cwd = null }
        if (!cwd || m.reselect) {
          send({ type: 'waiting', message: '请在系统选择器中选择与当前阅读项目相同的目录。' })
          cwd = await chooseProject(m.name, abort.signal, m.locale === 'en' ? 'en' : 'zh')
          if (closed) return
          if (!cwd) return error('cancelled', '已取消目录选择。点击重新连接可再次选择。')
          cwd = preferences.bind(origin, m.id, cwd)
        }
        selected = { id: m.id, cwd }
        send({ type: 'project', id: m.id, cwd })
        return
      }
      if (m.type === 'start' && !child) {
        if (!size(m)) return error('protocol', 'Invalid terminal size')
        const cwd = selected?.id === m.projectId ? selected.cwd : null
        if (!cwd || !statSync(cwd).isDirectory()) return error('project', '项目目录已失效，请重新关联。')
        const command = findExecutable(m.cmd)
        if (!command) return error('agent_missing', `未找到 ${m.cmd}。请安装该 CLI，或选择已安装的 Agent。`)
        try {
          child = spawn(command, [], { name: 'xterm-256color', cwd, cols: m.cols, rows: m.rows, env: { ...process.env, TERM: 'xterm-256color', PATH: [...new Set([dirname(command), dirname(process.execPath), ...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].filter(Boolean).join(':') } })
          child.onData((data) => { if (!closed) send({ type: 'data', data }) })
          child.onExit(({ exitCode }) => { child = null; if (!closed) { send({ type: 'exit', code: exitCode }); finish() } })
          send({ type: 'ready' })
        } catch { error('agent_start', 'Agent 启动失败，请检查 CLI 安装、系统权限及项目目录。') }
        return
      }
      if (m.type === 'stdin' && child && typeof m.data === 'string') { child.write(m.data); return }
      if (m.type === 'resize' && child && size(m)) { child.resize(m.cols, m.rows); return }
      error('protocol', 'Invalid terminal operation')
    },
    close() { closed = true; abort.abort(); try { child?.kill() } catch { /* exited */ } child = null },
  }
}
