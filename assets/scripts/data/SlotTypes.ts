/**
 * SlotTypes - Định nghĩa tất cả Type, Enum, Interface cho game slot.
 * @updated IBonusItem added
 */

// ─── ENUMS ───

export enum SlotStageType {
    SPIN = 0,
    FREE_SPIN_START = 3,
    FREE_SPIN = 4,
    FREE_SPIN_RE_TRIGGER = 5,
    BUY_FREE_SPIN_START = 8,
    BUY_FREE_SPIN = 9,
    NEED_CLAIM = 100,
    FREE_SPIN_END = 101,
    BUY_FREE_SPIN_END = 107,
}

export enum SymbolId {
    SEVEN_SINGLE = 0,    // 7
    SEVEN_DOUBLE = 1,    // 77
    SEVEN_TRIPLE = 2,    // 777
    BAR_SINGLE = 3,      // BAR
    BAR_DOUBLE = 4,      // BARBAR
    WILD_3X = 5,         // 3X Wild
    BONUS = 6,           // Bonus (chỉ cột 3)
    RED_LIGHTNING = 7,   // Red Lightning
    BLUE_LIGHTNING = 8,  // Blue Lightning
}

// ═══════════════════════════════════════════════════════════
//  PS ↔ CLIENT SYMBOL ID MAPPING
// ═══════════════════════════════════════════════════════════

/**
 * Bảng chuyển đổi: PS.json Symbol ID → Client SymbolId (0-8).
 *
 * Server PS Symbol IDs (SuperNova):
 *   OneSeven=12, DoubleSeven=13, TripleSeven=14,
 *   OneBar=2, DoubleBar=3,
 *   BlueWild=21, RedWild=22, TripleWild=23,
 *   Scatter=98, Empty=99,
 *   AnySevenGroup=11, AnyBarGroup=1, AnyWildGroup=100,
 *   MiniJackpot=81, MinorJackpot=82, MajorJackpot=83, GrandJackpot=84
 *
 * ★ Runtime: _applyPS() builds dynamic mapping từ PS JSON fields.
 *   Static mapping này dùng cho utility/paytable khi offline.
 */
export const PS_TO_CLIENT: Record<number, number> = {
    // ─── Symbol IDs chính (xuất hiện trên reel strip) ───
    12: SymbolId.SEVEN_SINGLE,     // OneSevenSymbolID → 7
    13: SymbolId.SEVEN_DOUBLE,     // DoubleSevenSymbolID → 77
    14: SymbolId.SEVEN_TRIPLE,     // TripleSevenSymbolID → 777
    2:  SymbolId.BAR_SINGLE,       // OneBarSymbolID → BAR
    3:  SymbolId.BAR_DOUBLE,       // DoubleBarSymbolID → BARBAR
    23: SymbolId.WILD_3X,          // TripleWildSymbolID → 3X Wild
    22: SymbolId.RED_LIGHTNING,    // RedWildSymbolID → Red Lightning
    21: SymbolId.BLUE_LIGHTNING,   // BlueWildSymbolID → Blue Lightning
    98: SymbolId.BONUS,            // ScatterSymbolID → Bonus/Scatter
    99: -1,                        // EmptySymbolID → no sprite (spacer)

    // ─── Group IDs (payout table, không xuất hiện trên strip) ───
    11:  SymbolId.SEVEN_SINGLE,    // AnySevenGroupID → 7 (đại diện)
    1:   SymbolId.BAR_SINGLE,      // AnyBarGroupID → BAR (đại diện)
    100: SymbolId.WILD_3X,         // AnyWildGroupID → 3X (đại diện)
};

