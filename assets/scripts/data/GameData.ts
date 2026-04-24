/**
 * GameData - Singleton chứa toàn bộ data runtime của game.
 * Bao gồm: PlayerData, SlotConfig, SpinResponse hiện tại.
 */

import {
    PlayerData,
    SlotConfig,
    SpinResponse,
    SymbolId,
    ServerSession,
} from './SlotTypes';

// ─── DEFAULT CONFIG (Parsheet mock) ───

const DEFAULT_REEL_STRIPS: number[][] = [
    // Cột 1 (reel 0)
    [
        SymbolId.SEVEN_SINGLE, SymbolId.BAR_SINGLE, SymbolId.SEVEN_DOUBLE,
        SymbolId.RED_LIGHTNING, SymbolId.BAR_DOUBLE, SymbolId.SEVEN_TRIPLE,
        SymbolId.WILD_3X, SymbolId.SEVEN_SINGLE, SymbolId.BAR_SINGLE,
        SymbolId.BLUE_LIGHTNING, SymbolId.SEVEN_DOUBLE, SymbolId.BAR_DOUBLE,
        SymbolId.SEVEN_SINGLE, SymbolId.RED_LIGHTNING, SymbolId.BAR_SINGLE,
        SymbolId.SEVEN_TRIPLE, SymbolId.WILD_3X, SymbolId.SEVEN_DOUBLE,
        SymbolId.BAR_DOUBLE, SymbolId.BLUE_LIGHTNING,
    ],
    // Cột 2 (reel 1)
    [
        SymbolId.BAR_DOUBLE, SymbolId.SEVEN_SINGLE, SymbolId.RED_LIGHTNING,
        SymbolId.SEVEN_DOUBLE, SymbolId.BAR_SINGLE, SymbolId.WILD_3X,
        SymbolId.SEVEN_TRIPLE, SymbolId.BLUE_LIGHTNING, SymbolId.SEVEN_SINGLE,
        SymbolId.BAR_DOUBLE, SymbolId.SEVEN_DOUBLE, SymbolId.BAR_SINGLE,
        SymbolId.RED_LIGHTNING, SymbolId.SEVEN_SINGLE, SymbolId.WILD_3X,
        SymbolId.BAR_DOUBLE, SymbolId.SEVEN_TRIPLE, SymbolId.BAR_SINGLE,
        SymbolId.BLUE_LIGHTNING, SymbolId.SEVEN_DOUBLE,
    ],
    // Cột 3 (reel 2) - có BONUS
    [
        SymbolId.SEVEN_SINGLE, SymbolId.BAR_SINGLE, SymbolId.BONUS,
        SymbolId.SEVEN_DOUBLE, SymbolId.RED_LIGHTNING, SymbolId.BAR_DOUBLE,
        SymbolId.SEVEN_TRIPLE, SymbolId.WILD_3X, SymbolId.SEVEN_SINGLE,
        SymbolId.BLUE_LIGHTNING, SymbolId.BAR_SINGLE, SymbolId.SEVEN_DOUBLE,
        SymbolId.BAR_DOUBLE, SymbolId.RED_LIGHTNING, SymbolId.SEVEN_SINGLE,
        SymbolId.BONUS, SymbolId.BAR_SINGLE, SymbolId.WILD_3X,
        SymbolId.SEVEN_TRIPLE, SymbolId.BLUE_LIGHTNING,
    ],
];

/**
 * 9 Paylines cho slot 3x3.
 * Mỗi payline = [row cột 0, row cột 1, row cột 2], row: 0=top, 1=mid, 2=bot
 */
const DEFAULT_PAYLINES: number[][] = [
    [1, 1, 1], // Line 1: Middle
    [0, 0, 0], // Line 2: Top
    [2, 2, 2], // Line 3: Bottom
    [0, 1, 2], // Line 4: Diagonal ↘
    [2, 1, 0], // Line 5: Diagonal ↗
    [1, 0, 1], // Line 6: V shape top
    [1, 2, 1], // Line 7: V shape bottom
    [2, 1, 2], // Line 8
    [0, 1, 0], // Line 9
];

