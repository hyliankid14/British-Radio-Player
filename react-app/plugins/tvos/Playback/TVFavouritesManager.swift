import Foundation
import Observation

@Observable final class TVFavouritesManager {
    static let shared = TVFavouritesManager()
    
    private let appGroupId = "group.com.hyliankid14.bbcradioplayer"
    private let storageKey = "cached_favourite_ids"
    
    private var defaults: UserDefaults {
        UserDefaults(suiteName: appGroupId) ?? UserDefaults.standard
    }
    
    var favouriteIds: [String] = []
    
    private init() {
        loadFavourites()
    }
    
    func loadFavourites() {
        if let saved = defaults.stringArray(forKey: storageKey), !saved.isEmpty {
            favouriteIds = saved
        } else if let standardSaved = UserDefaults.standard.stringArray(forKey: storageKey), !standardSaved.isEmpty {
            favouriteIds = standardSaved
        } else {
            // Default initial favourites: top signature national BBC networks
            favouriteIds = ["radio1", "radio2", "radio4", "radio6", "radio5live"]
            saveFavourites()
        }
    }
    
    func isFavourite(_ stationId: String) -> Bool {
        favouriteIds.contains(stationId)
    }
    
    func toggleFavourite(_ stationId: String) {
        if isFavourite(stationId) {
            removeFavourite(stationId)
        } else {
            addFavourite(stationId)
        }
    }
    
    func addFavourite(_ stationId: String) {
        guard !favouriteIds.contains(stationId) else { return }
        favouriteIds.append(stationId)
        saveFavourites()
    }
    
    func removeFavourite(_ stationId: String) {
        favouriteIds.removeAll { $0 == stationId }
        saveFavourites()
    }
    
    func favouriteStations() -> [TVStation] {
        return TVStationCatalogue.favourites(from: favouriteIds)
    }
    
    private func saveFavourites() {
        defaults.set(favouriteIds, forKey: storageKey)
        UserDefaults.standard.set(favouriteIds, forKey: storageKey)
    }
}
