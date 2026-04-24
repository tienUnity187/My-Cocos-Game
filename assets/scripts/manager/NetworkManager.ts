/**
 * NetworkManager - Abstraction layer cho network request.
 *
 * ★ USE_REAL_API = false → MockNetworkAdapter (offline dev/test)
 * ★ USE_REAL_API = true  → RealNetworkAdapter (MessagePack + AES server)
 *
 * Quy trình API (theo tài liệu):
 * 1. Login (ReqWebLinkLogin hoặc ReqTestLogin)
 *    → Nhận SessionKey, MemberIdx, Seq, Aky (AES-256 key)
 * 2. Enter → Nhận ParSheet, initial state
 * 3. Spin → Gửi BetIndex, CoinValueIndex, nhận SpinResponse
 * 4. Claim → Khi nextStage >= 100 (NEED_CLAIM)
 * 5. Jackpot → Poll mỗi 2 giây
 * 6. HeartBeat → Mỗi 10 giây giữ session
 *
 * SEQ Management:
 * - SeqRequest APIs (Enter, Spin, Claim): phải gửi đúng SEQ
 * - SEQ khởi đầu từ Login response
 * - Mỗi response thành công trả SEQ mới → dùng cho request tiếp theo
 * - Timeout → retry cùng SEQ tối đa 3 lần (server trả cached response)
 */

import {
    SpinResponse,
    ServerSession,
    ServerEnterResponse,
    ServerSpinResponse,
    ServerClaimResponse,
    ServerJackpotResponse,
    ServerMatchedLinePay,
    ServerMaintenanceMessage,
    SlotConfig,
    SlotStageType,
    SymbolId,
    FeatureItem,
    ServerFeatureItem,
    ServerFeatureItemGetResponse,
    ServerFeatureItemBuyResponse,
    ServerBalanceGetResponse,
} from '../data/SlotTypes';
import { MockDataProvider } from '../data/MockDataProvider';
import { GameData } from '../data/GameData';
import { USE_REAL_API, ServerConfig, TestLoginConfig, MOCK_SPIN_SCENARIO, DEBUG_RANDS, MOCK_RESUME_SCENARIO } from '../data/ServerConfig';
import {
    SCENARIO_NO_WIN, SCENARIO_NORMAL_WIN, SCENARIO_MULTI_LINE, SCENARIO_BIG_WIN,
    SCENARIO_LONG_SPIN, SCENARIO_JACKPOT, FULL_FREE_SEQUENCE, FULL_FREE_JACKPOT_SEQUENCE, FULL_FREE_RETRIGGER_SEQUENCE, DEFAULT_SEQUENCE,
    BUY_FREE_SPIN_SEQUENCE,
    MOCK_RESUME_NORMAL_SPIN, MOCK_RESUME_FREE_SPIN_MID, MOCK_RESUME_FREE_SPIN_NEED_CLAIM,
    MOCK_RESUME_FREE_SPIN_JACKPOT_MID, MOCK_RESUME_BUY_FREE_SPIN_MID, MOCK_RESUME_BUY_FREE_SPIN_NEED_CLAIM,
} from '../data/mock/MockScenariosData';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { DebugManager } from './DebugManager';
import { Packr, addExtension } from 'msgpackr';
import * as LZ4 from 'lz4js';
import {
    encryptAES128, decryptAES128,
    encryptAES256, decryptAES256,
    decryptPS,
} from '../core/CryptoUtils';
import { ResponseLogger } from '../core/ResponseLogger';
import { PopUpMessage, PopupCase } from '../core/PopUpMessage';

/**
 * ServerApiError - Error được throw khi server trả về CODE != 0 hoặc network thất bại.
 * Flag alreadyHandled = true nghĩa là popup đã được emit từ NetworkManager.
 * Caller (GameManager) chỉ cần xử lý UI state mà không cần emit popup lại.
 */
export class ServerApiError extends Error {
    readonly serverCode: number;
    readonly alreadyHandled: boolean;
    constructor(message: string, serverCode: number, alreadyHandled: boolean = true) {
        super(message);
        this.name = 'ServerApiError';
        this.serverCode = serverCode;
        this.alreadyHandled = alreadyHandled;
    }
}

// ─── MSGPACK: Packr tương thích C# MessagePack ───────────────────────────────
// useRecords: false    → tắt record extension (C# không dùng)
// bundleStrings: false → tắt string bundling extension
const _packr = new Packr({ useRecords: false, bundleStrings: false });

// ─── LZ4 decompressBlock: resolve đúng function cho cả Node.js & Cocos bundler ─
// lz4js dùng CommonJS → import * as LZ4 có thể cho { default: {...} } hoặc {...}
const _lz4 = (LZ4 as any).default ?? LZ4;
function _lz4DecompressBlock(src: Uint8Array, dst: Uint8Array): number {
    const fn: Function = _lz4.decompressBlock;
    if (typeof fn !== 'function') {
        throw new Error(`[LZ4] decompressBlock not found. Available keys: ${Object.keys(_lz4)}`);
    }
    return fn(src, dst, 0, src.length, 0);
}

// ─── Helper: dump hex (only used on errors) ─────────────────────────────────
function _hexDump(buf: Uint8Array, label: string, maxBytes = 64): void {
    const slice = buf.slice(0, maxBytes);
    const hex = Array.from(slice).map(b => (b < 16 ? '0' : '') + b.toString(16)).join(' ');
    console.error(`[MsgPack] ${label} (${buf.byteLength} bytes): ${hex}${buf.byteLength > maxBytes ? ' ...' : ''}`);
}

// ─── Đăng ký LZ4BlockArray ext type -1 (0xFF) ── MessagePack-CSharp v2 ──────
// Format: [uncompressedLen: int32 LE][lz4BlockData...]
addExtension({
    type: -1,
    unpack(buffer: Uint8Array): any {
        const uncompressedLen =
            buffer[0] | (buffer[1] << 8) | (buffer[2] << 16) | (buffer[3] << 24);
        const compressed = buffer.slice(4);
        const decompressed = new Uint8Array(uncompressedLen);
        _lz4DecompressBlock(compressed, decompressed);
        return _packr.unpack(decompressed);
    },
    pack(_val: any): never {
        throw new Error('[LZ4] Client không cần compress request — server config issue');
    },
});

// ─── Đăng ký ext type 99 (0x63) — Lz4BlockArray wrapper (server response) ───
//
// Theo doc: "The server uses Lz4BlockArray with MessagePack serialization."
// Server gói toàn bộ response trong ext16(type=99).
//
// Format bên trong ext-99 (xác nhận từ hex dump thực tế):
//   [uncompressedLen: msgpack int32 (d2 XX XX XX XX = 5 bytes)]
//   [lz4CompressedData: remaining bytes]
//
// Sau khi LZ4 decompress → msgpack array = CCResponseCommonPacket
addExtension({
    type: 99,
    unpack(buffer: Uint8Array): any {
        if (buffer.byteLength < 5) {
            console.error(`[MsgPack] ext99 too small (${buffer.byteLength})`);
            return null;
        }

        // ═══ Xác định uncompressedLen và offset bắt đầu LZ4 data ═══
        let uncompressedLen: number;
        let lz4DataOffset: number;
        const b0 = buffer[0];

        if (b0 === 0xd2) {
            // msgpack int32 BE: d2 + 4 bytes big-endian
            uncompressedLen = (buffer[1] << 24 | buffer[2] << 16 | buffer[3] << 8 | buffer[4]) | 0;
            if (uncompressedLen < 0) uncompressedLen = uncompressedLen >>> 0;
            lz4DataOffset = 5;
        } else if (b0 === 0xce) {
            // msgpack uint32 BE: ce + 4 bytes
            uncompressedLen = ((buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4]) >>> 0;
            lz4DataOffset = 5;
        } else if (b0 === 0xcd) {
            // msgpack uint16 BE: cd + 2 bytes
            uncompressedLen = (buffer[1] << 8) | buffer[2];
            lz4DataOffset = 3;
        } else if (b0 === 0xd1) {
            // msgpack int16 BE: d1 + 2 bytes
            uncompressedLen = (buffer[1] << 8) | buffer[2];
            lz4DataOffset = 3;
        } else if (b0 === 0xcc) {
            // msgpack uint8: cc + 1 byte
            uncompressedLen = buffer[1];
            lz4DataOffset = 2;
        } else if (b0 <= 0x7f) {
            // msgpack positive fixint (0-127)
            uncompressedLen = b0;
            lz4DataOffset = 1;
        } else {
            // Fallback: raw 4 bytes LE (standard Lz4BlockArray)
            uncompressedLen = buffer[0] | (buffer[1] << 8) | (buffer[2] << 16) | (buffer[3] << 24);
            lz4DataOffset = 4;
        }

        // Sanity check
        if (uncompressedLen <= 0 || uncompressedLen > 10 * 1024 * 1024) {
            console.error(`[MsgPack] ext99: invalid uncompressedLen=${uncompressedLen}`);
            try {
                return _packr.unpack(buffer);
            } catch (e: any) {
                console.error(`[MsgPack] ext99 raw fallback failed: ${e.message}`);
                return null;
            }
        }

        // LZ4 decompress
        const compressed = buffer.slice(lz4DataOffset);
        try {
            const decompressed = new Uint8Array(uncompressedLen);
            _lz4DecompressBlock(compressed, decompressed);
            return _packr.unpack(decompressed);
        } catch (lz4Err: any) {
            console.error(`[MsgPack] ext99 LZ4 FAILED: ${lz4Err.message}`);
            _hexDump(compressed, 'ext99 failed compressed', 64);
            return null;
        }
    },
    pack(_val: any): never {
        throw new Error('[Ext99] Pack not supported');
    },
});

