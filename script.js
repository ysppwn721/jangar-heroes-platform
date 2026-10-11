// ==================== 英雄数据 ====================
const heroesData = [{
    id: 1,
    name: "江格尔",
    title: "圣主可汗",
    type: "hidden",
    rarity: "1%",
    height: "8cm",
    material: "环保PVC+金属漆",
    description: "宝木巴圣地的守护者，十二英雄的领袖，蒙古族人民心中'团结、正义、守护'的精神象征。",
    features: ["传统蒙古袍云纹刺绣", "蒙古族传统盔帽设计", "松石腰带细节", "圣主权杖配件", "专属宝座底座", "可拆卸披风设计"],
    modelPath: "models/jiangger.glb",
    image: "images/hero-jiangger.jpg",
    thumb: "images/hero-jiangger-thumb.jpg"
}, {
    id: 2,
    name: "哈日尼敦",
    title: "牧马英雄",
    type: "hidden",
    rarity: "1%",
    height: "9cm",
    material: "环保PVC+皮革质感",
    description: "骑术精湛、箭法如神，草原上最懂马语的勇士。",
    features: ["骑乘造型设计", "骏马动态姿态", "皮质护具纹理", "弓箭配件套装", "草原场景底座", "可替换箭头配件"],
    modelPath: "models/harinidun.glb",
    image: "images/hero-harinidun.jpg",
    thumb: "images/hero-harinidun-thumb.jpg"
}, {
    id: 3,
    name: "阿拉坦策吉",
    title: "金胸智者",
    type: "regular",
    rarity: "8.3%",
    height: "7.5cm",
    material: "环保PVC+宝石镶嵌",
    description: "江格尔最信赖的首席谋臣，通晓天地、智计无双。",
    features: ["星纹长袍设计", "太极图案装饰", "金色法杖配件", "智慧卷轴道具", "学者底座", "星空披风特效"],
    modelPath: "models/alatancheji.glb",
    image: "images/hero-alatancheji.jpg",
    thumb: "images/hero-alatancheji-thumb.jpg"
}, {
    id: 4,
    name: "洪古尔",
    title: "雄狮英雄",
    type: "regular",
    rarity: "8.3%",
    height: "8.2cm",
    material: "环保PVC+金属涂装",
    description: "江格尔最信赖的先锋勇士，骁勇善战、赤胆忠心。",
    features: ["红色战甲设计", "雄狮皮毛披风", "双刃斧武器", "战斗姿态造型", "战场底座", "可动关节设计"],
    modelPath: "models/hongguer.glb",
    image: "images/hero-hongguer.jpg",
    thumb: "images/hero-hongguer-thumb.jpg"
}, {
    id: 5,
    name: "萨布尔",
    title: "铁臂力士",
    type: "regular",
    rarity: "8.3%",
    height: "8.5cm",
    material: "环保PVC+金属质感",
    description: "力大无穷、勇猛无双的铁臂力士，双臂如铁。",
    features: ["机械义臂设计", "重型装甲", "力量感造型", "金属链条配件", "工业风底座", "可替换手掌配件"],
    modelPath: "models/saber.glb",
    image: "images/hero-saber.jpg",
    thumb: "images/hero-saber-thumb.jpg"
}, {
    id: 6,
    name: "明彦",
    title: "美男子/红色兔骏马主",
    type: "regular",
    rarity: "8.3%",
    height: "7.8cm",
    material: "环保PVC+丝绸质感",
    description: "俊朗优雅、箭术无双，既是风度翩翩的草原雅士，也是可靠战将。",
    features: ["红色蒙古袍设计", "马头琴配件", "优雅姿态", "骏马造型底座", "丝绸质感涂装", "弓箭配件套装"],
    modelPath: "models/mingyan.glb",
    image: "images/hero-mingyan.jpg",
    thumb: "images/hero-mingyan-thumb.jpg"
}, {
    id: 7,
    name: "萨纳拉",
    title: "刀斧手",
    type: "regular",
    rarity: "8.3%",
    height: "8.1cm",
    material: "环保PVC+金属质感",
    description: "勇猛果敢、悍不畏死的刀斧手，是宝木巴圣地最可靠的防线。",
    features: ["战斗铠甲设计", "双刀武器", "战斗姿态", "战场烟雾特效", "战术底座", "可替换武器配件"],
    modelPath: "models/sanala.glb",
    image: "images/hero-sanala.jpg",
    thumb: "images/hero-sanala-thumb.jpg"
}, {
    id: 8,
    name: "古赞贡布",
    title: "大肚子英雄",
    type: "regular",
    rarity: "8.3%",
    height: "8.3cm",
    material: "环保PVC+陶瓷质感",
    description: "豁达开朗、力大无穷的大肚子英雄，憨态可掬却勇猛过人。",
    features: ["圆润造型设计", "开怀大笑表情", "酒壶配件", "美食元素", "欢乐底座", "可替换表情配件"],
    modelPath: "models/guzangongbu.glb",
    image: "images/hero-guzangongbu.jpg",
    thumb: "images/hero-guzangongbu-thumb.jpg"
}, {
    id: 9,
    name: "哈日吉拉根",
    title: "神箭手",
    type: "regular",
    rarity: "8.3%",
    height: "8cm",
    material: "环保PVC+皮革质感",
    description: "箭无虚发、百步穿杨的神箭手，是草原上最可靠的守护者。",
    features: ["弓箭手造型", "皮革护具", "弓箭配件", "瞄准姿态", "草原瞭望台底座", "可替换箭筒配件"],
    modelPath: "models/harijilagen.glb",
    image: "images/hero-harijilagen.jpg",
    thumb: "images/hero-harijilagen-thumb.jpg"
}, {
    id: 10,
    name: "贺吉拉根",
    title: "铁嘴法官",
    type: "regular",
    rarity: "8.3%",
    height: "7.9cm",
    material: "环保PVC+木纹质感",
    description: "明辨是非、舌辩无双的铁嘴法官，是草原上最受信赖的裁决者。",
    features: ["法官长袍设计", "法典卷轴", "公正天平配件", "严肃表情", "法庭底座", "可替换法槌配件"],
    modelPath: "models/hejilagen.glb",
    image: "images/hero-hejilagen.jpg",
    thumb: "images/hero-hejilagen-thumb.jpg"
}, {
    id: 11,
    name: "纳钦尚胡尔",
    title: "旗手/雄鹰",
    type: "regular",
    rarity: "8.3%",
    height: "8.4cm",
    material: "环保PVC+旗帜质感",
    description: "草原上的先锋号角，手持战旗，以无畏勇气引领族人前进。",
    features: ["旗手造型", "战旗配件", "雄鹰图腾", "旗帜飘动效果", "高地底座", "可替换旗帜配件"],
    modelPath: "models/naqinshanghuer.glb",
    image: "images/hero-naqinshanghuer.jpg",
    thumb: "images/hero-naqinshanghuer-thumb.jpg"
}, {
    id: 12,
    name: "赛力汗塔巴格",
    title: "飞毛腿",
    type: "regular",
    rarity: "8.3%",
    height: "7.7cm",
    material: "环保PVC+运动质感",
    description: "风驰电掣的飞毛腿，身形矫健、步履如飞。",
    features: ["奔跑姿态", "轻便装束", "速度线特效", "动态造型", "跑道底座", "可替换姿势配件"],
    modelPath: "models/sailihantabage.glb",
    image: "images/hero-sailihantabage.jpg",
    thumb: "images/hero-sailihantabage-thumb.jpg"
}];

