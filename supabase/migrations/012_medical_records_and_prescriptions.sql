-- =============================================
-- Migration 012: Medical records and prescription items
-- 目标：
-- 1) 新增病历主表 medical_records（支持 OCR 原文/手动确认后的持久化）
-- 2) 新增处方明细表 prescription_items（作为医生处方上下文）
-- 3) 为后续“由处方生成用药计划”提供稳定数据源
-- =============================================

CREATE TABLE IF NOT EXISTS medical_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    image_uri TEXT,
    raw_text TEXT,
    ocr_status VARCHAR(30) NOT NULL DEFAULT 'manual_confirmed',
    ocr_provider VARCHAR(50),
    source VARCHAR(20) NOT NULL DEFAULT 'upload',
    recognized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prescription_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    record_id UUID NOT NULL REFERENCES medical_records(id) ON DELETE CASCADE,
    medication_name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100),
    frequency VARCHAR(100),
    duration VARCHAR(100),
    instructions TEXT,
    confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
    parsed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "medical_records_select_own"
    ON medical_records
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "medical_records_insert_own"
    ON medical_records
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "medical_records_update_own"
    ON medical_records
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "medical_records_delete_own"
    ON medical_records
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "prescription_items_select_own"
    ON prescription_items
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "prescription_items_insert_own"
    ON prescription_items
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "prescription_items_update_own"
    ON prescription_items
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "prescription_items_delete_own"
    ON prescription_items
    FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_medical_records_user_created
    ON medical_records(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prescription_items_user_record
    ON prescription_items(user_id, record_id);

CREATE INDEX IF NOT EXISTS idx_prescription_items_medication_name
    ON prescription_items(medication_name);

DROP TRIGGER IF EXISTS update_medical_records_updated_at ON medical_records;
CREATE TRIGGER update_medical_records_updated_at
    BEFORE UPDATE ON medical_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_prescription_items_updated_at ON prescription_items;
CREATE TRIGGER update_prescription_items_updated_at
    BEFORE UPDATE ON prescription_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE medical_records IS '病历主表（含 OCR 结果与手动确认信息）';
COMMENT ON TABLE prescription_items IS '处方明细表（用于个性化上下文与计划生成）';
COMMENT ON COLUMN medical_records.ocr_status IS 'OCR状态：manual_confirmed/ocr_parsed/ocr_failed 等';
COMMENT ON COLUMN prescription_items.parsed_payload IS '原始结构化解析字段备份';
