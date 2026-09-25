import SwiftUI
import UIKit
import CarPlay
import Combine

@main
struct BBCRadioPlayerApp: App {
    @StateObject private var container: AppContainer

    init() {
        let appContainer = AppContainer()
        _container = StateObject(wrappedValue: appContainer)
        CarPlayManager.shared.attach(container: appContainer)
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(container)
                .preferredColorScheme(colorScheme)
        }
    }

    private var colorScheme: ColorScheme? {
        switch container.appSettingsStore.appTheme {
        case .system:
            return nil
        case .light:
            return .light
        case .dark:
            return .dark
        }
    }
}

final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController,
        to window: CPWindow
    ) {
        CarPlayManager.shared.connect(interfaceController: interfaceController, window: window)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController,
        from window: CPWindow
    ) {
        CarPlayManager.shared.disconnect()
    }
}

@MainActor
final class CarPlayManager {
    static let shared = CarPlayManager()

    private weak var interfaceController: CPInterfaceController?
    private weak var window: CPWindow?
    private var container: AppContainer?
    private var cancellables: Set<AnyCancellable> = []

    private init() {}

    func attach(container: AppContainer) {
        self.container = container
        bindToContainer(container)
        refreshTemplates()
    }

    func connect(interfaceController: CPInterfaceController, window: CPWindow) {
        self.interfaceController = interfaceController
        self.window = window
        refreshTemplates()
    }

    func disconnect() {
        interfaceController = nil
        window = nil
    }

    private func bindToContainer(_ container: AppContainer) {
        cancellables.removeAll()

        container.objectWillChange
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.refreshTemplates()
                }
            }
            .store(in: &cancellables)
    }

    private func refreshTemplates() {
        guard let interfaceController, let container else { return }

        let favouritesTemplate = makeStationsTemplate(
            title: "Favourites",
            stations: container.radioViewModel.favoriteStations,
            emptyMessage: "No favourite stations yet"
        )
        favouritesTemplate.tabTitle = "Favourites"
        favouritesTemplate.tabImage = UIImage(systemName: "star.fill")

        let stationsTemplate = makeStationsTemplate(
            title: "Stations",
            stations: container.stationRepository.allStations(),
            emptyMessage: "No stations available"
        )
        stationsTemplate.tabTitle = "Stations"
        stationsTemplate.tabImage = UIImage(systemName: "dot.radiowaves.left.and.right")

        let nowPlayingTemplate = CPNowPlayingTemplate.shared
        nowPlayingTemplate.tabTitle = "Now Playing"
        nowPlayingTemplate.tabImage = UIImage(systemName: "play.circle.fill")
        updateNowPlayingButtons()

        let root = CPTabBarTemplate(templates: [favouritesTemplate, stationsTemplate, nowPlayingTemplate])
        interfaceController.setRootTemplate(root, animated: true) { _, _ in }
    }

    private func updateNowPlayingButtons() {
        guard let container else { return }
        var buttons: [CPNowPlayingButton] = []
        if let episode = container.audioPlayerService.currentEpisode {
            let isSub = container.favoritesStore.isSubscribed(podcastID: episode.podcastID)
            let img = UIImage(systemName: isSub ? "bookmark.fill" : "bookmark") ?? UIImage()
            let bookmarkBtn = CPNowPlayingImageButton(image: img) { [weak self] _ in
                Task { @MainActor in
                    self?.container?.favoritesStore.toggleSubscription(podcastID: episode.podcastID)
                    self?.updateNowPlayingButtons()
                }
            }
            buttons.append(bookmarkBtn)
        } else if let station = container.audioPlayerService.currentStation {
            let isFav = container.favoritesStore.isFavorite(stationID: station.id)
            let img = UIImage(systemName: isFav ? "star.fill" : "star") ?? UIImage()
            let favBtn = CPNowPlayingImageButton(image: img) { [weak self] _ in
                Task { @MainActor in
                    self?.container?.favoritesStore.toggleFavorite(stationID: station.id)
                    self?.updateNowPlayingButtons()
                }
            }
            buttons.append(favBtn)
        }
        CPNowPlayingTemplate.shared.updateNowPlayingButtons(buttons)
    }

    private func makeStationsTemplate(title: String, stations: [Station], emptyMessage: String) -> CPListTemplate {
        let items: [CPListItem]

        if stations.isEmpty {
            let emptyItem = CPListItem(text: emptyMessage, detailText: nil)
            emptyItem.isEnabled = false
            items = [emptyItem]
        } else {
            items = stations.map { station in
                let subtitle = container?.radioViewModel.showSubtitle(for: station)
                let item = CPListItem(text: station.title, detailText: subtitle)
                item.handler = { [weak self] _, completion in
                    Task { @MainActor in
                        self?.container?.radioViewModel.play(station)
                        completion()
                    }
                }
                return item
            }
        }

        let section = CPListSection(items: items)
        return CPListTemplate(title: title, sections: [section])
    }
}

