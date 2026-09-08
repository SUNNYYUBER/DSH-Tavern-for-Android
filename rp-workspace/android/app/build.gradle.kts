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
        versionCode = 2
        versionName = "0.2.0"
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
}
