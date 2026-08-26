-- 为用户资料增加 Agent 风格偏好
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS agent_style VARCHAR(20) DEFAULT 'efficient';

UPDATE user_profiles
SET agent_style = 'efficient'
WHERE agent_style IS NULL;
