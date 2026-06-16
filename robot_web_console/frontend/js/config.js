// Config Page Module
class ConfigPage {
    constructor(app) {
        this.app = app;
        this.config = null;
        this.editMode = false;
    }

    async render(container) {
        container.innerHTML = `
            <div class="card">
                <div class="card-title flex-between">
                    <span>⚙️ Configuration</span>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-primary" onclick="configPage.toggleEdit()" id="editBtn">
                            Edit
                        </button>
                        <button class="btn btn-sm btn-warning" onclick="configPage.reloadConfig()">
                            Reload
                        </button>
                        <button class="btn btn-sm btn-success hidden" onclick="configPage.saveConfig()" id="saveBtn">
                            Save
                        </button>
                    </div>
                </div>
                <div id="configContent">Loading...</div>
            </div>

            <div class="card mt-4">
                <div class="card-title">Quick Actions</div>
                <div class="flex gap-2">
                    <button class="btn btn-primary" onclick="configPage.viewSection('robot')">
                        Robot Config
                    </button>
                    <button class="btn btn-primary" onclick="configPage.viewSection('api')">
                        API Config
                    </button>
                    <button class="btn btn-primary" onclick="configPage.viewSection('controller')">
                        Controller Config
                    </button>
                </div>
            </div>
        `;

        await this.loadConfig();
    }

    async loadConfig() {
        const contentEl = document.getElementById('configContent');
        contentEl.innerHTML = '<div class="spinner"></div>';

        try {
            this.config = await api.getConfig();
            this.displayConfig();
        } catch (error) {
            contentEl.innerHTML = `<p class="status-badge danger">Failed to load: ${error.message}</p>`;
        }
    }

    displayConfig() {
        const contentEl = document.getElementById('configContent');

        if (this.editMode) {
            contentEl.innerHTML = `
                <textarea id="configEditor" class="form-input" rows="20" style="font-family: monospace;">
${JSON.stringify(this.config, null, 2)}
                </textarea>
            `;
        } else {
            contentEl.innerHTML = `
                <pre style="background: var(--bg-color); padding: 16px; border-radius: 8px; overflow-x: auto; max-height: 600px;">
${JSON.stringify(this.config, null, 2)}
                </pre>
            `;
        }
    }

    toggleEdit() {
        this.editMode = !this.editMode;

        const editBtn = document.getElementById('editBtn');
        const saveBtn = document.getElementById('saveBtn');

        if (this.editMode) {
            editBtn.textContent = 'Cancel';
            editBtn.className = 'btn btn-sm btn-danger';
            saveBtn.classList.remove('hidden');
        } else {
            editBtn.textContent = 'Edit';
            editBtn.className = 'btn btn-sm btn-primary';
            saveBtn.classList.add('hidden');
        }

        this.displayConfig();
    }

    async saveConfig() {
        const editor = document.getElementById('configEditor');

        if (!editor) return;

        try {
            const newConfig = JSON.parse(editor.value);

            // Update each section
            for (const [section, data] of Object.entries(newConfig)) {
                await api.updateConfig(section, data);
            }

            this.config = newConfig;
            this.toggleEdit();

            this.app.showNotification('Configuration saved successfully', 'success');
        } catch (error) {
            this.app.showNotification(`Save failed: ${error.message}`, 'danger');
        }
    }

    async reloadConfig() {
        try {
            await api.reloadConfig();
            await this.loadConfig();
            this.app.showNotification('Configuration reloaded', 'success');
        } catch (error) {
            this.app.showNotification(`Reload failed: ${error.message}`, 'danger');
        }
    }

    async viewSection(section) {
        try {
            const data = await api.getConfigSection(section);

            const contentEl = document.getElementById('configContent');
            contentEl.innerHTML = `
                <h4>${section} Configuration</h4>
                <pre style="background: var(--bg-color); padding: 16px; border-radius: 8px; overflow-x: auto;">
${JSON.stringify(data.data, null, 2)}
                </pre>
                <button class="btn btn-primary mt-2" onclick="configPage.loadConfig()">
                    Back to Full Config
                </button>
            `;
        } catch (error) {
            this.app.showNotification(`Failed to load section: ${error.message}`, 'danger');
        }
    }
}

// Export instance
let configPage = null;
