import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 正式签名（dsht-release.keystore；口令在 keystore.properties——不进 git）
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.dshtavern.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.dshtavern.app"
        minSdk = 28
        targetSdk = 36
        versionCode = 5
        versionName = "0.2.3"
        // ABI 由 -PtargetAbi 控制：arm64-v8a（真机，默认）/ x86_64（PC 模拟器自测）
        // termux node 两种架构都有官方构建（downloads\aarch64 + downloads\x86_64）
        ndk {
            abiFilters += listOf((project.findProperty("targetAbi") as String?) ?: "arm64-v8a")
        }
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps["storeFile"] as String)
                storePassword = keystoreProps["storePassword"] as String
                keyAlias = keystoreProps["keyAlias"] as String
                keyPassword = keystoreProps["keyPassword"] as String
            }
        }
    }

    // 关键：让 libnode.so 解压到 nativeLibraryDir 并保持可执行
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    // assets 里的运行时 zip 不二次压缩（已是 zip）
    androidResources {
        noCompress += listOf("zip", "so")
    }

    // T-27（2026-09-11 心跳 46）：生成 BuildConfig，让 NodeService 能把 APK 自身的
    // versionName/versionCode 作为环境变量交给 node 运行时（「检查更新」的比较基准）。
    // AGP 8 起 buildConfig 默认 false，不显式打开则 BuildConfig 类不存在、编译期报错。
    // 好处是与上方 defaultConfig 的版本号**同源**——不手抄版本号，杜绝漂移。
    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystoreProps.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    // 离线构建：release 的 lintVital 需联网拉 lint-gradle，本机网络不可达 → 关闭
    lint {
        checkReleaseBuilds = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    // Shizuku 通道（W-2）：设备能力经 shell(uid 2000) 执行。
    // 这是本项目**第一个非 AndroidX 依赖**——破例理由见
    // docs/SHIZUKU-RESEARCH-2026-09-21.md §五：自实现 adb 协议（TLS+密钥管理）
    // 是单人项目的净负债，而 Shizuku 是「不 root 超越沙盒」的标准通道。
    // 版本钉死 13.1.5（Maven Central 实测最新；13.1.5 修的是 Android 14 上
    // requestBinderForNonProviderProcess 崩溃）。许可 Apache-2.0，与项目兼容。
    // 【不声明任何 moe.shizuku.manager.permission.*】——其 §6 明确禁止。
    implementation("dev.rikka.shizuku:api:13.1.5")
    implementation("dev.rikka.shizuku:provider:13.1.5")
}
