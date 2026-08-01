// swift-tools-version:5.9
// Minimal SPM package used to prove Atrium's Swift test runner end-to-end
// (feat-runner-swift-spm-001). No external dependencies, so `swift test`
// needs no network and runs in seconds.
import PackageDescription

let package = Package(
    name: "SwiftDemo",
    targets: [
        .target(name: "SwiftDemo"),
        .testTarget(name: "SwiftDemoTests", dependencies: ["SwiftDemo"]),
    ]
)
