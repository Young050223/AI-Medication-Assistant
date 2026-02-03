-- =============================================
-- 服药反馈表
-- 文件：004_medication_feedback.sql
-- 创建时间：2026-01-28
-- 依赖：002_medication_schedules.sql
-- 描述：存储患者服药后的反馈，支持文字和语音输入
-- =============================================

CREATE TABLE IF NOT EXISTS medication_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES medication_schedules(id) ON DELETE SET NULL,
    
    -- 药物信息（冗余存储，即使计划被删除也能保留记录）
    medication_name VARCHAR(255) NOT NULL,
    
    -- 反馈信息
    feedback_date DATE NOT NULL DEFAULT CURRENT_DATE,
    feedback_type VARCHAR(20) NOT NULL DEFAULT 'text',  -- 'text' 或 'voice'
    content TEXT NOT NULL,                               -- 反馈内容
    
    -- 状态标记
    mood VARCHAR(20),                                    -- 'good', 'neutral', 'bad'
    side_effects TEXT[],                                 -- 副作用标签数组
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用RLS
ALTER TABLE medication_feedback ENABLE ROW LEVEL SECURITY;

-- RLS策略：允许用户完全管理自己的反馈记录
CREATE POLICY "medication_feedback_select_own" ON medication_feedback
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "medication_feedback_insert_own" ON medication_feedback
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "medication_feedback_update_own" ON medication_feedback
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "medication_feedback_delete_own" ON medication_feedback
    FOR DELETE USING (auth.uid() = user_id);

-- 索引（优化查询性能）
CREATE INDEX IF NOT EXISTS idx_medication_feedback_user_id ON medication_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_medication_feedback_schedule_id ON medication_feedback(schedule_id);
CREATE INDEX IF NOT EXISTS idx_medication_feedback_date ON medication_feedback(feedback_date);
CREATE INDEX IF NOT EXISTS idx_medication_feedback_medication ON medication_feedback(medication_name);
CREATE INDEX IF NOT EXISTS idx_medication_feedback_user_date ON medication_feedback(user_id, feedback_date);

-- 自动更新updated_at
DROP TRIGGER IF EXISTS update_medication_feedback_updated_at ON medication_feedback;
CREATE TRIGGER update_medication_feedback_updated_at
    BEFORE UPDATE ON medication_feedback
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- 便捷统计视图
-- =============================================

-- 用户药物反馈汇总视图（便于医生报告）
CREATE OR REPLACE VIEW user_medication_feedback_summary AS
SELECT 
    user_id,
    medication_name,
    COUNT(*) as total_feedbacks,
    COUNT(CASE WHEN mood = 'good' THEN 1 END) as good_count,
    COUNT(CASE WHEN mood = 'neutral' THEN 1 END) as neutral_count,
    COUNT(CASE WHEN mood = 'bad' THEN 1 END) as bad_count,
    MIN(feedback_date) as first_feedback,
    MAX(feedback_date) as last_feedback
FROM medication_feedback
GROUP BY user_id, medication_name;

-- 最近反馈视图（按用户）
CREATE OR REPLACE VIEW user_recent_feedback AS
SELECT 
    id,
    user_id,
    medication_name,
    feedback_date,
    feedback_type,
    content,
    mood,
    side_effects,
    created_at
FROM medication_feedback
WHERE feedback_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY created_at DESC;

-- 添加注释
COMMENT ON TABLE medication_feedback IS '服药反馈表 - 存储患者服药后的感受反馈';
COMMENT ON COLUMN medication_feedback.feedback_type IS '输入方式: text(文字) 或 voice(语音)';
COMMENT ON COLUMN medication_feedback.mood IS '心情: good(好), neutral(一般), bad(不好)';
COMMENT ON COLUMN medication_feedback.side_effects IS '副作用标签数组';