// ==================== Three.js 全局变量 ====================
let scene, camera, renderer, controls;
let currentModel = null;
let currentHeroId = 1;
let autoRotate = true;
let isAnimating = false;
let floatOffset = 0;

// 模型缓存（避免重复下载）
const modelCache = {};
const loadingQueue = {};

// 镜头缓动状态
let camTargetPos = null, camTargetLook = null;
let camStartPos = null, camStartLook = null;
let camAnimProgress = 0;
let isCameraAnimating = false;

const CAM_ANIM_DURATION = 30; // frames

// GLTF 加载器配置
const dracoLoader = new THREE.DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.1/');
const loader = new THREE.GLTFLoader();
loader.setDRACOLoader(dracoLoader);

// ==================== DOM 加载完成 ====================
document.addEventListener('DOMContentLoaded', function() {
    if (typeof THREE === 'undefined') {
        console.error('Three.js 库未加载！');
        return;
    }
    initializeHeroCards();
    initializeHeroThumbnails();
    initThreeJS();
    initEventListeners();
    initScrollReveal();
    initNavScroll();
    initBackToTop();
    // 默认先显示英雄图片，后台加载模型
    updateHeroInfo(heroesData[0]);
    updateActiveThumbnail(1);
    // 立即开始加载第一个模型
    switchHero(1);
    animateMilestones();
});

