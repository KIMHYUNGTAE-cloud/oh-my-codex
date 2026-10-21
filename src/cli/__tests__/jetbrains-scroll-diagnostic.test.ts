import * as assert from "assert";
import { describe, it } from "node:test";
import { shouldEmitJetBrainsScrollDiagnostic } from "../index.js";

/**
 * Tests for JetBrains trackpad scroll diagnostic (issue #3872).
 * This tests the detection of JetBrains terminal environments where trackpad
 * scrolling is translated to arrow keys, causing prompt history navigation
 * instead of output scrolling in alternate screen mode.
 */
describe("JetBrains scroll diagnostic", () => {
  it("detects WebStorm terminal via TERM_PROGRAM", () => {
    const env = { TERM_PROGRAM: "WebStorm" };
    assert.ok(shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("detects IntelliJ terminal via TERM_PROGRAM", () => {
    const env = { TERM_PROGRAM: "IntelliJ IDEA" };
    assert.ok(shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("detects JetBrains generic terminal via TERM_PROGRAM", () => {
    const env = { TERM_PROGRAM: "JetBrains-JediTerm" };
    assert.ok(shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("detects JediTerm exactly", () => {
    const env = { TERM_PROGRAM: "JediTerm" };
    assert.ok(shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("detects PyCharm terminal", () => {
    const env = { TERM_PROGRAM: "PyCharm" };
    assert.ok(shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("detects CLion terminal", () => {
    const env = { TERM_PROGRAM: "CLion" };
    assert.ok(shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("detects via TERMINAL_EMULATOR env var", () => {
    const env = { TERMINAL_EMULATOR: "JetBrains-JediTerm" };
    assert.ok(shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("does not emit if --no-alt-screen is already specified", () => {
    const env = { TERM_PROGRAM: "WebStorm" };
    assert.ok(!shouldEmitJetBrainsScrollDiagnostic(["--no-alt-screen"], env));
  });

  it("does not emit for non-JetBrains terminals", () => {
    const env = { TERM_PROGRAM: "iTerm2" };
    assert.ok(!shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("does not emit when TERM_PROGRAM is not set", () => {
    const env = {};
    assert.ok(!shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("handles empty TERM_PROGRAM string", () => {
    const env = { TERM_PROGRAM: "" };
    assert.ok(!shouldEmitJetBrainsScrollDiagnostic([], env));
  });

  it("handles --no-alt-screen among other args", () => {
    const env = { TERM_PROGRAM: "WebStorm" };
    assert.ok(
      !shouldEmitJetBrainsScrollDiagnostic(
        ["--model", "gpt-4", "--no-alt-screen"],
        env,
      ),
    );
  });
});