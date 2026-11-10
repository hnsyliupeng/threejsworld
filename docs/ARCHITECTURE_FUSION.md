# 五大开源架构深度融合与程序化照片级建模技术拆解

> 参考基准仓库：
> 1. **dgreenheck/ez-tree** — 参数化植物骨架生长与网格解耦器
> 2. **yomotsu/vegetation** — 零外部资产纯数据核心、覆盖率保持 Mipmap 与跨渲染器植被管线
> 3. **VictorZakharov/threejs-nanites** — Three.js WebGPU/TSL 集群 DAG 虚拟几何与 4 仰角重照明 Impostor 引擎
> 4. **SamG-Coder/solstice** — Rust/WebGPU 物理级材质生成（`Surface::shaped`）、Lumen 级 GI、大气体积云与虚拟分页流式渲染器
> 5. **img2threejs/img2threejs (+ `docs/`)** — 面向 Agent 的 Forge 分阶段重构管线、S3S 结构化语义规范、前置几何门控与 Divine Eye 视觉自纠闭环

---

## 第一章：五大参考项目架构全景拆解与互补矩阵

传统的 Three.js 建模或 AI 3D 生成往往陷入两难：
- **纯 AI Mesh 生成（如 TRELLIS.2 / Tripo / Rodin）** 拥有极高的几何表现力，但输出是**零语义的单体网格**——没有关节枢轴（Pivots）、没有挂载插槽（Sockets）、不可单独编辑或消融，且单模型体积高达数十 MB。
- **传统手工编码程序化建模** 具有完美语义与极低传输成本，但容易落入“2.5D 纸片拉伸（Flat-Projection Bias）”、“材质通道混叠（Albedo 伪造 Roughness）”、“远处树冠溶解或过度膨胀成亮毯”以及“缺乏真实物理高程响应与全局光照”的陷阱。

五个参考仓库恰好分别解决了照片级世界构建中**五个正交维度**的核心难题：

| 维度 | `img2threejs` (+ `docs`) | `ez-tree` | `yomotsu/vegetation` | `threejs-nanites` | `solstice` |
|---|---|---|---|---|---|
| **核心定位** | Agent 认知与重构门控大脑 | 参数化树木骨架生成器 | 零资产植被纯数据运行时 | Three.js WebGPU 万亿三角面集群引擎 | AAA 物理材质/GI/大气世界渲染器 |
| **核心优势** | 1. 阶段锁定的 Forge 管线与状态机<br>2. T0–T5 混合几何阶梯与 `open-shell` / 凹槽允许清单<br>3. **先于渲染的几何门控**（手性镜像、`distinctZ`、`scalp_exposure`、`part_coverage`）<br>4. De-light + 相机反求 + 6-Pass `render-profile.v2` | 1. **骨架生成（耗 RNG）与网格化（无 RNG）彻底分离**<br>2. 递归分级参数（角/长度/粗细/扭曲/重力/攀爬架引力）<br>3. 树冠球形法线定制与 `windFactor` 顶点属性 | 1. `src/core`（纯类型数组、零 DOM）与 `src/three` 严格解耦，字节级确定性<br>2. **覆盖率保持 Alpha Mipmap**（二分缩放+直方图截断）<br>3. `upNormalCards` 解决背面变黑<br>4. 凸包倒角岩石+3D空间苔藓+根部埋地防穿帮 | 1. 128 三角形 **Cluster DAG** + 边界锁边简化 + **`err = max(child, own)`** 传播<br>2. **4方向光栅 Alpha 覆率标定**（取代误用的 `√2`）<br>3. 两阶段 HZB + Compute 软光栅 VisBuffer<br>4. **4仰角未光照 Albedo+Normal Impostor** 动态重照明 | 1. **`Surface::shaped`** 物理高程（米）→ 三频段微起伏（2cm/10cm/50cm）→ 物理耦合着色<br>2. **Specular AA** 防微法线闪烁<br>3. `.species`/`.grass`/`.weather` 黄金角文本语法与 `--without` 部件消融<br>4. Clipmap 体素+SSGI+Hillaire 大气+体积云+页面流式加载 |
| **原生盲区** | 缺多尺度物理表面合成器、大规模植物生态、GPU Cluster DAG 与实时 GI/大气 | 依赖 4MB+ 外部静态贴图、`√2` 远距叶片膨胀、无 GPU 集群剔除 | 仅靠 `THREE.LOD` 切换、缺乏照片引导的 Agent 重构闭环与全局光照 | 偏重森林/雕像展示、缺乏通用复杂道具/角色装配规范与表面材质合成器 | Rust+WGSL 原生栈，缺乏面向通用 JS/Three.js Agent 的图像反求与渐进式自我纠错脚本 |
| **融合角色** | **L0/L3 认知控制面、S3S 规范与前置几何/视觉门控层** | **L2 参数化植物骨架原型** | **L1 零资产纯数据核心与精确 Alpha/LOD 数学基座** | **L3 WebGPU Cluster DAG 与超大规模实时渲染引擎** | **L1 物理材质引擎（`Surface::shaped`）与 L3 物理光照/大气规范** |

