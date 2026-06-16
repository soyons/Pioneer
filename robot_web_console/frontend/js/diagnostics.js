// Diagnostics Page Module
class DiagnosticsPage {
    constructor(app) {
        this.app = app;
    }

    async render(container) {
        container.innerHTML = `
            <div class="card-grid">
                <div class="card">
                    <div class="card-title">🔌 Port Scanner</div>
                    <button class="btn btn-primary" onclick="diagnosticsPage.scanPorts()">
                        Scan Ports
                    </button>
                    <div id="portsResult" class="mt-4"></div>
                </div>

                <div class="card">
                    <div class="card-title">🔍 Motor Scanner</div>
                    <div class="form-group">
                        <label class="form-label">Port:</label>
                        <select id="motorPort" class="form-select">
                            <option value="">(Select port)</option>
                        </select>
                    </div>
                    <button class="btn btn-primary" onclick="diagnosticsPage.scanMotors()">
                        Scan Motors
                    </button>
                    <div id="motorsResult" class="mt-4"></div>
                </div>
            </div>

            <div class="card mt-4">
                <div class="card-title">🏥 Health Check</div>
                <button class="btn btn-success" onclick="diagnosticsPage.healthCheck()">
                    Run Health Check
                </button>
                <div id="healthResult" class="mt-4"></div>
            </div>
        `;

        // Auto-load ports
        await this.scanPorts();
    }

    async scanPorts() {
        const resultEl = document.getElementById('portsResult');
        resultEl.innerHTML = '<div class="spinner"></div>';

        try {
            const data = await api.scanPorts();

            if (data.ports && data.ports.length > 0) {
                // Update motor port dropdown
                const portSelect = document.getElementById('motorPort');
                if (portSelect) {
                    portSelect.innerHTML = '<option value="">(Select port)</option>' +
                        data.ports.map(p => `<option value="${p.device}">${p.device}</option>`).join('');
                }

                resultEl.innerHTML = `
                    <table>
                        <thead>
                            <tr>
                                <th>Device</th>
                                <th>Description</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.ports.map(p => `
                                <tr>
                                    <td><code>${p.device}</code></td>
                                    <td>${p.description}</td>
                                    <td>
                                        <button class="btn btn-sm btn-primary"
                                                onclick="diagnosticsPage.testPort('${p.device}')">
                                            Test
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                resultEl.innerHTML = '<p>No serial ports found</p>';
            }
        } catch (error) {
            resultEl.innerHTML = `<p class="status-badge danger">Failed: ${error.message}</p>`;
        }
    }

    async testPort(port) {
        this.app.showNotification(`Testing ${port}...`, 'info');

        try {
            const result = await api.testPort(port);

            if (result.connected) {
                this.app.showNotification(`${port} connected successfully`, 'success');
            } else {
                this.app.showNotification(`${port} failed: ${result.error}`, 'danger');
            }
        } catch (error) {
            this.app.showNotification(`Test failed: ${error.message}`, 'danger');
        }
    }

    async scanMotors() {
        const port = document.getElementById('motorPort').value;

        if (!port) {
            this.app.showNotification('Please select a port', 'warning');
            return;
        }

        const resultEl = document.getElementById('motorsResult');
        resultEl.innerHTML = '<div class="spinner"></div>';

        try {
            const data = await api.scanMotors(port);

            if (data.motor_ids && data.motor_ids.length > 0) {
                resultEl.innerHTML = `
                    <div class="status-badge success mb-2">
                        Found ${data.found_count} motors
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.motor_ids.map(id => `
                                <tr>
                                    <td><strong>Motor ${id}</strong></td>
                                    <td><span class="status-badge success">Online</span></td>
                                    <td>
                                        <button class="btn btn-sm btn-primary"
                                                onclick="diagnosticsPage.getMotorDetails(${id})">
                                            Details
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                resultEl.innerHTML = '<p>No motors found</p>';
            }
        } catch (error) {
            resultEl.innerHTML = `<p class="status-badge danger">Scan failed: ${error.message}</p>`;
        }
    }

    async getMotorDetails(motorId) {
        this.app.showNotification(`Reading motor ${motorId} details...`, 'info');

        try {
            const data = await api.request(`/diagnostics/motor/${motorId}`, { method: 'GET' });

            // Show details in a modal/alert for now
            const details = `
Motor ${motorId}:
- Position: ${data.position}
- Temperature: ${data.temperature}°C
- Voltage: ${data.voltage}V
- Current: ${data.current}mA
- Error Code: ${data.error_code}
- Online: ${data.online}
            `;

            alert(details);
        } catch (error) {
            this.app.showNotification(`Failed to read: ${error.message}`, 'danger');
        }
    }

    async healthCheck() {
        const resultEl = document.getElementById('healthResult');
        resultEl.innerHTML = '<div class="spinner"></div>';

        try {
            const data = await api.healthCheck();

            const overallBadge = data.overall === 'healthy' ? 'success' :
                                data.overall === 'degraded' ? 'warning' : 'danger';

            resultEl.innerHTML = `
                <div class="status-badge ${overallBadge} mb-4">
                    Overall Status: ${data.overall.toUpperCase()}
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Check</th>
                            <th>Status</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.checks.map(check => {
                            const badge = check.status === 'pass' ? 'success' :
                                        check.status === 'warning' ? 'warning' : 'danger';
                            return `
                                <tr>
                                    <td><strong>${check.name}</strong></td>
                                    <td><span class="status-badge ${badge}">${check.status}</span></td>
                                    <td>${check.message}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        } catch (error) {
            resultEl.innerHTML = `<p class="status-badge danger">Health check failed: ${error.message}</p>`;
        }
    }
}

// Export instance
let diagnosticsPage = null;