// ─── Đăng ký ext type 100 (0x64) — C# DateTimeOffset ─────────────────────────
// MessagePack-CSharp NativeDateTimeOffsetFormatter: fixext12 = ticks (8B) + offset_min (4B)
addExtension({
    type: 100,
    unpack(_buffer: Uint8Array): any {
        return null; // DateTimeOffset — not used by client
    },
    pack(_val: any): never {
        throw new Error('[Ext100] Pack not supported');
    },
});

// ─── INTERFACE ───

export interface INetworkAdapter {
    /** Login (test hoặc weblink) */
    login(params?: any): Promise<ServerSession>;
    /** Enter slot game → nhận config + initial state */
    enterGame(): Promise<ServerEnterResponse>;
    /** Spin request */
    sendSpinRequest(isFreeSpin: boolean): Promise<SpinResponse>;
    /** Claim winnings (free spin kết thúc, pick game, etc.) */
    sendClaimRequest(): Promise<{ balance: number; winCash?: number }>;
    /** Poll jackpot values (mỗi 2 giây) */
    pollJackpot(): Promise<ServerJackpotResponse>;
    /** HeartBeat (mỗi 10 giây) */
    sendHeartBeat(): Promise<void>;
    /** Notify server immediately when bet/coinValue changes */
    sendGameOptChange(betIndex: number, coinValueIndex: number): Promise<void>;
    /** Lấy danh sách gói Feature (Buy Bonus) */
    sendFeatureItemGet(): Promise<FeatureItem[]>;
    /** Mua gói Feature (Buy Bonus) — onOff: true = activate, false = cancel (itemId=0) */
    sendFeatureItemBuy(itemId: number, onOff: boolean): Promise<{ isSuccess: boolean; remainCash: number; res: any | null }>;
    /** Refresh balance từ partner callback (dùng khi insufficient funds, e.g. top-up) */
    sendBalanceGet(): Promise<{ balance: number; currency: string }>;
}

// ═══════════════════════════════════════════════════════════
//  MOCK ADAPTER (offline dev/test — dùng MockScenariosData)
// ═══════════════════════════════════════════════════════════

class MockNetworkAdapter implements INetworkAdapter {

    /**
     * Queue spin responses theo kịch bản đang chọn.
     * Mỗi lần sendSpinRequest() gọi → lấy phần tử tiếp theo (vòng lặp).
     * Nếu queue rỗng (scenario = 'random') → dùng MockDataProvider ngẫu nhiên.
     */
    private _queue: SpinResponse[] = [];
    private _queueIdx: number = 0;
    /** Buy bonus queue — injected khi sendFeatureItemBuy thành công, ưu tiên hơn _queue */
    private _buyQueue: SpinResponse[] = [];
    private _buyQueueIdx: number = 0;
    /** Backup queue state để restore sau khi buy free spin kết thúc */
    private _savedQueueIdx: number = 0;

    constructor() {
        this._buildQueue();
        // Khởi tạo jackpotValues cho mock mode — giả lập giá trị progressive jackpot pool
        // Thứ tự: [MINI, MINOR, MAJOR, GRAND] — khớp với SCENARIO_JACKPOT.totalWin = 25000 cho GRAND
        const data = GameData.instance;
        data.jackpotValues = [
            1250,     // MINI
            5000,     // MINOR
            12500,    // MAJOR
            25000,    // GRAND — khớp với SCENARIO_JACKPOT.totalWin
        ];
    }

    private _buildQueue(): void {
        switch (MOCK_SPIN_SCENARIO) {
            case 'no_win':       this._queue = [SCENARIO_NO_WIN];       break;
            case 'normal_win':   this._queue = [SCENARIO_NORMAL_WIN];   break;
            case 'multi_line':   this._queue = [SCENARIO_MULTI_LINE];   break;
            case 'big_win':      this._queue = [SCENARIO_BIG_WIN];      break;
            case 'long_spin':    this._queue = [SCENARIO_LONG_SPIN];    break;
            case 'jackpot':      this._queue = [SCENARIO_JACKPOT];      break;
            case 'full_free':              this._queue = [...FULL_FREE_SEQUENCE];              break;
            case 'full_free_jackpot':     this._queue = [...FULL_FREE_JACKPOT_SEQUENCE];     break;
            case 'full_free_retrigger':   this._queue = [...FULL_FREE_RETRIGGER_SEQUENCE];   break;
            case 'sequence':              this._queue = [...DEFAULT_SEQUENCE];               break;
            default:             this._queue = [];                       break; // 'random'
        }
        this._queueIdx = 0;
        if (this._queue.length > 0) {
            // console.log(`[MockAdapter] Scenario: "${MOCK_SPIN_SCENARIO}" — ${this._queue.length} bước trong queue`);
        }
    }

    async login(_params?: any): Promise<ServerSession> {
        await this._delay(300);
        return {
            nick: 'MockPlayer',
            serverTime: new Date().toISOString(),
            clientIp: '127.0.0.1',
            sessionKey: 0n,
            sessionUpdateSec: 300,
            memberIdx: 0,
            seq: 100,
            uid: 'mock-uid',
            cash: GameData.instance.player.balance,
            aky: '',
            currency: 'USD',
            country: 'US',
            isNewAccount: false,
            useBroadcast: false,
            smm: null,
        };
    }

    async enterGame(): Promise<ServerEnterResponse> {
        await this._delay(200);

        // Giả lập lastSpinResponse theo MOCK_RESUME_SCENARIO để test resume logic
        let lastSpinResponse: any = null;
        switch (MOCK_RESUME_SCENARIO) {
            case 'normal_spin':             lastSpinResponse = MOCK_RESUME_NORMAL_SPIN;              break;
            case 'free_spin_mid':           lastSpinResponse = MOCK_RESUME_FREE_SPIN_MID;            break;
            case 'free_spin_need_claim':    lastSpinResponse = MOCK_RESUME_FREE_SPIN_NEED_CLAIM;     break;
            case 'free_spin_jackpot_mid':   lastSpinResponse = MOCK_RESUME_FREE_SPIN_JACKPOT_MID;   break;
            case 'buy_free_spin_mid':       lastSpinResponse = MOCK_RESUME_BUY_FREE_SPIN_MID;       break;
            case 'buy_free_spin_need_claim':lastSpinResponse = MOCK_RESUME_BUY_FREE_SPIN_NEED_CLAIM;break;
            default:                        lastSpinResponse = null;                                 break; // 'none'
        }
        if (lastSpinResponse) {
            console.log(`[MockAdapter] Resume scenario: "${MOCK_RESUME_SCENARIO}" — NextStage=${lastSpinResponse.NextStage}, remain=${lastSpinResponse.RemainFreeSpinCount}, totalWin=${lastSpinResponse.FeatureSpinTotalWin}`);
        }

        return {
            cash: GameData.instance.player.balance,
            slotName: 'SuperNova',
            ps: '',
            betIndex: 0,
            coinValueIndex: 0,
            lastSpinResponse,
            isPractice: false,
            memberIdx: 0,
            smm: null,
        };
    }

