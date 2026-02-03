-- =============================================
-- 服药计划表
-- 文件：002_medication_schedules.sql
-- 创建时间：2026-01-27
-- 说明：需要在003_medication_logs.sql之前执行
-- =============================================

CREATE TABLE IF NOT EXISTS medication_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 药物信息
    medication_name VARCHAR(255) NOT NULL,    -- 药物名称
    medication_dosage VARCHAR(100),           -- 剂量
    instructions TEXT,                        -- 用法说明
    
    -- 计划设置
    frequency VARCHAR(50),                    -- 服用频率（每日1次/每日3次等）
    reminders JSONB DEFAULT '[]'::jsonb,      -- 提醒时间列表 (存储MedicationReminder数组)
    duration_days INTEGER,                    -- 疗程天数
    
    -- 状态
    status VARCHAR(20) DEFAULT 'active',      -- 状态（active/paused/completed/cancelled）
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- 开始日期
    end_date DATE,                            -- 结束日期
    
    -- 来源关联
    source_record_id UUID,                    -- 来源病例ID（如果是从OCR识别创建的）
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用RLS（行级安全策略）
ALTER TABLE medication_schedules ENABLE ROW LEVEL SECURITY;

-- RLS策略：允许用户完全管理自己的服药计划
CREATE POLICY "medication_schedules_select_own" ON medication_schedules
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "medication_schedules_insert_own" ON medication_schedules
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "medication_schedules_update_own" ON medication_schedules
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "medication_schedules_delete_own" ON medication_schedules
    FOR DELETE USING (auth.uid() = user_id);

-- 索引（优化查询性能）
CREATE INDEX IF NOT EXISTS idx_medication_schedules_user_id ON medication_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_medication_schedules_status ON medication_schedules(status);
CREATE INDEX IF NOT EXISTS idx_medication_schedules_start_date ON medication_schedules(start_date);

-- 自动更新updated_at的触发器
DROP TRIGGER IF EXISTS update_medication_schedules_updated_at ON medication_schedules;
CREATE TRIGGER update_medication_schedules_updated_at
    BEFORE UPDATE ON medication_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
