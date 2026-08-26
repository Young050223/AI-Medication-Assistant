/**
 * @file agent-bootstrap/index.ts
 * @description Agent 进入前引导接口（读取或预生成个性化问题）
 * @endpoint POST /functions/v1/agent-bootstrap
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleSuggestionRequest } from '../_shared/agent_suggestions.ts';

serve(async (req) => {
    return await handleSuggestionRequest(req, {
        serviceName: 'agent-bootstrap',
        forceRefreshDefault: false,
    });
});