/** Bảng ngược: Client SymbolId (0-8) → PS.json Symbol ID chính */
export const CLIENT_TO_PS: Record<number, number> = {
    [SymbolId.SEVEN_SINGLE]:   12,
    [SymbolId.SEVEN_DOUBLE]:   13,
    [SymbolId.SEVEN_TRIPLE]:   14,
    [SymbolId.BAR_SINGLE]:     2,
    [SymbolId.BAR_DOUBLE]:     3,
    [SymbolId.WILD_3X]:        23,
    [SymbolId.BONUS]:          98,
    [SymbolId.RED_LIGHTNING]:  22,
    [SymbolId.BLUE_LIGHTNING]: 21,
};

/**
 * Chuyển PS Symbol ID → Client SymbolId chuẩn (cho SymbolView).
 * Trả về -1 nếu không map được (empty, virtual ID, v.v.)
 */
export function psToClientSymbol(psId: number): number {
    return PS_TO_CLIENT[psId] ?? -1;
}

/**
 * Chuyển toàn bộ PS reel strips → Client reel strips.
 * Dùng khi parse Parsheet từ server Enter response.
 */
export function convertPSStrips(psStrips: number[][]): number[][] {
    return psStrips.map((strip) =>
        strip.map((psId) => PS_TO_CLIENT[psId] ?? 0)
    );
}

export enum JackpotType {
    NONE = 0,
    MINI = 1,
    MINOR = 2,
    MAJOR = 3,
    GRAND = 4,
}

export enum WinTier {
    NONE = 0,
    NORMAL = 1,
    BIG_WIN = 2,
    SUPER_WIN = 3,
    EPIC_WIN = 4,
    MEGA_WIN = 5,
}

/** State machine — trạng thái hiện tại của vòng spin */
export enum GameState {
    IDLE = 'idle',           // Chờ người chơi nhấn Spin
    SPINNING = 'spinning',   // Reel đang quay
    RESULT = 'result',       // Đang xử lý kết quả (payline anim, count-up)
    FREE_SPIN = 'freespin',  // Trong vòng Free Spin
    POPUP = 'popup',         // Popup đang hiển thị (block toàn bộ input)
}

// ─── INTERFACES ───

export interface MatchedLinePay {
    payLineIndex: number;
    payout: number;
    matchedSymbols: number[];
    containsWild: boolean;
    reelCnt: number;                  // Số reel tham gia win (thường = 3)
    /**
     * Vị trí chính xác từng ô thắng theo server.
     * Format: [{Item1: reelCol (0-2), Item2: rowIndex (0=top,1=mid,2=bot)}, ...]
     * Lấy từ MatchedSymbolsIndices[0] (inner array).
     */
    matchedSymbolsIndices: Array<{Item1: number; Item2: number}> | null;
}

export interface SpinResponse {
    rands: number[];                // Mảng 3 phần tử, index tâm của 3 cột
    matchedLinePays: MatchedLinePay[];
    totalBet: number;
    totalWin: number;
    updateCash: boolean;
    nextStage: number;              // SlotStageType
    featureMultiple?: number;       // 2x - 20x cho Free Spin
    remainCash?: number;            // Balance sau spin (từ server, đã trừ bet + cộng win)
    remainFreeSpinCount?: number;   // Số free spin còn lại (từ server res.RemainFreeSpinCount)
    winGrade?: string;              // "Normal" | "Big" | "Super" | "Mega" (từ server)
    featureSpinTotalWin?: number;   // Tổng tích lũy win trong feature spin (từ server FeatureSpinTotalWin)
}

export interface PlayerData {
    balance: number;
    betIndex: number;
    coinValue: number;
}

/** Config cố định từ Parsheet */
export interface SlotConfig {
    reelStrips: number[][];          // 3 strips Normal Spin, mỗi strip là mảng SymbolId
    freeSpinReelStrips: number[][];  // 3 strips Free Spin (khác với Normal Spin strips)
    paylines: number[][];            // 9 paylines, mỗi line là mảng 3 row-index (0-2)
    betOptions: number[];            // Mức bet: [1, 2, 3, 5, 10, ...]
    coinValues: number[];            // CoinValue: [0.01, 0.02, 0.05, ...]
    bigWinThreshold: number;         // Bội số totalBet để coi là BigWin
    megaWinThreshold: number;
    superWinThreshold: number;
    jackpotMultipliers?: {
        // Jackpot payout = totalBet × multiplier
        GRAND: number;   // Wild 3X × 3 — mặc định: 500
        MAJOR: number;   // Red Lightning × 3 — mặc định: 250
        MINOR: number;   // Blue Lightning × 3 — mặc định: 100
        MINI: number;    // Mix special — mặc định: 25
    };
}

