import Foundation
import WatchConnectivity
import Observation

@Observable final class WatchConnectivityManager: NSObject, WCSessionDelegate {
    static let shared = WatchConnectivityManager()
    
    var appState: WatchAppState = WatchAppState()
    var isReachable: Bool = false
    
    private var retryCount = 0
    private let maxRetries = 5
    private let retryDelay: TimeInterval = 15.0
    
    private override init() {
        super.init()
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
    }
    
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated {
            requestInitialSync()
        }
    }
    
    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }
    
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String : Any]) {
        updateState(from: applicationContext)
    }
    
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String : Any] = [:]) {
        updateState(from: userInfo)
    }
    
    private func requestInitialSync() {
        guard retryCount < maxRetries else { return }
        
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(["request": true], replyHandler: nil) { [weak self] error in
                guard let self = self else { return }
                self.scheduleRetry()
            }
        } else {
            scheduleRetry()
        }
    }
    
    private func scheduleRetry() {
        retryCount += 1
        DispatchQueue.global().asyncAfter(deadline: .now() + retryDelay) { [weak self] in
            self?.requestInitialSync()
        }
    }
    
    private func updateState(from dictionary: [String: Any]) {
        do {
            let data = try JSONSerialization.data(withJSONObject: dictionary, options: [])
            let newState = try JSONDecoder().decode(WatchAppState.self, from: data)
            DispatchQueue.main.async {
                self.appState = newState
                self.retryCount = self.maxRetries // Stop retrying on successful sync
            }
        } catch {
            print("Failed to decode WatchAppState: \(error)")
        }
    }
    
    func pushFavouriteToggle(stationId: String) {
        var currentIds = appState.favourite_ids ?? []
        if currentIds.contains(stationId) {
            currentIds.removeAll { $0 == stationId }
        } else {
            currentIds.append(stationId)
        }
        
        appState.favourite_ids = currentIds
        
        var currentOrder = appState.favourite_order ?? []
        if !currentOrder.contains(stationId) {
            currentOrder.append(stationId)
        }
        appState.favourite_order = currentOrder
        
        let dict: [String: Any] = [
            "favourite_ids": currentIds,
            "favourite_order": currentOrder
        ]
        
        WCSession.default.transferUserInfo(dict)
    }
}
