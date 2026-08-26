-- =============================================
-- Migration 009: RAG documents idempotent upsert support
-- 目标：
-- 1) 结构化来源文档（health_profile / medication_schedule / medication_feedback / chat_message）
--    支持按 source_id 幂等更新，避免重复堆积
-- 2) 先清理历史重复数据，再创建唯一索引
-- =============================================

-- 删除重复文档（仅针对 source_id 非空）
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, source_type, source_id
            ORDER BY created_at DESC, id DESC
        ) AS rn
    FROM rag_documents
    WHERE source_id IS NOT NULL
)
DELETE FROM rag_documents rd
USING ranked r
WHERE rd.id = r.id
  AND r.rn > 1;

-- 允许 source_id 为空的文档继续多条写入（如自由查询文本）
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_documents_user_source_source_id_unique
    ON rag_documents(user_id, source_type, source_id);

COMMENT ON INDEX idx_rag_documents_user_source_source_id_unique
    IS 'RAG 文档幂等索引：同一用户同一来源同一 source_id 仅保留一条';
