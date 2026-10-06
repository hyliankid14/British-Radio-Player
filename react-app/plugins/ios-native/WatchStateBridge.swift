import WatchConnectivity
import Foundation
import UIKit

final class WatchStateBridge: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = WatchStateBridge()
    static let outboundRevisionKey = "watch_snapshot_revision"
    static let inboundRevisionKey = "watch_received_revision"
    private static let cacheDirectoryName = "watch"
    private static let stateFileName = "state.json"
    private static let receivedFileName = "received_state.json"

    private let queue = DispatchQueue(label: "com.hyliankid14.bbcradioplayer.watch-state")
    private var lastRevision = -1
    private var started = false

    private override init() {
        super.init()
        NotificationCenter.default.addObserver(
            forName: UIApplication.didFinishLaunchingNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.start()
        }
    }

    func start() {
        guard !started else { return }
        started = true
        
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
        
        NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.syncIfChanged()
        }
        syncIfChanged()
    }

    private func syncIfChanged() {
        let revision = UserDefaults.standard.integer(forKey: Self.outboundRevisionKey)
        guard revision != lastRevision else { return }
        lastRevision = revision
        queue.async { [weak self] in
            self?.performSync()
        }
    }

    private func performSync() {
        guard WCSession.default.activationState == .activated else { return }
        guard let cachesUrl = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let watchDir = cachesUrl.appendingPathComponent(Self.cacheDirectoryName)
        let stateUrl = watchDir.appendingPathComponent(Self.stateFileName)
        
        do {
            let data = try Data(contentsOf: stateUrl)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            try WCSession.default.updateApplicationContext(json)
        } catch {
            print("Failed to sync watch state: \(error)")
        }
    }
    
    private func saveReceivedState(_ state: [String: Any]) {
        guard let cachesUrl = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let watchDir = cachesUrl.appendingPathComponent(Self.cacheDirectoryName)
        
        do {
            try FileManager.default.createDirectory(at: watchDir, withIntermediateDirectories: true)
            let receivedUrl = watchDir.appendingPathComponent(Self.receivedFileName)
            let data = try JSONSerialization.data(withJSONObject: state)
            try data.write(to: receivedUrl)
            
            DispatchQueue.main.async {
                let current = UserDefaults.standard.integer(forKey: Self.inboundRevisionKey)
                UserDefaults.standard.set(current + 1, forKey: Self.inboundRevisionKey)
            }
        } catch {
            print("Failed to save received watch state: \(error)")
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated {
            queue.async { [weak self] in
                self?.performSync()
            }
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String : Any]) {
        saveReceivedState(applicationContext)
    }
    
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String : Any] = [:]) {
        saveReceivedState(userInfo)
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }
    func sessionWatchStateDidChange(_ session: WCSession) {
        if session.isReachable {
            queue.async { [weak self] in
                self?.performSync()
            }
        }
    }
}
