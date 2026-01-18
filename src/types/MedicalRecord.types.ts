/**
 * @file MedicalRecord.types.ts
 * @description 病例识别相关类型定义
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-18
 */

/**
 * 图片来源类型
 */
export type ImageSource = 'camera' | 'gallery';

/**
 * 识别状态
 */
export type RecognitionStatus = 'idle' | 'capturing' | 'processing' | 'success' | 'error';

/**
 * 提取的药物信息
 */
export interface ExtractedMedication {
    name: string;                // 药物名称
    dosage?: string;             // 剂量
    frequency?: string;          // 服用频率
    duration?: string;           // 疗程
    instructions?: string;       // 用法说明
    confidence: number;          // 识别置信度 (0-1)
}

/**
 * 病例识别结果
 */
export interface RecognitionResult {
    rawText: string;             // OCR原始文本
    medications: ExtractedMedication[];  // 提取的药物列表
    timestamp: string;           // 识别时间
    imageUri?: string;           // 原图URI
}

/**
 * 相机Hook返回值
 */
export interface UseCameraReturn {
    // 状态
    imageUri: string | null;
    isCapturing: boolean;
    error: string | null;

    // 方法
    takePhoto: () => Promise<string | null>;
    pickFromGallery: () => Promise<string | null>;
    clearImage: () => void;
    clearError: () => void;
}

/**
 * 用药信息提取Hook返回值
 */
export interface UseMedicationExtractorReturn {
    // 状态
    status: RecognitionStatus;
    result: RecognitionResult | null;
    error: string | null;

    // 方法
    extractFromImage: (imageUri: string) => Promise<RecognitionResult | null>;
    clearResult: () => void;
}
