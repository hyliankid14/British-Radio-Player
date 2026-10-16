#!/usr/bin/env node
/**
 * Applies local fixes to third-party packages that have not shipped a release
 * compatible with the pinned React Native version yet.
 *
 * Each patch is idempotent: applying it twice is a no-op, and an upstream source
 * that no longer matches throws rather than being silently skipped, so a
 * dependency bump cannot quietly drop a required fix. Run automatically via the
 * "postinstall" script in package.json.
 */
const fs = require("node:fs");
const path = require("node:path");

const PATCHES = [
  {
    package: "expo-constants",
    file: "ios/EXConstants.podspec",
    reason:
      "The script phase interpolates $PODS_TARGET_SRCROOT into a `bash -l -c` argument " +
      "without inner quoting, so the inner shell re-splits the path on whitespace. This " +
      "repo's checkout path contains a space, which made the phase exit 127 with " +
      "'No such file or directory' and failed every iOS build",
    replacements: [
      {
        from:
          ':script => "bash -l -c \\"#{env_vars}$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\"",',
        to:
          ":script => \"bash -l -c \\\"#{env_vars}'$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh'\\\"\","
      }
    ]
  },
  {
    package: "expo-constants",
    file: "scripts/get-app-config-ios.sh",
    reason:
      "The `basename $PROJECT_DIR` guard is unquoted, so on a path containing a space it " +
      "returns several lines, the guard fails to match 'Pods', and the script exits 0 " +
      "without ever writing app.config into EXConstants.bundle -- leaving " +
      "Constants.expoConfig null at runtime with no build-time error",
    replacements: [
      {
        from: "PROJECT_DIR_BASENAME=$(basename $PROJECT_DIR)",
        to: 'PROJECT_DIR_BASENAME=$(basename "$PROJECT_DIR")'
      }
    ]
  },
  {
    package: "react-native-track-player",
    file: "android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt",
    reason:
      "React Native 0.86 requires a non-null Bundle in Arguments.fromBundle(), but Track.originalItem is Bundle?",
    replacements: [
      {
        from: "Arguments.fromBundle(musicService.tracks[index].originalItem)",
        to: "Arguments.fromBundle(musicService.tracks[index].originalItem ?: Bundle())"
      },
      {
        from:
          "musicService.tracks[musicService.getCurrentTrackIndex()].originalItem\n            )",
        to:
          "musicService.tracks[musicService.getCurrentTrackIndex()].originalItem ?: Bundle()\n            )"
      }
    ]
  },
  {
    package: "react-native-track-player",
    file: "android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt",
    reason:
      "React Native 0.86's TurboModule interop throws 'returnType == void iff the method is " +
      "synchronous' on any @ReactMethod whose JVM signature is not void; Kotlin infers Job " +
      "from the `= scope.launch { }` body, so 37 methods crash the app at launch",
    replacements: [
      {
        from: "import kotlinx.coroutines.MainScope",
        to: "import kotlinx.coroutines.CoroutineScope\nimport kotlinx.coroutines.MainScope"
      },
      {
        from: "    private val scope = MainScope()",
        to:
          "    private val scope = MainScope()\n" +
          "    /**\n" +
          "     * React Native's TurboModule interop requires a void JVM signature on every\n" +
          "     * @ReactMethod, but Kotlin infers Job from an `= scope.launch { }` body. This\n" +
          "     * wrapper keeps the fire-and-forget coroutine -- and the `return@launch` labels\n" +
          "     * used inside it -- while giving the enclosing function a Unit return type.\n" +
          "     */\n" +
          "    private fun launch(block: suspend CoroutineScope.() -> Unit) {\n" +
          "        scope.launch(block = block)\n" +
          "    }"
      },
      {
        from: "callback: Promise) = scope.launch {",
        to: "callback: Promise) = launch {"
      },
      {
        from: "callback: Promise) =\n        scope.launch {",
        to: "callback: Promise) =\n        launch {"
      }
    ]
  },
  {
    package: "react-native-track-player",
    file: "android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt",
    reason:
      "MusicService extends HeadlessJsTaskService and emits events through reactNativeHost, " +
      "which React Native 0.86 forbids in the New Architecture ('You should not use " +
      "ReactNativeHost directly in the New Architecture') -- this killed the app on the first " +
      "playback-state event",
    replacements: [
      {
        from:
          "import com.facebook.react.HeadlessJsTaskService\n" +
          "import com.facebook.react.bridge.Arguments\n",
        to:
          "import com.facebook.react.HeadlessJsTaskService\n" +
          "import com.facebook.react.ReactApplication\n" +
          "import com.facebook.react.bridge.Arguments\n" +
          "import com.facebook.react.bridge.ReactContext\n"
      },
      {
        from:
          "    @MainThread\n" +
          "    private fun emit(event: String, data: Bundle? = null) {\n" +
          "        reactNativeHost.reactInstanceManager.currentReactContext\n" +
          "            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)\n" +
          "            ?.emit(event, data?.let { Arguments.fromBundle(it) })\n" +
          "    }",
        to:
          "    /**\n" +
          "     * The New Architecture throws from HeadlessJsTaskService.getReactNativeHost(), so\n" +
          "     * the ReactContext is reached through the application's ReactHost instead.\n" +
          "     */\n" +
          "    private fun currentReactContext(): ReactContext? =\n" +
          "        (application as? ReactApplication)?.reactHost?.currentReactContext\n" +
          "\n" +
          "    @MainThread\n" +
          "    private fun emit(event: String, data: Bundle? = null) {\n" +
          "        currentReactContext()?.emitDeviceEvent(event, data?.let { Arguments.fromBundle(it) })\n" +
          "    }"
      },
      {
        from:
          "    @MainThread\n" +
          "    private fun emitList(event: String, data: List<Bundle> = emptyList()) {\n" +
          "        val payload = Arguments.createArray()\n" +
          "        data.forEach { payload.pushMap(Arguments.fromBundle(it)) }\n" +
          "\n" +
          "        reactNativeHost.reactInstanceManager.currentReactContext\n" +
          "            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)\n" +
          "            ?.emit(event, payload)\n" +
          "    }",
        to:
          "    @MainThread\n" +
          "    private fun emitList(event: String, data: List<Bundle> = emptyList()) {\n" +
          "        val payload = Arguments.createArray()\n" +
          "        data.forEach { payload.pushMap(Arguments.fromBundle(it)) }\n" +
          "\n" +
          "        currentReactContext()?.emitDeviceEvent(event, payload)\n" +
          "    }"
      },
      {
        from:
          "        val notification = notificationBuilder.build()\n" +
          "        startForeground(EMPTY_NOTIFICATION_ID, notification)\n" +
          "        @Suppress(\"DEPRECATION\")\n" +
          "        stopForeground(true)",
        to:
          "        val notification = notificationBuilder.build()\n" +
          "        try {\n" +
          "            startForeground(EMPTY_NOTIFICATION_ID, notification)\n" +
          "            @Suppress(\"DEPRECATION\")\n" +
          "            stopForeground(true)\n" +
          "        } catch (exception: Exception) {\n" +
          "            // This is only an ANR workaround. Android 12+ throws\n" +
          "            // ForegroundServiceStartNotAllowedException when the service was started from\n" +
          "            // the background, and that must never take the app down.\n" +
          "            Timber.w(exception, \"Could not show the temporary foreground notification\")\n" +
          "        }"
      }
]
  },
  {
    package: "react-native",
    file: "scripts/replace-rncore-version.js",
    reason:
      "With no .last_build_configuration marker the script assumes the installed " +
      "prebuilt React Native core is already the debug one. A Release build leaves the " +
      "release framework there instead, and the release framework does not export " +
      "React's internal C++ symbols, so the next Debug build failed to link with " +
      "'Undefined symbols for architecture arm64: facebook::react::Sealable::Sealable()' " +
      "and every other react:: symbol used by source-built pods such as ExpoModulesCore " +
      "and react-native-screens. Installing the requested variant unconditionally is " +
      "correct either way and costs one tarball extraction after a pod install",
    replacements: [
      {
        from:
          "  // Assumption: if there is no stored last build, we assume that it was build for debug.\n" +
          "  if (!fileExists && configuration === 'Debug') {\n" +
          "    console.log(\n" +
          "      'No previous build detected, but Debug Configuration. No need to replace React-Core-prebuilt',\n" +
          "    );\n" +
          "    return false;\n" +
          "  }\n",
        to:
          "  if (!fileExists) {\n" +
          "    console.log(\n" +
          "      `No previous build recorded. Installing the ${configuration} React Native core, ` +\n" +
          "        'which may differ from the one currently in place',\n" +
          "    );\n" +
          "    return true;\n" +
          "  }\n"
      }
    ]
  },
  {
    package: "react-native",
    file: "third-party-podspecs/replace_dependencies_version.js",
    reason:
      "Same missing-marker assumption as scripts/replace-rncore-version.js, with the same " +
      "consequence: a Release build leaves the release ReactNativeDependencies framework " +
      "installed, so the Debug build that follows cannot resolve the C++ symbols it hides",
    replacements: [
      {
        from:
          "  // Assumption: if there is no stored last build, we assume that it was build for debug.\n" +
          "  if (!fileExists && configuration === 'Debug') {\n" +
          "    console.log(\n" +
          "      'No previous build detected, but Debug Configuration. No need to replace RNDeps',\n" +
          "    );\n" +
          "    return false;\n" +
          "  }\n",
        to:
          "  if (!fileExists) {\n" +
          "    console.log(\n" +
          "      `No previous build recorded. Installing the ${configuration} React Native ` +\n" +
          "        'dependencies, which may differ from the ones currently in place',\n" +
          "    );\n" +
          "    return true;\n" +
          "  }\n"
      },
      {
        from: "  fs.rmSync(finalLocation, {force: true, recursive: true});",
        to:
          "  try {\n" +
          "    fs.rmSync(finalLocation, {force: true, recursive: true, maxRetries: 5, retryDelay: 100});\n" +
          "  } catch {\n" +
          "    spawnSync('rm', ['-rf', finalLocation]);\n" +
          "  }"
      }
    ]
  },
  {
    package: "expo-modules-jsi",
    file: "apple/scripts/build-xcframework.sh",
    reason:
      "Strip C++ type extensions (^extension __ObjC) with both dot and double-colon syntax " +
      "so modern Swift / Xcode 16+ textual interfaces import cleanly in expo-modules-core",
    replacements: [
      {
        from: "sed '/^extension __ObjC\\./,/^}/d;",
        to: "sed '/^extension __ObjC/,/^}/d;"
      }
    ]
  },
  {
    package: "expo-modules-jsi",
    file: "apple/Products/ExpoModulesJSI.xcframework/ios-arm64/ExpoModulesJSI.framework/Modules/ExpoModulesJSI.swiftmodule/arm64-apple-ios.swiftinterface",
    reason:
      "Remove unresolvable C++ CppError extension from the prebuilt arm64-apple-ios swiftinterface",
    replacements: [
      {
        from: "extension __ObjC::expo.__ObjC::CppError : Swift::Error {\n  public var message: Swift::String {\n    get\n  }\n}\n",
        to: "// [stripped] CppError extension removed for Swift 6 interface compatibility\n"
      }
    ]
  },
  {
    package: "expo-modules-jsi",
    file: "apple/Products/ExpoModulesJSI.xcframework/ios-arm64_x86_64-simulator/ExpoModulesJSI.framework/Modules/ExpoModulesJSI.swiftmodule/arm64-apple-ios-simulator.swiftinterface",
    reason:
      "Remove unresolvable C++ CppError extension from the prebuilt arm64-apple-ios-simulator swiftinterface",
    replacements: [
      {
        from: "extension __ObjC::expo.__ObjC::CppError : Swift::Error {\n  public var message: Swift::String {\n    get\n  }\n}\n",
        to: "// [stripped] CppError extension removed for Swift 6 interface compatibility\n"
      }
    ]
  },
  {
    package: "expo-modules-jsi",
    file: "apple/Products/ExpoModulesJSI.xcframework/ios-arm64_x86_64-simulator/ExpoModulesJSI.framework/Modules/ExpoModulesJSI.swiftmodule/x86_64-apple-ios-simulator.swiftinterface",
    reason:
      "Remove unresolvable C++ CppError extension from the prebuilt x86_64-apple-ios-simulator swiftinterface",
    replacements: [
      {
        from: "extension __ObjC::expo.__ObjC::CppError : Swift::Error {\n  public var message: Swift::String {\n    get\n  }\n}\n",
        to: "// [stripped] CppError extension removed for Swift 6 interface compatibility\n"
      }
    ]
  },
  {
    package: "@react-native/codegen",
    file: "node_modules/hermes-parser/dist/HermesParser.js",
    reason: "Handle HermesParserWASM function vs default export in worker threads",
    replacements: [
      {
        from: "  HermesParserWASM = (0, _HermesParserWASM.default)({",
        to: "  const wasmFn = typeof _HermesParserWASM === 'function' ? _HermesParserWASM : _HermesParserWASM?.default;\n  HermesParserWASM = wasmFn({"
      }
    ]
  },
  {
    package: "@react-native/codegen",
    file: "node_modules/hermes-parser/dist/HermesASTAdapter.js",
    reason: "Handle ParserVisitorKeys direct vs default export fallback in worker threads",
    replacements: [
      {
        from: "    const visitorKeys = _ParserVisitorKeys.HERMES_AST_VISITOR_KEYS[node.type];",
        to: "    const keysTable = _ParserVisitorKeys.HERMES_AST_VISITOR_KEYS || _ParserVisitorKeys.default?.HERMES_AST_VISITOR_KEYS;\n    const nodeChild = _ParserVisitorKeys.NODE_CHILD || _ParserVisitorKeys.default?.NODE_CHILD;\n    const nodeListChild = _ParserVisitorKeys.NODE_LIST_CHILD || _ParserVisitorKeys.default?.NODE_LIST_CHILD;\n    const visitorKeys = keysTable ? keysTable[node.type] : undefined;"
      },
      {
        from: "      if (childType === _ParserVisitorKeys.NODE_CHILD) {",
        to: "      if (childType === nodeChild) {"
      },
      {
        from: "      } else if (childType === _ParserVisitorKeys.NODE_LIST_CHILD) {",
        to: "      } else if (childType === nodeListChild) {"
      }
    ]
  },
  {
    package: "@expo/config-plugins",
    file: "build/ios/utils/Xcodeproj.js",
    reason: "Avoid caching incomplete Paths module during circular require",
    replacements: [
      {
        from: "function Paths() {\n  const data = _interopRequireWildcard(require(\"../Paths\"));\n  Paths = function () {\n    return data;\n  };\n  return data;\n}",
        to: "function Paths() {\n  const p = require(\"../Paths\");\n  if (p && p.getSourceRoot) return p;\n  const data = _interopRequireWildcard(p);\n  if (data && data.getSourceRoot) return data;\n  return p;\n}"
      }
    ]
  },
  {
    package: "@expo/plist",
    file: "build/parse.js",
    reason: "Safely resolve DOMParser from @xmldom/xmldom",
    replacements: [
      {
        from: "    const doc = new xmldom_1.DOMParser({ errorHandler() { } }).parseFromString(xml);",
        to: "    const DOMParser = xmldom_1.DOMParser || xmldom_1.default?.DOMParser || require('@xmldom/xmldom/lib/dom-parser').DOMParser;\n    const doc = new DOMParser({ errorHandler() { } }).parseFromString(xml);"
      }
    ]
  },
  {
    package: "expo",
    file: "node_modules/@expo/cli/build/src/prebuild/clearNativeFolder.js",
    reason: "Fallback to rm -rf when fs.promises.rm fails with ENOTEMPTY on macOS in Node 26",
    replacements: [
      {
        from: "        await Promise.all(folders.map((folderName)=>_fs().default.promises.rm(_path().default.join(projectRoot, folderName), {\n                recursive: true,\n                force: true\n            })));",
        to: "        await Promise.all(folders.map(async (folderName)=>{\n            const target = _path().default.join(projectRoot, folderName);\n            try {\n                await _fs().default.promises.rm(target, {\n                    recursive: true,\n                    force: true\n                });\n            } catch (e) {\n                require('child_process').execFileSync('rm', ['-rf', target]);\n            }\n        }));"
      }
    ]
  },
  {
    package: "@babel/helper-module-transforms",
    file: "lib/index.js",
    reason: "Handle _core.types vs direct @babel/types fallback for directive and directiveLiteral",
    replacements: [
      {
        from: '    if (!hasStrict) {\n      path.unshiftContainer("directives", _core.types.directive(_core.types.directiveLiteral("use strict")));\n    }',
        to: '    if (!hasStrict) {\n      const types = (_core.types && _core.types.directiveLiteral) ? _core.types : require("@babel/types");\n      const dirFn = types.directive || types.default?.directive;\n      const dirLitFn = types.directiveLiteral || types.default?.directiveLiteral;\n      path.unshiftContainer("directives", dirFn(dirLitFn("use strict")));\n    }'
      }
    ]
  },
  {
    package: "react-native",
    file: "scripts/codegen/generate-artifacts-executor/generateSchemaInfos.js",
    reason: "Handle tinyglobby default vs named export for globSync",
    replacements: [
      {
        from: "const {globSync} = require('tinyglobby');",
        to: "const tinyglobby = require('tinyglobby');\nconst globSync = tinyglobby.globSync || tinyglobby.default?.globSync || tinyglobby;"
      }
    ]
  }
];

for (const patch of PATCHES) {
  const target = path.join(__dirname, "..", "node_modules", patch.package, patch.file);
  if (!fs.existsSync(target)) {
    console.warn(`[patch] skipped ${patch.package}: ${patch.file} not found`);
    continue;
  }

  let source = fs.readFileSync(target, "utf8");
  let dirty = false;

  for (const { from, to } of patch.replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      if (patch.package === "expo-modules-jsi" && !source.includes("CppError")) {
        continue;
      }
      throw new Error(
        `[patch] ${patch.package}: expected source not found, upstream has changed:\n${from}`
      );
    }
    source = source.split(from).join(to);
    dirty = true;
  }

  if (dirty) {
    fs.writeFileSync(target, source);
    console.log(`[patch] applied ${patch.package} — ${patch.reason}`);
  }
}
