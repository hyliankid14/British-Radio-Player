package com.hyliankid14.bbcradioplayer

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView

class WidgetConfigActivity : AppCompatActivity() {
    private var appWidgetId: Int = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_widget_config)

        setResult(RESULT_CANCELED)

        appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        val recyclerView = findViewById<RecyclerView>(R.id.widget_station_list)
        val baseRecyclerBottomPadding = recyclerView.paddingBottom
        val root = findViewById<android.view.View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            root.updatePadding(top = bars.top)
            recyclerView.updatePadding(bottom = bars.bottom + baseRecyclerBottomPadding)
            insets
        }
        ViewCompat.requestApplyInsets(root)

        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = WidgetStationPickerAdapter(
            context = this,
            items = WidgetStationPickerAdapter.buildItems()
        ) { stationId ->
            onStationSelected(stationId)
        }
    }

    private fun onStationSelected(stationId: String) {
        WidgetPreference.setStationForWidget(this, appWidgetId, stationId)
        WidgetUpdateHelper.updateAllWidgets(this)

        val result = Intent().apply {
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        }
        setResult(RESULT_OK, result)
        finish()
    }
}
