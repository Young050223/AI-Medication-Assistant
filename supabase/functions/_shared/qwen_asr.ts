const DEFAULT_QWEN_ASR_MODEL = 'qwen3-asr-flash';
const DEFAULT_DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export interface QwenAsrResult {
    transcript: string;
    model: string;
}

interface TranscribeOptions {
    audioBlob: Blob;
    apiKey: string;
    language?: 'zh' | 'en';
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
    if (!blob || blob.size <= 0) {
        throw new Error('未检测到有效音频');
    }

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
        const subArray = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...subArray);
    }

    return `data:${blob.type || 'audio/webm'};base64,${btoa(binary)}`;
}

export function extractAssistantText(payload: any): string {
    const messageContent = payload?.choices?.[0]?.message?.content;
    if (typeof messageContent === 'string') {
        return messageContent.trim();
    }

    if (Array.isArray(messageContent)) {
        const textParts = messageContent
            .map((item) => {
                if (!item) return '';
                if (typeof item === 'string') return item;
                if (typeof item.text === 'string') return item.text;
                if (typeof item.content === 'string') return item.content;
                return '';
            })
            .filter(Boolean);
        if (textParts.length > 0) {
            return textParts.join('\n').trim();
        }
    }

    const altCandidates = [
        payload?.choices?.[0]?.message?.audio?.transcript,
        payload?.choices?.[0]?.text,
        payload?.output_text,
        payload?.output?.text,
    ];

    for (const candidate of altCandidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }

    return '';
}

export async function transcribeAudioBlobWithQwen(options: TranscribeOptions): Promise<QwenAsrResult> {
    const model = Deno.env.get('QWEN_ASR_MODEL') || DEFAULT_QWEN_ASR_MODEL;
    const baseUrl = (Deno.env.get('DASHSCOPE_BASE_URL') || DEFAULT_DASHSCOPE_BASE_URL).trim();
    const audioDataUrl = await blobToDataUrl(options.audioBlob);
    const asrOptions: Record<string, unknown> = {
        enable_itn: false,
    };
    if (options.language) {
        asrOptions.language = options.language;
    }

    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            stream: false,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'input_audio',
                            input_audio: {
                                data: audioDataUrl,
                            },
                        },
                    ],
                },
            ],
            asr_options: asrOptions,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Qwen ASR error: ${response.status} - ${errorText}`);
    }

    const payload = await response.json();
    const transcript = extractAssistantText(payload);
    if (!transcript) {
        throw new Error('Qwen ASR 未返回有效转写文本');
    }

    return {
        transcript,
        model,
    };
}
