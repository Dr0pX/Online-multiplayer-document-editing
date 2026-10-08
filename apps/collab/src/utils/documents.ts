import { randomUUID } from 'node:crypto'
import type { JSONContent } from '@tiptap/core'

const EMPTY_EXCERPT = 'Empty document'
const BLOCK_NODE_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'listItem'])

export function buildExcerpt(content: string) {
  const plainText = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return plainText.slice(0, 120) || EMPTY_EXCERPT
}

export function createBlockId() {
  return `block-${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function normalizeCollabDocumentJSON(content: JSONContent): JSONContent {
  const normalizedNode: JSONContent = {
    ...content,
  }

  if (content.attrs) {
    normalizedNode.attrs = {
      ...content.attrs,
    }
  }

  if (content.type && BLOCK_NODE_TYPES.has(content.type)) {
    normalizedNode.attrs = {
      ...normalizedNode.attrs,
      blockId:
        typeof normalizedNode.attrs?.blockId === 'string' &&
        normalizedNode.attrs.blockId.trim()
          ? normalizedNode.attrs.blockId
          : createBlockId(),
    }
  }

  if (Array.isArray(content.content)) {
    normalizedNode.content = content.content.map((child: JSONContent) =>
      normalizeCollabDocumentJSON(child),
    )
  }

  return normalizedNode
}
