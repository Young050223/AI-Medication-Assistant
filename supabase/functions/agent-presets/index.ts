/**
 * @file agent-presets/index.ts
 * @description 兼容入口：转发到新的 Stage-6 建议问题生成逻辑
 * @endpoint POST /functions/v1/agent-presets
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleSuggestionRequest } from '../_shared/agent_suggestions.ts';

serve(async (req) => {
    return await handleSuggestionRequest(req, {
        serviceName: 'agent-presets',
        forceRefreshDefault: false,
    });
});