// ═══════════════════════════════════════════════════════════
//  SERVER API TYPES (dùng khi USE_REAL_API = true)
// ═══════════════════════════════════════════════════════════

/** Session data nhận được sau khi Login thành công */
export interface ServerSession {
    nick: string;
    serverTime: string;
    clientIp: string;
    sessionKey: bigint;       // Int64 — dùng làm SKEY cho mọi request sau (dùng BigInt để tránh mất precision)
    sessionUpdateSec: number;
    memberIdx: number;        // Int64 — dùng làm MIDX (giá trị thực tế nhỏ, number là đủ)
    seq: number;              // Sequence number khởi đầu
    uid: string;
    cash: number;             // Balance thực từ server
    aky: string;              // AES-256 key cho mọi request sau login
    currency: string;
    country: string;
    isNewAccount: boolean;
    useBroadcast: boolean;
    isPractice?: boolean;
    smm: ServerMaintenanceMessage | null;
}

/** Enter response — data game khởi tạo */
export interface ServerEnterResponse {
    cash: number;
    slotName: string;
    ps: string;               // Base64 par sheet data
    betIndex: number;
    coinValueIndex: number;
    lastSpinResponse: any;    // ISpinResponse từ server
    isPractice: boolean;
    memberIdx: number;
    smm: ServerMaintenanceMessage | null;
}

/** Spin response từ server (AckSpin) — ALL PascalCase theo actual API */
export interface ServerSpinResponse {
    RemainCash: number;
    Res: {
        Rands: number[];
        MatchedLinePays: ServerMatchedLinePay[];
        UpdateCash: boolean;
        TotalBet: number;
        TotalWin: number;
        NextStage: number;
        WinGrade: string | null;
        FeatureSpinTotalWin: number;
        FeatureSpinWin: number;
        RemainFreeSpinCount: number;
        ReelIndex: number;
        FeatureMultiple?: number;
        MysteryMultiple?: number;
        MatchedBonus?: any;
        CollectWin?: number;
        AddSpinCount?: number;
        InitReel?: any;
    };
    SpinID: number;                    // Int64
    Before: Record<string, number>;    // Jackpot values trước spin
    After: Record<string, number>;     // Jackpot values sau spin
    SMM: ServerMaintenanceMessage | null;
}

/** Server MatchedLinePay format — ALL PascalCase theo actual API */
export interface ServerMatchedLinePay {
    Feature: string | null;
    FeatureParam: number;
    MatchedSymbols: number[];
    MatchedSymbolsCount: number;
    PayLineIndex: number;
    Payout: number;
    ReelCnt: number;
    ContainsWild: boolean;
    MatchedSymbolsIndices: any[];
}

/** Claim response từ server (AckClaimFeature) — PascalCase theo tài liệu */
export interface ServerClaimResponse {
    ClaimResponse: {
        TotalWin: number;
        FeatureName: string;
        NextStage: number;
        WinGrade: string;
        StartRands: number[];
    };
    WinCash: number;           // Tiền thắng trong feature spin
    Cash: number;
}

/** BalanceGet response từ server (AckBalanceGet) — 4.11 /Slot/{SlotId}/BalanceGet */
export interface ServerBalanceGetResponse {
    Balance: number;     // Current balance
    Currency: string;    // Currency code (e.g. "KRW")
}