    async sendSpinRequest(isFreeSpin: boolean): Promise<SpinResponse> {
        // ★ MOCK: Mạng ổn định, không delay — giá lập tức
        // Real API tự có latency, không cần thêm.
        const delay = 0.03;
        await this._delay(delay);

        // Buy free spin queue — luôn ưu tiên (kể cả khi isFreeSpin=true)
        if (this._buyQueue.length > 0 && this._buyQueueIdx < this._buyQueue.length) {
            const resp = this._buyQueue[this._buyQueueIdx];
            this._buyQueueIdx++;
            console.log(`[MockAdapter] BuyFreeSpin #${this._buyQueueIdx}/${this._buyQueue.length} — nextStage=${resp.nextStage}, remain=${resp.remainFreeSpinCount}`);
            if (this._buyQueueIdx >= this._buyQueue.length) {
                console.log('[MockAdapter] Buy Free Spin queue hết — reset');
                this._buyQueue = [];
                this._buyQueueIdx = 0;
            }
            return resp;
        }

        // ★ KHI DANG FREE SPIN: luôn dùng generateSpinResponse để đảm bảo nextStage đúng
        // (FREE_SPIN/FREE_SPIN_END theo freeSpinRemaining hiện tại).
        // Queue từ MOCK_SPIN_SCENARIO có thể chứa nextStage=SPIN (no_win/normal_win/jackpot...)
        // → nếu dùng queue trong free spin sẽ gây thoát free spin mode sớm/sai.
        if (isFreeSpin) {
            const resp = MockDataProvider.generateSpinResponse(true);
            console.log(`[MockAdapter] FreeSpin (generateResponse) — nextStage=${resp.nextStage}, remain=${resp.remainFreeSpinCount}, win=${resp.totalWin}`);
            return resp;
        }

        // Normal spin: dùng queue nếu có, fallback random
        // Bỏ qua các response dành cho free spin mid-state (FREESPIN_3/2/END còn sót trong queue
        // sau khi vừa kết thúc 1 chuỗi free spin — chúng dùng generateSpinResponse chứ không dùng queue)
        if (this._queue.length > 0) {
            for (let guard = 0; guard < this._queue.length; guard++) {
                const resp = this._queue[this._queueIdx % this._queue.length];
                this._queueIdx++;
                const isMidFreeSpin = resp.nextStage === SlotStageType.FREE_SPIN
                    || resp.nextStage === SlotStageType.FREE_SPIN_RE_TRIGGER
                    || resp.nextStage === SlotStageType.FREE_SPIN_END
                    || resp.nextStage === SlotStageType.BUY_FREE_SPIN_END;
                if (!isMidFreeSpin) return resp;
                console.log(`[MockAdapter] Queue skip FS-mid entry (nextStage=${resp.nextStage}) → advance`);
            }
            // Tất cả entries đều là free spin mid → fallback random
        }

        // Fallback: tạo ngẫu nhiên (MOCK_SPIN_SCENARIO = 'random')
        return MockDataProvider.generateSpinResponse(false);
    }

    async sendClaimRequest(): Promise<{ balance: number; winCash?: number }> {
        await this._delay(100);
        const data = GameData.instance;
        const winCash = data.freeSpinTotalWin;

        // Nếu freeSpinTotalWin được restore từ server (resume scenario), số đó đã bao gồm
        // toàn bộ tiền thắng trước khi tắt game. Chỉ cộng vào balance 1 lần ở đây.
        // _onFreeSpinEndPopupClosed sẽ KHÔNG add lại (vì flag = true).
        const newBalance = data.player.balance + winCash;

        // Reset buy queue + normal queue khi claim xong
        this._buyQueue = [];
        this._buyQueueIdx = 0;
        this._queueIdx = this._savedQueueIdx;
        console.log(`[MockAdapter] Claim: winCash=${winCash}, newBalance=${newBalance}, wasRestoredFromServer=${data.freeSpinTotalWinRestoredFromServer}`);
        return { balance: newBalance, winCash };
    }

    async pollJackpot(): Promise<ServerJackpotResponse> {
        await this._delay(100);
        const vals = GameData.instance.jackpotValues;
        return {
            Wins: vals,
            WinMsgs: [],
            ReqRace: false,
            CR: null,
            UTC: new Date().toISOString(),
        };
    }

    async sendHeartBeat(): Promise<void> {
        // Mock: no-op
    }

    async sendGameOptChange(_betIndex: number, _coinValueIndex: number): Promise<void> {
        // Mock: no-op
    }

    async sendFeatureItemGet(): Promise<FeatureItem[]> {
        await this._delay(200);
        const totalBet = GameData.instance.totalBet;
        // Mock: PriceRatio = 100 × totalBet ÷ totalBet = 100
        return [{
            itemId:      101,
            name:        'Free Spin Buy',
            title:       'BUY FREE SPINS',
            desc:        'Pay to trigger the FREE SPINS feature.',
            priceRatio:  100,
            effectType:  1,
            imgUrl:      '',
            addSpinValue: 10,
        }];
    }

    async sendFeatureItemBuy(_itemId: number, _onOff: boolean = false): Promise<{ isSuccess: boolean; remainCash: number; res: any | null }> {
        await this._delay(300);
        const data = GameData.instance;
        const totalBet = data.totalBet;
        const cost = totalBet * 100;
        const newBalance = data.player.balance - cost;
        if (newBalance < 0) {
            console.log(`[MockAdapter] FeatureItemBuy FAILED: balance=${data.player.balance} < cost=${cost}`);
            return { isSuccess: false, remainCash: data.player.balance, res: null };
        }

        // Inject buy free spin queue — 10 vòng mock
        this._savedQueueIdx = this._queueIdx;
        this._buyQueue = [...BUY_FREE_SPIN_SEQUENCE];
        this._buyQueueIdx = 0;
        console.log(`[MockAdapter] FeatureItemBuy SUCCESS: cost=${cost}, newBalance=${newBalance}, injected ${this._buyQueue.length} buy spins`);

        return {
            isSuccess: true,
            remainCash: newBalance,
            res: { RemainFreeSpinCount: 10 },
        };
    }

    async sendBalanceGet(): Promise<{ balance: number; currency: string }> {
        await this._delay(200);
        // Mock: trả về balance hiện tại (không mô phỏng top-up)
        return { balance: GameData.instance.player.balance, currency: 'USD' };
    }

    private _delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// ═══════════════════════════════════════════════════════════
//  REAL NETWORK ADAPTER (MessagePack + AES, theo tài liệu API)
// ═══════════════════════════════════════════════════════════

/**
 * RealNetworkAdapter - Gọi server API thật.
 *
 * ◆ Protocol: MessagePack Array Format
 * ◆ Encryption:
 *   - Login: AES-128 Base64 (fixed key)
 *   - Sau login: AES-256 (Aky từ login response)
 * ◆ SEQ management: auto-increment từ server response
 *
 * ⚠ CẦN CÀI THƯ VIỆN:
 *   npm install msgpackr crypto-js
 *
 * ⚠ BigInt: SessionKey & MemberIdx là Int64.
 *   JavaScript Number chỉ chính xác đến 53-bit.
 *   Nếu giá trị vượt Number.MAX_SAFE_INTEGER, cần dùng BigInt/string.
 */
class RealNetworkAdapter implements INetworkAdapter {

    // ─── LOGIN ───

    async login(params?: any): Promise<ServerSession> {
        const data = GameData.instance;
        const isTestLogin = !params?.gp; // Nếu không có gp token → test login

        let apiPath: string;
        let requestData: any;

        if (isTestLogin) {
            // Test Login (dev)
            apiPath = ServerConfig.API.TEST_LOGIN;
            requestData = {
                PlatformId: TestLoginConfig.PlatformId,
                DeviceToken: TestLoginConfig.DeviceToken,
                IsPractice: TestLoginConfig.IsPractice,
                Currency: TestLoginConfig.Currency,
                PartnerId: TestLoginConfig.PartnerId,
            };
        } else {
            // WebLink Login (production)
            apiPath = ServerConfig.API.WEB_LINK_LOGIN;
            requestData = {
                Params: params.gp,
            };
        }

        // Login dùng AES-128 fixed key
        const encryptedData = this._encryptAES128(JSON.stringify(requestData));

        // Build common packet (login: MIDX=0, SKEY=0, SEQ=0)
        const packet = this._buildPacket(apiPath, 0, 0, 0, encryptedData);
        const responsePacket = await this._sendRequest(
            ServerConfig.getUrl(apiPath),
            packet
        );

        // Parse response
        // Response format: [API, PACKET_TYPE, MIDX, SKEY, SEQ, CODE, MSG, CONT_YN, EncData]
        this._checkResponseCode(responsePacket);

        // Find the encrypted data field (longest string in packet)
        let encryptedField: string = '';
        for (let i = 5; i < (responsePacket?.length ?? 0); i++) {
            if (typeof responsePacket[i] === 'string' && (responsePacket[i] as string).length > 50) {
                encryptedField = responsePacket[i] as string;
                break;
            }
        }

        const sessionJson = this._decryptAES128(encryptedField);
        const raw = JSON.parse(sessionJson);

        // ★ QUAN TRỌNG: SessionKey là Int64 (>53 bit) — JSON.parse mất precision.
        // Lấy SessionKey và MemberIdx trực tiếp từ response packet header
        // (msgpackr decode thành BigInt chính xác).
        // responsePacket = [API, PACKET_TYPE, MIDX, SKEY, SEQ, CODE, MSG, CONT_YN, Data]
        const sessionKeyBigInt: bigint = typeof responsePacket[3] === 'bigint'
            ? responsePacket[3] as bigint
            : BigInt(Math.trunc(responsePacket[3] as number));
        const memberIdxFromPacket: number = Number(responsePacket[2]);

        const session: ServerSession = {
            nick: raw.Nick,
            serverTime: raw.ServerTime,
            clientIp: raw.ClientIp,
            sessionKey: sessionKeyBigInt,  // BigInt — chính xác từ packet header
            sessionUpdateSec: raw.SessionUpdateSec,
            memberIdx: memberIdxFromPacket, // Lấy từ packet header (chính xác)
            seq: raw.Seq,
            uid: raw.UID,
            cash: raw.Cash ?? raw.SlotCash ?? raw.BC,
            aky: raw.Aky,
            currency: raw.Currency,
            country: raw.Country,
            isNewAccount: raw.IsNewAccount,
            useBroadcast: raw.UseBroadcast,
            isPractice: raw.IsPractice,
            smm: raw.SMM ? this._parseSMM(raw.SMM) : null,
        };

        // Lưu session
        data.setServerSession(session);

        // Cập nhật SEQ từ response packet header [4]
        data.updateSeq(responsePacket[4]);

        // ═══ LOG RESPONSE ═══
        ResponseLogger.log('Login', raw, {
            packetHeader: {
                MIDX: responsePacket[2],
                SKEY: String(responsePacket[3]),
                SEQ: responsePacket[4],
                CODE: responsePacket[5],
            },
        });

        if (session.smm) {
            EventBus.instance.emit(GameEvents.SERVER_MAINTENANCE, session.smm);
        }

        return session;
    }

