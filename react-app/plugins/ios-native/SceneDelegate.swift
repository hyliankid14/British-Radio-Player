import UIKit
import Intents
import React

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = (scene as? UIWindowScene) else { return }
        if let appDelegate = UIApplication.shared.delegate as? AppDelegate, let appWindow = appDelegate.window {
            appWindow.windowScene = windowScene
            window = appWindow
            window?.makeKeyAndVisible()
        }

        // Start mirroring the React widget snapshot into the App Group the WidgetKit
        // extension reads. Safe to call once per scene: the bridge guards itself.
        WidgetStateBridge.shared.start()
        WatchStateBridge.shared.start()

        // Handle cold start deep links
        for context in connectionOptions.urlContexts {
            let options: [UIApplication.OpenURLOptionsKey: Any] = [
                .sourceApplication: context.options.sourceApplication as Any,
                .annotation: context.options.annotation as Any,
                .openInPlace: context.options.openInPlace
            ]
            if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
                _ = appDelegate.application(UIApplication.shared, open: context.url, options: options)
            } else {
                _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: options)
            }
        }

        // Handle cold start universal links and Siri media intents
        if let userActivity = connectionOptions.userActivities.first {
            if let intent = userActivity.interaction?.intent as? INPlayMediaIntent {
                let query = intent.mediaSearch?.mediaName ?? intent.mediaSearch?.artistName ?? intent.mediaItems?.first?.title ?? ""
                let urlString = query.isEmpty ? "bbcradioplayer://voice/resume" : "bbcradioplayer://voice/play?query=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
                if let playUrl = URL(string: urlString) {
                    _ = RCTLinkingManager.application(UIApplication.shared, open: playUrl, options: [:])
                    return
                }
            }

            if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
                _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
            } else {
                _ = RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
            }
        }

        // Drain any pending Siri voice action posted before app launch
        if let pendingUrl = SiriPendingAction.consume(), let url = URL(string: pendingUrl) {
            _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
        }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Drain any pending Siri voice action on warm activation
        if let pendingUrl = SiriPendingAction.consume(), let url = URL(string: pendingUrl) {
            _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            let options: [UIApplication.OpenURLOptionsKey: Any] = [
                .sourceApplication: context.options.sourceApplication as Any,
                .annotation: context.options.annotation as Any,
                .openInPlace: context.options.openInPlace
            ]
            if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
                _ = appDelegate.application(UIApplication.shared, open: context.url, options: options)
            } else {
                _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: options)
            }
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let intent = userActivity.interaction?.intent as? INPlayMediaIntent {
            let query = intent.mediaSearch?.mediaName ?? intent.mediaSearch?.artistName ?? intent.mediaItems?.first?.title ?? ""
            let urlString = query.isEmpty ? "bbcradioplayer://voice/resume" : "bbcradioplayer://voice/play?query=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
            if let playUrl = URL(string: urlString) {
                _ = RCTLinkingManager.application(UIApplication.shared, open: playUrl, options: [:])
                return
            }
        }

        if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
            _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
        } else {
            _ = RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
        }
    }
}
