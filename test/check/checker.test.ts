import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSource, tagSource } from "../support/pipeline.js";
import type { TypedProgram } from "../../src/ast/typed.js";

/**
 * The transfer statement at top-level item `index`, with its assigned
 * communication tag. Tags are assigned after checking (spec §communication-tags), so these
 * go through `tagSource` rather than `checkSource`.
 */
function transferAt(typed: TypedProgram, index: number) {
  const item = typed.items[index];
  assert.ok(item && "statement" in item, `item ${index} is not a statement`);
  const stmt = item.statement;
  assert.ok("transferMode" in stmt, `item ${index} is not a transfer`);
  return stmt;
}


describe("ChoreoBS type checker", () => {
  it("accepts direct communication (spec §example-direct-communication)", () => {
    const typed = tagSource(`
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
`);
    assert.equal(typed.items.length, 2);
    const recv = transferAt(typed, 1);
    assert.equal(recv.transferMode, "direct");
    assert.equal(recv.commTag, "top_0");
  });

  describe("locations are never inferred from context (spec §explicit-location-annotations)", () => {
    it("rejects an omitted parameter location in a local function", () => {
      const { typed, errors } = checkSource(`
function add@alice(a: integer, b: integer@alice): integer@alice {
  return a + b;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("location annotation required on type"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects an omitted return type location in a local function", () => {
      const { typed, errors } = checkSource(`
function f@alice(): integer {
  return 1@alice;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("location annotation required on type"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects an omitted literal location in a local function", () => {
      const { typed, errors } = checkSource(`
function f@alice(): integer@alice {
  return 1;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("location annotation required on literal"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects an omitted array literal location in a local function", () => {
      const { typed, errors } = checkSource(`
function f@alice(): integer@alice {
  let xs: integer[]@alice = [1@alice];
  return 1@alice;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("array literal location annotation required"),
        ),
        JSON.stringify(errors),
      );
    });

    it("still infers a return type when the annotation is absent entirely (§function-return-type-inference)", () => {
      const { typed, errors } = checkSource(`
function f@alice(a: integer@alice) {
  return a;
}
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      const fn = typed?.items[0];
      assert.ok(fn && "decl" in fn);
      if (fn && "decl" in fn) {
        assert.equal(fn.returnType.base, "integer");
        assert.equal(fn.returnType.location.kind, "individual");
      }
    });

    it("still infers void for a body with no returns (§function-return-type-inference)", () => {
      const { typed, errors } = checkSource(`
function noop@alice() {
}
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      const fn = typed?.items[0];
      if (fn && "decl" in fn) {
        assert.equal(fn.returnType.base, "void");
        if (fn.returnType.location.kind === "individual") {
          assert.equal(fn.returnType.location.name, "alice");
        }
      }
    });

    it("still fills array literal elements from the literal's own annotation (§array-literals)", () => {
      const { errors } = checkSource(`
let xs: integer[]@alice = [1, 2, 3]@alice;
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
    });

    it("accepts a void return type, which carries no location", () => {
      const { errors } = checkSource(`
function f@alice(): void {
  return;
}
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
    });
  });

  it("rejects assignment across locations (spec §invalid-assignment-across-locations)", () => {
    const { typed, errors } = checkSource(`
let x: integer@alice = 1@alice;
let y: integer@bob = x;
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("use a transfer instead")));
  });

  it("accepts a scalar local copy from @every (spec §transfer-typing)", () => {
    const typed = tagSource(`
let x: integer@every = 1@every;
let y: integer@alice <- x;
`);
    const recv = transferAt(typed, 1);
    assert.equal(recv.transferMode, "localCopy");
    assert.equal(recv.commTag, undefined);
  });

  it("accepts a scalar local copy from @every literals with subtyping", () => {
    const { errors } = checkSource(`
let y: float@alice <- 1@every;
let b: boolean@bob <- true@every;
`);
    assert.equal(errors.length, 0);
  });

  it("accepts @every to @every transfer as a local copy (spec §transfer-typing)", () => {
    const typed = tagSource(`
let x: integer@every = 1@every;
let y: integer@every <- x;
`);
    const recv = transferAt(typed, 1);
    assert.equal(recv.transferMode, "localCopy");
    assert.equal(recv.commTag, undefined);
  });

  it("accepts a transfer whose source and destination share a location (spec §transfer-typing)", () => {
    const typed = tagSource(`
let x: integer@alice = 1@alice;
let y: integer@alice <- x;
`);
    const recv = transferAt(typed, 1);
    assert.equal(recv.transferMode, "localCopy");
    assert.equal(recv.commTag, undefined);
  });

  it("rejects references to top-level let from local functions (spec §top-level-statements)", () => {
    const { typed, errors } = checkSource(`
let x: integer@alice = 1@alice;
function f@alice(): integer@alice {
  return x;
}
`);
    assert.equal(typed, null);
    // `x` exists; it is the top-level scope that a function body cannot see
    // (spec §top-level-let), and the diagnostic says so rather than calling it undefined.
    assert.ok(
      errors.some((e) =>
        e.message.includes(
          "'x' is a top-level variable and is not visible inside a function",
        ),
      ),
      JSON.stringify(errors),
    );
  });

  it("rejects cross-node local function calls (spec §calling-another-endpoints-local-function)", () => {
    const { typed, errors } = checkSource(`
function f@bob(): integer@bob { return 1@bob; }
function g@alice(): integer@alice { return f(); }
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("cannot call")));
  });

  it("rejects choreography function calls from local context (spec §calling-choreography-from-local)", () => {
    const { typed, errors } = checkSource(`
function h(): void { return; }
function g@alice(): void { h(); return; }
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) =>
        e.message.includes("cannot call choreography function"),
      ),
      JSON.stringify(errors),
    );
  });

  it("rejects choreography recursion (spec §recursive-choreography-function)", () => {
    const { typed, errors } = checkSource(`
function loop(): void {
  loop();
  return;
}
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("recursive")));
  });

  it("accepts a transfer inside a local function as a local copy (spec §function-kinds)", () => {
    const { typed, errors } = checkSource(`
function f@alice(): integer@alice {
  let x: integer@alice = 1@alice;
  let y: integer@alice <- x;
  return y;
}
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
  });

  it("still rejects a transfer from another endpoint inside a local function", () => {
    const { typed, errors } = checkSource(`
function f@alice(): void {
  let x: integer@bob = 1@bob;
  let y: integer@alice <- x;
  return;
}
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) =>
        e.message.includes("not usable in local function at alice"),
      ),
      JSON.stringify(errors),
    );
  });

  it("rejects a transfer to another endpoint inside a local function (spec §local-function-strict-location-rule)", () => {
    // The source is at alice, so §invalid-value-used-inside-local-function does not catch this. Without the
    // destination rule the checker accepted a send out of a body only alice
    // runs, and only the post-EPP consistency check noticed.
    const { typed, errors } = checkSource(`
function f@alice(): integer@alice {
  let x: integer@alice = 1@alice;
  let y: integer@bob <- x;
  return x;
}
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) =>
        e.message.includes("variable type must be located at alice"),
      ),
      JSON.stringify(errors),
    );
  });

  it("rejects a transfer to another endpoint in a local function with an inferred return type (spec §local-function-strict-location-rule)", () => {
    const { typed, errors } = checkSource(`
function f@alice() {
  let x: integer@alice = 1@alice;
  let y: integer@bob <- x;
  return x;
}
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) =>
        e.message.includes("variable type must be located at alice"),
      ),
      JSON.stringify(errors),
    );
  });

  it("rejects a function named after a runtime support function (spec §function-names, §codegen-function-names)", () => {
    const { typed, errors } = checkSource(`
function sendInteger@alice(): void {
  return;
}
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("reserved runtime name")),
      JSON.stringify(errors),
    );
  });

  it("rejects a variable named after a runtime support function (spec §function-names, §codegen-function-names)", () => {
    const { typed, errors } = checkSource(`
let cloneFloatArray: integer@alice = 1@alice;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("reserved runtime name")),
      JSON.stringify(errors),
    );
  });

  it("rejects a parameter named after a runtime support function (spec §function-names, §codegen-function-names)", () => {
    const { typed, errors } = checkSource(`
function f@alice(broadcastNull: integer@alice): void {
  return;
}
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("reserved runtime name")),
      JSON.stringify(errors),
    );
  });

  it("rejects a function named after an EPP call sentinel (spec §function-names, §codegen-function-names)", () => {
    const { typed, errors } = checkSource(`
function __array@alice(): void {
  return;
}
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("reserved runtime name")),
      JSON.stringify(errors),
    );
  });

  describe("one value name space (spec §namespaces, §err-name-already-held)", () => {
    // Endpoints, functions and variables share it, because generated
    // BlueScript keeps the source name (spec §codegen-function-names) and has only one.
    const rejects = (source: string, needle: string) => {
      const { typed, errors } = checkSource(source);
      assert.equal(typed, null, "expected the program to be rejected");
      assert.ok(
        errors.some((e) => e.message.includes(needle)),
        JSON.stringify(errors),
      );
    };

    describe("a function name is taken program-wide", () => {
      it("rejects a variable of that name", () => {
        rejects(
          `function g@alice(): integer@alice { return 1@alice; }
let g: integer@alice = 5@alice;`,
          "'g' is a function name and cannot be used as a variable name",
        );
      });

      it("rejects a variable of that name declared before the function", () => {
        // Functions are hoisted (spec §function-declaration-hoisting), so declaration order is not a
        // way around the rule.
        rejects(
          `let g: integer@alice = 5@alice;
function g@alice(): integer@alice { return 1@alice; }`,
          "'g' is a function name and cannot be used as a variable name",
        );
      });

      it("rejects a parameter of that name", () => {
        rejects(
          `function g@alice(): integer@alice { return 1@alice; }
function h@alice(g: integer@alice): integer@alice { return g; }`,
          "'g' is a function name and cannot be used as a parameter name",
        );
      });

      it("rejects a local shadowing it inside a function body", () => {
        // This is the case that used to type-check and emit BlueScript in
        // which `g()` reached the variable instead of the function.
        rejects(
          `function g@alice(): integer@alice { return 1@alice; }
function h@alice(): integer@alice {
  let g: integer@alice = 5@alice;
  return g + g();
}`,
          "'g' is a function name and cannot be used as a variable name",
        );
      });

      it("rejects a `for` loop variable of that name", () => {
        rejects(
          `function i@alice(): integer@alice { return 1@alice; }
for (let i = 0@every; i < 3@every; i = i + 1@every) { }`,
          "'i' is a function name and cannot be used as a variable name",
        );
      });

      it("rejects a transfer destination of that name", () => {
        rejects(
          `function y@alice(): integer@alice { return 1@alice; }
let x: integer@alice = 1@alice;
let y: integer@bob <- x;`,
          "'y' is a function name and cannot be used as a variable name",
        );
      });

      it("rejects it even at a different endpoint from the function", () => {
        // The rule is program-wide, not per output file (spec §namespaces).
        rejects(
          `function g@alice(): integer@alice { return 1@alice; }
function h@bob(g: integer@bob): integer@bob { return g; }`,
          "'g' is a function name and cannot be used as a parameter name",
        );
      });
    });

    describe("an endpoint name is taken program-wide", () => {
      it("rejects a variable of that name", () => {
        rejects(
          `let alice: integer@alice = 1@alice;`,
          "'alice' is an endpoint name and cannot be used as a variable name",
        );
      });

      it("rejects a function of that name", () => {
        // spec §namespaces used to give exactly this as an allowed example.
        rejects(
          `function alice@alice(): void { return; }`,
          "'alice' is an endpoint name and cannot be used as a function name",
        );
      });

      it("rejects a parameter of that name", () => {
        rejects(
          `function f@alice(bob: integer@alice): void { return; }`,
          "'bob' is an endpoint name and cannot be used as a parameter name",
        );
      });

      it("reserves an endpoint the source never mentions", () => {
        // `bob` is declared in choreobs.json but unused here; the name is
        // taken all the same (spec §choreobs-json, §namespaces).
        rejects(
          `let bob: integer@alice = 1@alice;`,
          "'bob' is an endpoint name and cannot be used as a variable name",
        );
      });

      it("rejects a local shadowing it inside a function body", () => {
        rejects(
          `function f@alice(): integer@alice {
  let bob: integer@alice = 1@alice;
  return bob;
}`,
          "'bob' is an endpoint name and cannot be used as a variable name",
        );
      });
    });

    describe("a use says what the name actually is (spec §namespaces)", () => {
      // One name is held by at most one thing, so a use that does not fit the
      // position can name what it found instead of only what it did not.
      it("reports a function name used as a value", () => {
        rejects(
          `function g@alice(): integer@alice { return 1@alice; }
let y: integer@alice = g;`,
          "'g' is a function name, not a value",
        );
      });

      it("reports an endpoint name used as a value", () => {
        rejects(
          `let y: integer@alice = alice;`,
          "'alice' is an endpoint name, not a value",
        );
      });

      it("reports a reserved runtime name used as a value", () => {
        rejects(
          `let y: integer@alice = sendInteger;`,
          "'sendInteger' is a reserved runtime name, not a value",
        );
      });

      it("reports a variable used as a callee", () => {
        rejects(
          `let v: integer@alice = 1@alice;
let y: integer@alice = v();`,
          "'v' is a variable, not a function",
        );
      });

      it("reports an endpoint name used as a callee", () => {
        rejects(
          `let y: integer@alice = bob();`,
          "'bob' is an endpoint name, not a function",
        );
      });

      it("still says 'undefined variable' when nothing holds the name", () => {
        rejects(`let y: integer@alice = zzz;`, "undefined variable 'zzz'");
      });

      it("still says 'undefined function' when nothing holds the name", () => {
        rejects(`let y: integer@alice = zzz();`, "undefined function 'zzz'");
      });
    });

    describe("variables still shadow each other (spec §variable-scope)", () => {
      it("allows an inner block to shadow an outer variable", () => {
        const { typed, errors } = checkSource(`
let c: boolean@every = true@every;
let x: integer@alice = 1@alice;
if (c) { let x: integer@alice = 2@alice; }
`);
        assert.equal(errors.length, 0, JSON.stringify(errors));
        assert.ok(typed);
      });

      it("allows a `let` to shadow a parameter", () => {
        const { typed, errors } = checkSource(`
function f@alice(p: integer@alice): integer@alice {
  let p: integer@alice = 1@alice;
  return p;
}
`);
        assert.equal(errors.length, 0, JSON.stringify(errors));
        assert.ok(typed);
      });

      it("allows names that resemble but do not equal a reserved one", () => {
        const { typed, errors } = checkSource(`
function alice2@alice(): integer@alice { return 1@alice; }
let bobbie: integer@alice = alice2();
let aliceCount: integer@alice = 1@alice;
`);
        assert.equal(errors.length, 0, JSON.stringify(errors));
        assert.ok(typed);
      });
    });
  });

  describe("`length` and `push` are ordinary names (spec §function-names)", () => {
    // They mean an array operation only after a `.`, so nothing is reserved.
    it("allows them as variable names", () => {
      const { typed, errors } = checkSource(`
let length: integer@alice = 1@alice;
let push: integer@alice = 2@alice;
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });

    it("allows them as function names", () => {
      const { typed, errors } = checkSource(`
function length@alice(ys: integer[]@alice): integer@alice {
  return ys.length;
}
let xs: integer[]@alice = [1, 2]@alice;
let n: integer@alice = length(xs);
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });

    it("reports an undeclared one like any other undefined function", () => {
      // No special-casing: the array operations are spelled after a `.`, and
      // these names carry no other meaning, so `length(xs)` is simply a call
      // to a function nobody declared.
      for (const source of [
        `let xs: integer[]@alice = [1]@alice;\nlet n: integer@alice = length(xs);`,
        `let xs: integer[]@alice = [1]@alice;\npush(xs, 2@alice);`,
      ]) {
        const { typed, errors } = checkSource(source);
        assert.equal(typed, null);
        assert.ok(
          errors.some((e) => e.message.startsWith("undefined function '")),
          JSON.stringify(errors),
        );
      }
    });
  });

  it("rejects an explicit non-void return type without a return on all paths (spec §missing-return-in-a-non-void-function)", () => {
    const { typed, errors } = checkSource(`
function f@alice(c: boolean@alice): integer@alice {
  if (c) {
    return 1@alice;
  }
}
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("§16.41")),
      JSON.stringify(errors),
    );
  });

  it("accepts an explicit non-void return type when both branches return (spec §return-typing)", () => {
    const { typed, errors } = checkSource(`
function f@alice(c: boolean@alice): integer@alice {
  if (c) {
    return 1@alice;
  } else {
    return 0@alice;
  }
}
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
  });

  it("does not require coverage for an explicit void return type (spec §return-typing)", () => {
    const { typed, errors } = checkSource(`
function f@alice(c: boolean@alice): void {
  if (c) {
    return;
  }
}
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
  });

  it("rejects `!` on an array operand (spec §operators, §invalid-unary-operand)", () => {
    const { typed, errors } = checkSource(`
let xs: boolean[]@alice = [true, false]@alice;
let b = !xs;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("§16.42")),
      JSON.stringify(errors),
    );
  });

  it("rejects unary `-` on an array operand (spec §operators, §invalid-unary-operand)", () => {
    const { typed, errors } = checkSource(`
let xs: integer[]@alice = [1, 2]@alice;
let n = -xs;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("§16.42")),
      JSON.stringify(errors),
    );
  });

  it("types unary operators at the operand location (spec §operators)", () => {
    const { typed, errors } = checkSource(`
let x: integer@alice = 1@alice;
let y: integer@alice = -x;
let c: boolean@alice = !(x < 10@alice);
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
  });

  it("rejects a non-numeric comparison (spec §operators, §invalid-comparison-or-equality-operands)", () => {
    const { typed, errors } = checkSource(`
let b: boolean@alice = "a"@alice < "b"@alice;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("numeric operands")),
      JSON.stringify(errors),
    );
  });

  it("rejects equality between integer and float (spec §operators, §invalid-comparison-or-equality-operands)", () => {
    const { typed, errors } = checkSource(`
let b: boolean@alice = 1@alice === 1.0@alice;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("same base type")),
      JSON.stringify(errors),
    );
  });

  it("rejects equality between void computations (spec §operators, §invalid-comparison-or-equality-operands)", () => {
    // Two voids have the same base type, so the same-base-type rule lets them
    // through: without a rule of its own this emitted BlueScript comparing two
    // statements. Both kinds of void computation are covered (spec §located-types).
    for (const source of [
      `function g@alice(): void { return; }\nlet b: boolean@alice = g() === g();`,
      `let xs: integer[]@alice = [1]@alice;\nlet b: boolean@alice = xs.push(1@alice) !== xs.push(2@alice);`,
    ]) {
      const { typed, errors } = checkSource(source);
      assert.equal(typed, null, source);
      assert.ok(
        errors.some((e) => e.message.includes("requires operands that produce a value")),
        JSON.stringify(errors),
      );
    }
  });

  it("rejects `return` at top level (spec §return-statement, §top-level-statements)", () => {
    const { typed, errors } = checkSource(`
let x: integer@alice = 1@alice;
return x;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("outside function")),
      JSON.stringify(errors),
    );
  });

  describe("`.push` is a void expression (spec §expressions, §array-typing)", () => {
    const XS = "let xs: integer[]@alice = []@alice;\n";

    it("accepts it as an expression statement", () => {
      const { typed, errors } = checkSource(`${XS}xs.push(1@alice);`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });

    it("accepts it parenthesized, like any other void computation", () => {
      const { typed, errors } = checkSource(`${XS}(xs.push(1@alice));`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });

    // Producing no value, it is rejected in every value position by the
    // ordinary `void` rules (spec §located-types, §invalid-use-of-void) — the same ones that reject a
    // call to a `void` function. This used to be a parse error.
    it("rejects it as an inferred let initializer", () => {
      const { errors } = checkSource(`${XS}let n = xs.push(1@alice);`);
      assert.ok(
        errors.some((e) => e.message.includes("produces no value")),
        JSON.stringify(errors),
      );
    });

    it("rejects it as an annotated let initializer", () => {
      const { errors } = checkSource(
        `${XS}let n: integer@alice = xs.push(1@alice);`,
      );
      assert.ok(
        errors.some((e) => e.message.includes("cannot assign void")),
        JSON.stringify(errors),
      );
    });

    it("rejects it as a call argument", () => {
      const { errors } = checkSource(
        `function f(a: integer@alice): integer@alice { return a; }\n${XS}f(xs.push(1@alice));`,
      );
      assert.ok(
        errors.some((e) => e.message.includes("argument type void")),
        JSON.stringify(errors),
      );
    });

    it("rejects it as a short-circuit operand", () => {
      const { errors } = checkSource(
        `${XS}let b: boolean@alice = true@alice && xs.push(1@alice);`,
      );
      assert.ok(
        errors.some((e) => e.message.includes("requires boolean operands")),
        JSON.stringify(errors),
      );
    });

    it("rejects a non-array receiver", () => {
      const { errors } = checkSource(
        `let n: integer@alice = 1@alice;\nn.push(1@alice);`,
      );
      assert.ok(
        errors.some((e) => e.message.includes("'.push' requires an array")),
        JSON.stringify(errors),
      );
    });
  });

  describe("a void computation may not stand where a value is required (spec §located-types)", () => {
    const VOID_FN = "function f@alice(): void { return; }";

    it("rejects an inferred let bound to a void call (spec §invalid-use-of-void)", () => {
      // The annotated form goes through resolveType, which already rejected
      // `void`. The inferred form took the initializer's type verbatim and
      // declared a variable of a type that holds no value.
      const { typed, errors } = checkSource(`${VOID_FN}
let x = f();
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("produces no value")),
        JSON.stringify(errors),
      );
    });

    it("rejects an inferred for-initializer bound to a void call", () => {
      const { typed, errors } = checkSource(`${VOID_FN}
for (let i = f(); true@every; i = 1@every) {
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("produces no value")),
        JSON.stringify(errors),
      );
    });

    it("rejects a void call as an array literal element", () => {
      // This one reached EPP and rendered `void[]` as `boolean[]`.
      const { typed, errors } = checkSource(`${VOID_FN}
let xs = [f()]@alice;
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("produces no value")),
        JSON.stringify(errors),
      );
    });

    it("still accepts a void call as a statement", () => {
      const { typed, errors } = checkSource(`${VOID_FN}
f();
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });
  });

  describe("`.length` typing (spec §array-typing)", () => {
    it("types `xs.length` as integer at the array's location", () => {
      const { typed, errors } = checkSource(`
let xs: integer[]@alice = [1, 2]@alice;
let n: integer@alice = xs.length;
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });

    it("rejects `.length` on a string", () => {
      // The prefix form made this unlikely; `s.length` is the first thing a
      // TypeScript user will try.
      const { typed, errors } = checkSource(`
let s: string@alice = "x"@alice;
let n: integer@alice = s.length;
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("requires an array")),
        JSON.stringify(errors),
      );
    });

    it("accepts `xs.length;` as an expression statement (spec §expression-statements)", () => {
      // An effect-free expression statement is pointless but legal, exactly as
      // `xs[0@alice];` and `1@alice;` are. `.length` used to be singled out —
      // a leftover from when it was written `length(xs)`.
      const { typed, errors } = checkSource(`
let xs: integer[]@alice = [1]@alice;
xs.length;
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });
  });

  it("accepts a relational comparison between integer and float (spec §operators)", () => {
    const { typed, errors } = checkSource(`
let b: boolean@alice = 1@alice < 1.5@alice;
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
  });

  it("accepts a transfer widening integer to float (spec §transfer-typing)", () => {
    const { errors } = checkSource(`
let y: integer@alice = 1@alice;
let x: float@bob <- y;
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
  });

  it("rejects a transfer narrowing float to integer (spec §invalid-transfer-base-type)", () => {
    const { typed, errors } = checkSource(`
let y: float@alice = 1.5@alice;
let x: integer@bob <- y;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("transfer type mismatch")),
      JSON.stringify(errors),
    );
  });

  it("rejects a transfer between unrelated base types (spec §invalid-transfer-base-type)", () => {
    const { typed, errors } = checkSource(`
let y: float@alice = 1.5@alice;
let x: string@bob <- y;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("transfer type mismatch")),
      JSON.stringify(errors),
    );
  });

  describe("type checking stops at the first error", () => {
    it("reports exactly one error for an omitted location, with no cascade", () => {
      // Before fail-fast the checker invented a location for the parameter and
      // then also complained about everything derived from it.
      const { typed, errors } = checkSource(`
function f@alice(a: integer): integer@alice {
  return a;
}
`);
      assert.equal(typed, null);
      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.ok(
        errors[0]!.message.includes("location annotation required on type"),
      );
    });

    it("reports only the first of several independent errors", () => {
      const { errors } = checkSource(`
let a: integer@alice = 1.5@alice;
let b: string@alice = 1@alice;
`);
      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.ok(errors[0]!.message.includes("cannot assign float@alice"));
    });

    it("does not hide a later error once the earlier one is fixed", () => {
      const { errors } = checkSource(`
let a: integer@alice = 1@alice;
let b: string@alice = 1@alice;
`);
      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.ok(errors[0]!.message.includes("cannot assign integer@alice"));
    });
  });

  describe("let location inference (spec §let-type-inference)", () => {
    it("takes the location from the initializer", () => {
      const { typed, errors } = checkSource(`let a: integer = 3@bob;`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      const item = typed?.items[0];
      if (item && "statement" in item && "choreoType" in item.statement) {
        const loc = item.statement.choreoType.location;
        assert.equal(loc.kind, "individual");
        if (loc.kind === "individual") {
          assert.equal(loc.name, "bob");
        }
      }
    });

    it("keeps the base type from the annotation, widening the initializer", () => {
      const { typed, errors } = checkSource(`let a: float = 3@alice;`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      const item = typed?.items[0];
      if (item && "statement" in item && "choreoType" in item.statement) {
        assert.equal(item.statement.choreoType.base, "float");
      }
    });

    it("lets a written location win, so a mismatch is still caught", () => {
      const { typed, errors } = checkSource(`let a: integer@bob = 3@alice;`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("invalid assignment across locations"),
        ),
        JSON.stringify(errors),
      );
    });

    it("infers in a for-loop initializer too (spec §for-initializer-let-type-inference)", () => {
      const { errors } = checkSource(`
for (let i: integer = 0@every; i < 3@every; i = i + 1@every) {
}
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
    });

    it("does not infer the destination of a transfer let (spec §transfer-let-does-not-infer-destination-type)", () => {
      // Inferring from the source would make destination == source, turning
      // every transfer into a no-op local copy.
      const { typed, errors } = checkSource(`
let x: integer@alice = 1@alice;
let y: integer <- x;
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("location annotation required on type"),
        ),
        JSON.stringify(errors),
      );
    });

    it("does not infer a parameter or return type location", () => {
      for (const src of [
        `function f@alice(a: integer): integer@alice { return a; }`,
        `function f@alice(a: integer@alice): integer { return a; }`,
      ]) {
        const { typed, errors } = checkSource(src);
        assert.equal(typed, null, src);
        assert.ok(
          errors.some((e) =>
            e.message.includes("location annotation required on type"),
          ),
          `${src} => ${JSON.stringify(errors)}`,
        );
      }
    });

    it("keeps array invariance when the location is inferred", () => {
      const { typed, errors } = checkSource(`
let a: integer[]@alice = [1, 2]@alice;
let b: float[] = a;
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("cannot assign integer[]@alice")),
        JSON.stringify(errors),
      );
    });
  });

  describe("void has no location (spec §void)", () => {
    it("rejects a location written on void", () => {
      const { typed, errors } = checkSource(`
function g(): void@alice {
  return;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("`void` has no location")),
        JSON.stringify(errors),
      );
    });

    for (const [what, src] of [
      ["a variable type", `function g(): void { return; }\nlet x: void = g();`],
      ["a parameter type", `function f(a: void): void { return; }`],
      ["a transfer destination", `function g(): void { return; }\nlet y: void <- g();`],
    ] as const) {
      it(`rejects void as ${what}`, () => {
        const { typed, errors } = checkSource(src);
        assert.equal(typed, null);
        assert.ok(
          errors.some((e) =>
            e.message.includes("may only be used as a function return type"),
          ),
          JSON.stringify(errors),
        );
      });
    }

    it("infers void for a body with no returns, at either kind of function", () => {
      for (const src of [`function f() {\n}`, `function f@alice() {\n}`]) {
        const { typed, errors } = checkSource(src);
        assert.equal(errors.length, 0, `${src} => ${JSON.stringify(errors)}`);
        const fn = typed?.items[0];
        if (fn && "returnType" in fn) {
          assert.equal(fn.returnType.base, "void");
        }
      }
    });
  });

  describe("function kinds (spec §function-kinds)", () => {
    it("rejects @every on a function declaration (spec §every-on-a-function-declaration)", () => {
      const { typed, errors } = checkSource(`
function f@every(): void {
  return;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("'every' is not a function location"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects direct recursion in a choreography function (spec §recursion)", () => {
      const { typed, errors } = checkSource(`
function f(): void {
  f();
  return;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("choreography function 'f' cannot be recursive"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects mutual recursion between choreography functions (spec §recursion)", () => {
      // Only direct self-recursion used to be caught; `f -> g -> f` slipped through.
      const { typed, errors } = checkSource(`
function f(): void {
  g();
  return;
}
function g(): void {
  f();
  return;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("cannot be recursive")),
        JSON.stringify(errors),
      );
    });

    it("still allows recursion in a local function with an explicit return type", () => {
      const { errors } = checkSource(`
function fact@alice(n: integer@alice): integer@alice {
  if (n <= 1@alice) {
    return 1@alice;
  } else {
    return n * fact(n - 1@alice);
  }
}
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
    });
  });

  it("rejects unknown endpoint (spec §unknown-endpoint)", () => {
    const { typed, errors } = checkSource(`let x: integer@carol = 1@carol;`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("carol")));
  });

  it("infers a top-level let location from its initializer (spec §let-type-inference)", () => {
    const { typed, errors } = checkSource(`let x: integer = 1@alice;`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const item = typed?.items[0];
    if (item && "statement" in item && "choreoType" in item.statement) {
      assert.equal(item.statement.choreoType.location.kind, "individual");
    }
  });

  it("rejects location omission where there is nothing to infer from (spec §location-annotation-omission)", () => {
    const { typed, errors } = checkSource(`
function f@alice(a: integer): integer@alice {
  return a;
}
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) =>
        e.message.includes("location annotation required on type"),
      ),
      JSON.stringify(errors),
    );
  });

  it("rejects boolean@alice condition in @every context (spec §invalid-if-condition)", () => {
    const { typed, errors } = checkSource(`
function f(c: boolean@alice): void {
  if (c) { return; }
}
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("boolean@every")));
  });

  it("allows the same let name in separate if branches (spec §variable-scope)", () => {
    const { typed, errors } = checkSource(`
let ok: boolean@every = true@every;
if (ok) {
  let msg: string@bob = "ok"@bob;
} else {
  let msg: string@bob = "ng"@bob;
}
`);
    assert.equal(errors.length, 0);
    assert.ok(typed);
  });

  it("rejects indirect recursive local functions with omitted return types (spec §inference-and-recursion)", () => {
    const { typed, errors } = checkSource(`
function f@alice(n: integer@alice) {
  return g(n);
}
function g@alice(n: integer@alice) {
  return f(n);
}
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) =>
        e.message.includes("omitted return type cannot be recursive"),
      ),
      JSON.stringify(errors),
    );
  });

  describe("local function location discipline", () => {
    it("accepts explicit bob-located parameters and body", () => {
      const { errors } = checkSource(`
function add@bob(a: integer@bob, b: integer@bob) {
  return a + b;
}
`);
      assert.equal(errors.length, 0);
    });

    it("accepts explicit bob-located return type", () => {
      const { errors } = checkSource(`
function f@bob(): integer@bob {
  return 1@bob;
}
`);
      assert.equal(errors.length, 0);
    });

    it("rejects parameter at a different individual location", () => {
      const { typed, errors } = checkSource(`
function add@bob(a: integer@alice, b: integer@bob) {
  return a;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("parameter must be located at bob")),
      );
    });

    it("rejects parameter at @every", () => {
      const { typed, errors } = checkSource(`
function f@bob(x: integer@every) {
  return x;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("parameter must be located at bob")),
      );
    });

    it("rejects @every literal in body", () => {
      const { typed, errors } = checkSource(`
function f@bob() {
  let x = 1@every;
  return x;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("not usable in local function at bob"),
        ),
      );
    });

    it("rejects literal at a different individual location in body", () => {
      const { typed, errors } = checkSource(`
function f@bob() {
  let x = 1@alice;
  return x;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("not usable in local function at bob"),
        ),
      );
    });

    it("rejects binary operands at different individual locations (spec §local-function-strict-location-rule, §invalid-value-used-inside-local-function)", () => {
      const { typed, errors } = checkSource(`
function f@alice(): integer@alice {
  return 1@bob + 2@alice;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("value at bob is not usable in local function at alice"),
        ),
      );
    });

    it("rejects explicit return type at a different individual location", () => {
      const { typed, errors } = checkSource(`
function f@bob(): integer@alice {
  return 1@alice;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("return type must be located at bob")),
      );
    });

    it("rejects explicit return type at @every", () => {
      const { typed, errors } = checkSource(`
function f@bob(): integer@every {
  return 1@every;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("return type must be located at bob")),
      );
    });

    it("rejects inferred return at @every", () => {
      const { typed, errors } = checkSource(`
function f@bob() {
  return 1@every;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("value at every is not usable in local function at bob"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects inferred return at a different individual location", () => {
      const { typed, errors } = checkSource(`
function f@bob() {
  return 1@alice;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("value at alice is not usable in local function at bob"),
        ),
        JSON.stringify(errors),
      );
    });
  });

  it("uses inferred return type at call sites (spec §function-return-type-inference)", () => {
    const { typed, errors } = checkSource(`
function add@alice(a: integer@alice, b: integer@alice) {
  return a + b;
}
function caller@alice(): integer@alice {
  return add(1@alice, 2@alice);
}
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const caller = typed?.items[1];
    if (caller && "body" in caller) {
      const ret = caller.body.statements[0];
      if (ret && "value" in ret && ret.value && "callee" in ret.value) {
        assert.equal(ret.value.choreoType.base, "integer");
        if (ret.value.choreoType.location.kind === "individual") {
          assert.equal(ret.value.choreoType.location.name, "alice");
        }
      }
    }
  });

  describe("call argument location matching", () => {
    it("rejects passing integer@every to integer@alice parameter (spec §invalid-function-argument-location)", () => {
      const { typed, errors } = checkSource(`
function add@alice(a: integer@alice) {
  return a;
}
add(10@every);
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("is not at parameter location integer@alice"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects integer@every argument to float@alice parameter (spec §invalid-function-argument-location)", () => {
      const { typed, errors } = checkSource(`
function add@alice(a: float@alice) {
  return a;
}
add(10@every);
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("is not at parameter location float@alice"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects argument at a different individual location", () => {
      const { typed, errors } = checkSource(`
function add@alice(a: integer@alice) {
  return a;
}
add(10@bob);
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("is not at parameter location")),
      );
    });

    it("rejects local function parameter at @every", () => {
      const { typed, errors } = checkSource(`
function f@alice(x: integer@every) {
  return x;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("parameter must be located at alice")),
      );
    });

    it("rejects integer@every argument from inside a local function (spec §local-function-strict-location-rule, §invalid-value-used-inside-local-function)", () => {
      const { typed, errors } = checkSource(`
function add@alice(a: integer@alice) {
  return a;
}
function g@alice(): integer@alice {
  return add(10@every);
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("not usable in local function at alice"),
        ),
      );
    });
  });

  describe("local control-flow conditions (spec §if-condition-typing, §while-and-for-condition-typing)", () => {
    it("rejects while with boolean@every in local function", () => {
      const { typed, errors } = checkSource(`
function f@alice(): void {
  while (true@every) {
    return;
  }
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some(
          (e) =>
            e.message.includes("not usable in local function at alice") ||
            e.message.includes("boolean@alice in local function"),
        ),
      );
    });

    it("rejects for condition with boolean@every in local function", () => {
      const { typed, errors } = checkSource(`
function f@alice(): void {
  for (; true@every; ) {
    return;
  }
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some(
          (e) =>
            e.message.includes("not usable in local function at alice") ||
            e.message.includes("boolean@alice in local function"),
        ),
      );
    });

    it("rejects if with boolean@bob in local function at alice", () => {
      const { typed, errors } = checkSource(`
function f@alice(): void {
  if (true@bob) {
    return;
  }
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("value at bob is not usable in local function at alice"),
        ),
      );
    });
  });

  it("allows explicit float let from integer initializer (spec §subtyping, §let-type-inference)", () => {
    const { errors } = checkSource(`
let x: float@alice = 1@alice;
`);
    assert.equal(errors.length, 0);
  });

  describe("return typing (spec §return-typing)", () => {
    it("allows integer return for float return type via subtyping", () => {
      const { errors } = checkSource(`
function f@alice(): float@alice {
  return 1@alice;
}
`);
      assert.equal(errors.length, 0);
    });

    it("rejects return at unavailable location", () => {
      const { typed, errors } = checkSource(`
function f@alice(): integer@bob {
  return 1@alice;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("return type must be located at alice"),
        ),
      );
    });
  });

  describe("@every and individual locations are independent (spec §location-matching-and-residency)", () => {
    it("rejects assigning an @every value to an individual-location variable", () => {
      const { typed, errors } = checkSource(`
let c: boolean@every = true@every;
let d: boolean@alice = c;
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("invalid assignment across locations"),
        ),
        JSON.stringify(errors),
      );
    });

    it("accepts the same program when the copy is explicit", () => {
      const { typed, errors } = checkSource(`
let c: boolean@every = true@every;
let d: boolean@alice <- c;
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });

    it("rejects returning an @every value from an individual-location return type", () => {
      const { typed, errors } = checkSource(`
function f(): integer@alice {
  return 1@every;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("is not at return type location integer@alice"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects mixing an @every operand with an individual-location operand", () => {
      const { typed, errors } = checkSource(`
function f(a: integer@alice) {
  return a + 1@every;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("binary operands must be at the same location"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects mixing in the other operand order too", () => {
      const { typed, errors } = checkSource(`
function f(a: integer@alice) {
  return 1@every + a;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("binary operands must be at the same location"),
        ),
        JSON.stringify(errors),
      );
    });
  });

  describe("mutable arrays", () => {
    it("accepts array literal, index, assignment, push, and length", () => {
      const { typed, errors } = checkSource(`
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys: float[]@alice = [1, 2.5]@alice;
let zs: boolean[]@bob = [true, false]@bob;
let empty: integer[]@alice = []@alice;
let x: integer@alice = xs[0@alice];
xs[1@alice] = 10@alice;
xs.push(20@alice);
let n: integer@alice = xs.length;
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });

    it("rejects unsupported array features and invalid uses", () => {
      const { typed, errors } = checkSource(`
let xs: integer[]@alice = [1, 2]@alice;
let ys: float[]@alice = xs;
`);
      assert.equal(typed, null);
      assert.ok(errors.some((e) => e.message.includes("cannot assign")));
    });

    it("accepts an array local copy from @every", () => {
      const { errors } = checkSource(`
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <- xs;
`);
      assert.equal(errors.length, 0);
    });

    it("rejects array element type conversion in a transfer", () => {
      const { typed, errors } = checkSource(`
let xs: integer[]@every = [1, 2]@every;
let ys: float[]@alice <- xs;
`);
      assert.equal(typed, null);
      assert.ok(errors.some((e) => e.message.includes("transfer type mismatch")));
    });

    it("rejects passing @every array directly to individual-location array parameter", () => {
      const { typed, errors } = checkSource(`
function average@alice(arr: float[]@alice): float@alice {
  return 0.0@alice;
}
let arr: float[]@every = [1.1, 2.2]@every;
average(arr);
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("is not at parameter location float[]@alice"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects assigning @every array to individual-location array variable", () => {
      const { typed, errors } = checkSource(`
let arr: float[]@every = [1.1, 2.2]@every;
let arrAlice: float[]@alice = arr;
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("invalid assignment across locations"),
        ),
        JSON.stringify(errors),
      );
    });
  });
});
