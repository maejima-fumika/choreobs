import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile, bs, expectSuccess } from "../support/compile.js";
import { aliceBobCarol } from "../support/config.js";

/**
 * The examples of spec-dyn.md, compiled end to end. Each expectation is the
 * section's "After EPP" block in the emitter's own layout: blocks are
 * multi-line, and the runtime import the spec leaves out is included.
 */
function expectEndpoints(source: string, alice: string, bob: string): void {
  const result = compile(source);
  expectSuccess(result);
  assert.equal(bs(result, "alice"), alice);
  assert.equal(bs(result, "bob"), bob);
}

describe("spec-dyn.md examples — generated .bs output", () => {
  it("section 3.4: numeric conversion, static and dynamic", () => {
    expectEndpoints(
      `
let valAlice: integer@alice = 1@alice;
let iDyn: integer@dyn = 2@dyn;
let f1: float@dyn = valAlice as float;
let f2: float@alice = iDyn as float;
let f3: float@dyn = iDyn as float;
let f4: float@dyn = 3 as float;
let i1: integer@dyn = iDyn as integer;
`,
      `import { __DynVal, __dynUnbound, __inject, __cast, __dynIntegerToFloat } from "./__runtime_alice";

let valAlice: integer = 1;
let iDyn: __DynVal = __dynUnbound(2);
let f1: __DynVal = __inject((valAlice as float), "alice");
let f2: float = __cast(__dynIntegerToFloat(iDyn), "alice");
let f3: __DynVal = __dynIntegerToFloat(iDyn);
let f4: __DynVal = __dynIntegerToFloat(__dynUnbound(3));
let i1: __DynVal = iDyn;`,
      `import { __DynVal, __dynUnbound, __inject, __cast, __dynIntegerToFloat } from "./__runtime_bob";

let iDyn: __DynVal = __dynUnbound(2);
let f1: __DynVal = __inject(null, "alice");
__cast(__dynIntegerToFloat(iDyn), "alice");
let f3: __DynVal = __dynIntegerToFloat(iDyn);
let f4: __DynVal = __dynIntegerToFloat(__dynUnbound(3));
let i1: __DynVal = iDyn;`,
    );
  });

  it("section 4.5: omitted locations become dyn", () => {
    expectEndpoints(
      `
3;
let a = 32;
let b: integer <- 32@alice;
function foo(a: integer) {}
function boo(flag: boolean@every) {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}
function bar(): integer {
    return 3@alice;
}
`,
      `import { __DynVal, __dynUnbound, __inject, __dynTransfer } from "./__runtime_alice";

function foo(a: __DynVal): void {
}

function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(3, "alice");
  } else {
    return __inject(4, "every");
  }
}

function bar(): integer {
  return 3;
}
__dynUnbound(3);
let a: __DynVal = __dynUnbound(32);
let b: __DynVal = __dynTransfer("__top_0", "integer", "dyn", __inject(32, "alice"));`,
      `import { __DynVal, __dynUnbound, __inject, __dynTransfer } from "./__runtime_bob";

function foo(a: __DynVal): void {
}

function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(null, "alice");
  } else {
    return __inject(4, "every");
  }
}

function bar(): null {
  return null;
}
__dynUnbound(3);
let a: __DynVal = __dynUnbound(32);
let b: __DynVal = __dynTransfer("__top_0", "integer", "dyn", __inject(null, "alice"));`,
    );
  });

  it("section 5.1: scalar dyn literals", () => {
    expectEndpoints(
      `
3@dyn;
4.5@dyn;
true@dyn;
"Hello"@dyn;
null@dyn;
`,
      `import { __dynUnbound } from "./__runtime_alice";

__dynUnbound(3);
__dynUnbound(4.5);
__dynUnbound(true);
__dynUnbound("Hello");
__dynUnbound(null);`,
      `import { __dynUnbound } from "./__runtime_bob";

__dynUnbound(3);
__dynUnbound(4.5);
__dynUnbound(true);
__dynUnbound("Hello");
__dynUnbound(null);`,
    );
  });

  it("section 5.2: array literals", () => {
    expectEndpoints(
      `
let a: integer@alice = 1@alice;
let b: integer@alice = 2@alice;
let d: integer@dyn = 3@dyn;
[1, 2];
[1, 2]@dyn;
[1@dyn, 2@dyn]@dyn;
let e: integer[]@dyn = []@dyn;
[a, b];
let xs: integer[]@alice = [d]@alice;
`,
      `import { __DynVal, __dynUnbound, __inject, __cast, __dynArrayNew, __dynArrayAppend } from "./__runtime_alice";

let a: integer = 1;
let b: integer = 2;
let d: __DynVal = __dynUnbound(3);
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
let e: __DynVal = __dynArrayNew("integerArray");
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __inject(a, "alice")), __inject(b, "alice"));
let xs: integer[] = [__cast(d, "alice")];`,
      `import { __DynVal, __dynUnbound, __inject, __cast, __dynArrayNew, __dynArrayAppend } from "./__runtime_bob";

let d: __DynVal = __dynUnbound(3);
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
let e: __DynVal = __dynArrayNew("integerArray");
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __inject(null, "alice")), __inject(null, "alice"));
nothing(__cast(d, "alice"));`,
    );
  });

  it("section 10.1: binary operators", () => {
    expectEndpoints(
      `
let valDyn: integer@dyn = 3@dyn;
let valAlice: integer@alice = 5@alice;
let valEvery: integer@every = 6@every;
valDyn + valDyn;
valDyn + valAlice;
valAlice + valAlice;
valDyn + valEvery;
`,
      `import { __DynVal, __dynUnbound, __inject, __dynPlus } from "./__runtime_alice";

let valDyn: __DynVal = __dynUnbound(3);
let valAlice: integer = 5;
let valEvery: integer = 6;
__dynPlus(valDyn, valDyn);
__dynPlus(valDyn, __inject(valAlice, "alice"));
valAlice + valAlice;
__dynPlus(valDyn, __inject(valEvery, "every"));`,
      `import { __DynVal, __dynUnbound, __inject, __dynPlus } from "./__runtime_bob";

let valDyn: __DynVal = __dynUnbound(3);
let valEvery: integer = 6;
__dynPlus(valDyn, valDyn);
__dynPlus(valDyn, __inject(null, "alice"));
__dynPlus(valDyn, __inject(valEvery, "every"));`,
    );
  });

  it("section 10.4: unary operators", () => {
    expectEndpoints(
      `
let a: boolean@dyn = false@dyn;
let n: integer@dyn = 1@dyn;
a = !a;
n = -n;
`,
      `import { __DynVal, __dynUnbound, __dynNot, __dynNeg } from "./__runtime_alice";

let a: __DynVal = __dynUnbound(false);
let n: __DynVal = __dynUnbound(1);
a = __dynNot(a);
n = __dynNeg(n);`,
      `import { __DynVal, __dynUnbound, __dynNot, __dynNeg } from "./__runtime_bob";

let a: __DynVal = __dynUnbound(false);
let n: __DynVal = __dynUnbound(1);
a = __dynNot(a);
n = __dynNeg(n);`,
    );
  });

  it("section 10.5: numeric conversion of dyn operands", () => {
    expectEndpoints(
      `
let n: integer@dyn = 3@dyn;
let x: float@dyn = 1.5@dyn;
let a: float@dyn = n as float;
let b: integer@dyn = x as integer;
let c: integer@dyn = n as integer;
`,
      `import { __DynVal, __dynUnbound, __dynIntegerToFloat, __dynFloatToInteger } from "./__runtime_alice";

let n: __DynVal = __dynUnbound(3);
let x: __DynVal = __dynUnbound(1.5);
let a: __DynVal = __dynIntegerToFloat(n);
let b: __DynVal = __dynFloatToInteger(x);
let c: __DynVal = n;`,
      `import { __DynVal, __dynUnbound, __dynIntegerToFloat, __dynFloatToInteger } from "./__runtime_bob";

let n: __DynVal = __dynUnbound(3);
let x: __DynVal = __dynUnbound(1.5);
let a: __DynVal = __dynIntegerToFloat(n);
let b: __DynVal = __dynFloatToInteger(x);
let c: __DynVal = n;`,
    );
  });

  it("section 11.2: transfers", () => {
    expectEndpoints(
      `
let valDyn1: integer@dyn = 4@dyn;
let valDyn2: integer@dyn = 5@dyn;
let valAlice: integer@alice = 6@alice;
function f() { return 3; }
function g() { return 4; }
let valDyn3: integer@dyn <- valDyn1;
let valDyn4: integer@dyn <- valAlice;
let valBob1: integer@bob <- valDyn1;
let valBob2: integer@bob <- valAlice;
valDyn2 <- valDyn1;
valDyn2 <- valAlice;
valBob1 <- valDyn1;
valBob1 <- valAlice;
let x: integer@dyn <- f() + g();
let fb: float@bob <- valDyn1 as float;
`,
      `import { __DynVal, __dynUnbound, __inject, __cast, __dynIntegerToFloat, __dynPlus, __dynTransfer } from "./__runtime_alice";

function f(): __DynVal {
  return __dynUnbound(3);
}

function g(): __DynVal {
  return __dynUnbound(4);
}
let valDyn1: __DynVal = __dynUnbound(4);
let valDyn2: __DynVal = __dynUnbound(5);
let valAlice: integer = 6;
let valDyn3: __DynVal = __dynTransfer("__top_0", "integer", "dyn", valDyn1);
let valDyn4: __DynVal = __dynTransfer("__top_1", "integer", "dyn", __inject(valAlice, "alice"));
__cast(__dynTransfer("__top_2", "integer", "bob", valDyn1), "bob");
sendInteger("bob", "__top_3", valAlice);
valDyn2 = __dynTransfer("__top_4", "integer", "dyn", valDyn1);
valDyn2 = __dynTransfer("__top_5", "integer", "dyn", __inject(valAlice, "alice"));
__cast(__dynTransfer("__top_6", "integer", "bob", valDyn1), "bob");
sendInteger("bob", "__top_7", valAlice);
let x: __DynVal = __dynTransfer("__top_8", "integer", "dyn", __dynPlus(f(), g()));
__cast(__dynTransfer("__top_9", "float", "bob", __dynIntegerToFloat(valDyn1)), "bob");`,
      `import { __DynVal, __dynUnbound, __inject, __cast, __dynIntegerToFloat, __dynPlus, __dynTransfer } from "./__runtime_bob";

function f(): __DynVal {
  return __dynUnbound(3);
}

function g(): __DynVal {
  return __dynUnbound(4);
}
let valDyn1: __DynVal = __dynUnbound(4);
let valDyn2: __DynVal = __dynUnbound(5);
let valDyn3: __DynVal = __dynTransfer("__top_0", "integer", "dyn", valDyn1);
let valDyn4: __DynVal = __dynTransfer("__top_1", "integer", "dyn", __inject(null, "alice"));
let valBob1: integer = __cast(__dynTransfer("__top_2", "integer", "bob", valDyn1), "bob");
let valBob2: integer = receiveInteger("alice", "__top_3");
valDyn2 = __dynTransfer("__top_4", "integer", "dyn", valDyn1);
valDyn2 = __dynTransfer("__top_5", "integer", "dyn", __inject(null, "alice"));
valBob1 = __cast(__dynTransfer("__top_6", "integer", "bob", valDyn1), "bob");
valBob1 = receiveInteger("alice", "__top_7");
let x: __DynVal = __dynTransfer("__top_8", "integer", "dyn", __dynPlus(f(), g()));
let fb: float = __cast(__dynTransfer("__top_9", "float", "bob", __dynIntegerToFloat(valDyn1)), "bob");`,
    );
  });

  it("section 12.1: array get", () => {
    expectEndpoints(
      `
let arrDyn: integer[]@dyn = [1, 3, 4]@dyn;
let arrAlice: integer[]@alice = [1, 3, 4]@alice;
let iDyn: integer@dyn = 0@dyn;
let iAlice: integer@alice = 0@alice;
arrDyn[iDyn];
arrAlice[iDyn];
arrDyn[iAlice];
arrAlice[iAlice];
`,
      `import { __DynVal, __dynUnbound, __inject, __dynArrayGet, __dynArrayNew, __dynArrayAppend } from "./__runtime_alice";

let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let arrAlice: integer[] = [1, 3, 4];
let iDyn: __DynVal = __dynUnbound(0);
let iAlice: integer = 0;
__dynArrayGet(arrDyn, iDyn);
__dynArrayGet(__inject(arrAlice, "alice"), iDyn);
__dynArrayGet(arrDyn, __inject(iAlice, "alice"));
arrAlice[iAlice];`,
      `import { __DynVal, __dynUnbound, __inject, __dynArrayGet, __dynArrayNew, __dynArrayAppend } from "./__runtime_bob";

let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let iDyn: __DynVal = __dynUnbound(0);
__dynArrayGet(arrDyn, iDyn);
__dynArrayGet(__inject(null, "alice"), iDyn);
__dynArrayGet(arrDyn, __inject(null, "alice"));`,
    );
  });

  it("section 12.2: array set", () => {
    expectEndpoints(
      `
let arrDyn: integer[]@dyn = [1, 3, 4]@dyn;
let arrAlice: integer[]@alice = [1, 3, 4]@alice;
let iDyn: integer@dyn = 0@dyn;
let iAlice: integer@alice = 0@alice;
let valDyn: integer@dyn = 5@dyn;
let valAlice: integer@alice = 5@alice;
arrDyn[iDyn] = valDyn;
arrDyn[iDyn] = valAlice;
arrAlice[iDyn] = valDyn;
arrAlice[iDyn] = valAlice;
arrDyn[iAlice] = valDyn;
arrDyn[iAlice] = valAlice;
arrAlice[iAlice] = valDyn;
arrAlice[iAlice] = valAlice;
`,
      `import { __DynVal, __dynUnbound, __inject, __dynArraySet, __dynArrayNew, __dynArrayAppend } from "./__runtime_alice";

let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let arrAlice: integer[] = [1, 3, 4];
let iDyn: __DynVal = __dynUnbound(0);
let iAlice: integer = 0;
let valDyn: __DynVal = __dynUnbound(5);
let valAlice: integer = 5;
__dynArraySet(arrDyn, iDyn, valDyn);
__dynArraySet(arrDyn, iDyn, __inject(valAlice, "alice"));
__dynArraySet(__inject(arrAlice, "alice"), iDyn, valDyn);
__dynArraySet(__inject(arrAlice, "alice"), iDyn, __inject(valAlice, "alice"));
__dynArraySet(arrDyn, __inject(iAlice, "alice"), valDyn);
__dynArraySet(arrDyn, __inject(iAlice, "alice"), __inject(valAlice, "alice"));
__dynArraySet(__inject(arrAlice, "alice"), __inject(iAlice, "alice"), valDyn);
arrAlice[iAlice] = valAlice;`,
      `import { __DynVal, __dynUnbound, __inject, __dynArraySet, __dynArrayNew, __dynArrayAppend } from "./__runtime_bob";

let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let iDyn: __DynVal = __dynUnbound(0);
let valDyn: __DynVal = __dynUnbound(5);
__dynArraySet(arrDyn, iDyn, valDyn);
__dynArraySet(arrDyn, iDyn, __inject(null, "alice"));
__dynArraySet(__inject(null, "alice"), iDyn, valDyn);
__dynArraySet(__inject(null, "alice"), iDyn, __inject(null, "alice"));
__dynArraySet(arrDyn, __inject(null, "alice"), valDyn);
__dynArraySet(arrDyn, __inject(null, "alice"), __inject(null, "alice"));
__dynArraySet(__inject(null, "alice"), __inject(null, "alice"), valDyn);`,
    );
  });

  it("section 12.3: push and length", () => {
    expectEndpoints(
      `
let arrDyn: integer[]@dyn = [1, 3, 4]@dyn;
let arrAlice: integer[]@alice = [1, 3, 4]@alice;
let valDyn: integer@dyn = 5@dyn;
let valAlice: integer@alice = 5@alice;
arrDyn.push(valDyn);
arrDyn.push(valAlice);
arrAlice.push(valDyn);
arrAlice.push(valAlice);
arrDyn.length;
arrAlice.length;
`,
      `import { __DynVal, __dynUnbound, __inject, __dynArrayPush, __dynArrayLength, __dynArrayNew, __dynArrayAppend } from "./__runtime_alice";

let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let arrAlice: integer[] = [1, 3, 4];
let valDyn: __DynVal = __dynUnbound(5);
let valAlice: integer = 5;
__dynArrayPush(arrDyn, valDyn);
__dynArrayPush(arrDyn, __inject(valAlice, "alice"));
__dynArrayPush(__inject(arrAlice, "alice"), valDyn);
arrAlice.push(valAlice);
__dynArrayLength(arrDyn);
arrAlice.length;`,
      `import { __DynVal, __dynUnbound, __inject, __dynArrayPush, __dynArrayLength, __dynArrayNew, __dynArrayAppend } from "./__runtime_bob";

let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let valDyn: __DynVal = __dynUnbound(5);
__dynArrayPush(arrDyn, valDyn);
__dynArrayPush(arrDyn, __inject(null, "alice"));
__dynArrayPush(__inject(null, "alice"), valDyn);
__dynArrayLength(arrDyn);`,
    );
  });

  it("section 13.1: arguments", () => {
    expectEndpoints(
      `
let valDyn: integer@dyn = 5@dyn;
let valAlice: integer@alice = 5@alice;
function funcDyn(a: integer) {}
function funcAlice(a: integer@alice) {}
function useAlice@alice(a: integer@alice): void { }
funcDyn(valDyn);
funcDyn(valAlice);
funcAlice(valDyn);
funcAlice(valAlice);
useAlice(valDyn);
`,
      `import { __DynVal, __dynUnbound, __inject, __cast } from "./__runtime_alice";

function funcDyn(a: __DynVal): void {
}

function funcAlice(a: integer): void {
}

function useAlice(a: integer): void {
}
let valDyn: __DynVal = __dynUnbound(5);
let valAlice: integer = 5;
funcDyn(valDyn);
funcDyn(__inject(valAlice, "alice"));
funcAlice(__cast(valDyn, "alice"));
funcAlice(valAlice);
useAlice(__cast(valDyn, "alice"));`,
      `import { __DynVal, __dynUnbound, __inject, __cast } from "./__runtime_bob";

function funcDyn(a: __DynVal): void {
}

function funcAlice(a: null): void {
}
let valDyn: __DynVal = __dynUnbound(5);
funcDyn(valDyn);
funcDyn(__inject(null, "alice"));
funcAlice(__cast(valDyn, "alice"));
funcAlice(null);
nothing(__cast(valDyn, "alice"));`,
    );
  });

  it("section 13.2: return", () => {
    expectEndpoints(
      `
function boo(flag: boolean@every) {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}
function toAlice(a: integer@dyn): integer@alice {
    return a;
}
`,
      `import { __DynVal, __inject, __cast } from "./__runtime_alice";

function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(3, "alice");
  } else {
    return __inject(4, "every");
  }
}

function toAlice(a: __DynVal): integer {
  return __cast(a, "alice");
}`,
      `import { __DynVal, __inject, __cast } from "./__runtime_bob";

function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(null, "alice");
  } else {
    return __inject(4, "every");
  }
}

function toAlice(a: __DynVal): null {
  return __cast(a, "alice");
}`,
    );
  });

  it("section 14.1: variable declarations", () => {
    expectEndpoints(
      `
let valDyn1: integer@dyn = 3@dyn;
let valDyn2: integer@dyn = 3@alice;
let valAlice1: integer@alice = 3@dyn;
let valAlice2: integer@alice = 3@alice;
`,
      `import { __DynVal, __dynUnbound, __inject, __cast } from "./__runtime_alice";

let valDyn1: __DynVal = __dynUnbound(3);
let valDyn2: __DynVal = __inject(3, "alice");
let valAlice1: integer = __cast(__dynUnbound(3), "alice");
let valAlice2: integer = 3;`,
      `import { __DynVal, __dynUnbound, __inject, __cast } from "./__runtime_bob";

let valDyn1: __DynVal = __dynUnbound(3);
let valDyn2: __DynVal = __inject(null, "alice");
__cast(__dynUnbound(3), "alice");`,
    );
  });

  it("section 14.2: assignment", () => {
    expectEndpoints(
      `
let valDyn: integer@dyn = 3@dyn;
let valAlice: integer@alice = 3@alice;
valDyn = 4@dyn;
valDyn = 4@alice;
valAlice = 5@dyn;
valAlice = 5@alice;
`,
      `import { __DynVal, __dynUnbound, __inject, __cast } from "./__runtime_alice";

let valDyn: __DynVal = __dynUnbound(3);
let valAlice: integer = 3;
valDyn = __dynUnbound(4);
valDyn = __inject(4, "alice");
valAlice = __cast(__dynUnbound(5), "alice");
valAlice = 5;`,
      `import { __DynVal, __dynUnbound, __inject, __cast } from "./__runtime_bob";

let valDyn: __DynVal = __dynUnbound(3);
valDyn = __dynUnbound(4);
valDyn = __inject(null, "alice");
__cast(__dynUnbound(5), "alice");`,
    );
  });

  it("section 15: conditions", () => {
    expectEndpoints(
      `
let boolDyn: boolean@dyn = true@dyn;
if (boolDyn) {}
while (boolDyn) {}
for (let i = 0; i < 10; i = i + 1) {}
`,
      `import { __DynVal, __dynUnbound, __cast, __dynPlus, __dynLt } from "./__runtime_alice";

let boolDyn: __DynVal = __dynUnbound(true);
if (__cast(boolDyn, "every")) {
}
while (__cast(boolDyn, "every")) {
}
for (let i: __DynVal = __dynUnbound(0); __cast(__dynLt(i, __dynUnbound(10)), "every"); i = __dynPlus(i, __dynUnbound(1))) {
}`,
      `import { __DynVal, __dynUnbound, __cast, __dynPlus, __dynLt } from "./__runtime_bob";

let boolDyn: __DynVal = __dynUnbound(true);
if (__cast(boolDyn, "every")) {
}
while (__cast(boolDyn, "every")) {
}
for (let i: __DynVal = __dynUnbound(0); __cast(__dynLt(i, __dynUnbound(10)), "every"); i = __dynPlus(i, __dynUnbound(1))) {
}`,
    );
  });
});

