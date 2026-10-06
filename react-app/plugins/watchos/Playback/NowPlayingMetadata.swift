import Foundation
import Observation

@Observable final class NowPlayingMetadata {
    static let shared = NowPlayingMetadata()
    
    var showTitle: String = ""
    var showDetail: String = ""
    var segmentArtist: String?
    var segmentTrack: String?
    
    private var timer: Timer?
    private var currentServiceId: String?
    
    private init() {}
    
    func startPolling(serviceId: String) {
        stopPolling()
        currentServiceId = serviceId
        fetchMetadata()
        timer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
            self?.fetchMetadata()
        }
    }
    
    func stopPolling() {
        timer?.invalidate()
        timer = nil
        currentServiceId = nil
        showTitle = ""
        showDetail = ""
        segmentArtist = nil
        segmentTrack = nil
    }
    
    private func fetchMetadata() {
        guard let serviceId = currentServiceId else { return }
        
        let essUrl = URL(string: "https://ess.api.bbci.co.uk/schedules?serviceId=\(serviceId)")!
        var essRequest = URLRequest(url: essUrl)
        essRequest.setValue("BBC Radio Player Watch/1.0", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: essRequest) { [weak self] data, _, _ in
            guard let self = self, let data = data else { return }
            do {
                if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                   let dataObj = json["data"] as? [[String: Any]],
                   let first = dataObj.first,
                   let programmes = first["programmes"] as? [[String: Any]],
                   let now = programmes.first {
                    
                    let title = now["titles"] as? [String: Any]
                    let display = title?["display"] as? String ?? ""
                    let secondary = title?["secondary"] as? String ?? ""
                    
                    DispatchQueue.main.async {
                        self.showTitle = display
                        self.showDetail = secondary
                    }
                }
            } catch {
                print("ESS API Error: \(error)")
            }
        }.resume()
        
        let rmsUrl = URL(string: "https://rms.api.bbc.co.uk/v2/services/\(serviceId)/segments/latest")!
        var rmsRequest = URLRequest(url: rmsUrl)
        rmsRequest.setValue("BBC Radio Player Watch/1.0", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: rmsRequest) { [weak self] data, _, _ in
            guard let self = self, let data = data else { return }
            do {
                if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                   let dataObj = json["data"] as? [[String: Any]],
                   let first = dataObj.first,
                   let titles = first["titles"] as? [String: Any] {
                    
                    let primary = titles["primary"] as? String
                    let secondary = titles["secondary"] as? String
                    
                    DispatchQueue.main.async {
                        self.segmentArtist = primary
                        self.segmentTrack = secondary
                    }
                }
            } catch {
                print("RMS API Error: \(error)")
            }
        }.resume()
    }
}
