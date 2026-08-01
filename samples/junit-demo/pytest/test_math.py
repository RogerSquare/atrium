# pytest as the CONTAINER-target JUnit sample (feat-runner-junit-001).
# DEMO_FAIL=1 flips one test red to prove the failing path.
import os

def test_adds():
    assert 2 + 3 == 5

def test_multiplies():
    assert 4 * 5 == 20

def test_fails_when_asked():
    assert os.environ.get("DEMO_FAIL") != "1", "DEMO_FAIL=1 - intentional failure"