    // ─── ENTER GAME ───

    async enterGame(): Promise<ServerEnterResponse> {
        const data = GameData.instance;
        const session = data.serverSession!;

        const requestData = { SlotId: ServerConfig.SLOT_ID };
        const encrypted = this._encryptAES256(JSON.stringify(requestData), session.aky);

        const packet = this._buildPacket(
            ServerConfig.API.ENTER,
            session.memberIdx,
            session.sessionKey,
            data.currentSeq,
            encrypted
        );

        const responsePacket = await this._sendRequestWithRetry(
            ServerConfig.getUrl(ServerConfig.API.ENTER),
            packet
        );

        this._checkResponseCode(responsePacket);
        data.updateSeq(responsePacket[4]);

        const decrypted = this._decryptAES256(responsePacket[8], session.aky);
        const raw = JSON.parse(decrypted);

        const enterResp: ServerEnterResponse = {
            cash: raw.Cash,
            slotName: raw.SlotName,
            ps: raw.PS,
            betIndex: raw.BetIndex,
            coinValueIndex: raw.CoinValueIndex,
            lastSpinResponse: raw.LastSpinResponse,
            isPractice: raw.IsPractice,
            memberIdx: raw.MemberIdx,
            smm: raw.SMM ? this._parseSMM(raw.SMM) : null,
        };

        data.isEntered = true;
        data.player.balance = enterResp.cash;
        data.player.betIndex = enterResp.betIndex;
        // Lưu raw lastSpinResponse để GameManager detect Free Spin resume.
        // Field names có thể là camelCase (stageType) theo API doc 5.1.
        data.rawEnterLastSpinResponse = raw.LastSpinResponse ?? null;

        // ─── Giải nén PS (ParSheet) và áp dụng config ───
        let parsedPS: any = null;
        if (enterResp.ps) {
            parsedPS = this._decryptPS(enterResp.ps);
            this._applyPS(parsedPS);
        }

        // ═══ LOG RESPONSE — Enter + PS decoded ═══
        ResponseLogger.log('Enter', raw, {
            ps: parsedPS,
            reelStripsFromPS: parsedPS?.Reel?.Strips?.map((s: any) => ({
                rawLength: (s.Symbols ?? s).length,
                symbols: s.Symbols ?? s,
            })),
            clientReelStrips: data.config.reelStrips.map((s, i) => ({
                index: i,
                length: s.length,
                symbols: [...s],
            })),
        });

        if (enterResp.smm) {
            EventBus.instance.emit(GameEvents.SERVER_MAINTENANCE, enterResp.smm);
        }

        return enterResp;
    }

    // ─── SPIN ───

    async sendSpinRequest(_isFreeSpin: boolean): Promise<SpinResponse> {
        const data = GameData.instance;
        const session = data.serverSession!;

        // 🎯 Lấy DEBUG_RANDS từ DebugManager (keyboard shortcut) hoặc dùng config default
        const debugRands = DebugManager.instance.getPendingDebugRands() ?? DEBUG_RANDS;

        const requestData = {
            BetIndex: data.player.betIndex,
            BetLines: 0,
            CoinValueIndex: data.config.coinValues.indexOf(data.player.coinValue),
            DebugArray: debugRands ?? [],
            SlotId: ServerConfig.SLOT_ID,
            Dbg: '',
        };

        // ═══ LOG REQUEST (FreeSpin quan trọng: xác nhận endpoint và DebugArray) ═══
        console.error(
            `[SPIN-REQ] isFreeSpin=${_isFreeSpin}` +
            ` | Endpoint=${ServerConfig.getEndpoint(ServerConfig.API.SPIN)}` +
            ` | BetIndex=${requestData.BetIndex}` +
            ` | CoinValueIndex=${requestData.CoinValueIndex}` +
            ` | DebugArray=${JSON.stringify(requestData.DebugArray)}` +
            ` | CurrentStage(client)=${data.freeSpinRemaining > 0 ? 'FreeSpin(remain=' + data.freeSpinRemaining + ')' : 'NormalSpin'}`
        );

        if (debugRands) {
            console.error(`[SPIN-REQ] Force DebugRands=${JSON.stringify(debugRands)}`);
        }

        const encrypted = this._encryptAES256(JSON.stringify(requestData), session.aky);
        const packet = this._buildPacket(
            ServerConfig.API.SPIN,
            session.memberIdx,
            session.sessionKey,
            data.currentSeq,
            encrypted
        );

        const responsePacket = await this._sendRequestWithRetry(
            ServerConfig.getUrl(ServerConfig.API.SPIN),
            packet
        );

        this._checkResponseCode(responsePacket);
        data.updateSeq(responsePacket[4]);

        const decrypted = this._decryptAES256(responsePacket[8], session.aky);
        const raw: ServerSpinResponse = JSON.parse(decrypted);

        // Check SMM (PascalCase per doc)
        if (raw.SMM) {
            EventBus.instance.emit(GameEvents.SERVER_MAINTENANCE, raw.SMM);
        }

        // Update jackpot values from Before/After (PascalCase per AckSpin doc)
        if (raw.After) {
            const vals: number[] = [];
            for (const k in raw.After) { vals.push(raw.After[k]); }
            if (vals.length > 0) {
                data.jackpotValues = vals;
                EventBus.instance.emit(GameEvents.JACKPOT_VALUES_UPDATED, vals);
            }
        }

        // Convert server format → internal SpinResponse
        const result = this._convertSpinResponse(raw);

        // ═══ SPIN LOG ═══
        const res = raw.Res;
        const rawRands = res.Rands as number[];
        const matchedLines = res.MatchedLinePays || [];
        console.log(
            `%c[SERVER] Rands=[${rawRands.join(',')}] TotalWin=$${res.TotalWin} Balance=$${raw.RemainCash} WinGrade=${res.WinGrade ?? 'null'}` +
            (matchedLines.length > 0
                ? ` Lines=[${matchedLines.map((l: any) => `L${l.PayLineIndex}:$${l.Payout}`).join(',')}]`
                : ' (no wins)'),
            'color:#0af;font-weight:bold'
        );

        // ═══ DEBUG MULTIPLIER ═══
        console.log(`%c[MULTIPLIER DEBUG] FeatureMultiple=${result.featureMultiple} (từ server: ${raw.Res.FeatureMultiple ?? raw.Res.MysteryMultiple ?? 'undefined'})`, 'color:#f80;font-weight:bold');

        return result;
    }

    // ─── CLAIM ───

    async sendClaimRequest(): Promise<{ balance: number; winCash?: number }> {
        const data = GameData.instance;
        const session = data.serverSession!;

        // Claim "Request Body: None" per doc — encrypt empty JSON object
        const encrypted = this._encryptAES256('{}', session.aky);

        const packet = this._buildPacket(
            ServerConfig.API.CLAIM,
            session.memberIdx,
            session.sessionKey,
            data.currentSeq,
            encrypted
        );

        const responsePacket = await this._sendRequestWithRetry(
            ServerConfig.getUrl(ServerConfig.API.CLAIM),
            packet
        );

        this._checkResponseCode(responsePacket);
        data.updateSeq(responsePacket[4]);

        const decrypted = this._decryptAES256(responsePacket[8], session.aky);
        const raw: ServerClaimResponse = JSON.parse(decrypted);

        // ═══ LOG RESPONSE ═══
        ResponseLogger.log('Claim', raw);

        return { balance: raw.Cash, winCash: raw.WinCash };
    }

