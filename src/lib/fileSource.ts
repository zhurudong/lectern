/** 原生选择器提供可重读的句柄，本地 URL 入口提供当前读取的 File 快照。 */
export type FileSource = FileSystemFileHandle | File

/** 两种来源都能被 structured clone，预览与 Worker 共用相同读取入口。 */
export async function readSourceFile(source: FileSource): Promise<File> {
  return source instanceof File ? source : source.getFile()
}
