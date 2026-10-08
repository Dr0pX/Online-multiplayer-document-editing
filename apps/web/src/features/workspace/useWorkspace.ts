import { useEffect, useState } from 'react'
import {
  createDocument,
  deleteDocument,
  getDocumentById,
  removeDocumentMember,
  saveDocumentDraft,
  searchDocuments,
  updateDocumentMemberRole,
  upsertDocumentMember,
} from '../../services/api/documents'
import { isHttpClientError } from '../../services/http/errors'
import type { AuthUser } from '../../types/auth'
import type {
  ConnectionStatus,
  CreateDocumentPayload,
  DocumentMemberUpsertPayload,
  DocumentRecord,
  DocumentRole,
  DocumentSummary,
  SaveStatus,
} from '../../types/document'

interface SaveCurrentDocumentOptions {
  createRevision?: boolean
}

interface UpdateContentOptions {
  markDirty?: boolean
}

interface WorkspaceState {
  connectionStatus: ConnectionStatus
  createNewDocument: (payload?: Partial<CreateDocumentPayload>) => Promise<void>
  currentDocument: DocumentRecord | null
  deleteSelectedDocument: () => Promise<boolean>
  documents: DocumentSummary[]
  errorMessage: string
  inviteMember: (payload: DocumentMemberUpsertPayload) => Promise<void>
  isBooting: boolean
  isCreatingDocument: boolean
  isMutatingMembers: boolean
  isSearching: boolean
  lastSavedAt: string | null
  markRealtimeSaved: (savedAt?: string) => void
  removeMember: (memberId: number) => Promise<void>
  saveCurrentDocument: (options?: SaveCurrentDocumentOptions) => Promise<void>
  saveStatus: SaveStatus
  searchValue: string
  selectedDocumentId: string
  selectDocument: (documentId: string) => Promise<void>
  setRealtimeConnectionStatus: (status: ConnectionStatus) => void
  setSearchValue: (value: string) => void
  submitSearch: () => Promise<void>
  updateContent: (content: string, options?: UpdateContentOptions) => void
  updateMemberRole: (memberId: number, role: DocumentRole) => Promise<void>
  updateTitle: (title: string) => void
  updateVisibility: (visibility: DocumentRecord['visibility']) => void
}

// 新建文档默认值
const DEFAULT_NEW_DOCUMENT: CreateDocumentPayload = {
  content: '<h1>Untitled document</h1><p>Start writing here.</p>',
  title: 'Untitled document',
  visibility: 'private',
}

// 在已加载的全部文档中按标题/摘要模糊匹配。
function filterDocumentsByKeyword(
  documents: DocumentSummary[],
  keyword: string,
) {
  const normalizedKeyword = keyword.trim().toLowerCase()

  if (!normalizedKeyword) {
    return documents
  }

  return documents.filter((document) => {
    return (
      document.title.toLowerCase().includes(normalizedKeyword) ||
      document.excerpt.toLowerCase().includes(normalizedKeyword)
    )
  })
}

// 返回列表需要的字段
function mapRecordToSummary(document: DocumentRecord): DocumentSummary {
  return {
    canDelete: document.canDelete,
    canEdit: document.canEdit,
    canManageMembers: document.canManageMembers,
    currentUserRole: document.currentUserRole,
    excerpt: document.excerpt,
    id: document.id,
    ownerId: document.ownerId,
    ownerName: document.ownerName,
    title: document.title,
    updatedAt: document.updatedAt,
    visibility: document.visibility,
  }
}

// 判断“脏”状态是否应该保留：保存中或已脏但未保存时不应覆盖
function shouldPreserveDirtyState(status: SaveStatus) {
  return status === 'dirty' || status === 'saving'
}

