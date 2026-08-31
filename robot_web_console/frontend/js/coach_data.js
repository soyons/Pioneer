// Coach Data 采集页 - 采集员/任务选择、相机实时画面、VR/Web 双控录制、成功/失败标注、episode 列表
const CoachDataPage = {
    statusTimer: null,
    statusIntervalMs: 1000,
    vrDataTimer: null,
    vrDataRefreshMs: 100,
    pageGeneration: 0,
    statusInFlightGeneration: null,
    vrDataInFlightGeneration: null,
    hasVRFrame: false,
    lastVRFrameId: null,
    cameras: [],
    recording: false,
    episodeId: null,
    startedAt: null,

    async render(container) {
        this.onLeave();
        const generation = this.pageGeneration;
        this.hasVRFrame = false;
        this.lastVRFrameId = null;

        container.innerHTML = `
            <div class="card">
                <div class="card-title">
                    <span>🎬 Field</span>
                    <button class="btn btn-secondary btn-sm" id="btnCoachRefresh">刷新</button>
                </div>
                <div class="coach-context" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                    <div>
                        <label style="display:block; font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px;">采集员</label>
                        <div style="display:flex; gap:6px;">
                            <select id="collectorSelect" style="flex:1;"></select>
                            <button class="btn btn-secondary btn-sm" id="btnAddCollector">+ 新增</button>
                        </div>
                    </div>
                    <div>
                        <label style="display:block; font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px;">任务</label>
                        <div style="display:flex; gap:6px;">
                            <select id="taskSelect" style="flex:1;"></select>
                            <button class="btn btn-secondary btn-sm" id="btnAddTask">+ 新增</button>
                        </div>
                    </div>
                </div>

                <!-- 录制状态横幅 -->
                <div id="recBanner" class="rec-banner idle">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <span id="recDot" class="rec-dot"></span>
                        <div style="flex:1;">
                            <div id="recText" style="font-weight:600;">空闲 - 未在录制</div>
                            <div id="recDetail" style="font-size:0.85rem; color:var(--text-secondary);"></div>
                        </div>
                        <span id="recTimer" style="font-variant-numeric:tabular-nums; font-size:1.3rem; font-weight:600;">00:00</span>
                    </div>
                </div>

                <!-- 控制按钮 -->
                <div style="display:flex; gap:8px; margin-top:12px;">
                    <button class="btn btn-primary" id="btnStartRec">● 开始采集</button>
                    <button class="btn btn-success" id="btnStopSuccess" disabled>✓ 成功结束</button>
                    <button class="btn btn-danger" id="btnStopFailure" disabled>✗ 失败结束</button>
                </div>
                <p style="color:var(--text-secondary); font-size:0.85rem; margin-top:8px;">
                    VR 控制：左手 Y 键开始 · 右手 A 键成功结束 · 右手 B 键失败结束。Web 按钮与 VR 等价。
                </p>
            </div>

            <div class="card" id="coachVrPanel">
                <div class="card-title coach-vr-title">
                    <span>🎮 Quest 手柄实时数据</span>
                    <span class="coach-vr-rate">10 Hz</span>
                </div>
                <div id="coachVrStreamState" class="coach-vr-stream waiting" role="status" aria-live="polite">
                    <span class="coach-vr-stream-dot"></span>
                    <span id="coachVrStreamText">正在等待 Quest 数据...</span>
                    <span id="coachVrFrameMeta" class="coach-vr-frame-meta"></span>
                </div>
                <div class="coach-vr-grid">
                    ${this.controllerCardMarkup('left', '左手柄', 'X', 'Y')}
                    ${this.controllerCardMarkup('right', '右手柄', 'A', 'B')}
                </div>
            </div>

            <div class="card">
                <div class="card-title">
                    <span>📷 实时画面</span>
                    <button class="btn btn-secondary btn-sm" id="btnToggleCams">▶ 开启画面</button>
                </div>
                <div id="coachCameras" class="camera-grid"><div class="spinner"></div></div>
            </div>

            <div class="card">
                <div class="card-title">📋 最近采集</div>
                <div id="episodeList"><div class="spinner"></div></div>
            </div>
        `;

        document.getElementById('btnCoachRefresh').addEventListener('click', () => this.refreshAll(generation));
        document.getElementById('btnAddCollector').addEventListener('click', () => this.addCollector());
        document.getElementById('btnAddTask').addEventListener('click', () => this.addTask());
        document.getElementById('btnStartRec').addEventListener('click', () => this.startRecording());
        document.getElementById('btnStopSuccess').addEventListener('click', () => this.stopRecording('success'));
        document.getElementById('btnStopFailure').addEventListener('click', () => this.stopRecording('failure'));
        document.getElementById('btnToggleCams').addEventListener('click', () => this.toggleCameras());

        await this.refreshAll(generation);
        if (!this.isCurrent(generation)) return;
        this.scheduleStatusPoll(generation);
        this.scheduleVRDataPoll(generation);
    },

    onLeave() {
        this.pageGeneration += 1;
        if (this.statusTimer) {
            clearTimeout(this.statusTimer);
            this.statusTimer = null;
        }
        if (this.vrDataTimer) {
            clearTimeout(this.vrDataTimer);
            this.vrDataTimer = null;
        }
        // 停掉所有相机流，释放带宽
        const previews = document.querySelectorAll('#coachCameras .camera-preview.active');
        previews.forEach(preview => {
            const camName = preview.dataset.camera;
            if (camName) {
                this.setPreview(camName, false);
            }
        });
    },

    isCurrent(generation) {
        const appActive = !window.app || window.app.currentPage === 'coachdata';
        return this.pageGeneration === generation && appActive && !!document.getElementById('coachVrPanel');
    },

    async refreshAll(generation = this.pageGeneration) {
        await Promise.all([
            this.loadCollectors(),
            this.loadTasks(),
            this.loadCameras(),
            this.loadEpisodes(),
            this.pollStatus(generation),
            this.refreshVRData(generation),
        ]);
    },

    controllerCardMarkup(side, title, faceA, faceB) {
        const id = field => `coach-vr-${side}-${field}`;
        return `
            <section class="coach-vr-controller is-unavailable" id="${id('card')}" aria-labelledby="${id('title')}">
                <div class="coach-vr-controller-header">
                    <h3 id="${id('title')}">${title}</h3>
                    <span class="coach-vr-connection" id="${id('connection')}">等待数据</span>
                </div>

                <div class="coach-vr-section-label">Position</div>
                <div class="coach-vr-values coach-vr-values-position">
                    ${this.vrValueMarkup(side, 'pos-x', 'X')}
                    ${this.vrValueMarkup(side, 'pos-y', 'Y')}
                    ${this.vrValueMarkup(side, 'pos-z', 'Z')}
                </div>

                <div class="coach-vr-section-label">Rotation · Quaternion</div>
                <div class="coach-vr-values coach-vr-values-rotation">
                    ${this.vrValueMarkup(side, 'rot-x', 'x')}
                    ${this.vrValueMarkup(side, 'rot-y', 'y')}
                    ${this.vrValueMarkup(side, 'rot-z', 'z')}
                    ${this.vrValueMarkup(side, 'rot-w', 'w')}
                </div>

                <div class="coach-vr-analog-grid">
                    ${this.vrAnalogMarkup(side, 'trigger', 'Trigger')}
                    ${this.vrAnalogMarkup(side, 'grip', 'Grip')}
                </div>

                <div class="coach-vr-stick-row">
                    <div>
                        <div class="coach-vr-section-label">Joystick</div>
                        <div class="coach-vr-stick-values">
                            <span>X <b id="${id('stick-x')}">—</b></span>
                            <span>Y <b id="${id('stick-y')}">—</b></span>
                        </div>
                    </div>
                    <div class="coach-vr-stick" id="${id('stick')}" role="img" aria-label="Joystick X —, Y —">
                        <span class="coach-vr-stick-axis horizontal"></span>
                        <span class="coach-vr-stick-axis vertical"></span>
                        <span class="coach-vr-stick-dot" id="${id('stick-dot')}"></span>
                    </div>
                </div>

                <div class="coach-vr-section-label">Buttons</div>
                <div class="coach-vr-buttons">
                    ${this.vrButtonMarkup(side, 'btn-a', faceA)}
                    ${this.vrButtonMarkup(side, 'btn-b', faceB)}
                    ${this.vrButtonMarkup(side, 'stick-click', 'Stick')}
                    ${this.vrButtonMarkup(side, 'menu', 'Menu')}
                </div>
            </section>
        `;
    },

    vrValueMarkup(side, field, label) {
        return `<span class="coach-vr-value"><small>${label}</small><b id="coach-vr-${side}-${field}">—</b></span>`;
    },

    vrAnalogMarkup(side, field, label) {
        return `
            <div class="coach-vr-analog">
                <div class="coach-vr-analog-label">
                    <span>${label}</span>
                    <b id="coach-vr-${side}-${field}-value">—</b>
                </div>
                <div class="coach-vr-bar" id="coach-vr-${side}-${field}-bar" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                    <span id="coach-vr-${side}-${field}-fill"></span>
                </div>
            </div>
        `;
    },

    vrButtonMarkup(side, field, label) {
        return `<span class="coach-vr-button" id="coach-vr-${side}-${field}" aria-pressed="false">${label} · 释放</span>`;
    },

    async loadCollectors() {
        try {
            const data = await api.listCollectors();
            const sel = document.getElementById('collectorSelect');
            if (!sel) return;
            const prev = sel.value;
            const items = data.collectors || [];
            sel.innerHTML = items.length
                ? items.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
                : '<option value="">（请先新增采集员）</option>';
            if (prev) sel.value = prev;
        } catch (e) {
            console.error('loadCollectors failed:', e);
        }
    },

    async loadTasks() {
        try {
            const data = await api.listTasks();
            const sel = document.getElementById('taskSelect');
            if (!sel) return;
            const prev = sel.value;
            const items = data.tasks || [];
            sel.innerHTML = items.length
                ? items.map(t => `<option value="${t.id}" title="${t.description || ''}">${t.name}</option>`).join('')
                : '<option value="">（请先新增任务）</option>';
            if (prev) sel.value = prev;
        } catch (e) {
            console.error('loadTasks failed:', e);
        }
    },

    async addCollector() {
        const name = prompt('新增采集员姓名:');
        if (!name || !name.trim()) return;
        try {
            await api.addCollector(name.trim());
            await this.loadCollectors();
            document.getElementById('collectorSelect').value = '';
        } catch (e) {
            alert('新增采集员失败: ' + e.message);
        }
    },

    async addTask() {
        const name = prompt('新增任务名称:');
        if (!name || !name.trim()) return;
        const desc = prompt('任务描述（可选）:') || '';
        try {
            await api.addTask(name.trim(), { description: desc.trim() });
            await this.loadTasks();
        } catch (e) {
            alert('新增任务失败: ' + e.message);
        }
    },

    async loadCameras() {
        const content = document.getElementById('coachCameras');
        if (!content) return;
        try {
            const data = await api.listCameras();
            this.cameras = data.cameras || [];
            if (this.cameras.length === 0) {
                content.innerHTML = '<p class="text-center" style="color:var(--text-secondary)">没有已配置的相机</p>';
                return;
            }
            // 集合一致则不重建（避免中断正在播放的流）
            const existing = content.querySelectorAll('.camera-card');
            const sameSet = existing.length === this.cameras.length &&
                this.cameras.every((c, i) => existing[i]?.dataset.camera === c.name);
            if (sameSet) {
                return;
            }

            // 记住哪些预览是活跃的
            const wasActive = new Set(
                Array.from(content.querySelectorAll('.camera-preview.active'))
                    .map(p => p.dataset.camera)
            );

            content.innerHTML = this.cameras.map(c => `
                <div class="camera-card" data-camera="${c.name}">
                    <div class="camera-card-header">
                        <div class="camera-card-title">${c.name}</div>
                        <span class="streaming-badge ${c.streaming ? 'live' : 'stale'}">${c.streaming ? 'LIVE' : 'STALE'}</span>
                    </div>
                    <div class="camera-preview" id="preview-${c.name}" data-camera="${c.name}">
                        <img alt="${c.name}" data-camera="${c.name}">
                    </div>
                </div>
            `).join('');

            // 恢复之前活跃的预览
            this.cameras.forEach(c => {
                if (wasActive.has(c.name)) {
                    this.setPreview(c.name, true);
                }
            });
        } catch (e) {
            console.error('[Coach] loadCameras failed:', e);
            content.innerHTML = `<p style="color:var(--danger-color)">相机加载失败: ${e.message}</p>`;
        }
    },

    setPreview(camName, on) {
        const preview = document.getElementById(`preview-${camName}`);
        if (!preview) return;
        const img = preview.querySelector('img');
        if (on) {
            preview.classList.add('active');
            // 加 t 参数防止浏览器缓存,首次开启时才设
            if (!img.src || !img.src.includes('/stream')) {
                img.src = `/api/camera/cameras/${encodeURIComponent(camName)}/stream?t=${Date.now()}`;
            }
        } else {
            preview.classList.remove('active');
            img.src = '';  // 主动断开,避免后端流持续占用
        }
    },

    toggleCameras() {
        const btn = document.getElementById('btnToggleCams');
        const previews = document.querySelectorAll('#coachCameras .camera-preview');
        const allActive = Array.from(previews).every(p => p.classList.contains('active'));

        previews.forEach(preview => {
            const camName = preview.dataset.camera;
            if (camName) {
                this.setPreview(camName, !allActive);
            }
        });
        btn.textContent = allActive ? '▶ 开启画面' : '⏸ 关闭画面';
    },

    async loadEpisodes() {
        const content = document.getElementById('episodeList');
        if (!content) return;
        try {
            const data = await api.listEpisodes(30);
            const eps = data.episodes || [];
            if (eps.length === 0) {
                content.innerHTML = '<p style="color:var(--text-secondary)">暂无采集记录</p>';
                return;
            }
            content.innerHTML = `
                <table>
                    <thead><tr><th>结果</th><th>Episode</th><th>采集员</th><th>任务</th><th>时长</th><th>大小</th></tr></thead>
                    <tbody>
                        ${eps.map(e => `
                            <tr>
                                <td>${this.resultBadge(e.result)}</td>
                                <td><code style="font-size:0.8rem;">${e.episode_id || '-'}</code></td>
                                <td>${e.collector_name || e.collector_id || '-'}</td>
                                <td>${e.task_name || e.task_id || '-'}</td>
                                <td>${e.duration_s != null ? e.duration_s.toFixed(1) + 's' : '-'}</td>
                                <td>${this.fmtSize(e.bag_size_bytes)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } catch (e) {
            content.innerHTML = `<p style="color:var(--danger-color)">列表加载失败: ${e.message}</p>`;
        }
    },

    resultBadge(result) {
        const map = {
            success: ['✓ 成功', 'var(--success-color)'],
            failure: ['✗ 失败', 'var(--danger-color)'],
            aborted: ['⊘ 中断', 'var(--warning-color)'],
        };
        const [text, color] = map[result] || ['进行中', 'var(--text-secondary)'];
        return `<span style="color:${color}; font-weight:600;">${text}</span>`;
    },

    fmtSize(bytes) {
        if (bytes == null) return '-';
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB';
        return (bytes / 1024 / 1024 / 1024).toFixed(2) + 'GB';
    },

    async startRecording() {
        const collectorSel = document.getElementById('collectorSelect');
        const taskSel = document.getElementById('taskSelect');
        const collectorId = collectorSel ? collectorSel.value : '';
        const taskId = taskSel ? taskSel.value : '';
        if (!collectorId) { alert('请先选择采集员'); return; }
        if (!taskId) { alert('请先选择任务'); return; }
        try {
            await api.startRecording({ collector_id: collectorId, task_id: taskId });
            await this.pollStatus();
            await this.loadEpisodes();
        } catch (e) {
            alert('开始采集失败: ' + e.message);
        }
    },

    async stopRecording(result) {
        let notes = '';
        if (result === 'failure') {
            notes = prompt('失败原因（可选）:') || '';
        }
        try {
            await api.stopRecording(result, notes);
            await this.pollStatus();
            await this.loadEpisodes();
        } catch (e) {
            alert('结束采集失败: ' + e.message);
        }
    },

    async pollStatus(generation = this.pageGeneration) {
        if (!this.isCurrent(generation) || this.statusInFlightGeneration === generation) return;
        this.statusInFlightGeneration = generation;
        try {
            const s = await api.getRecordingStatus();
            if (!this.isCurrent(generation)) return;
            this.recording = !!s.recording;
            this.episodeId = s.episode_id || null;
            this.startedAt = s.started_at || null;
            this.renderStatus(s);
        } catch (e) {
            // coach 未启动时静默
        } finally {
            if (this.statusInFlightGeneration === generation) {
                this.statusInFlightGeneration = null;
            }
        }
    },

    scheduleStatusPoll(generation) {
        if (!this.isCurrent(generation)) return;
        if (this.statusTimer) clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(async () => {
            this.statusTimer = null;
            await this.pollStatus(generation);
            this.scheduleStatusPoll(generation);
        }, this.statusIntervalMs);
    },

    async refreshVRData(generation = this.pageGeneration) {
        if (!this.isCurrent(generation) || this.vrDataInFlightGeneration === generation) return;
        this.vrDataInFlightGeneration = generation;
        try {
            const res = await api.getTeleopVRData();
            if (!this.isCurrent(generation)) return;
            if (!res.connected || !res.data) {
                this.renderVRUnavailable();
                return;
            }
            this.hasVRFrame = true;
            const frameId = Number(res.data.quest_t);
            this.lastVRFrameId = Number.isFinite(frameId) ? frameId : null;
            this.renderVRStreamState('live', 'Quest 数据接收正常', res.data);
            this.renderVRController('left', res.data.left);
            this.renderVRController('right', res.data.right);
        } catch (e) {
            if (!this.isCurrent(generation)) return;
            const message = this.hasVRFrame
                ? '实时数据请求失败，保留最后一帧'
                : '无法获取 Quest 数据';
            this.renderVRStreamState('error', message, this.hasVRFrame ? { quest_t: this.lastVRFrameId } : null);
            if (!this.hasVRFrame) {
                this.renderVRController('left', null);
                this.renderVRController('right', null);
            }
        } finally {
            if (this.vrDataInFlightGeneration === generation) {
                this.vrDataInFlightGeneration = null;
            }
        }
    },

    scheduleVRDataPoll(generation) {
        if (!this.isCurrent(generation)) return;
        if (this.vrDataTimer) clearTimeout(this.vrDataTimer);
        this.vrDataTimer = setTimeout(async () => {
            this.vrDataTimer = null;
            await this.refreshVRData(generation);
            this.scheduleVRDataPoll(generation);
        }, this.vrDataRefreshMs);
    },

    renderVRUnavailable() {
        this.hasVRFrame = false;
        this.lastVRFrameId = null;
        this.renderVRStreamState('waiting', '正在等待 Quest 数据...');
        this.renderVRController('left', null);
        this.renderVRController('right', null);
    },

    renderVRStreamState(state, message, frame = null) {
        const container = document.getElementById('coachVrStreamState');
        const text = document.getElementById('coachVrStreamText');
        const meta = document.getElementById('coachVrFrameMeta');
        if (!container || !text || !meta) return;
        container.className = `coach-vr-stream ${state}`;
        text.textContent = message;
        meta.textContent = frame && Number.isFinite(Number(frame.quest_t))
            ? `Frame ${Math.trunc(Number(frame.quest_t))}`
            : '';
    },

    renderVRController(side, data) {
        const card = document.getElementById(`coach-vr-${side}-card`);
        const connection = document.getElementById(`coach-vr-${side}-connection`);
        if (!card || !connection) return;

        const available = !!data;
        const connected = available && data.connected !== false;
        card.classList.toggle('is-unavailable', !available);
        card.classList.toggle('is-disconnected', available && !connected);
        card.classList.toggle('is-connected', connected);
        connection.textContent = available ? (connected ? '● 已连接' : '○ 未连接') : '等待数据';

        const pos = Array.isArray(data?.pos) ? data.pos : [];
        const rot = Array.isArray(data?.rot) ? data.rot : [];
        this.setVRText(side, 'pos-x', this.formatVRNumber(pos[0], 3));
        this.setVRText(side, 'pos-y', this.formatVRNumber(pos[1], 3));
        this.setVRText(side, 'pos-z', this.formatVRNumber(pos[2], 3));
        this.setVRText(side, 'rot-x', this.formatVRNumber(rot[0], 3));
        this.setVRText(side, 'rot-y', this.formatVRNumber(rot[1], 3));
        this.setVRText(side, 'rot-z', this.formatVRNumber(rot[2], 3));
        this.setVRText(side, 'rot-w', this.formatVRNumber(rot[3], 3));

        this.renderVRAnalog(side, 'trigger', available ? data.trigger : null);
        this.renderVRAnalog(side, 'grip', available ? data.grip : null);
        this.renderVRStick(side, available ? data.stick_x : null, available ? data.stick_y : null);
        this.renderVRButton(side, 'btn-a', side === 'left' ? 'X' : 'A', available ? data.btn_a === true : null);
        this.renderVRButton(side, 'btn-b', side === 'left' ? 'Y' : 'B', available ? data.btn_b === true : null);
        this.renderVRButton(side, 'stick-click', 'Stick', available ? data.stick_click === true : null);
        this.renderVRButton(side, 'menu', 'Menu', available ? data.menu === true : null);
    },

    setVRText(side, field, value) {
        const el = document.getElementById(`coach-vr-${side}-${field}`);
        if (el) el.textContent = value;
    },

    formatVRNumber(value, digits = 3) {
        const n = Number(value);
        return Number.isFinite(n) ? n.toFixed(digits) : '—';
    },

    clampVRValue(value, min, max) {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return Math.min(max, Math.max(min, n));
    },

    renderVRAnalog(side, field, value) {
        const n = this.clampVRValue(value, 0, 1);
        const valueEl = document.getElementById(`coach-vr-${side}-${field}-value`);
        const bar = document.getElementById(`coach-vr-${side}-${field}-bar`);
        const fill = document.getElementById(`coach-vr-${side}-${field}-fill`);
        const pct = n == null ? 0 : Math.round(n * 100);
        if (valueEl) valueEl.textContent = n == null ? '—' : `${n.toFixed(2)} · ${pct}%`;
        if (fill) fill.style.width = `${pct}%`;
        if (bar) bar.setAttribute('aria-valuenow', String(pct));
    },

    renderVRStick(side, xValue, yValue) {
        const x = this.clampVRValue(xValue, -1, 1);
        const y = this.clampVRValue(yValue, -1, 1);
        this.setVRText(side, 'stick-x', x == null ? '—' : x.toFixed(2));
        this.setVRText(side, 'stick-y', y == null ? '—' : y.toFixed(2));

        const stick = document.getElementById(`coach-vr-${side}-stick`);
        const dot = document.getElementById(`coach-vr-${side}-stick-dot`);
        if (dot) {
            const px = x == null ? 50 : 50 + x * 36;
            const py = y == null ? 50 : 50 - y * 36;
            dot.style.left = `${px}%`;
            dot.style.top = `${py}%`;
        }
        if (stick) {
            const xText = x == null ? '—' : x.toFixed(2);
            const yText = y == null ? '—' : y.toFixed(2);
            stick.setAttribute('aria-label', `Joystick X ${xText}, Y ${yText}`);
        }
    },

    renderVRButton(side, field, label, pressed) {
        const el = document.getElementById(`coach-vr-${side}-${field}`);
        if (!el) return;
        const isPressed = pressed === true;
        el.classList.toggle('is-pressed', isPressed);
        el.classList.toggle('is-unavailable', pressed == null);
        el.setAttribute('aria-pressed', pressed == null ? 'false' : String(isPressed));
        el.textContent = pressed == null
            ? `${label} · —`
            : `${label} · ${isPressed ? '按下' : '释放'}`;
    },

    renderStatus(s) {
        const banner = document.getElementById('recBanner');
        const dot = document.getElementById('recDot');
        const text = document.getElementById('recText');
        const detail = document.getElementById('recDetail');
        const timer = document.getElementById('recTimer');
        const btnStart = document.getElementById('btnStartRec');
        const btnOk = document.getElementById('btnStopSuccess');
        const btnFail = document.getElementById('btnStopFailure');
        if (!banner) return;

        if (this.recording) {
            banner.className = 'rec-banner recording';
            text.textContent = '● 采集中';
            const bag = s.bag || {};
            const coll = s.collector ? (s.collector.name || s.collector.id) : '-';
            const task = s.task ? (s.task.name || s.task.id) : '-';
            detail.textContent = `${this.episodeId || ''} · ${coll} / ${task} · ${this.fmtSize(bag.bag_size_bytes)}`;
            timer.textContent = this.fmtElapsed(bag.elapsed_s);
            btnStart.disabled = true;
            btnOk.disabled = false;
            btnFail.disabled = false;
        } else {
            banner.className = 'rec-banner idle';
            text.textContent = '空闲 - 未在录制';
            detail.textContent = '';
            timer.textContent = '00:00';
            btnStart.disabled = false;
            btnOk.disabled = true;
            btnFail.disabled = true;
        }
    },

    fmtElapsed(sec) {
        if (sec == null) return '00:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },
};