---

## 第二章：统一四层融合架构（ThreeJSWorld Architecture）

我们将五大架构收敛为清晰的**四层单向数据流（Four-Layer Unidirectional Forge Pipeline）**，确保“Agent 负责观察与判断，确定性脚本负责约束与合成，纯数据核心负责跨平台复现，GPU 负责千万级虚拟几何与物理光影”：

```text
+---------------------------------------------------------------------------------------------------+
| L0: Agent 认知、观测与门控层 (源自 img2threejs Forge + Divine Eye + Solstice 部件消融法)          |
|  - 输入路由: 单图/多视图 (Image) | 中间网格 (GLB) | 文本与数据语法 (.species / .weather / Prompt)   |
|  - 8层物理空间观测 -> De-lighting + 相机求解 -> detailInventory -> 置信度路由 (lightingUnknown)  |
|  - 不可跳过门控: 状态机 (state.py) -> S3S严格校验 -> 前置几何门控 -> 6-Pass 渲染对比 -> 显微镜    |
+---------------------------------------------------------------------------------------------------+
                                                |
                                                v  唯一契约: S3S-World v2 JSON (带 SHA-256 血缘)
+---------------------------------------------------------------------------------------------------+
| L1: 零 DOM 纯数据与物理材质合成层 (源自 vegetation/core + solstice-procgen Surface::shaped)       |
|  - 确定性 PRNG (Mulberry32) + 周期性 2D/3D 梯度/Worley 噪声 (Node/Worker/WebGL/WebGPU 字节一致)   |
|  - Surface::shaped(u,v -> height_m): 计算 2cm(fine) / 10cm(medium) / 50cm(broad) 相对起伏          |
|    -> 耦合输出 Albedo(线性->sRGB) + 切线空间 Normal + Roughness + Cavity AO (绝不拿噪声当表面)    |
|  - Coverage-Preserving Mipmap: 二分搜索 + 直方图截断，锁死各级 Mip 不透明像素比例防远距枝叶消失     |
+---------------------------------------------------------------------------------------------------+
                                                |
                                                v  MeshData / PartDef / TextureData (TypedArrays)
+---------------------------------------------------------------------------------------------------+
| L2: 混合几何阶梯与语义装配层 (源自 img2threejs T0-T5 + ez-tree + vegetation + townkit)           |
|  - 阶梯路由: T0基元 -> T1扫描/车削 -> T2变截面平行传输 -> T3程序表面 -> T4隐式SDF/open-shell -> T5拟合 |
|  - 变厚度放样 (Variable-Thickness Loft) + 4分帽盖细分 + 解析场梯度法线 (彻底消除 2.5D 纸片偏见)   |
|  - 植物学骨架/网格解耦: 黄金角螺旋 (2.399963 rad) + 轮生枝 + 根部埋地 (-0.3m) + upNormalCards      |
|  - 语义运行时 (sculptRuntime): 命名节点树 + 铰链枢轴(Pivots) + 插槽(Sockets) + 简化碰撞体 + 可爆破拆解 |
+---------------------------------------------------------------------------------------------------+
                                                |
                                                v  THREE.Group / Instanced Parts / .nm Cluster DAG
+---------------------------------------------------------------------------------------------------+
| L3: WebGPU 虚拟几何与物理大气渲染层 (源自 threejs-nanites + solstice-render)                      |
|  - Cluster DAG: 128-tri Meshlet + ~8簇邻接编组 + 锁边界简化 + err = max(childErr, ownErr)        |
|  - 叶子覆率标定: 4方向 CPU Alpha 光栅搜索缩放系数 (维持冠层透光率恒定，禁止 √2 面积补偿)           |
|  - 两阶段 HZB 剔除 + Compute Soft-Rasterizer (Visibility Buffer -> 解析导数 G-Buffer)               |
|  - 4仰角 (0/30/60/90°) 未光照 Albedo+Normal Impostor 图集 (运行时动态受光/阴影/雾效/仰角混合)     |
|  - 光照氛围: Specular AA + 体素Clipmap/屏幕空间GI + Hillaire大气 + 排序覆盖率体积云 + TAA超分       |
+---------------------------------------------------------------------------------------------------+
```

