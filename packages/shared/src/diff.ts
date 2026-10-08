import { diffArrays, diffWordsWithSpace } from 'diff'
import { Window } from 'happy-dom'

export type DiffOp = 'equal' | 'insert' | 'delete'
export type DiffBlockType = 'paragraph' | 'heading' | 'blockquote' | 'listItem' | 'unknown'
export type DiffBlockStatus = 'added' | 'removed' | 'modified' | 'unchanged'

export interface DiffToken {
  op: DiffOp
  text: string
}

export interface RevisionRef {
  createdAt?: string
  editedByName?: string | null
  label: string
  version: number | 'current'
}

export interface DiffBlock {
  afterText: string
  beforeText: string
  blockId: string | null
  status: DiffBlockStatus
  tokens?: DiffToken[]
  type: DiffBlockType
}

export interface RevisionDiffResult {
  afterTitle: string
  beforeTitle: string
  blocks: DiffBlock[]
  from: RevisionRef
  summary: {
    addedBlocks: number
    modifiedBlocks: number
    removedBlocks: number
    unchangedBlocks: number
  }
  titleTokens: DiffToken[]
  to: RevisionRef
}

interface ParsedBlock {
  blockId: string | null
  text: string
  type: DiffBlockType
}

interface RevisionSnapshotInput {
  content: string
  ref: RevisionRef
  title: string
}

