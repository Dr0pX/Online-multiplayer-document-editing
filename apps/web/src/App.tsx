import { useEffect, useEffectEvent, useState } from 'react'
import { AuthScreen } from './components/AuthScreen'
import { DocumentEditor } from './components/DocumentEditor'
import { DocumentSidebar } from './components/DocumentSidebar'
import { PresencePanel } from './components/PresencePanel'
import { useSession } from './features/auth/useSession'
import { useWorkspace } from './features/workspace/useWorkspace'
import type { AuthUser } from './types/auth'

function App() {
  const session = useSession()
  // 加载中时切换页面
  if (session.isBooting) {  
    return (
      <main className="app-shell loading-shell">
        <section className="loading-card">
          <p className="eyebrow">会话</p>
          <h1>正在恢复登录状态</h1>
          <p>系统正在检查你是否已有可用的后端登录会话。</p>
        </section>
      </main>
    )
  }
  // 如果未登录，跳转登录页面
  if (!session.user) {
    return (
      <AuthScreen
        authError={session.authError}
        isSubmitting={session.isAuthenticating}
        onLogin={session.loginWithPassword}
        onRegister={session.registerAccount}
      />
    )
  }

  // 转到渲染主工作区
  return <AuthenticatedApp session={session} user={session.user} />
}

interface AuthenticatedAppProps {
  session: ReturnType<typeof useSession>
  user: AuthUser
}

function getSystemRoleLabel(role: AuthUser['systemRole']) {
  return role === 'super_admin' ? '超级管理员' : '普通用户'
}

