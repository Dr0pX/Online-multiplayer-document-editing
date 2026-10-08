import { Router } from 'express'
import { getAuthenticatedRequest } from '../middleware/auth.js'
import {
  compareDocumentRevisions,
  createDocument,
  deleteDocumentById,
  findDocumentById,
  listDocumentMembers,
  listDocumentRevisions,
  listDocuments,
  removeDocumentMember,
  updateDocumentById,
  updateDocumentMemberRole,
  upsertDocumentMember,
} from '../repositories/documents.js'
import {
  validateDraftPayload,
  validateMemberRolePayload,
  validateMemberUpsertPayload,
} from '../utils/documents.js'
import { HttpError } from '../utils/http.js'

export const documentsRouter = Router()

function parseRevisionCompareTarget(value: unknown, fieldName: 'from' | 'to') {
  if (value === 'current') {
    return 'current' as const
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `Query parameter "${fieldName}" is required.`)
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(
      400,
      `Query parameter "${fieldName}" must be a positive revision number or "current".`,
    )
  }

  return parsed
}
//  每个用户只能看到自己有权限访问的文档。这不是在路由层做的——而是在 SQL 查询中直接过滤。
documentsRouter.get('/', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const keyword =
      typeof request.query.q === 'string' ? request.query.q : undefined

    const documents = await listDocuments(authenticatedRequest.authUser, keyword)
    response.json(documents)
  } catch (error) {
    next(error)
  }
})
/*
createDocument 的内部事务操作（repository 层）：
  BEGIN TRANSACTION
    1. INSERT INTO documents (id, title, content, excerpt, owner_id, visibility)
    2. INSERT INTO document_members (document_id, user_id, role='admin')
    3. INSERT INTO document_collab_states (document_id, yjs_state)
    4. INSERT INTO document_revisions (v1 snapshot)
    5. INSERT INTO audit_logs (action='document_created')
  COMMIT
  这是一个要么全成功、要么全失败的原子操作。如果第 3 步失败，前两步自动回滚。

  为什么创建时就写入 document_collab_states？ 这样文档从创建之初就能被实时协作服务加载，无需额外的懒初始化逻辑。
*/
documentsRouter.post('/', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const payload = validateDraftPayload(request.body)
    const document = await createDocument(authenticatedRequest.authUser, payload)

    response.status(201).json(document)
  } catch (error) {
    next(error)
  }
})
/*
安全细节——统一 404：

  findDocumentById 内部先调用 findDocumentAccessContext：
  1. 先查 documents 表——如果 deleted_at IS NOT NULL 或 ID 不存在 → 返回 null
  2. LEFT JOIN document_members 拿到角色
  3. 通过 resolveDocumentAccess() 计算权限
  4. 如果 canView === false → 抛 403。但上层的路由直接返回 404。

  这样做的效果： 攻击者发 GET /api/documents/guess-the-id，无论这个 ID 的文档是否存在、自己有没有权限，都返回 404。无法通过状态码区分"文档不存在"和"无权访问"。
*/
documentsRouter.get('/:id', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const document = await findDocumentById(
      authenticatedRequest.authUser,
      request.params.id,
    )

    if (!document) {
      throw new HttpError(404, 'Document not found.')
    }

    response.json(document)
  } catch (error) {
    next(error)
  }
})
/*
为什么用 PATCH 而非 PUT？
  - PATCH：部分更新资源。这里虽然传了全部字段，但语义上是对文档的增量修改。
  - PUT：完全替换资源。如果 PUT 要求客户端发送完整的文档对象，缺失的字段会被置空。

  createRevision 参数的关键作用：
  - 自动保存（1.2 秒防抖触发）→ createRevision: false → 只更新 documents 表，不创建版本快照
  - 手动保存（Ctrl+S 或点击"保存版本"按钮）→ createRevision: true → 额外插入 document_revisions

  这实现了内容自动持久化与版本显式创建的分离——用户不会看到几百个无意义的自动保存版本。
*/
documentsRouter.patch('/:id', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const payload = validateDraftPayload(request.body)
    const document = await updateDocumentById(
      authenticatedRequest.authUser,
      request.params.id,
      payload,
    )

    if (!document) {
      throw new HttpError(404, 'Document not found.')
    }

    response.json(document)
  } catch (error) {
    next(error)
  }
})
/*
 deleteDocumentById 的实际操作（repository 层）：

  UPDATE documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL

  这是软删除（Soft Delete），不是真正的 DELETE：
  1. 数据仍在数据库中，可用于审计和数据恢复
  2. deleted_at IS NOT NULL 的文档在所有查询中自动被过滤（WHERE 条件中包含此检查）
  3. 外键关系保留——document_members、document_revisions、document_collab_states 不受影响

  删除后还有一步关键操作： 调用 notifyCollabToReconnectDocument(documentId) → 向 collab 服务发 POST /internal/documents/:id/reconnect → collab 断开所有该文档的 WebSocket 连接 →
  其他正在编辑的用户被踢出。
*/
documentsRouter.delete('/:id', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const didDelete = await deleteDocumentById(
      authenticatedRequest.authUser,
      request.params.id,
    )

    if (!didDelete) {
      throw new HttpError(404, 'Document not found.')
    }

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

documentsRouter.get('/:id/members', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const members = await listDocumentMembers(
      authenticatedRequest.authUser,
      request.params.id,
    )

    if (!members) {
      throw new HttpError(404, 'Document not found.')
    }

    response.json(members)
  } catch (error) {
    next(error)
  }
})

