import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBashTool } from '../src/bash.ts'
import { applyEdit, createEditTool } from '../src/edit.ts'
import { createGlobTool } from '../src/glob.ts'
import { createGrepTool, findRipgrep } from '../src/grep.ts'
import { createLsTool } from '../src/ls-find.ts'
import { createPowerShellTool } from '../src/powershell.ts'
import { createReadTool } from '../src/read.ts'
import { shellCommandForPlatform } from '../src/shell.ts'
import { createWriteTool } from '../src/write.ts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'nunnun-tools-'))
  dirs.push(d)
  return d
}
const ctx = (cwd: string) => ({ cwd })

describe('bash tool', () => {
  it('runs a command and captures stdout', async () => {
    const tool = createBashTool({ cwd: tmp() })
    const res = await tool.execute({ command: "Write-Output 'hello world'" }, ctx(tmp()))
    expect(res.isError).toBe(false)
    expect(res.output).toContain('hello world')
  })

  it('handles quoting with spaces (Review Focus 5: Windows quoting)', async () => {
    const tool = createBashTool({ cwd: tmp() })
    const res = await tool.execute({ command: "echo 'a b  c'" }, ctx(tmp()))
    expect(res.output).toContain('a b  c')
  })

  it('non-zero exit marks isError', async () => {
    const tool = createBashTool({ cwd: tmp() })
    const cmd = process.platform === 'win32' ? 'exit 3' : 'exit 3'
    const res = await tool.execute({ command: cmd }, ctx(tmp()))
    expect(res.output).toContain('[exit code: 3]')
    expect(res.isError).toBe(true)
  })

  it('abort kills the spawned process and reports an error (Review Focus 2)', async () => {
    const tool = createBashTool({ cwd: tmp() })
    const controller = new AbortController()
    const p = tool.execute({ command: 'Start-Sleep -Seconds 30' }, { cwd: tmp(), signal: controller.signal })
    await new Promise((r) => setTimeout(r, 300))
    controller.abort()
    const res = await p
    // resolves (no hang), the process was killed, and the model is told it failed
    expect(res.isError).toBe(true)
    expect(res.output).toContain('[aborted]')
  })
})

describe('powershell tool', () => {
  it('runs PowerShell natively on Windows', async () => {
    if (process.platform !== 'win32') return
    const tool = createPowerShellTool({ cwd: tmp() })
    const res = await tool.execute({ command: 'Write-Output "ps-works"' }, ctx(tmp()))
    expect(res.output).toContain('ps-works')
  })
})

describe('read tool', () => {
  it('reads whole file with line numbers', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'f.txt'), 'alpha\nbeta\ngamma')
    const tool = createReadTool()
    const res = await tool.execute({ path: join(dir, 'f.txt') }, ctx(dir))
    expect(res.output).toContain('alpha')
    expect(res.output).toContain('gamma')
  })

  it('reads a line range', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'f.txt'), 'one\ntwo\nthree\nfour')
    const tool = createReadTool()
    const res = await tool.execute({ path: join(dir, 'f.txt'), offset: 2, limit: 2 }, ctx(dir))
    expect(res.output).toContain('two')
    expect(res.output).toContain('three')
    expect(res.output).not.toContain('four')
  })

  it('missing file is an error', async () => {
    const tool = createReadTool()
    const res = await tool.execute({ path: join(tmp(), 'nope.txt') }, ctx(tmp()))
    expect(res.isError).toBe(true)
  })

  it('resolves relative paths against the tool context cwd, not process.cwd', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'rel.txt'), 'relative content')
    const tool = createReadTool()
    const res = await tool.execute({ path: 'rel.txt' }, ctx(dir))
    expect(res.isError).toBe(false)
    expect(res.output).toContain('relative content')
  })
})

describe('write + edit tools', () => {
  it('write creates a file and returns a diff preview', async () => {
    const dir = tmp()
    const tool = createWriteTool()
    const res = await tool.execute({ path: join(dir, 'new.txt'), content: 'hi' }, ctx(dir))
    expect(res.isError).toBe(false)
    expect(res.output).toContain('wrote')
  })

  it('edit replaces a unique match', async () => {
    const dir = tmp()
    const file = join(dir, 'e.txt')
    writeFileSync(file, 'const x = 1;\nconst y = 2;')
    const tool = createEditTool()
    const res = await tool.execute({ path: file, old_string: 'const y = 2;', new_string: 'const y = 3;' }, ctx(dir))
    expect(res.isError).toBe(false)
  })

  it('applyEdit refuses ambiguous matches', () => {
    const r = applyEdit('a-a-a', 'a-a', 'b')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('more than once')
  })
})

describe('glob tool', () => {
  it('matches nested patterns', async () => {
    const dir = tmp()
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'a.ts'), '')
    writeFileSync(join(dir, 'sub', 'b.ts'), '')
    writeFileSync(join(dir, 'sub', 'c.js'), '')
    const tool = createGlobTool()
    const res = await tool.execute({ pattern: '**/*.ts' }, ctx(dir))
    expect(res.output).toContain('2 match')
    expect(res.output).toContain('a.ts')
    expect(res.output).toContain('sub/b.ts')
  })
})

describe('grep tool', () => {
  it('finds matches when ripgrep is available; clear error otherwise', async () => {
    const rg = await findRipgrep()
    if (!rg) {
      const tool = createGrepTool()
      const res = await tool.execute({ pattern: 'x' }, ctx(tmp()))
      expect(res.isError).toBe(true)
      expect(res.output).toContain('ripgrep')
      return
    }
    const dir = tmp()
    writeFileSync(join(dir, 'f.txt'), 'needle here\nnothing')
    const tool = createGrepTool()
    const res = await tool.execute({ pattern: 'needle' }, ctx(dir))
    expect(res.output).toContain('needle here')
  })
})

describe('ls tool', () => {
  it('lists entries with type markers', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'file.txt'), 'x')
    const tool = createLsTool()
    const res = await tool.execute({}, ctx(dir))
    expect(res.output).toContain('file.txt')
  })
})

describe('platform shell selection', () => {
  it('uses PowerShell on win32, bash elsewhere', () => {
    const win = shellCommandForPlatform('win32')
    expect(win.command).toBe('powershell.exe')
    const unix = shellCommandForPlatform('linux')
    expect(unix.command).toBe('bash')
  })
})
