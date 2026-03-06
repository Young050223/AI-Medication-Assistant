/**
 * @file useConversationHistory.ts
 * @description 对话历史管理 Hook（分页/刷新/删除）
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../user/useAuth';
import {
    deleteConversation,
    fetchConversationList,
    type ConversationListItem,
} from '../../services/agentApi';

const DEFAULT_PAGE_SIZE = 20;

export interface UseConversationHistoryReturn {
    conversations: ConversationListItem[];
    isLoading: boolean;
    isLoadingMore: boolean;
    deletingId: string | null;
    error: string | null;
    hasMore: boolean;
    refresh: () => Promise<void>;
    loadMore: () => Promise<void>;
    deleteById: (conversationId: string) => Promise<boolean>;
}

export function useConversationHistory(pageSize: number = DEFAULT_PAGE_SIZE): UseConversationHistoryReturn {
    const { user } = useAuth();

    const [conversations, setConversations] = useState<ConversationListItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);

    const loadPage = useCallback(async (targetPage: number, append: boolean) => {
        if (!user?.id) {
            setConversations([]);
            setHasMore(false);
            return;
        }

        if (append) {
            setIsLoadingMore(true);
        } else {
            setIsLoading(true);
        }
        setError(null);

        try {
            const result = await fetchConversationList(user.id, targetPage, pageSize);
            if (!result.success) {
                setError(result.error || '加载历史对话失败');
                return;
            }

            setConversations((prev) => append
                ? [...prev, ...(result.conversations || [])]
                : (result.conversations || []));
            setHasMore(targetPage * pageSize < result.total);
            setPage(targetPage);
        } catch (err) {
            setError(err instanceof Error ? err.message : '加载历史对话失败');
        } finally {
            if (append) {
                setIsLoadingMore(false);
            } else {
                setIsLoading(false);
            }
        }
    }, [pageSize, user?.id]);

    const refresh = useCallback(async () => {
        await loadPage(1, false);
    }, [loadPage]);

    const loadMore = useCallback(async () => {
        if (!hasMore || isLoadingMore || isLoading) return;
        await loadPage(page + 1, true);
    }, [hasMore, isLoading, isLoadingMore, loadPage, page]);

    const deleteById = useCallback(async (conversationId: string): Promise<boolean> => {
        setDeletingId(conversationId);
        setError(null);

        try {
            const result = await deleteConversation(conversationId);
            if (!result.success) {
                setError(result.error || '删除对话失败');
                return false;
            }

            setConversations((prev) => prev.filter((item) => item.id !== conversationId));
            return true;
        } finally {
            setDeletingId(null);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {
        conversations,
        isLoading,
        isLoadingMore,
        deletingId,
        error,
        hasMore,
        refresh,
        loadMore,
        deleteById,
    };
}

export default useConversationHistory;
