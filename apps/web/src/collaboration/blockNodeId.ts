import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Selection } from '@tiptap/pm/state'

const BLOCK_NODE_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'listItem'])

export function createBlockId() {
  return `block-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function getActiveBlockIdFromSelection(selection: Selection) {
  for (let depth = selection.$anchor.depth; depth > 0; depth -= 1) {
    const node = selection.$anchor.node(depth)

    if (BLOCK_NODE_TYPES.has(node.type.name)) {
      const blockId = node.attrs.blockId
      return typeof blockId === 'string' && blockId.trim() ? blockId : null
    }
  }

  return null
}

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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockNodeId'),
        appendTransaction(_, __, newState) {
          const positions: number[] = []

          newState.doc.descendants((node, position) => {
            if (!BLOCK_NODE_TYPES.has(node.type.name)) {
              return
            }

            const blockId = node.attrs.blockId

            if (typeof blockId !== 'string' || !blockId.trim()) {
              positions.push(position)
            }
          })

          if (positions.length === 0) {
            return null
          }

          const transaction = newState.tr

          positions.forEach((position) => {
            const node = transaction.doc.nodeAt(position)

            if (!node) {
              return
            }

            transaction.setNodeMarkup(position, undefined, {
              ...node.attrs,
              blockId: createBlockId(),
            })
          })

          return transaction.docChanged ? transaction : null
        },
      }),
    ]
  },
})
