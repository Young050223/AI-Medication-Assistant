-- =============================================
-- 用户扩展信息表（扩展Supabase Auth用户）
-- 文件：000_user_profiles.sql
-- 创建时间：2026-01-24
-- =============================================

CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 基本信息
    display_name VARCHAR(100),          -- 显示名称
    avatar_url TEXT,                     -- 头像URL
    phone VARCHAR(20),                   -- 手机号（可选）
    language VARCHAR(10) DEFAULT 'zh-CN', -- 语言偏好
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用RLS（行级安全策略）
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS策略：用户只能访问自己的数据
CREATE POLICY "用户可以查看自己的profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "用户可以更新自己的profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "用户可以插入自己的profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- 自动创建profile的触发器（新用户注册时）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, display_name)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 绑定触发器到auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
