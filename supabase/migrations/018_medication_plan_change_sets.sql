-- =============================================
-- Migration 018: Medication plan change sets and projection
-- 目标：
-- 1) 提供统一的“当前用药”投影口径
-- 2) 提供多步计划变更集模型
-- 3) 提供原子化变更集执行函数
-- 前置依赖：
-- - 001_user_and_health_profiles.sql（提供 update_updated_at_column）
-- - 002_medication_schedules.sql
-- - 006_chat_conversations.sql
-- - 017_agent_runtime_actions.sql
-- =============================================

DO $$
BEGIN
    IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
        RAISE EXCEPTION 'missing prerequisite: public.update_updated_at_column(). Run 001_user_and_health_profiles.sql first.';
    END IF;

    IF to_regclass('public.medication_schedules') IS NULL THEN
        RAISE EXCEPTION 'missing prerequisite: public.medication_schedules. Run 002_medication_schedules.sql first.';
    END IF;

    IF to_regclass('public.chat_conversations') IS NULL THEN
        RAISE EXCEPTION 'missing prerequisite: public.chat_conversations. Run 006_chat_conversations.sql first.';
    END IF;

    IF to_regclass('public.agent_action_requests') IS NULL THEN
        RAISE EXCEPTION 'missing prerequisite: public.agent_action_requests. Run 017_agent_runtime_actions.sql first.';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS medication_plan_change_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    request_id UUID UNIQUE REFERENCES agent_action_requests(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    change_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    preview_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    execution_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medication_plan_change_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id UUID NOT NULL REFERENCES medication_plan_change_sets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    operation_kind VARCHAR(20) NOT NULL,
    target_schedule_id UUID REFERENCES medication_schedules(id) ON DELETE SET NULL,
    medication_name VARCHAR(255),
    medication_dosage VARCHAR(100),
    frequency VARCHAR(50),
    instructions TEXT,
    reminder_times JSONB NOT NULL DEFAULT '[]'::jsonb,
    start_date DATE,
    end_date DATE,
    status_after VARCHAR(20),
    notes TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE medication_plan_change_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_plan_change_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'medication_plan_change_sets'
          AND policyname = 'medication_plan_change_sets_select_own'
    ) THEN
        CREATE POLICY "medication_plan_change_sets_select_own"
            ON medication_plan_change_sets
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'medication_plan_change_sets'
          AND policyname = 'medication_plan_change_sets_insert_own'
    ) THEN
        CREATE POLICY "medication_plan_change_sets_insert_own"
            ON medication_plan_change_sets
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'medication_plan_change_sets'
          AND policyname = 'medication_plan_change_sets_update_own'
    ) THEN
        CREATE POLICY "medication_plan_change_sets_update_own"
            ON medication_plan_change_sets
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'medication_plan_change_sets'
          AND policyname = 'medication_plan_change_sets_delete_own'
    ) THEN
        CREATE POLICY "medication_plan_change_sets_delete_own"
            ON medication_plan_change_sets
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'medication_plan_change_items'
          AND policyname = 'medication_plan_change_items_select_own'
    ) THEN
        CREATE POLICY "medication_plan_change_items_select_own"
            ON medication_plan_change_items
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'medication_plan_change_items'
          AND policyname = 'medication_plan_change_items_insert_own'
    ) THEN
        CREATE POLICY "medication_plan_change_items_insert_own"
            ON medication_plan_change_items
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'medication_plan_change_items'
          AND policyname = 'medication_plan_change_items_update_own'
    ) THEN
        CREATE POLICY "medication_plan_change_items_update_own"
            ON medication_plan_change_items
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'medication_plan_change_items'
          AND policyname = 'medication_plan_change_items_delete_own'
    ) THEN
        CREATE POLICY "medication_plan_change_items_delete_own"
            ON medication_plan_change_items
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_medication_plan_change_sets_user_created
    ON medication_plan_change_sets(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_medication_plan_change_sets_request
    ON medication_plan_change_sets(request_id);

CREATE INDEX IF NOT EXISTS idx_medication_plan_change_items_change_set
    ON medication_plan_change_items(change_set_id, sort_order ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_medication_plan_change_items_user_created
    ON medication_plan_change_items(user_id, created_at DESC);

DROP TRIGGER IF EXISTS update_medication_plan_change_sets_updated_at ON medication_plan_change_sets;
CREATE TRIGGER update_medication_plan_change_sets_updated_at
    BEFORE UPDATE ON medication_plan_change_sets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_medication_plan_change_items_updated_at ON medication_plan_change_items;
CREATE TRIGGER update_medication_plan_change_items_updated_at
    BEFORE UPDATE ON medication_plan_change_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP FUNCTION IF EXISTS public.get_medication_schedule_projection(UUID, DATE);
CREATE OR REPLACE FUNCTION public.get_medication_schedule_projection(
    target_user_id UUID DEFAULT auth.uid(),
    as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    medication_name VARCHAR,
    medication_dosage VARCHAR,
    instructions TEXT,
    frequency VARCHAR,
    reminders JSONB,
    status VARCHAR,
    effective_status VARCHAR,
    start_date DATE,
    end_date DATE,
    source_record_id UUID,
    allow_window_minutes INTEGER,
    date_overrides JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    is_current BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT
        ms.id,
        ms.user_id,
        ms.medication_name,
        ms.medication_dosage,
        ms.instructions,
        ms.frequency,
        ms.reminders,
        ms.status,
        CASE
            WHEN COALESCE(ms.status, 'active') IN ('paused', 'cancelled', 'completed')
                THEN COALESCE(ms.status, 'active')
            WHEN ms.start_date > as_of_date
                THEN 'scheduled'
            WHEN ms.end_date IS NOT NULL AND ms.end_date < as_of_date
                THEN 'completed'
            WHEN COALESCE(ms.status, 'active') = 'active'
                 AND ms.start_date <= as_of_date
                 AND (ms.end_date IS NULL OR ms.end_date >= as_of_date)
                THEN 'active'
            ELSE COALESCE(ms.status, 'active')
        END AS effective_status,
        ms.start_date,
        ms.end_date,
        ms.source_record_id,
        ms.allow_window_minutes,
        COALESCE(ms.date_overrides, '{}'::jsonb) AS date_overrides,
        ms.created_at,
        ms.updated_at,
        (
            COALESCE(ms.status, 'active') = 'active'
            AND ms.start_date <= as_of_date
            AND (ms.end_date IS NULL OR ms.end_date >= as_of_date)
        ) AS is_current
    FROM medication_schedules ms
    WHERE ms.user_id = target_user_id
    ORDER BY ms.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_medication_schedule_projection(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_medication_schedule_projection(UUID, DATE) TO service_role;

DROP FUNCTION IF EXISTS public.apply_medication_plan_change_set(UUID, UUID);
CREATE OR REPLACE FUNCTION public.apply_medication_plan_change_set(
    p_change_set_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    change_set_record medication_plan_change_sets%ROWTYPE;
    item_record medication_plan_change_items%ROWTYPE;
    change_result JSONB := '{}'::jsonb;
    executed_items JSONB := '[]'::jsonb;
    created_count INTEGER := 0;
    updated_count INTEGER := 0;
    paused_count INTEGER := 0;
    archived_count INTEGER := 0;
    kept_count INTEGER := 0;
    reminder_time TEXT;
    reminder_index INTEGER;
    reminders_payload JSONB;
    effective_date_value DATE;
    schedule_reference_id UUID;
    inserted_schedule_id UUID;
    updated_schedule_id UUID;
BEGIN
    SELECT *
    INTO change_set_record
    FROM medication_plan_change_sets
    WHERE id = p_change_set_id
      AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'change_set_not_found';
    END IF;

    IF change_set_record.change_status = 'applied' THEN
        RETURN change_set_record.execution_result;
    END IF;

    IF change_set_record.change_status = 'cancelled' THEN
        RAISE EXCEPTION 'change_set_cancelled';
    END IF;

    UPDATE medication_plan_change_sets
    SET change_status = 'confirmed',
        updated_at = NOW()
    WHERE id = change_set_record.id;

    FOR item_record IN
        SELECT *
        FROM medication_plan_change_items
        WHERE change_set_id = change_set_record.id
          AND user_id = p_user_id
        ORDER BY sort_order ASC, created_at ASC
    LOOP
        effective_date_value := COALESCE(item_record.start_date, change_set_record.effective_date, CURRENT_DATE);
        schedule_reference_id := CASE
            WHEN item_record.operation_kind = 'create' THEN gen_random_uuid()
            ELSE item_record.target_schedule_id
        END;
        inserted_schedule_id := NULL;
        updated_schedule_id := NULL;
        reminders_payload := '[]'::jsonb;
        reminder_index := 0;

        IF jsonb_typeof(item_record.reminder_times) = 'array' THEN
            FOR reminder_time IN
                SELECT value
                FROM jsonb_array_elements_text(item_record.reminder_times)
            LOOP
                reminders_payload := reminders_payload || jsonb_build_array(
                    jsonb_build_object(
                        'id', COALESCE(schedule_reference_id, gen_random_uuid())::text || '-change-' || reminder_index::text,
                        'time', reminder_time,
                        'dosage', COALESCE(item_record.medication_dosage, '')
                    )
                );
                reminder_index := reminder_index + 1;
            END LOOP;
        END IF;

        IF item_record.operation_kind = 'create' THEN
            inserted_schedule_id := COALESCE(schedule_reference_id, gen_random_uuid());
            IF reminders_payload = '[]'::jsonb THEN
                reminders_payload := jsonb_build_array(
                    jsonb_build_object(
                        'id', inserted_schedule_id::text || '-change-0',
                        'time', '08:00',
                        'dosage', COALESCE(item_record.medication_dosage, '')
                    )
                );
            END IF;

            INSERT INTO medication_schedules (
                id,
                user_id,
                medication_name,
                medication_dosage,
                instructions,
                frequency,
                reminders,
                status,
                start_date,
                end_date,
                source_record_id,
                allow_window_minutes,
                date_overrides
            )
            VALUES (
                inserted_schedule_id,
                p_user_id,
                COALESCE(item_record.medication_name, '未命名药物'),
                item_record.medication_dosage,
                item_record.instructions,
                COALESCE(item_record.frequency, 'onceDaily'),
                reminders_payload,
                COALESCE(item_record.status_after, 'active'),
                effective_date_value,
                item_record.end_date,
                NULL,
                NULL,
                '{}'::jsonb
            );

            created_count := created_count + 1;
            executed_items := executed_items || jsonb_build_array(
                jsonb_build_object(
                    'operationKind', item_record.operation_kind,
                    'scheduleId', inserted_schedule_id,
                    'medicationName', item_record.medication_name
                )
            );
        ELSIF item_record.operation_kind = 'update' THEN
            UPDATE medication_schedules
            SET medication_name = COALESCE(item_record.medication_name, medication_name),
                medication_dosage = COALESCE(item_record.medication_dosage, medication_dosage),
                instructions = COALESCE(item_record.instructions, instructions),
                frequency = COALESCE(item_record.frequency, frequency),
                reminders = CASE
                    WHEN reminders_payload <> '[]'::jsonb THEN reminders_payload
                    ELSE reminders
                END,
                start_date = COALESCE(item_record.start_date, start_date),
                end_date = COALESCE(item_record.end_date, end_date),
                status = COALESCE(item_record.status_after, status, 'active'),
                updated_at = NOW()
            WHERE id = item_record.target_schedule_id
              AND user_id = p_user_id
            RETURNING id INTO updated_schedule_id;

            IF updated_schedule_id IS NULL THEN
                RAISE EXCEPTION 'update_target_missing';
            END IF;

            updated_count := updated_count + 1;
            executed_items := executed_items || jsonb_build_array(
                jsonb_build_object(
                    'operationKind', item_record.operation_kind,
                    'scheduleId', updated_schedule_id,
                    'medicationName', item_record.medication_name
                )
            );
        ELSIF item_record.operation_kind = 'pause' THEN
            UPDATE medication_schedules
            SET status = 'paused',
                end_date = COALESCE(item_record.end_date, effective_date_value),
                updated_at = NOW()
            WHERE id = item_record.target_schedule_id
              AND user_id = p_user_id
            RETURNING id INTO updated_schedule_id;

            IF updated_schedule_id IS NULL THEN
                RAISE EXCEPTION 'pause_target_missing';
            END IF;

            paused_count := paused_count + 1;
            executed_items := executed_items || jsonb_build_array(
                jsonb_build_object(
                    'operationKind', item_record.operation_kind,
                    'scheduleId', updated_schedule_id,
                    'medicationName', item_record.medication_name
                )
            );
        ELSIF item_record.operation_kind = 'archive' THEN
            UPDATE medication_schedules
            SET status = 'completed',
                end_date = COALESCE(item_record.end_date, effective_date_value),
                updated_at = NOW()
            WHERE id = item_record.target_schedule_id
              AND user_id = p_user_id
            RETURNING id INTO updated_schedule_id;

            IF updated_schedule_id IS NULL THEN
                RAISE EXCEPTION 'archive_target_missing';
            END IF;

            archived_count := archived_count + 1;
            executed_items := executed_items || jsonb_build_array(
                jsonb_build_object(
                    'operationKind', item_record.operation_kind,
                    'scheduleId', updated_schedule_id,
                    'medicationName', item_record.medication_name
                )
            );
        ELSIF item_record.operation_kind = 'keep' THEN
            kept_count := kept_count + 1;
            executed_items := executed_items || jsonb_build_array(
                jsonb_build_object(
                    'operationKind', item_record.operation_kind,
                    'scheduleId', item_record.target_schedule_id,
                    'medicationName', item_record.medication_name
                )
            );
        ELSE
            RAISE EXCEPTION 'unsupported_operation_kind:%', item_record.operation_kind;
        END IF;
    END LOOP;

    change_result := jsonb_build_object(
        'changeSetId', change_set_record.id,
        'createdCount', created_count,
        'updatedCount', updated_count,
        'pausedCount', paused_count,
        'archivedCount', archived_count,
        'keptCount', kept_count,
        'executedItems', executed_items
    );

    UPDATE medication_plan_change_sets
    SET change_status = 'applied',
        execution_result = change_result,
        updated_at = NOW()
    WHERE id = change_set_record.id;

    RETURN change_result;
EXCEPTION
    WHEN OTHERS THEN
        UPDATE medication_plan_change_sets
        SET change_status = 'failed',
            execution_result = jsonb_build_object(
                'changeSetId', p_change_set_id,
                'error', SQLERRM
            ),
            updated_at = NOW()
        WHERE id = p_change_set_id;
        RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_medication_plan_change_set(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_medication_plan_change_set(UUID, UUID) TO service_role;

COMMENT ON TABLE medication_plan_change_sets IS 'Agent 规划出的多步用药计划变更集';
COMMENT ON TABLE medication_plan_change_items IS '变更集中的具体计划操作项';
COMMENT ON FUNCTION public.get_medication_schedule_projection(UUID, DATE) IS '统一当前用药投影，输出有效状态与 is_current';
COMMENT ON FUNCTION public.apply_medication_plan_change_set(UUID, UUID) IS '原子化执行用药计划变更集';