documentsRouter.post('/:id/members', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const payload = validateMemberUpsertPayload(request.body)
    const members = await upsertDocumentMember(
      authenticatedRequest.authUser,
      request.params.id,
      payload,
    )

    if (!members) {
      throw new HttpError(404, 'Document not found.')
    }

    response.status(201).json(members)
  } catch (error) {
    next(error)
  }
})

documentsRouter.patch('/:id/members/:memberId', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const payload = validateMemberRolePayload(request.body)
    const members = await updateDocumentMemberRole(
      authenticatedRequest.authUser,
      request.params.id,
      Number(request.params.memberId),
      payload.role,
    )

    if (!members) {
      throw new HttpError(404, 'Document member not found.')
    }

    response.json(members)
  } catch (error) {
    next(error)
  }
})

documentsRouter.delete('/:id/members/:memberId', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const didRemove = await removeDocumentMember(
      authenticatedRequest.authUser,
      request.params.id,
      Number(request.params.memberId),
    )

    if (!didRemove) {
      throw new HttpError(404, 'Document member not found.')
    }

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})

documentsRouter.get('/:id/revisions', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const revisions = await listDocumentRevisions(
      authenticatedRequest.authUser,
      request.params.id,
    )

    if (!revisions) {
      throw new HttpError(404, 'Document not found.')
    }

    response.json(revisions)
  } catch (error) {
    next(error)
  }
})

documentsRouter.get('/:id/revisions/compare', async (request, response, next) => {
  try {
    const authenticatedRequest = getAuthenticatedRequest(request)
    const result = await compareDocumentRevisions(
      authenticatedRequest.authUser,
      request.params.id,
      parseRevisionCompareTarget(request.query.from, 'from'),
      parseRevisionCompareTarget(request.query.to, 'to'),
    )

    if (!result) {
      throw new HttpError(404, 'Document not found.')
    }

    response.json(result)
  } catch (error) {
    next(error)
  }
})

