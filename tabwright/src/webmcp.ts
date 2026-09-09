import crypto from 'node:crypto'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { z } from 'zod'
import type { Frame, JSHandle, Page } from '@xmorse/playwright-core'

interface NativeTool {
  name: string
  description: string
  inputSchema: unknown
  origin: string
  title?: string
  annotations?: Record<string, unknown>
  window: Window
}

interface ModelContext extends EventTarget {
  getTools(): Promise<NativeTool[]>
  executeTool(tool: NativeTool, input: string): Promise<string | null>
}

interface ToolSnapshot {
  tools: NativeTool[]
  url: string
  stale: boolean
  cleanup(): void
}

interface Listing {
  page: Page
  handle: JSHandle<ToolSnapshot>
  stale: boolean
  tools: WebMCPTool[]
  invalidate(frame: Frame): void
  close(): void
}

export interface WebMCPTool {
  toolId: string
  name: string
  description: string
  inputSchema: unknown
  origin: string
  title?: string
  annotations?: Record<string, unknown>
}

/** Session-owned handles bind calls to the exact discovered document and tool objects. */
export class WebMCP {
  private listings = new Map<string, Listing>()

  async list({ page }: { page: Page }): Promise<{ pageUrl: string; tools: WebMCPTool[] }> {
    await Promise.all(
      [...this.listings]
        .filter(([, entry]) => {
          return entry.page === page || entry.page.isClosed()
        })
        .map(([id]) => {
          return this.remove(id)
        }),
    )
    if (page.isClosed()) {
      throw new Error('WEBMCP_PAGE_CLOSED: Select a connected page and discover tools again.')
    }
    const handle = await page.evaluateHandle(async () => {
      const modelContext = (document as { modelContext?: ModelContext }).modelContext
      if (typeof modelContext?.getTools !== 'function' || typeof modelContext.executeTool !== 'function') {
        throw new Error(
          'WEBMCP_UNAVAILABLE: This page/browser does not expose native WebMCP discovery and execution. No tools were invoked.',
        )
      }
      const controller = new AbortController()
      const snapshot: ToolSnapshot = {
        tools: [],
        url: window.location.href,
        stale: false,
        cleanup: () => {
          controller.abort()
        },
      }
      modelContext.addEventListener(
        'toolchange',
        () => {
          snapshot.stale = true
        },
        { signal: controller.signal },
      )
      try {
        // First release deliberately targets the selected top-level document only.
        snapshot.tools = (await modelContext.getTools()).filter((tool) => {
          return tool.window === window
        })
        return snapshot
      } catch (error) {
        controller.abort()
        throw error
      }
    })
    const id = crypto.randomUUID()
    const listing: Listing = {
      page,
      handle,
      stale: false,
      tools: [],
      invalidate: (frame) => {
        if (frame === page.mainFrame()) {
          listing.stale = true
        }
      },
      close: () => {
        listing.stale = true
      },
    }
    page.on('framenavigated', listing.invalidate)
    page.on('close', listing.close)
    this.listings.set(id, listing)
    try {
      const result = await handle.evaluate((snapshot, prefix) => {
        if (snapshot.stale || snapshot.url !== window.location.href) {
          throw new Error('WEBMCP_STALE: Page tools changed during discovery. Discover again.')
        }
        return {
          pageUrl: snapshot.url,
          tools: snapshot.tools.map((tool, index) => {
            return {
              toolId: `${prefix}:${index}`,
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              origin: tool.origin,
              title: tool.title,
              annotations: tool.annotations,
            }
          }),
        }
      }, id)
      listing.tools = result.tools
      return result
    } catch (error) {
      await this.remove(id)
      throw error
    }
  }

