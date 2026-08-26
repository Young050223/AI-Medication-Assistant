-- =============================================
-- Migration 011: chat_messages metadata
-- 目标：
-- 1) 为消息存储结构化元数据（如 contextUsed）
-- 2) 支持历史会话回放时还原助手回答依据来源
-- =============================================

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN chat_messages.metadata IS '消息元数据（如 context_used/source_tags/rag_match_count 等）';