// ==================== 生成英雄卡片 ====================
function initializeHeroCards() {
    const container = document.getElementById('heroesGrid');
    if (!container) return;
    container.innerHTML = '';

    heroesData.forEach(hero => {
        const card = document.createElement('div');
        card.className = 'hero-card';
        card.setAttribute('data-id', hero.id);
        card.setAttribute('data-type', hero.type);

        card.onclick = () => {
            switchHero(hero.id);
            scrollToSection('3dview');
        };

        const badgeClass = hero.type === 'hidden' ? 'hidden-badge' : 'regular-badge';
        const badgeText = hero.type === 'hidden' ? '隐藏款' : '常规款';

        const imgSrc = hero.image || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="%238B3C1C"/><text x="50%" y="50%" font-size="24" text-anchor="middle" dy=".3em" fill="white">${hero.name.substring(0,2)}</text></svg>`;

        card.innerHTML = `
            <div class="hero-image">
                <img src="${imgSrc}" alt="${hero.name}" loading="lazy"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 200 200\\"><rect width=\\"200\\" height=\\"200\\" fill=\\"%238B3C1C\\"/><text x=\\"50%\\" y=\\"50%\\" font-size=\\"24\\" text-anchor=\\"middle\\" dy=\\".3em\\" fill=\\"white\\">${hero.name.substring(0,2)}</text></svg>'">
            </div>
            <div class="hero-info">
                <h3 class="hero-name">${hero.name}</h3>
                <p class="hero-title">${hero.title}</p>
                <p class="hero-desc">${hero.description.substring(0, 60)}...</p>
                <div class="hero-badges">
                    <span class="badge ${badgeClass}">${badgeText}</span>
                    <span class="badge regular-badge">稀有度 ${hero.rarity}</span>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ==================== 英雄缩略图导航 ====================
function initializeHeroThumbnails() {
    const container = document.getElementById('heroThumbnails');
    if (!container) return;
    container.innerHTML = '';
    heroesData.forEach(hero => {
        const thumb = document.createElement('div');
        thumb.className = 'hero-thumb';
        if (hero.id === currentHeroId) thumb.classList.add('active');
        thumb.onclick = () => switchHero(hero.id);
        const thumbSrc = hero.thumb || hero.image ||
            `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%238B3C1C"/><text x="50" y="50" font-size="16" text-anchor="middle" dy=".3em" fill="white">${hero.name.charAt(0)}</text></svg>`;
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.alt = hero.name;
        img.loading = 'lazy';
        img.onerror = function() {
            this.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%238B3C1C"/><text x="50" y="50" font-size="16" text-anchor="middle" dy=".3em" fill="white">${hero.name.charAt(0)}</text></svg>`;
        };
        thumb.appendChild(img);
        container.appendChild(thumb);
    });
}

// ==================== Three.js 场景初始化（轻量版） ====================
function initThreeJS() {
    const canvas = document.getElementById('threeCanvas');
    if (!canvas) return;
    const container = document.getElementById('modelViewer');
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f3f0);

    camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    camera.position.set(0, 1.2, 4.5);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height);
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 1.5));
    renderer.shadowMap.enabled = !isMobile;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // 光照（精简）
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const mainLight = new THREE.DirectionalLight(0xfff0d0, isMobile ? 0.9 : 1.2);
    mainLight.position.set(5, 8, 4);
    if (!isMobile) mainLight.castShadow = true;
    scene.add(mainLight);
    scene.add(new THREE.DirectionalLight(0xddeeff, 0.3).position.set(-3, 2, 5));
    scene.add(new THREE.HemisphereLight(0xffeedd, 0x887766, 0.5));

    // 地面阴影（轻量）
    const ground = new THREE.Mesh(
        new THREE.CircleGeometry(2.5, 16),
        new THREE.MeshStandardMaterial({ color: 0xd5d0ca, roughness: 1, metalness: 0, transparent: true, opacity: 0.4 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);

    // 轨道控制器
    if (THREE.OrbitControls) {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.autoRotate = autoRotate;
        controls.autoRotateSpeed = 1.2;
        controls.enableZoom = true;
        controls.enablePan = false;
        controls.target.set(0, 0.4, 0);
        controls.minDistance = 1.5;
        controls.maxDistance = 6;
    }

    // IntersectionObserver 暂停渲染
    const viewer = document.getElementById('modelViewer');
    if ('IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
            entries.forEach(e => { isAnimating = e.isIntersecting; });
        }, { threshold: 0.05 }).observe(viewer);
    }
    isAnimating = true;
    animate();
    window.addEventListener('resize', onWindowResize);
}

