import Foundation
import UIKit

final class ICloudKvsBridge: NSObject, @unchecked Sendable {
    static let shared = ICloudKvsBridge()
    static let outboundRevisionKey = "cloud_snapshot_outbound_revision"
    static let inboundRevisionKey = "cloud_snapshot_inbound_revision"
    static let lastSyncedKey = "cloud_last_synced_at"
    static let kvsKey = "brp_cloud_backup_v2"
    private static let cacheDirectoryName = "cloud"
    private static let outboundFileName = "cloud_outbound.json"
    private static let receivedFileName = "cloud_received.json"

    private let queue = DispatchQueue(label: "com.hyliankid14.bbcradioplayer.icloud-kvs")
    private var lastOutboundRevision = -1
    private var started = false

    private override init() {
        super.init()
    }

    func start() {
        guard !started else { return }
        started = true

        // Listen for remote changes from iCloud
        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: NSUbiquitousKeyValueStore.default,
            queue: nil
        ) { [weak self] notification in
            self?.queue.async {
                self?.handleRemoteChange(notification)
            }
        }

        // Listen for outbound pushes requested from React Native via Settings
        NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.syncOutboundIfChanged()
        }

        // Trigger initial synchronize
        queue.async { [weak self] in
            NSUbiquitousKeyValueStore.default.synchronize()
            self?.checkInitialRemoteState()
            self?.syncOutboundIfChanged()
        }
    }

    private func checkInitialRemoteState() {
        guard let jsonString = NSUbiquitousKeyValueStore.default.string(forKey: Self.kvsKey),
              !jsonString.isEmpty else { return }
        saveReceivedJson(jsonString)
    }

    private func handleRemoteChange(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let reason = userInfo[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int else {
            checkInitialRemoteState()
            return
        }

        if reason == NSUbiquitousKeyValueStoreServerChange || reason == NSUbiquitousKeyValueStoreInitialSyncChange {
            if let changedKeys = userInfo[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] {
                if changedKeys.contains(Self.kvsKey) {
                    checkInitialRemoteState()
                }
            } else {
                checkInitialRemoteState()
            }
        }
    }

    private func syncOutboundIfChanged() {
        let revision = UserDefaults.standard.integer(forKey: Self.outboundRevisionKey)
        guard revision != lastOutboundRevision else { return }
        lastOutboundRevision = revision
        queue.async { [weak self] in
            self?.performOutboundPush()
        }
    }

    private func performOutboundPush() {
        guard let cachesUrl = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let cloudDir = cachesUrl.appendingPathComponent(Self.cacheDirectoryName)
        let outboundUrl = cloudDir.appendingPathComponent(Self.outboundFileName)

        do {
            let data = try Data(contentsOf: outboundUrl)
            guard let jsonString = String(data: data, encoding: .utf8), !jsonString.isEmpty else { return }
            NSUbiquitousKeyValueStore.default.set(jsonString, forKey: Self.kvsKey)
            let success = NSUbiquitousKeyValueStore.default.synchronize()
            if success {
                let now = ISO8601DateFormatter().string(from: Date())
                UserDefaults.standard.set(now, forKey: Self.lastSyncedKey)
                print("[ICloudKvsBridge] Pushed backup to iCloud KVS successfully at \(now)")
            } else {
                print("[ICloudKvsBridge] NSUbiquitousKeyValueStore.synchronize() returned false")
            }
        } catch {
            print("[ICloudKvsBridge] Failed to read outbound JSON: \(error)")
        }
    }

    private func saveReceivedJson(_ jsonString: String) {
        guard let cachesUrl = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let cloudDir = cachesUrl.appendingPathComponent(Self.cacheDirectoryName)

        do {
            try FileManager.default.createDirectory(at: cloudDir, withIntermediateDirectories: true)
            let receivedUrl = cloudDir.appendingPathComponent(Self.receivedFileName)
            try jsonString.write(to: receivedUrl, atomically: true, encoding: .utf8)
            let rev = UserDefaults.standard.integer(forKey: Self.inboundRevisionKey)
            UserDefaults.standard.set(rev + 1, forKey: Self.inboundRevisionKey)
            let now = ISO8601DateFormatter().string(from: Date())
            UserDefaults.standard.set(now, forKey: Self.lastSyncedKey)
            print("[ICloudKvsBridge] Saved received iCloud state (revision \(rev + 1))")
        } catch {
            print("[ICloudKvsBridge] Failed to save received iCloud state: \(error)")
        }
    }
}
