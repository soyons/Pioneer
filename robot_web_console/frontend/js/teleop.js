// 遥操控制页面 - 状态、配置热加载、参考点重置
const TeleopPage = {
    refreshTimer: null,
    refreshIntervalMs: 2000,

    async render(container) {
        container.innerHTML = `
            <div class="card">
                <div class="card-title">
                    <span>🥽 Teleop Service</span>
                    <button class="btn btn-secondary btn-sm" id="btnTeleopRefresh">刷新</button>
                </div>
                <div id="teleopStatus">
                    <div class="spinner"></div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">操作</div>
                <button class="btn btn-warning" id="btnResetReference">重置参考点</button>
                <p style="color:var(--text-secondary); font-size:0.85rem; margin-top:8px;">
                    重置 VR 头显的位姿参考点。下一帧 VR 数据进来后会重新捕获原点。
                </p>
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
        document.getElementById('btnResetReference').addEventListener('click', () => this.resetReference());
        document.getElementById('btnApplyConfig').addEventListener('click', () => this.applyConfig());
        document.getElementById('btnReloadConfig').addEventListener('click', () => this.loadConfig());

        await Promise.all([this.refreshStatus(), this.loadConfig()]);
        this.refreshTimer = setInterval(() => this.refreshStatus(true), this.refreshIntervalMs);
    },

    onLeave() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    },

    async refreshStatus(silent = false) {
        const el = document.getElementById('teleopStatus');
        if (!el) return;

        try {
            const status = await api.getTeleopStatus();
            el.innerHTML = `
                <div class="camera-info-grid">
                    ${Object.entries(status).map(([key, val]) => `
                        <span class="camera-info-label">${key}</span>
                        <span class="camera-info-value">${this.formatVal(val)}</span>
                    `).join('')}
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
        // 递归渲染配置(简单平铺,只支持顶层标量和一层嵌套)
        const fields = [];
        for (const [key, val] of Object.entries(config)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                fields.push(`
                    <div class="teleop-section">
                        <h3>${fullKey}</h3>
                        <div class="teleop-config-grid">
                            ${Object.entries(val).map(([k, v]) => this.renderField(`${fullKey}.${k}`, v)).join('')}
                        </div>
                    </div>
                `);
            } else if (!prefix) {
                fields.push(`
                    <div class="teleop-config-grid">
                        ${this.renderField(fullKey, val)}
                    </div>
                `);
            }
        }
        return fields.join('');
    },

    renderField(key, val) {
        const id = `cfg-${key.replace(/\./g, '-')}`;
        let input;
        if (typeof val === 'boolean') {
            input = `<select id="${id}" data-key="${key}">
                <option value="true" ${val ? 'selected' : ''}>true</option>
                <option value="false" ${!val ? 'selected' : ''}>false</option>
            </select>`;
        } else if (Array.isArray(val)) {
            input = `<input type="text" id="${id}" data-key="${key}"
                            value="${JSON.stringify(val)}" data-type="array">`;
        } else if (typeof val === 'object' && val !== null) {
            input = `<input type="text" id="${id}" data-key="${key}"
                            value='${JSON.stringify(val)}' data-type="object">`;
        } else {
            const t = typeof val === 'number' ? 'number' : 'text';
            input = `<input type="${t}" id="${id}" data-key="${key}" value="${val ?? ''}"
                            data-type="${typeof val}" step="any">`;
        }
        return `
            <div class="config-field">
                <label for="${id}">${key.split('.').pop()}</label>
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
        } catch (e) {
            alert('重置失败: ' + e.message);
        }
    },
};