---

## 第三章：统一中间表示 — **S3S-World v2 (Structured 3D World Spec)**

参考 `img2threejs/docs/RESEARCH_TRELLIS2_TO_IMG2THREEJS.md` 的 S3S 提案与 `solstice` 的文本语法，我们制定了 `schemas/s3s-world.v2.schema.json`。它打破了单物体与大场景之间的格式壁垒，核心设计包括：

1. **阶段血缘密封（`provenance.sealed`）**：任何下游阶段只能读取上游的哈希化产出与明确 `evidence` 字段，禁止靠聊天上下文记忆补全未观测几何。
2. **多域统一路由（`subject.primaryDomain`）**：支持 `object`、`character`、`botanical`、`architecture`、`environment`、`hybrid`。
3. **显式世界坐标系与参考相机（`frame`）**：明确米制单位（`up: [0,1,0]`, `forward: [0,0,1]`）以及 `fovEvidence`（区分 `solved` 与 `ambiguous-with-part-inflation`——防止用放大物体来掩盖焦距错误）。
4. **分轴形状置信度与光照未知降级（`PartConfidence` & `lightingUnknown`）**：
   - 单目照片对 X/Y 的约束远强于 Z（深度），故拆分为 `shape: {x, y, z}`。
   - 当参考图光照未知时，`materials[].lightingUnknown = true` 自动将 `roughness`/`metalness` 从硬门控（`hard`）降级为仅报告（`report-only`），避免把摄影棚高光当成材质参数硬塞进模型。
5. **跨模态混合语法挂载**：
   - 硬表面/道具/角色挂载 `geometryDescriptor`（T0–T5）与 `detailInventory`。
   - 植物节点直接挂载 `botanicalGrammar`（`ez-tree` + `solstice` `.species` 风格参数：`crownEnvelope`, `goldenAngleRad`, `whorlCount`, `groundEmbedMeters`, `windWeight`）与 `lodStrategy`（`coverageCalibrationDirs`, `impostorElevationsDeg`）。
   - 材质节点支持 `shapedSurface`（`tileMetres`, `reliefBands`, `heightRecipe`, `wearBias`, `cavityDirt`），直接驱动 `Surface::shaped` 合成器。

---

## 第四章：融合几何生成引擎（从 T0–T5 阶梯到零厚度膜与植物学）

### 4.1 六阶混合几何阶梯与拓扑强约束
延续并扩展 `img2threejs` 的策略，每个部件必须在选择图元前声明 `topologyClass`：

