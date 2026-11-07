export interface TokenProvider {
    getToken(): Promise<string>;
}

/** Worker supplies a user-bound per-turn token, revoked when the turn settles; no refresh. */
export class StaticTokenProvider implements TokenProvider {
    constructor(private readonly token: string) {}

    async getToken(): Promise<string> {
        return this.token;
    }
}

/** For the worker debug profile, which disables authentication. */
export class NoAuthTokenProvider implements TokenProvider {
    async getToken(): Promise<string> {
        return '';
    }
}
