import { Platform } from "react-native";
import { StationRepository, getStreamCandidates } from "../data/stations";
import { NativeAndroid } from "../native/nativeAndroid";
import { Preferences } from "../storage/preferences";
import { ensureNotificationPermissions, getNotifications } from "../notifications/notifications";

export interface RadioAlarmConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  days: string; // Comma-separated: "0" = Sun, "1" = Mon, ..., "6" = Sat
  station: string; // stationId
  ramp: boolean;
  volume: number;
}

const ALARM_NOTIFICATION_PREFIX = "radio-alarm-day-";
const ALARM_NOTIFICATION_ONCE = "radio-alarm-once";

export const RadioAlarm = {
  /**
   * Request notification permissions needed for the alarm to trigger and alert the user.
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === "android") {
      return NativeAndroid.requestNotificationPermission();
    }
    return ensureNotificationPermissions();
  },

  /**
   * Schedules or cancels the alarm based on the current configuration.
   */
  async schedule(config: RadioAlarmConfig): Promise<void> {
    if (!config.enabled || !config.station) {
      await this.cancel();
      return;
    }

    if (Platform.OS === "android") {
      const mask = String(config.days)
        .split(",")
        .filter(Boolean)
        .reduce((acc, day) => acc | (1 << Number(day)), 0);

      const station = StationRepository.getById(config.station);
      const stationName = station?.title ?? config.station;
      const streamUrl = station ? getStreamCandidates(station, "HIGH")[0] : null;

      NativeAndroid.requestNotificationPermission();
      NativeAndroid.scheduleAlarm(
        Number(config.hour),
        Number(config.minute),
        mask,
        String(config.station),
        stationName,
        streamUrl,
        Boolean(config.ramp),
        Number(config.volume)
      );
      return;
    }

    // iOS and other platforms: Use Expo Notifications
    await this.scheduleIosAlarm(config);
  },

  /**
   * Schedules local recurring or one-off notifications on iOS.
   */
  async scheduleIosAlarm(config: RadioAlarmConfig): Promise<void> {
    const Notifications = getNotifications();
    if (!Notifications) return;

    const granted = await this.requestPermissions();
    if (!granted) {
      console.warn("[RadioAlarm] Notification permission not granted, skipping schedule.");
      return;
    }

    await this.cancelIosAlarm();

    const station = StationRepository.getById(config.station);
    const stationTitle = station?.title || "BBC Radio";
    const hour = Number(config.hour);
    const minute = Number(config.minute);
    const daysList = String(config.days)
      .split(",")
      .filter(Boolean)
      .map(Number);

    const alarmData = {
      type: "alarm",
      stationId: config.station,
      ramp: Boolean(config.ramp),
      volume: Number(config.volume)
    };

    if (daysList.length > 0) {
      // Schedule recurring weekly notification for each selected day using CALENDAR trigger
      // Note: Expo Notifications weekday: 1 = Sunday, ..., 7 = Saturday
      // In app config: 0 = Sun, 1 = Mon, ..., 6 = Sat
      for (const day of daysList) {
        const weekday = (day % 7) + 1;
        try {
          await Notifications.scheduleNotificationAsync({
            identifier: `${ALARM_NOTIFICATION_PREFIX}${day}`,
            content: {
              title: "Radio Alarm",
              body: `Wake up with ${stationTitle} – tap to listen`,
              sound: true,
              data: alarmData
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
              weekday,
              hour,
              minute,
              repeats: true
            }
          });
        } catch (e) {
          console.warn(`[RadioAlarm] Failed to schedule recurring alarm for day ${day}:`, e);
        }
      }
    } else {
      // Schedule next one-off occurrence
      const now = new Date();
      const triggerDate = new Date();
      triggerDate.setHours(hour, minute, 0, 0);
      if (triggerDate.getTime() <= now.getTime()) {
        triggerDate.setDate(triggerDate.getDate() + 1);
      }

      try {
        await Notifications.scheduleNotificationAsync({
          identifier: ALARM_NOTIFICATION_ONCE,
          content: {
            title: "Radio Alarm",
            body: `Wake up with ${stationTitle} – tap to listen`,
            sound: true,
            data: alarmData
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate
          }
        });
      } catch (e) {
        console.warn("[RadioAlarm] Failed to schedule one-off alarm:", e);
      }
    }
  },

  /**
   * Cancels the scheduled alarm across platforms.
   */
  async cancel(): Promise<void> {
    if (Platform.OS === "android") {
      NativeAndroid.cancelAlarm();
    }
    await this.cancelIosAlarm();
  },

  /**
   * Cancels all scheduled iOS alarm notifications.
   */
  async cancelIosAlarm(): Promise<void> {
    const Notifications = getNotifications();
    if (!Notifications) return;

    for (let day = 0; day < 7; day++) {
      try {
        await Notifications.cancelScheduledNotificationAsync(`${ALARM_NOTIFICATION_PREFIX}${day}`);
      } catch {
        // Ignore cancellation errors
      }
    }

    try {
      await Notifications.cancelScheduledNotificationAsync(ALARM_NOTIFICATION_ONCE);
    } catch {
      // Ignore
    }
  },

  /**
   * Schedules an alarm from current preferences. Useful on app launch.
   */
  async scheduleFromPreferences(): Promise<void> {
    const enabled = Preferences.getSetting("pref_alarm_enabled", false);
    if (!enabled) return;

    await this.schedule({
      enabled,
      hour: Preferences.getSetting("pref_alarm_hour", 7),
      minute: Preferences.getSetting("pref_alarm_minute", 0),
      station: Preferences.getSetting("pref_alarm_station", ""),
      ramp: Preferences.getSetting("pref_alarm_ramp", true),
      volume: Preferences.getSetting("pref_alarm_volume", 5),
      days: Preferences.getSetting("pref_alarm_days", "1,2,3,4,5")
    });
  },

  /**
   * Triggers an immediate or 2-second test alarm notification so the user can verify
   * that alarms, banners, and sounds work properly on their device/simulator.
   */
  async sendTestAlarm(stationId: string, ramp = true, volume = 5): Promise<boolean> {
    const Notifications = getNotifications();
    if (!Notifications) return false;

    const granted = await this.requestPermissions();
    if (!granted) return false;

    const station = StationRepository.getById(stationId);
    const stationTitle = station?.title || "BBC Radio";

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Radio Alarm (Test)",
        body: `Test alarm for ${stationTitle} – tap to start playback`,
        sound: true,
        data: {
          type: "alarm",
          stationId,
          ramp,
          volume,
          isTest: true
        }
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2
      }
    });

    return true;
  }
};