// ====== 唯一动画循环（所有动效在此统一驱动） ======
function animate() {
    requestAnimationFrame(animate);
    if (!isAnimating || !renderer || !scene || !camera) return;

    // 模型浮动
    if (currentModel) {
        floatOffset += 0.02;
        currentModel.position.y = Math.sin(floatOffset) * 0.03;
    }

    // 镜头缓动（单次）
    if (isCameraAnimating) {
        camAnimProgress++;
        const t = Math.min(camAnimProgress / CAM_ANIM_DURATION, 1);
        const e = 1 - Math.pow(1 - t, 3);
        if (camTargetPos && camStartPos) {
            camera.position.lerpVectors(camStartPos, camTargetPos, e);
        }
        if (camTargetLook && camStartLook && controls) {
            controls.target.lerpVectors(camStartLook, camTargetLook, e);
        }
        if (t >= 1) isCameraAnimating = false;
    }

    if (controls) controls.update();
    renderer.render(scene, camera);
}

// ==================== 模型切换（优先走缓存） ====================
function switchHero(id) {
    if (currentHeroId === id && currentModel) return;
    currentHeroId = id;

    // 高亮卡片
    document.querySelectorAll('.hero-card').forEach(card => {
        card.classList.toggle('active-card', parseInt(card.dataset.id) === id);
    });

    // 显示 loading（轻微延迟避免闪烁）
    const loadingEl = document.getElementById('modelLoading');
    if (loadingEl) loadingEl.style.display = 'flex';

    // 镜头复位
    if (camera) {
        camStartPos = camera.position.clone();
        camTargetPos = new THREE.Vector3(0, 1.2, 4.5);
        camStartLook = controls ? controls.target.clone() : new THREE.Vector3(0, 0.4, 0);
        camTargetLook = new THREE.Vector3(0, 0.4, 0);
        camAnimProgress = 0;
        isCameraAnimating = true;
    }
    if (controls) controls.autoRotate = false;

    // 移除旧模型（不阻断 UI）
    if (currentModel) {
        disposeModel(currentModel);
        scene.remove(currentModel);
        currentModel = null;
    }

    const hero = heroesData.find(h => h.id === id);
    if (!hero) return;

    // 先在 info 区显示英雄图片/资料
    updateHeroInfo(hero);
    updateActiveThumbnail(id);

    // 缓存命中 → 直接显示
    if (modelCache[hero.modelPath]) {
        applyModelToScene(modelCache[hero.modelPath], hero);
        if (loadingEl) loadingEl.style.display = 'none';
        if (controls) controls.autoRotate = autoRotate;
        return;
    }

    // 防止重复加载同一个模型
    if (loadingQueue[hero.modelPath]) {
        loadingQueue[hero.modelPath].push(hero);
        return;
    }
    loadingQueue[hero.modelPath] = [hero];

    // 后台加载
    setTimeout(() => {
        loader.load(
            hero.modelPath,
            (gltf) => {
                modelCache[hero.modelPath] = gltf.scene;
                applyModelToScene(gltf.scene.clone(true), hero);
                if (loadingEl) loadingEl.style.display = 'none';
                if (controls) controls.autoRotate = autoRotate;
                delete loadingQueue[hero.modelPath];
            },
            (xhr) => {
                if (xhr.total > 0 && loadingEl) {
                    const pct = Math.round(xhr.loaded / xhr.total * 100);
                    loadingEl.querySelector('p').textContent = `加载中 ${pct}%`;
                }
            },
            (error) => {
                console.warn('模型加载失败，使用示意模型', error);
                if (loadingEl) loadingEl.style.display = 'none';
                createFallbackModel(hero);
                if (controls) controls.autoRotate = autoRotate;
                delete loadingQueue[hero.modelPath];
            }
        );
    }, 200);
}

