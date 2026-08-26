/**
 * @file generate-agent-suggestions/index.ts
 * @description 强制生成 Agent 个性化问题接口
 * @endpoint POST /functions/v1/generate-agent-suggestions
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleSuggestionRequest } from '../_shared/agent_suggestions.ts';

serve(async (req) => {
    return await handleSuggestionRequest(req, {
        serviceName: 'generate-agent-suggestions',
        forceRefreshDefault: true,
    });
});