/*
  全端点总览

  ┌──────────────────────────────────────┬────────┬────────┬────────────────────────┬────────────────────────┐
  │                 端点                 │  方法  │  鉴权  │        所需权限        │          响应          │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents                       │ GET    │ 已认证 │ 无（自动过滤可访问的） │ DocumentSummary[]      │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents                       │ POST   │ 已认证 │ 无（任何用户都可创建） │ 201 + DocumentRecord   │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents/:id                   │ GET    │ 已认证 │ canView                │ DocumentRecord         │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents/:id                   │ PATCH  │ 已认证 │ canEdit                │ DocumentRecord         │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents/:id                   │ DELETE │ 已认证 │ canDelete              │ 204                    │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents/:id/members           │ GET    │ 已认证 │ canView                │ DocumentMember[]       │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents/:id/members           │ POST   │ 已认证 │ canManageMembers       │ 201 + DocumentMember[] │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents/:id/members/:memberId │ PATCH  │ 已认证 │ canManageMembers       │ DocumentMember[]       │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents/:id/members/:memberId │ DELETE │ 已认证 │ canManageMembers       │ 204                    │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents/:id/revisions         │ GET    │ 已认证 │ canView                │ DocumentRevision[]     │
  ├──────────────────────────────────────┼────────┼────────┼────────────────────────┼────────────────────────┤
  │ /api/documents/:id/revisions/compare │ GET    │ 已认证 │ canView                │ RevisionDiffResult     │
  └──────────────────────────────────────┴────────┴────────┴────────────────────────┴────────────────────────┘

  ---
  权限矩阵总结

  ┌────────────────────┬──────┬──────────────┬────────┬─────────────────────────┐
  │        操作        │ 匿名 │    viewer    │ editor │ admin/owner/super_admin │
  ├────────────────────┼──────┼──────────────┼────────┼─────────────────────────┤
  │ 列出可访问文档     │ ❌   │ ✅（过滤后） │ ✅     │ ✅                      │
  ├────────────────────┼──────┼──────────────┼────────┼─────────────────────────┤
  │ 创建新文档         │ ❌   │ ✅           │ ✅     │ ✅                      │
  ├────────────────────┼──────┼──────────────┼────────┼─────────────────────────┤
  │ 查看文档详情       │ ❌   │ ✅           │ ✅     │ ✅                      │
  ├────────────────────┼──────┼──────────────┼────────┼─────────────────────────┤
  │ 编辑文档           │ ❌   │ ❌           │ ✅     │ ✅                      │
  ├────────────────────┼──────┼──────────────┼────────┼─────────────────────────┤
  │ 删除文档           │ ❌   │ ❌           │ ❌     │ ✅                      │
  ├────────────────────┼──────┼──────────────┼────────┼─────────────────────────┤
  │ 查看成员           │ ❌   │ ✅           │ ✅     │ ✅                      │
  ├────────────────────┼──────┼──────────────┼────────┼─────────────────────────┤
  │ 添加/修改/移除成员 │ ❌   │ ❌           │ ❌     │ ✅                      │
  ├────────────────────┼──────┼──────────────┼────────┼─────────────────────────┤
  │ 查看版本历史       │ ❌   │ ✅           │ ✅     │ ✅                      │
  ├────────────────────┼──────┼──────────────┼────────┼─────────────────────────┤
  │ 版本对比           │ ❌   │ ✅           │ ✅     │ ✅                      │
  └────────────────────┴──────┴──────────────┴────────┴─────────────────────────┘

  ---
  设计模式与特点

  1. 薄路由层： 每个路由处理函数只做 3 件事——提取参数、调用 repository、返回 JSON。不含业务逻辑。
  2. 统一的错误处理： 所有 try/catch 都 next(error) 转发给全局错误处理中间件。HttpError 的 statusCode 被正确映射为 HTTP 状态码。
  3. 成员变更通知机制： 每次成员增删改后都调用 notifyCollabToReconnectDocument——确保权限变更立即生效，在线用户不会继续使用过期的权限。
  4. 安全性：
    - 所有 :id 参数直接用于 SQL 参数化查询——防止 SQL 注入
    - 每个操作都先通过 findDocumentAccessContext 验证权限——不是只在路由层判断
    - 统一的 404 不区分"不存在"和"无权访问"——防止信息泄露
    - Number() 而非 parseInt() 处理版本号——防止注入
  5. RESTful 设计：
    - 合适的 HTTP 方法：GET（读取）、POST（创建）、PATCH（部分更新）、DELETE（删除）
    - 合适的 HTTP 状态码：200、201、204、400、403、404
    - 嵌套资源：/documents/:id/members/:memberId 表达清晰的资源层级关系
*/