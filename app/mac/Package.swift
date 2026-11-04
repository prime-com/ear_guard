// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "EarGuardMac",
    platforms: [.macOS("14.2")],
    targets: [
        // Pure logic (ported from src/core/*.ts). No audio, no UI.
        .target(name: "EarGuardCore", path: "Sources/EarGuardCore"),
        // Core Audio capture + menu-bar UI.
        .executableTarget(name: "EarGuardMac", dependencies: ["EarGuardCore"], path: "Sources/EarGuardMac"),
        // `swift run EarGuardSelfTest` — needs no Xcode/XCTest.
        .executableTarget(name: "EarGuardSelfTest", dependencies: ["EarGuardCore"], path: "Sources/EarGuardSelfTest"),
    ]
)
