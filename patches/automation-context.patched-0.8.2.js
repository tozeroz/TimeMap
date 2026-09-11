import { createHash } from 'node:crypto'
import {
  BROWSER_STATE_PREFIX,
  DESKTOP_STATE_PREFIX,
  MCP_CONTEXT_PREFIX,
  activeMessageStart,
} from './content.js'
import { DeepSeekEyesError } from './error.js'
import { estimateRequestTokens } from './token-safety.js'

export const AUTOMATION_KINDS = Object.freeze(['browser', 'desktop', 'mcp'])

function blocksContainText(blocks, prefix) {
  if (!Array.isArray(blocks)) return false
  return blocks.some(block =>
    (block?.type === 'text' && block.text.startsWith(prefix))
      || (block?.type === 'tool-result' && blocksContainText(block.content, prefix)),
  )
}

function isMcpContextMessage(message) {
  return message?.source?.kind === 'plugin'
    && message.source.plugin === 'deepseekeyes'
    && message.source.form === 'mcp-context'
    && blocksContainText(message.content, MCP_CONTEXT_PREFIX)
}

function automationKindForTool(name) {
  if (typeof name !== 'string') return undefined
  if (name.startsWith('mcp__')) return 'mcp'
  if (name === 'computer') return 'desktop'
  if (name === 'browser') return 'browser'
  return undefined
}

function collectToolCalls(blocks, calls) {
  if (!Array.isArray(blocks)) return
  for (const block of blocks) {
    if (block?.type === 'tool-call') {
      const kind = automationKindForTool(block.name)
      if (kind !== undefined && typeof block.id === 'string') calls.set(block.id, kind)
    }
    if (Array.isArray(block?.content)) collectToolCalls(block.content, calls)
  }
}

function automationKindInBlocks(blocks, { allowMcpContext = false, calls = new Map() } = {}) {
  if (!Array.isArray(blocks)) return undefined
  for (const block of blocks) {
    if (allowMcpContext && block?.type === 'text' && block.text.startsWith(MCP_CONTEXT_PREFIX)) return 'mcp'
    if (block?.type !== 'tool-result') continue
    const kind = automationKindForTool(block.toolName) ?? calls.get(block.toolCallId)
    if (kind === 'mcp') return 'mcp'
    if (kind === 'desktop'
      && (block.isError === true || blocksContainText(block.content, DESKTOP_STATE_PREFIX))) return 'desktop'
    if (kind === 'browser'
      && (block.isError === true || blocksContainText(block.content, BROWSER_STATE_PREFIX))) return 'browser'
    const nested = automationKindInBlocks(block.content, { allowMcpContext, calls })
    if (nested !== undefined) return nested
  }
  return undefined
}

/** Identify only a current DeepSeekEyes Browser/Desktop/MCP tool result, never stale history text. */
export function activeAutomationKind(messages) {
  const start = activeMessageStart(messages)
  const calls = new Map()
  // DSH places the current tool result after the assistant tool-call message,
  // while activeMessageStart intentionally begins after that assistant. Include
  // only the immediately preceding assistant so an error can be correlated
  // without reviving older completed automation history.
  for (let index = Math.max(0, start - 1); index < (messages?.length ?? 0); index += 1) {
    collectToolCalls(messages[index]?.content, calls)
  }
  for (let index = start; index < (messages?.length ?? 0); index += 1) {
    const message = messages[index]
    const kind = automationKindInBlocks(message?.content, {
      allowMcpContext: isMcpContextMessage(message),
      calls,
    })
    if (kind !== undefined) return kind
  }
  return undefined
}

function contentHasToolResult(content) {
  if (!Array.isArray(content)) return false
  return content.some(block => block?.type === 'tool-result'
    || (Array.isArray(block?.content) && contentHasToolResult(block.content)))
}

function isDirectUserTask(message) {
  return message?.role === 'user'
    && message.source?.kind !== 'plugin'
    && !contentHasToolResult(message.content)
}

export function latestAutomationTask(messages) {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    if (!isDirectUserTask(messages[index])) continue
    return {
      index,
      id: String(messages[index].id ?? `user-message-${index}`),
      message: messages[index],
    }
  }
  return undefined
}

