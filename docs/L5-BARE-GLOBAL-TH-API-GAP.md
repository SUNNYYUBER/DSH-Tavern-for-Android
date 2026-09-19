# 裸全局 TH API 静默缺口评估（L5 穷举发现，2026-09-14）

> **处置依据**：goal 边界 **B5**「需大架构改造的发现：当轮写评估文档到 `docs/`，不实施，继续下一格，不中断 goal」。
> 本文即该评估文档。
>
> **【2026-09-14 第十八轮更新】方案 C 已实施**（见文末 §八）。
>
> **【2026-09-15 第二十四轮 W3 更新】缺口已收口，但修法与本文原建议**不同**（见文末 §九）：
> ① **方案 B 被决定性实验证否** —— 卡脚本以 `<script type="module">` 注入（ESM = 严格模式），
> `with` 是**语法错误**（不是「风险高」）。故 §五 对方案 B 的「可行但需专门一轮」判定**已失效**。
> ② **本文 §四 的论证有一半不成立** —— 「第三类名字不可能穷举」只对**卡作者自造桥名**成立；
> **真 TH 自己提供的 API 面是有限的、可枚举的**（官方 `@types` 144 项 → 产物核实 141 项）。
> ③ 真根因是「**两份清单没对齐**」（真 TH 的面 vs 我方手写静态清单），不是 P-14 的「无限集合漏一个」。
> ④ 修法：按真值形态**三类分流**（真实现 3 / 异步函数 stub 9 / 值・同步型 getter 13），
> 并新建常驻门禁第 11 项 `audit-th-face-coverage.mjs`（修前 25 项真缺口 → 修后 **141/141 覆盖、0 静默缺口**）。
>
> **缺口状态：已收口**（有守卫的静默形态已机器化覆盖）。**残余（如实登记）**：卡作者自造桥名仍不可枚举；
> 「改经典脚本注入 + Proxy scope」（方案 B′）属架构级改动、未做。

---

## 一、现象（现象层）

卡脚本以**不带前缀**的形式调用 TH API 时，若该 API 既不在我方的「已实现面」也不在
`TH_UNSUPPORTED_APIS` 清单里，调用点得到的是：

- 若脚本无守卫：`ReferenceError: xxx is not defined`（脚本中断，走 `th: 'script-error'` 通道）；
- 若脚本有 `typeof xxx !== 'undefined'` 守卫：**静默走 else 分支**（我方零感知）。

用户观感：**「这张卡的某个功能没反应」**，而 🧩 面板的「缺 API」清单里**什么都没有**。

---

## 二、机制（机制层）

`dsht-rp-ui/src/client/th-shim.ts` 的裸全局安装逻辑（`buildShimSource` 内，约 2407-2418 行）：

```js
// 裸全局（真 TH predefine.js 同款行为：脚本写 getVariables(...) 不带 TavernHelper. 前缀）
var bareGlobals = ${bareGlobalsJs};               // = SHIM_LOCAL_APIS ∪ SHIM_BRIDGE_APIS
for (var li = 0; li < bareGlobals.length; li++) {
  var ln = bareGlobals[li];
  if (typeof TH[ln] === 'function') window[ln] = TH[ln];
}
...
for (var gi = 0; gi < unsupported.length; gi++) { window[unsupported[gi]] = TH[unsupported[gi]]; }
```

即 window 上只挂了两类：**已实现面** + **清单内不支持面**。

对照：`TavernHelper.<未知名>` 形式**已有护栏** —— `window.TavernHelper` 是 Proxy，
`get` trap 命中未知键即 `reportMissing('TavernHelper.' + key)` + 返回 stub：

```js
// th-shim.ts:2363-2371
window.TavernHelper = new Proxy(TH, {
  get: function (target, key) {
    if (typeof key === 'string' && !(key in target)) {
      reportMissing('TavernHelper.' + key);
      return unsupportedStub('TavernHelper.' + key);
    }
    return target[key];
  },
});
```

`reportMissing` 是三重出声（`th-shim.ts:530-536`）：去重 → `console.warn` → `post({th:'missing'})`
→ 面板「缺 API：…」（`RpScriptHost.tsx:1455-1457`）。

**缺口 = 两条路径的不对称**：带前缀有 Proxy 兜底，裸全局没有。

---

## 三、为什么不是「静默 undefined」（严重度校准）

判据引用 `rp-workspace/docs/ST-COMPAT-PACT.md` B3 条：「未覆盖的 API 调用必须记名上报……
不允许静默 undefined」。

严格读判据，本缺口**部分违反**：

