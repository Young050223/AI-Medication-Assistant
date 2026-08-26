-- =============================================
-- Migration 008: Cloud Sync fields for schedules/logs
-- 目标：
-- 1) 支持用药计划按日期覆盖配置云端持久化
-- 2) 支持服药日志按 reminder 维度幂等 upsert
-- =============================================

-- medication_schedules: 补充窗口配置和日期覆盖
ALTER TABLE medication_schedules
    ADD COLUMN IF NOT EXISTS allow_window_minutes INTEGER;

ALTER TABLE medication_schedules
    ADD COLUMN IF NOT EXISTS date_overrides JSONB DEFAULT '{}'::jsonb;

-- medication_logs: 增加 reminder_id 以支持同一天同计划多提醒打卡
ALTER TABLE medication_logs
    ADD COLUMN IF NOT EXISTS reminder_id TEXT;

-- 幂等 upsert 唯一索引（用于 onConflict: user_id,schedule_id,scheduled_date,reminder_id）
CREATE UNIQUE INDEX IF NOT EXISTS idx_medication_logs_user_schedule_date_reminder
    ON medication_logs(user_id, schedule_id, scheduled_date, reminder_id);

COMMENT ON COLUMN medication_schedules.allow_window_minutes IS '确认服药可操作时间窗口（分钟）';
COMMENT ON COLUMN medication_schedules.date_overrides IS '按日期覆盖配置（例如临时改剂量/时间/停药）';
COMMENT ON COLUMN medication_logs.reminder_id IS '提醒实例ID，支持同一计划一天多次提醒的独立打卡';
