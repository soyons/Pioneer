/* VR 连接管理模块 - Quest 设备连接 + adb reverse */
class VRConnectionManager {
    constructor() {
        this.isConnected = false;
        this.deviceSerial = null;
        this.checkInterval = null;
        this.init();
    }

    init() {
        const btn = document.getElementById('vrConnectBtn');
        if (!btn) return;

        btn.addEventListener('click', () => this.handleButtonClick());

        // 启动状态轮询
        this.startPolling();
    }

    async startPolling() {
        await this.updateStatus();
        this.checkInterval = setInterval(() => this.updateStatus(), 3000);
    }

    async updateStatus() {
        try {
            const status = await api.getVRStatus();
            this.updateUI(status);
        } catch (err) {
            console.error('Failed to fetch VR status:', err);
            this.updateUI({
                device_connected: false,
                port_forwarded: false,
                error: 'Failed to check VR status'
            });
        }
    }

    updateUI(status) {
        const btn = document.getElementById('vrConnectBtn');
        if (!btn) return;

        const dot = btn.querySelector('.vr-status-dot');
        const label = btn.querySelector('.vr-label');

        // 更新连接状态
        this.isConnected = status.device_connected && status.port_forwarded;
        this.deviceSerial = status.device_serial;

        // 更新样式
        dot.className = 'vr-status-dot';
        btn.className = 'vr-connect-btn';

        if (this.isConnected) {
            dot.classList.add('connected');
            btn.classList.add('connected');
            btn.title = `VR 已连接 (${this.deviceSerial || 'Quest'})`;
            label.textContent = 'VR ✓';
        } else if (status.device_connected && !status.port_forwarded) {
            dot.classList.add('warning');
            btn.classList.add('warning');
            btn.title = 'Quest 已连接，点击配置端口转发';
            label.textContent = 'VR ⚠';
        } else {
            dot.classList.add('disconnected');
            btn.title = status.error || '未检测到 Quest 设备';
            label.textContent = 'VR';
        }
    }

    async handleButtonClick() {
        const btn = document.getElementById('vrConnectBtn');
        btn.disabled = true;

        try {
            if (this.isConnected) {
                // 已连接 - 点击断开
                await this.disconnect();
            } else {
                // 未连接 - 点击连接
                await this.connect();
            }
        } finally {
            btn.disabled = false;
        }
    }

    async connect() {
        try {
            const result = await api.connectVR();

            if (result.success) {
                this.showNotification(result.message, 'success');
                await this.updateStatus();
            } else {
                // 自动连接失败 - 显示手动命令
                this.showManualCommandDialog(result);
            }
        } catch (err) {
            this.showNotification(`连接失败: ${err.message}`, 'danger');
        }
    }

    async disconnect() {
        if (!confirm('确定要断开 VR 连接吗？')) return;

        try {
            const result = await api.disconnectVR();

            if (result.success) {
                this.showNotification(result.message, 'info');
                await this.updateStatus();
            } else {
                this.showNotification(result.error || '断开失败', 'danger');
            }
        } catch (err) {
            this.showNotification(`断开失败: ${err.message}`, 'danger');
        }
    }

    showManualCommandDialog(result) {
        const message = result.message || '自动连接失败，请在宿主机上手动执行：';
        const command = result.manual_command || 'adb reverse tcp:5200 tcp:5201';
        const error = result.error ? `\n\n错误详情: ${result.error}` : '';

        const dialog = `
            <div class="modal-overlay" id="vrManualCommandModal">
                <div class="modal-dialog">
                    <div class="modal-header">
                        <h3>🥽 VR 连接配置</h3>
                        <button class="modal-close" onclick="document.getElementById('vrManualCommandModal').remove()">×</button>
                    </div>
                    <div class="modal-body">
                        <p>${message}</p>
                        <div class="command-box">
                            <code>${command}</code>
                            <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText('${command}'); this.textContent='已复制'">复制</button>
                        </div>
                        ${error ? `<p class="text-warning">${error}</p>` : ''}
                        <p class="text-muted">执行完成后，VR 状态会自动更新。</p>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-primary" onclick="document.getElementById('vrManualCommandModal').remove()">知道了</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', dialog);
    }

    showNotification(message, type = 'info') {
        // 使用全局通知系统（如果存在）
        if (window.app && window.app.showNotification) {
            window.app.showNotification(message, type);
        } else {
            // 简单的 fallback
            alert(message);
        }
    }
}

// 初始化（等待 DOM 加载）
document.addEventListener('DOMContentLoaded', () => {
    window.vrConnectionManager = new VRConnectionManager();
});