| Tier | 类型 | 核心适用范围 | 融合增强机制 |
|---|---|---|---|
| **T0** | `primitive` | 简单机械零件、螺栓、底座 | 严格禁止 `continuous-sculpt` 使用 `box`/`cylinder`/`cone` |
| **T1** | `parametric` | 车削器皿（`lathe`）、轮廓斜切（`extrude`）、刃具（`ground-blade`） | 刃具强制配备截面磨削函数 `grind(h)` 与远端渐薄，严禁等厚平切 |
| **T2** | `sweep` | `tapered-sweep`（角、尾、毛发束、树枝） | **强制使用平行传输（Parallel Transport）标架**，禁止 Frenet 标架在拐点发生 180° 翻转；端点半径必须真正收敛 |
| **T3** | `proceduralSurface` | 凸包风化岩石、表面浮雕、瓦片、地面起伏 | 融入 `vegetation` **带凹坑的凸包多面体 + 倒角边缘带 + 面加权法线**（防止棱带法线污染平面产生明暗锯齿） |
| **T4a** | `field` (SDF `implicit`) | 连续有机躯干、**内凹孔洞（`eye-socket`, `nostril`, `canal`）** | 强制**允许清单（Allow-list）**：凡名称/角色含凹腔语义，必须采用 `implicit` + SDF `subtract`，彻底封堵用外凸球体贴片假装凹槽的漏洞 |
| **T4b** | `open-shell` *(新增)* | 零厚度双面薄膜（龙翼膜、披风、单片花瓣/叶片、旗帜） | 借鉴 TRELLIS.2 O-Voxel 场无关启发：**禁止走 SDF**（SDF 必会强行增厚），强制 `doubleSided: true` 或采用 `upNormalCards`（显式反转三角面+统一向上法线以 `FrontSide` 绘制） |
| **T5** | `fittedBuffer` | 复杂人脸模板拟合 / 视觉壳体雕刻 | 必须声明 `refitCommand`，并保留语义节点名、Pivot 与 Socket |

### 4.2 终结 2.5D 纸片偏见：Variable-Thickness Loft 与 `distinctZ` 校验
`img2threejs` 在 Glock-18 重构中揭示了一个致命盲区：**轮廓 IoU 高达 0.986 的模型，在 3/4 视角下仍像一块切出来的厚纸板**，原因在于 `ExtrudeGeometry` 仅将 2D 轮廓向 Z 轴平推，所有顶点只落在 6–10 个离散 Z 平面上。
融合方案引入 **Variable-Thickness Loft（变厚度放样）**：
1. 沿厚度参数 $t \in [-1, 1]$ 生成多层轮廓环，位置为 $z(x, y, t) = t \cdot \text{halfWidth}(x, y)$，其中 $\text{halfWidth}(x,y)$ 是描述掌腹隆起、导轨收窄、握把凹槽的连续解析场。
2. **帽盖（Cap）四分细分**：`triangulateShape` 仅在边界生成顶点，导致中部隆起坍塌为平面；必须对帽盖三角形进行 4 路重心细分并在内部点重采样 $\text{halfWidth}(x, y)$，同时保持边界边中点严格线性插值以防接缝撕裂。
3. **解析场梯度法线**：严禁由细长耳切三角形平均法线（会形成放射状折痕扇面），内部顶点直接取解析梯度法线：
   $$\mathbf{n}(x, y, t) = \text{sign}(t) \cdot \text{normalize}\left(-\frac{\partial f}{\partial x},\; -\frac{\partial f}{\partial y},\; 1\right)$$
4. **几何门控 `distinctZ`**：提交渲染前在 Python 几何门控中统计部件的 `round(z, 3)` 唯一值数量；对非平面实体，若 `distinctZ <= 10` 直接判为 2.5D 纸片并拦截！

### 4.3 融合植物学骨架与零破绽地面交互
结合 `ez-tree`、`solstice` `.species` 与 `vegetation`：
1. **骨架与网格完全解耦**：
   - `growSkeleton(seed, species)` 消耗全部 PRNG 序列，生成所有树干/枝条样条点（黄金角 $\phi \approx 2.399963\text{ rad}$ 螺旋或针叶轮生环 `whorl`）及叶片锚点。
   - `meshSkeleton(skeleton, lodDetail)` **零 RNG 消耗**地采样 `sectionStride`、`segmentFactor`、`leafStride`、`leafScale`，保证同一种子在任意 LOD 下轮廓和拓扑绝对同源。
2. **坡地根部埋地与悬浮修正**：
   - 树木主干与碰撞体向下延伸 $0.3 \times (\text{height} / 7.55)$ 米（`vegetation` 实测固定法则），花草叶根下沉 $3\text{ mm}$（莲座叶梢下沉 $6\text{ mm}$），彻底杜绝斜坡地形上的根部悬空。
