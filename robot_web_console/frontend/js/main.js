// Main Application Logic
class RobotApp {
    constructor() {
        this.currentPage = 'status';
        this.isConnected = false;
        this.stateUpdateInterval = null;
        this.systemUpdateInterval = null;

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
        container.innerHTML = `
            <div class="card">
                <div class="card-title">🕹️ Joint Jog Control</div>
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
                <div class="form-group">
                    <label class="form-label">Delta (degrees):</label>
                    <div class="flex gap-2">
                        <button class="btn btn-primary" onclick="app.jogJoint(-10)">-10°</button>
                        <button class="btn btn-primary" onclick="app.jogJoint(-5)">-5°</button>
                        <button class="btn btn-primary" onclick="app.jogJoint(-1)">-1°</button>
                        <button class="btn btn-primary" onclick="app.jogJoint(1)">+1°</button>
                        <button class="btn btn-primary" onclick="app.jogJoint(5)">+5°</button>
                        <button class="btn btn-primary" onclick="app.jogJoint(10)">+10°</button>
                    </div>
                </div>
                <div class="form-group">
                    <button class="btn btn-warning" onclick="app.zeroJoint()">Zero Joint</button>
                    <button class="btn btn-warning" onclick="app.zeroAllJoints()">Zero All Joints</button>
                </div>
            </div>

            <div class="card mt-4">
                <div class="card-title">✋ Gripper Control</div>
                <div class="form-group">
                    <label class="form-label">Position (0 = closed, 1 = open):</label>
                    <input type="range" id="gripperSlider" class="form-input" min="0" max="1" step="0.01" value="0">
                    <p id="gripperValue">0.00</p>
                </div>
                <button class="btn btn-success" onclick="app.setGripper()">Set Gripper</button>
            </div>
        `;

        // Setup gripper slider
        const slider = document.getElementById('gripperSlider');
        const valueDisplay = document.getElementById('gripperValue');
        slider.addEventListener('input', (e) => {
            valueDisplay.textContent = parseFloat(e.target.value).toFixed(2);
        });
    }

    async jogJoint(delta) {
        const arm = document.getElementById('jogArm').value;
        const jointId = parseInt(document.getElementById('jogJoint').value);

        try {
            const result = await api.jogJoint(arm, jointId, delta);
            this.showNotification(`Joint ${jointId} moved to ${result.new_angle_deg.toFixed(1)}°`, 'success');
        } catch (error) {
            this.showNotification(`Jog failed: ${error.message}`, 'danger');
        }
    }

    async zeroJoint() {
        const arm = document.getElementById('jogArm').value;
        const jointId = parseInt(document.getElementById('jogJoint').value);

        try {
            await api.zeroJoint(arm, jointId);
            this.showNotification(`Joint ${jointId} zeroed`, 'success');
        } catch (error) {
            this.showNotification(`Zero failed: ${error.message}`, 'danger');
        }
    }

    async zeroAllJoints() {
        const arm = document.getElementById('jogArm').value;

        if (!confirm('Zero all joints?')) return;

        try {
            await api.zeroJoint(arm, null);
            this.showNotification('All joints zeroed', 'success');
        } catch (error) {
            this.showNotification(`Zero failed: ${error.message}`, 'danger');
        }
    }

    async setGripper() {
        const arm = document.getElementById('jogArm').value;
        const position = parseFloat(document.getElementById('gripperSlider').value);

        try {
            await api.controlGripper(arm, position);
            this.showNotification(`Gripper set to ${position.toFixed(2)}`, 'success');
        } catch (error) {
            this.showNotification(`Gripper control failed: ${error.message}`, 'danger');
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