// ==================== 将模型挂入场景 ====================
function applyModelToScene(model, hero) {
    if (!model) return;
    currentModel = model;
    scene.add(currentModel);

    const box = new THREE.Box3().setFromObject(currentModel);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    currentModel.position.sub(center);
    currentModel.scale.setScalar(2.8 / size);

    currentModel.traverse(node => {
        if (node.isMesh && node.material) {
            node.castShadow = true;
            node.receiveShadow = true;
            (Array.isArray(node.material) ? node.material : [node.material]).forEach(mat => {
                if (mat.isMeshStandardMaterial) {
                    mat.roughness = 0.6;
                    mat.metalness = 0.15;
                }
            });
        }
    });

    if (controls) {
        controls.target.set(0, size * 0.15, 0);
        controls.update();
    }
}

// 彻底释放模型资源
function disposeModel(model) {
    if (!model) return;
    model.traverse(node => {
        if (node.isMesh) {
            if (node.geometry) {
                node.geometry.dispose();
                node.geometry = null;
            }
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach(mat => {
                ['map', 'lightMap', 'bumpMap', 'normalMap', 'specularMap',
                 'envMap', 'alphaMap', 'aoMap', 'displacementMap',
                 'emissiveMap', 'roughnessMap', 'metalnessMap'].forEach(key => {
                    if (mat[key]) {
                        mat[key].dispose();
                        mat[key] = null;
                    }
                });
                mat.dispose();
            });
            node.material = null;
        }
    });
    if (model.parent) {
        model.parent.remove(model);
    }
}

// 回退几何体（轻量）
function createFallbackModel(hero) {
    const colorHex = 0x8B3C1C;
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 1.2, 8), bodyMat);
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    const headMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25), headMat);
    head.position.y = 0.8;
    head.castShadow = true;
    group.add(head);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.1, 8), baseMat);
    base.position.y = -0.65;
    base.receiveShadow = true;
    group.add(base);

    // 文字 Sprite
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(139,60,28,0.85)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.font = 'bold 20px "Noto Sans SC"';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hero.name, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(0, 1.5, 0);
    sprite.scale.set(1.2, 0.5, 1);
    group.add(sprite);

    currentModel = group;
    scene.add(currentModel);
}

// ==================== UI 更新 ====================
function updateHeroInfo(hero) {
    document.getElementById('modelName').textContent = hero.name;
    document.getElementById('modelTitle').textContent = hero.title;
    document.getElementById('modelRarity').textContent = hero.rarity;
    document.getElementById('modelHeight').textContent = hero.height;
    document.getElementById('modelMaterial').textContent = hero.material;
    document.getElementById('modelDesc').textContent = hero.description;
    const badgeClass = hero.type === 'hidden' ? 'hidden-badge' : 'regular-badge';
    document.getElementById('modelBadge').innerHTML = `<span class="badge ${badgeClass}">${hero.type === 'hidden' ? '隐藏款' : '常规款'}</span>`;
    const featuresList = document.getElementById('modelFeatures');
    featuresList.innerHTML = hero.features.map(f => `<li><i class="fas fa-check-circle"></i> ${f}</li>`).join('');
}

