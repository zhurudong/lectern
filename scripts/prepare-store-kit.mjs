// Build a reviewable local handoff, never upload/publish. --final fails closed.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, basename, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { PROJECT } from './paths.mjs'
import { buildPages, render } from './build-public-pages.mjs'
import { VERSION } from '../lectern-agent/native/session.mjs'
const version = JSON.parse(readFileSync(join(PROJECT, 'package.json'), 'utf8')).version
const final = process.argv.includes('--final')
const configIndex = process.argv.indexOf('--config')
const cfg = JSON.parse(readFileSync(configIndex < 0 ? join(PROJECT, 'docs/store-release/release-config.example.json') : resolve(process.argv[configIndex + 1]), 'utf8'))
const out = join(PROJECT, 'release-artifacts', `web-store-${version}`)
const source = join(PROJECT, 'docs/store-release')
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: PROJECT, encoding: 'utf8', ...options })
const missing = []
if (!cfg.storeIdConfirmed || !/^[a-p]{32}$/.test(cfg.observedStoreId ?? '')) missing.push('Confirm the existing store item ID')
const parts = v => v.split('.').map(Number)
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i=0;i<4;i++) { if ((x[i]??0)!==(y[i]??0)) return (x[i]??0)>(y[i]??0) } return false }
if (!/^[0-9]+(\.[0-9]+){0,3}$/.test(cfg.highestUploadedVersion ?? '') || !newer(version, cfg.highestUploadedVersion)) missing.push('Confirm highest uploaded version is lower than candidate')
for (const key of ['downloadUrl', 'privacyUrl']) { try { assert.equal(new URL(cfg[key]).protocol, 'https:') } catch { missing.push(`Provide public HTTPS ${key}`) } }
for (const arch of ['arm64', 'x64']) if (!(cfg.companionPackages ?? []).some(p => p.arch === arch && existsSync(resolve(p.path)))) missing.push(`Signed/notarized companion for ${arch}`)
if (!cfg.cleanInstallVerified) missing.push('Record clean install verification on supported architectures')
if (cfg.candidateVersion !== version || cfg.companionVersion !== VERSION) missing.push('Release configuration versions must match source')
if (final) {
  assert.deepEqual(missing, [], `Release prerequisites incomplete: ${missing.join('; ')}`)
  for (const key of ['downloadUrl', 'privacyUrl']) {
    const response = await fetch(cfg[key], { signal: AbortSignal.timeout(20000) })
    assert.ok(response.ok, `${key} is not public: ${response.status}`)
    assert.equal(new URL(response.url).protocol, 'https:')
    const html = await response.text()
    assert.match(html, /Lectern/i, `${key} does not identify Lectern`)
    assert.match(html, key === 'privacyUrl' ? /companion|伴随程序/i : /\.pkg/i, `${key} is missing required release content`)
  }
  for (const { arch, path } of cfg.companionPackages) {
    const pkg = resolve(path)
    assert.ok(['arm64','x64'].includes(arch)); assert.ok(!pkg.includes('UNSIGNED'))
    run(process.execPath, ['scripts/check-release.mjs', '--release'], { stdio: 'inherit', env: { ...process.env, LECTERN_EXTENSION_ID: cfg.observedStoreId, LECTERN_DOWNLOAD_URL: cfg.downloadUrl, LECTERN_COMPANION_PKG: pkg } })
    const temp = mkdtempSync(join(tmpdir(), 'lectern-final-package-'))
    try {
      const unpack = join(temp, 'unpacked'); run('/usr/sbin/pkgutil', ['--expand-full', pkg, unpack])
      const all = []
      const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, entry.name); if (entry.isDirectory()) walk(p); else all.push(p) } }
      walk(unpack)
      for (const name of ['native-release.json', 'com.lectern.agent.json']) {
        const matches = all.filter(p => basename(p) === name); assert.equal(matches.length, 1)
        assert.deepEqual(JSON.parse(readFileSync(matches[0])).allowed_origins, [`chrome-extension://${cfg.observedStoreId}/`])
      }
      const runtime = all.find(p => p.endsWith('/Contents/Resources/node')); assert.ok(runtime)
      assert.equal(run('/usr/bin/lipo', ['-archs', runtime]).trim(), arch === 'x64' ? 'x86_64' : 'arm64')
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }
  for (const lang of ['native-setup.html','native-setup.en.html']) {
    const html = readFileSync(join(PROJECT,'dist-ai',lang),'utf8')
    assert.ok(html.includes(cfg.downloadUrl.replaceAll('&','&amp;')), 'Rebuild AI extension with the verified public download URL')
  }
}
run(process.execPath, ['scripts/check-release.mjs'], { stdio: 'inherit' })
mkdirSync(out, { recursive: true })
for (const name of readdirSync(source)) {
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.json')) cpSync(join(source,name),join(out,name))
  if (name.endsWith('.md')) writeFileSync(join(out,name.replace(/\.md$/,'.html')), render(name,readFileSync(join(source,name),'utf8'),'zh-CN'))
}
buildPages(join(out, 'site'), cfg.downloadUrl || undefined)
cpSync(join(PROJECT, 'public/icons/icon-128.png'), join(out,'images/icon-128.png'))
for (const locale of ['en','zh_CN']) for (const name of ['01-code-reader.png','02-dark-reader.png','03-terminal-first-use.png']) {
  const img=readFileSync(join(out,'images',locale,name)); assert.equal(img.toString('hex',0,8),'89504e470d0a1a0a'); assert.equal(img.readUInt32BE(16),1280); assert.equal(img.readUInt32BE(20),800)
}
for (const [name,w,h] of [['small-promo-440x280.png',440,280],['marquee-promo-1400x560.png',1400,560]]) {
  const img=readFileSync(join(out,'images/promos',name)); assert.equal(img.readUInt32BE(16),w); assert.equal(img.readUInt32BE(20),h)
}
const packages = join(out, final ? 'final-upload' : 'packages'); mkdirSync(packages, { recursive: true })
const zip = join(packages, `lectern-${version}-ai-${final ? 'web-store' : 'CANDIDATE-NOT-FOR-SUBMISSION'}.zip`)
rmSync(zip, { force: true }); run('/usr/bin/zip', ['-qr', zip, '.'], { cwd: join(PROJECT,'dist-ai') })
const files=run('/usr/bin/unzip',['-Z1',zip]).trim().split('\n'); assert.ok(files.includes('manifest.json')); assert.ok(!files.some(p=>p.startsWith('dist-ai/')))
const metadata = {}
for (const locale of ['en','zh_CN']) metadata[locale]=JSON.parse(readFileSync(join(PROJECT,'dist-ai/_locales',locale,'messages.json')))
writeFileSync(join(out,'metadata.json'),JSON.stringify(metadata,null,2)+'\n')
writeFileSync(join(out,'index.html'), render('Lectern 发布材料', `# Lectern ${version} 发布材料

${final ? '技术准备检查通过，尚未提交商店。' : '> 当前是本地候选，尚缺正式签名、公证、公开链接和安装验收。不要提交候选 ZIP。'}

[从第一步开始](START-HERE.html) · [查看缺项](status.json)

## 复制到后台

- [英文详细说明](listing.en.txt)
- [中文详细说明](listing.zh-CN.txt)
- [权限与隐私字段](privacy-fields.html)
- [审核者测试说明](reviewer-notes.en.txt)
- [正式安装验收清单](first-install-checklist.html)

## 页面与图片

- [公开页面待部署版本](site/index.html)
- [英文隐私政策](site/privacy.html) · [中文隐私政策](site/privacy.zh-CN.html)
- [英文阅读器](images/en/01-code-reader.png) · [暗色](images/en/02-dark-reader.png) · [终端首次使用](images/en/03-terminal-first-use.png)
- [中文阅读器](images/zh_CN/01-code-reader.png) · [暗色](images/zh_CN/02-dark-reader.png) · [终端首次使用](images/zh_CN/03-terminal-first-use.png)
- [128 图标](images/icon-128.png) · [小宣传图](images/promos/small-promo-440x280.png) · [大宣传图](images/promos/marquee-promo-1400x560.png)

## 发布文件

[${final ? '正式上传 ZIP' : '本地候选 ZIP（不能提交）'}](${final ? 'final-upload' : 'packages'}/${basename(zip)}) · [校验清单](SHA256SUMS.txt)

[重建说明](engineering.html)`, 'zh-CN'))
writeFileSync(join(out,'status.json'),JSON.stringify({status:final?'ready-for-manual-review':'candidate-only', version, companionVersion:VERSION, storeId:cfg.observedStoreId, sourceCommit:run('git',['rev-parse','HEAD']).trim(), sourceDirty:!!run('git',['status','--porcelain','--untracked-files=no']).trim(), generatedAt:new Date().toISOString(), missing, screenshotNote:'Actual candidate UI; terminal screenshot is first-use installation guidance, no simulated model output. No store upload has occurred.'},null,2)+'\n')
const hashes=[]
const walk=dir=>{ for(const ent of readdirSync(dir,{withFileTypes:true})) {const p=join(dir,ent.name);if(ent.isDirectory())walk(p);else if(ent.name!=='SHA256SUMS.txt')hashes.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${relative(out,p)}`) } }
walk(out);writeFileSync(join(out,'SHA256SUMS.txt'),hashes.sort().join('\n')+'\n')
console.log(`Prepared ${out}\n${final ? 'Ready for manual review; not submitted' : `CANDIDATE ONLY. Missing: ${missing.join('; ')}`}`)