describe("dynamic operations beyond the spec-dyn.md examples", () => {
  it("puts a dynamic element assignment in a for header as a bare call (section 12.2)", () => {
    const result = compile(`
let xs: integer[]@dyn = [0, 0]@dyn;
for (let i: integer@every = 0@every; i < 2@every; xs[i] = 1@every) {
}
`);
    expectSuccess(result);
    assert.match(
      bs(result, "bob"),
      /^for \(let i: integer = 0; i < 2; __dynArraySet\(xs, __inject\(i, "every"\), __inject\(1, "every"\)\)\) \{$/m,
    );
  });

  it("performs a static transfer's dynamic operations at every endpoint, once (section 8.2)", () => {
    const result = compile(
      `
function g@alice(a: integer@alice): integer@alice { return a; }
let d: integer@dyn = 1@dyn;
let y: integer@bob <- g(d);
`,
      aliceBobCarol,
    );
    expectSuccess(result);
    const body = (endpoint: string) => bs(result, endpoint).split("\n").slice(2).join("\n");
    assert.equal(
      body("alice").split("\n").slice(3).join("\n"),
      `let d: __DynVal = __dynUnbound(1);
sendInteger("bob", "__top_0", g(__cast(d, "alice")));`,
    );
    assert.equal(
      body("bob"),
      `let d: __DynVal = __dynUnbound(1);
nothing(__cast(d, "alice"));
let y: integer = receiveInteger("alice", "__top_0");`,
    );
    assert.equal(
      body("carol"),
      `let d: __DynVal = __dynUnbound(1);
nothing(__cast(d, "alice"));`,
    );
  });
});