function messageHasToolCall(message) {
  return Array.isArray(message?.content) && message.content.some(block => block?.type === 'tool-call')
}

function messageHasToolResult(message) {
  return contentHasToolResult(message?.content)
}

function collectToolCallIds(blocks, ids) {
  if (!Array.isArray(blocks)) return ids
  for (const block of blocks) {
    if (block?.type === 'tool-call' && typeof block.id === 'string') ids.add(block.id)
    if (Array.isArray(block?.content)) collectToolCallIds(block.content, ids)
  }
  return ids
}

function collectToolResultIds(blocks, ids) {
  if (!Array.isArray(blocks)) return ids
  for (const block of blocks) {
    if (block?.type === 'tool-result' && typeof block.toolCallId === 'string') ids.add(block.toolCallId)
    if (Array.isArray(block?.content)) collectToolResultIds(block.content, ids)
  }
  return ids
}

/**
 * 一组消息是否「只带 tool 结果、没有自己的 tool call」。
 * 这种组如果成为保留窗口的最旧一组，请求里就会出现没有对应 tool_calls 的 tool 消息，
 * DeepSeek 会直接返回 400（Messages with role 'tool' must be a response to a preceding
 * message with 'tool_calls'），整轮以 error 结束。
 */
function groupIsOrphanResult(group) {
  const head = Array.isArray(group) ? group[0] : undefined
  return head !== undefined && !messageHasToolCall(head) && messageHasToolResult(head)
}

/**
 * Keep assistant tool calls atomic with **all** of their tool results.
 *
 * 2026-09-12 修复（DSH 本地补丁，见 G:\demo map\patches）：
 * 一条 assistant 消息可以并发多个 tool call，DSH 会为每个 call 追加一条独立的
 * result 消息。原实现只把「assistant + 紧跟的第一条 result」配成一组，第 2 条及以后
 * 的 result 会各自成为独立分组；boundAutomationContext 从尾部裁剪时若边界落在这些
 * 分组上，保留的消息就缺少对应的 tool_calls，导致 DeepSeek 返回 400。
 * 现在把所有「回答本条 assistant 已声明 tool call」的连续 result 消息一并吸收，
 * 并继续吸收其后的 trusted MCP 上下文消息。
 */
function messageGroups(messages, start) {
  const groups = []
  for (let index = start; index < messages.length; index += 1) {
    if (messageHasToolCall(messages[index])) {
      const group = [messages[index]]
      const declared = collectToolCallIds(messages[index].content, new Set())
      const answered = new Set()
      let cursor = index + 1
      while (cursor < messages.length) {
        const candidate = messages[cursor]
        const resultIds = collectToolResultIds(candidate?.content, new Set())
        const answersThisCall = resultIds.size > 0
          && [...resultIds].some(id => declared.has(id))
          && ![...resultIds].some(id => answered.has(id))
        if (answersThisCall) {
          group.push(candidate)
          for (const id of resultIds) answered.add(id)
          cursor += 1
          continue
        }
        // DSH appends deferred Code Mode contexts after the outer run_code
        // result. Keep every trusted MCP marker/image context atomic with that
        // call/result pair so bounding can never retain metadata while silently
        // dropping the actual result it describes.
        if (isMcpContextMessage(candidate)) {
          group.push(candidate)
          cursor += 1
          continue
        }
        break
      }
      groups.push(group)
      index = cursor - 1
    } else {
      groups.push([messages[index]])
    }
  }
  return groups
}

function compactNotice(taskId) {
  const digest = createHash('sha256').update(taskId).digest('hex').slice(0, 16)
  return {
    id: `deepseekeyes-automation-context-${digest}`,
    role: 'user',
    content: [{
      type: 'text',
      text: '[DeepSeekEyes automation context window]\nOlder task history remains preserved by DSH but is omitted from this model request. Continue from the retained user instruction and newest tool states.',
    }],
    source: {
      kind: 'plugin',
      plugin: 'deepseekeyes',
      form: 'notice',
      summary: 'Older automation history omitted by the configured context budget.',
    },
  }
}

function requestWithMessages(options, messages) {
  return { ...options, messages }
}

