// Main Application Logic
class RobotApp {
    constructor() {
        this.currentPage = 'status';
        this.isConnected = false;
        this.stateUpdateInterval = null;
        this.systemUpdateInterval = null;
        this.jogViewer = null;
        this.jogStateInterval = null;
        this.jogRefreshInFlight = false;
        this.jogPageGeneration = 0;
        this.jogControlsConnected = false;
        this.jogCommandInFlight = false;
        this.jogLastStatus = null;
        this.directionCalibration = null;
        this.directionCalibrationInFlight = false;

        this.init();
    }

    init() {
        // Initialize navigation
        this.setupNavigation();

        // Setup emergency stop
        this.setupEmergencyStop();

        // Start connection check
        this.startConnectionMonitor();

        // Load initial page
        this.loadPage('status');

        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    setupNavigation() {
        const tabs = document.querySelectorAll('.nav-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                if (tab.disabled) return;
                const page = tab.dataset.page;
                this.loadPage(page);

                // Update active state
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // 清除三灯的 selected 状态(因为切到了导航栏页面)
                document.querySelectorAll('.service-light').forEach(l => l.classList.remove('selected'));
            });
        });
    }

    setupEmergencyStop() {
        const btn = document.getElementById('emergencyStop');
        btn.addEventListener('click', async () => {
            if (confirm('确定要急停吗？这将立即停止所有运动。')) {
                try {
                    await api.emergencyStop();
                    this.showNotification('急停已触发', 'danger');
                } catch (error) {
                    this.showNotification(`急停失败: ${error.message}`, 'danger');
                }
            }
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+E: Emergency Stop
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                document.getElementById('emergencyStop').click();
            }
        });
    }

    async startConnectionMonitor() {
        const updateConnectionStatus = async () => {
            try {
                const health = await api.getHealth();
                this.setConnectionStatus(true);
            } catch (error) {
                this.setConnectionStatus(false);
            }
        };

        // Check immediately
        await updateConnectionStatus();

        // Check every 5 seconds
        setInterval(updateConnectionStatus, 5000);
    }

    setConnectionStatus(connected) {
        // 三灯状态栏由 services_monitor.js 接管,这里只更新内部状态标记
        this.isConnected = connected;
    }

    async loadPage(pageName) {
        // 离开旧页面 - 调用清理钩子(如果存在)
        if (this.currentPage === 'cameras' && typeof CamerasPage !== 'undefined') CamerasPage.onLeave?.();
        if (this.currentPage === 'teleop' && typeof TeleopPage !== 'undefined') TeleopPage.onLeave?.();
        if (this.currentPage === 'coachdata' && typeof CoachDataPage !== 'undefined') CoachDataPage.onLeave?.();
        if (this.currentPage === 'depot' && typeof DepotPage !== 'undefined') DepotPage.onLeave?.();
        if (this.currentPage === 'jog' && pageName !== 'jog') this.disposeJogPage();

        // 离开 Status 页时清掉刷新定时器,避免后台空跑
        if (this.currentPage === 'status' && pageName !== 'status') {
            if (this.stateUpdateInterval) { clearInterval(this.stateUpdateInterval); this.stateUpdateInterval = null; }
            if (this.systemUpdateInterval) { clearInterval(this.systemUpdateInterval); this.systemUpdateInterval = null; }
        }

        this.currentPage = pageName;
        const content = document.getElementById('mainContent');

        // Show loading
        content.innerHTML = '<div class="spinner"></div>';

        try {
            // Load page content
            switch (pageName) {
                case 'status':
                    await this.loadStatusPage(content);
                    break;
                case 'jog':
                    await this.loadJogPage(content);
                    break;
                case 'presets':
                    await this.loadPresetsPage(content);
                    break;
                case 'calibration':
                    await this.loadCalibrationPage(content);
                    break;
                case 'diagnostics':
                    await this.loadDiagnosticsPage(content);
                    break;
                case 'config':
                    await this.loadConfigPage(content);
                    break;
                case 'cameras':
                    await CamerasPage.render(content);
                    break;
                case 'teleop':
                    await TeleopPage.render(content);
                    break;
                case 'coachdata':
                    await CoachDataPage.render(content);
                    break;
                case 'depot':
                    await DepotPage.render(content);
                    break;
                default:
                    content.innerHTML = '<p>Page not found</p>';
            }
        } catch (error) {
            content.innerHTML = `<div class="card"><p>加载失败: ${error.message}</p></div>`;
        }
    }

    // Status Page
    async loadStatusPage(container) {
        container.innerHTML = `
            <div class="card">
                <div class="card-title">📊 Robot Status</div>
                <div id="statusOneLine" class="status-oneline">Loading...</div>
            </div>
            <div class="card mt-4">
                <div class="card-title">
                    💻 System Resources
                    <span id="systemUpdatedAt" class="status-meta" style="float:right;font-weight:normal;">-</span>
                </div>
                <div id="systemInfo" class="system-info">Loading...</div>
            </div>
        `;
        this.startStatusUpdates();
        this.startSystemUpdates();
    }

    async startSystemUpdates() {
        if (this.systemUpdateInterval) clearInterval(this.systemUpdateInterval);
        const update = async () => {
            try {
                const info = await api.getSystemInfo(5);
                this.updateSystemDisplay(info);
            } catch (error) {
                console.error('Failed to update system info:', error);
                const el = document.getElementById('systemInfo');
                if (el) el.innerHTML = `<p class="text-danger">系统信息获取失败: ${error.message}</p>`;
            }
        };
        await update();
        // 系统资源 2 秒刷新一次,与机器人状态(1Hz)解耦
        this.systemUpdateInterval = setInterval(update, 2000);
    }

    updateSystemDisplay(info) {
        const el = document.getElementById('systemInfo');
        if (!el || !info || info.error) {
            if (el && info?.error) el.innerHTML = `<p class="text-danger">${info.error}</p>`;
            return;
        }

        const cpu = info.cpu || {};
        const mem = info.memory || {};
        const disk = info.disk || {};
        const top = info.top_processes || [];

        const fmtUptime = (s) => {
            const d = Math.floor(s / 86400);
            const h = Math.floor((s % 86400) / 3600);
            const m = Math.floor((s % 3600) / 60);
            return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
        };

        const barColor = (pct) => pct >= 85 ? 'danger' : (pct >= 70 ? 'warning' : 'success');
        const bar = (pct) => `
            <div class="resource-bar">
                <div class="resource-bar-fill ${barColor(pct)}" style="width:${Math.min(100, pct)}%"></div>
            </div>
        `;

        const load = cpu.load_avg || [0, 0, 0];
        const perCore = (cpu.per_core || []).map((p, i) =>
            `<span class="core-chip" title="Core ${i}"><b>C${i}</b> ${p.toFixed(0)}%</span>`
        ).join('');

        const procRows = top.map(p => `
            <tr>
                <td class="mono">${p.pid}</td>
                <td class="mono" style="max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}</td>
                <td class="mono num">${p.cpu_percent.toFixed(1)}%</td>
                <td class="mono num">${p.memory_percent.toFixed(1)}%</td>
            </tr>
        `).join('');

        el.innerHTML = `
            <div class="resource-grid">
                <div class="resource-item">
                    <div class="resource-label">
                        <span>CPU <small>(${cpu.cores} cores)</small></span>
                        <span><b>${cpu.percent.toFixed(1)}%</b></span>
                    </div>
                    ${bar(cpu.percent)}
                    <div class="resource-meta">
                        Load: <b>${load[0].toFixed(2)}</b> / ${load[1].toFixed(2)} / ${load[2].toFixed(2)}
                    </div>
                    <div class="core-chips">${perCore}</div>
                </div>

                <div class="resource-item">
                    <div class="resource-label">
                        <span>Memory</span>
                        <span><b>${mem.used_gib} / ${mem.total_gib} GiB</b> (${mem.percent}%)</span>
                    </div>
                    ${bar(mem.percent)}
                    <div class="resource-meta">
                        Available: <b>${mem.available_gib} GiB</b>
                        ${mem.swap_total_gib > 0 ? `· Swap: ${mem.swap_used_gib} / ${mem.swap_total_gib} GiB (${mem.swap_percent}%)` : ''}
                    </div>
                </div>

                <div class="resource-item">
                    <div class="resource-label">
                        <span>Disk (/)</span>
                        <span><b>${disk.used_gib} / ${disk.total_gib} GiB</b> (${disk.percent}%)</span>
                    </div>
                    ${bar(disk.percent)}
                    <div class="resource-meta">Free: <b>${disk.free_gib} GiB</b> · Uptime: ${fmtUptime(info.uptime_seconds)}</div>
                </div>
            </div>

            <div class="top-processes">
                <div class="resource-meta" style="margin-bottom:4px;"><b>Top processes (by CPU)</b></div>
                <table class="proc-table">
                    <thead>
                        <tr><th>PID</th><th>Command</th><th class="num">CPU</th><th class="num">Mem</th></tr>
                    </thead>
                    <tbody>${procRows || '<tr><td colspan="4">-</td></tr>'}</tbody>
                </table>
            </div>
        `;

        const tsEl = document.getElementById('systemUpdatedAt');
        if (tsEl) tsEl.textContent = 'Updated: ' + new Date(info.timestamp * 1000).toLocaleTimeString();
    }

    async startStatusUpdates() {
        if (this.stateUpdateInterval) clearInterval(this.stateUpdateInterval);
        const updateStatus = async () => {
            try {
                const status = await api.getStatus();
                this.updateStatusDisplay(status);
            } catch (error) {
                console.error('Failed to update status:', error);
            }
        };
        await updateStatus();
        this.stateUpdateInterval = setInterval(updateStatus, 1000);
    }

    updateStatusDisplay(status) {
        const el = document.getElementById('statusOneLine');
        if (!el) return;

        const connected = Object.values(status.connected || {}).some(v => v);
        const mode = status.mode || 'unknown';
        const errors = status.errors || 0;
        const ts = status.timestamp ? new Date(status.timestamp * 1000).toLocaleTimeString() : '-';

        // 关节角(取第一个臂)
        let jointsHtml = '';
        const jointEntries = Object.entries(status.joints || {});
        if (jointEntries.length > 0) {
            const [arm, positions] = jointEntries[0];
            jointsHtml = positions
                .map((p, i) => `<span class="joint-chip">J${i + 1} <b>${(p * 180 / Math.PI).toFixed(1)}°</b></span>`)
                .join('');
        }

        // 末端位姿
        let eeHtml = '';
        const eeEntries = Object.entries(status.end_effector || {});
        if (eeEntries.length > 0) {
            const [arm, pose] = eeEntries[0];
            const pos = pose.position || [0, 0, 0];
            const rot = pose.rotation || [0, 0, 0];
            eeHtml = `
                <span class="ee-chip">XYZ <b>${pos.map(v => (v ?? 0).toFixed(3)).join(', ')}</b></span>
                <span class="ee-chip">RPY <b>${rot.map(v => ((v ?? 0) * 180 / Math.PI).toFixed(1)).join(', ')}°</b></span>
            `;
        }

        // 夹爪
        let gripHtml = '';
        const gripEntries = Object.entries(status.gripper || {});
        if (gripEntries.length > 0) {
            const [arm, g] = gripEntries[0];
            gripHtml = `<span class="ee-chip">Grip <b>${(g ?? 0).toFixed(1)}%</b></span>`;
        }

        el.innerHTML = `
            <div class="status-row">
                <span class="status-badge ${connected ? 'success' : 'danger'}">
                    ${connected ? '● Connected' : '○ Disconnected'}
                </span>
                <span class="status-meta">Mode: <b>${mode}</b></span>
                <span class="status-meta">Errors: <b>${errors}</b></span>
                <span class="status-meta">Updated: ${ts}</span>
            </div>
            <div class="status-row">${jointsHtml}</div>
            <div class="status-row">${eeHtml}${gripHtml}</div>
        `;
    }

    // Jog Control Page
    async loadJogPage(container) {
        this.disposeJogPage();
        const generation = this.jogPageGeneration;

        container.innerHTML = `
            <div class="jog-layout">
                <div class="jog-controls-column">
                    <div class="card mt-4">
                        <div class="card-title">🕹️ Joint Jog Control</div>
                        <div class="jog-joint-selection">
                            <div class="form-group">
                                <label class="form-label">Arm:</label>
                                <select id="jogArm" class="form-select">
                                    <option value="right">Right Arm</option>
                                    <option value="left">Left Arm</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Joint:</label>
                                <select id="jogJoint" class="form-select">
                                    <option value="0">Joint 0</option>
                                    <option value="1">Joint 1</option>
                                    <option value="2">Joint 2</option>
                                    <option value="3">Joint 3</option>
                                    <option value="4">Joint 4</option>
                                    <option value="5">Joint 5</option>
                                    <option value="6">Joint 6</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Delta (degrees):</label>
                            <div class="flex gap-2 jog-button-row">
                                <button class="btn btn-primary jog-motion-control" onclick="app.jogJoint(-10)">-10°</button>
                                <button class="btn btn-primary jog-motion-control" onclick="app.jogJoint(-5)">-5°</button>
                                <button class="btn btn-primary jog-motion-control" onclick="app.jogJoint(-1)">-1°</button>
                                <button class="btn btn-primary jog-motion-control" onclick="app.jogJoint(1)">+1°</button>
                                <button class="btn btn-primary jog-motion-control" onclick="app.jogJoint(5)">+5°</button>
                                <button class="btn btn-primary jog-motion-control" onclick="app.jogJoint(10)">+10°</button>
                            </div>
                        </div>
                        <div class="form-group jog-button-row">
                            <button class="btn btn-warning jog-motion-control" onclick="app.zeroJoint()">Zero Joint</button>
                            <button class="btn btn-warning jog-motion-control" onclick="app.zeroAllJoints()">Zero All Joints</button>
                        </div>
                    </div>

                    <div class="card mt-4 direction-calibration-card">
                        <div class="card-title">🧭 Joint Direction Calibration</div>
                        <p class="text-muted">Opening this panel never moves hardware. Select a joint, acknowledge the workspace, and explicitly test only +1°.</p>
                        <div id="directionCalibrationStatus">Loading...</div>
                        <label class="direction-ack"><input id="directionSafetyAck" type="checkbox"> I confirm the workspace is safe for a one-joint +1° test</label>
                        <div class="button-group jog-button-row">
                            <button id="directionProbeButton" class="btn btn-warning" disabled>Test +1°</button>
                            <button id="directionZeroButton" class="btn btn-secondary" disabled>Restore selected joint to zero</button>
                            <button id="directionMatchButton" class="btn btn-success" disabled>Matches viewer</button>
                            <button id="directionOppositeButton" class="btn btn-danger" disabled>Opposite viewer</button>
                        </div>
                    </div>
                    <div class="card mt-4">
                        <div class="card-title">📐 Cartesian XYZ Jog (base_link)</div>
                        <p class="text-muted">固定基座坐标：+X 前方、+Y 左侧、+Z 上方。每次移动严格保持当前末端姿态。</p>
                        ${['x', 'y', 'z'].map(axis => `
                            <div class="form-group">
                                <label class="form-label"><strong>${axis.toUpperCase()} Axis</strong></label>
                                <div class="button-group jog-button-row">
                                    ${[-10, -5, -1, 1, 5, 10].map(delta => `
                                        <button class="btn btn-primary cartesian-jog-btn jog-motion-control"
                                                onclick="app.jogCartesian('${axis}', ${delta})">
                                            ${delta > 0 ? '+' : ''}${delta} mm
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                        <p class="text-muted">L 形零位附近 Y 方向可能处于运动学奇异位；后端会拒绝不可达或需要大关节跳变的请求。</p>
                    </div>

                    <div class="card mt-4">
                        <div class="card-title">✋ Gripper Control</div>
                        <div class="form-group">
                            <label class="form-label">Position (0 = closed, 1 = open):</label>
                            <input type="range" id="gripperSlider" class="form-input jog-motion-control" min="0" max="1" step="0.01" value="0">
                            <p id="gripperValue">0.00</p>
                        </div>
                        <button id="setGripperButton" class="btn btn-success jog-motion-control" onclick="app.setGripper()">Set Gripper</button>
                    </div>
                </div>

                <aside class="jog-viewer-column">
                    <div class="card jog-status-card">
                        <div class="card-title">
                            📊 Robot Status
                            <span id="jogStatusArmLabel" class="status-meta jog-status-arm">-</span>
                        </div>
                        <div id="jogStatusDisplay" class="status-oneline jog-status-display">
                            <div class="status-row">
                                <span class="status-badge warning">Loading...</span>
                            </div>
                        </div>
                    </div>

                    <div class="card jog-urdf-card">
                        <div class="card-title">🦾 Live URDF Robot View</div>
                        <div id="jogUrdfViewer"></div>
                    </div>
                </aside>
            </div>
        `;

        const slider = document.getElementById('gripperSlider');
        const valueDisplay = document.getElementById('gripperValue');
        const armSelect = document.getElementById('jogArm');
        armSelect.addEventListener('change', () => {
            if (this.jogLastStatus) this.updateJogStatusDisplay(this.jogLastStatus);
        });
        slider.addEventListener('input', (event) => {
            valueDisplay.textContent = parseFloat(event.target.value).toFixed(2);
        });

        const directionAck = document.getElementById('directionSafetyAck');
        const directionProbe = document.getElementById('directionProbeButton');
        const directionZero = document.getElementById('directionZeroButton');
        const directionMatch = document.getElementById('directionMatchButton');
        const directionOpposite = document.getElementById('directionOppositeButton');
        directionAck.addEventListener('change', () => this.updateDirectionCalibrationControls());
        document.getElementById('jogJoint').addEventListener('change', () => {
            directionAck.checked = false;
            this.updateDirectionCalibrationControls();
            this.renderDirectionCalibrationStatus();
        });
        directionProbe.addEventListener('click', () => this.probeJointDirection());
        directionZero.addEventListener('click', () => this.zeroDirectionJoint());
        directionMatch.addEventListener('click', () => this.recordJointDirection(true));
        directionOpposite.addEventListener('click', () => this.recordJointDirection(false));

        const viewerHost = document.getElementById('jogUrdfViewer');
        try {
            this.jogViewer = new UrdfViewer(viewerHost);
            await this.jogViewer.init();
        } catch (error) {
            if (this.jogViewer) this.jogViewer.destroy();
            this.jogViewer = null;
            viewerHost.innerHTML = `<div class="urdf-error">3D 模型加载失败: ${error.message}</div>`;
        }

        await Promise.all([
            this.refreshJogStatus(generation),
            this.refreshDirectionCalibrationStatus(),
        ]);
        if (this.currentPage === 'jog' && generation === this.jogPageGeneration) {
            this.jogStateInterval = setInterval(() => this.refreshJogStatus(generation), 200);
        }
    }

    updateJogStatusDisplay(status, readFailed = false) {
        const el = document.getElementById('jogStatusDisplay');
        if (!el) return;

        const selected = document.getElementById('jogArm')?.value || 'right';
        const selectedCandidates = selected.endsWith('_arm')
            ? [selected, selected.slice(0, -4)]
            : [selected, `${selected}_arm`];
        const jointsByArm = status?.joints || {};
        const validJointEntries = Object.entries(jointsByArm).filter(([, positions]) =>
            Array.isArray(positions) && positions.length > 0 && positions.every(Number.isFinite)
        );
        const selectedArm = selectedCandidates.find(arm =>
            validJointEntries.some(([candidate]) => candidate === arm)
        );
        const fallbackArm = validJointEntries[0]?.[0]
            || selectedCandidates.find(arm =>
                Object.prototype.hasOwnProperty.call(status?.connected || {}, arm)
                || Object.prototype.hasOwnProperty.call(status?.end_effector || {}, arm)
                || Object.prototype.hasOwnProperty.call(status?.gripper || {}, arm)
            )
            || selectedCandidates[0];
        const arm = selectedArm || fallbackArm;

        const connectedMap = status?.connected;
        const connected = connectedMap && typeof connectedMap === 'object'
            ? Boolean(connectedMap[arm])
            : Boolean(connectedMap);
        const mode = status?.mode || 'unknown';
        const errors = Number.isFinite(status?.errors) ? status.errors : 0;
        const timestamp = Number(status?.timestamp);
        const ts = Number.isFinite(timestamp) && timestamp > 0
            ? new Date(timestamp * 1000).toLocaleTimeString()
            : '-';
        const unavailable = readFailed || Boolean(status?.error);

        const positions = Array.isArray(jointsByArm[arm]) ? jointsByArm[arm] : [];
        const jointsHtml = Array.from({ length: 7 }, (_, index) => {
            const value = positions[index];
            const text = Number.isFinite(value)
                ? `${(value * 180 / Math.PI).toFixed(1)}°`
                : '-';
            return `<span class="joint-chip">J${index + 1} <b>${text}</b></span>`;
        }).join('');

        const pose = status?.end_effector?.[arm] || {};
        const formatVector = (values, digits, scale = 1) => Array.from({ length: 3 }, (_, index) => {
            const value = values?.[index];
            return Number.isFinite(value) ? (value * scale).toFixed(digits) : '-';
        }).join(', ');
        const xyz = formatVector(pose.position, 3);
        const rpy = formatVector(pose.rotation, 1, 180 / Math.PI);
        const grip = status?.gripper?.[arm];
        const gripText = Number.isFinite(grip) ? `${grip.toFixed(1)}%` : '-';

        const armLabel = document.getElementById('jogStatusArmLabel');
        if (armLabel) {
            armLabel.textContent = arm === 'right_arm' || arm === 'right'
                ? 'Right Arm'
                : (arm === 'left_arm' || arm === 'left' ? 'Left Arm' : arm);
        }

        el.innerHTML = `
            <div class="status-row">
                <span class="status-badge ${connected && !unavailable ? 'success' : 'danger'}">
                    ${connected && !unavailable ? '● Connected' : '○ Disconnected'}
                </span>
                <span class="status-meta">Mode: <b>${mode}</b></span>
                <span class="status-meta">Errors: <b>${errors}</b></span>
                <span class="status-meta">Updated: ${ts}</span>
                ${unavailable ? '<span class="status-meta text-danger">Status unavailable</span>' : ''}
            </div>
            <div class="status-row jog-status-joints">${jointsHtml}</div>
            <div class="status-row jog-status-pose">
                <span class="ee-chip">XYZ <b>${xyz}</b></span>
                <span class="ee-chip">RPY <b>${rpy}°</b></span>
                <span class="ee-chip">Grip <b>${gripText}</b></span>
            </div>
        `;
    }

    async refreshJogStatus(generation = this.jogPageGeneration) {
        if (this.currentPage !== 'jog' || generation !== this.jogPageGeneration || this.jogRefreshInFlight) {
            return false;
        }
        this.jogRefreshInFlight = true;
        try {
            const status = await api.getStatus();
            if (this.currentPage !== 'jog' || generation !== this.jogPageGeneration) return false;

            this.jogLastStatus = status;
            this.updateJogStatusDisplay(status);
            if (this.jogViewer) this.jogViewer.updateState(status);
            const validArms = Object.entries(status.joints || {}).filter(([, positions]) =>
                Array.isArray(positions) && positions.length > 0 && positions.every(Number.isFinite)
            );
            const connected = validArms.some(([arm]) => Boolean(status.connected?.[arm]));
            this.setJogControlsEnabled(connected);
            return connected;
        } catch (error) {
            if (this.currentPage === 'jog' && generation === this.jogPageGeneration) {
                const unavailableStatus = {
                    mode: 'unknown',
                    errors: 0,
                    connected: {},
                    joints: {},
                    end_effector: {},
                    gripper: {},
                    error: error.message,
                };
                this.jogLastStatus = unavailableStatus;
                this.updateJogStatusDisplay(unavailableStatus, true);
                this.setJogControlsEnabled(false);
                this.jogViewer?.setStatus(`模型已加载 · 状态读取失败: ${error.message}`, 'error');
            }
            return false;
        } finally {
            this.jogRefreshInFlight = false;
        }
    }

    setJogControlsEnabled(connected) {
        this.jogControlsConnected = connected;
        const enabled = connected && !this.jogCommandInFlight;
        document.querySelectorAll('.jog-motion-control').forEach(control => {
            control.disabled = !enabled;
        });
        this.updateDirectionCalibrationControls();
    }

    setJogCommandInFlight(inFlight) {
        this.jogCommandInFlight = inFlight;
        this.setJogControlsEnabled(this.jogControlsConnected);
        this.updateDirectionCalibrationControls();
    }

    async refreshDirectionCalibrationStatus() {
        const statusEl = document.getElementById('directionCalibrationStatus');
        if (!statusEl) return false;

        try {
            this.directionCalibration = await api.getDirectionCalibrationStatus();
            this.renderDirectionCalibrationStatus();
            this.updateDirectionCalibrationControls();
            return Boolean(this.directionCalibration?.all_verified);
        } catch (error) {
            this.directionCalibration = null;
            statusEl.innerHTML = '';
            const message = document.createElement('p');
            message.className = 'text-danger';
            message.textContent = `Direction calibration unavailable: ${error.message}`;
            statusEl.appendChild(message);
            this.updateDirectionCalibrationControls();
            return false;
        }
    }

    renderDirectionCalibrationStatus() {
        const statusEl = document.getElementById('directionCalibrationStatus');
        if (!statusEl) return;

        const status = this.directionCalibration;
        if (!status) {
            statusEl.textContent = 'Direction calibration status unavailable.';
            return;
        }

        const selectedJointId = parseInt(document.getElementById('jogJoint')?.value || '0', 10);
        const selected = status.joints?.find(joint => joint.joint_id === selectedJointId);
        const summary = document.createElement('div');
        summary.className = 'direction-calibration-summary';

        const overall = document.createElement('span');
        overall.className = `status-badge ${status.all_verified ? 'success' : 'warning'}`;
        overall.textContent = status.all_verified
            ? 'All joint directions verified · Cartesian jog enabled'
            : 'Direction verification incomplete · Cartesian jog locked';
        summary.appendChild(overall);

        const model = document.createElement('span');
        model.className = 'status-meta';
        model.textContent = `${status.urdf_file || 'URDF'} · TCP ${status.end_effector_frame || '-'}`;
        summary.appendChild(model);
        statusEl.replaceChildren(summary);

        if (selected) {
            const details = document.createElement('div');
            details.className = 'direction-joint-details';

            const verification = document.createElement('span');
            verification.className = `status-badge ${selected.verified ? 'success' : 'warning'}`;
            verification.textContent = selected.verified ? 'Verified' : 'Not verified';
            details.appendChild(verification);

            const mapping = document.createElement('span');
            mapping.textContent = `${selected.motor_name} → ${selected.kinematic_name}`;
            details.appendChild(mapping);

            const axis = document.createElement('span');
            axis.textContent = `URDF axis [${(selected.axis || []).join(', ')}]`;
            details.appendChild(axis);

            const driveMode = document.createElement('span');
            driveMode.textContent = `drive_mode ${selected.drive_mode}`;
            details.appendChild(driveMode);
            statusEl.appendChild(details);
        }

        const probe = status.last_probe;
        if (probe && probe.joint_id === selectedJointId && !probe.recorded) {
            const prompt = document.createElement('p');
            prompt.className = 'direction-probe-prompt';
            prompt.textContent = 'Probe sent. Compare the physical +1° motion with the live viewer, then record the result.';
            statusEl.appendChild(prompt);
        }
    }

    updateDirectionCalibrationControls() {
        const ack = document.getElementById('directionSafetyAck');
        const probeButton = document.getElementById('directionProbeButton');
        const zeroButton = document.getElementById('directionZeroButton');
        const matchButton = document.getElementById('directionMatchButton');
        const oppositeButton = document.getElementById('directionOppositeButton');
        if (!ack || !probeButton || !zeroButton || !matchButton || !oppositeButton) return;

        const jointId = parseInt(document.getElementById('jogJoint')?.value || '0', 10);
        const lastProbe = this.directionCalibration?.last_probe;
        const hasPendingProbe = Boolean(
            lastProbe && lastProbe.joint_id === jointId && !lastProbe.recorded
        );
        const motionAllowed = this.jogControlsConnected
            && !this.jogCommandInFlight
            && !this.directionCalibrationInFlight;

        probeButton.disabled = !(motionAllowed && ack.checked);
        zeroButton.disabled = !(motionAllowed && ack.checked);
        matchButton.disabled = !(motionAllowed && hasPendingProbe);
        oppositeButton.disabled = !(motionAllowed && hasPendingProbe);

        document.querySelectorAll('.cartesian-jog-btn').forEach(button => {
            button.disabled = !(motionAllowed && this.directionCalibration?.all_verified);
        });
    }

    async probeJointDirection() {
        const jointId = parseInt(document.getElementById('jogJoint').value, 10);
        const acknowledged = document.getElementById('directionSafetyAck').checked;
        this.directionCalibrationInFlight = true;
        this.updateDirectionCalibrationControls();
        try {
            const result = await api.probeJointDirection(jointId, acknowledged);
            this.directionCalibration = result;
            this.showNotification(`Joint ${jointId} +1° direction probe sent`, 'info');
            await Promise.all([
                this.refreshDirectionCalibrationStatus(),
                this.refreshJogStatus(),
            ]);
        } catch (error) {
            this.showNotification(`Direction probe failed: ${error.message}`, 'danger');
        } finally {
            this.directionCalibrationInFlight = false;
            this.updateDirectionCalibrationControls();
        }
    }

    async recordJointDirection(matchesModel) {
        const jointId = parseInt(document.getElementById('jogJoint').value, 10);
        this.directionCalibrationInFlight = true;
        this.updateDirectionCalibrationControls();
        try {
            const result = await api.recordJointDirection(jointId, matchesModel);
            this.directionCalibration = result;
            document.getElementById('directionSafetyAck').checked = false;
            this.showNotification(
                matchesModel
                    ? `Joint ${jointId} direction verified`
                    : `Joint ${jointId} direction inverted and verified`,
                'success'
            );
            this.renderDirectionCalibrationStatus();
        } catch (error) {
            this.showNotification(`Could not record direction: ${error.message}`, 'danger');
        } finally {
            this.directionCalibrationInFlight = false;
            this.updateDirectionCalibrationControls();
        }
    }

    async zeroDirectionJoint() {
        const jointId = parseInt(document.getElementById('jogJoint').value, 10);
        const acknowledged = document.getElementById('directionSafetyAck').checked;
        this.directionCalibrationInFlight = true;
        this.updateDirectionCalibrationControls();
        try {
            await api.zeroDirectionJoint(jointId, acknowledged);
            document.getElementById('directionSafetyAck').checked = false;
            this.showNotification(`Joint ${jointId} restore-to-zero command sent`, 'success');
            await this.refreshJogStatus();
        } catch (error) {
            this.showNotification(`Restore to zero failed: ${error.message}`, 'danger');
        } finally {
            this.directionCalibrationInFlight = false;
            this.updateDirectionCalibrationControls();
        }
    }

    disposeJogPage() {
        this.jogPageGeneration += 1;
        if (this.jogStateInterval) {
            clearInterval(this.jogStateInterval);
            this.jogStateInterval = null;
        }
        if (this.jogViewer) {
            this.jogViewer.destroy();
            this.jogViewer = null;
        }
        this.jogRefreshInFlight = false;
        this.jogControlsConnected = false;
        this.jogCommandInFlight = false;
        this.jogLastStatus = null;
        this.directionCalibration = null;
        this.directionCalibrationInFlight = false;
    }

    async jogJoint(delta) {
        const arm = document.getElementById('jogArm').value;
        const jointId = parseInt(document.getElementById('jogJoint').value);
        this.setJogCommandInFlight(true);

        try {
            const result = await api.jogJoint(arm, jointId, delta);
            this.showNotification(`Joint ${jointId} moved to ${result.new_angle_deg.toFixed(1)}°`, 'success');
            await this.refreshJogStatus();
        } catch (error) {
            this.showNotification(`Jog failed: ${error.message}`, 'danger');
        } finally {
            this.setJogCommandInFlight(false);
        }
    }

    async jogCartesian(axis, deltaMm) {
        this.setJogCommandInFlight(true);

        try {
            const result = await api.jogCartesian(axis, deltaMm);
            const target = result.target_position_m.map(value => value.toFixed(3)).join(', ');
            this.showNotification(
                `${axis.toUpperCase()} ${deltaMm > 0 ? '+' : ''}${deltaMm} mm dispatched; target [${target}] m, FK error ${result.position_error_mm.toFixed(2)} mm`,
                'success'
            );
            await this.refreshJogStatus();
        } catch (error) {
            this.showNotification(`Cartesian jog rejected: ${error.message}`, 'danger');
        } finally {
            this.setJogCommandInFlight(false);
        }
    }

    async zeroJoint() {
        const arm = document.getElementById('jogArm').value;
        const jointId = parseInt(document.getElementById('jogJoint').value);
        this.setJogCommandInFlight(true);

        try {
            await api.zeroJoint(arm, jointId);
            this.showNotification(`Joint ${jointId} zeroed`, 'success');
            await this.refreshJogStatus();
        } catch (error) {
            this.showNotification(`Zero failed: ${error.message}`, 'danger');
        } finally {
            this.setJogCommandInFlight(false);
        }
    }

    async zeroAllJoints() {
        const arm = document.getElementById('jogArm').value;

        if (!confirm('Zero all joints?')) return;
        this.setJogCommandInFlight(true);

        try {
            await api.zeroJoint(arm, null);
            this.showNotification('All joints zeroed', 'success');
            await this.refreshJogStatus();
        } catch (error) {
            this.showNotification(`Zero failed: ${error.message}`, 'danger');
        } finally {
            this.setJogCommandInFlight(false);
        }
    }

    async setGripper() {
        const arm = document.getElementById('jogArm').value;
        const position = parseFloat(document.getElementById('gripperSlider').value);
        this.setJogCommandInFlight(true);

        try {
            await api.controlGripper(arm, position);
            this.showNotification(`Gripper set to ${(position * 100).toFixed(0)}% open`, 'success');
            await this.refreshJogStatus();
        } catch (error) {
            this.showNotification(`Gripper control failed: ${error.message}`, 'danger');
        } finally {
            this.setJogCommandInFlight(false);
        }
    }

    // Presets Page
    async loadPresetsPage(container) {
        container.innerHTML = `
            <div class="card">
                <div class="card-title">📋 Preset Positions</div>
                <div id="presetsList">Loading...</div>
            </div>
        `;

        try {
            const data = await api.listPresets();
            const listEl = document.getElementById('presetsList');

            if (data.presets && data.presets.length > 0) {
                listEl.innerHTML = `
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Joints</th>
                                <th>Validated</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.presets.map(preset => `
                                <tr>
                                    <td><strong>${preset.name}</strong></td>
                                    <td>${preset.num_joints} joints</td>
                                    <td><span class="status-badge ${preset.validated ? 'success' : 'warning'}">
                                        ${preset.validated ? 'Valid' : 'Unvalidated'}
                                    </span></td>
                                    <td>
                                        <button class="btn btn-sm btn-primary" onclick="app.moveToPreset('${preset.name}')">
                                            Move
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                listEl.innerHTML = '<p>No presets found</p>';
            }
        } catch (error) {
            document.getElementById('presetsList').innerHTML = `<p>Failed to load: ${error.message}</p>`;
        }
    }

    async moveToPreset(name) {
        if (!confirm(`Move to preset "${name}"?`)) return;

        try {
            await api.moveToPreset(name, 1.0, false);
            this.showNotification(`Moving to ${name}`, 'info');
        } catch (error) {
            this.showNotification(`Move failed: ${error.message}`, 'danger');
        }
    }

    // Advanced pages (using separate modules)
    async loadCalibrationPage(container) {
        if (!calibrationPage) {
            calibrationPage = new CalibrationPage(this);
        }
        await calibrationPage.render(container);
    }

    async loadDiagnosticsPage(container) {
        if (!diagnosticsPage) {
            diagnosticsPage = new DiagnosticsPage(this);
        }
        await diagnosticsPage.render(container);
    }

    async loadConfigPage(container) {
        if (!configPage) {
            configPage = new ConfigPage(this);
        }
        await configPage.render(container);
    }

    // Notification system
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `status-badge ${type}`;
        notification.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;padding:12px 20px;box-shadow:0 4px 6px rgba(0,0,0,0.1);';
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new RobotApp();
});
