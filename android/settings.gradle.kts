pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // libXray AAR is dropped into app/libs/ — see android/README.md
        maven { url = uri("https://jitpack.io") }
        flatDir { dirs("app/libs") }
    }
}

rootProject.name = "KhateFreeNet"
include(":app")
