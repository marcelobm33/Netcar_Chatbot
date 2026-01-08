
export class AuthService {
    constructor(private db: D1Database) {}

    async createToken(label: string): Promise<{ id: number, token: string, label: string }> {
        // Generate a secure random token with prefix
        const randomPart = crypto.randomUUID().replace(/-/g, '');
        const token = `nk_${randomPart}`;

        const result = await this.db.prepare(
            `INSERT INTO api_tokens (token, label) VALUES (?, ?) RETURNING id`
        ).bind(token, label).first<{ id: number }>();

        if (!result) throw new Error('Failed to create token');

        return {
            id: result.id,
            token,
            label
        };
    }

    async validateToken(token: string): Promise<boolean> {
        const result = await this.db.prepare(
            `SELECT id FROM api_tokens WHERE token = ? AND is_active = 1`
        ).bind(token).first();

        if (result) {
            // Update last usage asynchronously (fire and forget)
            // We can't await this inside a validator if we want speed, but D1 is fast.
            // For now, let's just do it. Ideally we should use ctx.waitUntil if available here, 
            // but for simplicity we'll skip the update for every request or do it.
            // Let's do it, it's low volume.
            await this.db.prepare(
                `UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`
            ).bind(result.id).run();
            return true;
        }

        return false;
    }

    async listTokens(): Promise<any[]> {
        const { results } = await this.db.prepare(
            `SELECT id, label, created_at, last_used_at, is_active FROM api_tokens ORDER BY created_at DESC`
        ).all();
        return results;
    }

    async revokeToken(id: number): Promise<void> {
        await this.db.prepare(
            `UPDATE api_tokens SET is_active = 0 WHERE id = ?`
        ).bind(id).run();
    }
}
