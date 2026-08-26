-- =============================================
-- Migration 013: Drug knowledge cache and RAG
-- 目标：
-- 1) 新增药物知识来源缓存表（API 原始结果）
-- 2) 新增药物知识分块表（标准化 chunk + embedding）
-- 3) 新增药物知识向量检索函数（按药物名过滤）
-- =============================================

CREATE TABLE IF NOT EXISTS drug_knowledge_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255),
    source_provider VARCHAR(80) NOT NULL,
    source_key TEXT NOT NULL,
    source_url TEXT,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    content_hash TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drug_knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES drug_knowledge_sources(id) ON DELETE CASCADE,
    medication_name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255),
    knowledge_type VARCHAR(40) NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE drug_knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drug_knowledge_sources_read_authenticated"
    ON drug_knowledge_sources
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "drug_knowledge_chunks_read_authenticated"
    ON drug_knowledge_chunks
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE UNIQUE INDEX IF NOT EXISTS idx_drug_knowledge_sources_provider_key
    ON drug_knowledge_sources(medication_name, source_provider, source_key);

CREATE INDEX IF NOT EXISTS idx_drug_knowledge_sources_medication_fetched
    ON drug_knowledge_sources(medication_name, fetched_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_drug_knowledge_chunks_source_type_index
    ON drug_knowledge_chunks(source_id, knowledge_type, chunk_index);

CREATE INDEX IF NOT EXISTS idx_drug_knowledge_chunks_medication_type
    ON drug_knowledge_chunks(medication_name, knowledge_type);

CREATE INDEX IF NOT EXISTS idx_drug_knowledge_chunks_vector
    ON drug_knowledge_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

DROP TRIGGER IF EXISTS update_drug_knowledge_sources_updated_at ON drug_knowledge_sources;
CREATE TRIGGER update_drug_knowledge_sources_updated_at
    BEFORE UPDATE ON drug_knowledge_sources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_drug_knowledge_chunks_updated_at ON drug_knowledge_chunks;
CREATE TRIGGER update_drug_knowledge_chunks_updated_at
    BEFORE UPDATE ON drug_knowledge_chunks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION match_drug_knowledge_chunks(
    query_embedding vector(1536),
    medication_names text[] DEFAULT NULL,
    knowledge_types text[] DEFAULT NULL,
    match_threshold float DEFAULT 0.58,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    source_id uuid,
    medication_name varchar,
    normalized_name varchar,
    knowledge_type varchar,
    content text,
    similarity float,
    fetched_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT
        c.source_id,
        c.medication_name,
        c.normalized_name,
        c.knowledge_type,
        c.content,
        1 - (c.embedding <=> query_embedding) AS similarity,
        s.fetched_at
    FROM drug_knowledge_chunks c
    JOIN drug_knowledge_sources s ON s.id = c.source_id
    WHERE
        c.embedding IS NOT NULL
        AND (
            medication_names IS NULL
            OR EXISTS (
                SELECT 1
                FROM unnest(medication_names) AS m(name)
                WHERE
                    lower(c.medication_name) = lower(m.name)
                    OR lower(coalesce(c.normalized_name, '')) = lower(m.name)
            )
        )
        AND (knowledge_types IS NULL OR c.knowledge_type = ANY(knowledge_types))
        AND 1 - (c.embedding <=> query_embedding) > match_threshold
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
$$;

COMMENT ON TABLE drug_knowledge_sources IS '药物知识来源缓存（DailyMed/OpenFDA 等 API 原始响应）';
COMMENT ON TABLE drug_knowledge_chunks IS '药物知识标准化分块（用于向量检索）';
COMMENT ON FUNCTION match_drug_knowledge_chunks IS '药物知识向量检索函数，支持按药物名与知识类型过滤';