/** FeatureItem từ server — AckFeatureItemGet.Items[n] (theo API doc) */
export interface ServerFeatureItem {
    Id: number;              // ID của gói
    Name: string;            // Tên gói
    Title: string;           // Tiêu đề hiển thị
    Desc: string;            // Mô tả chi tiết
    PriceRatio: number;      // Bội số so với totalBet (không phải giá tuyệt đối)
    EffectType: number;      // 1=Ticket, 2=ExchangeReel, 3=ProvideSymbol, 4=AddSpins
    EffectReels: number[];   // Reel áp dụng (nếu có)
    EffectSymbols: any[];    // Symbol áp dụng (nếu có)
    AddSpinValue: number | null;
    TicketFeature: number;
    Order: number;
    ImgUrl: string;          // URL thumbnail
}

/** FeatureItemGet response từ server (AckFeatureItemGet) */
export interface ServerFeatureItemGetResponse {
    Cash: number;
    Items: ServerFeatureItem[];
    SMM: any | null;
}

/** FeatureItemBuy response từ server (AckPurchaseItemBuy) */
export interface ServerFeatureItemBuyResponse {
    IsSuccess: boolean;
    Res: any | null;       // ISpinResponse — spin result kèm theo khi mua
    RemainCash: number;
    ExReel: any[] | null;
}

/** Client-side FeatureItem (camelCase) */
export interface FeatureItem {
    itemId: number;
    name: string;
    title: string;
    desc: string;
    priceRatio: number;      // PriceRatio từ server (bội số × totalBet)
    effectType: number;      // 1=Ticket, 2=ExchangeReel, 3=ProvideSymbol, 4=AddSpins
    imgUrl: string;
    addSpinValue?: number | null;
}

// ═══════════════════════════════════════════════════════════
//  BUY BONUS SYSTEM — IBonusItem
// ═══════════════════════════════════════════════════════════

/** Loại áp dụng của BonusItem (mapping từ SlotPurchaseItemEffectType) */
export type BonusApplyType = 'onceuse' | 'activate';

/**
 * IBonusItem — Dữ liệu item bonus từ Server (SlotFeatureItemInfo).
 * - "onceuse": Mua đứt 1 lần → gọi API FeatureItemBuy (EffectType=1 Ticket / 4 AddSpins).
 * - "activate": Bật/Tắt → dùng OnOff trong FeatureItemBuy (EffectType=2 ExchangeReel / 3 ProvideSymbol).
 * - Price hiển thị = currentTotalBet × valueRatio (PriceRatio từ server).
 */
export interface IBonusItem {
    uniqueID: string;            // ← SlotFeatureItemInfo.Id (Int32 → string)
    itemName: string;            // ← SlotFeatureItemInfo.Name
    itemInfo: string;            // ← SlotFeatureItemInfo.Desc
    applyType: BonusApplyType;   // ← suy ra từ EffectType: "onceuse" hoặc "activate"
    valueRatio: number;          // ← SlotFeatureItemInfo.PriceRatio
    thumbnailImage: string;      // ← SlotFeatureItemInfo.ImgUrl
}

/** Jackpot polling response (AckJackpotInfo) — PascalCase theo tài liệu */
export interface ServerJackpotResponse {
    Wins: number[];                  // [mini, minor, major, grand] — array theo actual API
    WinMsgs: ServerWinBroadcast[];
    ReqRace: boolean;
    CR: any;                         // NwCashRaceDetailInfoDto
    UTC: string;
    SMM?: ServerMaintenanceMessage | null;  // "Most responses include SMM" (doc section 6)
}

/** Win broadcast message */
export interface ServerWinBroadcast {
    Seq: number;
    Slot: string;
    MX: number;
    Nick: string;
    WinPopupUrl: string;
    Feature: string;
    LangID: string;
    SlotIcon: string;
    CountryFlagIcon: string;
    CTime: string;
}

/** Server Maintenance Message */
export interface ServerMaintenanceMessage {
    ServerUtc: string;
    ShutdownUtc: string;
    Title: string;
    Line1: string;
    Line2: string;
    RemainMinutes: number;
    DurationMinutes: number;
    Step: number;
}
