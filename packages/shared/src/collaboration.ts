import { TiptapTransformer } from '@hocuspocus/transformer'
import type { JSONContent } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { generateHTML, generateJSON } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import { Window } from 'happy-dom'
import { randomUUID } from 'node:crypto'
import * as Y from 'yjs'

const EMPTY_EXCERPT = 'Empty document'
const BLOCK_NODE_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'listItem'])
let didInitializeDomEnvironment = false

export const ENSURE_DOCUMENT_COLLAB_STATES_SQL = `
  CREATE TABLE IF NOT EXISTS document_collab_states (
    document_id VARCHAR(64) NOT NULL PRIMARY KEY,
    yjs_state LONGBLOB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_document_collab_states_document
      FOREIGN KEY (document_id) REFERENCES documents(id)
      ON DELETE CASCADE
  )
`

export const BlockNodeIdExtension = Extension.create({
  name: 'blockNodeId',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote', 'listItem'],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-block-id'),
            renderHTML: (attributes: Record<string, string | null>) => {
              if (!attributes.blockId) {
                return {}
              }

              return {
                'data-block-id': attributes.blockId,
              }
            },
          },
        },
      },
    ]
  },
})

export function ensureTiptapDomEnvironment() {
  if (didInitializeDomEnvironment) {
    return
  }

  const browserWindow = new Window()

  Object.assign(globalThis, {
    document: browserWindow.document,
    DOMParser: browserWindow.DOMParser,
    HTMLElement: browserWindow.HTMLElement,
    Node: browserWindow.Node,
    Text: browserWindow.Text,
    window: browserWindow,
    XMLSerializer: browserWindow.XMLSerializer,
  })

  didInitializeDomEnvironment = true
}

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

export function getCollabSchemaExtensions() {
  return [StarterKit.configure({ undoRedo: false }), BlockNodeIdExtension]
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

export function createYDocFromHtml(content: string, fieldName = 'default') {
  ensureTiptapDomEnvironment()

  const html = content.trim() ? content : '<p></p>'
  const jsonContent = normalizeCollabDocumentJSON(
    generateJSON(html, getCollabSchemaExtensions()),
  )

  return TiptapTransformer.toYdoc(
    jsonContent,
    fieldName,
    getCollabSchemaExtensions(),
  )
}

export function createCollabSnapshotFromYDoc(document: Y.Doc, fieldName = 'default') {
  ensureTiptapDomEnvironment()

  const jsonContent = normalizeCollabDocumentJSON(
    TiptapTransformer.fromYdoc(document, fieldName),
  )
  const html = generateHTML(jsonContent, getCollabSchemaExtensions())

  return {
    excerpt: buildExcerpt(html),
    html,
    state: Y.encodeStateAsUpdate(document),
  }
}

export function createCollabSnapshotFromHtml(content: string, fieldName = 'default') {
  const document = createYDocFromHtml(content, fieldName)
  return createCollabSnapshotFromYDoc(document, fieldName)
}
