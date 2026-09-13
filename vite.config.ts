import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// 两个入口:查看器整页应用(viewer.html)与 MV3 service worker(background)。
// background 必须输出为稳定文件名,manifest.json 按名引用。
export default defineConfig(({ mode }) => ({
  plugins: [preact(), { name: 'lectern-licenses', writeBundle(options) { for (const file of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) copyFileSync(here(file), resolve(options.dir!, file)) } }, ...(mode === 'ai' ? [{
    name: 'lectern-ai-manifest',
    writeBundle(options) {
      const path = resolve(options.dir!, 'manifest.json')
      const manifest = JSON.parse(readFileSync(here('public/manifest.json'), 'utf8'))
      for (const locale of ['en', 'zh_CN']) {
        const messagesPath = resolve(options.dir!, '_locales', locale, 'messages.json')
        const messages = JSON.parse(readFileSync(messagesPath, 'utf8'))
        messages.extensionName.message = locale === 'en' ? 'Lectern — Code Reader & AI Terminal' : 'Lectern — 代码阅读与 AI 终端'
        messages.extensionDescription.message = locale === 'en' ? 'Read local code and review changes. Optionally run your own AI CLI in a side terminal with a macOS companion.' : '本地阅读代码与查看差异；可选安装 macOS 伴随程序，在右侧终端运行自己的 AI CLI。'
        writeFileSync(messagesPath, JSON.stringify(messages, null, 2))
      }
      manifest.permissions.push('nativeMessaging')
      const distribution = process.env.LECTERN_COMPANION_DISTRIBUTION ?? 'unsigned'
      if (!['signed', 'unsigned'].includes(distribution)) throw new Error('Invalid companion distribution')
      const download = process.env.LECTERN_DOWNLOAD_URL
      if (process.env.LECTERN_RELEASE === '1' && !download) throw new Error('A release requires LECTERN_DOWNLOAD_URL')
      if (download && new URL(download).protocol !== 'https:') throw new Error('Companion download URL must use HTTPS')
      const link = download ? `<a href="${download.replaceAll('&', '&amp;').replaceAll('\"', '&quot;').replaceAll('<', '&lt;')}" target="_blank" rel="noopener noreferrer">下载伴随程序</a>。` : '此开发构建尚未配置正式下载地址，请向维护者获取配套安装包；不要将它当作已发布版本。'
      writeFileSync(resolve(options.dir!, 'native-setup.html'), readFileSync(here('scripts/native/setup.html'), 'utf8').replace('__DOWNLOAD__', link).replace('__SIGNING__', distribution === 'unsigned' ? '当前 GitHub 安装包未签名、未公证。macOS 可能阻止安装或启动；请先核对来源及校验和，再由你根据 Apple 官方说明决定是否允许。阅读器无需安装伴随程序。' : '发布包使用 Developer ID 签名并经 Apple 公证，请核对下载页的版本、芯片与校验和。'))
      const englishLink = download ? `<a href="${download.replaceAll('&', '&amp;').replaceAll('\"', '&quot;').replaceAll('<', '&lt;')}">Download Lectern Companion</a>.` : 'No public download is configured in this development build. Request a matching development installer from the maintainer.'
      writeFileSync(resolve(options.dir!, 'native-setup.en.html'), readFileSync(here('scripts/native/setup.en.html'), 'utf8').replace('__DOWNLOAD__', englishLink).replace('__SIGNING__', distribution === 'unsigned' ? 'The GitHub installer is unsigned and not notarized. macOS may block installation or launch. Verify the source and checksum before deciding whether to allow it using Apple’s instructions. The reader works without the companion.' : 'Release packages are Developer ID signed and notarized by Apple. Check the version, chip and checksum on the download page.'))
      writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
    },
  }] : [])],
  // E2E 测试钩子(window.__cv)仅在 development mode 构建时编译进产物
  define: { __CV_TEST_HOOK__: mode === 'development', __AI_TERMINAL__: mode === 'ai' },
  build: {
    outDir: mode === 'ai' ? 'dist-ai' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // 关掉 modulePreload 的 polyfill。
    //
    // 它会往产物里注入一段 `fetch(link.href)` —— 那是**产物里唯一的 `fetch(`**,
    // 不是我们写的代码,却会让「零网络」不变量门禁亮红。扩展只加载自己打包的
    // 本地资源,es2022 目标下的 Chrome 原生支持 modulepreload,polyfill 本就多余。
    //
    // **依赖 manifest.json 的 `minimum_chrome_version`(当前 122)。**
    // 这里关掉的是兼容兜底,不是无关紧要的开关:若将来**下调**最低 Chrome 版本,
    // 必须重新评估这一项(以及 `target: 'es2022'`)—— 否则老版本 Chrome 上
    // modulepreload 无人兜底,产物会直接加载失败。
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        viewer: here('viewer.html'),
        background: here('src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
}))
