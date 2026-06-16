// Calibration Page Module
class CalibrationPage {
    constructor(app) {
        this.app = app;
        this.session = null;
        this.currentPositions = {};
        this.pollInterval = null;
    }

    async render(container) {
        container.innerHTML = `
            <div class="card">
                <div class="card-title">⚙️ Calibration Wizard</div>
                <div id="calibrationContent">
                    <div id="calibrationStart">
                        <p>校准可以让机器人精确知道每个关节的运动范围。</p>
                        <div class="form-group">
                            <label class="form-label">Select Arm:</label>
                            <select id="calibArm" class="form-select">
                                <option value="right">Right Arm</option>
                                <option value="left">Left Arm</option>
                            </select>
                        </div>
                        <button class="btn btn-primary" onclick="calibrationPage.startCalibration()">
                            Start Calibration
                        </button>
                    </div>
                    <div id="calibrationProgress" class="hidden">
                        <div class="progress-bar mb-4">
                            <div id="calibProgressBar" class="progress-fill" style="width: 0%"></div>
                        </div>
                        <div id="calibrationStep"></div>
                        <div id="calibrationPositions" class="mt-4"></div>
                        <div class="flex gap-2 mt-4">
                            <button class="btn btn-success" onclick="calibrationPage.recordStep()">
                                Record Position
                            </button>
                            <button class="btn btn-warning" onclick="calibrationPage.skipJoint()">
                                Skip Joint
                            </button>
                            <button class="btn btn-danger" onclick="calibrationPage.cancelCalibration()">
                                Cancel
                            </button>
                        </div>
                    </div>
                    <div id="calibrationComplete" class="hidden">
                        <div class="text-center">
                            <h3>✅ Calibration Complete!</h3>
                            <p class="mt-2">Results have been saved.</p>
                            <button class="btn btn-primary" onclick="calibrationPage.reset()">
                                New Calibration
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async startCalibration() {
        const arm = document.getElementById('calibArm').value;

        try {
            const result = await api.startCalibration(arm);
            this.session = result;

            // Show progress view
            document.getElementById('calibrationStart').classList.add('hidden');
            document.getElementById('calibrationProgress').classList.remove('hidden');

            // Update UI
            this.updateProgress();

            // Start polling positions
            this.startPositionPolling();

            this.app.showNotification(`Started calibration for ${arm} arm`, 'success');
        } catch (error) {
            this.app.showNotification(`Failed to start: ${error.message}`, 'danger');
        }
    }

    async updateProgress() {
        if (!this.session) return;

        try {
            const status = await api.getCalibrationStatus();

            if (!status.active) {
                this.stopPositionPolling();
                return;
            }

            this.session = status;

            // Update progress bar
            const progress = (status.current_step_index / status.total_steps) * 100;
            document.getElementById('calibProgressBar').style.width = `${progress}%`;

            // Update step instructions
            const stepEl = document.getElementById('calibrationStep');
            if (status.current_step) {
                stepEl.innerHTML = `
                    <div class="card">
                        <h4>Step ${status.current_step.step_number} / ${status.total_steps}</h4>
                        <p><strong>Joint ${status.current_step.joint_id}</strong> (${status.current_step.joint_name})</p>
                        <p><strong>Limit:</strong> ${status.current_step.limit_type === 'min' ? 'Minimum' : 'Maximum'}</p>
                        <p class="mt-2">${status.instructions}</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Failed to update progress:', error);
        }
    }

    startPositionPolling() {
        this.stopPositionPolling();

        this.pollInterval = setInterval(async () => {
            try {
                const data = await api.getCurrentPositions();
                this.currentPositions = data.positions;
                this.updatePositionsDisplay();
            } catch (error) {
                console.error('Failed to poll positions:', error);
            }
        }, 200); // Poll every 200ms
    }

    stopPositionPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    updatePositionsDisplay() {
        const posEl = document.getElementById('calibrationPositions');
        if (!posEl) return;

        const positions = Object.entries(this.currentPositions)
            .map(([jointId, pos]) => {
                const isCurrent = this.session?.current_step?.joint_id === parseInt(jointId);
                return `
                    <div class="flex-between mb-2 ${isCurrent ? 'status-badge info' : ''}">
                        <span>Joint ${jointId}:</span>
                        <strong>${pos}</strong>
                    </div>
                `;
            }).join('');

        posEl.innerHTML = `
            <div class="card">
                <div class="card-title">Current Positions (Raw)</div>
                ${positions}
            </div>
        `;
    }

    async recordStep() {
        if (!this.session?.current_step) {
            this.app.showNotification('No active step', 'warning');
            return;
        }

        const step = this.session.current_step;
        const rawPosition = this.currentPositions[step.joint_id];

        if (rawPosition === undefined) {
            this.app.showNotification('Position not available', 'warning');
            return;
        }

        try {
            const result = await api.recordCalibrationStep(
                step.joint_id,
                step.limit_type,
                rawPosition
            );

            this.app.showNotification(`Recorded ${step.limit_type} limit: ${rawPosition}`, 'success');

            if (result.status === 'completed') {
                // Calibration complete
                await this.saveCalibration();
            } else {
                // Move to next step
                await this.updateProgress();
            }
        } catch (error) {
            this.app.showNotification(`Failed to record: ${error.message}`, 'danger');
        }
    }

    async skipJoint() {
        // TODO: Implement skip functionality
        this.app.showNotification('Skip not yet implemented', 'warning');
    }

    async saveCalibration() {
        try {
            const result = await api.saveCalibration();

            this.stopPositionPolling();

            // Show complete view
            document.getElementById('calibrationProgress').classList.add('hidden');
            document.getElementById('calibrationComplete').classList.remove('hidden');

            this.app.showNotification('Calibration saved successfully!', 'success');
        } catch (error) {
            this.app.showNotification(`Failed to save: ${error.message}`, 'danger');
        }
    }

    async cancelCalibration() {
        if (!confirm('Cancel calibration? All progress will be lost.')) return;

        try {
            await api.cancelCalibration();
            this.stopPositionPolling();
            this.reset();
            this.app.showNotification('Calibration cancelled', 'warning');
        } catch (error) {
            this.app.showNotification(`Failed to cancel: ${error.message}`, 'danger');
        }
    }

    reset() {
        this.session = null;
        this.stopPositionPolling();

        // Show start view
        document.getElementById('calibrationStart').classList.remove('hidden');
        document.getElementById('calibrationProgress').classList.add('hidden');
        document.getElementById('calibrationComplete').classList.add('hidden');
    }

    cleanup() {
        this.stopPositionPolling();
    }
}

// Export instance
let calibrationPage = null;
