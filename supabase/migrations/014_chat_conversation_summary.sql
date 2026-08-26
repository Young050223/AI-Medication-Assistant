-- =============================================
-- Migration 014: Conversation summary for agent orchestration
-- 目标：
-- 1) 在 chat_conversations 持久化会话摘要，避免长期堆叠原始消息
-- 2) 记录摘要已覆盖的消息数，支持增量更新
-- =============================================

ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS summary TEXT DEFAULT '';

ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS summary_message_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN chat_conversations.summary IS '会话压缩摘要，供 agent 长上下文检索';
COMMENT ON COLUMN chat_conversations.summary_message_count IS '摘要已覆盖的消息条数（增量摘要游标）';
COMMENT ON COLUMN chat_conversations.summary_updated_at IS '摘要最近更新时间';
