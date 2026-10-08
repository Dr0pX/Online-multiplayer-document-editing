import StarterKit from '@tiptap/starter-kit'
import { BlockNodeIdExtension } from './blockNodeId.js'

export function getCollabSchemaExtensions() {
  return [StarterKit.configure({ undoRedo: false }), BlockNodeIdExtension]
}
