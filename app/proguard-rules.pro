# Project-specific ProGuard/R8 rules for release builds.
# Keep custom Parcelable implementations that are read via reflection.
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# Keep line numbers in stack traces to improve crash debugging.
-renamesourcefileattribute SourceFile
-keepattributes SourceFile,LineNumberTable
