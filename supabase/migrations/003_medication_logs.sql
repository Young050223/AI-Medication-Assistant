-- =============================================
-- 服药打卡记录表（统计用）
-- 文件：003_medication_logs.sql
-- 创建时间：2026-01-27
-- 依赖：002_medication_schedules.sql (必须先执行)
-- =============================================

CREATE TABLE IF NOT EXISTS medication_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES medication_schedules(id) ON DELETE SET NULL,
    
    -- 药物信息（冗余存储，即使计划被删除也能保留记录）
    medication_name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100),
    
    -- 时间信息
    scheduled_time TIME,                     -- 计划服药时间 (HH:MM)
    scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- 计划服药日期
    taken_at TIMESTAMPTZ,                    -- 实际服药时间（NULL表示未服用）
    
    -- 状态
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending/taken/skipped/late
    
    -- 确认方式
    confirmed_by VARCHAR(20) DEFAULT 'manual',  -- manual/notification/family
    
    -- 备注
    notes TEXT,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用RLS
ALTER TABLE medication_logs ENABLE ROW LEVEL SECURITY;

-- RLS策略：允许用户完全管理自己的服药记录
CREATE POLICY "medication_logs_select_own" ON medication_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "medication_logs_insert_own" ON medication_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "medication_logs_update_own" ON medication_logs
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "medication_logs_delete_own" ON medication_logs
    FOR DELETE USING (auth.uid() = user_id);

-- 索引（优化查询性能）
CREATE INDEX IF NOT EXISTS idx_medication_logs_user_id ON medication_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_medication_logs_schedule_id ON medication_logs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_medication_logs_scheduled_date ON medication_logs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_medication_logs_status ON medication_logs(status);
CREATE INDEX IF NOT EXISTS idx_medication_logs_user_date ON medication_logs(user_id, scheduled_date);

-- 自动更新updated_at
DROP TRIGGER IF EXISTS update_medication_logs_updated_at ON medication_logs;
CREATE TRIGGER update_medication_logs_updated_at
    BEFORE UPDATE ON medication_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- 便捷统计视图
-- =============================================

-- 用户每日服药统计视图
CREATE OR REPLACE VIEW user_daily_medication_stats AS
SELECT 
    user_id,
    scheduled_date,
    COUNT(*) as total_scheduled,
    COUNT(CASE WHEN status = 'taken' THEN 1 END) as taken_count,
    COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped_count,
    COUNT(CASE WHEN status = 'late' THEN 1 END) as late_count,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
    ROUND(
        COUNT(CASE WHEN status IN ('taken', 'late') THEN 1 END)::numeric / 
        NULLIF(COUNT(*), 0) * 100, 2
    ) as daily_compliance_rate
FROM medication_logs
GROUP BY user_id, scheduled_date;

-- 用户最近7天服药依从率视图
CREATE OR REPLACE VIEW user_weekly_compliance AS
SELECT 
    user_id,
    COUNT(*) as total_logs,
    COUNT(CASE WHEN status IN ('taken', 'late') THEN 1 END) as completed_count,
    COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped_count,
    ROUND(
        COUNT(CASE WHEN status IN ('taken', 'late') THEN 1 END)::numeric / 
        NULLIF(COUNT(*), 0) * 100, 2
    ) as weekly_compliance_rate,
    MIN(scheduled_date) as period_start,
    MAX(scheduled_date) as period_end
FROM medication_logs
WHERE scheduled_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY user_id;

-- 用户药物服用频次统计视图（便于医生报告）
CREATE OR REPLACE VIEW user_medication_frequency AS
SELECT 
    user_id,
    medication_name,
    COUNT(*) as total_scheduled,
    COUNT(CASE WHEN status IN ('taken', 'late') THEN 1 END) as total_taken,
    ROUND(
        COUNT(CASE WHEN status IN ('taken', 'late') THEN 1 END)::numeric / 
        NULLIF(COUNT(*), 0) * 100, 2
    ) as medication_compliance_rate,
    MIN(scheduled_date) as first_scheduled,
    MAX(scheduled_date) as last_scheduled
FROM medication_logs
GROUP BY user_id, medication_name;
