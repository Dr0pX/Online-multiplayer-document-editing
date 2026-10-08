import {
  HocuspocusProvider,
  WebSocketStatus,
} from '@hocuspocus/provider'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type { Editor } from '@tiptap/react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import * as Y from 'yjs'
import {
  BlockNodeIdExtension,
  getActiveBlockIdFromSelection,
} from '../collaboration/blockNodeId'
import { webApiConfig } from '../config/api'
import { getRealtimeAccessToken } from '../services/auth/realtime'
import type { AuthUser } from '../types/auth'
import type { ConnectionStatus, DocumentRecord } from '../types/document'
import { EditorToolbar, type ToolbarCommand } from './EditorToolbar'

interface DocumentEditorProps {
  canDelete: boolean
  canEdit: boolean
  currentUser: AuthUser
  document: DocumentRecord
  onConnectionStatusChange: (status: ConnectionStatus) => void
  onContentChange: (content: string) => void
  onDelete: () => void
  onRealtimeSaved: (savedAt?: string) => void
  onSave: () => void
  onTitleChange: (title: string) => void
  onVisibilityChange: (visibility: DocumentRecord['visibility']) => void
  saveDisabled: boolean
}

interface CollaborationResources {
  provider: HocuspocusProvider
  ydoc: Y.Doc
}

interface CollaboratorProfile {
  color: string
  displayName: string
  id: number
}

interface LiveCollaborator extends CollaboratorProfile {
  activeBlockId: string | null
  clientId: number
  isCurrentUser: boolean
}

interface PresenceBadge {
  blockId: string
  color: string
  label: string
  top: number
}

interface CollaborativeCanvasProps {
  canEdit: boolean
  collaboration: CollaborationResources
  collaboratorProfile: CollaboratorProfile
  onContentChange: (content: string) => void
  onEditorReady: (editor: Editor | null) => void
}

const COLLABORATOR_COLORS = [
  '#c5562e',
  '#23867d',
  '#6f57c9',
  '#b06a16',
  '#2c6fc7',
  '#a83a62',
] as const

