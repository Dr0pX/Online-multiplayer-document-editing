import { Extension } from '@tiptap/core'

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
