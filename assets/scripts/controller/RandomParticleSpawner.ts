/**
 * RandomParticleSpawner - Spawn particle effect tại vị trí ngẫu nhiên theo chu kỳ.
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Gắn component này vào bất kỳ node nào trong scene.
 *   2. Kéo n node rỗng (chỉ dùng để đánh dấu vị trí) vào mảng positionNodes.
 *   3. Kéo 1 node chứa particle (particle nằm ở các child) vào particleContainer.
 *   4. Cấu hình minInterval / maxInterval (giây) và minScalePct / maxScalePct (%).
 *
 * ── FLOW ──
 *   1. Chờ random(minInterval, maxInterval) giây.
 *   2. Chọn ngẫu nhiên 1 node trong positionNodes.
 *   3. Dịch particleContainer đến worldPosition của node đó.
 *   4. Random scale mỗi child của particleContainer (minScalePct% → maxScalePct%).
 *   5. Play tất cả ParticleSystem (mỗi lần play 1 lần, không loop).
 *   6. Lặp lại từ bước 1 vô tận.
 */

import { _decorator, Component, Node, ParticleSystem, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('RandomParticleSpawner')
export class RandomParticleSpawner extends Component {

    // ── EDITOR SLOTS ──────────────────────────────────────────────────────────

    /** Danh sách n node rỗng chứa vị trí để random */
    @property({
        type: [Node],
        tooltip: 'Danh sách node rỗng đánh dấu vị trí.\nMỗi lần spawn sẽ chọn ngẫu nhiên 1 node trong danh sách này.'
    })
    positionNodes: Node[] = [];

    /** Node chứa particle (các ParticleSystem nằm ở child) */
    @property({
        type: Node,
        tooltip: 'Node chứa particle effect.\nCác ParticleSystem phải là child của node này.'
    })
    particleContainer: Node | null = null;

    // ── TIMING PARAMS ─────────────────────────────────────────────────────────

    /** Thời gian tối thiểu giữa các lần spawn (giây) */
    @property({ tooltip: 'Thời gian tối thiểu giữa 2 lần spawn (giây).\nDefault: 3' })
    minInterval: number = 3.0;

    /** Thời gian tối đa giữa các lần spawn (giây) */
    @property({ tooltip: 'Thời gian tối đa giữa 2 lần spawn (giây).\nDefault: 5' })
    maxInterval: number = 5.0;

    // ── SCALE PARAMS ──────────────────────────────────────────────────────────

    /** Scale tối thiểu (%) áp dụng cho mỗi child của particleContainer */
    @property({ tooltip: 'Scale tối thiểu (%) cho mỗi child particle.\n50 = 50% kích thước gốc.\nDefault: 50' })
    minScalePct: number = 50;

    /** Scale tối đa (%) áp dụng cho mỗi child của particleContainer */
    @property({ tooltip: 'Scale tối đa (%) cho mỗi child particle.\n100 = kích thước gốc.\nDefault: 100' })
    maxScalePct: number = 100;

    // ── INTERNAL ─────────────────────────────────────────────────────────────

    private _particles: ParticleSystem[] = [];
    private _loopCb: (() => void) | null = null;

    // ── LIFECYCLE ────────────────────────────────────────────────────────────

    onLoad(): void {
        if (this.particleContainer) {
            this.particleContainer.active = false;
        }
    }

    start(): void {
        this._gatherParticles();
        this._scheduleNext();
    }

    onDestroy(): void {
        this._cancelLoop();
    }

    // ── PRIVATE ──────────────────────────────────────────────────────────────

    /** Thu thập tất cả ParticleSystem từ particleContainer và các child của nó */
    private _gatherParticles(): void {
        this._particles = [];
        if (!this.particleContainer) return;

        const self = this.particleContainer.getComponent(ParticleSystem);
        if (self) this._particles.push(self);

        for (const child of this.particleContainer.children) {
            const ps = child.getComponent(ParticleSystem);
            if (ps) this._particles.push(ps);
        }
    }

    /** Lên lịch lần spawn tiếp theo với khoảng thời gian ngẫu nhiên */
    private _scheduleNext(): void {
        const delay = this.minInterval + Math.random() * (this.maxInterval - this.minInterval);
        this._loopCb = () => {
            this._loopCb = null;
            this._spawn();
            this._scheduleNext();
        };
        this.scheduleOnce(this._loopCb, delay);
    }

    /** Thực hiện 1 lần spawn: chọn vị trí, scale, rồi play particle */
    private _spawn(): void {
        if (!this.particleContainer || this.positionNodes.length === 0) return;

        // 1. Chọn ngẫu nhiên 1 vị trí
        const idx = Math.floor(Math.random() * this.positionNodes.length);
        const target = this.positionNodes[idx];
        if (!target || !target.isValid) return;

        // 2. Dịch particleContainer đến worldPosition của node đó
        this.particleContainer.active = true;
        this.particleContainer.setWorldPosition(target.worldPosition);

        // 3. Random scale cho từng child
        const minS = this.minScalePct ;
        const maxS = this.maxScalePct ;
        for (const child of this.particleContainer.children) {
            const s = minS + Math.random() * (maxS - minS);
            child.setScale(new Vec3(s, s, s));
        }

        // 4. Play tất cả ParticleSystem 1 lần (không loop)
        for (const ps of this._particles) {
            if (!ps || !ps.isValid) continue;
     
            ps.play();
        }
    }

    /** Hủy lịch loop hiện tại */
    private _cancelLoop(): void {
        if (this._loopCb) {
            this.unschedule(this._loopCb);
            this._loopCb = null;
        }
     
    }
}
