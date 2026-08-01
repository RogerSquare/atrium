import XCTest
@testable import SwiftDemo

final class CalculatorTests: XCTestCase {
    let calc = Calculator()

    func testAddition() {
        XCTAssertEqual(calc.add(2, 3), 5)
    }

    func testDivision() {
        XCTAssertEqual(calc.divide(10, 2), 5)
    }

    func testDivisionByZeroIsNil() {
        XCTAssertNil(calc.divide(1, 0))
    }

    // Demonstrates the FAIL path end-to-end without editing code: run the
    // suite with DEMO_FAIL=1 in the command (e.g.
    // "DEMO_FAIL=1 swift test --xunit-output junit.xml") and this test fails,
    // which should surface as a red run in Atrium's Tests tab.
    func testFailsWhenAsked() {
        if ProcessInfo.processInfo.environment["DEMO_FAIL"] == "1" {
            XCTFail("DEMO_FAIL=1 — intentional failure to prove the red path")
        }
    }
}