    // ─── JACKPOT POLLING ───

    async pollJackpot(): Promise<ServerJackpotResponse> {
        const data = GameData.instance;
        const session = data.serverSession!;

        const requestData = {
            BetIndex: data.player.betIndex,
            BetLines: 0,
            CoinIndex: data.config.coinValues.indexOf(data.player.coinValue),
            SlotId: ServerConfig.SLOT_ID,
            ReqRace: true,
            LastWinMsgId: data.lastWinMsgId,
        };

        const encrypted = this._encryptAES256(JSON.stringify(requestData), session.aky);
        const packet = this._buildPacket(
            ServerConfig.API.JACKPOT,
            session.memberIdx,
            session.sessionKey,
            data.currentSeq,
            encrypted
        );

        // Jackpot là NormalRequest → không cần retry logic SEQ
        const responsePacket = await this._sendRequest(
            ServerConfig.getUrl(ServerConfig.API.JACKPOT),
            packet
        );

        this._checkResponseCode(responsePacket);

        const decrypted = this._decryptAES256(responsePacket[8], session.aky);
        const raw: ServerJackpotResponse = JSON.parse(decrypted);

        // Update jackpot values — Wins is number[] array: [mini, minor, major, grand]
        if (raw.Wins && Array.isArray(raw.Wins) && raw.Wins.length > 0) {
            data.jackpotValues = raw.Wins;
            EventBus.instance.emit(GameEvents.JACKPOT_VALUES_UPDATED, raw.Wins);
        }

        // Update last win msg ID
        if (raw.WinMsgs && raw.WinMsgs.length > 0) {
            const lastMsg = raw.WinMsgs[raw.WinMsgs.length - 1];
            data.lastWinMsgId = lastMsg.Seq;
        }

        if (raw.SMM) {
            EventBus.instance.emit(GameEvents.SERVER_MAINTENANCE, raw.SMM);
        }

        // ═══ LOG RESPONSE (only first poll) ═══
        if (ResponseLogger.all.filter(e => e.api === 'Jackpot').length < 2) {
            ResponseLogger.log('Jackpot', raw);
        }

        return raw;
    }

    // ─── GAME OPT CHANGE ───

    async sendGameOptChange(betIndex: number, coinValueIndex: number): Promise<void> {
        const data = GameData.instance;
        const session = data.serverSession!;

        const requestData = {
            SlotId: ServerConfig.SLOT_ID,
            Opt: 0,
            NewVal: 0,
        };

        const encrypted = this._encryptAES256(JSON.stringify(requestData), session.aky);
        const packet = this._buildPacket(
            ServerConfig.API.GAME_OPT_CHANGE,
            session.memberIdx,
            session.sessionKey,
            data.currentSeq,
            encrypted
        );

        try {
            const responsePacket = await this._sendRequest(
                ServerConfig.getUrl(ServerConfig.API.GAME_OPT_CHANGE),
                packet
            );
            this._checkResponseCode(responsePacket);
            data.updateSeq(responsePacket[4]);
        } catch (err) {
            console.warn('[GameOptChange] Failed:', err);
        }
    }

    // ─── FEATURE ITEM GET (Buy Bonus) ───

    async sendFeatureItemGet(): Promise<FeatureItem[]> {
        const data = GameData.instance;
        const session = data.serverSession!;

        // Doc: ReqFeatureItemGet chỉ cần { Lang: "en" } — NormalRequest, không cần SlotId/LangID
        const requestData = {
            Lang: 'en',
        };

        console.log(`[BuyBonus] FeatureItemGet REQUEST body: ${JSON.stringify(requestData)}`);
        console.log(`[BuyBonus] FeatureItemGet ENDPOINT: ${ServerConfig.getUrl(ServerConfig.API.FEATURE_ITEM_GET)}`);

        const encrypted = this._encryptAES256(JSON.stringify(requestData), session.aky);
        const packet = this._buildPacket(
            ServerConfig.API.FEATURE_ITEM_GET,
            session.memberIdx,
            session.sessionKey,
            data.currentSeq,
            encrypted
        );

        const responsePacket = await this._sendRequest(
            ServerConfig.getUrl(ServerConfig.API.FEATURE_ITEM_GET),
            packet
        );

        this._checkResponseCode(responsePacket);

        const decrypted = this._decryptAES256(responsePacket[8], session.aky);
        const raw: ServerFeatureItemGetResponse = JSON.parse(decrypted);

        console.log(`[BuyBonus] FeatureItemGet RESPONSE raw: ${JSON.stringify(raw)}`);

        ResponseLogger.log('FeatureItemGet', raw);

        const items: ServerFeatureItem[] = raw.Items ?? [];
        if (items.length === 0) {
            console.warn('[BuyBonus] Server trả về Items rỗng — slot chưa được cấu hình Buy Bonus');
        }

        // Map PascalCase server fields → camelCase FeatureItem
        return items.map((item: ServerFeatureItem) => ({
            itemId:       item.Id,
            name:         item.Name,
            title:        item.Title || item.Name,
            desc:         item.Desc || '',
            priceRatio:   item.PriceRatio,
            effectType:   item.EffectType,
            imgUrl:       item.ImgUrl || '',
            addSpinValue: item.AddSpinValue ?? undefined,
        }));
    }

    // ─── FEATURE ITEM BUY (Buy Bonus) ───

    async sendFeatureItemBuy(itemId: number): Promise<{ isSuccess: boolean; remainCash: number; res: any | null }> {
        const data = GameData.instance;
        const session = data.serverSession!;

        const requestData = {
            SlotId: ServerConfig.SLOT_ID,
            LangID: ServerConfig.DEFAULT_LID,
            ItemId: itemId,
            BetIndex: data.player.betIndex,
            BetLines: 0,
            CoinValueIndex: data.config.coinValues.indexOf(data.player.coinValue),
            OnOff: false,
        };

        const encrypted = this._encryptAES256(JSON.stringify(requestData), session.aky);
        const packet = this._buildPacket(
            ServerConfig.API.FEATURE_ITEM_BUY,
            session.memberIdx,
            session.sessionKey,
            data.currentSeq,
            encrypted
        );

        const responsePacket = await this._sendRequestWithRetry(
            ServerConfig.getUrl(ServerConfig.API.FEATURE_ITEM_BUY),
            packet
        );

        this._checkResponseCode(responsePacket);
        data.updateSeq(responsePacket[4]);

        const decrypted = this._decryptAES256(responsePacket[8], session.aky);
        const raw: ServerFeatureItemBuyResponse = JSON.parse(decrypted);

        ResponseLogger.log('FeatureItemBuy', raw);

        return {
            isSuccess: raw.IsSuccess,
            remainCash: raw.RemainCash,
            res: raw.Res ?? null,
        };
    }

    // ─── HEARTBEAT ───

    async sendHeartBeat(): Promise<void> {
        const data = GameData.instance;
        const session = data.serverSession!;

        const requestData = { Lang: 'en' };
        const encrypted = this._encryptAES256(JSON.stringify(requestData), session.aky);

        const packet = this._buildPacket(
            ServerConfig.API.HEARTBEAT,
            session.memberIdx,
            session.sessionKey,
            data.currentSeq,
            encrypted
        );

        try {
            const responsePacket = await this._sendRequest(
                ServerConfig.getUrl(ServerConfig.API.HEARTBEAT),
                packet
            );
            this._checkResponseCode(responsePacket);
            const decrypted = this._decryptAES256(responsePacket[8], session.aky);
            const raw = JSON.parse(decrypted);
            if (raw.SMM) {
                EventBus.instance.emit(GameEvents.SERVER_MAINTENANCE, this._parseSMM(raw.SMM));
            }
        } catch (err) {
            console.warn('[HeartBeat] Failed:', err);
        }
    }

    // ─── BALANCE GET ───

    async sendBalanceGet(): Promise<{ balance: number; currency: string }> {
        const data = GameData.instance;
        const session = data.serverSession!;

        const requestData = {
            SlotId: ServerConfig.SLOT_ID,
            LID: ServerConfig.DEFAULT_LID,
        };

        const encrypted = this._encryptAES256(JSON.stringify(requestData), session.aky);
        const packet = this._buildPacket(
            ServerConfig.API.BALANCE_GET,
            session.memberIdx,
            session.sessionKey,
            data.currentSeq,
            encrypted
        );

        const responsePacket = await this._sendRequestWithRetry(
            ServerConfig.getUrl(ServerConfig.API.BALANCE_GET),
            packet
        );

        this._checkResponseCode(responsePacket);
        data.updateSeq(responsePacket[4]);

        const decrypted = this._decryptAES256(responsePacket[8], session.aky);
        const raw: ServerBalanceGetResponse = JSON.parse(decrypted);

        console.log(`%c[BalanceGet] Balance=${raw.Balance} Currency=${raw.Currency}`, 'color:#0af;font-weight:bold');
        return { balance: raw.Balance, currency: raw.Currency };
    }

