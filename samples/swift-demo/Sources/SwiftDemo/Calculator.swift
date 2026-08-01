// The world's smallest testable Swift surface.
public struct Calculator {
    public init() {}

    public func add(_ a: Int, _ b: Int) -> Int { a + b }

    public func divide(_ a: Int, _ b: Int) -> Int? {
        guard b != 0 else { return nil }
        return a / b
    }
}
