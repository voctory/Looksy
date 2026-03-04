# OS Input Surface (Current Scope)

Last updated: March 4, 2026

This document defines the current protocol and host support for OS-level input primitives used by active consumer integrations.

## Supported Commands

These commands are part of `protocol/schema.ts`, simulated host adapters, and covered by tests.

1. `input.moveMouse`
   - Request: `point { x, y, space }`
   - Result: `input.mouseMoved` with echoed `point`
2. `input.click`
   - Request: `button`, optional `point`
   - Result: `input.clicked` with `button` and optional `point`
3. `input.typeText`
   - Request: `text`
   - Result: `input.typed` with `textLength`
4. `input.pressKey`
   - Request: `key`, optional `modifiers[]`, optional `repeat`
   - Result: `input.keyPressed` with `key`, optional `modifiers[]`, and normalized `repeat` (`1` when omitted)
5. `input.scroll`
   - Request: `dx`, `dy`, optional `point`, optional `modifiers[]`
   - Result: `input.scrolled` with echoed values

## Consumer Mapping Scope

Current integration routes are expected to map:

- `click` -> `input.click`
- `hover` -> `input.moveMouse`
- `type_text` -> `input.typeText`
- `press_key` -> `input.pressKey`
- `scroll` -> `input.scroll`

## Explicit Non-Goals (For Now)

The following are intentionally not part of the current input surface:

- Dedicated down/up primitives (`input.mouseDown`, `input.mouseUp`)
- Drag lifecycle primitives in protocol (down -> move -> up orchestration)
- Key hold duration semantics
- Rich keyboard layout abstraction beyond raw `key` + optional `modifiers`

Consumers requiring these semantics should continue to use existing fallback behavior until a dedicated protocol extension lands.