interface ParseElementLike {
  children: ArrayLike<ParseElementLike>
  getAttribute: (name: string) => string | null
  tagName: string
  textContent: string | null
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function toDiffTokens(beforeText: string, afterText: string) {
  return diffWordsWithSpace(beforeText, afterText)
    .filter((change) => change.value.length > 0)
    .map((change) => ({
      op: change.added ? 'insert' : change.removed ? 'delete' : 'equal',
      text: change.value,
    })) satisfies DiffToken[]
}

function getBlockType(element: ParseElementLike): DiffBlockType {
  if (element.tagName === 'P') {
    return 'paragraph'
  }

  if (HEADING_TAGS.has(element.tagName)) {
    return 'heading'
  }

  if (element.tagName === 'BLOCKQUOTE') {
    return 'blockquote'
  }

  if (element.tagName === 'LI') {
    return 'listItem'
  }

  return 'unknown'
}

function collectBlocks(container: ParseElementLike, blocks: ParsedBlock[]) {
  Array.from(container.children).forEach((child) => {
    if (
      child.tagName === 'P' ||
      HEADING_TAGS.has(child.tagName) ||
      child.tagName === 'BLOCKQUOTE' ||
      child.tagName === 'LI'
    ) {
      blocks.push({
        blockId: child.getAttribute('data-block-id'),
        text: normalizeText(child.textContent ?? ''),
        type: getBlockType(child),
      })
      return
    }

    if (child.tagName === 'UL' || child.tagName === 'OL') {
      collectBlocks(child, blocks)
      return
    }

    if (child.children.length > 0) {
      collectBlocks(child, blocks)
      return
    }

    const text = normalizeText(child.textContent ?? '')

    if (text) {
      blocks.push({
        blockId: child.getAttribute('data-block-id'),
        text,
        type: 'unknown',
      })
    }
  })
}

function parseBlocks(content: string): ParsedBlock[] {
  const browserWindow = new Window()
  const document = browserWindow.document.implementation.createHTMLDocument()
  document.body.innerHTML = content

  const blocks: ParsedBlock[] = []
  collectBlocks(document.body, blocks)

  if (blocks.length > 0) {
    return blocks
  }

  const fallbackText = normalizeText(document.body.textContent ?? '')

  return fallbackText
    ? [
        {
          blockId: null,
          text: fallbackText,
          type: 'unknown',
        },
      ]
    : []
}

function getAlignmentKey(block: ParsedBlock) {
  if (block.blockId) {
    return `id:${block.blockId}`
  }

  return `fallback:${block.type}:${normalizeText(block.text).toLowerCase()}`
}

function createBlockDiff(
  status: DiffBlockStatus,
  beforeBlock?: ParsedBlock,
  afterBlock?: ParsedBlock,
): DiffBlock {
  const beforeText = beforeBlock?.text ?? ''
  const afterText = afterBlock?.text ?? ''

  return {
    afterText,
    beforeText,
    blockId: afterBlock?.blockId ?? beforeBlock?.blockId ?? null,
    status,
    tokens:
      status === 'modified' ? toDiffTokens(beforeText, afterText) : undefined,
    type: afterBlock?.type ?? beforeBlock?.type ?? 'unknown',
  }
}

function compareBlocks(beforeBlocks: ParsedBlock[], afterBlocks: ParsedBlock[]) {
  const beforeKeys = beforeBlocks.map(getAlignmentKey)
  const afterKeys = afterBlocks.map(getAlignmentKey)
  const changes = diffArrays(beforeKeys, afterKeys)
  const blocks: DiffBlock[] = []
  let beforeIndex = 0
  let afterIndex = 0

  for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
    const change = changes[changeIndex]

    if (!change.added && !change.removed) {
      change.value.forEach(() => {
        const beforeBlock = beforeBlocks[beforeIndex]
        const afterBlock = afterBlocks[afterIndex]
        blocks.push(
          createBlockDiff(
            beforeBlock.text === afterBlock.text ? 'unchanged' : 'modified',
            beforeBlock,
            afterBlock,
          ),
        )
        beforeIndex += 1
        afterIndex += 1
      })
      continue
    }

    const nextChange = changes[changeIndex + 1]

    if (change.removed && nextChange?.added) {
      const pairCount = Math.min(change.value.length, nextChange.value.length)

      for (let index = 0; index < pairCount; index += 1) {
        blocks.push(
          createBlockDiff(
            'modified',
            beforeBlocks[beforeIndex + index],
            afterBlocks[afterIndex + index],
          ),
        )
      }

      for (let index = pairCount; index < change.value.length; index += 1) {
        blocks.push(createBlockDiff('removed', beforeBlocks[beforeIndex + index]))
      }

      for (let index = pairCount; index < nextChange.value.length; index += 1) {
        blocks.push(createBlockDiff('added', undefined, afterBlocks[afterIndex + index]))
      }

      beforeIndex += change.value.length
      afterIndex += nextChange.value.length
      changeIndex += 1
      continue
    }

    if (change.added && nextChange?.removed) {
      const pairCount = Math.min(change.value.length, nextChange.value.length)

      for (let index = 0; index < pairCount; index += 1) {
        blocks.push(
          createBlockDiff(
            'modified',
            beforeBlocks[beforeIndex + index],
            afterBlocks[afterIndex + index],
          ),
        )
      }

      for (let index = pairCount; index < nextChange.value.length; index += 1) {
        blocks.push(createBlockDiff('removed', beforeBlocks[beforeIndex + index]))
      }

      for (let index = pairCount; index < change.value.length; index += 1) {
        blocks.push(createBlockDiff('added', undefined, afterBlocks[afterIndex + index]))
      }

      beforeIndex += nextChange.value.length
      afterIndex += change.value.length
      changeIndex += 1
      continue
    }

    if (change.removed) {
      change.value.forEach(() => {
        blocks.push(createBlockDiff('removed', beforeBlocks[beforeIndex]))
        beforeIndex += 1
      })
      continue
    }

    change.value.forEach(() => {
      blocks.push(createBlockDiff('added', undefined, afterBlocks[afterIndex]))
      afterIndex += 1
    })
  }

  return blocks
}

export function compareRevisionSnapshots(
  beforeSnapshot: RevisionSnapshotInput,
  afterSnapshot: RevisionSnapshotInput,
): RevisionDiffResult {
  const blocks = compareBlocks(
    parseBlocks(beforeSnapshot.content),
    parseBlocks(afterSnapshot.content),
  )

  return {
    afterTitle: afterSnapshot.title,
    beforeTitle: beforeSnapshot.title,
    blocks,
    from: beforeSnapshot.ref,
    summary: {
      addedBlocks: blocks.filter((block) => block.status === 'added').length,
      modifiedBlocks: blocks.filter((block) => block.status === 'modified').length,
      removedBlocks: blocks.filter((block) => block.status === 'removed').length,
      unchangedBlocks: blocks.filter((block) => block.status === 'unchanged').length,
    },
    titleTokens: toDiffTokens(beforeSnapshot.title, afterSnapshot.title),
    to: afterSnapshot.ref,
  }
}
