import { _decorator, Component, Node, view, ResolutionPolicy, screen } from 'cc';

const { ccclass, property, executionOrder } = _decorator;

/**
 * ResponsiveController — PHẢI chạy trước mọi component khác.
 *
 * Vấn đề gốc:
 *   executionOrder(-1000) → onLoad của class này chạy TRƯỚC Canvas.
 *   Nhưng Canvas.onLoad() chạy SAU và override lại resolution về setting của editor.
 *   → Giải pháp: KHÔNG set resolution trong onLoad(). Chỉ set trong start().
 *   → start() chạy sau KHI TẤT CẢ onLoad() đã xong (kể cả Canvas) → không bị override.
 *   → Activate nodes trong start() SAU KHI set resolution → Widget tính layout đúng lần đầu.
 */
@ccclass('ResponsiveController')
@executionOrder(-1000)
export class ResponsiveController extends Component {

    // CHÚ Ý: Hãy sửa 2 số này thành đúng kích thước bạn thiết kế trên editor
    private readonly DESIGN_LANDSCAPE_WIDTH = 1920; 
    private readonly DESIGN_LANDSCAPE_HEIGHT = 1080;

    @property({
        type: [Node],
        tooltip: 'Các node cần giữ inactive khi load scene. Sẽ được activate SAU KHI resolution được fix đúng (cuối start()). Để trong scene với active = false.',
        displayName: 'Nodes Activate After Layout',
    })
    nodesActivateAfterLayout: Node[] = [];

    onLoad(): void {
        // Force các node inactive TRƯỚC KHI onLoad của chúng fire.
        // (class này chạy trước nhờ executionOrder -1000)
        // KHÔNG gọi _applyOrientation() ở đây — Canvas.onLoad() chạy SAU và sẽ override.
        for (const node of this.nodesActivateAfterLayout) {
            if (node) node.active = false;
        }

        screen.on('window-resize', this._applyOrientation, this);
        screen.on('orientation-change', this._applyOrientation, this);
    }

    start(): void {
        // Tất cả onLoad() (kể cả Canvas) đã chạy xong.
        // Gọi _applyOrientation() ở đây để override Canvas, không bị override lại.
        this._applyOrientation();

        // Activate nodes SAU KHI resolution đúng.
        // Widget.onEnable của các node này sẽ tính layout với resolution chính xác.
        for (const node of this.nodesActivateAfterLayout) {
            if (node) node.active = true;
        }
    }

    onDestroy(): void {
        screen.off('window-resize', this._applyOrientation, this);
        screen.off('orientation-change', this._applyOrientation, this);
    }

    private _applyOrientation(): void {
        const size = screen.windowSize;
        const isPortrait = size.height > size.width;
   
        if (isPortrait) {
            // MÀN HÌNH DỌC: Đảo chiều Design Size (thành 1080x1920) và fix Width
            view.setDesignResolutionSize(
                this.DESIGN_LANDSCAPE_HEIGHT, 
                this.DESIGN_LANDSCAPE_WIDTH,  
                ResolutionPolicy.FIXED_WIDTH
            );
            console.log('[Responsive] Xoay Dọc -> Design: 1080x1920, FIXED_WIDTH' + "node name= "+ this.node.name);
        } else {
            // MÀN HÌNH NGANG: Giữ nguyên Design Size (1920x1080) và fix Height
            view.setDesignResolutionSize(
                this.DESIGN_LANDSCAPE_WIDTH,  
                this.DESIGN_LANDSCAPE_HEIGHT, 
                ResolutionPolicy.FIXED_HEIGHT
            );
            console.log('[Responsive] Xoay Ngang -> Design: 1920x1080, FIXED_HEIGHT');
        }
    }
}