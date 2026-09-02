import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_PACKAGE
    || '/Users/cxl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)

const projectRoot = resolve(import.meta.dirname, '..')
const outputPath = join(projectRoot, 'docs', '部门产品智能客服机器人研发-系统演示.webm')
const tempDir = join(projectRoot, '.demo-video')
const targetUrl = process.env.DEMO_URL || 'https://support.43.160.222.130.nip.io'
const browserPath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1161/chrome-mac/headless_shell`
const sshKey = process.env.DEPLOY_SSH_KEY || '/private/tmp/ifly_rag_deploy_20260831_ed25519'

mkdirSync(dirname(outputPath), { recursive: true })
rmSync(tempDir, { recursive: true, force: true })
mkdirSync(tempDir, { recursive: true })

function adminKey() {
  return execFileSync('ssh', [
    '-i', sshKey,
    '-o', 'StrictHostKeyChecking=accept-new',
    'ubuntu@43.160.222.130',
    "cd /opt/product-support-bot && sed -n 's/^ADMIN_API_KEY=//p' .env",
  ], { encoding: 'utf8' }).trim()
}

const startedAt = Date.now()
const log = []
const note = (message) => {
  const seconds = Math.round((Date.now() - startedAt) / 1000)
  log.push({ seconds, message })
  process.stdout.write(`[${String(seconds).padStart(3, '0')}s] ${message}\n`)
}

const browser = await chromium.launch({
  headless: true,
  executablePath: browserPath,
  args: ['--hide-scrollbars'],
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  recordVideo: { dir: tempDir, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()
const video = page.video()
page.setDefaultTimeout(90_000)

const browserErrors = []
page.on('pageerror', (error) => browserErrors.push(error.message))
page.on('response', (response) => {
  if (response.status() >= 500) browserErrors.push(`${response.status()} ${response.url()}`)
})

async function hold(milliseconds) {
  await page.waitForTimeout(milliseconds)
}

async function ask(question, answerFragment, holdAfter = 12_000) {
  const composer = page.getByRole('textbox', { name: '输入产品问题' })
  const completedAnswers = page.locator('.assistant-message')
  const answerCount = await completedAnswers.count()
  await composer.click()
  await composer.pressSequentially(question, { delay: 45 })
  await hold(1_400)
  await page.getByRole('button', { name: '发送问题' }).click()
  note(`已提交：${question}`)
  await hold(4_800)
  await page.waitForFunction(
    (previousCount) => document.querySelectorAll('.assistant-message').length > previousCount,
    answerCount,
  )
  const answerText = await completedAnswers.last().innerText()
  if (!answerText.includes(answerFragment)) {
    throw new Error(`回答缺少关键结论“${answerFragment}”：${answerText.slice(0, 240)}`)
  }
  note(`回答完成：${answerFragment}`)
  await hold(holdAfter)
}

let recordingPath
try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '有依据，才回答。' }).waitFor()
  await page.getByRole('combobox', { name: '选择当前产品' }).waitFor()
  note('线上系统已打开，服务状态正常')
  await hold(9_000)

  await ask(
    '通用大模型链路 SDK 接入需要什么版本，aiui_ver 设多少，API 是长连接还是短连接？',
    '6.xxx 及以上版本',
    14_000,
  )

  await ask(
    'AIUI 支持 8k 音频吗？SDK 采集音频要注意什么？',
    'AIUI SDK 不支持 8k 音频',
    14_000,
  )

  await ask(
    '明天北京天气如何？',
    '当前知识库中没有找到足够可靠的依据',
    11_000,
  )

  await page.getByRole('button', { name: '知识控制台' }).click()
  await page.getByPlaceholder('输入 X-Admin-Key').fill(adminKey())
  await page.getByRole('button', { name: '验证并进入' }).click()
  await page.getByRole('heading', { name: '知识控制台' }).waitFor()
  await page.getByText('索引服务正常').waitFor()
  await page.getByText(/图谱\s*已就绪/).first().waitFor()
  note('知识控制台已验证：文档、片段和图谱状态正常')
  await hold(18_000)

  await page.getByRole('button', { name: '知识图谱' }).click()
  await page.getByRole('heading', { name: '知识关系，一目了然。' }).waitFor()
  await page.getByText('149', { exact: true }).waitFor()
  await page.getByText('121', { exact: true }).waitFor()
  note('结构化知识图谱已加载：149 个实体、121 条关系')
  await hold(18_000)

  const relationButton = page.getByRole('button', { name: /语义模型配置/ }).first()
  if (await relationButton.count()) {
    await relationButton.click()
    await page.getByText('语义模型配置', { exact: true }).last().waitFor()
    note('已展开实体关系详情')
  }
  await hold(18_000)

  await page.getByRole('button', { name: '智能客服' }).click()
  await page.getByRole('heading', { name: '有依据，才回答。' }).waitFor()
  const minimumDurationMs = 200_000
  const remaining = minimumDurationMs - (Date.now() - startedAt)
  if (remaining > 0) await hold(remaining)
  note('演示完成')
} finally {
  await context.close()
  recordingPath = await video.path()
  await browser.close()
}

copyFileSync(recordingPath, outputPath)
writeFileSync(
  join(projectRoot, 'docs', '系统演示录制校验.json'),
  JSON.stringify({
    url: targetUrl,
    generated_at: new Date().toISOString(),
    elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
    browser_errors: browserErrors,
    events: log,
  }, null, 2) + '\n',
)
rmSync(tempDir, { recursive: true, force: true })

if (browserErrors.length) {
  throw new Error(`录制期间检测到浏览器错误：${browserErrors.join('; ')}`)
}

process.stdout.write(`VIDEO=${outputPath}\n`)