/**
 * Bound only the model-facing copy of an active automation request.
 *
 * The durable DSH task, event log, original screenshots and reports are untouched.
 * The newest direct user instruction is always retained, as is an atomic tail of
 * assistant tool calls and matching tool results. Zero delegates to the full Host
 * context for users who explicitly choose unlimited mode.
 */
export function boundAutomationContext(options, maximumTokens) {
  const beforeTokens = estimateRequestTokens(options)
  const task = latestAutomationTask(options.messages)
  const taskId = task?.id ?? `session:${String(options.sessionId ?? 'unknown')}`
  if (maximumTokens === 0 || beforeTokens <= maximumTokens) {
    return {
      options,
      taskId,
      changed: false,
      beforeTokens,
      afterTokens: beforeTokens,
      savedTokens: 0,
      droppedMessages: 0,
      withinLimit: maximumTokens === 0 || beforeTokens <= maximumTokens,
    }
  }

  const messages = Array.isArray(options.messages) ? options.messages : []
  const taskIndex = task?.index ?? Math.max(0, activeMessageStart(messages) - 1)
  const taskMessage = messages[taskIndex]
  const notice = compactNotice(taskId)
  const fixed = taskMessage === undefined ? [notice] : [taskMessage, notice]
  const groups = messageGroups(messages, taskIndex + (taskMessage === undefined ? 0 : 1))
  const selected = []

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const candidate = [...groups[index], ...selected.flat()]
    const candidateMessages = [...fixed, ...candidate]
    const candidateTokens = estimateRequestTokens(requestWithMessages(options, candidateMessages))
    if (candidateTokens <= maximumTokens || selected.length === 0) {
      selected.unshift(groups[index])
      continue
    }
    break
  }

  // 结构兜底（2026-09-12 修复）：保留窗口最旧的一组如果只带 tool 结果、没有对应的
  // tool call，请求就是非法结构，DeepSeek 会返回
  // 400 Messages with role 'tool' must be a response to a preceding message with 'tool_calls'，
  // 该轮直接以 error 结束。丢弃这类孤立结果——宁可少一段旧结果，也不能发出非法请求。
  while (selected.length > 0 && groupIsOrphanResult(selected[0])) {
    selected.shift()
  }

  const boundedMessages = [...fixed, ...selected.flat()]
  const boundedOptions = requestWithMessages(options, boundedMessages)
  const afterTokens = estimateRequestTokens(boundedOptions)
  return {
    options: boundedOptions,
    taskId,
    changed: true,
    beforeTokens,
    afterTokens,
    savedTokens: Math.max(0, beforeTokens - afterTokens),
    droppedMessages: Math.max(0, messages.length - boundedMessages.length + 1),
    withinLimit: afterTokens <= maximumTokens,
  }
}

/** Per-session runaway guard reset by the next direct user instruction. */
export class AutomationTurnGuard {
  constructor() {
    this.turns = new Map()
  }

  state(sessionId, taskId) {
    const key = String(sessionId ?? 'unknown')
    let value = this.turns.get(key)
    const newTurn = value === undefined || value.taskId !== taskId
    if (newTurn) {
      value = { taskId, calls: 0 }
      this.turns.set(key, value)
    }
    return { key, value, newTurn }
  }

  assertAvailable(sessionId, taskId, maximumCalls) {
    const current = this.state(sessionId, taskId)
    if (maximumCalls !== 0 && current.value.calls >= maximumCalls) {
      throw new DeepSeekEyesError(
        `DeepSeekEyes automation reached the configured ${maximumCalls} model calls for this user instruction. Send a new instruction to continue, increase automationMaxCallsPerTurn, or set it to 0 for unlimited.`,
        'AUTOMATION_CALL_LIMIT',
      )
    }
    return current
  }

  begin(sessionId, taskId, maximumCalls) {
    const current = this.assertAvailable(sessionId, taskId, maximumCalls)
    const firstCall = current.value.calls === 0
    current.value.calls += 1
    return { newTurn: current.newTurn || firstCall, calls: current.value.calls }
  }

  clear(sessionId) {
    this.turns.delete(String(sessionId ?? 'unknown'))
  }

  clearAll() {
    this.turns.clear()
  }
}
