// API Client for Robot Web Console
// 通过 robot_web_console 反向代理访问三个后端服务
//   /api/robot/*    -> robot_controller:8081
//   /api/camera/*   -> camera_service:8082
//   /api/teleop/*   -> teleop:8080
//   /api/services/* -> robot_web_console 自身(状态监控)
const API_BASE_URL = window.location.origin;
const WS_PREFIX = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

class RobotAPI {
    constructor() {
        this.baseUrl = API_BASE_URL;
        // robot_controller 路由前缀(向后兼容:原代码用 /api/* 直访)
        this.robotPrefix = '/api/robot';
        this.cameraPrefix = '/api/camera';
        this.teleopPrefix = '/api/teleop';
        this.consolePrefix = '/api/services';
        this.wsUrl = `${WS_PREFIX}//${window.location.host}/ws`;
        this.websockets = {};
    }

    // Generic fetch wrapper - 默认走 robot 前缀(向后兼容现有调用)
    async request(endpoint, options = {}) {
        const prefix = options._prefix !== undefined ? options._prefix : this.robotPrefix;
        const url = `${this.baseUrl}${prefix}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };
        const fetchOptions = { ...defaultOptions, ...options };
        delete fetchOptions._prefix;

        try {
            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                const error = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(error.detail || `HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`API Error (${prefix}${endpoint}):`, error);
            throw error;
        }
    }

    // GET request
    async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    }

    // POST request
    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // PATCH request
    async patch(endpoint, data) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    // DELETE request
    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }

    // WebSocket connection
    connectWebSocket(channel, onMessage, onError = null) {
        const url = `${this.wsUrl}/${channel}`;

        if (this.websockets[channel]) {
            console.warn(`WebSocket ${channel} already connected`);
            return this.websockets[channel];
        }

        const ws = new WebSocket(url);

        ws.onopen = () => {
            console.log(`WebSocket connected: ${channel}`);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessage(data);
            } catch (error) {
                console.error(`WebSocket parse error (${channel}):`, error);
            }
        };

        ws.onerror = (error) => {
            console.error(`WebSocket error (${channel}):`, error);
            if (onError) onError(error);
        };

        ws.onclose = () => {
            console.log(`WebSocket closed: ${channel}`);
            delete this.websockets[channel];

            // Auto-reconnect after 3 seconds
            setTimeout(() => {
                console.log(`Reconnecting WebSocket: ${channel}`);
                this.connectWebSocket(channel, onMessage, onError);
            }, 3000);
        };

        this.websockets[channel] = ws;
        return ws;
    }

    // Close WebSocket
    closeWebSocket(channel) {
        if (this.websockets[channel]) {
            this.websockets[channel].close();
            delete this.websockets[channel];
        }
    }

    // Status API
    async getStatus() {
        return this.get('/status');
    }

    async getHealth() {
        return this.get('/health');
    }

    // Config API
    async getConfig() {
        return this.get('/config');
    }

    async getConfigSection(section) {
        return this.get(`/config/${section}`);
    }

    async updateConfig(section, data) {
        return this.patch('/config', { section, data });
    }

    async reloadConfig() {
        return this.post('/config/reload');
    }

    async saveConfig() {
        return this.post('/config/save');
    }

    // Presets API
    async listPresets() {
        return this.get('/presets');
    }

    async getPreset(name) {
        return this.get(`/presets/${name}`);
    }

    async createPreset(name, description = '', fromCurrent = true, jointAngles = null) {
        return this.post('/presets', {
            name,
            description,
            from_current: fromCurrent,
            joint_angles: jointAngles,
        });
    }

    async moveToPreset(name, speed = 1.0, wait = false) {
        return this.post(`/presets/${name}/move`, { speed, wait });
    }

    // Jog API
    async jogJoint(arm, jointId, deltaDeg) {
        return this.post('/jog/joint', {
            arm,
            joint_id: jointId,
            delta_deg: deltaDeg,
        });
    }

    async jogCartesian(arm, axis, delta) {
        return this.post('/jog/cartesian', { arm, axis, delta });
    }

    async controlGripper(arm, position) {
        return this.post('/jog/gripper', { arm, position });
    }

    async zeroJoint(arm, jointId = null) {
        return this.post('/jog/zero', { arm, joint_id: jointId });
    }

    async emergencyStop() {
        return this.post('/emergency_stop');
    }

    // Calibration API
    async startCalibration(arm, joints = null) {
        return this.post('/calibrate/start', { arm, joints });
    }

    async getCalibrationStatus() {
        return this.get('/calibrate/status');
    }

    async recordCalibrationStep(jointId, limitType, rawPosition) {
        return this.post('/calibrate/step', {
            joint_id: jointId,
            limit_type: limitType,
            raw_position: rawPosition,
        });
    }

    async getCurrentPositions() {
        return this.get('/calibrate/current_position');
    }

    async saveCalibration() {
        return this.post('/calibrate/save');
    }

    async cancelCalibration() {
        return this.post('/calibrate/cancel');
    }

    // Diagnostics API
    async scanPorts() {
        return this.get('/diagnostics/ports');
    }

    async testPort(port, baudrate = 1000000) {
        return this.post('/diagnostics/test_port', { port, baudrate });
    }

    async scanMotors(port, baudrate = 1000000, idRangeStart = 1, idRangeEnd = 18) {
        return this.post('/diagnostics/scan_motors', {
            port,
            baudrate,
            id_range_start: idRangeStart,
            id_range_end: idRangeEnd,
        });
    }

    async healthCheck() {
        return this.get('/diagnostics/health');
    }

    // ============================================================
    // Camera Service API (前缀 /api/camera/*)
    // ============================================================
    async cameraHealth() {
        return this.request('/health', { method: 'GET', _prefix: this.cameraPrefix });
    }

    async listCameras() {
        return this.request('/cameras', { method: 'GET', _prefix: this.cameraPrefix });
    }

    async listAvailableCameras() {
        return this.request('/cameras/available', { method: 'GET', _prefix: this.cameraPrefix });
    }

    async getCamera(name) {
        return this.request(`/cameras/${encodeURIComponent(name)}`, { method: 'GET', _prefix: this.cameraPrefix });
    }

    async updateCameraControls(name, controls) {
        return this.request(`/cameras/${encodeURIComponent(name)}/controls`, {
            method: 'PATCH',
            body: JSON.stringify(controls),
            _prefix: this.cameraPrefix,
        });
    }

    async getCameraConfig() {
        return this.request('/config', { method: 'GET', _prefix: this.cameraPrefix });
    }

    // ============================================================
    // Teleop API (前缀 /api/teleop/*)
    // ============================================================
    async teleopHealth() {
        return this.request('/health', { method: 'GET', _prefix: this.teleopPrefix });
    }

    async getTeleopStatus() {
        return this.request('/status', { method: 'GET', _prefix: this.teleopPrefix });
    }

    async getTeleopConfig() {
        return this.request('/config', { method: 'GET', _prefix: this.teleopPrefix });
    }

    async updateTeleopConfig(patch) {
        return this.request('/config', {
            method: 'PATCH',
            body: JSON.stringify(patch),
            _prefix: this.teleopPrefix,
        });
    }

    async resetTeleopReference() {
        return this.request('/teleop/reset_reference', { method: 'POST', _prefix: this.teleopPrefix });
    }

    async getTeleopVRData() {
        return this.request('/vr_data', { method: 'GET', _prefix: this.teleopPrefix });
    }

    // ============================================================
    // Console / Service Monitor API (前缀 /api/services/*)
    // ============================================================
    async getServicesStatus() {
        return this.request('/status', { method: 'GET', _prefix: this.consolePrefix });
    }

    async triggerHealthCheck() {
        return this.request('/check', { method: 'POST', _prefix: this.consolePrefix });
    }

    // ============================================================
    // System Resources API (前缀 /api/system/*)
    // ============================================================
    async getSystemInfo(topN = 5) {
        return this.request(`/info?top_n=${topN}`, { method: 'GET', _prefix: '/api/system' });
    }

    // === VR Connection ===
    async getVRStatus() {
        return this.request('/vr/status', { method: 'GET', _prefix: '/api/system' });
    }

    async connectVR() {
        return this.request('/vr/connect', { method: 'POST', _prefix: '/api/system' });
    }

    async disconnectVR() {
        return this.request('/vr/disconnect', { method: 'POST', _prefix: '/api/system' });
    }
}

// Export singleton instance
const api = new RobotAPI();