export function useWorkspace(
  user: AuthUser,
  onUnauthorized: () => void,
): WorkspaceState {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('online')  // WebSocket 连接状态
  const [allDocuments, setAllDocuments] = useState<DocumentSummary[]>([]) // 全部文档列表
  const [documents, setDocuments] = useState<DocumentSummary[]>([]) // 当前显示的文档列表（受过滤搜索影响）
  const [selectedDocumentId, setSelectedDocumentId] = useState('')  // 当前选中的文档 id
  const [currentDocument, setCurrentDocument] = useState<DocumentRecord | null>(null) // 当前文档完整数据
  const [searchValue, setSearchValue] = useState('')  // 搜索框实时输入
  const [appliedSearchValue, setAppliedSearchValue] = useState('')  // 已提交搜索的关键词
  const [isSearching, setIsSearching] = useState(false) // 搜索加载中
  const [isCreatingDocument, setIsCreatingDocument] = useState(false) // 创建文档中
  const [isMutatingMembers, setIsMutatingMembers] = useState(false) // 成员操作中
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')  // 保存状态机
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null) // 上次保存时间戳
  const [errorMessage, setErrorMessage] = useState('')  // 错误消息
  const [isBooting, setIsBooting] = useState(true)  // 初始加载标志

  // 统一处理所有 API 的错误
  function handleRequestError(error: unknown, fallbackMessage: string) {
    if (isHttpClientError(error) && error.statusCode === 401) {
      onUnauthorized()  // 统一踢出登录
    }

    setErrorMessage(error instanceof Error ? error.message : fallbackMessage) // 保存错误信息
    setConnectionStatus('offline')  // 连接状态更新
  }
  // 主要逻辑，监听用户变化
  useEffect(() => {
    let active = true // 防止竞态条件

    async function bootstrap() {
      try {
        setErrorMessage('')
        const initialDocuments = await searchDocuments('')  // 查看全部文档
        // 每一个费时异步操作均检查是否组件已被卸载
        if (!active) {  
          return
        }
        // 初始不过滤
        setAllDocuments(initialDocuments)
        setDocuments(initialDocuments)
        // 特殊处理无文档情况
        if (initialDocuments.length === 0) {
          setCurrentDocument(null)
          setSelectedDocumentId('')
          setSaveStatus('idle')
          return
        }
        // 获取文档用于中间展示
        const firstDocument = await getDocumentById(initialDocuments[0].id)

        if (!active) {
          return
        }
        // 初始化状态
        setSelectedDocumentId(firstDocument.id)
        setCurrentDocument(firstDocument)
        setLastSavedAt(firstDocument.updatedAt)
        setSaveStatus('saved')
        setConnectionStatus('online')
      } catch (error) {
        if (!active) {
          return
        }

        handleRequestError(error, 'Failed to initialize workspace.')
      } finally {
        if (active) {
          setIsBooting(false) // 启动完成
        }
      }
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [user.id])
  // 搜索关键词变化
  async function submitSearch() {
    if (isSearching) {  // 搜索防抖
      return
    }

    try {
      const keyword = searchValue.trim()

      setIsSearching(true)  // 设置防抖
      setErrorMessage('')

      const results = await searchDocuments(keyword)  // 筛选文档

      setAppliedSearchValue(keyword)  // 请求文档内容
      setDocuments(results)
      setConnectionStatus('online')
    } catch (error) {
      handleRequestError(error, 'Search request failed.')
    } finally {
      setIsSearching(false) // 解除占用
    }
  }
  // 主动选择文档换位逻辑
  async function selectDocument(documentId: string) {
    try {
      setConnectionStatus('syncing')
      setErrorMessage('')

      const document = await getDocumentById(documentId)

      setSelectedDocumentId(documentId)
      setCurrentDocument(document)
      setLastSavedAt(document.updatedAt)
      setSaveStatus('saved')
      setConnectionStatus('online')
    } catch (error) {
      handleRequestError(error, 'Failed to switch document.')
    }
  }
  // 更新逻辑
  function updateTitle(title: string) {
    setCurrentDocument((previous) =>
      previous
        ? {
            ...previous,
            title,
          }
        : previous,
    )
    setSaveStatus('dirty')
  }

  function updateVisibility(visibility: DocumentRecord['visibility']) {
    setCurrentDocument((previous) =>
      previous
        ? {
            ...previous,
            visibility,
          }
        : previous,
    )
    setSaveStatus('dirty')
  }

  function updateContent(content: string, options: UpdateContentOptions = {}) {
    setCurrentDocument((previous) =>
      previous
        ? {
            ...previous,
            content,
          }
        : previous,
    )

    if (options.markDirty) {
      setSaveStatus('dirty')
    }
  }

  function setRealtimeConnectionStatus(status: ConnectionStatus) {
    setConnectionStatus(status)
  }

  function markRealtimeSaved(savedAt = new Date().toISOString()) {
    setConnectionStatus('online')
    setLastSavedAt(savedAt)
    setSaveStatus((previous) =>
      shouldPreserveDirtyState(previous) ? previous : 'saved',
    )
  }
  // 整合保存当前文档逻辑
  async function saveCurrentDocument(options: SaveCurrentDocumentOptions = {}) {
    if (!currentDocument) {
      return
    }

    try {
      setSaveStatus('saving')
      setConnectionStatus('syncing')
      setErrorMessage('')

      const savedDocument = await saveDocumentDraft({
        content: currentDocument.content,
        createRevision: options.createRevision, // 自动保存不触发保存快照逻辑，手动保存触发创建版本快照
        id: currentDocument.id,
        title: currentDocument.title,
        visibility: currentDocument.visibility,
      })

      const savedSummary = mapRecordToSummary(savedDocument)
      const nextAllDocuments = allDocuments.map((item) =>
        item.id === savedSummary.id ? savedSummary : item,
      )
      // 成功后更新状态
      setCurrentDocument(savedDocument)
      setLastSavedAt(savedDocument.updatedAt)
      setSaveStatus('saved')
      setConnectionStatus('online')
      setAllDocuments(nextAllDocuments)
      setDocuments(filterDocumentsByKeyword(nextAllDocuments, appliedSearchValue))
    } catch (error) {
      setSaveStatus('dirty')
      handleRequestError(error, 'Failed to save document.')
    }
  }
  // 创新新文档逻辑
  async function createNewDocument(payload: Partial<CreateDocumentPayload> = {}) {
    try {
      setIsCreatingDocument(true)
      setConnectionStatus('syncing')
      setErrorMessage('')

      const createdDocument = await createDocument({
        ...DEFAULT_NEW_DOCUMENT,
        ...payload,
      })

      const createdSummary = mapRecordToSummary(createdDocument)
      const nextAllDocuments = [createdSummary, ...allDocuments]

      setAllDocuments(nextAllDocuments)
      setDocuments(filterDocumentsByKeyword(nextAllDocuments, appliedSearchValue))
      setSelectedDocumentId(createdDocument.id)
      setCurrentDocument(createdDocument)
      setLastSavedAt(createdDocument.updatedAt)
      setSaveStatus('saved')
      setConnectionStatus('online')
    } catch (error) {
      handleRequestError(error, 'Failed to create document.')
    } finally {
      setIsCreatingDocument(false)
    }
  }
  // 删除文档逻辑
  async function deleteSelectedDocument() {
    if (!currentDocument) {
      return false
    }

    try {
      setConnectionStatus('syncing')
      setErrorMessage('')

      const deletedDocumentId = currentDocument.id

      await deleteDocument(deletedDocumentId)

      const nextAllDocuments = allDocuments.filter(
        (document) => document.id !== deletedDocumentId,
      )
      const nextDocuments = filterDocumentsByKeyword(
        nextAllDocuments,
        appliedSearchValue,
      )

      setAllDocuments(nextAllDocuments)
      setDocuments(nextDocuments)

      if (nextAllDocuments.length === 0) {
        setCurrentDocument(null)
        setSelectedDocumentId('')
        setLastSavedAt(null)
        setSaveStatus('idle')
        setConnectionStatus('online')
        return true
      }

      const fallbackDocument =
        nextDocuments.find((document) => document.id !== deletedDocumentId) ??
        nextAllDocuments[0]

      const freshDocument = await getDocumentById(fallbackDocument.id)

      setCurrentDocument(freshDocument)
      setSelectedDocumentId(freshDocument.id)
      setLastSavedAt(freshDocument.updatedAt)
      setSaveStatus('saved')
      setConnectionStatus('online')
      return true
    } catch (error) {
      handleRequestError(error, 'Failed to delete document.')
      return false
    }
  }
  // 初始化成员
  async function inviteMember(payload: DocumentMemberUpsertPayload) {
    if (!currentDocument) {
      return
    }

    try {
      setIsMutatingMembers(true)
      setConnectionStatus('syncing')
      setErrorMessage('')

      const members = await upsertDocumentMember(currentDocument.id, payload)

      setCurrentDocument((previous) =>
        previous
          ? {
              ...previous,
              members,
            }
          : previous,
      )
      setConnectionStatus('online')
    } catch (error) {
      handleRequestError(error, 'Failed to update document members.')
    } finally {
      setIsMutatingMembers(false)
    }
  }
  // 更新成员权限
  async function updateMemberRole(memberId: number, role: DocumentRole) {
    if (!currentDocument) {
      return
    }

    try {
      setIsMutatingMembers(true)
      setConnectionStatus('syncing')
      setErrorMessage('')

      const members = await updateDocumentMemberRole(currentDocument.id, memberId, role)

      setCurrentDocument((previous) =>
        previous
          ? {
              ...previous,
              members,
            }
          : previous,
      )
      setConnectionStatus('online')
    } catch (error) {
      handleRequestError(error, 'Failed to change the member role.')
    } finally {
      setIsMutatingMembers(false)
    }
  }
  // 移除成员
  async function removeMember(memberId: number) {
    if (!currentDocument) {
      return
    }

    try {
      setIsMutatingMembers(true)
      setConnectionStatus('syncing')
      setErrorMessage('')

      await removeDocumentMember(currentDocument.id, memberId)

      setCurrentDocument((previous) =>
        previous
          ? {
              ...previous,
              members: previous.members.filter((member) => member.id !== memberId),
            }
          : previous,
      )
      setConnectionStatus('online')
    } catch (error) {
      handleRequestError(error, 'Failed to remove the member.')
    } finally {
      setIsMutatingMembers(false)
    }
  }

  return {
    connectionStatus,
    createNewDocument,
    currentDocument,
    deleteSelectedDocument,
    documents,
    errorMessage,
    inviteMember,
    isBooting,
    isCreatingDocument,
    isMutatingMembers,
    isSearching,
    lastSavedAt,
    markRealtimeSaved,
    removeMember,
    saveCurrentDocument,
    saveStatus,
    searchValue,
    selectedDocumentId,
    selectDocument,
    setRealtimeConnectionStatus,
    setSearchValue,
    submitSearch,
    updateContent,
    updateMemberRole,
    updateTitle,
    updateVisibility,
  }
}
