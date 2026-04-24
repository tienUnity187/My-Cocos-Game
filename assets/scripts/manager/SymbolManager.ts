/**
 * SymbolManager - Ánh xạ Symbol ID → SpriteFrame.
 *
 * Hỗ trợ 2 hệ thống ID:
 *   - Client SymbolId (0-8): dùng bởi SymbolView, GameData mock strips
 *   - PS Symbol ID:          dùng bởi server API, PS.json reel strips
 *
 * Quy ước đặt tên file hình:
 *   assets/textures/symbol/symbol_0.png  →  SymbolId.SEVEN_SINGLE (7)
 *   assets/textures/symbol/symbol_1.png  →  SymbolId.SEVEN_DOUBLE (77)
 *   ...
 *   assets/textures/symbol/symbol_8.png  →  SymbolId.BLUE_LIGHTNING
 *
 * Khi cần hiển thị PS ID, tự động chuyển qua PS_TO_CLIENT mapping.
 */

import { _decorator, SpriteFrame, resources } from 'cc';
import { SymbolId, PS_TO_CLIENT, psToClientSymbol } from '../data/SlotTypes';

// ═══════════════════════════════════════════════════════════
//  SYMBOL ID CONSTANTS (từ Server PS — SuperNova)
// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════
//  CLIENT SYMBOL ID (0-8) → SPRITE NAME MAPPING
// ═══════════════════════════════════════════════════════════

/**
 * Client SymbolId (0-8) → tên file sprite (khớp với file hiện có trong textures/symbol/).
 *
 * ★ Tên file = 'symbol_X' khớp với: symbol_0.png, symbol_1.png, ..., symbol_8.png
 */
export const CLIENT_SPRITE_MAP: Record<number, string> = {
    [SymbolId.SEVEN_SINGLE]:   'symbol_0',  // 7
    [SymbolId.SEVEN_DOUBLE]:   'symbol_1',  // 77
    [SymbolId.SEVEN_TRIPLE]:   'symbol_2',  // 777
    [SymbolId.BAR_SINGLE]:     'symbol_3',  // BAR
    [SymbolId.BAR_DOUBLE]:     'symbol_4',  // BARBAR
    [SymbolId.WILD_3X]:        'symbol_5',  // 3X Wild
    [SymbolId.BONUS]:          'symbol_6',  // Bonus / Scatter
    [SymbolId.RED_LIGHTNING]:  'symbol_7',  // Red Lightning
    [SymbolId.BLUE_LIGHTNING]: 'symbol_8',  // Blue Lightning
};

/**
 * PS Symbol ID → tên file sprite (auto-convert qua PS_TO_CLIENT rồi tra CLIENT_SPRITE_MAP).
 * Dùng cho paytable, guide screen, v.v.
 */
export function getPSSpriteNameById(psId: number): string {
    const clientId = psToClientSymbol(psId);
    return CLIENT_SPRITE_MAP[clientId] ?? 'symbol_0';
}

// ═══════════════════════════════════════════════════════════
//  SYMBOL MANAGER
// ═══════════════════════════════════════════════════════════

export class SymbolManager {
    private static _instance: SymbolManager;
    /** Cache SpriteFrame đã load (key = client SymbolId 0-8) */
    private _spriteCache: Map<number, SpriteFrame> = new Map();

    static get instance(): SymbolManager {
        if (!this._instance) {
            this._instance = new SymbolManager();
        }
        return this._instance;
    }

    /**
     * Lấy tên sprite cho Client SymbolId (0-8).
     */
    getSpriteName(clientSymbolId: number): string {
        return CLIENT_SPRITE_MAP[clientSymbolId] ?? 'symbol_0';
    }

    /**
     * Lấy tên sprite cho PS Symbol ID (1-52).
     * Auto-convert qua PS_TO_CLIENT trước.
     */
    getSpriteNameByPSId(psId: number): string {
        return getPSSpriteNameById(psId);
    }

    /**
     * Lấy SpriteFrame cho Client SymbolId (0-8), async + cache.
     * Load từ resources/textures/symbol/{spriteName}/spriteFrame
     */
    async getSpriteFrame(clientSymbolId: number): Promise<SpriteFrame | null> {
        const cached = this._spriteCache.get(clientSymbolId);
        if (cached) return cached;

        const spriteName = this.getSpriteName(clientSymbolId);
        const path = `textures/symbol/${spriteName}/spriteFrame`;

        return new Promise((resolve) => {
            resources.load(path, SpriteFrame, (err, spriteFrame) => {
                if (err) {
                    console.warn(`[SymbolManager] Failed to load sprite for ClientID ${clientSymbolId}: ${path}`, err);
                    resolve(null);
                    return;
                }
                this._spriteCache.set(clientSymbolId, spriteFrame);
                resolve(spriteFrame);
            });
        });
    }

    /**
     * Lấy SpriteFrame cho PS Symbol ID (1-52), auto-convert + cache.
     */
    async getSpriteFrameByPSId(psId: number): Promise<SpriteFrame | null> {
        const clientId = psToClientSymbol(psId);
        if (clientId < 0) return null; // Empty symbol
        return this.getSpriteFrame(clientId);
    }

    /**
     * Preload tất cả SpriteFrame (0-8).
     * Gọi 1 lần khi game khởi tạo (sau Enter thành công).
     */
    async preloadReelSymbols(): Promise<void> {
        const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        const promises = ids.map((id) => this.getSpriteFrame(id));
        await Promise.all(promises);
        // console.log(`[SymbolManager] Preloaded ${ids.length} symbol sprites`);
    }

    /** Xóa cache (khi chuyển scene hoặc hot reload) */
    clearCache(): void {
        this._spriteCache.clear();
    }
}
