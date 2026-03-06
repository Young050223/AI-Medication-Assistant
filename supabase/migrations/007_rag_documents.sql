-- =============================================
-- Migration 007: RAG Documents
-- 统一 RAG 文档向量表 — 存储所有用于检索增强生成的文本嵌入
-- 来源: chat_message, medication_feedback, medication_schedule, health_profile
-- =============================================

-- 1. 统一 RAG 文档表
CREATE TABLE IF NOT EXISTS rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- 来源分类
    source_type VARCHAR(50) NOT NULL,    -- 'chat_message' | 'medication_feedback' | 'medication_schedule' | 'health_profile'
    source_id UUID,                       -- 关联的原始记录 ID（可选）

    -- 内容
    content TEXT NOT NULL,                -- 用于搜索的文本内容
    embedding vector(1536) NOT NULL,      -- OpenAI text-embedding-3-small 向量

    -- 元数据
    metadata JSONB DEFAULT '{}',          -- 额外信息（药物名、conversation_id、role 等）

    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 启用 RLS
ALTER TABLE rag_documents ENABLE ROW LEVEL SECURITY;

-- 3. RLS 策略：用户只能访问自己的文档
CREATE POLICY "rag_documents_select_own" ON rag_documents
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "rag_documents_insert_own" ON rag_documents
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "rag_documents_delete_own" ON rag_documents
    FOR DELETE USING (auth.uid() = user_id);

-- 4. HNSW 向量索引（适合中小数据量，无需预训练）
CREATE INDEX IF NOT EXISTS idx_rag_documents_vector
    ON rag_documents
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 5. 常规索引
CREATE INDEX IF NOT EXISTS idx_rag_documents_user_id
    ON rag_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_rag_documents_source_type
    ON rag_documents(source_type);
CREATE INDEX IF NOT EXISTS idx_rag_documents_user_source
    ON rag_documents(user_id, source_type);
CREATE INDEX IF NOT EXISTS idx_rag_documents_source_id
    ON rag_documents(source_id);

-- 6. 向量相似度搜索函数
CREATE OR REPLACE FUNCTION match_rag_documents(
    query_embedding vector(1536),
    target_user_id uuid,
    source_types text[] DEFAULT NULL,
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    id uuid,
    source_type varchar,
    source_id uuid,
    content text,
    metadata jsonb,
    similarity float,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        rd.id,
        rd.source_type,
        rd.source_id,
        rd.content,
        rd.metadata,
        1 - (rd.embedding <=> query_embedding) as similarity,
        rd.created_at
    FROM rag_documents rd
    WHERE
        rd.user_id = target_user_id
        AND rd.embedding IS NOT NULL
        AND (source_types IS NULL OR rd.source_type = ANY(source_types))
        AND 1 - (rd.embedding <=> query_embedding) > match_threshold
    ORDER BY rd.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 7. 注释
COMMENT ON TABLE rag_documents IS '统一 RAG 文档表 — 存储所有来源的文本嵌入，用于检索增强生成';
COMMENT ON FUNCTION match_rag_documents IS '向量相似度搜索函数 — 按用户、来源类型过滤，返回最相似的文档';

-- =============================================
-- 8. 清理旧向量表（来自 005_vector_embeddings.sql）
-- 合并到统一 rag_documents 表后，旧表不再需要
-- =============================================

-- 删除旧的搜索函数
DROP FUNCTION IF EXISTS match_user_queries(vector(1536), float, int, uuid);
DROP FUNCTION IF EXISTS search_medications(vector(1536), float, int, varchar);

-- 删除旧的触发器
DROP TRIGGER IF EXISTS update_user_query_embeddings_updated_at ON user_query_embeddings;
DROP TRIGGER IF EXISTS update_medication_embeddings_updated_at ON medication_embeddings;

-- 删除旧表（CASCADE 会同时删除依赖的策略和索引）
DROP TABLE IF EXISTS user_query_embeddings CASCADE;
DROP TABLE IF EXISTS medication_embeddings CASCADE;