  async call({ toolId, input }: { toolId: string; input: Record<string, unknown> }): Promise<{
    status: 'returned' | 'unknown'
    result: string | null
  }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('WEBMCP_INVALID_INPUT: Input must be a JSON object. No tool was invoked.')
    }
    const serialized = JSON.stringify(input)
    const [id, indexText, extra] = toolId.split(':')
    const index = Number(indexText)
    const listing = this.listings.get(id)
    if (!listing || listing.stale || listing.page.isClosed() || extra !== undefined || !/^\d+$/.test(indexText || '')) {
      throw new Error(
        'WEBMCP_STALE: Unknown or stale tool ID. Discover tools in this session again. No tool was invoked.',
      )
    }
    const tool = listing.tools[index]
    if (!tool) {
      throw new Error('WEBMCP_STALE: Unknown tool ID. Discover again. No tool was invoked.')
    }
    // Chrome currently accepts missing required fields; validate the discovered schema ourselves.
    // A fresh provider also prevents unrelated tools with the same $id sharing a cached schema.
    const schema = z
      .record(z.string(), z.unknown())
      .parse(typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema)
    const checked = new AjvJsonSchemaValidator().getValidator(schema)(JSON.parse(serialized))
    if (!checked.valid) {
      throw new Error(`WEBMCP_INVALID_INPUT: ${checked.errorMessage}. No tool was invoked.`)
    }
    const result = await listing.handle
      .evaluate(
        async (snapshot, { index, serialized }) => {
          const tool = snapshot.tools[index]
          if (snapshot.stale || snapshot.url !== window.location.href || !tool) {
            throw new Error('WEBMCP_STALE: Page or tools changed. Discover again. No tool was invoked.')
          }
          const modelContext = (document as { modelContext?: ModelContext }).modelContext
          if (!modelContext) {
            throw new Error('WEBMCP_UNAVAILABLE: Native WebMCP is unavailable. No tool was invoked.')
          }
          try {
            return await modelContext.executeTool(tool, serialized)
          } catch (cause) {
            throw new Error(
              'WEBMCP_CALL_FAILED: The tool invocation rejected; business outcome may be unknown. Do not automatically retry; inspect page state first.',
              { cause },
            )
          }
        },
        { index, serialized },
      )
      .catch((cause: unknown) => {
        if (cause instanceof Error && /WEBMCP_(STALE|UNAVAILABLE|CALL_FAILED)/.test(cause.message)) {
          throw cause
        }
        throw new Error(
          'WebMCP call did not return a result. Do not automatically retry; inspect the page and rediscover tools if needed.',
          { cause },
        )
      })
    return { status: result === null ? 'unknown' : 'returned', result }
  }

  private async remove(id: string): Promise<void> {
    const listing = this.listings.get(id)
    if (!listing) {
      return
    }
    this.listings.delete(id)
    listing.page.off('framenavigated', listing.invalidate)
    listing.page.off('close', listing.close)
    // Disconnected or navigated documents may no longer accept cleanup evaluations.
    await listing.handle
      .evaluate((snapshot) => {
        snapshot.cleanup()
      })
      .catch(() => {})
    await listing.handle.dispose().catch(() => {})
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.listings.keys()].map((id) => {
        return this.remove(id)
      }),
    )
  }
}

export type WebMCPRequest =
  | { action: 'list'; pageUrl: string }
  | { action: 'call'; toolId: string; input: Record<string, unknown> }

/** Shared CLI/MCP entry point; JSON values are data, never interpolated executable input. */
export function webMCPCode(request: WebMCPRequest): string {
  if (request.action === 'call') {
    return `console.log(JSON.stringify(await callWebMCPTool(${JSON.stringify({ toolId: request.toolId, input: request.input })})))`
  }
  return `{
    const matches = context.pages().filter((candidate) => { return candidate.url() === ${JSON.stringify(request.pageUrl)} });
    if (matches.length !== 1) throw new Error('Select exactly one connected page by URL; use execute to inspect pages or listWebMCPTools({ page }) for duplicate URLs.');
    console.log(JSON.stringify(await listWebMCPTools({ page: matches[0] })));
  }`
}