const DEFAULT_JACKPOT_MULTIPLIERS = {
    GRAND: 500,  // Wild 3X × 3
    MAJOR: 250,  // Red Lightning × 3
    MINOR: 100,  // Blue Lightning × 3
    MINI: 25,    // Mix special
};

const DEFAULT_SLOT_CONFIG: SlotConfig = {
    reelStrips: DEFAULT_REEL_STRIPS,
    freeSpinReelStrips: DEFAULT_REEL_STRIPS,  // Fallback = normal strips nếu chưa có PS FreeSpin
    paylines: DEFAULT_PAYLINES,
    betOptions: [1, 2, 3, 4, 5, 10, 20, 50, 100],
    coinValues: [0.01, 0.02, 0.05, 0.10, 0.20, 0.50, 1.00],
    bigWinThreshold: 10,
    megaWinThreshold: 25,
    superWinThreshold: 50,
    jackpotMultipliers: DEFAULT_JACKPOT_MULTIPLIERS,
};

// ─── GAME DATA SINGLETON ───

export class GameData {
    private static _instance: GameData;

    player: PlayerData = {
        balance: 10000,
        betIndex: 0,
        coinValue: 0.01,
    };

    config: SlotConfig = { ...DEFAULT_SLOT_CONFIG };

    /** Response hiện tại từ server/mock */
    lastSpinResponse: SpinResponse | null = null;

    /**
     * Raw LastSpinResponse từ Enter API (chưa convert sang SpinResponse).
     * Dùng để detect Free Spin resume khi mở lại game.
     * Field names có thể là camelCase (stageType) hoặc PascalCase (NextStage) tuỳ server version.
     */
    rawEnterLastSpinResponse: any = null;

    /** Free spin state */
    freeSpinRemaining: number = 0;
    freeSpinTotalWin: number = 0;
    /**
     * Flag: freeSpinTotalWin được restore từ FeatureSpinTotalWin của server khi resume.
     * Nếu true: số này đã bao gồm toàn bộ tiền thắng (được server tính sẵn) —
     * mock sendClaimRequest KHÔNG add thêm vào balance (tránh double-add).
     * Ràng buộc: chỉ dùng trong mock mode, reset về false sau khi Claim.
     */
    freeSpinTotalWinRestoredFromServer: boolean = false;

    // ═══════════════════════════════════════════════════════════
    //  SERVER SESSION DATA (chỉ populated khi USE_REAL_API = true)
    // ═══════════════════════════════════════════════════════════
    /** Session nhận được sau Login */
    serverSession: ServerSession | null = null;
    /** Sequence number hiện tại — tăng dần sau mỗi SeqRequest thành công */
    currentSeq: number = 0;
    /** Đã login thành công chưa */
    isLoggedIn: boolean = false;
    /** Đã Enter game thành công chưa */
    isEntered: boolean = false;
    /** Last win message ID (cho Jackpot polling) */
    lastWinMsgId: number = 0;
    /** Jackpot values hiện tại [mini, minor, major, grand] */
    jackpotValues: number[] = [0, 0, 0, 0];
    /** Raw PS reel strips (PS IDs gốc từ server — để verify mapping trong spin log) */
    rawPsStrips: number[][] = [];
    /** Raw FreeSpin PS reel strips (PS IDs gốc từ FreeSpinReel.Strips) */
    rawPsFreeSpinStrips: number[][] = [];
    /** Dynamic PS ID → Client SymbolId mapping, được build từ PS JSON symbol ID fields khi Enter */
    psToClientMap: Record<number, number> = {};
    /**
     * Named PS symbol IDs từ ParSheet — dùng để match matchedSymbols (raw PS IDs) → win type.
     * Server gửi PS IDs trong matchedSymbols; compare với các field này để xác định loại thắng.
     * Default -1 = chưa có PS (mock mode) → PayOutDisplay dùng client SymbolId so sánh thay thế.
     */
    psWinTypeIds = {
        oneSeven:    -1 as number,   // OneSevenSymbolID
        doubleSeven: -1 as number,   // DoubleSevenSymbolID
        tripleSeven: -1 as number,   // TripleSevenSymbolID
        anySeven:    -1 as number,   // AnySevenGroupID
        oneBar:      -1 as number,   // OneBarSymbolID
        doubleBar:   -1 as number,   // DoubleBarSymbolID
        anyBar:      -1 as number,   // AnyBarGroupID
        tripleWild:  -1 as number,   // TripleWildSymbolID
        redWild:     -1 as number,   // RedWildSymbolID
        blueWild:    -1 as number,   // BlueWildSymbolID
        anyWild:     -1 as number,   // AnyWildGroupID
    };
    /**
     * Flag: game được vào từ loading.scene (two-scene mode).
     * Set bởi LoadingController trước khi gọi director.loadScene().
     * GameManager dùng để tự detect, không cần isGameScene trong Inspector.
     */
    isFromLoadingScene: boolean = false;
    /**
     * Flag: đang resume Free Spin bị gián đoạn (tắt game giữa chừng).
     * Set bởi GameManager khi _pendingResume có stage FreeSpin.
     * GameEntryController dùng để bỏ qua màn hình guide và vào game ngay.
     */
    isResumingFreeSpin: boolean = false;
    /**
     * Jackpot symbol PS IDs từ ParSheet — dùng để detect jackpot từ rawPsStrips.
     * Server dùng các ID này thay vì winGrade để biểu thị jackpot trên reel.
     * Default = PS.json SuperNova values (nếu chưa có PS → dùng giá trị này).
     */
    jackpotPsIds: { MINI: number; MINOR: number; MAJOR: number; GRAND: number } = {
        MINI: 48, MINOR: 49, MAJOR: 51, GRAND: 52,
    };