function updateActiveThumbnail(heroId) {
    const thumbs = document.querySelectorAll('.hero-thumb');
    thumbs.forEach((thumb, idx) => {
        const hero = heroesData[idx];
        if (hero && hero.id === heroId) thumb.classList.add('active');
        else thumb.classList.remove('active');
    });
}

// ==================== 模型控制 ====================
function controlModel(action) {
    if (!currentModel && action !== 'reset') return;
    switch (action) {
        case 'rotate-left': currentModel.rotation.y += 0.1; break;
        case 'rotate-right': currentModel.rotation.y -= 0.1; break;
        case 'zoom-in': camera.position.multiplyScalar(0.9); break;
        case 'zoom-out': camera.position.multiplyScalar(1.1); break;
        case 'reset': resetView(); break;
    }
}

function toggleAutoRotate() {
    autoRotate = !autoRotate;
    if (controls) controls.autoRotate = autoRotate;
    const icon = document.getElementById('autoRotateIcon');
    if (icon) icon.className = autoRotate ? 'fas fa-pause' : 'fas fa-play';
}

function resetView() {
    if (!camera) return;
    camStartPos = camera.position.clone();
    camTargetPos = new THREE.Vector3(0, 1.2, 4);
    camStartLook = controls ? controls.target.clone() : new THREE.Vector3(0, 0.4, 0);
    camTargetLook = new THREE.Vector3(0, 0.4, 0);
    camAnimProgress = 0;
    isCameraAnimating = true;
}

// ==================== 辅助函数 ====================
function scrollToSection(sectionId) {
    const target = document.getElementById(sectionId);
    if (target) {
        const navHeight = document.querySelector('.navbar')?.offsetHeight || 70;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;
        window.scrollTo({ top: Math.max(0, targetPosition), behavior: 'smooth' });
    }
}

function filterHeroes(type, e) {
    const btns = document.querySelectorAll('.filter-btn');
    btns.forEach(btn => btn.classList.remove('active'));
    const target = e ? e.target : (window.event ? window.event.target : null);
    if (target) target.classList.add('active');

    const cards = document.querySelectorAll('.hero-card');
    cards.forEach((card, index) => {
        const heroType = card.getAttribute('data-type');
        if (type === 'all' || heroType === type) {
            card.style.display = 'block';
            card.style.animation = 'none';
            void card.offsetHeight;
            card.style.animation = `cardFadeIn 0.4s ease ${index * 0.05}s forwards`;
        } else {
            card.style.display = 'none';
        }
    });
}