3. **`upNormalCards`（反面法线翻转技术）**：
   - 在 `DoubleSide` 下，显卡会对背面自动取反法线导致半数叶片/草叶呈死黑斑块。统一改为生成**法线朝上/朝向树冠中心外侧的正面+显式反向索引三角形**，配合 `THREE.FrontSide` 绘制。

---

## 第五章：照片级程序化 PBR 材质融合引擎

### 5.1 `Surface::shaped`：用物理形状决定颜色，绝不用彩色噪声糊弄表面
传统程序化材质最大误区是“随机噪声上色 + 把颜色转灰度当粗糙度/凹凸”。融合 `solstice-procgen` (`surface.rs`) 后，我们的标准流程为：
1. **物理尺度建模**：任何表面必须声明 `tileMetres`（如树皮 `0.5m`、花岗岩/鹅卵石 `2.0m–4.0m`），高度函数 `height(u, v) -> (metres, materialTag)` 以**真实米制**输出无缝周期几何起伏（如树皮纵向裂沟、错落石块、机加工拉丝）。
2. **三频段相对起伏卷积（Multi-Scale Relief）**：对同一高度场在不同卷积半径下求局部均值差，得到三层物理相对高程：
   - `fine`（约 2 cm）：细微木纹、晶体颗粒、微裂纹；
   - `medium`（约 10 cm）：单块石片、树皮鳞片、剥落边缘；
   - `broad`（约 50 cm）：宏观鼓包与低洼积水区。
3. **物理因果着色（Shade from Relief）**：
   - **凹陷处（`relief < 0`）**：`cavity` 降低（环境光遮蔽变暗）、灰尘/腐殖质/青苔沉积、粗糙度升高、局部湿度增加；
   - **凸起脊（`relief > 0`）**：风化磨亮（粗糙度降低）、边缘露底（金属暴露或浅色风化层）。
4. **3D 世界空间苔藓（禁止 UV 噪声）**：对于岩石/树干附着苔藓，必须使用每个纹素反推的 **3D 模型位置与法线**（`upwardness` + 近地湿度带 + 局部凹腔 `relief < 0`），绝不在 UV 空间画矩形迷彩。

### 5.2 物理先验、De-light 与色彩空间铁律（源自 `img2threejs`）
- **颜色 vs 数学贴图隔离**：`map`、`emissiveMap`、`sheenColorMap` 必须使用 `THREE.SRGBColorSpace`；`roughnessMap`、`metalnessMap`、`normalMap`、`aoMap` 必须保持 `THREE.NoColorSpace`（线性数值）。
- **De-lighting 硬前置**：任何从参考照片投影的纹理，必须先经过 `delight_albedo`（高通/光照中性化移除阴影和高光）才可作为 `albedo`，否则投影阴影会在 Three.js 场景光下发生**双重着色失真**。
- **涂层介质律**：完整涂漆的金属表面（汽车漆、武器镀层）其 `metalness` 接近 `0`（属于电介质漆膜 + `clearcoat`），仅在剥落露底遮罩区内才切换到导体 `metalness = 1.0`。

### 5.3 Specular AA 与覆盖率保持 Mipmap
- **覆盖率保持 Alpha Mipmap（`vegetation/textureMipmaps.ts` + `solstice/masked_mip_chain`）**：
  普通双线性降采样会让树针、草叶、细茎在 Mip 2+ 时 Alpha 均值跌破 `alphaTest`（如 0.5），导致远处树木枝叶大面积蒸发。我们在生成每级 Mipmap 时：
  1. 计算 Mip0 中满足 `alpha >= alphaTest` 的原始覆盖率 $C_0$；
  2. 对降采样后的 Mip $k$ 的 Alpha 直方图执行 **32 次二分搜索乘法缩放系数 $s$** 使覆盖像素数逼近 $C_0 \cdot N_k$；
  3. 若大量同透明度像素导致无法仅靠缩放精确逼近，则从高到低精确截取恰好 $\text{round}(C_0 \cdot N_k)$ 个像素抬升至阈值以上，**误差保证 $< 0.2\%$**！
