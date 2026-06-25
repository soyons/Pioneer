// Coach Data 采集页 - 采集员/任务选择、相机实时画面、VR/Web 双控录制、成功/失败标注、episode 列表
const CoachDataPage = {
    statusTimer: null,
    statusIntervalMs: 1000,
    cameras: [],
    recording: false,
    episodeId: null,
    startedAt: null,

    async render(container) {
        container.innerHTML = `
            <div class="card">
                <div class="card-title">
                    <span>🎬 数据采集</span>
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
                    VR 控制：左手 Y 键开始 · 右手 A 键成功结束 · 左手 X 键失败结束。Web 按钮与 VR 等价。
                </p>
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

        document.getElementById('btnCoachRefresh').addEventListener('click', () => this.refreshAll());
        document.getElementById('btnAddCollector').addEventListener('click', () => this.addCollector());
        document.getElementById('btnAddTask').addEventListener('click', () => this.addTask());
        document.getElementById('btnStartRec').addEventListener('click', () => this.startRecording());
        document.getElementById('btnStopSuccess').addEventListener('click', () => this.stopRecording('success'));
        document.getElementById('btnStopFailure').addEventListener('click', () => this.stopRecording('failure'));
        document.getElementById('btnToggleCams').addEventListener('click', () => this.toggleCameras());

        await this.refreshAll();
        this.statusTimer = setInterval(() => this.pollStatus(), this.statusIntervalMs);
    },

    onLeave() {
        if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
        // 停掉所有相机流
        document.querySelectorAll('#coachCameras img[data-camera]').forEach(img => { img.src = ''; });
    },

    async refreshAll() {
        await Promise.all([
            this.loadCollectors(),
            this.loadTasks(),
            this.loadCameras(),
            this.loadEpisodes(),
            this.pollStatus(),
        ]);
    },

    // PLACEHOLDER_METHODS
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
            const existing = content.querySelectorAll('.camera-preview');
            const sameSet = existing.length === this.cameras.length &&
                this.cameras.every((c, i) => existing[i].dataset.camera === c.name);
            if (sameSet) return;
            content.innerHTML = this.cameras.map(c => `
                <div class="camera-card" data-camera="${c.name}">
                    <div class="camera-card-header">
                        <div class="camera-card-title">${c.name}</div>
                        <span class="streaming-badge ${c.streaming ? 'live' : 'stale'}">${c.streaming ? 'LIVE' : 'STALE'}</span>
                    </div>
                    <div class="camera-preview" id="coach-preview-${c.name}" data-camera="${c.name}">
                        <img alt="${c.name}" data-camera="${c.name}">
                    </div>
                </div>
            `).join('');
        } catch (e) {
            content.innerHTML = `<p style="color:var(--danger-color)">相机加载失败: ${e.message}</p>`;
        }
    },

    toggleCameras() {
        const btn = document.getElementById('btnToggleCams');
        const imgs = document.querySelectorAll('#coachCameras img[data-camera]');
        const anyOn = Array.from(imgs).some(img => img.src && img.src.includes('/stream'));
        imgs.forEach(img => {
            const name = img.dataset.camera;
            if (anyOn) {
                img.src = '';
            } else {
                img.src = `/api/camera/cameras/${encodeURIComponent(name)}/stream?t=${Date.now()}`;
            }
        });
        btn.textContent = anyOn ? '▶ 开启画面' : '⏸ 关闭画面';
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

    async pollStatus() {
        try {
            const s = await api.getRecordingStatus();
            this.recording = !!s.recording;
            this.episodeId = s.episode_id || null;
            this.startedAt = s.started_at || null;
            this.renderStatus(s);
        } catch (e) {
            // coach 未启动时静默
        }
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
