-- =============================================
-- Migration 010: Agent personalized preset questions
-- 目标：
-- 1) 每个用户缓存一份近期个性化问题（打开 Agent 前预生成）
-- 2) 支持过期刷新，避免每次都调用大模型
-- =============================================

CREATE TABLE IF NOT EXISTS agent_question_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
    context_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '6 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_question_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_question_suggestions_select_own"
    ON agent_question_suggestions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "agent_question_suggestions_insert_own"
    ON agent_question_suggestions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_question_suggestions_update_own"
    ON agent_question_suggestions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "agent_question_suggestions_delete_own"
    ON agent_question_suggestions
    FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_agent_question_suggestions_expires_at
    ON agent_question_suggestions(expires_at);

DROP TRIGGER IF EXISTS update_agent_question_suggestions_updated_at ON agent_question_suggestions;
CREATE TRIGGER update_agent_question_suggestions_updated_at
    BEFORE UPDATE ON agent_question_suggestions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE agent_question_suggestions IS 'Agent 个性化问题缓存表（按用户）';
COMMENT ON COLUMN agent_question_suggestions.suggestions IS '推荐问题数组';
COMMENT ON COLUMN agent_question_suggestions.context_tags IS '本轮生成时使用的上下文来源标签';