    static get instance(): GameData {
        if (!this._instance) {
            this._instance = new GameData();
        }
        return this._instance;
    }

    /** Tổng bet = betOptions[betIndex] * coinValue * 9 lines */
    get totalBet(): number {
        const bet = this.config.betOptions[this.player.betIndex] ?? 1;
        return bet * this.player.coinValue * this.config.paylines.length;
    }

    /**
     * Lấy 3 symbol hiển thị (top, mid, bot) cho 1 reel dựa trên center index.
     * Wrap-around khi vượt ngoài strip.
     */
    getVisibleSymbols(reelIndex: number, centerIndex: number, isFreeSpin: boolean = false): number[] {
        const strips = isFreeSpin ? this.config.freeSpinReelStrips : this.config.reelStrips;
        const strip = strips[reelIndex] ?? this.config.reelStrips[reelIndex];
        const len = strip.length;
        // Step=1, no snap — server trả gì vẽ đó, kể cả empty(-1)
        const center = ((centerIndex % len) + len) % len;
        const top = strip[((center - 1) % len + len) % len];
        const mid = strip[center];
        const bot = strip[(center + 1) % len];
        return [top, mid, bot];
    }

    /** Xác định Win Tier dựa trên totalWin / totalBet */
    getWinTier(totalWin: number): number {
        const ratio = totalWin / this.totalBet;
        if (ratio >= this.config.superWinThreshold) return 4; // SUPER_WIN
        if (ratio >= this.config.megaWinThreshold) return 3;  // MEGA_WIN
        if (ratio >= this.config.bigWinThreshold) return 2;   // BIG_WIN
        if (totalWin > 0) return 1;                           // NORMAL
        return 0;                                              // NONE
    }

    reset(): void {
        this.lastSpinResponse = null;
        this.freeSpinRemaining = 0;
        this.freeSpinTotalWin = 0;
        this.freeSpinTotalWinRestoredFromServer = false;
    }

    /** Reset server session (khi logout hoặc reconnect) */
    resetSession(): void {
        this.serverSession = null;
        this.currentSeq = 0;
        this.isLoggedIn = false;
        this.isEntered = false;
        this.lastWinMsgId = 0;
        this.jackpotValues = [0, 0, 0, 0];
    }

    /** Cập nhật session sau login thành công */
    setServerSession(session: ServerSession): void {
        this.serverSession = session;
        this.currentSeq = session.seq;
        this.isLoggedIn = true;
        // Balance từ server
        this.player.balance = session.cash;
    }

    /** Cập nhật SEQ từ server response (dùng cho SeqRequest APIs) */
    updateSeq(newSeq: number): void {
        this.currentSeq = newSeq;
    }
}
