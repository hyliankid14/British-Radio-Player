import UIKit
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

        // Handle cold start universal links
        if let userActivity = connectionOptions.userActivities.first {
            if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
                _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
            } else {
                _ = RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
            }
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
        if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
            _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
        } else {
            _ = RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
        }
    }
}

