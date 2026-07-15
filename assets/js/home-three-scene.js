/*
 * Homepage Three.js environment
 * Light: robotics laboratory / Dark: neural network in deep space.
 *
 * Built with Three.js r160. The scene is decorative and deliberately uses
 * procedural geometry only, so the homepage has no model or texture requests.
 */
(function () {
    'use strict';

    let activeController = null;
    let waitingForMotionPreference = false;

    function markUnavailable(canvas) {
        document.documentElement.classList.remove('webgl-ready');
        document.documentElement.classList.add('webgl-unavailable');
        if (canvas) canvas.setAttribute('hidden', '');
    }

    function seededRandom(seed) {
        let state = seed >>> 0;
        return function () {
            state += 0x6D2B79F5;
            let value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    function initThreeBackground() {
        if (activeController) return activeController;

        const canvas = document.getElementById('neural-canvas');
        if (!canvas) return null;

        const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (motionQuery.matches) {
            document.documentElement.classList.add('webgl-reduced-motion');
            if (!waitingForMotionPreference) {
                waitingForMotionPreference = true;
                const resumeWhenAllowed = event => {
                    if (event.matches) return;
                    waitingForMotionPreference = false;
                    document.documentElement.classList.remove('webgl-reduced-motion');
                    if (typeof motionQuery.removeEventListener === 'function') {
                        motionQuery.removeEventListener('change', resumeWhenAllowed);
                    } else if (typeof motionQuery.removeListener === 'function') {
                        motionQuery.removeListener(resumeWhenAllowed);
                    }
                    initThreeBackground();
                };
                if (typeof motionQuery.addEventListener === 'function') {
                    motionQuery.addEventListener('change', resumeWhenAllowed);
                } else if (typeof motionQuery.addListener === 'function') {
                    motionQuery.addListener(resumeWhenAllowed);
                }
            }
            return null;
        }

        if (!window.THREE) {
            markUnavailable(canvas);
            return null;
        }

        const THREE = window.THREE;
        const html = document.documentElement;
        const random = seededRandom(23051996);
        const finePointerQuery = window.matchMedia('(pointer: fine)');
        const initialMobile = window.innerWidth < 768;
        const lowPowerDevice = initialMobile ||
            (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: !lowPowerDevice,
                powerPreference: lowPowerDevice ? 'low-power' : 'high-performance',
                premultipliedAlpha: true
            });
        } catch (error) {
            markUnavailable(canvas);
            return null;
        }

        canvas.removeAttribute('hidden');
        canvas.setAttribute('aria-hidden', 'true');
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, initialMobile ? 1.15 : 1.5));
        if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
            renderer.outputColorSpace = THREE.SRGBColorSpace;
        }
        if (THREE.ACESFilmicToneMapping) {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.08;
        }

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
        const labGroup = new THREE.Group();
        const spaceGroup = new THREE.Group();
        labGroup.name = 'Robotics laboratory';
        spaceGroup.name = 'Cosmic neural network';
        scene.add(labGroup, spaceGroup);

        const labMaterials = [];
        const spaceMaterials = [];
        const labRefs = {
            shoulder: null,
            elbow: null,
            wrist: null,
            clawLeft: null,
            clawRight: null,
            mobileRobot: null,
            mobileBaseX: 0,
            quadrupedBody: null,
            quadrupedLegs: [],
            statusLights: []
        };
        const spaceRefs = {
            farStars: null,
            nearStars: null,
            nebulae: [],
            network: null,
            nodes: [],
            nodeMesh: null,
            glowMesh: null,
            pulseMesh: null,
            pulses: [],
            dummy: new THREE.Object3D()
        };

        function registerMaterial(collection, material, baseOpacity, keepDepthWrite) {
            material.transparent = true;
            material.opacity = baseOpacity;
            material.userData.baseOpacity = baseOpacity;
            material.userData.keepDepthWrite = Boolean(keepDepthWrite);
            if (!keepDepthWrite) material.depthWrite = false;
            collection.push(material);
            return material;
        }

        function standardMaterial(color, options) {
            const settings = options || {};
            return registerMaterial(
                labMaterials,
                new THREE.MeshStandardMaterial({
                    color,
                    roughness: settings.roughness === undefined ? 0.46 : settings.roughness,
                    metalness: settings.metalness === undefined ? 0.14 : settings.metalness,
                    emissive: settings.emissive || 0x000000,
                    emissiveIntensity: settings.emissiveIntensity || 0
                }),
                settings.opacity === undefined ? 1 : settings.opacity,
                true
            );
        }

        function basicLabMaterial(color, opacity) {
            return registerMaterial(
                labMaterials,
                new THREE.MeshBasicMaterial({
                    color,
                    side: THREE.DoubleSide
                }),
                opacity,
                false
            );
        }

        function addBox(parent, dimensions, position, material, rotation) {
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(dimensions[0], dimensions[1], dimensions[2]),
                material
            );
            mesh.position.set(position[0], position[1], position[2]);
            if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
            parent.add(mesh);
            return mesh;
        }

        function addCylinder(parent, radii, height, position, material, rotation, segments) {
            const mesh = new THREE.Mesh(
                new THREE.CylinderGeometry(radii[0], radii[1], height, segments || 12),
                material
            );
            mesh.position.set(position[0], position[1], position[2]);
            if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
            parent.add(mesh);
            return mesh;
        }

        function addJoint(parent, radius, position, material) {
            const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), material);
            mesh.position.set(position[0], position[1], position[2]);
            parent.add(mesh);
            return mesh;
        }

        function addContactShadow(parent, radius, position, material) {
            const shadow = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), material);
            shadow.position.set(position[0], position[1], position[2]);
            shadow.rotation.x = -Math.PI / 2;
            parent.add(shadow);
            return shadow;
        }

        function buildLaboratory() {
            const shell = standardMaterial(0xdceae6, { roughness: 0.38, metalness: 0.18 });
            const shellSecondary = standardMaterial(0x9fc4bd, { roughness: 0.5, metalness: 0.08 });
            const structure = standardMaterial(0x294c48, { roughness: 0.42, metalness: 0.22 });
            const teal = standardMaterial(0x087f73, { roughness: 0.34, metalness: 0.2 });
            const orange = standardMaterial(0xdf6b25, {
                roughness: 0.35,
                metalness: 0.12,
                emissive: 0x7a2507,
                emissiveIntensity: 0.2
            });
            const rubber = standardMaterial(0x172d2c, { roughness: 0.82, metalness: 0.02 });
            const screen = basicLabMaterial(0x35b7aa, 0.7);
            const shadowMaterial = basicLabMaterial(0x294c48, 0.09);

            const hemisphere = new THREE.HemisphereLight(0xffffff, 0x9cbdb7, 1.7);
            const keyLight = new THREE.DirectionalLight(0xffffff, 2.25);
            keyLight.position.set(4, 8, 7);
            const fillLight = new THREE.PointLight(0x61d5c7, 0.85, 12);
            fillLight.position.set(-2.5, 3.5, 3.2);
            labGroup.add(hemisphere, keyLight, fillLight);

            const grid = new THREE.GridHelper(10.5, 21, 0x087f73, 0x7ca7a0);
            grid.position.set(0.2, 0, 0);
            registerMaterial(labMaterials, grid.material, 0.2, false);
            labGroup.add(grid);

            // A compact workbench gives the scene laboratory context without
            // enclosing the robots in another visual frame.
            const bench = new THREE.Group();
            bench.position.set(-0.45, 0, -2.05);
            addBox(bench, [2.7, 0.14, 0.85], [0, 1.08, 0], structure);
            addBox(bench, [0.12, 1.05, 0.12], [-1.12, 0.53, -0.27], structure);
            addBox(bench, [0.12, 1.05, 0.12], [1.12, 0.53, -0.27], structure);
            addBox(bench, [0.12, 1.05, 0.12], [-1.12, 0.53, 0.27], structure);
            addBox(bench, [0.12, 1.05, 0.12], [1.12, 0.53, 0.27], structure);
            addBox(bench, [0.92, 0.62, 0.09], [-0.38, 1.58, 0.02], structure);
            addBox(bench, [0.76, 0.46, 0.02], [-0.38, 1.58, 0.08], screen);
            addBox(bench, [0.12, 0.46, 0.12], [-0.38, 1.28, 0], structure);
            addBox(bench, [0.62, 0.07, 0.38], [-0.38, 1.08, 0], shellSecondary);
            addCylinder(bench, [0.08, 0.08], 0.2, [0.78, 1.23, 0.04], orange);
            labGroup.add(bench);

            // Autonomous mobile robot.
            const mobile = new THREE.Group();
            mobile.position.set(-2.35, 0, 0.58);
            labRefs.mobileRobot = mobile;
            labRefs.mobileBaseX = mobile.position.x;
            addBox(mobile, [1.38, 0.34, 0.88], [0, 0.34, 0], structure);
            addBox(mobile, [1.12, 0.16, 0.72], [0, 0.59, 0], shell);
            addBox(mobile, [0.28, 0.24, 0.58], [0.55, 0.42, 0], teal);
            [-0.43, 0.43].forEach(x => {
                [-0.49, 0.49].forEach(z => {
                    addCylinder(
                        mobile,
                        [0.22, 0.22],
                        0.13,
                        [x, 0.23, z],
                        rubber,
                        [Math.PI / 2, 0, 0],
                        14
                    );
                });
            });
            addCylinder(mobile, [0.08, 0.1], 0.55, [0, 0.9, 0], structure);
            addCylinder(mobile, [0.28, 0.28], 0.1, [0, 1.18, 0], teal, null, 18);
            addCylinder(mobile, [0.2, 0.24], 0.08, [0, 1.27, 0], shellSecondary, null, 18);
            addBox(mobile, [0.08, 0.14, 0.44], [0.7, 0.53, 0], orange);
            labRefs.statusLights.push(addJoint(mobile, 0.055, [0.72, 0.68, 0], orange));
            addContactShadow(labGroup, 1.02, [-2.35, 0.012, 0.58], shadowMaterial);
            labGroup.add(mobile);

            // Industrial articulated arm with an animated shoulder, elbow and gripper.
            const arm = new THREE.Group();
            arm.position.set(0.28, 0, 0.12);
            addCylinder(arm, [0.58, 0.66], 0.22, [0, 0.12, 0], structure, null, 18);
            addCylinder(arm, [0.39, 0.45], 0.42, [0, 0.43, 0], shellSecondary, null, 16);

            const shoulder = new THREE.Group();
            shoulder.position.set(0, 0.68, 0);
            shoulder.rotation.z = -0.38;
            addJoint(shoulder, 0.29, [0, 0, 0], orange);
            addBox(shoulder, [0.34, 1.42, 0.34], [0, 0.71, 0], shell);

            const elbow = new THREE.Group();
            elbow.position.set(0, 1.39, 0);
            elbow.rotation.z = 0.92;
            addJoint(elbow, 0.26, [0, 0, 0], teal);
            addBox(elbow, [0.29, 1.08, 0.29], [0, 0.54, 0], shellSecondary);

            const wrist = new THREE.Group();
            wrist.position.set(0, 1.03, 0);
            wrist.rotation.z = -0.54;
            addJoint(wrist, 0.21, [0, 0, 0], orange);
            addBox(wrist, [0.19, 0.52, 0.19], [0, 0.25, 0], structure);
            addBox(wrist, [0.48, 0.14, 0.32], [0, 0.55, 0], teal);
            const clawLeft = addBox(wrist, [0.11, 0.42, 0.13], [-0.18, 0.79, 0], structure);
            const clawRight = addBox(wrist, [0.11, 0.42, 0.13], [0.18, 0.79, 0], structure);

            elbow.add(wrist);
            shoulder.add(elbow);
            arm.add(shoulder);
            labGroup.add(arm);
            addContactShadow(labGroup, 0.78, [0.28, 0.014, 0.12], shadowMaterial);
            labRefs.shoulder = shoulder;
            labRefs.elbow = elbow;
            labRefs.wrist = wrist;
            labRefs.clawLeft = clawLeft;
            labRefs.clawRight = clawRight;
            labRefs.statusLights.push(addJoint(arm, 0.06, [0.32, 0.55, 0.34], orange));

            // A compact quadruped completes the set of visibly different robots.
            const quadruped = new THREE.Group();
            quadruped.position.set(2.55, 0, -0.32);
            const quadrupedBody = addBox(quadruped, [1.25, 0.46, 0.62], [0, 1.02, 0], shell);
            addBox(quadruped, [0.52, 0.38, 0.52], [0.83, 1.06, 0], structure);
            addBox(quadruped, [0.08, 0.12, 0.32], [1.1, 1.1, 0], teal);
            addJoint(quadruped, 0.055, [1.15, 1.17, 0.13], orange);
            addJoint(quadruped, 0.055, [1.15, 1.17, -0.13], orange);

            const legPositions = [
                [-0.43, 0.29, 0],
                [0.43, 0.29, Math.PI],
                [-0.43, -0.29, Math.PI],
                [0.43, -0.29, 0]
            ];
            legPositions.forEach((entry, index) => {
                const hip = new THREE.Group();
                hip.position.set(entry[0], 0.86, entry[1]);
                hip.rotation.z = index % 2 === 0 ? 0.12 : -0.12;
                addJoint(hip, 0.14, [0, 0, 0], teal);
                addBox(hip, [0.16, 0.44, 0.16], [0, -0.2, 0], structure);
                const knee = new THREE.Group();
                knee.position.set(0, -0.41, 0);
                knee.rotation.z = index % 2 === 0 ? -0.18 : 0.18;
                addJoint(knee, 0.11, [0, 0, 0], orange);
                addBox(knee, [0.14, 0.42, 0.14], [0, -0.19, 0], shellSecondary);
                addBox(knee, [0.32, 0.09, 0.2], [0.07, -0.41, 0], rubber);
                hip.add(knee);
                quadruped.add(hip);
                labRefs.quadrupedLegs.push({
                    hip,
                    knee,
                    hipBase: hip.rotation.z,
                    kneeBase: knee.rotation.z,
                    phase: entry[2]
                });
            });
            labGroup.add(quadruped);
            addContactShadow(labGroup, 1.08, [2.55, 0.012, -0.32], shadowMaterial);
            labRefs.quadrupedBody = quadrupedBody;
            labRefs.statusLights.push(quadruped.children[3], quadruped.children[4]);

            // Two small ceiling-like light strips float at the rear, suggesting
            // an active lab while avoiding a room outline or showcase border.
            addBox(labGroup, [1.9, 0.045, 0.16], [-1.3, 3.25, -2.25], screen, [0, 0, -0.04]);
            addBox(labGroup, [1.45, 0.045, 0.16], [1.3, 3.5, -2.15], screen, [0, 0, 0.06]);
        }

        function makePointCloud(count, spread, size, opacity, bright) {
            const positions = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);
            const palette = bright
                ? [new THREE.Color(0xffffff), new THREE.Color(0x67e8f9), new THREE.Color(0xc4b5fd)]
                : [new THREE.Color(0xa5b4fc), new THREE.Color(0x67e8f9), new THREE.Color(0xffffff)];

            for (let index = 0; index < count; index += 1) {
                const offset = index * 3;
                positions[offset] = (random() - 0.5) * spread[0];
                positions[offset + 1] = (random() - 0.5) * spread[1];
                positions[offset + 2] = (random() - 0.5) * spread[2] - 4;
                const color = palette[Math.floor(random() * palette.length)];
                colors[offset] = color.r;
                colors[offset + 1] = color.g;
                colors[offset + 2] = color.b;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            const material = registerMaterial(
                spaceMaterials,
                new THREE.PointsMaterial({
                    size,
                    sizeAttenuation: true,
                    vertexColors: true,
                    blending: THREE.AdditiveBlending
                }),
                opacity,
                false
            );
            return new THREE.Points(geometry, material);
        }

        function makeNebula(count, center, radius, color) {
            const positions = new Float32Array(count * 3);
            for (let index = 0; index < count; index += 1) {
                const offset = index * 3;
                const clusteredX = random() + random() + random() - 1.5;
                const clusteredY = random() + random() + random() - 1.5;
                const clusteredZ = random() + random() - 1;
                positions[offset] = center[0] + clusteredX * radius[0];
                positions[offset + 1] = center[1] + clusteredY * radius[1];
                positions[offset + 2] = center[2] + clusteredZ * radius[2];
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const material = registerMaterial(
                spaceMaterials,
                new THREE.PointsMaterial({
                    color,
                    size: 0.11,
                    sizeAttenuation: true,
                    blending: THREE.AdditiveBlending
                }),
                0.13,
                false
            );
            return new THREE.Points(geometry, material);
        }

        function buildNeuralNetwork() {
            const network = new THREE.Group();
            network.position.set(0.35, 0.28, 0);
            network.rotation.y = -0.18;
            spaceGroup.add(network);
            spaceRefs.network = network;

            const layerXs = [-2.55, -0.82, 0.9, 2.62];
            const layerCounts = [5, 8, 8, 4];
            const layers = [];
            const nodes = [];
            layerCounts.forEach((count, layerIndex) => {
                const layer = [];
                for (let nodeIndex = 0; nodeIndex < count; nodeIndex += 1) {
                    const y = (nodeIndex - (count - 1) / 2) * 0.52;
                    const node = {
                        position: new THREE.Vector3(
                            layerXs[layerIndex],
                            y + (random() - 0.5) * 0.12,
                            (random() - 0.5) * 0.92
                        ),
                        phase: random() * Math.PI * 2,
                        hub: (nodeIndex + layerIndex * 2) % 4 === 0,
                        color: (nodeIndex + layerIndex) % 3 === 0
                            ? new THREE.Color(0x67e8f9)
                            : new THREE.Color(0xa78bfa)
                    };
                    layer.push(node);
                    nodes.push(node);
                }
                layers.push(layer);
            });
            spaceRefs.nodes = nodes;

            const nodeGeometry = new THREE.IcosahedronGeometry(0.11, 1);
            const nodeMaterial = registerMaterial(
                spaceMaterials,
                new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    vertexColors: true,
                    blending: THREE.AdditiveBlending
                }),
                0.92,
                false
            );
            const glowMaterial = registerMaterial(
                spaceMaterials,
                new THREE.MeshBasicMaterial({
                    color: 0x8b5cf6,
                    blending: THREE.AdditiveBlending
                }),
                0.16,
                false
            );
            const nodeMesh = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, nodes.length);
            const glowMesh = new THREE.InstancedMesh(nodeGeometry, glowMaterial, nodes.length);
            nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            nodes.forEach((node, index) => nodeMesh.setColorAt(index, node.color));
            if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
            network.add(glowMesh, nodeMesh);
            spaceRefs.nodeMesh = nodeMesh;
            spaceRefs.glowMesh = glowMesh;

            const edges = [];
            for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
                layers[layerIndex].forEach((source, sourceIndex) => {
                    const candidates = layers[layerIndex + 1]
                        .map(target => ({
                            target,
                            distance: Math.abs(source.position.y - target.position.y) +
                                Math.abs(source.position.z - target.position.z) * 0.35
                        }))
                        .sort((a, b) => a.distance - b.distance);
                    const links = (sourceIndex + layerIndex) % 2 === 0 ? 3 : 2;
                    candidates.slice(0, links).forEach(candidate => {
                        edges.push({ start: source.position, end: candidate.target.position });
                    });
                });
            }

            const linePositions = new Float32Array(edges.length * 6);
            edges.forEach((edge, index) => {
                const offset = index * 6;
                linePositions[offset] = edge.start.x;
                linePositions[offset + 1] = edge.start.y;
                linePositions[offset + 2] = edge.start.z;
                linePositions[offset + 3] = edge.end.x;
                linePositions[offset + 4] = edge.end.y;
                linePositions[offset + 5] = edge.end.z;
            });
            const edgeGeometry = new THREE.BufferGeometry();
            edgeGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
            const edgeMaterial = registerMaterial(
                spaceMaterials,
                new THREE.LineBasicMaterial({
                    color: 0x67e8f9,
                    blending: THREE.AdditiveBlending
                }),
                0.3,
                false
            );
            network.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));

            const pulseCount = lowPowerDevice ? 5 : 8;
            const pulseMaterial = registerMaterial(
                spaceMaterials,
                new THREE.MeshBasicMaterial({
                    color: 0xf0f9ff,
                    blending: THREE.AdditiveBlending
                }),
                1,
                false
            );
            const pulseMesh = new THREE.InstancedMesh(
                new THREE.IcosahedronGeometry(0.055, 1),
                pulseMaterial,
                pulseCount
            );
            pulseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            network.add(pulseMesh);
            spaceRefs.pulseMesh = pulseMesh;
            for (let index = 0; index < pulseCount; index += 1) {
                spaceRefs.pulses.push({
                    edge: edges[Math.floor(random() * edges.length)],
                    offset: random(),
                    speed: 0.08 + random() * 0.08
                });
            }
        }

        function buildSpace() {
            const farCount = lowPowerDevice ? 320 : 760;
            const nearCount = lowPowerDevice ? 42 : 90;
            const farStars = makePointCloud(farCount, [21, 12, 22], 0.034, 0.72, false);
            const nearStars = makePointCloud(nearCount, [18, 10, 15], 0.075, 0.88, true);
            const violetNebula = makeNebula(
                lowPowerDevice ? 90 : 180,
                [-0.6, 1.15, -5],
                [2.8, 1.45, 2.4],
                0x8b5cf6
            );
            const cyanNebula = makeNebula(
                lowPowerDevice ? 65 : 130,
                [2.2, -1.2, -4],
                [2.2, 1.15, 2],
                0x22d3ee
            );
            spaceGroup.add(farStars, nearStars, violetNebula, cyanNebula);
            spaceRefs.farStars = farStars;
            spaceRefs.nearStars = nearStars;
            spaceRefs.nebulae.push(violetNebula, cyanNebula);
            buildNeuralNetwork();
        }

        buildLaboratory();
        buildSpace();

        let viewportWidth = 0;
        let viewportHeight = 0;
        let mobileLayout = initialMobile;
        let resizeFrame = null;
        const cameraBase = new THREE.Vector3();
        const cameraTarget = new THREE.Vector3();
        const pointerTarget = new THREE.Vector2();
        const pointerCurrent = new THREE.Vector2();

        function applyLayout() {
            viewportWidth = Math.max(1, window.innerWidth);
            viewportHeight = Math.max(1, window.innerHeight);
            mobileLayout = viewportWidth < 768;

            camera.aspect = viewportWidth / viewportHeight;
            camera.fov = mobileLayout ? 43 : 34;
            cameraBase.set(0, mobileLayout ? 3.6 : 3.75, mobileLayout ? 15.5 : 15);
            cameraTarget.set(0, mobileLayout ? 0.25 : 0.55, 0);
            camera.position.copy(cameraBase);
            camera.lookAt(cameraTarget);
            camera.updateProjectionMatrix();

            if (mobileLayout) {
                labGroup.position.set(0.35, -2.82, -2.65);
                labGroup.scale.setScalar(0.67);
                spaceGroup.position.set(0.15, -1.02, -3.1);
                spaceGroup.scale.setScalar(0.74);
            } else {
                labGroup.position.set(3.25, -1.64, -0.4);
                labGroup.scale.setScalar(1);
                spaceGroup.position.set(3.05, 0.05, -0.9);
                spaceGroup.scale.setScalar(1);
            }

            renderer.setPixelRatio(
                Math.min(window.devicePixelRatio || 1, mobileLayout ? 1.15 : 1.5)
            );
            renderer.setSize(viewportWidth, viewportHeight, false);
        }

        let themeMix = html.dataset.theme === 'dark' ? 1 : 0;
        let targetThemeMix = themeMix;

        function applyMaterialWeight(materials, weight) {
            materials.forEach(material => {
                material.opacity = material.userData.baseOpacity * weight;
                material.visible = weight > 0.008;
                if (material.userData.keepDepthWrite) {
                    material.depthWrite = weight > 0.985;
                }
            });
        }

        function applyThemeWeights() {
            const labWeight = 1 - themeMix;
            const spaceWeight = themeMix;
            labGroup.visible = labWeight > 0.008;
            spaceGroup.visible = spaceWeight > 0.008;
            applyMaterialWeight(labMaterials, labWeight);
            applyMaterialWeight(spaceMaterials, spaceWeight);
            renderer.toneMappingExposure = 1.02 + labWeight * 0.1;
        }

        function setTheme(theme, immediate) {
            targetThemeMix = theme === 'dark' ? 1 : 0;
            if (immediate) themeMix = targetThemeMix;
            applyThemeWeights();
            if (document.hidden) renderFrame(performance.now(), 0);
        }

        function updateLaboratory(time) {
            const shoulderMotion = Math.sin(time * 0.44);
            const elbowMotion = Math.sin(time * 0.57 + 1.1);
            if (labRefs.shoulder) labRefs.shoulder.rotation.z = -0.38 + shoulderMotion * 0.11;
            if (labRefs.elbow) labRefs.elbow.rotation.z = 0.92 + elbowMotion * 0.15;
            if (labRefs.wrist) {
                labRefs.wrist.rotation.z = -0.54 + Math.sin(time * 0.66 + 2.1) * 0.08;
                labRefs.wrist.rotation.y = Math.sin(time * 0.35) * 0.16;
            }
            const grip = 0.035 + (Math.sin(time * 0.78) + 1) * 0.018;
            if (labRefs.clawLeft) labRefs.clawLeft.position.x = -0.18 - grip;
            if (labRefs.clawRight) labRefs.clawRight.position.x = 0.18 + grip;
            if (labRefs.mobileRobot) {
                labRefs.mobileRobot.position.x =
                    labRefs.mobileBaseX + Math.sin(time * 0.28) * 0.18;
                labRefs.mobileRobot.rotation.y = Math.sin(time * 0.2) * 0.025;
            }
            if (labRefs.quadrupedBody) {
                labRefs.quadrupedBody.position.y = 1.02 + Math.sin(time * 1.05) * 0.025;
            }
            labRefs.quadrupedLegs.forEach((leg, index) => {
                const idle = Math.sin(time * 0.72 + leg.phase + index * 0.4);
                leg.hip.rotation.z = leg.hipBase + idle * 0.035;
                leg.knee.rotation.z = leg.kneeBase - idle * 0.025;
            });
            labRefs.statusLights.forEach((light, index) => {
                if (!light || !light.scale) return;
                const pulse = 0.9 + Math.sin(time * 1.65 + index * 1.7) * 0.1;
                light.scale.setScalar(pulse);
            });
        }

        function updateSpace(time) {
            if (spaceRefs.farStars) spaceRefs.farStars.rotation.y = time * 0.002;
            if (spaceRefs.nearStars) {
                spaceRefs.nearStars.rotation.y = -time * 0.004;
                spaceRefs.nearStars.rotation.x = Math.sin(time * 0.025) * 0.02;
            }
            spaceRefs.nebulae.forEach((nebula, index) => {
                nebula.rotation.z = (index === 0 ? 1 : -1) * time * 0.006;
            });
            if (spaceRefs.network) {
                spaceRefs.network.rotation.y = -0.18 + Math.sin(time * 0.12) * 0.08;
                spaceRefs.network.rotation.x = Math.sin(time * 0.09) * 0.025;
            }

            const dummy = spaceRefs.dummy;
            spaceRefs.nodes.forEach((node, index) => {
                const pulse = node.hub
                    ? 1 + Math.sin(time * 1.35 + node.phase) * 0.14
                    : 1 + Math.sin(time * 0.7 + node.phase) * 0.025;
                dummy.position.copy(node.position);
                dummy.rotation.set(0, time * 0.12 + node.phase, 0);
                dummy.scale.setScalar(pulse);
                dummy.updateMatrix();
                spaceRefs.nodeMesh.setMatrixAt(index, dummy.matrix);
                dummy.scale.setScalar(pulse * (node.hub ? 2.05 : 1.62));
                dummy.updateMatrix();
                spaceRefs.glowMesh.setMatrixAt(index, dummy.matrix);
            });
            spaceRefs.nodeMesh.instanceMatrix.needsUpdate = true;
            spaceRefs.glowMesh.instanceMatrix.needsUpdate = true;

            spaceRefs.pulses.forEach((pulse, index) => {
                const progress = (pulse.offset + time * pulse.speed) % 1;
                dummy.position.lerpVectors(pulse.edge.start, pulse.edge.end, progress);
                const pulseScale = 0.78 + Math.sin(progress * Math.PI) * 0.55;
                dummy.scale.setScalar(pulseScale);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                spaceRefs.pulseMesh.setMatrixAt(index, dummy.matrix);
            });
            spaceRefs.pulseMesh.instanceMatrix.needsUpdate = true;
        }

        function renderFrame(now, deltaSeconds) {
            const time = now * 0.001;
            if (Math.abs(themeMix - targetThemeMix) > 0.001) {
                const smoothing = 1 - Math.exp(-Math.max(deltaSeconds, 1 / 60) * 5.4);
                themeMix += (targetThemeMix - themeMix) * smoothing;
                if (Math.abs(themeMix - targetThemeMix) < 0.002) themeMix = targetThemeMix;
                applyThemeWeights();
            }

            if (labGroup.visible) updateLaboratory(time);
            if (spaceGroup.visible) updateSpace(time);

            pointerCurrent.lerp(pointerTarget, 1 - Math.exp(-Math.max(deltaSeconds, 1 / 60) * 3.8));
            camera.position.set(
                cameraBase.x + pointerCurrent.x,
                cameraBase.y + pointerCurrent.y,
                cameraBase.z
            );
            camera.lookAt(cameraTarget);
            renderer.render(scene, camera);
        }

        let animationFrame = null;
        let lastPresentedAt = 0;

        function animate(now) {
            animationFrame = window.requestAnimationFrame(animate);
            const frameInterval = mobileLayout ? 1000 / 30 : 1000 / 45;
            if (lastPresentedAt && now - lastPresentedAt < frameInterval) return;
            const deltaSeconds = lastPresentedAt
                ? Math.min((now - lastPresentedAt) / 1000, 0.08)
                : 1 / 45;
            lastPresentedAt = now;
            renderFrame(now, deltaSeconds);
        }

        function stopAnimation() {
            if (animationFrame !== null) {
                window.cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
        }

        function startAnimation() {
            if (animationFrame !== null || document.hidden || motionQuery.matches) return;
            lastPresentedAt = 0;
            animationFrame = window.requestAnimationFrame(animate);
        }

        function handlePointerMove(event) {
            if (!finePointerQuery.matches || mobileLayout) return;
            pointerTarget.x = (event.clientX / viewportWidth - 0.5) * 0.34;
            pointerTarget.y = -(event.clientY / viewportHeight - 0.5) * 0.18;
        }

        function resetPointer() {
            pointerTarget.set(0, 0);
        }

        function handleResize() {
            if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => {
                resizeFrame = null;
                applyLayout();
                renderFrame(performance.now(), 1 / 60);
            });
        }

        function handleThemeChange(event) {
            const theme = event.detail && event.detail.theme
                ? event.detail.theme
                : html.dataset.theme;
            setTheme(theme, false);
        }

        function handleVisibilityChange() {
            if (document.hidden) {
                stopAnimation();
            } else {
                startAnimation();
            }
        }

        function handleMotionPreferenceChange(event) {
            html.classList.toggle('webgl-reduced-motion', event.matches);
            if (event.matches) {
                stopAnimation();
            } else {
                startAnimation();
            }
        }

        function handleContextLost(event) {
            event.preventDefault();
            stopAnimation();
            markUnavailable(canvas);
        }

        function handleContextRestored() {
            canvas.removeAttribute('hidden');
            html.classList.remove('webgl-unavailable');
            html.classList.add('webgl-ready');
            applyLayout();
            renderFrame(performance.now(), 1 / 60);
            startAnimation();
        }

        function disposeScene() {
            stopAnimation();
            if (resizeFrame !== null) {
                window.cancelAnimationFrame(resizeFrame);
                resizeFrame = null;
            }
            const geometries = new Set();
            const materials = new Set();
            scene.traverse(object => {
                if (object.geometry) geometries.add(object.geometry);
                if (object.material) {
                    const objectMaterials = Array.isArray(object.material)
                        ? object.material
                        : [object.material];
                    objectMaterials.forEach(material => materials.add(material));
                }
            });
            geometries.forEach(geometry => geometry.dispose());
            materials.forEach(material => material.dispose());
            renderer.dispose();
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('blur', resetPointer);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('themechange', handleThemeChange);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (typeof motionQuery.removeEventListener === 'function') {
                motionQuery.removeEventListener('change', handleMotionPreferenceChange);
            } else if (typeof motionQuery.removeListener === 'function') {
                motionQuery.removeListener(handleMotionPreferenceChange);
            }
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
            html.classList.remove('webgl-ready', 'webgl-reduced-motion');
            activeController = null;
        }

        window.addEventListener('pointermove', handlePointerMove, { passive: true });
        window.addEventListener('blur', resetPointer);
        window.addEventListener('resize', handleResize, { passive: true });
        window.addEventListener('themechange', handleThemeChange);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        if (typeof motionQuery.addEventListener === 'function') {
            motionQuery.addEventListener('change', handleMotionPreferenceChange);
        } else if (typeof motionQuery.addListener === 'function') {
            motionQuery.addListener(handleMotionPreferenceChange);
        }
        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);

        applyLayout();
        setTheme(html.dataset.theme, true);
        renderFrame(performance.now(), 1 / 60);
        html.classList.remove('webgl-unavailable', 'webgl-reduced-motion');
        html.classList.add('webgl-ready');
        startAnimation();

        activeController = {
            dispose: disposeScene,
            render: () => renderFrame(performance.now(), 1 / 60),
            setTheme
        };
        return activeController;
    }

    window.initThreeBackground = initThreeBackground;
}());