| 脚本写法 | 实际行为 | 是否违反 B3 |
|---|---|---|
| 裸全局 + 无守卫 | `ReferenceError` ⇒ `th:'script-error'` 出声 | ❌ 不违反（**出声了**，只是归到「错误」而非「缺 API」） |
| 裸全局 + `typeof` 守卫 | 静默走 else 分支 | ✅ **违反**（零留痕） |
| 带前缀（任意写法） | Proxy 记名 ⇒ 面板可见 | ❌ 不违反 |

**结论：严重度 = 中**。它不是「必崩」，而是「**归类错误 + 守卫形态下静默**」。
用户看到「脚本错误」而非「缺 API XXX」，排障路径完全不同（前者像是卡的 bug，
后者是明确的能力边界）。

---

## 四、为什么不能「再补一份清单」（架构层）

直觉方案是「把第三类名字也加进 `window` 的挂载清单」。**不可行**，因为：

**第三类名字我方根本不可能穷举**。清单只能枚举**已知**名字，而「未知名字」按定义
不在清单里。当前清单（`TH_UNSUPPORTED_APIS` 47 项 + `KNOWN_TH_APIS` 常见已支持面）
是**对 ST/TH 已知 API 面的枚举**；而第三方卡（含 MVU 新版本、作者自造桥）会引入
**枚举不到的名字**。加清单只能缓解它恰好覆盖到的部分——**不改变问题的性质**。

这正是本项目主力缺陷族 P-1b 的镜像：**「用枚举覆盖无限集合」是不可能的**。
（同族：F2 的「用阈值表达集合」——阈值之后的新内容必失效；此处「枚举之后的新名字必漏」。）

---

## 五、可能的方案与各自代价（不实施，仅评估）

### 方案 A：`window` 装 Proxy
给全局装一个 `Proxy`，`get` trap 里对不在白名单的字符串键记名。

- **风险：极高**。`window` 上除脚本面外还有大量宿主语义（`window.parent` /
  `window.name` / `window.top` / `window.location` / `window.fetch` / 事件处理器…），
  Proxy 会拦截**所有**属性读取，极易破坏宿主与第三方库（jQuery 的 `in` 检查、
  `typeof` 探测、`with` 语义）。
- 判定：**不采用**。

### 方案 B：脚本作用域包装（`with` + Proxy scope）
把每个脚本的源码包进一个函数，函数体外层套 `with (proxyScope) { ... }`，
proxy 的 `has` trap 恒返回 `true` 以便拦截，未知名走 `get` trap 记名。

- 代价：需要**改脚本执行入口**（`RpScriptHost` 的注入形态），且要处理：
  严格模式禁用 `with`（脚本可能是 ESM/严格模式）· `var` 提升语义变化 ·
  `this` 绑定 · 全局赋值（`xxx = 1` 落到 scope 而非 window）· 与 `window.foo` 显式写法的交互。
- 风险：**高**。改动面涉及所有既有脚本的运行时语义，回归面 = 全部 TH 相关单测（76 项）+ 真实卡。
- 判定：**可行但需专门一轮**，且必须有完整的「正常脚本零额外 warn」负控。

### 方案 C：只修「出声归类」（最小改动）
不动执行语义，只在**已有的 `window.onerror` / `script-error` 通道**上做**归因增强**：
捕获 `ReferenceError: X is not defined` 时，把 `X` 与 `KNOWN_TH_APIS` 比对——
若名字形态像 TH API（驼峰 + 出现在卡脚本里），则在面板上同时提示
「疑似未支持的 TH API：X（也可能是本卡自身拼写错误）」。

- 代价：小。只需在 `script-error` 处理处加一层归因（`RpScriptHost.tsx:615-619` 附近）。
- 局限：**仍覆盖不到「有守卫的静默形态」**；且归因是启发式（可能误报为 API 而实为拼写错）。
- 判定：**可作过渡**，但不足以满足 B3 的字面判据。

---

## 六、建议的落地顺序（留给后续轮次）

1. **先做方案 C**（低成本、立即改善排障体验、可配正负控单测）；
2. **再评估方案 B**：需要一轮专门工作，含
   - 严格模式 / ESM 兼容性验证（用真实卡语料跑）
   - 「正常脚本零额外 warn」负控（防 Proxy 把宿主属性读也记成 missing）
   - 与 `window` 显式写法的交互测试
3. 方案 A 永久排除（风险不可接受）。

**在此之前，本缺口登记在 `docs/MOBILE-TEST-METHODOLOGY.md` §六 开放项**，
状态标 ⬜，不假装已解决（R7）。

---

## 七、方法学产出（设计哲学层）

本评估提炼出一条**可复用判据**，建议并入 §5.4：

