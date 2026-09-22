# W-E 调研：DSH 终端（node-pty）在 bionic 路线上的打通方案（2026-09-21）

> GOAL-ANDROID-GAP-2026-09-21 的 W-E 决策点交付物。
> 结论先行：**走「NDK 进构建链 + 自编译 node-pty（上游源码）」单一路径**；
> 第三方 prebuild（node-pty-android-arm64）经 ELF 实证**不可直接使用**；
> 自研 JNI pty 桥**不需要**（node-pty 自编译已覆盖且 x86_64 可自验）。
> 实施另立 goal，本文是决策依据。
>
> **★ 2026-09-21 修订（W-1 实施期实证，推翻本文原假设）**：原文称「bionic 无
> `openpty()/forkpty()`，需 ~50 行 shim」——**该假设错误**。NDK 编译探针与
> `llvm-readelf` 双实证：**bionic 自 API 23 起在 libc 内原生提供
> `openpty` / `forkpty` / `ptsname` / `posix_openpt` / `grantpt` / `unlockpt`**，
> NDK 29 的 `<pty.h>` 就在 `sysroot/usr/include/`。⇒ **零 shim、零额外库**
> （`-lutil` 也不需要）。详见文末附录 B。

## 现状

- DSH web 的内置终端依赖 `node-pty`（原生模块）；我方 [stubs/node-pty](file:///d:/DSH%20RolePlay/rp-workspace/stubs/node-pty)
  是受控报错 stub——终端功能整体不可用（唯一「不可用但安静」的大功能面）。
- ~~bionic 的根本障碍：glibc 的 `openpty()/forkpty()`（libutil）在 bionic **不存在**。~~
  **【已推翻】** bionic 自 API 23 起**原生提供** openpty 族（全部由 libc 提供，
  见附录 B 实证）。真正的障碍只剩「node-pty 官方 prebuild 是 glibc 编译，
  bionic 加载不了」——即**必须用 NDK 自编译，但不需要任何 shim**。

## 候选路径与实证

### 路径 ① 第三方 prebuild：`node-pty-android-arm64`（DioNanos，MIT）——❌ 不可用

npm 上唯一现成的 Termux 向 node-pty 分支（周下载量 14，生态证据单薄）。本地 POC 实证：

- **needed 库可满足**：`libc/liblog/libc++_shared/libdl/libm`——`libc++_shared.so` 我们
  jniLibs 已有（实证 [fetch-native-libs 清单](file:///d:/DSH%20RolePlay/rp-workspace/scripts/fetch-native-libs.mjs)）；
- **致命伤（dynsym 实证）**：`openpty / forkpty / ptsname` 三个符号在 prebuild 里是
  **UNDEFINED**——它期待外部环境提供 openpty 实现（其 runpath 指向 Termux 的
  `$PREFIX/lib`，即假设 Termux 用户自己装了某个提供者；Termux 官方仓库**并没有**
  libandroid-pty 包，packages/ 下 404 实证）。
- ⇒ 在我们的 app 环境直接 `dlopen` 必炸 `undefined symbol: openpty`。
- 另外两个次要害：arm64-only（x86_64 模拟器永远无法自验）；native 二进制信任面
  （我们的传统是 deb 级 SHA256 + 可完整重建，这个 prebuild 不满足「可重建」）。

### 路径 ② 自研 JNI pty 桥（~100 行 C + JS 桥）——不选（被 ③ 覆盖）

直接实现 `posix_openpt→grantpt→unlockpt→ptsname_r→open` 主从 fd 对，再喂给
node 侧。功能上够用，但要自己维护一套 node 侧 API 与 DSH terminal 的对接补丁——
而 DSH terminal 要的是 `require('node-pty')` 的标准形态，自研桥等于重新发明
node-pty 的 JS 面，工作量严格大于直接编译 node-pty。

### 路径 ③ NDK 进构建链 + 自编译 node-pty（上游源码）——✅ 选它

DioNanos fork 的做法（也是 Codex/Copilot 的 Termux 分支的做法）证明可行：
node-pty 的 unix 侧源码（pty.cc 等少数 .cc）用 Android NDK 的 clang 直接编译。

**【2026-09-21 修订】** 原方案含「`openpty/forkpty` 用 ~50 行 shim 补齐」——
**实证后此步完全删除**：bionic libc 原生提供，`-lutil` 也不需要（附录 B）。
实际链接需求 = 只连 `libc.so` + `libdl.so`。

**成本账**：

| 项 | 成本 |
|---|---|
| NDK 引入 | 构建机一次性 ~1.5GB（SDK 已在；`sdk/ndk/<ver>` 的 Windows prebuilt clang 直接可用）；CI 同步骤 |
| C 编译步骤 | build-dsht.ps1 加一个 Step：双架构各编一次（`--target=aarch64-linux-android28` / `x86_64-linux-android28`），输出进 jniLibs |
| ~~openpty shim~~ | **【已删除】零 shim**——bionic libc 原生提供（附录 B 实证） |
| node-pty 源码 | pin 上游版本 + SHA256（fetch-native-libs 同款纪律）；与 node 24 的 N-API 兼容性上游持续维护 |
| 部署形态 | `pty.node` 伪装 `libdsht-pty-node.so`？—— **不需要**：`.node` 是 dlopen 不是 execve，SELinux 不管 dlopen（runtime/lib 里 dlopen 先例已在：带版本号 so 全套在跑）。npm alias `node-pty@npm:<我们的包>` 或直接覆盖 stub 目录 |

**决定性论据（为什么 ③ 而不是修补 ①）**：③ 双架构都能出——**x86_64 模拟器可以自验**
（app 域 spawn bash rc=0 + DSH 终端 UI 实测全都能在我们的自动化面里跑）；
① 连自验都不可能（arm64-only prebuild 在 x86_64 模拟器上无法加载）。
能自验是我们门禁体系的生命线，这一条单独就足以定案。

**风险与缓释**：
- NDK 版本漂移 → pin 具体 NDK 版本号 + 构建期检查（fetch-native-libs 同款「先检查再跑」）；
- node-pty 上游 API 变更 → pin commit/版本 + 一个「pty spawn bash --version rc=0」的
  构建期门禁（PC 侧交叉编译产物没法本地跑，但可用 ELF dynsym 静态断言：UND 符号
  全集 ⊆ {libc/liblog/libc++_shared/libdl/libm 能提供者}——本调研的 dynsym-check.mjs
  就是现成判据雏形）；
- DSH terminal 的唤起面可能还有别的 native 依赖 → 实施时按报错逐项过（terminal-bash
  补丁先例：DSH 的终端面我们已经接过一半）。

## 决策

1. **采纳路径 ③**，实施另立 goal（估一个独立工作面：NDK 引入 + shim + 编译步骤 +
   stub 替换 + x86_64 模拟器 app 域 rc=0 实证 + 门禁化）。
2. 路径 ①（prebuild）**归档为反例**：npm 上「看起来正好有」的 native 包，
   dynsym 不过就一票否决——这条判据本身建议沉淀进 dsh-plugin-lint 的 Android 面。
3. 在打通前维持 stub + 文档如实标注「内置终端不可用」。

## 附录：POC 实证记录（2026-09-21）

- `npm pack node-pty-android-arm64@1.1.0` → `prebuilds/android-arm64/pty.node`（61,336 B）；
- `elf-needed.mjs`：needed = libc/liblog/libc++_shared/libdl/libm（均可满足）；
- 自研 `dynsym-check.mjs`（tmp/pty-poc/）：`openpty / forkpty / ptsname` = **UNDEFINED**，
  `posix_openpt / grantpt / unlockpt` = 无引用（即 shim 不在二进制内）；
- Termux 官方仓库 `packages/libandroid-pty` = 404（无此包）；
- 我方 `libandroid-support.so`（runtime 已在）不含 openpty 族符号（dynsym 实证）。

## 附录 B：bionic 原生 PTY 支持实证（2026-09-21 W-1 实施期新增）

**假设被推翻**：原文（及多数二手资料）称「bionic 无 openpty/forkpty，需从
`posix_openpt` 组合 shim」。用 NDK 直接做编译探针，结论相反。

**探针**：`rp-workspace/tmp/pty-probe.c` —— 调用 `openpty` / `ptsname` /
`forkpty` / `posix_openpt` / `grantpt` / `unlockpt`。

**实证 1（编译链接）**：NDK 29.0.14033849 双架构编译**均 exit=0**：
```
aarch64-linux-android28-clang  pty-probe.c  →  exit 0
x86_64-linux-android28-clang   pty-probe.c  →  exit 0
```

**实证 2（符号来源，`llvm-readelf --dyn-syms`）**：全部符号标 `@LIBC`：
```
 4: ... UND openpty@LIBC        7: ... UND forkpty@LIBC
 6: ... UND ptsname@LIBC        8: ... UND posix_openpt@LIBC
 9: ... UND grantpt@LIBC       10: ... UND unlockpt@LIBC
```

**实证 3（NEEDED 全集）**：只有 `libdl.so` + `libc.so`——**无 libutil**：
```
 0x01 (NEEDED)  Shared library: [libdl.so]
 0x01 (NEEDED)  Shared library: [libc.so]
```

**实证 4（头文件在场）**：`$NDK/toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/include/pty.h`
存在，自述 `openpty/forkpty` **Available since API level 23**
（`__INTRODUCED_IN(23)`）——与我们 `minSdk = 28` 兼容，余量充足。

**唯一编译报错**：`TIOCPTYGNAME` 未声明（bionic 无此 ioctl 宏）。但 node-pty
`pty.cc` 只在 `#if defined(__APPLE__)` 分支用它（第 717 行注释「Use
TIOCPTYGNAME instead of ptsname()」在 macOS 路径），**linux 分支走 `ptsname()`
——bionic 有**。⇒ 对 node-pty linux 编译路径**零影响**。

**结论**：任务从「需自研 shim + 审计第三方信任面」降级为
**「配置 NDK 交叉编译参数即可」**——W-1 的成本与风险都显著低于原估。
`-lutil` 在 `binding.gyp` 里需删（bionic 无独立 libutil，符号在 libc 内，
保留 `-lutil` 会链接失败）。
