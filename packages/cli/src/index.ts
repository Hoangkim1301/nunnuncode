#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  AgentLoop,
  SessionStore,
  compose,
  createDefaultPolicy,
  createOpenAICompatibleModel,
  createPiProvider,
  runPipeline,
  type LiveEvent,
  type Tool,
  type ToolContext,
} from '@nunnun/harness'
import { toolsPlugin } from '@nunnun/plugin-tools'
import { resolveProviderEnv } from './env.ts'
import { renderEvent, toolLabel, type RenderState } from './render.ts'

function buildModel(env: ReturnType<typeof resolveProviderEnv>) {
  return createOpenAICompatibleModel({
    id: env.model,
    baseUrl: env.baseUrl,
    contextWindow: env.contextWindow,
    reasoning: env.thinking,
  })
}

function newSessionFile(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(homedir(), '.nunnun', 'sessions')
  return join(dir, `chat-${stamp}.jsonl`)
}

async function confirmTool(req: { tool: string; input: unknown }): Promise<'once' | 'session' | 'deny'> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const preview =
    req.tool === 'bash' || req.tool === 'powershell'
      ? String((req.input as { command?: string }).command ?? '')
      : JSON.stringify(req.input).slice(0, 200)
  const answer = await new Promise<string>((resolve) => {
    rl.question(`  ⚠ allow ${req.tool} (${preview})? [y/n/a(llow this session)] `, (a) => resolve(a.trim().toLowerCase()))
  })
  rl.close()
  if (answer === 'a' || answer === 'session') return 'session'
  if (answer === 'y' || answer === 'yes') return 'once'
  return 'deny'
}

async function main(): Promise<void> {
  const env = resolveProviderEnv(process.cwd())
  const model = buildModel(env)
  const provider = createPiProvider({ model, apiKey: env.apiKey })

  const cwd = process.cwd()
  const ctx = compose([toolsPlugin({ cwd, omit: ['powershell'] })], {})
  const policy = createDefaultPolicy({ confirm: confirmTool })
  const executeTool = (tool: Tool, input: unknown, toolCtx: ToolContext) => runPipeline(tool, input, toolCtx, { policy })

  const session = SessionStore.open(newSessionFile())
  const loop = new AgentLoop(ctx, session, provider, 'You are nunnuncode, a helpful coding assistant.', executeTool)

  console.log('────────────────────────────────────────')
  console.log(`nunnuncode · ${env.model} · session ${session.events().length === 0 ? 'new' : 'resumed'}`)
  console.log('────────────────────────────────────────')

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '❯ ' })
  rl.prompt()

  rl.on('line', (line) => {
    const input = line.trim()
    if (input === '/q' || input === 'exit') {
      rl.close()
      return
    }
    if (input === '/c') {
      rl.prompt()
      return
    }
    if (input === '') {
      rl.prompt()
      return
    }

    rl.pause()
    void (async () => {
      const state: RenderState = { textStarted: false }
      try {
        for await (const ev of loop.run(input) as AsyncIterable<LiveEvent>) {
          switch (ev.type) {
            case 'tool-start':
              process.stdout.write(`\n⏺ ${ev.toolName}(${toolLabel(ev.toolName, undefined)})\n`)
              break
            case 'tool-end':
              process.stdout.write(`  ⎿ ${ev.output.split('\n')[0]?.slice(0, 120)}${ev.isError ? ' [error]' : ''}\n`)
              break
            case 'thinking-delta':
              process.stdout.write(`\x1b[2m${ev.delta}\x1b[0m`)
              break
            case 'text-delta':
              process.stdout.write(ev.delta)
              break
            case 'error':
              process.stdout.write(`\x1b[2m[${String(ev.error).slice(0, 200)}]\x1b[0m`)
              break
            default:
              void renderEvent(ev, state)
          }
        }
        process.stdout.write('\n')
      } catch (err) {
        console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
      }
      rl.resume()
      rl.prompt()
    })()
  })

  rl.on('close', () => {
    console.log('bye')
    process.exit(0)
  })
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
