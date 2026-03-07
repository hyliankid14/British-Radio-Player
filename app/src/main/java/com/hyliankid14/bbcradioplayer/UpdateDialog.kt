package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.text.method.ScrollingMovementMethod
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog

/**
 * Dialog showing available update information.
 * Displays current version, available version, and release notes.
 */
object UpdateDialog {
    
    fun show(
        context: Context,
        releaseInfo: ReleaseInfo,
        onDownload: () -> Unit,
        onDismiss: () -> Unit = {}
    ) {
        // The versionName already encodes the build type at build time:
        //   release: "1.2.0"
        //   debug:   "1.2.0-debug.42"  (commit count since last tag)
        val currentVersion = try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "Unknown"
        } catch (e: Exception) {
            "Unknown"
        }
        
        // Create custom view with version info and release notes
        val scrollView = ScrollView(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        
        val contentView = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setPadding(24, 24, 24, 24)
        }
        
        // Current version text
        contentView.addView(TextView(context).apply {
            text = "Current Version: $currentVersion"
            textSize = 14f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, 16) }
        })
        
        // Available version text
        contentView.addView(TextView(context).apply {
            text = "Available Version: ${releaseInfo.versionName}"
            textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, 16) }
        })
        
        // Release notes label
        contentView.addView(TextView(context).apply {
            text = "What's New:"
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, 8) }
        })
        
        // Release notes text
        contentView.addView(TextView(context).apply {
            text = releaseInfo.releaseNotes.ifBlank { "No release notes available" }
            textSize = 12f
            movementMethod = ScrollingMovementMethod()
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 16)
                height = 150
            }
        })
        
        scrollView.addView(contentView)
        
        // Create and show dialog
        AlertDialog.Builder(context)
            .setTitle("Update Available")
            .setView(scrollView)
            .setNegativeButton("Later") { dialog, _ ->
                dialog.dismiss()
                onDismiss()
            }
            .setPositiveButton("Download") { dialog, _ ->
                dialog.dismiss()
                onDownload()
            }
            .setCancelable(true)
            .setOnCancelListener {
                onDismiss()
            }
            .show()
    }
}
