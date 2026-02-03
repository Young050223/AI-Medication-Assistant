-- =============================================
-- 用户扩展信息表（扩展Supabase Auth用户）
-- 文件：001_user_and_health_profiles.sql
-- 创建时间：2026-01-24
-- 修改时间：2026-01-27 - 优化RLS策略
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

-- RLS策略：允许用户完全管理自己的数据
CREATE POLICY "user_profiles_select_own" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "user_profiles_insert_own" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "user_profiles_update_own" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "user_profiles_delete_own" ON user_profiles
    FOR DELETE USING (auth.uid() = id);

-- 自动创建profile的触发器（新用户注册时）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, display_name)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 绑定触发器到auth.users（如果不存在则创建）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================
-- 健康档案表
-- =============================================

CREATE TABLE IF NOT EXISTS health_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 基本信息
    birth_date DATE,                     -- 出生日期
    gender VARCHAR(10),                  -- 性别 (male/female/other)
    height_cm DECIMAL(5,2),              -- 身高(cm)
    weight_kg DECIMAL(5,2),              -- 体重(kg)
    
    -- 健康信息
    medical_history TEXT,                -- 过往病史
    allergies TEXT,                      -- 过敏药物
    
    -- 完整性标记
    is_complete BOOLEAN DEFAULT FALSE,   -- 档案是否完整
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 唯一约束：每个用户只有一份健康档案
    UNIQUE(user_id)
);

-- 启用RLS
ALTER TABLE health_profiles ENABLE ROW LEVEL SECURITY;

-- RLS策略：允许用户完全管理自己的健康档案
CREATE POLICY "health_profiles_select_own" ON health_profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "health_profiles_insert_own" ON health_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "health_profiles_update_own" ON health_profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "health_profiles_delete_own" ON health_profiles
    FOR DELETE USING (auth.uid() = user_id);

-- 更新时间戳的触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_health_profiles_updated_at ON health_profiles;
CREATE TRIGGER update_health_profiles_updated_at
    BEFORE UPDATE ON health_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
