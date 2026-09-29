package com.hyliankid14.bbcradioplayer

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Parcelable

/** Small compatibility helpers to access parcelables across API levels. */
@Suppress("UNCHECKED_CAST")
fun <T : Parcelable> Intent.getParcelableExtraCompat(name: String, clazz: Class<T>): T? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        this.getParcelableExtra(name, clazz)
    } else {
        @Suppress("DEPRECATION")
        this.getParcelableExtra(name) as? T
    }
}

@Suppress("UNCHECKED_CAST")
fun <T : Parcelable> Bundle.getParcelableCompat(name: String, clazz: Class<T>): T? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        this.getParcelable(name, clazz)
    } else {
        @Suppress("DEPRECATION")
        this.getParcelable(name) as? T
    }
}