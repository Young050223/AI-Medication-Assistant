-- =============================================
-- 向量嵌入表 (修订版)
-- 文件：005_vector_embeddings.sql
-- 创建时间：2026-02-03
-- 描述：存储用户查询和药物信息的向量嵌入
-- =============================================

-- 1. 启用必要扩展
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 用户查询历史向量表
CREATE TABLE IF NOT EXISTS user_query_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 查询内容
    query_text TEXT NOT NULL,
    query_type VARCHAR(50) NOT NULL,  -- 'drug_search', 'symptom', 'interaction'
    
    -- 向量嵌入 (NOT NULL 约束)
    embedding vector(1536) NOT NULL,
    
    -- 元数据
    metadata JSONB DEFAULT '{}',
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 药物信息向量表（用于语义搜索）
CREATE TABLE IF NOT EXISTS medication_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 关联的药物信息
    medication_name VARCHAR(255) NOT NULL,
    rxcui VARCHAR(50),
    
    -- 内容类型
    content_type VARCHAR(50) NOT NULL,  -- 'label', 'adverse_event', 'interaction'
    content_text TEXT NOT NULL,
    
    -- 向量嵌入 (NOT NULL 约束)
    embedding vector(1536) NOT NULL,
    
    -- 元数据
    source VARCHAR(50),  -- 'dailymed', 'openfda', 'rxnorm'
    metadata JSONB DEFAULT '{}',
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 启用RLS
ALTER TABLE user_query_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_embeddings ENABLE ROW LEVEL SECURITY;

-- 5. RLS策略 - 用户查询向量
CREATE POLICY "user_query_embeddings_select_own" ON user_query_embeddings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_query_embeddings_insert_own" ON user_query_embeddings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_query_embeddings_delete_own" ON user_query_embeddings
    FOR DELETE USING (auth.uid() = user_id);

-- 6. RLS策略 - 药物信息向量（所有认证用户可读）
CREATE POLICY "medication_embeddings_select_authenticated" ON medication_embeddings
    FOR SELECT USING (auth.role() = 'authenticated');

-- 7. 自动更新 updated_at 触发器
-- 注意：update_updated_at_column 函数已在之前的migration中创建
CREATE TRIGGER update_user_query_embeddings_updated_at
    BEFORE UPDATE ON user_query_embeddings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medication_embeddings_updated_at
    BEFORE UPDATE ON medication_embeddings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. 使用 HNSW 索引（更适合小数据量，无需ANALYZE）
CREATE INDEX IF NOT EXISTS idx_user_query_embeddings_vector 
    ON user_query_embeddings 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_medication_embeddings_vector 
    ON medication_embeddings 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 9. 其他索引
CREATE INDEX IF NOT EXISTS idx_user_query_embeddings_user 
    ON user_query_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_query_embeddings_type 
    ON user_query_embeddings(query_type);
CREATE INDEX IF NOT EXISTS idx_medication_embeddings_rxcui 
    ON medication_embeddings(rxcui);
CREATE INDEX IF NOT EXISTS idx_medication_embeddings_name 
    ON medication_embeddings(medication_name);

-- 10. 相似度搜索函数 - 用户查询
CREATE OR REPLACE FUNCTION match_user_queries(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 5,
    target_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    query_text text,
    query_type varchar,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        uqe.id,
        uqe.query_text,
        uqe.query_type,
        1 - (uqe.embedding <=> query_embedding) as similarity
    FROM user_query_embeddings uqe
    WHERE 
        uqe.embedding IS NOT NULL
        AND (target_user_id IS NULL OR uqe.user_id = target_user_id)
        AND 1 - (uqe.embedding <=> query_embedding) > match_threshold
    ORDER BY uqe.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 11. 相似度搜索函数 - 药物信息
CREATE OR REPLACE FUNCTION search_medications(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    content_type_filter varchar DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    medication_name varchar,
    content_type varchar,
    content_text text,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        me.id,
        me.medication_name,
        me.content_type,
        me.content_text,
        1 - (me.embedding <=> query_embedding) as similarity
    FROM medication_embeddings me
    WHERE 
        me.embedding IS NOT NULL
        AND (content_type_filter IS NULL OR me.content_type = content_type_filter)
        AND 1 - (me.embedding <=> query_embedding) > match_threshold
    ORDER BY me.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 12. 添加注释
COMMENT ON TABLE user_query_embeddings IS '用户查询历史向量表 - 存储用户搜索记录的向量嵌入';
COMMENT ON TABLE medication_embeddings IS '药物信息向量表 - 存储药物说明书和不良反应的向量嵌入';
COMMENT ON FUNCTION match_user_queries IS '相似用户查询搜索函数 - 基于向量相似度返回历史查询';
COMMENT ON FUNCTION search_medications IS '药物语义搜索函数 - 基于向量相似度返回相关药物信息';