    // ═══════════════════════════════════════════════════════════
    //  INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * Build common request packet (CCRequestCommonPacket) theo tài liệu.
     * Format: MessagePack Array [PID, API, MIDX, SKEY, SEQ, AUTH_TOKEN, Ver, Data, LID, SlotID]
     */
    private _buildPacket(
        api: string,
        memberIdx: number,
        sessionKey: bigint | number,
        seq: number,
        encryptedData: string
    ): any[] {
        // sessionKey phải là BigInt để msgpackr encode thành int64 (uint64),
        // tránh encode thành float64 làm server reject.
        const skey: bigint = typeof sessionKey === 'bigint' ? sessionKey : BigInt(sessionKey);
        return [
            0,                            // [0] PID (not used)
            null,                         // [1] API (not used by server)
            memberIdx,                    // [2] MIDX
            skey,                         // [3] SKEY — BigInt → msgpackr encodes as uint64
            seq,                          // [4] SEQ
            null,                         // [5] AUTH_TOKEN (not used)
            ServerConfig.GAME_VERSION,    // [6] Ver
            encryptedData,                // [7] Data (AES encrypted)
            ServerConfig.DEFAULT_LID,     // [8] LID
            ServerConfig.SLOT_ID,         // [9] SlotID
        ];
    }

    /**
     * Gửi HTTP POST request với MessagePack body.
     *
     * ⚠ QUAN TRỌNG (theo tài liệu):
     * - Content-Type: application/json (nhưng body thực tế là MessagePack binary)
     * - Cần thư viện msgpackr để serialize/deserialize
     */
    private async _sendRequest(url: string, packet: any[]): Promise<any[]> {
        const body = _packr.pack(packet);

        // Parse API name from URL
        const apiName = url.split('/').slice(-2).join('/'); // e.g., "Slot/16/Spin"
        const isJackpotPolling = apiName.includes('Jackpot');

        // Log 1: gửi request (skip nếu Jackpot polling và LOG_JACKPOT_POLLING=false)
        if (!isJackpotPolling || ServerConfig.LOG_JACKPOT_POLLING) {
            const requestDesc = this._getRequestDesc(apiName, packet);
            console.log(`[Network] ↑ ${apiName} | ${requestDesc} | SEQ=${packet[4]} | ${body.byteLength}B`);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ServerConfig.REQUEST_TIMEOUT);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const buffer = await response.arrayBuffer();
            const rawBytes = new Uint8Array(buffer);

            let unpacked: any;
            try {
                unpacked = _packr.unpack(rawBytes) as any[];
            } catch (unpackErr: any) {
                console.error(`[Network] ❌ unpack failed (${apiName}):`, unpackErr.message);
                _hexDump(rawBytes, 'failed response', 64);
                throw unpackErr;
            }

            // Log 2: nhận response (skip nếu Jackpot polling và LOG_JACKPOT_POLLING=false)
            if (!isJackpotPolling || ServerConfig.LOG_JACKPOT_POLLING) {
                const code = unpacked[5];
                const codeMsg = code === 0 ? 'OK' : `ERROR(${code})`;
                const responseDesc = this._getResponseDesc(apiName, unpacked);
                console.log(`[Network] ↓ ${apiName} | ${responseDesc} | CODE=${codeMsg}`);
            }

            return unpacked as any[];
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /** Mô tả mục đích request */
    private _getRequestDesc(api: string, packet: any[]): string {
        if (api.includes('Login'))      return 'Đăng nhập';
        if (api.includes('Enter'))      return 'Vào game, yêu cầu ParSheet';
        if (api.includes('Spin'))       return 'Yêu cầu quay, tính toán kết quả';
        if (api.includes('Claim'))      return 'Nhận winnings, trả khóa Free Spin';
        if (api.includes('Jackpot'))    return 'Lấy giá trị Jackpot hiện tại';
        if (api.includes('HeartBeat'))  return 'Giữ session sống';
        return 'Request';
    }

    /** Mô tả kết quả response */
    private _getResponseDesc(api: string, packet: any[]): string {
        const code = packet[5];
        if (code !== 0) return `Error: ${packet[6]}`;

        if (api.includes('Login'))      return `Nhận SessionKey, MemberIdx=${packet[2]}`;
        if (api.includes('Enter'))      return `Cash=${packet[8]?.search?.(/Cash/) ? '✓' : '?'}, PS=${packet[8]?.length ?? 0}B`;
        if (api.includes('Spin'))       return `TotalWin=?, NextStage=?`;
        if (api.includes('Claim'))      return `NewCash=?, WinCash=?`;
        if (api.includes('Jackpot'))    return `Wins=[?,?,?,?]`;
        if (api.includes('HeartBeat'))  return `SessionOK`;
        return 'Success';
    }

    /**
     * Gửi request với retry logic (cho SeqRequest APIs).
     * Timeout → retry cùng SEQ tối đa 3 lần.
     */
    private async _sendRequestWithRetry(url: string, packet: any[]): Promise<any[]> {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < ServerConfig.MAX_RETRY; attempt++) {
            try {
                return await this._sendRequest(url, packet);
            } catch (err: any) {
                // Nếu là ServerApiError (server đã trả về code != 0), không retry
                if (err instanceof ServerApiError) {
                    throw err;
                }
                lastError = err;
                console.warn(`[Network] Retry ${attempt + 1}/${ServerConfig.MAX_RETRY} for ${url}:`, err.message);
            }
        }
        // Hết lượt retry — network / timeout error → emit DISCONNECTED popup
        const networkErr = lastError ?? new Error('Request failed after retries');
        console.error(`[Network] ❌ All retries failed: ${networkErr.message}`);
        EventBus.instance.emit(GameEvents.SHOW_SYSTEM_POPUP, { popupCase: PopupCase.DISCONNECTED });
        throw new ServerApiError(networkErr.message, 0, true);
    }

    /** Check response CODE field — 0 = success.
     * Nếu code != 0: emit SHOW_SYSTEM_POPUP ngay tại đây và throw ServerApiError.
     */
    private _checkResponseCode(packet: any[]): void {
        const code = packet[5] as number;
        const msg = (packet[6] as string) || '';
        if (code !== 0) {
            const popupCase = PopUpMessage.popupCaseFromServerCode(code);
            console.error(`[Network] ❌ Server error [${code}]: ${msg} → popup: ${popupCase}`);
            EventBus.instance.emit(GameEvents.SHOW_SYSTEM_POPUP, { popupCase });
            throw new ServerApiError(`Server error [${code}]: ${msg}`, code, true);
        }
    }

    /**
     * Convert server SpinResponse → internal SpinResponse format.
     * Server dùng PascalCase, client dùng camelCase.
     */
    private _convertSpinResponse(raw: ServerSpinResponse): SpinResponse {
        const res = raw.Res;
        const matchedLinePays = (res.MatchedLinePays || []).map((lp: ServerMatchedLinePay) => {
            // MatchedSymbolsIndices format: [[{Item1:col, Item2:row}, ...]]
            // Inner array = 1 per matched symbol position (1 per reel)
            const rawIndices = lp.MatchedSymbolsIndices;

            // ═══ LOG RAW MatchedSymbolsIndices — quan trọng để debug FreeSpin highlight ═══
            console.error(
                `[CONVERT] Line#${lp.PayLineIndex} MatchedSymbolsIndices raw=${JSON.stringify(rawIndices)}` +
                ` MatchedSymbols=${JSON.stringify(lp.MatchedSymbols)} ContainsWild=${lp.ContainsWild}`
            );

            let indices: Array<{Item1: number; Item2: number}> | null = null;
            if (Array.isArray(rawIndices) && rawIndices.length > 0) {
                const inner = rawIndices[0];
                if (Array.isArray(inner) && inner.length > 0 && 'Item1' in inner[0]) {
                    indices = inner as Array<{Item1: number; Item2: number}>;
                } else if ('Item1' in rawIndices[0]) {
                    // Flat format (not nested)
                    indices = rawIndices as Array<{Item1: number; Item2: number}>;
                }
            }

            if (indices) {
                console.error(
                    `[CONVERT] Line#${lp.PayLineIndex} indices parsed → ${indices.map(i => `(col=${i.Item1},row=${i.Item2})`).join(' ')}`
                );
            } else {
                console.error(`[CONVERT] Line#${lp.PayLineIndex} indices=null → fallback to payline config`);
            }
            // Giữ matchedSymbols là raw PS IDs từ server.
            // PayOutDisplay sẽ so sánh trực tiếp với psWinTypeIds (real API)
            // hoặc với client SymbolId enum (mock — psWinTypeIds.oneSeven === -1).
            console.error(`[DEBUG MatchedSymbols] line#${lp.PayLineIndex} server raw=${JSON.stringify(lp.MatchedSymbols)} containsWild=${lp.ContainsWild}`);
            // Server PayLineIndex là 0-based, khớp với client config.paylines
            return {
                payLineIndex: lp.PayLineIndex,
                payout: lp.Payout,
                matchedSymbols: lp.MatchedSymbols as number[],
                containsWild: lp.ContainsWild,
                reelCnt: lp.ReelCnt ?? 3,
                matchedSymbolsIndices: indices,
            };
        });

        // Rands từ server index thẳng vào full strip (bao gồm cả empty).
        // KHÔNG convert — dùng trực tiếp.
        return {
            rands: res.Rands as number[],
            matchedLinePays,
            totalBet: res.TotalBet,
            totalWin: res.TotalWin,
            updateCash: res.UpdateCash,
            nextStage: res.NextStage,
            featureMultiple: res.FeatureMultiple ?? res.MysteryMultiple,
            remainCash: raw.RemainCash,
            remainFreeSpinCount: Math.max(0, res.RemainFreeSpinCount ?? 0),
            winGrade: res.WinGrade ?? undefined,
            featureSpinTotalWin: res.FeatureSpinTotalWin ?? 0,
        };
    }

