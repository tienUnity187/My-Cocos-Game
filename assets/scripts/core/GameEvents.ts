/**
 * GameEvents - Định nghĩa tất cả Event key dùng trong game.
 * Tập trung 1 chỗ, tránh dùng magic string.
 * @updated BuyBonusSystem events added
 */

export const GameEvents = {
    // ─── SPIN FLOW ───
    /** Người chơi nhấn nút Spin */
    SPIN_REQUEST: 'spin:request',
    /** Balance OK, bắt đầu quay reel ngay (trước khi chờ server) */
    REELS_START_SPIN: 'reels:start:spin',
    /** Nhận được SpinResponse (từ mock/server) → ra lệnh dừng reel */
    SPIN_RESPONSE: 'spin:response',
    /** Tất cả reel đã dừng xong */
    REELS_STOPPED: 'reels:stopped',
    /** Một reel đơn lẻ đã dừng */
    REEL_STOPPED: 'reel:stopped',
    /** Resume Normal Spin bị gián đoạn: snap reel về vị trí kết quả cuối rồi emit REELS_STOPPED */
    RESUME_NORMAL_SPIN: 'resume:normal:spin',

    // ─── WIN ───
    /** Có line thắng, bắt đầu trình diễn */
    WIN_PRESENT_START: 'win:present:start',
    /** Kết thúc trình diễn win */
    WIN_PRESENT_END: 'win:present:end',
    /** Show popup BigWin / MegaWin */
    WIN_POPUP: 'win:popup',
    /** Count-up tiền thắng hoàn tất */
    WIN_COUNTUP_DONE: 'win:countup:done',
    /** Hiện tất cả winning lines cùng 1 lúc (payload: MatchedLinePay[]) */
    WIN_SHOW_ALL_LINES: 'win:show:all:lines',
    /** Tất cả animation spine highlight đã hoàn tất (hoặc không có spine nào) */
    WIN_HIGHLIGHT_ANIM_DONE: 'win:highlight:anim:done',

    // ─── JACKPOT ───
    JACKPOT_TRIGGER: 'jackpot:trigger',
    JACKPOT_END: 'jackpot:end',
    JACKPOT_LOOP_START: 'jackpot:loop:start',

    // ─── WALLET & BET ───
    BALANCE_UPDATED: 'wallet:balance:updated',
    BET_CHANGED: 'bet:changed',

    // ─── FREE SPIN ───
    FREE_SPIN_START: 'freespin:start',
    FREE_SPIN_END: 'freespin:end',
    FREE_SPIN_COUNT_UPDATED: 'freespin:count:updated',
    /** Người chơi bấm nút Auto Spin Free — kiểm tra điều kiện & chuyển mode */
    FREE_SPIN_AUTO_TRIGGERED: 'freespin:auto:triggered',
    FREE_SPIN_MULTIPLIER: 'freespin:multiplier',
    /** Phase 1: Bắt đầu quay reel → hiệu ứng rolling các hệ số nhân */
    FREE_SPIN_MULTIPLIER_SPIN: 'freespin:multiplier:spin',
    /** Phase 2: Server trả kết quả → chốt hệ số nhân (kèm value: number) */
    FREE_SPIN_MULTIPLIER_LOCK: 'freespin:multiplier:lock',
    /** Phase 3: Clone animation bay xong (hoặc no-win skip) → an toàn để bắt đầu auto-spin tiếp */
    FREE_SPIN_MULTIPLIER_FLY_DONE: 'freespin:multiplier:fly:done',
    /** Phase 4: Spin cycle kết thúc → ẩn display */
    FREE_SPIN_MULTIPLIER_HIDE: 'freespin:multiplier:hide',
    /** Khi trúng Bonus trigger: highlight spine trên symbol Bonus trước khi FreeSpinPopup hiện — payload: {reelIndex, rowIndex}[] */
    FREE_SPIN_BONUS_REVEAL: 'freespin:bonus:reveal',

    // ─── GAME STATE ───
    STAGE_CHANGED: 'game:stage:changed',
    GAME_READY: 'game:ready',

    // ─── LONG SPIN ───
    LONG_SPIN_TRIGGERED: 'longspin:triggered',
    /** VFX bật khi Cột 3 vào trạng thái long spin (anticipation) */
    LONG_SPIN_VFX_START: 'longspin:vfx:start',
    /** VFX tắt khi Cột 3 khựng lại xong */
    LONG_SPIN_VFX_END: 'longspin:vfx:end',
    /** Bounce gợi ý 2 symbol có thể tạo jackpot — payload: {reelIndex, rowIndex}[] */
    LONG_SPIN_SYMBOL_HINT: 'longspin:symbol:hint',
    /** Hiện spine hint trên 2 symbol khi VFX bắt đầu — payload: {reelIndex, rowIndex}[] */
    LONG_SPIN_HINT_SHOW: 'longspin:hint:show',
    /** Jackpot được xác nhận: phát spine hiệu ứng trên cả 3 symbol trước khi popup hiện — payload: {reelIndex, rowIndex}[] */
    LONG_SPIN_JACKPOT_REVEAL: 'longspin:jackpot:reveal',

    // ─── UI ───
    UI_SPIN_BUTTON_STATE: 'ui:spinbutton:state',
    UI_UPDATE_WIN_LABEL: 'ui:winlabel:update',
    UI_UPDATE_BET_LABEL: 'ui:betlabel:update',

    // ─── FREE SPIN POPUP ───
    /** Hiển thị popup thông báo Free Spin (kèm số lượt) */
    FREE_SPIN_POPUP: 'ui:freespin:popup',

    // ─── PROGRESSIVE WIN ───
    /** Hiện popup Progressive Win (BIG/SUPER/EPIC/MEGA) — payload: tier, amount */
    PROGRESSIVE_WIN_SHOW: 'progressivewin:show',
    /** Popup Progressive Win đóng xong */
    PROGRESSIVE_WIN_END: 'progressivewin:end',

    // ─── FREE SPIN END POPUP ───
    /** Hiện popup tổng kết Free Spin — payload: totalWin, spinCount */
    FREE_SPIN_END_POPUP: 'freespin:end:popup',
    /** Popup tổng kết Free Spin đóng xong */
    FREE_SPIN_END_POPUP_CLOSED: 'freespin:end:popup:closed',

    // ─── INTRO FLOW ───
    /** Loading bar đạt 90% — gửi tín hiệu bắt đầu tải dữ liệu server */
    LOADING_GATE_REACHED: 'intro:loading:gate',
    /** LoadingController hoàn tất → chuyển sang GuideController */
    LOADING_COMPLETE: 'intro:loading:complete',
    /** Người chơi bấm CLICK TO CONTINUE → vào game chính */
    GUIDE_COMPLETE: 'intro:guide:complete',
    /** Kích hoạt hiệu ứng tiến vào Pot (팟 진입 연출) */
    GAME_ENTRY_EFFECT: 'game:entry:effect',

    // ─── SERVER API ───
    /** Login bắt đầu */
    LOGIN_START: 'server:login:start',
    /** Login thành công — payload: ServerSession */
    LOGIN_SUCCESS: 'server:login:success',
    /** Login thất bại — payload: error string */
    LOGIN_FAILED: 'server:login:failed',
    /** Enter game thành công — payload: ServerEnterResponse */
    ENTER_SUCCESS: 'server:enter:success',
    /** Enter game thất bại */
    ENTER_FAILED: 'server:enter:failed',
    /** Server maintenance message nhận được — payload: ServerMaintenanceMessage */
    SERVER_MAINTENANCE: 'server:maintenance',
    /** Jackpot values cập nhật từ server — payload: number[] */
    JACKPOT_VALUES_UPDATED: 'server:jackpot:updated',

    // ─── LOCALIZATION ───
    /** Ngôn ngữ thay đổi — payload: LanguageCode string */
    LANGUAGE_CHANGED: 'i18n:language:changed',

    // ─── AUTO SPIN ───
    /** Số lượt auto spin thay đổi — payload: number */
    AUTO_SPIN_CHANGED: 'autospin:changed',
    /** Chế độ tốc độ thay đổi — payload: SpeedMode string */
    SPEED_MODE_CHANGED: 'autospin:speed:changed',
    /** Một vòng Normal Spin kết thúc và game về IDLE (dùng cho auto spin trigger) */
    NORMAL_SPIN_DONE: 'spin:normal:done',

    // ─── BUY BONUS ───
    /** Người chơi bấm nút Buy Bonus → yêu cầu lấy danh sách gói */
    BUY_BONUS_REQUEST: 'buybonus:request',
    /** Danh sách gói Feature đã load xong — payload: FeatureItem[] */
    BUY_BONUS_ITEMS_LOADED: 'buybonus:items:loaded',
    /** Người chơi xác nhận mua gói — payload: FeatureItem */
    BUY_BONUS_CONFIRM: 'buybonus:confirm',
    /** Mua thành công — payload: { remainCash: number } */
    BUY_BONUS_SUCCESS: 'buybonus:success',
    /** Mua thất bại — payload: error string */
    BUY_BONUS_FAILED: 'buybonus:failed',
    /** Yêu cầu activate item (effectType 2/3) — payload: FeatureItem */
    BUY_BONUS_ACTIVATE: 'buybonus:activate',
    /** Activate thành công — payload: { itemId: number, priceRatio: number, remainCash: number } */
    BUY_BONUS_ACTIVATE_SUCCESS: 'buybonus:activate:success',
    /** Yêu cầu deactivate item — không cần payload */
    BUY_BONUS_DEACTIVATE: 'buybonus:deactivate',
    /** Deactivate thành công */
    BUY_BONUS_DEACTIVATE_SUCCESS: 'buybonus:deactivate:success',
    /** Total Bet đã thay đổi do activate item — payload: { displayBet: number, isActive: boolean } */
    BUY_BONUS_TOTAL_BET_CHANGED: 'buybonus:totalbet:changed',

    // ─── BUY BONUS SYSTEM (New) ───
    /** Danh sách IBonusItem đã load xong — payload: { items: IBonusItem[], balance: number, totalBet: number } */
    BONUS_SYSTEM_ITEMS_LOADED: 'bonussystem:items:loaded',
    /** User chọn 1 item từ list → mở recheck popup — payload: IBonusItem */
    BONUS_SYSTEM_ITEM_SELECTED: 'bonussystem:item:selected',
    /** User xác nhận mua/bật item từ recheck popup — payload: IBonusItem */
    BONUS_SYSTEM_ITEM_CONFIRMED: 'bonussystem:item:confirmed',
    /** Item activate được bật thành công — payload: { itemId: string } */
    BONUS_SYSTEM_ACTIVATE_ON: 'bonussystem:activate:on',
    /** Item activate được tắt (cancel) — payload: { itemId: string } */
    BONUS_SYSTEM_ACTIVATE_OFF: 'bonussystem:activate:off',
    /** Mua item onceuse thành công — payload: IBonusItem */
    BONUS_SYSTEM_ONCEUSE_SUCCESS: 'bonussystem:onceuse:success',
    /** TotalBet thay đổi → tất cả giá item đã được tính lại */
    BONUS_SYSTEM_PRICES_UPDATED: 'bonussystem:prices:updated',

    // ─── PAY TABLE ───
    /** Mở popup PayTable (Info) */
    PAY_TABLE_OPEN: 'ui:paytable:open',

    // ─── SYSTEM POPUP ───
    /** Hiển thị system popup thông báo lỗi — payload: SystemPopupPayload */
    SHOW_SYSTEM_POPUP: 'ui:system:popup',
} as const;
