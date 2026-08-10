/**
 * GitHub Actions 入口：从环境变量读取 Issue 信息，调用 processIssueRequest
 * 使用方式：npx tsx src/data/issues/run.ts
 */

import fs from 'fs'
import processIssueRequest from './processIssueRequest'
import type { ProcessResult } from './processIssueRequest'

const issueBody = process.env.ISSUE_BODY || ''
const issueNumber = parseInt(process.env.ISSUE_NUMBER || '0')
const issueTitle = process.env.ISSUE_TITLE || ''

console.log(`\n=== 处理 Issue #${issueNumber} ===`)
console.log(`标题: ${issueTitle}`)
console.log(`内容长度: ${issueBody.length} 字符\n`)

function writeResult(result: ProcessResult | { status: 'error'; error: string; addedCount: 0; addedApps: []; failedApps: [{ id: string; reason: string }]; existingApps: [] }) {
  try {
    fs.writeFileSync('issue_result.json', JSON.stringify(result, null, 2), 'utf-8')
    console.log('\n结果已写入 issue_result.json')
  } catch (e) {
    console.error('写入 issue_result.json 失败:', e)
  }
}

processIssueRequest(issueBody, issueNumber, 'cn')
  .then(result => {
    writeResult(result)
    process.exit(0)
  })
  .catch(err => {
    console.error('处理失败:', err)
    writeResult({
      status: 'error',
      error: err.message || String(err),
      addedCount: 0,
      addedApps: [],
      failedApps: [{ id: 'unknown', reason: err.message || String(err) }],
      existingApps: [],
    })
    process.exit(1)
  })