function AuthenticatedApp({ session, user }: AuthenticatedAppProps) {
  const workspace = useWorkspace(user, () => {  // 导入当前登录用户和强制登出回调
    void session.logoutCurrentUser()
  })
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeletingDocument, setIsDeletingDocument] = useState(false)
  // 自动保存回调
  const handleAutoSave = useEffectEvent(() => {
    void workspace.saveCurrentDocument()
  })

  // 自动保存
  useEffect(() => {
    // 当文件是无法保存状态或用户无权编辑时，直接返回，不设置定时器。
    if (workspace.saveStatus !== 'dirty' || !workspace.currentDocument?.canEdit) {
      return
    }
    // 设置1.2s定时器执行自动保存
    const timer = window.setTimeout(() => {
      handleAutoSave()
    }, 1200)

    // 清理定时器，防止内存泄漏
    return () => {
      window.clearTimeout(timer)
    }
  }, [handleAutoSave, workspace.currentDocument?.canEdit, workspace.saveStatus])

  // 监听全局键盘事件，阻止浏览器保存默认行为
  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (!workspace.currentDocument?.canEdit) {
          return
        }

        event.preventDefault()
        void workspace.saveCurrentDocument({ createRevision: true })
      }
    }

    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [workspace.currentDocument?.canEdit, workspace.saveCurrentDocument])

  // 重置删除弹窗
  useEffect(() => {
    // 当用户切换围挡后当前文档变为 null 时，自动关闭删除弹窗并重置状态，防止弹窗悬空。
    if (!workspace.currentDocument) {
      setIsDeleteDialogOpen(false)
      setIsDeletingDocument(false)
    }
  }, [workspace.currentDocument])

  // 确认删除
  async function handleConfirmDelete() {
    setIsDeletingDocument(true)

    try {
      const deleted = await workspace.deleteSelectedDocument()

      if (deleted) {
        setIsDeleteDialogOpen(false)
      }
    } finally {
      setIsDeletingDocument(false)
    }
  }

  if (workspace.isBooting) {
    return (
      <main className="app-shell loading-shell">
        <section className="loading-card">
          <p className="eyebrow">工作区</p>
          <h1>正在准备编辑工作区</h1>
          <p>文档与权限数据正在从后端服务加载。</p>
        </section>
      </main>
    )
  }

  return (
    <>
      <main className="app-shell">
        <header className="hero-bar">
          <div>
            <p className="eyebrow">在线协作文档编辑器</p>
            <h1>多人文档工作台</h1>
          </div>
          <div className="hero-actions">
            <div className="hero-bar-note">
              <span className="status-dot" data-state={workspace.connectionStatus} />
              当前登录：<strong>{user.displayName}</strong>，{getSystemRoleLabel(user.systemRole)}
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void session.logoutCurrentUser()}
            >
              退出登录
            </button>
          </div>
        </header>

        {!workspace.currentDocument ? (
          <section className="loading-card workspace-empty-card">
            <p className="eyebrow">工作区</p>
            <h1>当前没有选中文档</h1>
            <p>
              {workspace.documents.length === 0
                ? '数据库里还没有你可访问的文档，先创建一篇开始吧。'
                : workspace.errorMessage || '请先从左侧文档列表中选择一篇文档。'}
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => void workspace.createNewDocument()}
            >
              创建第一篇文档
            </button>
          </section>
        ) : (
          <section className="workspace-grid">
            <DocumentSidebar
              documents={workspace.documents}
              isCreatingDocument={workspace.isCreatingDocument}
              isSearching={workspace.isSearching}
              onCreateDocument={() => void workspace.createNewDocument()}
              onSearchChange={workspace.setSearchValue}
              onSearchSubmit={() => void workspace.submitSearch()}
              onSelectDocument={(documentId) => void workspace.selectDocument(documentId)}
              searchValue={workspace.searchValue}
              selectedDocumentId={workspace.selectedDocumentId}
            />

            <DocumentEditor
              canDelete={workspace.currentDocument.canDelete}
              canEdit={workspace.currentDocument.canEdit}
              currentUser={user}
              document={workspace.currentDocument}
              onConnectionStatusChange={workspace.setRealtimeConnectionStatus}
              onContentChange={workspace.updateContent}
              onDelete={() => setIsDeleteDialogOpen(true)}
              onRealtimeSaved={workspace.markRealtimeSaved}
              onSave={() => void workspace.saveCurrentDocument({ createRevision: true })}
              onTitleChange={workspace.updateTitle}
              onVisibilityChange={workspace.updateVisibility}
              saveDisabled={
                !workspace.currentDocument.canEdit || workspace.saveStatus === 'saving'
              }
            />

            <PresencePanel
              canManageMembers={workspace.currentDocument.canManageMembers}
              connectionStatus={workspace.connectionStatus}
              currentUserRole={workspace.currentDocument.currentUserRole}
              documentId={workspace.currentDocument.id}
              errorMessage={workspace.errorMessage}
              isMutatingMembers={workspace.isMutatingMembers}
              lastSavedAt={workspace.lastSavedAt}
              members={workspace.currentDocument.members}
              onInviteMember={(payload) => workspace.inviteMember(payload)}
              onRemoveMember={(memberId) => workspace.removeMember(memberId)}
              onUpdateMemberRole={(memberId, role) =>
                workspace.updateMemberRole(memberId, role)
              }
              revisions={workspace.currentDocument.revisions}
              saveStatus={workspace.saveStatus}
            />
          </section>
        )}
      </main>

      {isDeleteDialogOpen && workspace.currentDocument ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!isDeletingDocument) {
              setIsDeleteDialogOpen(false)
            }
          }}
        >
          <section
            aria-labelledby="delete-dialog-title"
            aria-modal="true"
            className="modal-card"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">高危操作</p>
            <h2 id="delete-dialog-title">确认删除文档</h2>
            <p className="modal-copy">
              你将删除《{workspace.currentDocument.title}》。此操作不可撤销，相关成员权限和历史版本记录也会一并失效。
            </p>
            <div className="modal-actions">
              <button
                className="ghost-button"
                disabled={isDeletingDocument}
                type="button"
                onClick={() => setIsDeleteDialogOpen(false)}
              >
                取消
              </button>
              <button
                className="ghost-button danger-button"
                disabled={isDeletingDocument}
                type="button"
                onClick={() => void handleConfirmDelete()}
              >
                {isDeletingDocument ? '删除中…' : '确认删除'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}

export default App
