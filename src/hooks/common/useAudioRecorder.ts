/**
 * @file useAudioRecorder.ts
 * @description 基于 MediaRecorder 的音频采集 Hook（用于上传到云端 ASR）
 */

import { useCallback, useMemo, useRef, useState } from 'react';

interface StartRecordingOptions {
    timesliceMs?: number;
    onChunk?: (chunk: Blob) => void | Promise<void>;
}

interface UseAudioRecorderReturn {
    isAvailable: boolean;
    isRecording: boolean;
    mimeType: string | null;
    error: string | null;
    startRecording: (options?: StartRecordingOptions) => Promise<void>;
    stopRecording: () => Promise<void>;
    clearError: () => void;
}

const CANDIDATE_MIME_TYPES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
];

function getPreferredMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const mimeType of CANDIDATE_MIME_TYPES) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }
    }
    return '';
}

export function useAudioRecorder(): UseAudioRecorderReturn {
    const [isRecording, setIsRecording] = useState(false);
    const [mimeType, setMimeType] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const onChunkRef = useRef<NonNullable<StartRecordingOptions['onChunk']> | null>(null);

    const isAvailable = useMemo(() => {
        return typeof window !== 'undefined'
            && !!navigator?.mediaDevices?.getUserMedia
            && typeof MediaRecorder !== 'undefined';
    }, []);

    const cleanup = useCallback(() => {
        if (recorderRef.current) {
            recorderRef.current.ondataavailable = null;
            recorderRef.current.onstop = null;
            recorderRef.current.onerror = null;
            recorderRef.current = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        onChunkRef.current = null;
        setIsRecording(false);
    }, []);

    const startRecording = useCallback(async (options?: StartRecordingOptions) => {
        if (!isAvailable) {
            setError('当前设备不支持音频录制');
            return;
        }

        if (isRecording) return;
        setError(null);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const preferredMimeType = getPreferredMimeType();
            const recorder = preferredMimeType
                ? new MediaRecorder(stream, { mimeType: preferredMimeType })
                : new MediaRecorder(stream);

            streamRef.current = stream;
            recorderRef.current = recorder;
            onChunkRef.current = options?.onChunk ?? null;
            setMimeType(recorder.mimeType || preferredMimeType || null);

            recorder.ondataavailable = (event: BlobEvent) => {
                if (!event.data || event.data.size <= 0) return;
                void onChunkRef.current?.(event.data);
            };

            recorder.onerror = () => {
                setError('录音过程中出现错误');
            };

            recorder.start(options?.timesliceMs ?? 2200);
            setIsRecording(true);
        } catch (err) {
            console.error('[useAudioRecorder] startRecording error:', err);
            setError('无法启动录音，请检查麦克风权限');
            cleanup();
        }
    }, [cleanup, isAvailable, isRecording]);

    const stopRecording = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === 'inactive') {
            cleanup();
            return;
        }

        await new Promise<void>((resolve) => {
            recorder.onstop = () => {
                cleanup();
                resolve();
            };
            recorder.stop();
        });
    }, [cleanup]);

    const clearError = useCallback(() => setError(null), []);

    return {
        isAvailable,
        isRecording,
        mimeType,
        error,
        startRecording,
        stopRecording,
        clearError,
    };
}

export default useAudioRecorder;