- **Specular AA（`solstice/specular_aa.wgsl`）**：当微法线变化率在像素内剧烈震荡时，动态提高有效粗糙度 $\alpha' = \sqrt{\alpha^2 + \kappa \cdot \text{Var}(\mathbf{n})}$，消灭超远距离高频材质闪烁。

---

## 第六章：万亿三角面虚拟几何、Impostor 与全球氛围照明

当单帧需要渲染从单道具扩展到整片森林或城市景观时，L3 渲染引擎按 `threejs-nanites` 与 `solstice-render` 的融合范式运作：

1. **Cluster DAG 构建（离线 / Web Worker）**：
   - 将实心网格划分为 **128 三角形紧凑网格簇（Meshlets）**；
   - 通过共享顶点邻接图 + Morton 空间序将约 **8 个相邻簇** 编为一组；
   - 锁定组间共享边界顶点，简化至 50% 三角形后重新切簇，建立父子 DAG 边；由于每层重新编组，上一层被锁住的边界在下一层自动成为内部边而被消除，绝不残留接缝；
   - **误差传递公式**：强制采用 Nanite 原始准则 `parentErr = max(maxChildErr, ownSimplificationErr)`（禁止简单求和！`threejs-nanites` 实测证明求和对远景多出 2–3 层多余细节，导致 30px 树木仍绘制 ~2900 个树干三角形）。
2. **叶子不可坍缩卡片的 4 向覆率标定（`dag/coverage.ts`）**：
   - Alpha 卡片无法做边坍缩；每层减半卡片后，禁止按面积守恒乘以 $\sqrt{2}$（树冠叶片高度重叠，少而大的卡片乘以 $\sqrt{2}$ 会显著增加投影总面积，把森林变成均匀发亮的绿毯！）；
   - 改用 CPU 沿 4 个正交+对角方向将卡片连同 Alpha 纹理光栅化到网格，二分搜索令总不透明像素等于原簇的缩放倍率（实测约 `1.3x` 而非 `1.414x`）。
3. **GPU 两阶段 HZB 剔除 + Compute 软光栅（Visibility Buffer）**：
   - **Phase 1**：使用上一帧 HZB 剔除并提交硬件/软件绘制列表，未通过测试的簇写入 `retest` 缓冲；
   - **Rebuild HZB**：用本帧 Phase 1 深度重建高阻深度金字塔（树冠层提前封闭 $\le 2\text{ px}$ 小缝防远景漏检）；
   - **Phase 2**：对 `retest` 列表重测，本帧新露出的物体零延迟补绘；
   - **统一可见性缓冲解析**：面积 $< 4\text{ px}^2$ 的微三角形走 Compute 软光栅（`atomicMin` 深度 + `atomicMax` ID），与硬件光栅结果共同写入 Visibility Buffer，再用 **解析屏幕偏导数（Analytic Derivatives）** 单 Pass 解析为 G-Buffer 并与地形/灯光统一着色。
4. **4 仰角未光照 Impostor 图集与动态重照明**：
   - 对高度低于阈值（如 `< 20 px`）的远景树/建筑，按集群切图在启动时烘焙 **0°、30°、60°、90° 四个仰角**（非对称雕像增加水平方位角），且**仅烘焙未光照反照率 + 局部空间法线（Albedos + Normals）**；
   - 运行时与真实几何体共享太阳、天光、阴影与雾效（解决烘焙死光照在背光面亮瞎眼、切 LOD 瞬间闪烁的顽疾），并用 SpeedTree 风格抖动交叉淡入（跨俯仰角平滑混合）。
5. **物理氛围与全局光照（源自 `solstice-render`）**：
   - **Clipmap 体素 + 屏幕空间混合 GI**：近处体素距离场支持无限次多跳间接光（如火光照亮神庙内部），屏幕探针先沿 Tile 深度金字塔跳过大段空白再回退体素与天光；
   - **Hillaire 2020 大气 + 排序覆盖率体积云**：云覆盖率 `coverage = 0.6` 经天气图分位排序后精确覆盖 60% 天空，并反向注入天光 LUT 与间接光照。

