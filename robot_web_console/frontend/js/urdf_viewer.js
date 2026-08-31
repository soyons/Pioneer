/* Interactive URDF viewer for the Jog page. */
class UrdfViewer {
    constructor(container) {
        this.container = container;
        this.root = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.models = new Map();
        this.joints = new Map();
        this.jointValues = new Map();
        this.animationFrame = null;
        this.resizeObserver = null;
        this.showJointAxes = false;
        this.destroyed = false;
        this.armColors = { left_arm: 0x4f8cff, right_arm: 0xff6b6b };
    }

    async init() {
        if (typeof THREE === 'undefined') {
            throw new Error('Three.js 加载失败');
        }
        if (!THREE.WebGLRenderer) {
            throw new Error('当前浏览器不支持 WebGL');
        }
        this.renderShell();
        this.setupScene();
        const description = await api.getRobotModel();
        if (!description.arms?.length) {
            throw new Error('Controller 未提供 URDF 模型');
        }
        for (const model of description.arms) this.addModel(model);
        this.renderModelMeta(description);
        this.animate();
    }

    renderShell() {
        this.container.innerHTML = `
            <div class="urdf-toolbar">
                <span id="jogUrdfModelMeta" class="status-meta">Loading model...</span>
                <div class="urdf-toolbar-actions">
                    <label class="urdf-axis-toggle">
                        <input id="jogUrdfShowAxes" type="checkbox"> Joint axes
                    </label>
                    <button id="jogUrdfResetView" class="btn btn-sm btn-secondary">Reset View</button>
                </div>
            </div>
            <div id="jogUrdfCanvas" class="urdf-canvas"></div>
            <div id="jogUrdfStatus" class="urdf-status status-meta">Loading URDF...</div>
        `;
        this.container.querySelector('#jogUrdfResetView').addEventListener('click', () => this.resetView());
        this.container.querySelector('#jogUrdfShowAxes').addEventListener('change', (event) => {
            this.showJointAxes = event.target.checked;
            this.joints.forEach(item => {
                item.axisHelper.visible = this.showJointAxes;
                item.axisArrow.visible = this.showJointAxes;
            });
        });
    }

    setupScene() {
        const host = this.container.querySelector('#jogUrdfCanvas');
        const width = Math.max(host.clientWidth, 320);
        const height = Math.max(host.clientHeight, 420);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111827);
        this.root = new THREE.Group();
        this.scene.add(this.root);

