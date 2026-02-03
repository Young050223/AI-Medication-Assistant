/**
 * @file useSpeechRecognition.ts
 * @description 语音识别Hook - 封装 @capacitor-community/speech-recognition 插件
 * @author AI用药助手开发团队
 * @created 2026-01-28
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

// 动态导入插件（避免Web环境报错）
let SpeechRecognition: any = null;

/**
 * 语音识别状态
 */
interface SpeechRecognitionState {
    /** 是否正在录音 */
    isListening: boolean;
    /** 识别出的文字 */
    transcript: string;
    /** 是否有权限 */
    hasPermission: boolean;
    /** 设备是否支持 */
    isAvailable: boolean;
    /** 错误信息 */
    error: string | null;
    /** 是否正在加载 */
    isLoading: boolean;
}

/**
 * 语音识别Hook返回值
 */
interface UseSpeechRecognitionReturn extends SpeechRecognitionState {
    /** 开始录音 */
    startListening: () => Promise<void>;
    /** 停止录音 */
    stopListening: () => Promise<void>;
    /** 请求权限 */
    requestPermission: () => Promise<boolean>;
    /** 清除文字 */
    clearTranscript: () => void;
    /** 追加文字 */
    appendToTranscript: (text: string) => void;
}

/**
 * 语音识别Hook
 * 封装 @capacitor-community/speech-recognition 插件，提供简洁的React接口
 */
export function useSpeechRecognition(): UseSpeechRecognitionReturn {
    const [state, setState] = useState<SpeechRecognitionState>({
        isListening: false,
        transcript: '',
        hasPermission: false,
        isAvailable: false,
        error: null,
        isLoading: true,
    });

    const listenerRef = useRef<any>(null);

    /**
     * 初始化插件
     */
    useEffect(() => {
        const initPlugin = async () => {
            // 仅在原生平台加载插件
            if (!Capacitor.isNativePlatform()) {
                setState(prev => ({
                    ...prev,
                    isLoading: false,
                    isAvailable: false,
                    error: '语音识别仅在iOS/Android设备上可用',
                }));
                return;
            }

            try {
                // 动态导入插件
                const module = await import('@capacitor-community/speech-recognition');
                SpeechRecognition = module.SpeechRecognition;

                // 检查设备是否支持
                const { available } = await SpeechRecognition.available();

                // 检查权限状态
                const permStatus = await SpeechRecognition.checkPermissions();
                const hasPermission = permStatus.speechRecognition === 'granted';

                setState(prev => ({
                    ...prev,
                    isLoading: false,
                    isAvailable: available,
                    hasPermission,
                    error: available ? null : '此设备不支持语音识别',
                }));
            } catch (err) {
                console.error('[useSpeechRecognition] 初始化失败:', err);
                setState(prev => ({
                    ...prev,
                    isLoading: false,
                    isAvailable: false,
                    error: '语音识别插件加载失败',
                }));
            }
        };

        initPlugin();

        // 清理
        return () => {
            if (listenerRef.current) {
                listenerRef.current.remove();
            }
        };
    }, []);

    /**
     * 请求权限
     */
    const requestPermission = useCallback(async (): Promise<boolean> => {
        if (!SpeechRecognition) {
            setState(prev => ({ ...prev, error: '语音识别不可用' }));
            return false;
        }

        try {
            const result = await SpeechRecognition.requestPermissions();
            const granted = result.speechRecognition === 'granted';

            setState(prev => ({
                ...prev,
                hasPermission: granted,
                error: granted ? null : '语音识别权限被拒绝',
            }));

            return granted;
        } catch (err) {
            console.error('[useSpeechRecognition] 请求权限失败:', err);
            setState(prev => ({ ...prev, error: '请求权限失败' }));
            return false;
        }
    }, []);

    /**
     * 开始录音
     */
    const startListening = useCallback(async (): Promise<void> => {
        if (!SpeechRecognition) {
            setState(prev => ({ ...prev, error: '语音识别不可用' }));
            return;
        }

        if (!state.hasPermission) {
            const granted = await requestPermission();
            if (!granted) return;
        }

        try {
            setState(prev => ({ ...prev, isListening: true, error: null }));

            // 添加结果监听器
            listenerRef.current = await SpeechRecognition.addListener(
                'partialResults',
                (event: { matches?: string[] }) => {
                    if (event.matches && event.matches.length > 0) {
                        setState(prev => ({
                            ...prev,
                            transcript: event.matches![0],
                        }));
                    }
                }
            );

            // 开始识别
            await SpeechRecognition.start({
                language: 'zh-CN',       // 简体中文
                maxResults: 1,
                partialResults: true,    // 实时返回结果
                addPunctuation: true,    // iOS 16+ 自动添加标点
            });
        } catch (err) {
            console.error('[useSpeechRecognition] 开始录音失败:', err);
            setState(prev => ({
                ...prev,
                isListening: false,
                error: '开始录音失败',
            }));
        }
    }, [state.hasPermission, requestPermission]);

    /**
     * 停止录音
     */
    const stopListening = useCallback(async (): Promise<void> => {
        if (!SpeechRecognition) return;

        try {
            await SpeechRecognition.stop();

            if (listenerRef.current) {
                await listenerRef.current.remove();
                listenerRef.current = null;
            }

            setState(prev => ({ ...prev, isListening: false }));
        } catch (err) {
            console.error('[useSpeechRecognition] 停止录音失败:', err);
            setState(prev => ({
                ...prev,
                isListening: false,
                error: '停止录音失败',
            }));
        }
    }, []);

    /**
     * 清除文字
     */
    const clearTranscript = useCallback(() => {
        setState(prev => ({ ...prev, transcript: '' }));
    }, []);

    /**
     * 追加文字（用于手动编辑）
     */
    const appendToTranscript = useCallback((text: string) => {
        setState(prev => ({ ...prev, transcript: prev.transcript + text }));
    }, []);

    return {
        ...state,
        startListening,
        stopListening,
        requestPermission,
        clearTranscript,
        appendToTranscript,
    };
}

export default useSpeechRecognition;
