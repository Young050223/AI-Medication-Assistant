-- =============================================
-- Migration 019: Agent runtime state and background tasks
-- Goals:
-- 1) Persist the Agent's current work state before and during user interaction
-- 2) Track adaptive background tasks that prepare context for the frontend
-- 3) Keep the new runtime layer small and compatible with the existing action log tables
-- =============================================

DO $$
BEGIN
    IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
        RAISE EXCEPTION 'missing prerequisite: public.update_updated_at_column(). Run 001_user_and_health_profiles.sql first.';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_runtime_states (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'idle',
    thinking_mode_preference VARCHAR(20) NOT NULL DEFAULT 'auto',
    current_thinking_mode VARCHAR(20) NOT NULL DEFAULT 'fast',
    last_context_summary TEXT NOT NULL DEFAULT '',
    last_context_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
    last_trigger_signals TEXT[] NOT NULL DEFAULT '{}'::text[],
    active_task_count INTEGER NOT NULL DEFAULT 0,
    pending_action_count INTEGER NOT NULL DEFAULT 0,
    background_status JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error TEXT,
    last_bootstrapped_at TIMESTAMPTZ,
    last_interaction_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agent_runtime_states_lifecycle_status_check
        CHECK (lifecycle_status IN ('idle', 'warming', 'ready', 'thinking', 'waiting_confirmation', 'acting', 'error')),
    CONSTRAINT agent_runtime_states_thinking_preference_check
        CHECK (thinking_mode_preference IN ('auto', 'fast', 'slow')),
    CONSTRAINT agent_runtime_states_current_thinking_mode_check
        CHECK (current_thinking_mode IN ('fast', 'slow')),
    CONSTRAINT agent_runtime_states_non_negative_counts_check
        CHECK (active_task_count >= 0 AND pending_action_count >= 0)
);

CREATE TABLE IF NOT EXISTS agent_background_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
    task_type VARCHAR(64) NOT NULL,
    task_status VARCHAR(24) NOT NULL DEFAULT 'queued',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    output JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agent_background_tasks_status_check
        CHECK (task_status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT agent_background_tasks_priority_check
        CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    CONSTRAINT agent_background_tasks_attempts_check
        CHECK (attempt_count >= 0 AND max_attempts > 0)
);

CREATE TABLE IF NOT EXISTS agent_memory_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    memory_type VARCHAR(48) NOT NULL,
    fact_status VARCHAR(24) NOT NULL DEFAULT 'active',
    content TEXT NOT NULL,
    source_table TEXT,
    source_id UUID,
    confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.700,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agent_memory_facts_type_check
        CHECK (memory_type IN ('profile', 'medication', 'preference', 'follow_up', 'safety', 'conversation')),
    CONSTRAINT agent_memory_facts_status_check
        CHECK (fact_status IN ('active', 'stale', 'revoked')),
    CONSTRAINT agent_memory_facts_confidence_check
        CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE IF NOT EXISTS agent_runtime_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_task_id UUID REFERENCES agent_background_tasks(id) ON DELETE SET NULL,
    source_request_id UUID REFERENCES agent_action_requests(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL,
    event_status VARCHAR(24) NOT NULL DEFAULT 'new',
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    visible_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agent_runtime_events_status_check
        CHECK (event_status IN ('new', 'seen', 'acknowledged', 'archived', 'expired')),
    CONSTRAINT agent_runtime_events_severity_check
        CHECK (severity IN ('info', 'success', 'warning', 'critical'))
);

