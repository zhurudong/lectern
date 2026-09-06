export type RepoUnavailableReason =
  | 'not-a-git-repository'
  | 'malformed-gitdir'
  | 'gitdir-outside-authorized-root'
  | 'repository-unreadable'
  | 'unsupported-object-format'
  | 'external-alternates'
  | 'bare-repository'

export type GitReadErrorCode =
  | RepoUnavailableReason
  | 'invalid-path'
  | 'object-not-found'
  | 'object-corrupt'
  | 'unsupported-object-type'
  | 'invalid-ref'
  | 'ref-cycle'
  | 'ambiguous-object'
  | 'non-commit-object'
  | 'incomplete-history'
  | 'resource-limit'
  | 'repository-changing'

export interface GitErrorContext {
  operation?: string
  oid?: string
  ref?: string
  objectType?: string
  size?: number
  reason?: 'no-common-history' | 'multiple-merge-bases' | 'shallow-history'
  /** Repository-relative only. Never put an external absolute path here. */
  path?: string
}

export interface PublicGitError extends GitErrorContext {
  code: GitReadErrorCode
  message: string
}

const PUBLIC_MESSAGES: Record<GitReadErrorCode, string> = {
  'not-a-git-repository': '当前目录中没有可读取的 Git 仓库',
  'malformed-gitdir': '项目中的 .git 指针格式无效',
  'gitdir-outside-authorized-root': 'Git 对象库位于浏览器授权范围之外',
  'repository-unreadable': '无法读取本地 Git 元数据',
  'unsupported-object-format': '当前 Git 对象格式暂不支持',
  'external-alternates': 'Git 对象依赖授权范围之外的 alternates',
  'bare-repository': '当前版本不支持 bare repository',
  'invalid-path': 'Git 数据包含无效或越界路径',
  'object-not-found': '本地 Git 对象缺失',
  'object-corrupt': '本地 Git 对象损坏',
  'unsupported-object-type': 'Git 对象类型暂不支持',
  'invalid-ref': 'Git 引用格式无效',
  'ref-cycle': 'Git 符号引用形成循环',
  'ambiguous-object': 'Commit SHA 前缀对应多个本地对象',
  'non-commit-object': '选择的引用不是 Commit',
  'incomplete-history': '本地 Git 历史不完整',
  'resource-limit': 'Git 数据超过安全读取上限',
  'repository-changing': '读取期间仓库发生变化，请重试',
}

export class GitReadError extends Error {
  readonly code: GitReadErrorCode
  readonly context: GitErrorContext

  constructor(code: GitReadErrorCode, message: string, context: GitErrorContext = {}) {
    super(message)
    this.name = 'GitReadError'
    this.code = code
    this.context = context
  }

  toPublic(): PublicGitError {
    const historyMessages: Partial<Record<NonNullable<GitErrorContext['reason']>, string>> = {
      'no-common-history': '两个端点没有共同历史，无法建立审查基线；可切换为直接比较',
      'multiple-merge-bases': '存在多个最佳 merge base，暂不支持精确审查；可切换为直接比较',
      'shallow-history': '本地历史不完整或对象缺失，无法建立审查基线',
    }
    return {
      code: this.code,
      message: this.context.reason ? historyMessages[this.context.reason] ?? PUBLIC_MESSAGES[this.code] : PUBLIC_MESSAGES[this.code],
      ...this.context,
    }
  }
}

export function gitError(
  code: GitReadErrorCode,
  context: GitErrorContext = {},
  detail = PUBLIC_MESSAGES[code],
): GitReadError {
  return new GitReadError(code, detail, context)
}
