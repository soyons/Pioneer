// Coach 控制页面 - 状态、配置热加载、参考点重置、VR连接管理
const TeleopPage = {
    refreshTimer: null,
    refreshIntervalMs: 2000,
    vrDataTimer: null,
    vrDataRefreshMs: 100,  // VR 数据高频刷新 10Hz
    vrStatusTimer: null,
    showVRData: false,
    vrConnected: false,
    vrDeviceSerial: null,

    async render(container) {
        container.innerHTML = `
            <div class="card">
                <div class="card-title">
                    <span>🎮 Coach Service</span>
                    <button class="btn btn-secondary btn-sm" id="btnTeleopRefresh">刷新</button>
                </div>
                <div id="teleopStatus">
                    <div class="spinner"></div>
                </div>
            </div>

            <div class="card" style="display: none;">
                <div class="card-title">🥽 VR 连接管理</div>

                <!-- VR 连接状态显示 - 临时禁用（容器内无法使用 adb） -->
                <div id="vrConnectionStatus" style="margin-bottom: 16px; padding: 12px; border-radius: 6px; background: var(--bg-color);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div id="vrStatusIndicator" style="width: 12px; height: 12px; border-radius: 50%; background: var(--text-secondary);"></div>
                        <div style="flex: 1;">
                            <div id="vrStatusText" style="font-weight: 600; margin-bottom: 4px;">检查中...</div>
                            <div id="vrStatusDetail" style="font-size: 0.85rem; color: var(--text-secondary);"></div>
                        </div>
                        <button class="btn btn-sm" id="btnVRToggle" disabled>连接</button>
                    </div>
                </div>

                <div id="vrConnectionInfo" style="margin-bottom: 16px; color: var(--text-secondary); font-size: 0.9rem;">
                    <p>📱 <strong>Quest 设置步骤：</strong></p>
                    <ol style="margin: 8px 0 0 20px; line-height: 1.8;">
                        <li>连接 Quest 到电脑（USB-C）</li>
                        <li>在主机运行：<code style="background: var(--bg-color); padding: 2px 6px; border-radius: 4px;">adb reverse tcp:5200 tcp:5201</code></li>
                        <li>启动 Quest 上的 VR Tracker 应用</li>
                        <li>在应用中点击 Connect 连接到 <code>localhost:5200</code></li>
                    </ol>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-primary" id="btnCheckVRConnection">检查连接</button>
                    <button class="btn btn-warning" id="btnResetReference">重置参考点</button>
                    <button class="btn btn-secondary" id="btnToggleVRData">显示实时数据</button>
                </div>
                <p style="color:var(--text-secondary); font-size:0.85rem; margin-top:8px;">
                    重置参考点会清除当前的 VR 头显位姿原点，下一帧数据到达时重新捕获。
                </p>
                <div id="vrDataDisplay" style="display:none; margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div class="vr-tracker-card">
                            <div style="font-weight:bold; margin-bottom:8px;">🎧 Head</div>
                            <div id="vrHeadData" class="vr-data-block"></div>
                        </div>
                        <div class="vr-tracker-card">
                            <div style="font-weight:bold; margin-bottom:8px;">🫲 Left Hand</div>
                            <div id="vrLeftData" class="vr-data-block"></div>
                        </div>
                        <div class="vr-tracker-card" style="grid-column: span 2;">
                            <div style="font-weight:bold; margin-bottom:8px;">🫱 Right Hand</div>
                            <div id="vrRightData" class="vr-data-block"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">
                    <span>配置</span>
                    <button class="btn btn-primary btn-sm" id="btnApplyConfig">应用</button>
                    <button class="btn btn-secondary btn-sm" id="btnReloadConfig">重载</button>
                </div>
                <div id="teleopConfig">
                    <div class="spinner"></div>
                </div>
            </div>
        `;

        document.getElementById('btnTeleopRefresh').addEventListener('click', () => this.refreshStatus());
        document.getElementById('btnCheckVRConnection').addEventListener('click', () => this.checkVRConnection());
        document.getElementById('btnResetReference').addEventListener('click', () => this.resetReference());
        document.getElementById('btnToggleVRData').addEventListener('click', () => this.toggleVRDataDisplay());
        document.getElementById('btnApplyConfig').addEventListener('click', () => this.applyConfig());
        document.getElementById('btnReloadConfig').addEventListener('click', () => this.loadConfig());
        document.getElementById('btnVRToggle').addEventListener('click', () => this.handleVRToggle());

        await Promise.all([this.refreshStatus(), this.loadConfig()]);
        this.refreshTimer = setInterval(() => this.refreshStatus(true), this.refreshIntervalMs);
        // VR 状态轮询已临时禁用（容器内无 adb 访问）
        // this.vrStatusTimer = setInterval(() => this.updateVRStatus(), 3000);
    },

    onLeave() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        if (this.vrDataTimer) {
            clearInterval(this.vrDataTimer);
            this.vrDataTimer = null;
        }
        if (this.vrStatusTimer) {
            clearInterval(this.vrStatusTimer);
            this.vrStatusTimer = null;
        }
    },

    async updateVRStatus() {
        try {
            const status = await api.getVRStatus();
            this.renderVRStatus(status);
        } catch (err) {
            console.error('Failed to fetch VR status:', err);
            this.renderVRStatus({
                device_connected: false,
                port_forwarded: false,
                error: 'Failed to check VR status'
            });
        }
    },

    renderVRStatus(status) {
        const indicator = document.getElementById('vrStatusIndicator');
        const statusText = document.getElementById('vrStatusText');
        const statusDetail = document.getElementById('vrStatusDetail');
        const toggleBtn = document.getElementById('btnVRToggle');

        if (!indicator || !statusText || !statusDetail || !toggleBtn) return;

        this.vrConnected = status.device_connected && status.port_forwarded;
        this.vrDeviceSerial = status.device_serial;

        if (this.vrConnected) {
            indicator.style.background = 'var(--success-color)';
            statusText.textContent = `✅ VR 已连接 (${this.vrDeviceSerial || 'Quest'})`;
            statusDetail.textContent = '端口转发已配置，数据流正常';
            toggleBtn.textContent = '断开';
            toggleBtn.className = 'btn btn-sm btn-danger';
            toggleBtn.disabled = false;
        } else if (status.device_connected && !status.port_forwarded) {
            indicator.style.background = 'var(--warning-color)';
            statusText.textContent = '⚠️ Quest 已连接，等待端口配置';
            statusDetail.textContent = '点击"连接"按钮配置端口转发';
            toggleBtn.textContent = '连接';
            toggleBtn.className = 'btn btn-sm btn-primary';
            toggleBtn.disabled = false;
        } else {
            indicator.style.background = 'var(--danger-color)';
            statusText.textContent = '❌ VR 未连接';
            statusDetail.textContent = status.error || '未检测到 Quest 设备（检查 USB 连接）';
            toggleBtn.textContent = '连接';
            toggleBtn.className = 'btn btn-sm btn-secondary';
            toggleBtn.disabled = true;
        }
    },

    async handleVRToggle() {
        const btn = document.getElementById('btnVRToggle');
        if (!btn) return;

        btn.disabled = true;

        try {
            if (this.vrConnected) {
                // 断开
                if (!confirm('确定要断开 VR 连接吗？')) {
                    btn.disabled = false;
                    return;
                }
                const result = await api.disconnectVR();
                if (result.success) {
                    this.showNotification(result.message, 'info');
                } else {
                    this.showNotification(result.error || '断开失败', 'danger');
                }
            } else {
                // 连接
                const result = await api.connectVR();
                if (result.success) {
                    this.showNotification(result.message, 'success');
                } else {
                    // 自动连接失败 - 显示手动命令
                    this.showManualCommandDialog(result);
                }
            }
            await this.updateVRStatus();
        } catch (err) {
            this.showNotification(`操作失败: ${err.message}`, 'danger');
        } finally {
            btn.disabled = false;
        }
    },

    showManualCommandDialog(result) {
        const message = result.message || '自动连接失败，请在宿主机上手动执行：';
        const command = result.manual_command || 'adb reverse tcp:5200 tcp:5201';
        const error = result.error ? `\n\n错误详情: ${result.error}` : '';

        const dialog = `
            <div class="modal-overlay" id="vrManualCommandModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;">
                <div style="background:white;border-radius:8px;max-width:600px;width:90%;">
                    <div style="padding:20px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">
                        <h3 style="margin:0;">🥽 VR 连接配置</h3>
                        <button onclick="document.getElementById('vrManualCommandModal').remove()" style="border:none;background:none;font-size:24px;cursor:pointer;color:var(--text-secondary);">×</button>
                    </div>
                    <div style="padding:20px;">
                        <p>${message}</p>
                        <div style="background:var(--bg-color);padding:12px;border-radius:6px;margin:12px 0;display:flex;justify-content:space-between;align-items:center;">
                            <code style="flex:1;">${command}</code>
                            <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText('${command}'); this.textContent='已复制'">复制</button>
                        </div>
                        ${error ? `<p style="color:var(--warning-color);">${error}</p>` : ''}
                        <p style="color:var(--text-secondary);font-size:0.9rem;">执行完成后，VR 状态会自动更新。</p>
                    </div>
                    <div style="padding:12px 20px;border-top:1px solid var(--border-color);text-align:right;">
                        <button class="btn btn-primary" onclick="document.getElementById('vrManualCommandModal').remove()">知道了</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', dialog);
    },

    async refreshStatus(silent = false) {
        const el = document.getElementById('teleopStatus');
        if (!el) return;

        try {
            const status = await api.getTeleopStatus();
            const vr = status.vr || {};
            const pub = status.publisher || {};

            el.innerHTML = `
                <div class="teleop-status-grid">
                    <div class="teleop-status-card ${vr.connected ? 'status-ok' : 'status-error'}">
                        <div class="teleop-status-icon">${vr.connected ? '✓' : '✗'}</div>
                        <div class="teleop-status-body">
                            <div class="teleop-status-title">VR Connection</div>
                            <div class="teleop-status-value">${vr.connected ? 'Connected' : 'Disconnected'}</div>
                            ${vr.connected ? `
                                <div class="teleop-status-metrics">
                                    <span>📡 ${(vr.recv_rate_hz || 0).toFixed(1)} Hz</span>
                                    <span>📦 ${vr.recv_count || 0} frames</span>
                                    ${vr.error_count > 0 ? `<span style="color:var(--warning-color)">⚠ ${vr.error_count} errors</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <div class="teleop-status-card ${pub.ros_available ? 'status-ok' : 'status-error'}">
                        <div class="teleop-status-icon">${pub.ros_available ? '✓' : '✗'}</div>
                        <div class="teleop-status-body">
                            <div class="teleop-status-title">ROS Publisher</div>
                            <div class="teleop-status-value">${pub.ros_node_active ? 'Active' : 'Inactive'}</div>
                            ${pub.ros_available ? `
                                <div class="teleop-status-metrics">
                                    <span>📤 ${(pub.actual_rate_hz || 0).toFixed(1)} Hz</span>
                                    <span>📦 ${pub.publish_count || 0} msgs</span>
                                    <span>🎯 Target: ${pub.rate_hz || 0} Hz</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            if (!silent) {
                el.innerHTML = `<p style="color:var(--danger-color)">无法连接 teleop: ${e.message}</p>`;
            }
        }
    },

    formatVal(v) {
        if (v === null || v === undefined) return '-';
        if (typeof v === 'object') return JSON.stringify(v);
        if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(3);
        return String(v);
    },

    async loadConfig() {
        const el = document.getElementById('teleopConfig');
        if (!el) return;

        try {
            const config = await api.getTeleopConfig();
            this._currentConfig = config;
            el.innerHTML = this.renderConfigForm(config);
        } catch (e) {
            el.innerHTML = `<p style="color:var(--danger-color)">加载配置失败: ${e.message}</p>`;
        }
    },

    renderConfigForm(config, prefix = '') {
        // 递归渲染配置，支持两层嵌套
        const sections = [];

        for (const [key, val] of Object.entries(config)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;

            if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                // 这是一个对象，检查是否还有嵌套
                const hasNestedObjects = Object.values(val).some(v =>
                    v !== null && typeof v === 'object' && !Array.isArray(v)
                );

                if (hasNestedObjects) {
                    // 有嵌套对象，递归展开
                    sections.push(`
                        <div class="teleop-category">
                            <h2>${key}</h2>
                            ${this.renderConfigForm(val, fullKey)}
                        </div>
                    `);
                } else {
                    // 没有嵌套对象，渲染为一个section
                    sections.push(`
                        <div class="teleop-section">
                            <h3>${key}</h3>
                            <div class="teleop-config-grid">
                                ${Object.entries(val).map(([k, v]) =>
                                    this.renderField(`${fullKey}.${k}`, k, v)
                                ).join('')}
                            </div>
                        </div>
                    `);
                }
            } else if (!prefix) {
                // 顶层标量值
                sections.push(`
                    <div class="teleop-section">
                        <div class="teleop-config-grid">
                            ${this.renderField(fullKey, key, val)}
                        </div>
                    </div>
                `);
            }
        }
        return sections.join('');
    },

    renderField(fullKey, displayName, val) {
        const id = `cfg-${fullKey.replace(/\./g, '-')}`;
        let input;
        if (typeof val === 'boolean') {
            input = `<select id="${id}" data-key="${fullKey}">
                <option value="true" ${val ? 'selected' : ''}>true</option>
                <option value="false" ${!val ? 'selected' : ''}>false</option>
            </select>`;
        } else if (Array.isArray(val)) {
            input = `<input type="text" id="${id}" data-key="${fullKey}"
                            value="${JSON.stringify(val)}" data-type="array">`;
        } else if (typeof val === 'object' && val !== null) {
            input = `<input type="text" id="${id}" data-key="${fullKey}"
                            value='${JSON.stringify(val)}' data-type="object">`;
        } else {
            const t = typeof val === 'number' ? 'number' : 'text';
            input = `<input type="${t}" id="${id}" data-key="${fullKey}" value="${val ?? ''}"
                            data-type="${typeof val}" step="any">`;
        }
        return `
            <div class="config-field">
                <label for="${id}">${displayName}</label>
                ${input}
            </div>
        `;
    },

    async applyConfig() {
        const inputs = document.querySelectorAll('#teleopConfig [data-key]');
        const patch = {};
        inputs.forEach(input => {
            const key = input.dataset.key;
            const type = input.dataset.type;
            let val = input.value;
            if (type === 'number') val = parseFloat(val);
            else if (type === 'boolean') val = val === 'true';
            else if (type === 'array' || type === 'object') {
                try { val = JSON.parse(val); } catch { return; }
            }
            // 嵌套 key -> 嵌套对象
            const parts = key.split('.');
            let cur = patch;
            for (let i = 0; i < parts.length - 1; i++) {
                cur[parts[i]] = cur[parts[i]] || {};
                cur = cur[parts[i]];
            }
            cur[parts[parts.length - 1]] = val;
        });

        try {
            await api.updateTeleopConfig(patch);
            alert('配置已应用(热加载)');
        } catch (e) {
            alert('应用失败: ' + e.message);
        }
    },

    async resetReference() {
        if (!confirm('确认重置 VR 参考点?')) return;
        try {
            await api.resetTeleopReference();
            alert('已重置参考点');
            await this.refreshStatus();
        } catch (e) {
            alert('重置失败: ' + e.message);
        }
    },

    async checkVRConnection() {
        const btn = document.getElementById('btnCheckVRConnection');
        if (!btn) return;

        btn.disabled = true;
        btn.textContent = '检查中...';

        try {
            const status = await api.getTeleopStatus();
            const vr = status.vr || {};

            let message = '【VR 连接状态】\n\n';

            if (vr.connected) {
                message += '✅ VR 已连接\n\n';
                message += `📡 接收频率: ${(vr.recv_rate_hz || 0).toFixed(1)} Hz\n`;
                message += `📦 已接收帧数: ${vr.recv_count || 0}\n`;
                message += `⏱️ 最后接收: ${(vr.last_recv_age_s || 0).toFixed(2)}s 前\n`;

                if (vr.error_count > 0) {
                    message += `\n⚠️ 解析错误: ${vr.error_count} 次\n`;
                    message += '（通常是连接握手时的正常噪声）';
                }

                message += '\n\n✅ 数据流正常！';
            } else {
                message += '❌ VR 未连接\n\n';
                message += '请检查：\n';
                message += '1. Quest 是否通过 USB 连接到电脑\n';
                message += '2. 是否运行了 adb reverse tcp:5200 tcp:5201\n';
                message += '3. Quest 上的 VR Tracker 应用是否已启动\n';
                message += '4. 应用中是否点击了 Connect 按钮\n';
                message += '\n提示：检查 adb devices 确认 Quest 连接';
            }

            alert(message);
            await this.refreshStatus();
        } catch (e) {
            alert(`检查失败：${e.message}\n\n无法连接到 Coach 服务`);
        } finally {
            btn.disabled = false;
            btn.textContent = '检查连接';
        }
    },

    showNotification(message, type = 'info') {
        // 使用全局通知系统
        if (window.app && window.app.showNotification) {
            window.app.showNotification(message, type);
        } else {
            alert(message);
        }
    },

    toggleVRDataDisplay() {
        this.showVRData = !this.showVRData;
        const displayEl = document.getElementById('vrDataDisplay');
        const btn = document.getElementById('btnToggleVRData');

        if (this.showVRData) {
            displayEl.style.display = 'block';
            btn.textContent = '隐藏实时数据';
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
            // 启动高频刷新
            this.refreshVRData();
            this.vrDataTimer = setInterval(() => this.refreshVRData(), this.vrDataRefreshMs);
        } else {
            displayEl.style.display = 'none';
            btn.textContent = '显示实时数据';
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
            // 停止刷新
            if (this.vrDataTimer) {
                clearInterval(this.vrDataTimer);
                this.vrDataTimer = null;
            }
        }
    },

    async refreshVRData() {
        if (!this.showVRData) return;

        try {
            const res = await api.getTeleopVRData();
            if (!res.connected || !res.data) {
                this.renderVRDisconnected();
                return;
            }

            const d = res.data;
            this.renderVRTrackerData('vrHeadData', d.head);
            this.renderVRControllerData('vrLeftData', d.left);
            this.renderVRControllerData('vrRightData', d.right);
        } catch (e) {
            console.warn('Failed to fetch VR data:', e);
        }
    },

    renderVRDisconnected() {
        ['vrHeadData', 'vrLeftData', 'vrRightData'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<span style="color:var(--danger-color);">❌ No data</span>';
        });
    },

    renderVRTrackerData(elId, data) {
        const el = document.getElementById(elId);
        if (!el) return;

        const pos = data.pos || [0, 0, 0];
        const rot = data.rot || [0, 0, 0, 1];

        el.innerHTML = `
            <div style="font-family:monospace; font-size:0.85rem; line-height:1.6;">
                <div><strong>Position:</strong></div>
                <div style="padding-left:8px; color:var(--text-secondary);">
                    X: ${pos[0].toFixed(3)}  Y: ${pos[1].toFixed(3)}  Z: ${pos[2].toFixed(3)}
                </div>
                <div style="margin-top:4px;"><strong>Rotation (quat):</strong></div>
                <div style="padding-left:8px; color:var(--text-secondary);">
                    x: ${rot[0].toFixed(3)}  y: ${rot[1].toFixed(3)}<br>
                    z: ${rot[2].toFixed(3)}  w: ${rot[3].toFixed(3)}
                </div>
            </div>
        `;
    },

    renderVRControllerData(elId, data) {
        const el = document.getElementById(elId);
        if (!el) return;

        const pos = data.pos || [0, 0, 0];
        const rot = data.rot || [0, 0, 0, 1];

        const buttonStyle = (pressed) => pressed
            ? 'background:var(--success-color); color:white; padding:2px 6px; border-radius:3px; font-weight:bold;'
            : 'background:var(--bg-darker); color:var(--text-secondary); padding:2px 6px; border-radius:3px;';

        const barStyle = (value) => {
            const pct = Math.round(value * 100);
            return `
                <div style="display:inline-block; width:60px; height:8px; background:var(--bg-darker); border-radius:4px; position:relative; vertical-align:middle;">
                    <div style="width:${pct}%; height:100%; background:var(--primary-color); border-radius:4px;"></div>
                </div>
                <span style="margin-left:6px; color:var(--text-secondary); font-size:0.8rem;">${pct}%</span>
            `;
        };

        const stickIndicator = (x, y) => {
            const centerX = 20 + x * 15;
            const centerY = 20 - y * 15;
            return `
                <svg width="40" height="40" style="vertical-align:middle; margin-left:8px;">
                    <circle cx="20" cy="20" r="18" fill="var(--bg-darker)" stroke="var(--border-color)" stroke-width="1"/>
                    <circle cx="${centerX}" cy="${centerY}" r="4" fill="var(--primary-color)"/>
                </svg>
            `;
        };

        el.innerHTML = `
            <div style="font-family:monospace; font-size:0.85rem; line-height:1.8;">
                <div><strong>Position:</strong> <span style="color:var(--text-secondary);">
                    X: ${pos[0].toFixed(3)} Y: ${pos[1].toFixed(3)} Z: ${pos[2].toFixed(3)}
                </span></div>
                <div><strong>Rotation:</strong> <span style="color:var(--text-secondary);">
                    x: ${rot[0].toFixed(3)} y: ${rot[1].toFixed(3)} z: ${rot[2].toFixed(3)} w: ${rot[3].toFixed(3)}
                </span></div>
                <div style="margin-top:8px; display:grid; grid-template-columns: auto 1fr; gap: 8px; align-items:center;">
                    <span>Trigger:</span><div>${barStyle(data.trigger || 0)}</div>
                    <span>Grip:</span><div>${barStyle(data.grip || 0)}</div>
                </div>
                <div style="margin-top:8px;">
                    <strong>Buttons:</strong>
                    <span style="${buttonStyle(data.btn_a)}">A</span>
                    <span style="${buttonStyle(data.btn_b)}">B</span>
                    <span style="${buttonStyle(data.menu)}">Menu</span>
                    <span style="${buttonStyle(data.stick_click)}">Stick</span>
                </div>
                <div style="margin-top:8px;">
                    <strong>Stick:</strong>
                    <span style="color:var(--text-secondary);">X: ${data.stick_x.toFixed(2)} Y: ${data.stick_y.toFixed(2)}</span>
                    ${stickIndicator(data.stick_x, data.stick_y)}
                </div>
                <div style="margin-top:8px;">
                    <span style="${data.connected ? 'color:var(--success-color);' : 'color:var(--danger-color);'}">
                        ${data.connected ? '✓ Connected' : '✗ Disconnected'}
                    </span>
                </div>
            </div>
        `;
    },
};