> **P-14（枚举 vs 无限集合）**：凡「被拦截对象的成员集**不可枚举**」（如全局作用域、
> 第三方运行时对象、用户自定义命名空间），**不得用「名单 + 兜底 stub」实现覆盖**
> ——名单之后新增的成员必然漏。应以**代理/拦截**（Proxy / 作用域包装）实现，
> 让「未知」本身成为可观测事件。
>
> 与 P-2（集合 vs 阈值）同族：两者都是「用一个有限表达去覆盖一个会增长/无限的集合」。
> P-2 的失效形态是「阈值之后失效」，P-14 的失效形态是「名单之后漏报」，**理论根因相同**。

**判据的应用检查点**（写入后续所有 API 面 / 全局注入类工作）：
- 拦截面是否可枚举？不可枚举 ⇒ 必须用 Proxy/包装，不能只用名单。
- 若暂用名单，是否至少有「未知形态的兜底出声」？（如方案 C）

---

## 八、【已实施】方案 C：裸全局 ReferenceError 归因增强（2026-09-14 第十八轮）

### 8.1 做了什么

在 `dsht-rp-ui/src/client/th-shim.ts` 的 `window.onerror` / `unhandledrejection` 处理处
新增 `attributeReferenceError(msgText)`：从 `ReferenceError: X is not defined` 提取名字 X，
经三重排除后**追加**记入「缺 API」通道（复用既有 `reportMissing` ⇒ console.warn + post 信标 + 面板清单）。

三重排除（防噪音掩盖真信号，P-14 同族纪律）：
1. 已在 `bareGlobals`（已实现面）⇒ 不归因（保守）；
2. 已在 `unsupported`（清单内已知不支持）⇒ 不归因（它有 stub，不是本缺口）；
3. 在 `BUILTIN_GLOBAL_ALLOW`（JS 内建 + shim 已挂的非 TH 语义面 + 浏览器宿主对象，约 90 项）⇒ 不归因。

形态判据：必须像 API 名（驼峰 `aB` 或下划线式 `a_b`）；全大写常量、单字母、`_x` 一律不归因。

**关键：不动执行语义、不吞原错误** —— 归因是**追加**信息，`script-error` 原样上报（零回归面）。

### 8.2 判据（M3 单测 9 项，`tests/th-script-runtime.spec.ts`）

| 类型 | 用例 |
|---|---|
| 正控 | 未支持的驼峰名 ⇒ 进 missing 通道 **且** 原错误仍上报 |
| 负控 | `JSON`（JS 内建）不误标；`SillyTavern`/`Mvu`（shim 已挂）不误标；`getVariables`（已实现面）不误标；`UNSUPPORTED_APIS[0]`（清单内）不误标 |
| 边界 | 非 ReferenceError（`TypeError`）不归因；全大写常量 / `_x` 不归因；下划线式 `some_unknown_api` **要**归因 |
| 幂等 | 同名重复报错只记一次 missing；原错误仍每次上报 |
| 结构 | `BUILTIN_GLOBAL_ALLOW` 已导出且含三类代表项（防被清空） |

### 8.3 仍未覆盖的（如实登记，R7）

**「有 `typeof X !== 'undefined'` 守卫的静默形态」仍未覆盖** —— 该形态我方**零感知**
（脚本静默走 else 分支，不产生任何错误事件）。覆盖它需要 §五 的**方案 B**（脚本作用域
Proxy 包装），代价与风险见该节，**仍属 B5「需专门一轮」**。
故本缺口状态记为「**部分收口**」，不写成「已解决」。

> ⚠️ **本条已被第二十四轮 W3 取代**（方案 B 不可用、缺口已用另一条路线收口）——见 §九。
> 上段文字**保留原样**，因为它是当时判定的真实记录（R7：不美化历史结论）。

---

## 九、【已实施 · 2026-09-15 第二十四轮 W3】缺口收口 —— 但路线与 §五 预判不同

### 9.1 方案 B 被**决定性实验**证否（不是「风险高」，是「不可用」）

卡脚本正文以 **`<script type="module">`** 注入 iframe（`th-shim.ts:3011`）。
ESM = 严格模式 ⇒ **`with` 是语法错误**。四组实验：

| 组 | 形态 | 结果 |
|---|---|---|
| A | 经典脚本 + `with` | ✅ 可运行（正控：装置有区分力） |
| B | ESM 模块 + `with` | ❌ `SyntaxError: Strict mode code may not include a with statement` |
| C | ESM 模块，无 `with` | ✅ 可运行（负控） |
| D | `node:vm` 经典语义 + `with` | ✅ **可运行** ← 现有单测装置（`vm.runInContext`）的「假绿面」 |

