/**
 * @file useMedicationExtractor.ts
 * @description 药物信息提取 Hook (OCR处理)
 * @author AI用药助手开发团队
 * @created 2026-02-03
 */

import { useState, useCallback } from 'react';
import type { ExtractedMedication } from '../../types/MedicalRecord.types';

export type ExtractionStatus = 'idle' | 'extracting' | 'success' | 'error';

export interface ExtractionResult {
    medications: ExtractedMedication[];
    rawText?: string;
}

export interface UseMedicationExtractorReturn {
    medications: ExtractedMedication[];
    status: ExtractionStatus;
    result: ExtractionResult | null;
    isExtracting: boolean;
    error: string | null;
    extractFromImage: (imageBase64: string) => Promise<ExtractedMedication[]>;
    clearResults: () => void;
    clearResult: () => void;
}

/**
 * 药物信息提取 Hook
 */
export function useMedicationExtractor(): UseMedicationExtractorReturn {
    const [medications, setMedications] = useState<ExtractedMedication[]>([]);
    const [status, setStatus] = useState<ExtractionStatus>('idle');
    const [result, setResult] = useState<ExtractionResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    /**
     * 从图像提取药物信息
     */
    const extractFromImage = useCallback(async (
        _imageBase64: string
    ): Promise<ExtractedMedication[]> => {
        setStatus('extracting');
        setError(null);

        try {
            // 模拟OCR处理 - 实际实现需要连接真正的OCR服务
            console.log('[useMedicationExtractor] Processing image...');

            // TODO: 集成真正的OCR服务 (如Google Cloud Vision, Azure, AWS Textract等)
            // 暂时返回示例数据
            await new Promise(resolve => setTimeout(resolve, 1500));

            const mockMedications: ExtractedMedication[] = [
                {
                    name: '阿莫西林胶囊',
                    dosage: '0.5g',
                    frequency: '每日3次',
                    duration: '7天',
                    instructions: '餐后服用',
                    confidence: 0.95,
                },
                {
                    name: '布洛芬片',
                    dosage: '400mg',
                    frequency: '需要时',
                    duration: '按需',
                    instructions: '饭后服用，每日不超过3次',
                    confidence: 0.88,
                },
            ];

            const extractionResult: ExtractionResult = {
                medications: mockMedications,
                rawText: '处方示例文本',
            };

            setMedications(mockMedications);
            setResult(extractionResult);
            setStatus('success');
            return mockMedications;
        } catch (err) {
            console.error('[useMedicationExtractor] Extract error:', err);
            setError('提取药物信息失败');
            setStatus('error');
            return [];
        }
    }, []);

    /**
     * 清除结果
     */
    const clearResults = useCallback(() => {
        setMedications([]);
        setResult(null);
        setStatus('idle');
        setError(null);
    }, []);

    return {
        medications,
        status,
        result,
        isExtracting: status === 'extracting',
        error,
        extractFromImage,
        clearResults,
        clearResult: clearResults, // 别名
    };
}

export default useMedicationExtractor;