    // ─── AES ENCRYPTION (via CryptoUtils) ───

    private _encryptAES128(plainText: string): string {
        return encryptAES128(plainText);
    }

    private _decryptAES128(cipherText: string): string {
        return decryptAES128(cipherText);
    }

    private _encryptAES256(plainText: string, aky: string): string {
        return encryptAES256(plainText, aky);
    }

    private _decryptAES256(cipherText: string, aky: string): string {
        return decryptAES256(cipherText, aky);
    }

    // ─── PS (ParSheet) DECRYPTION (via CryptoUtils) ───

    private _decryptPS(psBase64: string): any {
        return decryptPS(psBase64);
    }

    /**
     * Áp dụng ParSheet (PS) đã giải nén vào GameData.config.
     *
     * PS format (từ SuperNova PS.json):
     * {
     *   Bet: number[],
     *   CoinValue: number[],
     *   WinPopup: { Normal, Big, Super, Mega },
     *   Reel: { Strips: [ { Symbols: number[] }, ... ] },
     *   FreeSpinReel?: { Strips: [...] },
     *   GameName: string,
     *   ...
     * }
     *
     * Reel.Strips[i].Symbols chứa PS Symbol IDs (1,2,3,4,11,12,...)
     * → cần convert sang Client SymbolId (0-8) qua psToClientSymbol().
     */
    private _applyPS(ps: any): void {
        const data = GameData.instance;

        // Bet options
        if (ps.Bet && Array.isArray(ps.Bet)) {
            data.config.betOptions = ps.Bet;
        }

        // Coin values
        if (ps.CoinValue && Array.isArray(ps.CoinValue)) {
            data.config.coinValues = ps.CoinValue;
        }

        // Win popup thresholds
        if (ps.WinPopup) {
            data.config.bigWinThreshold = ps.WinPopup.Big ?? data.config.bigWinThreshold;
            data.config.megaWinThreshold = ps.WinPopup.Mega ?? data.config.megaWinThreshold;
            data.config.superWinThreshold = ps.WinPopup.Super ?? data.config.superWinThreshold;
        }

        // ═══ Build dynamic PS ID → Client SymbolId mapping từ PS JSON fields ═══
        const dynMap: Record<number, number> = {};
        const psSymbolFields: Array<[string, number]> = [
            ['OneSevenSymbolID',    SymbolId.SEVEN_SINGLE],
            ['DoubleSevenSymbolID', SymbolId.SEVEN_DOUBLE],
            ['TripleSevenSymbolID', SymbolId.SEVEN_TRIPLE],
            ['OneBarSymbolID',      SymbolId.BAR_SINGLE],
            ['DoubleBarSymbolID',   SymbolId.BAR_DOUBLE],
            ['TripleWildSymbolID',  SymbolId.WILD_3X],
            ['RedWildSymbolID',     SymbolId.RED_LIGHTNING],
            ['BlueWildSymbolID',    SymbolId.BLUE_LIGHTNING],
            ['ScatterSymbolID',     SymbolId.BONUS],
        ];
        for (const [field, clientId] of psSymbolFields) {
            const psId = ps[field];
            if (typeof psId === 'number') dynMap[psId] = clientId;
        }

        // Group IDs (AnySevenGroupID, AnyBarGroupID, AnyWildGroupID) —
        // xuất hiện trên reel strip như symbol hiển thị chung cho nhóm
        // Map về symbol đại diện của nhóm (highest value)
        const groupFields: Array<[string, number]> = [
            ['AnySevenGroupID',  SymbolId.SEVEN_SINGLE],  // any-7 → show as '7'
            ['AnyBarGroupID',    SymbolId.BAR_SINGLE],    // any-bar → show as 'BAR'
            ['AnyWildGroupID',   SymbolId.WILD_3X],       // any-wild → show as '3X'
        ];
        for (const [field, clientId] of groupFields) {
            const psId = ps[field];
            if (typeof psId === 'number' && !(psId in dynMap)) dynMap[psId] = clientId;
        }

        // Empty: map to -1 (no sprite / transparent)
        const emptyPsId: number = ps.EmptySymbolID ?? 99;
        dynMap[emptyPsId] = -1;

        console.log(
            `[PS:SymbolMap] ` +
            psSymbolFields.map(([f]) => `${f.replace('SymbolID','')}=${ps[f] ?? '?'}`).join(' ') +
            ` | Empty=${emptyPsId}` +
            ` | Groups: ${groupFields.map(([f]) => `${f.replace('GroupID','')}=${ps[f] ?? '?'}`).join(' ')}`
        );
        data.psToClientMap = dynMap;

        // ═══ Store named PS symbol IDs for PayOutDisplay win-type matching ═══
        data.psWinTypeIds = {
            oneSeven:    ps.OneSevenSymbolID    ?? -1,
            doubleSeven: ps.DoubleSevenSymbolID ?? -1,
            tripleSeven: ps.TripleSevenSymbolID ?? -1,
            anySeven:    ps.AnySevenGroupID     ?? -1,
            oneBar:      ps.OneBarSymbolID      ?? -1,
            doubleBar:   ps.DoubleBarSymbolID   ?? -1,
            anyBar:      ps.AnyBarGroupID       ?? -1,
            tripleWild:  ps.TripleWildSymbolID  ?? -1,
            redWild:     ps.RedWildSymbolID     ?? -1,
            blueWild:    ps.BlueWildSymbolID    ?? -1,
            anyWild:     ps.AnyWildGroupID      ?? -1,
        };
        console.error(
            `[PS:WinTypeIds] 1x7=${data.psWinTypeIds.oneSeven} 2x7=${data.psWinTypeIds.doubleSeven} 3x7=${data.psWinTypeIds.tripleSeven} any7=${data.psWinTypeIds.anySeven}` +
            ` | 1xBAR=${data.psWinTypeIds.oneBar} 2xBAR=${data.psWinTypeIds.doubleBar} anyBAR=${data.psWinTypeIds.anyBar}` +
            ` | 3xWild=${data.psWinTypeIds.tripleWild} RWild=${data.psWinTypeIds.redWild} BWild=${data.psWinTypeIds.blueWild} anyWild=${data.psWinTypeIds.anyWild}`
        );

        // ═══ Jackpot PS Symbol IDs — từ PS JSON fields ═══
        // Server dùng các ID này trên reel strip để biểu thị jackpot symbol.
        // Client detect jackpot bằng cách so sánh rawPsStrips với các ID này.
        data.jackpotPsIds = {
            MINI:  ps.MiniJackpotID  ?? data.jackpotPsIds.MINI,
            MINOR: ps.MinorJackpotID ?? data.jackpotPsIds.MINOR,
            MAJOR: ps.MajorJackpotID ?? data.jackpotPsIds.MAJOR,
            GRAND: ps.GrandJackpotID ?? data.jackpotPsIds.GRAND,
        };
        console.log(`[PS:JackpotIDs] MINI=${data.jackpotPsIds.MINI} MINOR=${data.jackpotPsIds.MINOR} MAJOR=${data.jackpotPsIds.MAJOR} GRAND=${data.jackpotPsIds.GRAND}`);

        // ═══ Reel Strips — giữ NGUYÊN fullstrip bao gồm cả Empty ═══
        // Rand từ server index thẳng vào full strip (kể cả empty).
        // Client dùng step=1 — server trả gì vẽ đó, kể cả empty.
        if (ps.Reel?.Strips && Array.isArray(ps.Reel.Strips)) {
            const rawAll: number[][] = [];
            let hasEmpties = false;
            data.config.reelStrips = ps.Reel.Strips.map((strip: any, idx: number) => {
                const rawSymbols: number[] = strip.Symbols ?? strip;
                rawAll.push([...rawSymbols]);

                // Convert PS IDs → client IDs, giữ empty thành -1
                const converted = rawSymbols.map(psId => dynMap[psId] ?? -2);

                const unknowns = [...new Set(rawSymbols.filter(id => !(id in dynMap)))];
                if (unknowns.length > 0) {
                    console.warn(`[PS:Reel${idx}] unknown PS IDs: [${unknowns.join(',')}]`);
                }
                const empties = rawSymbols.filter(id => id === emptyPsId).length;
                if (empties > 0) hasEmpties = true;
                console.log(`[PS:Reel${idx}] len=${rawSymbols.length} | empties=${empties} | real=${rawSymbols.length - empties}`);
                return converted;
            });
            data.rawPsStrips = rawAll;

            // Full strip dump — in toàn bộ mảng để verify
            const SYM_FMT = ['7','77','777','BAR','BB','3X','BNS','R⚡','B⚡'];
            const fmtSym = (id: number) => id === -1 ? '___' : (SYM_FMT[id] ?? `?${id}`);
            data.config.reelStrips.forEach((strip, c) => {
                console.log(`[STRIP:Reel${c}] len=${strip.length} → [${strip.map((s, i) => `${i}:${fmtSym(s)}`).join(', ')}]`);
            });
        } else {
            console.warn('[PS] Không có Reel.Strips — giữ nguyên DEFAULT_REEL_STRIPS');
        }

        // ═══ FreeSpinReel.Strips — lưu riêng để dùng khi visual FreeSpin ═══
        // Server dùng strips khác cho Free Spin (chiều dài khác, symbol distribution khác).
        // Rands từ FreeSpin API index vào FreeSpinReel, KHÔNG phải Reel.
        if (ps.FreeSpinReel?.Strips && Array.isArray(ps.FreeSpinReel.Strips)) {
            const rawFsAll: number[][] = [];
            data.config.freeSpinReelStrips = ps.FreeSpinReel.Strips.map((strip: any, idx: number) => {
                const rawSymbols: number[] = strip.Symbols ?? strip;
                rawFsAll.push([...rawSymbols]);
                const converted = rawSymbols.map((psId: number) => dynMap[psId] ?? -2);
                console.error(`[PS:FreeSpinReel${idx}] len=${rawSymbols.length}`);
                return converted;
            });
            data.rawPsFreeSpinStrips = rawFsAll;
        } else {
            // Fallback: dùng normal strips (sẽ gây visual mismatch trong FreeSpin — cần PS đúng)
            data.config.freeSpinReelStrips = data.config.reelStrips;
            data.rawPsFreeSpinStrips = data.rawPsStrips;
            console.error('[PS] FreeSpinReel.Strips không có — dùng fallback normal strips cho FreeSpin (visual có thể sai)');
        }

        console.log(`[PS:Keys] ${Object.keys(ps).join(', ')}`);

        // Đặt lại coinValue về giá trị đầu tiên từ PS
        if (data.config.coinValues.length > 0) {
            data.player.coinValue = data.config.coinValues[0];
        }

        console.log(
            `[PS] Reels=${data.config.reelStrips.length}` +
            ` (lengths: ${data.config.reelStrips.map(s => s.length).join('/')})` +
            ` | FreeSpinReels=${data.config.freeSpinReelStrips.length}` +
            ` (lengths: ${data.config.freeSpinReelStrips.map(s => s.length).join('/')})` +
            ` | Bet=[${data.config.betOptions.join(',')}]` +
            ` | CoinValue=[${data.config.coinValues.join(',')}]`
        );
    }

