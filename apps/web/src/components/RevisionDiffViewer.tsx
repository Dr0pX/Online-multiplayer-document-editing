import type { DiffToken, RevisionDiffBlock, RevisionDiffResult, RevisionRef } from '../types/document'

interface RevisionDiffViewerProps {
  errorMessage: string
  isLoading: boolean
  onClose: () => void
  result: RevisionDiffResult | null
}

function formatCompareTime(value?: string) {
  if (!value) {
    return 'Unknown time'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'numeric',
  }).format(new Date(value))
}

function getStatusLabel(status: RevisionDiffBlock['status']) {
  switch (status) {
    case 'added':
      return '新增'
    case 'removed':
      return '删除'
    case 'modified':
      return '修改'
    case 'unchanged':
      return '未变化'
    default:
      return status
  }
}

function getBlockTypeLabel(type: RevisionDiffBlock['type']) {
  switch (type) {
    case 'paragraph':
      return '段落'
    case 'heading':
      return '标题'
    case 'blockquote':
      return '引用'
    case 'listItem':
      return '列表项'
    case 'unknown':
      return '内容块'
    default:
      return type
  }
}

function renderTokens(tokens: DiffToken[]) {
  return tokens.map((token, index) => (
    <span
      key={`${token.op}-${index}-${token.text.slice(0, 12)}`}
      className={`diff-token diff-token-${token.op}`}
    >
      {token.text}
    </span>
  ))
}

function renderRevisionMeta(label: string, revision: RevisionRef) {
  return (
    <div className="diff-meta-card">
      <span>{label}</span>
      <strong>{revision.label}</strong>
      <p>
        {revision.editedByName ?? '当前快照'} · {formatCompareTime(revision.createdAt)}
      </p>
    </div>
  )
}

export function RevisionDiffViewer({
  errorMessage,
  isLoading,
  onClose,
  result,
}: RevisionDiffViewerProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="revision-diff-title"
        aria-modal="true"
        className="modal-card diff-modal-card"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="diff-modal-head">
          <div>
            <p className="eyebrow">版本对比</p>
            <h2 id="revision-diff-title">查看版本差异</h2>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>

        {isLoading ? (
          <div className="empty-panel">
            <p>正在生成版本差异，请稍候。</p>
          </div>
        ) : null}

        {!isLoading && errorMessage ? (
          <div className="error-card">
            <p>{errorMessage}</p>
          </div>
        ) : null}

        {!isLoading && !errorMessage && result ? (
          <div className="diff-modal-body">
            <div className="diff-meta-grid">
              {renderRevisionMeta('基线版本', result.from)}
              {renderRevisionMeta('对比版本', result.to)}
            </div>

            <div className="diff-summary-grid">
              <div className="status-card">
                <span>新增块</span>
                <strong>{result.summary.addedBlocks}</strong>
              </div>
              <div className="status-card">
                <span>删除块</span>
                <strong>{result.summary.removedBlocks}</strong>
              </div>
              <div className="status-card">
                <span>修改块</span>
                <strong>{result.summary.modifiedBlocks}</strong>
              </div>
              <div className="status-card">
                <span>未变化</span>
                <strong>{result.summary.unchangedBlocks}</strong>
              </div>
            </div>

            <div className="diff-section">
              <div className="presence-list-header">
                <h3>标题变化</h3>
              </div>
              <div className="diff-token-stream">
                {renderTokens(result.titleTokens)}
              </div>
            </div>

            <div className="diff-section">
              <div className="presence-list-header">
                <h3>正文结构对比</h3>
                <span>{result.blocks.length} 个内容块</span>
              </div>

              <div className="diff-block-list">
                {result.blocks.map((block, index) => (
                  <article
                    key={`${block.blockId ?? 'block'}-${index}`}
                    className={`diff-block-card diff-block-${block.status}`}
                  >
                    <div className="diff-block-head">
                      <strong>
                        {getBlockTypeLabel(block.type)} #{index + 1}
                      </strong>
                      <span className={`diff-status-badge diff-status-${block.status}`}>
                        {getStatusLabel(block.status)}
                      </span>
                    </div>

                    <div className="diff-pane-grid">
                      <div className="diff-pane">
                        <span>变更前</span>
                        <p>{block.beforeText || '空内容'}</p>
                      </div>
                      <div className="diff-pane">
                        <span>变更后</span>
                        <p>{block.afterText || '空内容'}</p>
                      </div>
                    </div>

                    {block.tokens?.length ? (
                      <div className="diff-token-stream">{renderTokens(block.tokens)}</div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