function getRoleLabel(role: DocumentRecord['currentUserRole']) {
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

function mapWebSocketStatus(status: WebSocketStatus): ConnectionStatus {
  switch (status) {
    case WebSocketStatus.Connected:
      return 'online'
    case WebSocketStatus.Connecting:
      return 'syncing'
    case WebSocketStatus.Disconnected:
      return 'offline'
    default:
      return 'offline'
  }
}

function createCollaboratorProfile(user: AuthUser): CollaboratorProfile {
  return {
    color: COLLABORATOR_COLORS[user.id % COLLABORATOR_COLORS.length],
    displayName: user.displayName,
    id: user.id,
  }
}

function buildBadgeLabel(users: LiveCollaborator[]) {
  const names = users.map((user) => user.displayName)

  if (names.length === 1) {
    return `${names[0]} 正在编辑`
  }

  if (names.length === 2) {
    return `${names[0]}、${names[1]} 正在编辑`
  }

  return `${names[0]}、${names[1]} 等 ${names.length} 人正在编辑`
}
// 浅对比两个badge数组，如果徽章位置没变化就不触发渲染
function arePresenceBadgesEqual(
  previous: PresenceBadge[],
  next: PresenceBadge[],
) {
  if (previous.length !== next.length) {
    return false
  }

  return previous.every((badge, index) => {
    const nextBadge = next[index]

    return (
      badge.blockId === nextBadge.blockId &&
      badge.color === nextBadge.color &&
      badge.label === nextBadge.label &&
      badge.top === nextBadge.top
    )
  })
}
// 渲染协作者光标
function createCursor(user: Record<string, unknown>) {
  const color = typeof user.color === 'string' ? user.color : '#c5562e'
  const name =
    typeof user.displayName === 'string' ? user.displayName : '协作者'
  const cursor = document.createElement('span')
  cursor.classList.add('collaboration-caret')
  cursor.style.borderColor = color

  const label = document.createElement('span')
  label.classList.add('collaboration-caret-label')
  label.style.backgroundColor = color
  label.textContent = name

  cursor.append(label)

  return cursor
}
// 工具栏命令执行
function runCommand(editor: Editor, command: ToolbarCommand) {
  const chain = editor.chain().focus()

  switch (command) {
    case 'bold':
      chain.toggleBold().run()
      return
    case 'italic':
      chain.toggleItalic().run()
      return
    case 'insertUnorderedList':
      chain.toggleBulletList().run()
      return
    case 'insertOrderedList':
      chain.toggleOrderedList().run()
      return
    case 'blockquote':
      chain.toggleBlockquote().run()
      return
    case 'h2':
      chain.toggleHeading({ level: 2 }).run()
      return
    case 'paragraph':
      chain.setParagraph().run()
      return
    default:
      return
  }
}
// 核心子组件，封装了 TipTAP + Yjs + Awareness 的集成
function CollaborativeCanvas({
  canEdit,
  collaboration,
  collaboratorProfile,
  onContentChange,
  onEditorReady,
}: CollaborativeCanvasProps) {
  const reportContentChange = useEffectEvent((content: string) => {
    onContentChange(content)
  })

  const editor = useEditor(
    {
      editable: canEdit,
      extensions: [
        StarterKit.configure({ undoRedo: false }),  // 粗体/斜体/标题/列表/引用（关闭内置撤销）
        BlockNodeIdExtension, // 每个段落自动加上 blockId
        Collaboration.configure({ // 绑定yjs
          document: collaboration.ydoc,
          field: 'default',
        }),
        CollaborationCaret.configure({  // 其他人光标
          provider: collaboration.provider,
          render: createCursor,
          selectionRender: (user) => {
            const color =
              typeof user.color === 'string' ? user.color : '#c5562e'

            return {
              class: 'collaboration-selection',
              style: `background-color: ${color}22`,
            }
          },
          user: collaboratorProfile,
        }),
      ],
      immediatelyRender: false, // 等初始化完成再渲染，避免闪烁
      // 编辑器生命周期回调
      onBlur({ editor }) {  // 光标离开编辑器——清除自己的 activeBlockId
        collaboration.provider.setAwarenessField('activeBlockId', null)
        reportContentChange(editor.getHTML())
      },
      onCreate({ editor }) {  // 编辑器创建完毕——上报自己的身份和当前段落
        const activeBlockId = getActiveBlockIdFromSelection(editor.state.selection)
        collaboration.provider.setAwarenessField('activeBlockId', activeBlockId)
        collaboration.provider.setAwarenessField('user', collaboratorProfile)
        reportContentChange(editor.getHTML())
      },
      onSelectionUpdate({ editor }) { // 光标移动——更新“我正在编辑哪个段落”
        const activeBlockId = getActiveBlockIdFromSelection(editor.state.selection)
        collaboration.provider.setAwarenessField('activeBlockId', activeBlockId)
      },
      onUpdate({ editor }) {  // 内容变化——更新段落+上报HTML
        const activeBlockId = getActiveBlockIdFromSelection(editor.state.selection)
        collaboration.provider.setAwarenessField('activeBlockId', activeBlockId)
        reportContentChange(editor.getHTML())
      },
    },
    [collaboration, collaboratorProfile, canEdit],
  )

  useEffect(() => {
    if (!editor) {
      return
    }

    editor.setEditable(canEdit)
  }, [editor, canEdit])

  useEffect(() => {
    collaboration.provider.setAwarenessField('user', collaboratorProfile)
  }, [collaboration, collaboratorProfile])

  useEffect(() => {
    onEditorReady(editor)

    return () => {
      onEditorReady(null)
    }
  }, [editor, onEditorReady])

  return <EditorContent className="editor-canvas" editor={editor} />
}
// DocumentEditor 主组件
export function DocumentEditor({
  canDelete,
  canEdit,
  currentUser,
  document,
  onConnectionStatusChange,
  onContentChange,
  onDelete,
  onRealtimeSaved,
  onSave,
  onTitleChange,
  onVisibilityChange,
  saveDisabled,
}: DocumentEditorProps) {
  const [collaboration, setCollaboration] = useState<CollaborationResources | null>(null) // 当前文档的 provider + ydoc，null 表示未初始化
  const [collaborationError, setCollaborationError] = useState('')  // WebSocket 鉴权失败 / 权限不足时的错误消息
  const [isRealtimeSynced, setIsRealtimeSynced] = useState(false) // Yjs 文档是否已完成首次同步，同步完成前显示 loading
  const [liveCollaborators, setLiveCollaborators] = useState<LiveCollaborator[]>([])  // 从awareness 解析出的所有在线协作者列表
  const [presenceBadges, setPresenceBadges] = useState<PresenceBadge[]>([]) // 渲染编辑器左侧的段落级 Presence 标记
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null) // TipTap 编辑器实例引用，用于工具栏命令执行
  const viewportRef = useRef<HTMLDivElement | null>(null) // 编辑器视口 DOM 引用，用于计算 Presence 标记的绝对位置
  const collaboratorProfile = useMemo(  // useMemo：只有 currentUser 真正变化时才重新计算颜色/profile
    () => createCollaboratorProfile(currentUser), 
    [currentUser],
  )
  const reportConnectionStatus = useEffectEvent((status: ConnectionStatus) => { // 两个 useEffectEvent：引用稳定，回调始终最新
    onConnectionStatusChange(status)
  })
  const reportRealtimeSaved = useEffectEvent((savedAt?: string) => { 
    onRealtimeSaved(savedAt)
  })
  // 实时管理协作连接的生命周期
/*
生命周期完整流程：
1. document.id 变化 —— 销毁旧 provider + ydoc
2. 创建新 provider —— 发起 WebSocket 连接
3. token（）被调用 —— 获取 access token —— 发送给 collab 服务器
4. 服务器调用 onAuthenticate —— 验证 token —— 验证文档权限
5. 服务器调用 onLoadDocument —— 从数据库加载 Yjs state
6. provider 接受服务端 state —— onSynced 触发
7. isRealtimeSynced = true —— 编辑器渲染
8. 用户编辑 —— Yjs 产生更新 —— provider 通过 WebSocket 发送 —— collab onStoreDocument 持久化
*/ 
  useEffect(() => {
    setIsRealtimeSynced(false)  // 重置同步状态

    const ydoc = new Y.Doc()  // 为当前文档创建新的 Yjs 文档
    const provider = new HocuspocusProvider({ 
      document: ydoc, 
      name: document.id,  // 文档 ID 对应 collab 服务器的 documentName 
      url: webApiConfig.collabWebSocketUrl, // ws://localhost:3002
      onAuthenticationFailed({ reason }) {  
        setCollaborationError(reason || '实时协作鉴权失败，请重新登录。') // 鉴权失败（token无效/过期，或权限不足）
        reportConnectionStatus('offline')
      },
      onStatus({ status }) { 
        if (status !== WebSocketStatus.Disconnected) {  // WebSocket 连接状态变化
          setCollaborationError('') // 重连成功——清除错误提示
        }

        reportConnectionStatus(mapWebSocketStatus(status))
      },
      onSynced({ state }) { 
        if (state) {  // 首次同步完成（state 参数表示是否有服务端数据）
          setIsRealtimeSynced(true) // 标记同步完成——触发渲染 CollaborativeCanvas
          reportRealtimeSaved()
        }
      },
      onUnsyncedChanges({ number }) {
        if (number > 0) { // 有未同步的本地变更
          reportConnectionStatus('syncing')
          return
        }

        reportRealtimeSaved()
      },
      token: () => getRealtimeAccessToken(),  // 每次连接/重连时调用，获取最新的 access token
    })

    setCollaboration({
      provider,
      ydoc,
    })

    return () => {  // 清理函数
      provider.destroy()
      ydoc.destroy()
      setCollaboration(null)
      setIsRealtimeSynced(false)
      setEditorInstance(null)
      setLiveCollaborators([])
      setPresenceBadges([])
    }
  }, [document.id]) // 当用户切换文档时，旧连接销毁，新连接创建
  // 协作者监听
/**
 * Awareness 协议解释：
 * - Yjs awareness 是一个基于 WebSocket 的 key-value 状态广播系统
 * - 每个客户端通过 setAwarenessField（key， value）设置自己的状态字段
 * - 这些状态自动广播给同一文档的所有连接
 * - awareness.getStates() 返回 Map<clientId, state> —— 所有客户端的最新状态
 */
  useEffect(() => { 
    const awareness = collaboration?.provider.awareness

    if (!awareness) {
      return
    }

    const activeAwareness = awareness

    function syncCollaborators() {
      const nextCollaborators = Array.from(activeAwareness.getStates().entries())
        .map(([clientId, state]) => {
          const userState = state.user as Partial<CollaboratorProfile> | undefined
          // 只处理有完整 profile 的state （过滤掉系统字段和不完整的数据）
          if (
            !userState ||
            typeof userState.displayName !== 'string' ||
            typeof userState.color !== 'string' ||
            typeof userState.id !== 'number'
          ) {
            return null
          }

          return {
            activeBlockId:
              typeof state.activeBlockId === 'string' ? state.activeBlockId : null,
            clientId,
            color: userState.color,
            displayName: userState.displayName,
            id: userState.id,
            isCurrentUser: clientId === activeAwareness.clientID,
          } satisfies LiveCollaborator
        })
        .filter((user): user is LiveCollaborator => user !== null)

      setLiveCollaborators(nextCollaborators)
    }

    activeAwareness.on('change', syncCollaborators)
    syncCollaborators() // 初始化时立即同步一次

    return () => {
      activeAwareness.off('change', syncCollaborators)
    }
  }, [collaboration])
  // 计算每个段落旁边 Presence 标记的像素位置
  const measurePresenceBadges = useEffectEvent(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      setPresenceBadges([])
      return
    }
    // 第一步： 按 blockId 分组协作者
    const collaboratorsByBlock = new Map<string, LiveCollaborator[]>()

    liveCollaborators.forEach((collaborator) => {
      if (!collaborator.activeBlockId || collaborator.isCurrentUser) {  // 排除没有活跃的段落/当前用户自己的
        return
      }

      const users = collaboratorsByBlock.get(collaborator.activeBlockId) ?? []
      users.push(collaborator)
      collaboratorsByBlock.set(collaborator.activeBlockId, users)
    })

    const viewportRect = viewport.getBoundingClientRect()
    const nextBadges = Array.from(collaboratorsByBlock.entries())
      .map(([blockId, users]) => {
        const blockElement = viewport.querySelector<HTMLElement>( // 第二步： 在视口中查找对应的 blockId 的 DOM 元素
          `[data-block-id="${blockId}"]`,
        )

        if (!blockElement) {
          return null
        }
        // 第三步：计算相对于视口顶部的绝对位置
        const blockRect = blockElement.getBoundingClientRect()

        return {
          blockId,
          color: users[0].color,
          label: buildBadgeLabel(users),
          top: blockRect.top - viewportRect.top + viewport.scrollTop - 12,
        } satisfies PresenceBadge
      })
      .filter((badge): badge is PresenceBadge => badge !== null)
      // 第四步：使用浅比较避免不必要的 state 更新
    setPresenceBadges((previous) =>
      arePresenceBadgesEqual(previous, nextBadges) ? previous : nextBadges,
    )
  })
  // 当协作者或编辑器变化时重新测量
  useEffect(() => {
    measurePresenceBadges()
  }, [liveCollaborators, editorInstance])
  // 监听滚动和窗口大小变化
  useEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    function handleViewportChange() {
      window.requestAnimationFrame(() => {  // rAF 避免在滚动中频繁测量
        measurePresenceBadges()
      })
    }

    viewport.addEventListener('scroll', handleViewportChange) // TipTap 编辑器内容更新事件 
    window.addEventListener('resize', handleViewportChange) // 光标移动事件

    return () => {
      viewport.removeEventListener('scroll', handleViewportChange)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [measurePresenceBadges])

  useEffect(() => { // 工具栏命令处理
    if (!editorInstance) {  // 无编辑器实例或无权限——忽略
      return
    }

    function scheduleMeasure() {
      window.requestAnimationFrame(() => {
        measurePresenceBadges()
      })
    }

    editorInstance.on('update', scheduleMeasure)
    editorInstance.on('selectionUpdate', scheduleMeasure)

    return () => {
      editorInstance.off('update', scheduleMeasure)
      editorInstance.off('selectionUpdate', scheduleMeasure)
    }
  }, [editorInstance, measurePresenceBadges])

  function handleCommand(command: ToolbarCommand) {
    if (!editorInstance || !canEdit) {
      return
    }

    runCommand(editorInstance, command)
  }

  const onlineCollaboratorCount = liveCollaborators.length

  return (
    <section className="editor-shell">
      <div className="editor-header">
        <input
          className="document-title-input"
          disabled={!canEdit}
          type="text"
          value={document.title}  // 受控组件
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <div className="editor-meta-row">
          <p className="editor-subtitle">
            当前角色：<strong>{getRoleLabel(document.currentUserRole)}</strong> ·
            文档所有者：<strong>{document.ownerName}</strong>
          </p>
          <label className="visibility-select">
            <span>可见性</span>
            <select
              disabled={!canEdit}
              value={document.visibility}
              onChange={(event) =>
                onVisibilityChange(event.target.value as DocumentRecord['visibility'])
              }
            >
              <option value="private">私有</option>
              <option value="shared">共享</option>
            </select>
          </label>
        </div>
        <div className="editor-collab-summary">
          <span className="editor-collab-pill">
            在线协作者 {onlineCollaboratorCount} 人
          </span>
          <span className="editor-collab-copy">
            内容会实时同步到数据库，点击“保存版本”或按 `Ctrl+S` 才会生成历史版本。
          </span>
        </div>
      </div>

      <EditorToolbar
        canDelete={canDelete}
        canEdit={canEdit}
        onCommand={handleCommand}
        onDelete={onDelete}
        onSave={onSave}
        saveDisabled={saveDisabled}
      />

      {collaborationError ? (
        <div className="error-card editor-error-card">
          <p>{collaborationError}</p>
        </div>
      ) : null}

      <div
        ref={viewportRef}
        className={`editor-viewport${canEdit ? '' : ' read-only'}`}
      >
        {collaboration ? (
          isRealtimeSynced ? (
            <CollaborativeCanvas
              canEdit={canEdit}
              collaboration={collaboration}
              collaboratorProfile={collaboratorProfile}
              onContentChange={onContentChange}
              onEditorReady={setEditorInstance}
            />
          ) : (
            <div className="editor-loading">正在同步协作文档…</div>
          )
        ) : (
          <div className="editor-loading">正在连接实时协作服务…</div>
        )}

        <div className="block-presence-layer" aria-hidden="true">
          {presenceBadges.map((badge) => (
            <div
              key={badge.blockId}
              className="block-presence-badge"
              style={
                {
                  '--badge-color': badge.color,
                  top: `${badge.top}px`,
                } as CSSProperties
              }
            >
              {badge.label}
            </div>
          ))}
        </div>
      </div>

      {!canEdit ? (
        <p className="editor-readonly-hint">
          你当前对这篇文档只有只读权限，可以查看实时内容和协作状态，但不能修改正文。
        </p>
      ) : null}

      {!canDelete ? (
        <p className="editor-readonly-hint">
          只有文档管理员可以删除文档或调整成员权限。
        </p>
      ) : null}
    </section>
  )
}