    /** Parse SMM (Server Maintenance Message) */
    private _parseSMM(raw: any): ServerMaintenanceMessage {
        return {
            ServerUtc: raw.ServerUtc,
            ShutdownUtc: raw.ShutdownUtc,
            Title: raw.Title,
            Line1: raw.Line1,
            Line2: raw.Line2,
            RemainMinutes: raw.RemainMinutes,
            DurationMinutes: raw.DurationMinutes,
            Step: raw.Step,
        };
    }
}

// ═══════════════════════════════════════════════════════════
//  NETWORK MANAGER SINGLETON
// ═══════════════════════════════════════════════════════════

export class NetworkManager {
    private static _instance: NetworkManager;
    private _adapter: INetworkAdapter;

    /** HeartBeat interval ID */
    private _heartBeatTimer: any = null;
    /** Jackpot polling interval ID */
    private _jackpotTimer: any = null;

    private constructor() {
        // ★ Chuyển đổi Mock ↔ Real dựa trên USE_REAL_API
        if (USE_REAL_API) {
            this._adapter = new RealNetworkAdapter();
            // console.log('[NetworkManager] Mode: REAL API');
        } else {
            this._adapter = new MockNetworkAdapter();
            // console.log('[NetworkManager] Mode: MOCK DATA');
        }
    }

    static get instance(): NetworkManager {
        if (!this._instance) {
            this._instance = new NetworkManager();
        }
        return this._instance;
    }

    /** Cho phép inject adapter khác (forced test scenario, etc.) */
    setAdapter(adapter: INetworkAdapter): void {
        this._adapter = adapter;
    }

    get isRealAPI(): boolean {
        return USE_REAL_API;
    }

    // ─── API METHODS ───

    /**
     * Login vào server.
     * @param params - { gp: string } cho WebLink login, hoặc undefined cho test login
     */
    login(params?: any): Promise<ServerSession> {
        return this._adapter.login(params);
    }

    /** Enter game — nhận config + initial state */
    enterGame(): Promise<ServerEnterResponse> {
        return this._adapter.enterGame();
    }

    sendSpinRequest(isFreeSpin: boolean): Promise<SpinResponse> {
        return this._adapter.sendSpinRequest(isFreeSpin);
    }

    sendClaimRequest(): Promise<{ balance: number; winCash?: number }> {
        return this._adapter.sendClaimRequest();
    }

    /** Notify server of bet/coinValue change immediately */
    sendGameOptChange(): Promise<void> {
        if (!USE_REAL_API) return Promise.resolve();
        const data = GameData.instance;
        const coinValueIndex = data.config.coinValues.indexOf(data.player.coinValue);
        return this._adapter.sendGameOptChange(data.player.betIndex, coinValueIndex);
    }

    /** Lấy danh sách gói Feature (Buy Bonus) */
    sendFeatureItemGet(): Promise<FeatureItem[]> {
        return this._adapter.sendFeatureItemGet();
    }

    /** Mua gói Feature (Buy Bonus) — SeqRequest */
    sendFeatureItemBuy(itemId: number, onOff: boolean = false): Promise<{ isSuccess: boolean; remainCash: number; res: any | null }> {
        return this._adapter.sendFeatureItemBuy(itemId, onOff);
    }

    /** Refresh balance từ partner callback (dùng khi insufficient funds, e.g. top-up) */
    sendBalanceGet(): Promise<{ balance: number; currency: string }> {
        return this._adapter.sendBalanceGet();
    }

    /** Bắt đầu polling jackpot (mỗi 2 giây) */
    startJackpotPolling(): void {
        this.stopJackpotPolling();
        if (!USE_REAL_API) return; // Mock không cần poll
        this._jackpotTimer = setInterval(async () => {
            try {
                await this._adapter.pollJackpot();
            } catch (err) {
                console.warn('[Jackpot Poll] Error:', err);
            }
        }, ServerConfig.JACKPOT_POLL_INTERVAL);
    }

    stopJackpotPolling(): void {
        if (this._jackpotTimer) {
            clearInterval(this._jackpotTimer);
            this._jackpotTimer = null;
        }
    }

    /** Bắt đầu HeartBeat (mỗi 10 giây) */
    startHeartBeat(): void {
        this.stopHeartBeat();
        if (!USE_REAL_API) return;
        this._heartBeatTimer = setInterval(async () => {
            try {
                await this._adapter.sendHeartBeat();
            } catch (err) {
                console.warn('[HeartBeat] Error:', err);
            }
        }, ServerConfig.HEARTBEAT_INTERVAL);
    }

    stopHeartBeat(): void {
        if (this._heartBeatTimer) {
            clearInterval(this._heartBeatTimer);
            this._heartBeatTimer = null;
        }
    }

    /** Dọn dẹp tất cả timers */
    dispose(): void {
        this.stopJackpotPolling();
        this.stopHeartBeat();
    }
}
export { USE_REAL_API };

