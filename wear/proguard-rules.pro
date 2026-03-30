# ---- Media3 / ExoPlayer ----
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# ---- Wearable Data Layer ----
-keep class com.google.android.gms.wearable.** { *; }

# ---- Coil image loading ----
-dontwarn coil.**

# ---- Strip verbose logging in release ----
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
}

# ---- OkHttp / Conscrypt (transitive from Coil) ----
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**