// 相机管理页面 - 列表、状态、V4L2 控制项实时调参
const CamerasPage = {
    refreshTimer: null,
    refreshIntervalMs: 2000,

    async render(container) {
        container.innerHTML = `
            <div class="card">
                <div class="card-title">
                    <span>📷 Cameras</span>
                    <button class="btn btn-secondary btn-sm" id="btnViewAll">👁️ 显示全部</button>
                    <button class="btn btn-secondary btn-sm" id="btnRescan">扫描可用设备</button>
                    <button class="btn btn-secondary btn-sm" id="btnRefresh">刷新</button>
                </div>
                <div id="camerasContent">
                    <div class="spinner"></div>
                </div>
            </div>

            <div class="card" id="availableCard" style="display:none">
                <div class="card-title">系统可用 MJPG 设备</div>
                <div id="availableContent"></div>
            </div>
        `;

        document.getElementById('btnRefresh').addEventListener('click', () => this.refresh());
        document.getElementById('btnRescan').addEventListener('click', () => this.scanAvailable());
        document.getElementById('btnViewAll').addEventListener('click', () => this.toggleAll());

        await this.refresh();
        this.refreshTimer = setInterval(() => this.refresh(true), this.refreshIntervalMs);
    },

    onLeave() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        // 停掉所有正在播放的流(置 src='' 让浏览器断开连接)
        document.querySelectorAll('.camera-preview img[data-camera]').forEach(img => {
            img.src = '';
        });
    },

    toggleAll() {
        const btn = document.getElementById('btnViewAll');
        const previews = document.querySelectorAll('.camera-preview');
        const allActive = Array.from(previews).every(p => p.classList.contains('active'));
        previews.forEach(p => {
            const camName = p.id.replace('preview-', '');
            this.setPreview(camName, !allActive);
        });
        btn.textContent = allActive ? '👁️ 显示全部' : '🙈 隐藏全部';
    },

    setPreview(camName, on) {
        const preview = document.getElementById(`preview-${camName}`);
        const btn = document.querySelector(`.btn-eye[data-camera="${camName}"]`);
        if (!preview) return;
        const img = preview.querySelector('img');
        if (on) {
            preview.classList.add('active');
            btn?.classList.add('active');
            // 加 t 参数防止浏览器缓存,首次开启时才设
            if (!img.src || !img.src.includes('/stream')) {
                img.src = `/api/camera/cameras/${encodeURIComponent(camName)}/stream?t=${Date.now()}`;
            }
        } else {
            preview.classList.remove('active');
            btn?.classList.remove('active');
            img.src = '';  // 主动断开,避免后端流持续占用
        }
    },

    async refresh(silent = false) {
        const content = document.getElementById('camerasContent');
        if (!content) return;

        try {
            const data = await api.listCameras();
            const cameras = data.cameras || [];

            if (cameras.length === 0) {
                content.innerHTML = '<p class="text-center" style="color:var(--text-secondary)">没有已配置的相机</p>';
                return;
            }

            // 检查 DOM 中已有的卡片是否和当前相机集一致;一致则只更新数字字段(避免重建 DOM 中断流)
            const existingCards = content.querySelectorAll('.camera-card');
            const sameSet = existingCards.length === cameras.length &&
                cameras.every((c, i) => existingCards[i].dataset.camera === c.name);

            if (sameSet) {
                cameras.forEach(c => this.updateCardFields(c));
                return;
            }

            // 集合变了 -> 重建 DOM,并恢复之前活跃的预览
            const wasActive = new Set(
                Array.from(content.querySelectorAll('.camera-preview.active'))
                    .map(p => p.id.replace('preview-', ''))
            );
            content.innerHTML = `
                <div class="camera-grid">
                    ${cameras.map(c => this.renderCard(c)).join('')}
                </div>
            `;
            cameras.forEach(c => {
                this.bindControls(c);
                this.bindEye(c.name);
                if (wasActive.has(c.name)) this.setPreview(c.name, true);
            });

        } catch (e) {
            if (!silent) {
                content.innerHTML = `<p style="color:var(--danger-color)">加载失败: ${e.message}</p>`;
            }
        }
    },

    /** 局部更新卡片上的实时数字字段(LIVE 徽章 / 帧龄) */
    updateCardFields(cam) {
        const card = document.querySelector(`.camera-card[data-camera="${cam.name}"]`);
        if (!card) return;
        const badge = card.querySelector('.streaming-badge');
        if (badge) {
            const streaming = cam.streaming === true;
            const ageMs = cam.last_frame_age_ms;
            badge.className = `streaming-badge ${streaming ? 'live' : 'stale'}`;
            badge.textContent = streaming
                ? `LIVE${ageMs !== null ? ` (${ageMs.toFixed(0)}ms)` : ''}`
                : 'STALE';
        }
    },

    bindEye(camName) {
        const btn = document.querySelector(`.btn-eye[data-camera="${camName}"]`);
        if (!btn) return;
        btn.addEventListener('click', () => {
            const preview = document.getElementById(`preview-${camName}`);
            const isActive = preview?.classList.contains('active');
            this.setPreview(camName, !isActive);
        });
    },

    renderCard(cam) {
        const streaming = cam.streaming === true;
        const ageMs = cam.last_frame_age_ms;
        const badgeClass = streaming ? 'live' : 'stale';
        const badgeText = streaming
            ? `LIVE${ageMs !== null ? ` (${ageMs.toFixed(0)}ms)` : ''}`
            : 'STALE';

        const controls = cam.controls || {};
        const controlsHTML = Object.entries(controls).map(([key, val]) => {
            const meta = this.controlMeta(key);
            return `
                <div class="control-row">
                    <span class="control-label">${meta.label}</span>
                    <input type="range" class="control-slider"
                           data-camera="${cam.name}" data-control="${key}"
                           min="${meta.min}" max="${meta.max}" step="${meta.step}"
                           value="${val !== null ? val : meta.min}"
                           ${val === null ? 'disabled' : ''}>
                    <span class="control-value" id="val-${cam.name}-${key}">${val !== null ? val : 'N/A'}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="camera-card" data-camera="${cam.name}">
                <div class="camera-card-header">
                    <div class="camera-card-title">${cam.name}</div>
                    <div style="display:flex; gap:8px; align-items:center">
                        <span class="streaming-badge ${badgeClass}">${badgeText}</span>
                        <button class="btn-eye" data-camera="${cam.name}" title="预览实时画面">👁️</button>
                    </div>
                </div>
                <div class="camera-info-grid">
                    <span class="camera-info-label">设备</span>
                    <span class="camera-info-value">${cam.device || '-'}</span>
                    <span class="camera-info-label">分辨率</span>
                    <span class="camera-info-value">${cam.width || '-'}×${cam.height || '-'}</span>
                    <span class="camera-info-label">帧率</span>
                    <span class="camera-info-value">${cam.fps || '-'} fps</span>
                    <span class="camera-info-label">类型</span>
                    <span class="camera-info-value">${cam.type || '-'}</span>
                </div>
                <div class="camera-preview" id="preview-${cam.name}">
                    <img alt="${cam.name} live" data-camera="${cam.name}">
                </div>
                ${Object.keys(controls).length > 0 ? `
                    <div class="camera-controls">
                        <strong style="font-size:0.85rem;color:var(--text-secondary)">V4L2 控制项 (实时)</strong>
                        ${controlsHTML}
                    </div>
                ` : ''}
            </div>
        `;
    },

    controlMeta(key) {
        // V4L2 控制项的 UI 范围(根据常见值)
        const map = {
            exposure_auto:           { label: '自动曝光', min: 0, max: 3, step: 1 },
            exposure_auto_priority:  { label: '曝光优先', min: 0, max: 1, step: 1 },
            exposure_absolute:       { label: '曝光时长', min: 1, max: 1000, step: 5 },
            gain:                    { label: '增益',     min: 0, max: 100, step: 1 },
            brightness:              { label: '亮度',     min: -64, max: 64, step: 1 },
            contrast:                { label: '对比度',   min: 0, max: 64, step: 1 },
            saturation:              { label: '饱和度',   min: 0, max: 128, step: 1 },
            white_balance_temperature_auto: { label: '自动白平衡', min: 0, max: 1, step: 1 },
            white_balance_temperature: { label: '白平衡', min: 2800, max: 6500, step: 100 },
        };
        return map[key] || { label: key, min: 0, max: 255, step: 1 };
    },

    bindControls(cam) {
        const sliders = document.querySelectorAll(`.control-slider[data-camera="${cam.name}"]`);
        sliders.forEach(slider => {
            // debounce 写入
            let timer = null;
            slider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                document.getElementById(`val-${cam.name}-${e.target.dataset.control}`).textContent = val;

                clearTimeout(timer);
                timer = setTimeout(async () => {
                    try {
                        const ctl = e.target.dataset.control;
                        const result = await api.updateCameraControls(cam.name, { [ctl]: val });
                        const r = result.results[ctl];
                        if (r && !r.ok) {
                            console.warn(`Control ${ctl} failed:`, r.error);
                        }
                    } catch (err) {
                        console.error('Failed to update control:', err);
                    }
                }, 200);
            });
        });
    },

    async scanAvailable() {
        const card = document.getElementById('availableCard');
        const content = document.getElementById('availableContent');
        card.style.display = 'block';
        content.innerHTML = '<div class="spinner"></div>';

        try {
            const data = await api.listAvailableCameras();
            const devices = data.devices || [];
            if (devices.length === 0) {
                content.innerHTML = '<p style="color:var(--text-secondary)">系统未发现 MJPG 设备</p>';
                return;
            }
            content.innerHTML = `
                <table>
                    <thead><tr><th>设备</th><th>名称</th><th>支持格式</th></tr></thead>
                    <tbody>
                        ${devices.map(d => `
                            <tr>
                                <td><code>${d.id}</code></td>
                                <td>${d.name}</td>
                                <td><small>${(d.formats || []).join(', ')}</small></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } catch (e) {
            content.innerHTML = `<p style="color:var(--danger-color)">扫描失败: ${e.message}</p>`;
        }
    },
};
