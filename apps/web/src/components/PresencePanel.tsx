import { useEffect, useState, type FormEvent } from 'react'
import { compareDocumentRevisions } from '../services/api/documents'
import { RevisionDiffViewer } from './RevisionDiffViewer'
import type {
  ConnectionStatus,
  DocumentMember,
  DocumentRevision,
  DocumentRole,
  RevisionDiffResult,
  SaveStatus,
} from '../types/document'

interface PresencePanelProps {
  canManageMembers: boolean
  connectionStatus: ConnectionStatus
  currentUserRole: DocumentRole
  documentId: string
  errorMessage: string
  isMutatingMembers: boolean
  lastSavedAt: string | null
  members: DocumentMember[]
  onInviteMember: (payload: {
    role: DocumentRole
    usernameOrEmail: string
  }) => Promise<void>
  onRemoveMember: (memberId: number) => Promise<void>
  onUpdateMemberRole: (memberId: number, role: DocumentRole) => Promise<void>
  revisions: DocumentRevision[]
  saveStatus: SaveStatus
}

function getRoleLabel(role: DocumentRole) {
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

function getConnectionLabel(status: ConnectionStatus) {
  switch (status) {
    case 'online':
      return '在线'
    case 'syncing':
      return '同步中'
    case 'offline':
      return '离线'
    default:
      return status
  }
}

function getSaveLabel(status: SaveStatus) {
  switch (status) {
    case 'idle':
      return '等待编辑'
    case 'dirty':
      return '有待保存的元数据'
    case 'saving':
      return '保存中'
    case 'saved':
      return '已保存'
    default:
      return status
  }
}

function formatSavedAt(value: string | null) {
  if (!value) {
    return '暂无保存记录'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatRevisionDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'numeric',
  }).format(new Date(value))
}

export function PresencePanel({
  canManageMembers,
  connectionStatus,
  currentUserRole,
  documentId,
  errorMessage,
  isMutatingMembers,
  lastSavedAt,
  members,
  onInviteMember,
  onRemoveMember,
  onUpdateMemberRole,
  revisions,
  saveStatus,
}: PresencePanelProps) {
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<DocumentRole>('viewer')
  const [compareResult, setCompareResult] = useState<RevisionDiffResult | null>(null)
  const [compareError, setCompareError] = useState('')
  const [isCompareLoading, setIsCompareLoading] = useState(false)
  const [isCompareViewerOpen, setIsCompareViewerOpen] = useState(false)

  useEffect(() => {
    setCompareResult(null)
    setCompareError('')
    setIsCompareLoading(false)
    setIsCompareViewerOpen(false)
  }, [documentId])

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!usernameOrEmail.trim()) {
      return
    }

    await onInviteMember({
      role: inviteRole,
      usernameOrEmail: usernameOrEmail.trim(),
    })

    setUsernameOrEmail('')
    setInviteRole('viewer')
  }

  async function handleCompareWithCurrent(revision: DocumentRevision) {
    setIsCompareViewerOpen(true)
    setIsCompareLoading(true)
    setCompareError('')

    try {
      const result = await compareDocumentRevisions(
        documentId,
        revision.versionNumber,
        'current',
      )

      setCompareResult(result)
    } catch (error) {
      setCompareResult(null)
      setCompareError(error instanceof Error ? error.message : '加载版本对比失败。')
    } finally {
      setIsCompareLoading(false)
    }
  }

  return (
    <>
      <aside className="panel presence-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">协作</p>
            <h2>权限与版本</h2>
          </div>
        </div>

        <div className="status-stack">
          <div className="status-card">
            <span>连接状态</span>
            <strong>{getConnectionLabel(connectionStatus)}</strong>
          </div>
          <div className="status-card">
            <span>当前角色</span>
            <strong>{getRoleLabel(currentUserRole)}</strong>
          </div>
          <div className="status-card">
            <span>保存状态</span>
            <strong>{getSaveLabel(saveStatus)}</strong>
          </div>
          <div className="status-card">
            <span>最近同步</span>
            <strong>{formatSavedAt(lastSavedAt)}</strong>
          </div>
        </div>

        <div className="hint-card">
          <p className="hint-title">权限说明</p>
          <p>
            管理员可以管理成员和删除文档，编辑者可以修改正文，查看者只能阅读内容和查看历史版本。
          </p>
        </div>

        {errorMessage ? (
          <div className="error-card">
            <p>{errorMessage}</p>
          </div>
        ) : null}

        <div className="presence-list">
          <div className="presence-list-header">
            <h3>成员列表</h3>
            <span>{members.length} 人</span>
          </div>

          {members.map((member) => (
            <div key={member.id} className="presence-row">
              <span className="presence-avatar" aria-hidden="true">
                {member.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div className="presence-content">
                <strong>
                  {member.displayName}
                  {member.isOwner ? ' · 所有者' : ''}
                </strong>
                <p>{member.email}</p>
              </div>
              <div className="member-actions">
                <select
                  disabled={isMutatingMembers || !canManageMembers || member.isOwner}
                  value={member.role}
                  onChange={(event) =>
                    void onUpdateMemberRole(member.id, event.target.value as DocumentRole)
                  }
                >
                  <option value="admin">管理员</option>
                  <option value="editor">编辑者</option>
                  <option value="viewer">查看者</option>
                </select>
                <button
                  className="ghost-button compact-button"
                  disabled={isMutatingMembers || !canManageMembers || member.isOwner}
                  type="button"
                  onClick={() => void onRemoveMember(member.id)}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>

        {canManageMembers ? (
          <form className="member-invite-form" onSubmit={handleInviteSubmit}>
            <label className="auth-field">
              <span>通过用户名或邮箱添加成员</span>
              <input
                type="text"
                value={usernameOrEmail}
                onChange={(event) => setUsernameOrEmail(event.target.value)}
              />
            </label>
            <div className="member-invite-actions">
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as DocumentRole)}
              >
                <option value="viewer">查看者</option>
                <option value="editor">编辑者</option>
                <option value="admin">管理员</option>
              </select>
              <button className="primary-button" disabled={isMutatingMembers} type="submit">
                {isMutatingMembers ? '处理中…' : '邀请成员'}
              </button>
            </div>
          </form>
        ) : null}

        <div className="revision-stack">
          <div className="presence-list-header">
            <h3>最近版本</h3>
            <span>{revisions.length} 条</span>
          </div>

          {revisions.map((revision) => (
            <div key={revision.id} className="revision-card">
              <div className="revision-card-header">
                <strong>版本 {revision.versionNumber}</strong>
                <button
                  className="ghost-button compact-button"
                  type="button"
                  onClick={() => void handleCompareWithCurrent(revision)}
                >
                  对比当前版本
                </button>
              </div>
              <p>{revision.excerptSnapshot || '暂无摘要快照。'}</p>
              <span>
                {revision.editedByName ?? '未知编辑者'} · {formatRevisionDate(revision.createdAt)}
              </span>
            </div>
          ))}
        </div>
      </aside>

      {isCompareViewerOpen ? (
        <RevisionDiffViewer
          errorMessage={compareError}
          isLoading={isCompareLoading}
          onClose={() => setIsCompareViewerOpen(false)}
          result={compareResult}
        />
      ) : null}
    </>
  )
}
