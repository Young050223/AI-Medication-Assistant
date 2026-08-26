export const EMAIL_CONFIRMATION_REQUIRED_MESSAGE = '注册成功，请查收邮箱完成验证后再登录';

export interface AuthSessionLike {
    access_token?: string | null;
    user?: unknown | null;
}

export function hasUsableAuthSession(
    session: AuthSessionLike | null | undefined
): session is AuthSessionLike & { access_token: string; user: unknown } {
    return Boolean(session?.access_token && session.user);
}
