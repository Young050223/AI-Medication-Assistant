-- =============================================
-- Migration 015: Agent suggested questions (Stage 6)
-- 目标：
-- 1) 新增 agent_suggested_questions 作为个性化问题主表
-- 2) 支持触发信号记录（漏服/新增药物/处方变化/异常反馈/下一次服药/会话主题）
-- 3) 兼容旧表 agent_question_suggestions 的历史数据回填
-- =============================================

CREATE TABLE IF NOT EXISTS agent_suggested_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    suggested_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    context_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
    trigger_signals TEXT[] NOT NULL DEFAULT '{}'::text[],
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '6 hours'),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 从旧表回填一次历史数据（若旧表存在）
DO $$
BEGIN
    IF to_regclass('public.agent_question_suggestions') IS NOT NULL THEN
        INSERT INTO agent_suggested_questions (
            user_id,
            suggested_questions,
            context_tags,
            generated_at,
            expires_at,
            created_at,
            updated_at,
            version
        )
        SELECT
            user_id,
            suggestions,
            context_tags,
            generated_at,
            expires_at,
            created_at,
            updated_at,
            1
        FROM agent_question_suggestions
        ON CONFLICT (user_id) DO UPDATE
        SET
            suggested_questions = EXCLUDED.suggested_questions,
            context_tags = EXCLUDED.context_tags,
            generated_at = EXCLUDED.generated_at,
            expires_at = EXCLUDED.expires_at,
            updated_at = GREATEST(agent_suggested_questions.updated_at, EXCLUDED.updated_at);
    END IF;
END $$;

ALTER TABLE agent_suggested_questions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_suggested_questions'
          AND policyname = 'agent_suggested_questions_select_own'
    ) THEN
        CREATE POLICY "agent_suggested_questions_select_own"
            ON agent_suggested_questions
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_suggested_questions'
          AND policyname = 'agent_suggested_questions_insert_own'
    ) THEN
        CREATE POLICY "agent_suggested_questions_insert_own"
            ON agent_suggested_questions
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_suggested_questions'
          AND policyname = 'agent_suggested_questions_update_own'
    ) THEN
        CREATE POLICY "agent_suggested_questions_update_own"
            ON agent_suggested_questions
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_suggested_questions'
          AND policyname = 'agent_suggested_questions_delete_own'
    ) THEN
        CREATE POLICY "agent_suggested_questions_delete_own"
            ON agent_suggested_questions
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_suggested_questions_expires_at
    ON agent_suggested_questions(expires_at);

DROP TRIGGER IF EXISTS update_agent_suggested_questions_updated_at ON agent_suggested_questions;
CREATE TRIGGER update_agent_suggested_questions_updated_at
    BEFORE UPDATE ON agent_suggested_questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE agent_suggested_questions IS 'Agent 打开前的个性化问题缓存（阶段6主表）';
COMMENT ON COLUMN agent_suggested_questions.suggested_questions IS '4~6条可点击的个性化推荐问题';
COMMENT ON COLUMN agent_suggested_questions.context_tags IS '生成问题时使用的上下文来源标签';
COMMENT ON COLUMN agent_suggested_questions.trigger_signals IS '触发生成的问题信号（漏服/新增药物/处方变化/异常反馈/下一次服药/会话主题）';