⇒ §五 对方案 B 的判定「**可行但需专门一轮**」**已失效**，应改为「在现注入形态下不可用」。
唯一可能的替代（方案 B′ = 改成经典脚本注入）会改变脚本执行语义（严格模式、`import`），
属架构级改动，**未做**（需单独立项）。

### 9.2 §四 的论证修正：「第三类名字」要分成两半

- **卡作者自造桥名** ⇒ 确实不可枚举 ⇒ **P-14 在这里成立**；
- **真 TH 自己提供的 API 面** ⇒ **有限的、可枚举的**（官方 `@types/function/*.d.ts` 给出 144 项，
  逐个到产物 `dist/index.js` 核实运行时键 ⇒ **141 项**有运行时事实）。

⇒ 真根因 = **「真 TH 的面」与「我方手写静态清单」两份清单没对齐**（P-1 家族），
而非「无限集合漏了一个」。

### 9.3 判据的选取（四轮，每轮都被自己的数据否掉一部分 —— P-29/P-30 家族）

| 实验 | 判据 | 结果 | 被什么否掉 |
|---|---|---|---|
| ② | 正则抽 `typeof X` + 「自己声明过」启发式 | 报 14 项 | 绝大多数**假阳性**（同文件几万行后确有函数声明；正则收集不到函数提升） |
| ③ | TypeScript **符号解析** | 报 4 项（自证 18/18） | ✅ 可用 |
| ④ | 我方**三清单**当挂载面代理 | 差 29 项 | 清单 ≠ 实际挂载（`window.waitGlobalInitialized` 等另行挂载） |
| ⑤ | **真跑 `buildShimSource` + 枚举沙箱 window** | 真 TH 144 / 我方 117 / **缺 27** | ✅ **定案**（唯一落在结果、P-24 的判据）。27 项到产物核实剔除 2 项 ⇒ **25 项真缺口** |

### 9.4 修法：按真值形态**三类分流**（产出一条新判据 P-36）

| 类 | 数量 | 处置 | 为什么 |
|---|---|---|---|
| **真实现** | 3 | `errorCatched`（重抛语义从产物取证）/ `getTavernHelperExtensionId` / `initializeGlobal`（补齐与 `waitGlobalInitialized` 的**配对**） | 我方能做出语义等价实现 |
| **异步函数 stub** | 9 | 加进 `TH_UNSUPPORTED_APIS` | 真 TH 返回 **Promise** ⇒ 挂函数 stub 的 `typeof` 形态与基准**一致** |
| **值・同步型 getter** | 13 | 新常量 `TH_FACE_VALUE_NAMES`，挂 getter：`get(){ reportMissing(n); return undefined }` | 真 TH 是**值**（`default_preset`）或**同步函数**（`getPersonaIds(): string[]`）⇒ 挂函数 stub 会让 `typeof` 变 `function` ⇒ 守卫**通过** ⇒ 拿到 Promise 后 `.map()` ⇒ **TypeError 抛错，比原状更坏** |

**关键纪律**：getter 方案做到「**保持 `undefined` 语义 + 首次读取即出声**」——
同时满足 B3 的两半（「不允许静默 undefined」+「必须记名上报」）。
「补错形态」严格劣于「不补」：不补 = 脚本走 else 安全降级；补错 = 脚本走进会抛错的路。

### 9.5 机器化与实测

- 常驻门禁**第 11 项** `scripts/audit-th-face-coverage.mjs`（selftest **8/8**）：
  真跑 `buildShimSource` → 枚举 window → 与面清单比对；三类合法状态缺一即红。
  自证含**最关键的正控**「值型被误挂成函数必报」。
- 基准两级（守 GOAL.md **B8**）：仓库内快照 `scripts/data/th-bare-global-face.json` 为默认；
  `$env:TH_ROOT` 存在时以现场为准并对账；两级皆无 ⇒ **exit 2 fail-closed**。
- **实测**：修前真 TH 面 144 / 我方 117 / 缺 27（含 2 项仅声明面）⇒ 修后 **141/141 覆盖 / 静默缺口 0**。

### 9.6 仍未覆盖（R7 如实登记）

1. 卡作者**自造桥名**仍不可枚举（P-14 依然成立，适用面比本文 §四 原述小）；
2. 方案 B′（改经典脚本注入 + Proxy scope）**未做**（架构级改动）；
3. **单测装置语义不等价未修**：`th-script-runtime.spec.ts` 在 `node:vm` **经典语义**下跑脚本正文，
   与真机 `type="module"` 有差异（§9.1 的 [D] 组即此）。登记为**观察项**。