---

## 第七章：Agent 确定性门控与视觉自纠闭环

`img2threejs` 的血泪经验与 `threejs-nanites` 的探针体系证明：**纯靠大模型自己看一张成品图打分一定会“自我感觉良好”地放过致命结构缺陷**。我们将全部验证机制融合为 **五道硬门控（Hard Gates）**：

1. **状态机门控（`state.py`）**：每个 Pass 强制记录证据哈希，默认单 Pass 最多纠偏 3 次、全局最多 6 次，防止 Token 无限空转；拒绝凭记忆跳步。
2. **S3S 规范静态硬拦截（`spec_validator.py`）**：
   - 复杂道具必须匹配 `detailInventory` 最小条数且每条必须绑定真实 `localFeatures` 或 `localOverrides`（禁止纯散文描述）；
   - 左右成对部件（`-l`/`-r`）强制校验是否满足矢状面镜像 $(x, y, z) \to (-x, y, z)$，拦截用旋转 180° 冒充镜像导致的双左手缺陷；
   - 拓扑/原语配对拦截 + 凹腔允许清单 + `open-shell` 双面校验 + `hairProfile` 头皮 UV 绑定与 `standProud` 上限检查。
3. **无浏览器前置几何门控（`geometry_gates.py`）**：在启动浏览器渲染之前直接在三角网/顶点 JSON 上跑数学审计：
   - **`distinctZ` 2.5D 纸片检测**：要求三维部件 Z 坐标平面数 $> 10$；
   - **绕序与退化三角形检查**：检测负体积/镜像未翻转法线；
   - **Seam Overlap 间隙门控**：检测相邻部件（刀刃-护手-手柄，躯干-四肢）物理重叠量，零悬浮；
   - **`check_part_coverage` 装配一致性门控**：确保爆炸拆解（按中心缩放而非平移）和点击拾取共享同一零件边界，且无遗漏或被合并为单一网格；
   - **`scalp_exposure` 几何露头皮检测**：仅统计在头骨 SDF 外侧的毛发点，防止陷进头皮内部的点骗过最近邻测试。
4. **6-Pass 确定性多角度渲染 + 视觉显微镜（`render-profile.v2` & `image_intake.py`）**：
   - 每个承认视角渲染 6 个确定性通道：`beauty`, `alpha-silhouette`, `semantic-id`, `depth`, `normal`, `roughness-material-id`；
   - 强制转盘多角度（0° / 90° / 180° / 270°）与 **轮廓内部分区差异（`interior_difference`）**——因为轮廓 IoU 只读边缘 11% 的像素，把整张脸删掉 IoU 照样拿 0.8803！
   - **`divine_eye` 确定性评价**：先跑 zero-token 多信号集合（IoU/Scale 硬门控 + pHash/SSIM/Sobel/Blowout/Flat/Banded Lab ΔE），若照片对比程序渲染仅因视角背景落败但 HOG 特征余弦 `objectness >= 0.48`，触发 `reconstructionModeSuspected` 降级为 `probe` 而非错误硬拒。
5. **部件性能消融审计（`--without` & `ListGuard`）**：借鉴 `solstice/townkit` 与 `threejs-nanites`，允许运行时动态剥离 `walls/roofs/details/shadows/occ` 验证单部件 GPU 毫秒成本与帧排队上界（限制 GPU 队列深度 $\le 2$ 帧防低端核显 5 秒输入延迟）。

---

## 第八章：从五大仓库源码提炼的 15 条黄金工程铁律

详见 [`docs/ANTI_PATTERNS_AND_LESSONS.md`](ANTI_PATTERNS_AND_LESSONS.md) —— 每一条都对应原仓库真实踩坑实测数据（例如 `√2` 树叶发白、`distinctZ = 10` 的 Glock 假 3D、头皮覆盖调宽反增 14.9% 露头皮、Otsu vs 固定百分位、DoubleSide 树叶黑斑、WebGL D3D11 MRT 首次编译冻结 1.7 秒、64 位原子缺少时软光栅双 Pass 排序等）。