ALTER TABLE agent_runtime_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_background_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runtime_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_runtime_states'
          AND policyname = 'agent_runtime_states_select_own'
    ) THEN
        CREATE POLICY "agent_runtime_states_select_own"
            ON agent_runtime_states
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_runtime_states'
          AND policyname = 'agent_runtime_states_insert_own'
    ) THEN
        CREATE POLICY "agent_runtime_states_insert_own"
            ON agent_runtime_states
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_runtime_states'
          AND policyname = 'agent_runtime_states_update_own'
    ) THEN
        CREATE POLICY "agent_runtime_states_update_own"
            ON agent_runtime_states
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_runtime_states'
          AND policyname = 'agent_runtime_states_delete_own'
    ) THEN
        CREATE POLICY "agent_runtime_states_delete_own"
            ON agent_runtime_states
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_background_tasks'
          AND policyname = 'agent_background_tasks_select_own'
    ) THEN
        CREATE POLICY "agent_background_tasks_select_own"
            ON agent_background_tasks
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_background_tasks'
          AND policyname = 'agent_background_tasks_insert_own'
    ) THEN
        CREATE POLICY "agent_background_tasks_insert_own"
            ON agent_background_tasks
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_background_tasks'
          AND policyname = 'agent_background_tasks_update_own'
    ) THEN
        CREATE POLICY "agent_background_tasks_update_own"
            ON agent_background_tasks
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_background_tasks'
          AND policyname = 'agent_background_tasks_delete_own'
    ) THEN
        CREATE POLICY "agent_background_tasks_delete_own"
            ON agent_background_tasks
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_runtime_states_updated
    ON agent_runtime_states(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_background_tasks_user_status
    ON agent_background_tasks(user_id, task_status, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_background_tasks_user_created
    ON agent_background_tasks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_background_tasks_conversation
    ON agent_background_tasks(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_facts_user_status
    ON agent_memory_facts(user_id, fact_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_facts_source
    ON agent_memory_facts(source_table, source_id);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_events_user_visible
    ON agent_runtime_events(user_id, event_status, visible_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_events_source_task
    ON agent_runtime_events(source_task_id, created_at DESC);

DROP TRIGGER IF EXISTS update_agent_runtime_states_updated_at ON agent_runtime_states;
CREATE TRIGGER update_agent_runtime_states_updated_at
    BEFORE UPDATE ON agent_runtime_states
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_background_tasks_updated_at ON agent_background_tasks;
CREATE TRIGGER update_agent_background_tasks_updated_at
    BEFORE UPDATE ON agent_background_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_memory_facts_updated_at ON agent_memory_facts;
CREATE TRIGGER update_agent_memory_facts_updated_at
    BEFORE UPDATE ON agent_memory_facts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_runtime_events_updated_at ON agent_runtime_events;
CREATE TRIGGER update_agent_runtime_events_updated_at
    BEFORE UPDATE ON agent_runtime_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_memory_facts'
          AND policyname = 'agent_memory_facts_select_own'
    ) THEN
        CREATE POLICY "agent_memory_facts_select_own"
            ON agent_memory_facts
            FOR SELECT USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_memory_facts'
          AND policyname = 'agent_memory_facts_insert_own'
    ) THEN
        CREATE POLICY "agent_memory_facts_insert_own"
            ON agent_memory_facts
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_memory_facts'
          AND policyname = 'agent_memory_facts_update_own'
    ) THEN
        CREATE POLICY "agent_memory_facts_update_own"
            ON agent_memory_facts
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_memory_facts'
          AND policyname = 'agent_memory_facts_delete_own'
    ) THEN
        CREATE POLICY "agent_memory_facts_delete_own"
            ON agent_memory_facts
            FOR DELETE USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_runtime_events'
          AND policyname = 'agent_runtime_events_select_own'
    ) THEN
        CREATE POLICY "agent_runtime_events_select_own"
            ON agent_runtime_events
            FOR SELECT USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_runtime_events'
          AND policyname = 'agent_runtime_events_insert_own'
    ) THEN
        CREATE POLICY "agent_runtime_events_insert_own"
            ON agent_runtime_events
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_runtime_events'
          AND policyname = 'agent_runtime_events_update_own'
    ) THEN
        CREATE POLICY "agent_runtime_events_update_own"
            ON agent_runtime_events
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'agent_runtime_events'
          AND policyname = 'agent_runtime_events_delete_own'
    ) THEN
        CREATE POLICY "agent_runtime_events_delete_own"
            ON agent_runtime_events
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

COMMENT ON TABLE agent_runtime_states IS 'Agent runtime state shown in the app before and during user interactions';
COMMENT ON TABLE agent_background_tasks IS 'Agent-owned adaptive background tasks such as context prefetch and suggestion refresh';
COMMENT ON TABLE agent_memory_facts IS 'Durable user-scoped Agent memory facts with source, confidence, expiry and revoke semantics';
COMMENT ON TABLE agent_runtime_events IS 'User-visible Agent runtime feed events generated by tasks, actions and bootstrap';
COMMENT ON COLUMN agent_runtime_states.lifecycle_status IS 'Current agent lifecycle: idle/warming/ready/thinking/waiting_confirmation/acting/error';
COMMENT ON COLUMN agent_runtime_states.thinking_mode_preference IS 'User-visible routing preference: auto/fast/slow';
COMMENT ON COLUMN agent_runtime_states.current_thinking_mode IS 'Last selected execution mode: fast/slow';
COMMENT ON COLUMN agent_runtime_states.last_context_tags IS 'Context sources preloaded for the next interaction';
COMMENT ON COLUMN agent_background_tasks.task_type IS 'Stable task type, for example context_prefetch';
COMMENT ON COLUMN agent_background_tasks.task_status IS 'Task status used by frontend runtime display';
COMMENT ON COLUMN agent_memory_facts.confidence IS '0..1 confidence score; low-confidence facts should be shown as suggestions, not truth';
COMMENT ON COLUMN agent_runtime_events.acknowledged_at IS 'Set when the user dismisses or acknowledges this event in the app';

CREATE OR REPLACE FUNCTION public.match_rag_documents(
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
SET search_path = public
AS $$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND target_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'not allowed to search another user rag documents';
    END IF;

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

REVOKE EXECUTE ON FUNCTION public.apply_medication_plan_change_set(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_medication_plan_change_set(UUID, UUID) TO service_role;
