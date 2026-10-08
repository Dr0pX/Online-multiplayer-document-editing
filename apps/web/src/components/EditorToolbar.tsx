export type ToolbarCommand =
  | 'bold'
  | 'italic'
  | 'insertUnorderedList'
  | 'insertOrderedList'
  | 'blockquote'
  | 'h2'
  | 'paragraph'

interface EditorToolbarProps {
  canDelete: boolean
  canEdit: boolean
  isCommandActive?: (command: ToolbarCommand) => boolean
  onCommand: (command: ToolbarCommand) => void
  onDelete: () => void
  onSave: () => void
  saveDisabled: boolean
}

const TOOLBAR_ACTIONS: Array<{
  command: ToolbarCommand
  label: string
}> = [
  { command: 'bold', label: '加粗' },
  { command: 'italic', label: '斜体' },
  { command: 'h2', label: '二级标题' },
  { command: 'paragraph', label: '正文' },
  { command: 'insertUnorderedList', label: '无序列表' },
  { command: 'insertOrderedList', label: '有序列表' },
  { command: 'blockquote', label: '引用' },
]

export function EditorToolbar({
  canDelete,
  canEdit,
  isCommandActive,
  onCommand,
  onDelete,
  onSave,
  saveDisabled,
}: EditorToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        {TOOLBAR_ACTIONS.map((action) => (
          <button
            key={action.command}
            className={`toolbar-button${
              isCommandActive?.(action.command) ? ' active' : ''
            }`}
            disabled={!canEdit}
            type="button"
            onClick={() => onCommand(action.command)}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="toolbar-group toolbar-actions">
        <button
          className="ghost-button danger-button"
          disabled={!canDelete}
          type="button"
          onClick={onDelete}
        >
          删除
        </button>
        <button
          className="primary-button"
          disabled={saveDisabled}
          type="button"
          onClick={onSave}
        >
          保存版本
        </button>
      </div>
    </div>
  )
}
