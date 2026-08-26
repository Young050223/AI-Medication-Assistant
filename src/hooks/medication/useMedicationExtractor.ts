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
    provider?: 'mock' | 'api';
    usedFallback?: boolean;
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

const OCR_API_URL = import.meta.env.VITE_OCR_API_URL as string | undefined;

function normalizeExtractedMedication(value: unknown): ExtractedMedication | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) return null;

    const confidenceRaw = Number(item.confidence);
    return {
        name,
        dosage: typeof item.dosage === 'string' ? item.dosage : undefined,
        frequency: typeof item.frequency === 'string' ? item.frequency : undefined,
        duration: typeof item.duration === 'string' ? item.duration : undefined,
        instructions: typeof item.instructions === 'string' ? item.instructions : undefined,
        confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.8,
    };
}

/**
 * 药物信息提取 Hook
 */
export function useMedicationExtractor(): UseMedicationExtractorReturn {
    const [medications, setMedications] = useState<ExtractedMedication[]>([]);
    const [status, setStatus] = useState<ExtractionStatus>('idle');
    const [result, setResult] = useState<ExtractionResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const mockExtraction = useCallback(async (): Promise<ExtractionResult> => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
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

        return {
            medications: mockMedications,
            rawText: '处方示例文本（Mock）',
            provider: 'mock',
            usedFallback: true,
        };
    }, []);

    const extractViaApi = useCallback(async (imageBase64: string): Promise<ExtractionResult | null> => {
        if (!OCR_API_URL) return null;

        const response = await fetch(OCR_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageBase64 }),
        });

        if (!response.ok) {
            throw new Error(`OCR API failed: ${response.status}`);
        }

        const data = await response.json();
        const medicationsRaw = Array.isArray(data?.medications) ? data.medications : [];
        const extracted = medicationsRaw
            .map((item: unknown) => normalizeExtractedMedication(item))
            .filter((item: ExtractedMedication | null): item is ExtractedMedication => !!item);

        if (extracted.length === 0) return null;

        return {
            medications: extracted,
            rawText: typeof data?.rawText === 'string' ? data.rawText : '',
            provider: 'api',
            usedFallback: false,
        };
    }, []);

    /**
     * 从图像提取药物信息
     */
    const extractFromImage = useCallback(async (
        imageBase64: string
    ): Promise<ExtractedMedication[]> => {
        setStatus('extracting');
        setError(null);

        try {
            console.log('[useMedicationExtractor] Processing image...');
            let extractionResult: ExtractionResult | null = null;

            if (OCR_API_URL) {
                try {
                    extractionResult = await extractViaApi(imageBase64);
                } catch (apiError) {
                    console.warn('[useMedicationExtractor] OCR API failed, fallback to mock:', apiError);
                }
            }

            if (!extractionResult) {
                extractionResult = await mockExtraction();
            }

            setMedications(extractionResult.medications);
            setResult(extractionResult);
            setStatus('success');
            return extractionResult.medications;
        } catch (err) {
            console.error('[useMedicationExtractor] Extract error:', err);
            setError('提取药物信息失败');
            setStatus('error');
            return [];
        }
    }, [extractViaApi, mockExtraction]);

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
        clearResult: clearResults,
    };
}

export default useMedicationExtractor;
