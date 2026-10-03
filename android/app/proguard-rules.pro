# ProGuard/R8 rules for Astra Android
#
# Added 2026-10-03 (perf audit R3). R8 was OFF (minifyEnabled false) and this
# file was the stock empty template, so a minified build would have stripped the
# classes Capacitor resolves BY NAME at runtime. That is the one change in the
# perf batch that can break the app at runtime rather than merely bloat it —
# hence the explicit rules below. Android's R8 docs require the
# proguard-android-optimize.txt base file for full optimization; see app/build.gradle.

# ---------------------------------------------------------------------------
# Capacitor plugin bridge
# Capacitor discovers plugins reflectively: it reads @CapacitorPlugin, builds a
# name->class map, and invokes @PluginMethod entry points from JavaScript by
# name. R8 cannot see those references, so without these rules the plugin map
# comes up empty and every NativeNtfy.* / CookieEncrypt.* call from the web
# layer fails silently (the web code swallows those failures by design — it
# degrades to "push unavailable, chat still works").
# ---------------------------------------------------------------------------
-keep public class com.getcapacitor.Plugin {}
-keep public class * extends com.getcapacitor.Plugin
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
# PermissionCallback is an annotation applied to METHODS, so it must be matched
# as a class type, not as a top-level annotation type. (The earlier form of this
# rule — `-keep @com.getcapacitor.annotation.PermissionCallback <methods>;` —
# is a ProGuard parse error, not a silent no-op: R8 fails the build.)
-keepclassmembers class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
}
# Plugin method names are the JS-facing contract — obfuscating them breaks
# NativeNtfy.start(), .stop(), .setLiveSession(), .permission(), etc.
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <init>(...);
}
-keep @interface com.getcapacitor.PluginMethod
-keep @interface com.getcapacitor.annotation.CapacitorPlugin
-keep @interface com.getcapacitor.annotation.PermissionCallback
-keep @interface com.getcapacitor.annotation.Permission

# The bridge itself + its JS interface (injected as "window.Capacitor.*").
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }

# ---------------------------------------------------------------------------
# Cordova compatibility layer
# capacitor-cordova-android-plugins is a real Gradle module here; Cordova
# plugins register reflectively through the same mechanism.
# ---------------------------------------------------------------------------
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# ---------------------------------------------------------------------------
# Our own plugins + components
# MainActivity/GateActivity/Service/Receivers are named in AndroidManifest.xml
# (kept automatically), but their plugin subclasses are reached by name.
# ---------------------------------------------------------------------------
-keep class com.jitinnair.astra.NativeNtfy { *; }
-keep class com.jitinnair.astra.CookieEncryptPlugin { *; }

# Kotlin: keep metadata for reflection-free intrinsics safety. R8 full mode
# handles most of this, but kotlinx.coroutines uses reflection for
# debug probes and does not crash without it.
-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisible*Annotations, AnnotationDefault

# OkHttp references optional Conscrypt/BouncyCastle providers that are absent at
# runtime on Android; the warnings are expected and must not be errors.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**

# ShortcutBadger reflects into androidx.core / LauncherApps internals.
-keep class me.leolin.shortcutbadger.** { *; }
-dontwarn me.leolin.shortcutbadger.**

# androidx.security.crypto (EncryptedSharedPreferences) uses Tink, which is
# sensitive to obfuscation of its own protobuf classes.
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# Line numbers make any future crash report readable; source file name hidden.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile