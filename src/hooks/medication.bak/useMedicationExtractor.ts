/**
 * @file useMedicationExtractor.ts
 * @description 用药信息提取Hook，从图片中识别并提取药物信息
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-18
 * 
 * 说明：
 * - 当前版本使用模拟OCR（用于开发测试）
 * - 生产环境将通过Capacitor插件调用iOS原生Vision框架进行OCR识别
 * - 预留API接口用于接入您提供的药物信息API
 */

import { useState, useCallback } from 'react';
import type {
    RecognitionStatus,
    RecognitionResult,
    ExtractedMedication,
    UseMedicationExtractorReturn,
} from '../../types/MedicalRecord.types';

// 常见药物关键词（用于模拟识别）
const COMMON_MEDICATIONS = [
    { pattern: /阿莫西林/g, name: '阿莫西林胶囊' },
    { pattern: /布洛芬/g, name: '布洛芬缓释胶囊' },
    { pattern: /头孢/g, name: '头孢克肟分散片' },
    { pattern: /阿司匹林/g, name: '阿司匹林肠溶片' },
    { pattern: /甲硝唑/g, name: '甲硝唑片' },
    { pattern: /奥美拉唑/g, name: '奥美拉唑肠溶胶囊' },
    { pattern: /二甲双胍/g, name: '盐酸二甲双胍片' },
    { pattern: /氯雷他定/g, name: '氯雷他定片' },
];

// 频率关键词
const FREQUENCY_PATTERNS = [
    { pattern: /每日[一1]次|一天[一1]次|qd/gi, value: '每日1次' },
    { pattern: /每日[二2两]次|一天[二2两]次|bid/gi, value: '每日2次' },
    { pattern: /每日[三3]次|一天[三3]次|tid/gi, value: '每日3次' },
    { pattern: /每[48]小时/gi, value: '每8小时1次' },
    { pattern: /睡前|晚上/gi, value: '睡前1次' },
];

/**
 * 用药信息提取Hook
 * 从病例图片中识别并提取药物信息
 * 
 * @returns {UseMedicationExtractorReturn} 识别状态和方法
 * 
 * @example
 * const { status, result, extractFromImage } = useMedicationExtractor();
 * 
 * // 从图片提取
 * const medications = await extractFromImage(imageUri);
 */
export function useMedicationExtractor(): UseMedicationExtractorReturn {
    // 状态
    const [status, setStatus] = useState<RecognitionStatus>('idle');
    const [result, setResult] = useState<RecognitionResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    /**
     * 模拟OCR识别（开发用）
     * 生产环境将替换为iOS Vision OCR
     */
    const simulateOCR = useCallback(async (_imageUri: string): Promise<string> => {
        // 模拟处理延迟
        await new Promise(resolve => setTimeout(resolve, 1500));

        // 模拟识别的处方文本
        // 实际生产中，这里将调用iOS原生Vision OCR
        const mockPrescriptionText = `
      处方笺
      患者姓名：张三  年龄：65岁
      诊断：上呼吸道感染
      
      Rp:
      1. 阿莫西林胶囊 0.5g × 24粒
         用法：每日3次，每次1粒，饭后服用
         疗程：7天
      
      2. 布洛芬缓释胶囊 0.3g × 12粒
         用法：每日2次，每次1粒
         发热时服用
      
      3. 复方甘草片 × 30片
         用法：每日3次，每次3片
         
      医师签名：李医生
      日期：2026-01-18
    `;

        return mockPrescriptionText;
    }, []);

    /**
     * 从文本中提取药物信息
     */
    const extractMedicationsFromText = useCallback((text: string): ExtractedMedication[] => {
        const medications: ExtractedMedication[] = [];

        // 按行分割，查找药物
        const lines = text.split('\n');
        let currentMed: ExtractedMedication | null = null;

        for (const line of lines) {
            const trimmedLine = line.trim();

            // 检查是否是新药物行（通常以数字开头或包含药物关键词）
            const isNewMedLine = /^\d+[.、]/.test(trimmedLine);

            if (isNewMedLine) {
                // 保存之前的药物
                if (currentMed) {
                    medications.push(currentMed);
                }

                // 查找药物名称
                let medName = '';
                let confidence = 0.7;

                for (const med of COMMON_MEDICATIONS) {
                    if (med.pattern.test(trimmedLine)) {
                        medName = med.name;
                        confidence = 0.95;
                        break;
                    }
                }

                // 如果没匹配到，尝试提取括号前的文本作为药名
                if (!medName) {
                    const match = trimmedLine.match(/^\d+[.、]\s*(.+?)(?:\s|×|$)/);
                    if (match) {
                        medName = match[1].trim();
                    }
                }

                if (medName) {
                    currentMed = {
                        name: medName,
                        confidence,
                    };

                    // 提取剂量
                    const dosageMatch = trimmedLine.match(/(\d+(?:\.\d+)?)\s*(g|mg|ml|片|粒|包)/i);
                    if (dosageMatch) {
                        currentMed.dosage = dosageMatch[0];
                    }
                }
            } else if (currentMed && trimmedLine.includes('用法')) {
                // 提取服用频率
                for (const freq of FREQUENCY_PATTERNS) {
                    if (freq.pattern.test(trimmedLine)) {
                        currentMed.frequency = freq.value;
                        break;
                    }
                }

                // 提取用法说明
                currentMed.instructions = trimmedLine.replace(/用法[：:]\s*/, '');
            } else if (currentMed && trimmedLine.includes('疗程')) {
                // 提取疗程
                const durationMatch = trimmedLine.match(/(\d+)\s*(天|周|月)/);
                if (durationMatch) {
                    currentMed.duration = durationMatch[0];
                }
            }
        }

        // 添加最后一个药物
        if (currentMed) {
            medications.push(currentMed);
        }

        return medications;
    }, []);

    /**
     * 从图片提取用药信息
     * @param imageUri - 图片URI
     * @returns 识别结果
     */
    const extractFromImage = useCallback(async (imageUri: string): Promise<RecognitionResult | null> => {
        try {
            setError(null);
            setStatus('processing');

            console.log('[useMedicationExtractor] 开始识别:', imageUri);

            // 调用OCR识别
            // 当前使用模拟OCR，生产环境将调用iOS原生Vision OCR
            const rawText = await simulateOCR(imageUri);

            // 提取药物信息
            const medications = extractMedicationsFromText(rawText);

            const recognitionResult: RecognitionResult = {
                rawText,
                medications,
                timestamp: new Date().toISOString(),
                imageUri,
            };

            setResult(recognitionResult);
            setStatus('success');

            console.log('[useMedicationExtractor] 识别成功:', medications.length, '种药物');

            return recognitionResult;
        } catch (err: any) {
            console.error('[useMedicationExtractor] 识别失败:', err);
            setError(err.message || '识别失败');
            setStatus('error');
            return null;
        }
    }, [simulateOCR, extractMedicationsFromText]);

    /**
     * 清除识别结果
     */
    const clearResult = useCallback(() => {
        setResult(null);
        setStatus('idle');
        setError(null);
    }, []);

    return {
        status,
        result,
        error,
        extractFromImage,
        clearResult,
    };
}

export default useMedicationExtractor;
