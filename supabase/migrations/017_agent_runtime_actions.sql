-- =============================================
-- Migration 017: Agent runtime action records
-- 目标：
-- 1) 记录 Agent 动作请求、执行结果和上下文访问轨迹
-- 2) 为后续快/慢思考路由、二次确认和审计提供持久化基础
-- 3) 保持与现有 Supabase 迁移风格一致
-- =============================================

CREATE TABLE IF NOT EXISTS agent_action_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
    command_name VARCHAR(100) NOT NULL,
    thinking_mode VARCHAR(20) NOT NULL DEFAULT 'slow',
    confirmation_state VARCHAR(20) NOT NULL DEFAULT 'pending',
    request_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    confirmed_at TIMESTAMPTZ,
    confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    executed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failure_reason TEXT,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_action_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    request_id UUID NOT NULL REFERENCES agent_action_requests(id) ON DELETE CASCADE,
    command_name VARCHAR(100) NOT NULL,
    action_status VARCHAR(20) NOT NULL DEFAULT 'started',
    message TEXT NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    executed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_context_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    request_id UUID REFERENCES agent_action_requests(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
    thinking_mode VARCHAR(20) NOT NULL DEFAULT 'slow',
    access_scope VARCHAR(100) NOT NULL,
    source_tag VARCHAR(100) NOT NULL,
    access_reason TEXT NOT NULL DEFAULT '',
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_context_access_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_action_requests'
          AND policyname = 'agent_action_requests_select_own'
    ) THEN
        CREATE POLICY "agent_action_requests_select_own"
            ON agent_action_requests
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_action_requests'
          AND policyname = 'agent_action_requests_insert_own'
    ) THEN
        CREATE POLICY "agent_action_requests_insert_own"
            ON agent_action_requests
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_action_requests'
          AND policyname = 'agent_action_requests_update_own'
    ) THEN
        CREATE POLICY "agent_action_requests_update_own"
            ON agent_action_requests
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_action_requests'
          AND policyname = 'agent_action_requests_delete_own'
    ) THEN
        CREATE POLICY "agent_action_requests_delete_own"
            ON agent_action_requests
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_action_logs'
          AND policyname = 'agent_action_logs_select_own'
    ) THEN
        CREATE POLICY "agent_action_logs_select_own"
            ON agent_action_logs
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_action_logs'
          AND policyname = 'agent_action_logs_insert_own'
    ) THEN
        CREATE POLICY "agent_action_logs_insert_own"
            ON agent_action_logs
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_action_logs'
          AND policyname = 'agent_action_logs_update_own'
    ) THEN
        CREATE POLICY "agent_action_logs_update_own"
            ON agent_action_logs
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_action_logs'
          AND policyname = 'agent_action_logs_delete_own'
    ) THEN
        CREATE POLICY "agent_action_logs_delete_own"
            ON agent_action_logs
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_context_access_logs'
          AND policyname = 'agent_context_access_logs_select_own'
    ) THEN
        CREATE POLICY "agent_context_access_logs_select_own"
            ON agent_context_access_logs
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_context_access_logs'
          AND policyname = 'agent_context_access_logs_insert_own'
    ) THEN
        CREATE POLICY "agent_context_access_logs_insert_own"
            ON agent_context_access_logs
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_context_access_logs'
          AND policyname = 'agent_context_access_logs_update_own'
    ) THEN
        CREATE POLICY "agent_context_access_logs_update_own"
            ON agent_context_access_logs
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_context_access_logs'
          AND policyname = 'agent_context_access_logs_delete_own'
    ) THEN
        CREATE POLICY "agent_context_access_logs_delete_own"
            ON agent_context_access_logs
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_action_requests_user_created
    ON agent_action_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_action_requests_user_status
    ON agent_action_requests(user_id, request_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_action_requests_conversation
    ON agent_action_requests(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_action_logs_request_created
    ON agent_action_logs(request_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_action_logs_user_created
    ON agent_action_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_context_access_logs_user_created
    ON agent_context_access_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_context_access_logs_request_created
    ON agent_context_access_logs(request_id, created_at DESC);

DROP TRIGGER IF EXISTS update_agent_action_requests_updated_at ON agent_action_requests;
CREATE TRIGGER update_agent_action_requests_updated_at
    BEFORE UPDATE ON agent_action_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_action_logs_updated_at ON agent_action_logs;
CREATE TRIGGER update_agent_action_logs_updated_at
    BEFORE UPDATE ON agent_action_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_context_access_logs_updated_at ON agent_context_access_logs;
CREATE TRIGGER update_agent_context_access_logs_updated_at
    BEFORE UPDATE ON agent_context_access_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE agent_action_requests IS 'Agent 动作请求主表，记录待确认、已确认和已执行的动作';
COMMENT ON TABLE agent_action_logs IS 'Agent 动作执行日志，记录每一步命令和状态变更';
COMMENT ON TABLE agent_context_access_logs IS 'Agent 上下文访问日志，记录慢思考过程读取了哪些数据';
COMMENT ON COLUMN agent_action_requests.command_name IS 'Agent 命令名';
COMMENT ON COLUMN agent_action_requests.thinking_mode IS '思考模式：fast 或 slow';
COMMENT ON COLUMN agent_action_requests.confirmation_state IS '确认状态：pending/required/confirmed/rejected/cancelled/skipped';
COMMENT ON COLUMN agent_action_requests.request_status IS '请求状态：pending/ready/running/succeeded/failed/cancelled';
COMMENT ON COLUMN agent_action_requests.requires_confirmation IS '是否需要用户二次确认';
COMMENT ON COLUMN agent_action_logs.action_status IS '动作状态：started/succeeded/failed/skipped';
COMMENT ON COLUMN agent_context_access_logs.access_scope IS '上下文访问范围，例如 health_profile、medication_schedule、medication_feedback';