// 购买弹窗
function openPurchaseModal() {
    const modal = document.getElementById('purchaseModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        updateTotalPrice();
    }
}
function closePurchaseModal() {
    const modal = document.getElementById('purchaseModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}
function updateTotalPrice() {
    let price = 19;
    if (document.getElementById('full')?.checked) price = 118;
    if (document.getElementById('digital')?.checked) price = 188;
    const totalSpan = document.querySelector('.total-price');
    if (totalSpan) totalSpan.textContent = `¥${price}`;
}

// ==================== 窗口适配 ====================
function onWindowResize() {
    const canvas = document.getElementById('threeCanvas');
    if (!canvas) return;
    const container = document.getElementById('modelViewer');
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// ==================== 事件监听 ====================
function initEventListeners() {
    // 购买选项切换
    document.querySelectorAll('input[name="purchaseOption"]').forEach(r => r.addEventListener('change', updateTotalPrice));

    // 联系表单
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            alert('感谢咨询！我们会尽快与您联系。');
            contactForm.reset();
        });
        contactForm.querySelectorAll('input, textarea').forEach(el => {
            el.addEventListener('blur', () => {
                if (el.value.trim()) el.classList.remove('error');
                else if (el.required) el.classList.add('error');
            });
        });
    }

    // 订单表单
    const orderForm = document.getElementById('orderForm');
    if (orderForm) {
        orderForm.addEventListener('submit', (e) => {
            e.preventDefault();
            let valid = true;
            orderForm.querySelectorAll('input[required], textarea[required]').forEach(el => {
                if (!el.value.trim()) { el.classList.add('error'); valid = false; }
                else el.classList.remove('error');
            });
            if (valid) {
                alert('下单成功！工作人员将电话确认订单。');
                closePurchaseModal();
                orderForm.reset();
            }
        });
        orderForm.querySelectorAll('input, textarea').forEach(el => {
            el.addEventListener('input', () => el.classList.remove('error'));
        });
    }

    // 点击外部关闭模态框
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('purchaseModal')) closePurchaseModal();
    });

    window.addEventListener('resize', onWindowResize);

    // 购买选项点击
    document.querySelectorAll('.option').forEach(opt => {
        opt.addEventListener('click', function() {
            const r = this.querySelector('input[type="radio"]');
            if (r) { r.checked = true; updateTotalPrice(); }
        });
    });
}

// ==================== 滚动渐入动画 ====================
function initScrollReveal() {
    const els = document.querySelectorAll('.scroll-reveal');
    if (!els.length) return;
    if ('IntersectionObserver' in window) {
        const obs = new IntersectionObserver((entries) => {
            entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); obs.unobserve(e.target); } });
        }, { threshold: 0.1 });
        els.forEach(el => obs.observe(el));
    } else {
        els.forEach(el => el.classList.add('revealed'));
    }
}

// ==================== 导航栏滚动高亮 ====================
function initNavScroll() {
    const nav = document.querySelector('.navbar');
    const sections = document.querySelectorAll('section[id]');
    const links = document.querySelectorAll('.nav-link');
    window.addEventListener('scroll', () => {
        nav.classList.toggle('scrolled', window.scrollY > 50);
        let cur = '';
        sections.forEach(s => { if (window.scrollY >= s.offsetTop - 150) cur = s.id; });
        links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${cur}`));
    });
}

// ==================== 返回顶部 ====================
function initBackToTop() {
    const btn = document.getElementById('backToTop');
    if (btn) window.addEventListener('scroll', () => btn.classList.toggle('show', window.scrollY > 500));
}

// ==================== 汉堡菜单 ====================
function toggleMenu() {
    document.getElementById('navMenu').classList.toggle('open');
    document.getElementById('hamburger').classList.toggle('active');
}

document.addEventListener('DOMContentLoaded', function() {
    const menu = document.getElementById('navMenu');
    if (menu) {
        menu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                menu.classList.remove('open');
                document.getElementById('hamburger')?.classList.remove('active');
            });
        });
    }
});

// ==================== 里程碑数字动画（滚动触发） ====================
function animateMilestones() {
    const milestones = document.querySelectorAll('.milestone-number');
    if (!milestones.length) return;

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.getAttribute('data-target'));
                    if (!target) return;
                    animateNumber(el, target);
                    observer.unobserve(el);
                }
            });
        }, { threshold: 0.3 });
        milestones.forEach(el => observer.observe(el));
    } else {
        milestones.forEach(el => {
            const target = parseInt(el.getAttribute('data-target'));
            if (target) animateNumber(el, target);
        });
    }
}

function animateNumber(el, target) {
    let current = 0;
    const step = Math.ceil(target / 30);
    const timer = setInterval(() => {
        current += step;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        el.textContent = current;
    }, 60);
}

// 暴露全局函数
window.filterHeroes = filterHeroes;
window.openPurchaseModal = openPurchaseModal;
window.closePurchaseModal = closePurchaseModal;
window.controlModel = controlModel;
window.toggleAutoRotate = toggleAutoRotate;
window.scrollToSection = scrollToSection;
window.switchHero = switchHero;
window.toggleMenu = toggleMenu;