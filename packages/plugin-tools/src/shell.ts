import { spawn } from 'node:child_process'
import { truncateOutput } from './truncate.ts'

export interface ShellRunOptions {
  cwd: string
  timeoutMs?: number
  signal?: AbortSignal
  maxLines?: number
  maxBytes?: number
}

export interface ShellRunResult {
  output: string
  exitCode: number | null
  truncated: boolean
}

/** The platform shell: PowerShell on Windows (spec decision), bash elsewhere. */
export function shellCommandForPlatform(platform: string = process.platform): { command: string; args: string[] } {
  if (platform === 'win32') {
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'] }
  }
  return { command: 'bash', args: ['-c'] }
}

/**
 * Run a shell command. On abort or timeout the child process is killed
 * (Review Focus 2: abort must kill the spawned process, not leave it running).
 */
export function runShell(command: string, options: ShellRunOptions): Promise<ShellRunResult> {
  const { command: shell, args } = shellCommandForPlatform()
  return runShellWith(shell, args, command, options)
}

export function runShellWith(
  shell: string,
  shellArgs: string[],
  command: string,
  options: ShellRunOptions,
): Promise<ShellRunResult> {
  return new Promise((resolve) => {
    const child = spawn(shell, [...shellArgs, command], {
      cwd: options.cwd,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      const combined = stderr.trim() ? `${stdout}\n[stderr]\n${stderr}` : stdout
      const t = truncateOutput(combined, options.maxLines, options.maxBytes)
      resolve({ output: t.content, exitCode, truncated: t.truncated })
    }

    const kill = () => {
      if (settled) return
      // platform-appropriate tree kill; the immediate kill covers the simple case
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true })
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        child.kill('SIGKILL')
      }
      finish(null)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => finish(code))
    child.on('error', (err) => {
      stderr += String(err)
      finish(1)
    })

    if (options.signal) {
      if (options.signal.aborted) kill()
      else options.signal.addEventListener('abort', kill, { once: true })
    }
    if (options.timeoutMs) {
      setTimeout(kill, options.timeoutMs).unref()
    }
  })
}