        this.camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 100);
        this.camera.up.set(0, 0, 1);
        this.camera.position.set(0.8, -0.8, 0.6);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(width, height);
        host.appendChild(this.renderer.domElement);

        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.3));
        const light = new THREE.DirectionalLight(0xffffff, 1.4);
        light.position.set(2, -3, 4);
        this.scene.add(light);
        const grid = new THREE.GridHelper(2, 20, 0x475569, 0x263244);
        grid.rotation.x = Math.PI / 2;
        this.scene.add(grid);
        this.scene.add(new THREE.AxesHelper(0.25));

        if (THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.target.set(0, 0, 0.25);
        }

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(host);
    }

    resize() {
        if (!this.renderer || !this.camera || this.destroyed) return;
        const host = this.container.querySelector('#jogUrdfCanvas');
        if (!host) return;
        const width = Math.max(host.clientWidth, 320);
        const height = Math.max(host.clientHeight, 420);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    static rpyQuaternion(rpy) {
        const [roll = 0, pitch = 0, yaw = 0] = rpy || [];
        // URDF rpy uses fixed-axis rotations: R = Rz(yaw) * Ry(pitch) * Rx(roll).
        return new THREE.Quaternion().setFromEuler(
            new THREE.Euler(roll, pitch, yaw, 'ZYX')
        );
    }

    material(color, transparent = false) {
        return new THREE.MeshStandardMaterial({
            color,
            roughness: 0.65,
            metalness: 0.12,
            transparent,
            opacity: transparent ? 0.72 : 1,
        });
    }

    geometryForVisual(visual, color) {
        if (!visual) return null;
        let geometry = null;
        if (visual.type === 'box') {
            const size = visual.size || [0.03, 0.03, 0.03];
            geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
        } else if (visual.type === 'cylinder') {
            geometry = new THREE.CylinderGeometry(
                visual.radius || 0.01,
                visual.radius || 0.01,
                visual.length || 0.05,
                16
            );
            geometry.rotateX(Math.PI / 2);
        } else if (visual.type === 'sphere') {
            geometry = new THREE.SphereGeometry(visual.radius || 0.02, 16, 10);
        }
        if (!geometry) return null;

        const rgba = visual.rgba || [];
        const material = rgba.length >= 3
            ? new THREE.MeshStandardMaterial({
                color: new THREE.Color(rgba[0], rgba[1], rgba[2]),
                opacity: rgba[3] ?? 1,
                transparent: (rgba[3] ?? 1) < 1,
            })
            : this.material(color);
        const mesh = new THREE.Mesh(geometry, material);
        const origin = visual.origin || {};
        mesh.position.fromArray(origin.xyz || [0, 0, 0]);
        mesh.quaternion.copy(UrdfViewer.rpyQuaternion(origin.rpy));
        return mesh;
    }

    fallbackForLink(outgoing, color) {
        const group = new THREE.Group();
        const end = outgoing?.origin?.xyz || [0, 0, 0];
        const vector = new THREE.Vector3(end[0], end[1], end[2]);
        const length = Math.max(vector.length(), 0.035);
        const geometry = new THREE.CylinderGeometry(0.018, 0.018, length, 12);
        const mesh = new THREE.Mesh(geometry, this.material(color));
        mesh.position.copy(vector).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            vector.length() ? vector.normalize() : new THREE.Vector3(0, 1, 0)
        );
        group.add(mesh);
        group.add(new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), this.material(0xfbbf24)));
        return group;
    }

    addModel(model) {
        const color = this.armColors[model.arm] || 0x8b5cf6;
        const modelRoot = new THREE.Group();
        modelRoot.name = model.arm;
        modelRoot.userData.jointNames = model.joint_names || [];
        this.root.add(modelRoot);
        this.models.set(model.arm, modelRoot);

        const links = new Map((model.links || []).map(link => [link.name, link]));
        const outgoing = new Map();
        for (const joint of model.joints || []) outgoing.set(joint.parent, joint);
        const linkGroups = new Map();
        for (const link of model.links || []) linkGroups.set(link.name, new THREE.Group());

        const base = linkGroups.get(model.base_link) || new THREE.Group();
        modelRoot.add(base);
        const baseVisual = this.geometryForVisual(links.get(model.base_link)?.visual, color)
            || this.fallbackForLink(outgoing.get(model.base_link), color);
        base.add(baseVisual);

        for (const joint of model.joints || []) {
            const parent = linkGroups.get(joint.parent);
            const child = linkGroups.get(joint.child);
            if (!parent || !child) continue;

            const jointGroup = new THREE.Group();
            jointGroup.name = joint.name;
            jointGroup.position.fromArray(joint.origin?.xyz || [0, 0, 0]);
            jointGroup.quaternion.copy(UrdfViewer.rpyQuaternion(joint.origin?.rpy));
            parent.add(jointGroup);
            jointGroup.add(child);

            const axis = new THREE.Vector3(...(joint.axis || [0, 0, 1])).normalize();
            const axisHelper = new THREE.AxesHelper(0.12);
            axisHelper.visible = this.showJointAxes;
            const axisArrow = new THREE.ArrowHelper(
                axis,
                new THREE.Vector3(0, 0, 0),
                0.12,
                0xfacc15,
                0.025,
                0.014
            );
            axisArrow.visible = this.showJointAxes;
            jointGroup.add(axisHelper);
            jointGroup.add(axisArrow);
            this.joints.set(`${model.arm}:${joint.name}`, {
                group: jointGroup,
                joint,
                axis,
                axisHelper,
                axisArrow,
            });

            const visual = this.geometryForVisual(links.get(joint.child)?.visual, color)
                || this.fallbackForLink(outgoing.get(joint.child), color);
            child.add(visual);
        }
        this.fitCamera();
    }

    renderModelMeta(description) {
        const models = description.arms || [];
        const meta = this.container.querySelector('#jogUrdfModelMeta');
        const meshFallback = models.some(model => model.has_meshes) ? ' · mesh fallback' : '';
        meta.textContent = `${description.robot_type || 'robot'} · ${models.map(model => model.arm).join(', ')}${meshFallback}`;
        this.setStatus('URDF loaded · waiting for robot state', 'waiting');
    }

    updateState(state) {
        if (this.destroyed) return false;
        const entries = Object.entries(state?.joints || {});
        const connectedMap = state?.connected || {};
        let updated = false;
        let activeArm = null;

        for (const [arm, positions] of entries) {
            const model = this.models.get(arm);
            if (!model || !Array.isArray(positions)) continue;
            const jointNames = model.userData.jointNames || [];
            if (positions.length !== jointNames.length || !positions.every(Number.isFinite)) continue;
            positions.forEach((value, index) => this.setJoint(arm, jointNames[index], value));
            activeArm = arm;
            updated = true;
        }

        if (!updated) {
            this.setStatus('模型已加载 · 机器人关节状态不可用', 'error');
            return false;
        }

        const connected = activeArm ? Boolean(connectedMap[activeArm]) : false;
        const time = state.timestamp
            ? new Date(state.timestamp * 1000).toLocaleTimeString()
            : new Date().toLocaleTimeString();
        this.setStatus(
            `${connected ? '● Connected' : '○ Disconnected'} · ${activeArm} · Updated ${time}`,
            connected ? 'connected' : 'disconnected'
        );
        return connected;
    }

    setStatus(message, state = 'waiting') {
        const status = this.container.querySelector('#jogUrdfStatus');
        if (!status) return;
        status.textContent = message;
        status.dataset.state = state;
    }

    setJoint(arm, name, position) {
        const item = this.joints.get(`${arm}:${name}`);
        if (!item) return;
        const { joint, group, axis } = item;
        this.jointValues.set(`${arm}:${name}`, position);
        group.position.fromArray(joint.origin?.xyz || [0, 0, 0]);
        group.quaternion.copy(UrdfViewer.rpyQuaternion(joint.origin?.rpy));
        if (joint.type === 'prismatic') {
            group.translateOnAxis(axis, position);
        } else if (joint.type === 'revolute' || joint.type === 'continuous') {
            group.rotateOnAxis(axis, position);
        }
    }

    fitCamera() {
        if (!this.root || !this.camera) return;
        const box = new THREE.Box3().setFromObject(this.root);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() * 0.8, 0.5);
        this.camera.position.copy(center).add(new THREE.Vector3(radius, -radius, radius * 0.75));
        if (this.controls) this.controls.target.copy(center);
        this.camera.lookAt(center);
    }

    resetView() {
        this.fitCamera();
    }

    animate() {
        if (!this.renderer || this.destroyed) return;
        this.animationFrame = requestAnimationFrame(() => this.animate());
        if (this.controls) this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    disposeMaterial(material) {
        if (!material) return;
        const materials = Array.isArray(material) ? material : [material];
        materials.forEach(item => {
            Object.values(item).forEach(value => {
                if (value?.isTexture) value.dispose();
            });
            item.dispose();
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.controls?.dispose) this.controls.dispose();
        if (this.root) {
            this.root.traverse(object => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) this.disposeMaterial(object.material);
            });
        }
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }
        this.models.clear();
        this.joints.clear();
        this.jointValues.clear();
    }
}
