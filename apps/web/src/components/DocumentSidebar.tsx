import type { FormEvent } from 'react'
import type { DocumentSummary } from '../types/document'

interface DocumentSidebarProps {
  documents: DocumentSummary[]
  isCreatingDocument: boolean
  isSearching: boolean
  onCreateDocument: () => void
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  onSelectDocument: (documentId: string) => void
  searchValue: string
  selectedDocumentId: string
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'numeric',
  }).format(new Date(value))
}

function getRoleLabel(role: DocumentSummary['currentUserRole']) {
  switch (role) {
    case 'admin':
      return '管理员'
    case 'editor':
      return '编辑者'
    case 'viewer':
      return '查看者'
    default:
      return role
  }
}

function getVisibilityLabel(visibility: DocumentSummary['visibility']) {
  return visibility === 'private' ? '私有' : '共享'
}

export function DocumentSidebar({
  documents,
  isCreatingDocument,
  isSearching,
  onCreateDocument,
  onSearchChange,
  onSearchSubmit,
  onSelectDocument,
  searchValue,
  selectedDocumentId,
}: DocumentSidebarProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSearchSubmit()
  }

  return (
    <aside className="panel sidebar">
      <div className="panel-header">
        <div>
          <p className="eyebrow">工作区</p>
          <h2>文档库</h2>
        </div>
        <button
          className="ghost-button"
          disabled={isCreatingDocument}
          type="button"
          onClick={onCreateDocument}
        >
          {isCreatingDocument ? '创建中…' : '新建'}
        </button>
      </div>

      <form className="search-form" onSubmit={handleSubmit}>
        <label className="search-field">
          <span className="sr-only">搜索文档</span>
          <input
            type="search"
            placeholder="输入关键词后回车搜索"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <p className="search-hint">
          {isSearching ? '正在搜索…' : '按回车后再发起检索请求'}
        </p>
      </form>

      <div className="document-list">
        {documents.map((document) => {
          const isSelected = document.id === selectedDocumentId

          return (
            <button
              key={document.id}
              className={`document-card${isSelected ? ' selected' : ''}`}
              type="button"
              onClick={() => onSelectDocument(document.id)}
            >
              <div className="document-card-topline">
                <strong>{document.title}</strong>
                <span>{formatUpdatedAt(document.updatedAt)}</span>
              </div>
              <p>{document.excerpt}</p>
              <div className="document-card-meta">
                <span>{document.ownerName}</span>
                <span>
                  {getRoleLabel(document.currentUserRole)} ·{' '}
                  {getVisibilityLabel(document.visibility)}
                </span>
              </div>
            </button>
          )
        })}

        {documents.length === 0 ? (
          <div className="empty-panel">
            <p>还没有匹配的文档，试试换个关键词，或者直接新建一篇。</p>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
