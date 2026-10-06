import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile, bs, expectSuccess } from "../support/compile.js";
import { aliceBobCarol } from "../support/config.js";

/**
 * The gradual-locating examples of spec.md, compiled end to end. Each
 * expectation is the example's EPP output in the emitter's own layout, with the
 * runtime import the spec leaves out (spec §runtime-import).
 */
function expectEndpoints(
  source: string,
  expected: {
    /**
     * What the programs import from the runtime, in import order: the same for
     * both, or each its own where only one of them calls a core helper.
     */
    readonly runtime: readonly string[] | Readonly<Record<"alice" | "bob", readonly string[]>>;
    readonly alice: string;
    readonly bob: string;
  },
): void {
  const result = compile(source);
  expectSuccess(result);
  for (const endpoint of ["alice", "bob"] as const) {
    const names = "alice" in expected.runtime ? expected.runtime[endpoint] : expected.runtime;
    assert.equal(
      bs(result, endpoint),
      `import { ${names.join(", ")} } from "./__runtime";\n\n${expected[endpoint]}`,
    );
  }
}

/** `text` without its runtime import and the blank line after it, which must be there (spec §runtime-import). */
function withoutRuntimeImport(text: string): string {
  const header = /^import \{ [^}]* \} from "\.\/__runtime";\n\n/.exec(text);
  assert.ok(header, `no runtime import in:\n${text}`);
  return text.slice(header[0].length);
}

describe("spec.md gradual-locating examples — generated .bs output", () => {
  it("§numeric-conversion-projection numeric conversion, static and dynamic", () => {
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
      {
        runtime: ["__DynVal", "__dynUnbound", "__inject", "__cast", "__dynIntegerToFloat", "__loc_alice"],
        alice: `let valAlice: integer = 1;
let iDyn: __DynVal = __dynUnbound(2);
let f1: __DynVal = __inject(((valAlice as integer) as float), __loc_alice);
let f2: float = __cast(__dynIntegerToFloat(iDyn), __loc_alice);
let f3: __DynVal = __dynIntegerToFloat(iDyn);
let f4: __DynVal = __dynIntegerToFloat(__dynUnbound(3));
let i1: __DynVal = iDyn;`,
        bob: `let iDyn: __DynVal = __dynUnbound(2);
let f1: __DynVal = __inject(null, __loc_alice);
__cast(__dynIntegerToFloat(iDyn), __loc_alice);
let f3: __DynVal = __dynIntegerToFloat(iDyn);
let f4: __DynVal = __dynIntegerToFloat(__dynUnbound(3));
let i1: __DynVal = iDyn;`,
      },
    );
  });

  it("§example-omitted-locations omitted locations become dyn", () => {
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
      {
        runtime: ["__DynVal", "__dynUnbound", "__inject", "__dynTransfer", "__kind_integer", "__loc_alice", "__loc_dyn", "__loc_every"],
        alice: `function foo(a: __DynVal): void {
}

function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(3, __loc_alice);
  } else {
    return __inject(4, __loc_every);
  }
}

function bar(): integer {
  return 3;
}
__dynUnbound(3);
let a: __DynVal = __dynUnbound(32);
let b: __DynVal = __dynTransfer("__top_0", __kind_integer, __loc_dyn, __inject(32, __loc_alice));`,
        bob: `function foo(a: __DynVal): void {
}

function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(null, __loc_alice);
  } else {
    return __inject(4, __loc_every);
  }
}

function bar(): null {
  return null;
}
__dynUnbound(3);
let a: __DynVal = __dynUnbound(32);
let b: __DynVal = __dynTransfer("__top_0", __kind_integer, __loc_dyn, __inject(null, __loc_alice));`,
      },
    );
  });

  it("§literal-projection scalar dyn literals", () => {
    expectEndpoints(
      `
3@dyn;
4.5@dyn;
true@dyn;
"Hello"@dyn;
null@dyn;
`,
      {
        runtime: ["__dynUnbound"],
        alice: `__dynUnbound(3);
__dynUnbound(4.5);
__dynUnbound(true);
__dynUnbound("Hello");
__dynUnbound(null);`,
        bob: `__dynUnbound(3);
__dynUnbound(4.5);
__dynUnbound(true);
__dynUnbound("Hello");
__dynUnbound(null);`,
      },
    );
  });

  it("§dyn-array-projection array literals", () => {
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
      {
        runtime: {
          alice: ["__DynVal", "__dynUnbound", "__inject", "__cast", "__dynArrayNew", "__dynArrayAppend", "__loc_alice"],
          bob: ["__nothing1", "__DynVal", "__dynUnbound", "__inject", "__cast", "__dynArrayNew", "__dynArrayAppend", "__loc_alice"],
        },
        alice: `let a: integer = 1;
let b: integer = 2;
let d: __DynVal = __dynUnbound(3);
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
let e: __DynVal = __dynArrayNew();
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __inject(a, __loc_alice)), __inject(b, __loc_alice));
let xs: any[] = new Array<any>([__cast(d, __loc_alice)]);`,
        bob: `let d: __DynVal = __dynUnbound(3);
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
let e: __DynVal = __dynArrayNew();
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __inject(null, __loc_alice)), __inject(null, __loc_alice));
__nothing1(__cast(d, __loc_alice));`,
      },
    );
  });

  it("§array-literal-typing an empty literal built with the element type it is checked against", () => {
    expectEndpoints(
      `
let fs: float[]@alice = [1.0]@alice;
fs = [];
let ys: boolean[]@dyn <- [];
`,
      {
        runtime: ["__DynVal", "__cast", "__dynArrayNew", "__dynTransfer", "__kind_array", "__loc_alice", "__loc_dyn"],
        alice: `let fs: any[] = new Array<any>([1.0]);
fs = __cast(__dynArrayNew(), __loc_alice);
let ys: __DynVal = __dynTransfer("__top_0", __kind_array, __loc_dyn, __dynArrayNew());`,
        bob: `__cast(__dynArrayNew(), __loc_alice);
let ys: __DynVal = __dynTransfer("__top_0", __kind_array, __loc_dyn, __dynArrayNew());`,
      },
    );
  });

  it("§binary-and-unary-operation-projection binary operators", () => {
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
      {
        runtime: ["__DynVal", "__dynUnbound", "__inject", "__dynPlus", "__loc_alice", "__loc_every"],
        alice: `let valDyn: __DynVal = __dynUnbound(3);
let valAlice: integer = 5;
let valEvery: integer = 6;
__dynPlus(valDyn, valDyn);
__dynPlus(valDyn, __inject(valAlice, __loc_alice));
valAlice + valAlice;
__dynPlus(valDyn, __inject(valEvery, __loc_every));`,
        bob: `let valDyn: __DynVal = __dynUnbound(3);
let valEvery: integer = 6;
__dynPlus(valDyn, valDyn);
__dynPlus(valDyn, __inject(null, __loc_alice));
__dynPlus(valDyn, __inject(valEvery, __loc_every));`,
      },
    );
  });

  it("§binary-and-unary-operation-projection unary operators", () => {
    expectEndpoints(
      `
let a: boolean@dyn = false@dyn;
let n: integer@dyn = 1@dyn;
a = !a;
n = -n;
`,
      {
        runtime: ["__DynVal", "__dynUnbound", "__dynNot", "__dynNeg"],
        alice: `let a: __DynVal = __dynUnbound(false);
let n: __DynVal = __dynUnbound(1);
a = __dynNot(a);
n = __dynNeg(n);`,
        bob: `let a: __DynVal = __dynUnbound(false);
let n: __DynVal = __dynUnbound(1);
a = __dynNot(a);
n = __dynNeg(n);`,
      },
    );
  });

  it("§numeric-conversion-projection numeric conversion of dyn operands", () => {
    expectEndpoints(
      `
let n: integer@dyn = 3@dyn;
let x: float@dyn = 1.5@dyn;
let a: float@dyn = n as float;
let b: integer@dyn = x as integer;
let c: integer@dyn = n as integer;
`,
      {
        runtime: ["__DynVal", "__dynUnbound", "__dynIntegerToFloat", "__dynFloatToInteger"],
        alice: `let n: __DynVal = __dynUnbound(3);
let x: __DynVal = __dynUnbound(1.5);
let a: __DynVal = __dynIntegerToFloat(n);
let b: __DynVal = __dynFloatToInteger(x);
let c: __DynVal = n;`,
        bob: `let n: __DynVal = __dynUnbound(3);
let x: __DynVal = __dynUnbound(1.5);
let a: __DynVal = __dynIntegerToFloat(n);
let b: __DynVal = __dynFloatToInteger(x);
let c: __DynVal = n;`,
      },
    );
  });

  it("§example-dynamic-transfer transfers", () => {
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
      {
        runtime: ["__DynVal", "__dynUnbound", "__inject", "__cast", "__dynIntegerToFloat", "__dynPlus", "__dynTransfer", "__kind_float", "__kind_integer", "__loc_alice", "__loc_bob", "__loc_dyn"],
        alice: `function f(): __DynVal {
  return __dynUnbound(3);
}

function g(): __DynVal {
  return __dynUnbound(4);
}
let valDyn1: __DynVal = __dynUnbound(4);
let valDyn2: __DynVal = __dynUnbound(5);
let valAlice: integer = 6;
let valDyn3: __DynVal = __dynTransfer("__top_0", __kind_integer, __loc_dyn, valDyn1);
let valDyn4: __DynVal = __dynTransfer("__top_1", __kind_integer, __loc_dyn, __inject(valAlice, __loc_alice));
__cast(__dynTransfer("__top_2", __kind_integer, __loc_bob, valDyn1), __loc_bob);
sendInteger("bob", "__top_3", valAlice);
valDyn2 = __dynTransfer("__top_4", __kind_integer, __loc_dyn, valDyn1);
valDyn2 = __dynTransfer("__top_5", __kind_integer, __loc_dyn, __inject(valAlice, __loc_alice));
__cast(__dynTransfer("__top_6", __kind_integer, __loc_bob, valDyn1), __loc_bob);
sendInteger("bob", "__top_7", valAlice);
let x: __DynVal = __dynTransfer("__top_8", __kind_integer, __loc_dyn, __dynPlus(f(), g()));
__cast(__dynTransfer("__top_9", __kind_float, __loc_bob, __dynIntegerToFloat(valDyn1)), __loc_bob);`,
        bob: `function f(): __DynVal {
  return __dynUnbound(3);
}

function g(): __DynVal {
  return __dynUnbound(4);
}
let valDyn1: __DynVal = __dynUnbound(4);
let valDyn2: __DynVal = __dynUnbound(5);
let valDyn3: __DynVal = __dynTransfer("__top_0", __kind_integer, __loc_dyn, valDyn1);
let valDyn4: __DynVal = __dynTransfer("__top_1", __kind_integer, __loc_dyn, __inject(null, __loc_alice));
let valBob1: integer = __cast(__dynTransfer("__top_2", __kind_integer, __loc_bob, valDyn1), __loc_bob);
let valBob2: integer = receiveInteger("alice", "__top_3");
valDyn2 = __dynTransfer("__top_4", __kind_integer, __loc_dyn, valDyn1);
valDyn2 = __dynTransfer("__top_5", __kind_integer, __loc_dyn, __inject(null, __loc_alice));
valBob1 = __cast(__dynTransfer("__top_6", __kind_integer, __loc_bob, valDyn1), __loc_bob);
valBob1 = receiveInteger("alice", "__top_7");
let x: __DynVal = __dynTransfer("__top_8", __kind_integer, __loc_dyn, __dynPlus(f(), g()));
let fb: float = __cast(__dynTransfer("__top_9", __kind_float, __loc_bob, __dynIntegerToFloat(valDyn1)), __loc_bob);`,
      },
    );
  });

  it("§dyn-array-projection array get", () => {
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
      {
        runtime: ["__DynVal", "__dynUnbound", "__inject", "__dynArrayGet", "__dynArrayNew", "__dynArrayAppend", "__loc_alice"],
        alice: `let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let arrAlice: any[] = new Array<any>([1, 3, 4]);
let iDyn: __DynVal = __dynUnbound(0);
let iAlice: integer = 0;
__dynArrayGet(arrDyn, iDyn);
__dynArrayGet(__inject(arrAlice, __loc_alice), iDyn);
__dynArrayGet(arrDyn, __inject(iAlice, __loc_alice));
arrAlice[iAlice];`,
        bob: `let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let iDyn: __DynVal = __dynUnbound(0);
__dynArrayGet(arrDyn, iDyn);
__dynArrayGet(__inject(null, __loc_alice), iDyn);
__dynArrayGet(arrDyn, __inject(null, __loc_alice));`,
      },
    );
  });

  it("§dyn-array-projection array set", () => {
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
      {
        runtime: ["__DynVal", "__dynUnbound", "__inject", "__dynArraySet", "__dynArrayNew", "__dynArrayAppend", "__loc_alice"],
        alice: `let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let arrAlice: any[] = new Array<any>([1, 3, 4]);
let iDyn: __DynVal = __dynUnbound(0);
let iAlice: integer = 0;
let valDyn: __DynVal = __dynUnbound(5);
let valAlice: integer = 5;
__dynArraySet(arrDyn, iDyn, valDyn);
__dynArraySet(arrDyn, iDyn, __inject(valAlice, __loc_alice));
__dynArraySet(__inject(arrAlice, __loc_alice), iDyn, valDyn);
__dynArraySet(__inject(arrAlice, __loc_alice), iDyn, __inject(valAlice, __loc_alice));
__dynArraySet(arrDyn, __inject(iAlice, __loc_alice), valDyn);
__dynArraySet(arrDyn, __inject(iAlice, __loc_alice), __inject(valAlice, __loc_alice));
__dynArraySet(__inject(arrAlice, __loc_alice), __inject(iAlice, __loc_alice), valDyn);
arrAlice[iAlice] = valAlice;`,
        bob: `let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let iDyn: __DynVal = __dynUnbound(0);
let valDyn: __DynVal = __dynUnbound(5);
__dynArraySet(arrDyn, iDyn, valDyn);
__dynArraySet(arrDyn, iDyn, __inject(null, __loc_alice));
__dynArraySet(__inject(null, __loc_alice), iDyn, valDyn);
__dynArraySet(__inject(null, __loc_alice), iDyn, __inject(null, __loc_alice));
__dynArraySet(arrDyn, __inject(null, __loc_alice), valDyn);
__dynArraySet(arrDyn, __inject(null, __loc_alice), __inject(null, __loc_alice));
__dynArraySet(__inject(null, __loc_alice), __inject(null, __loc_alice), valDyn);`,
      },
    );
  });

  it("§dyn-array-projection push and length", () => {
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
      {
        runtime: ["__DynVal", "__dynUnbound", "__inject", "__dynArrayPush", "__dynArrayLength", "__dynArrayNew", "__dynArrayAppend", "__loc_alice"],
        alice: `let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let arrAlice: any[] = new Array<any>([1, 3, 4]);
let valDyn: __DynVal = __dynUnbound(5);
let valAlice: integer = 5;
__dynArrayPush(arrDyn, valDyn);
__dynArrayPush(arrDyn, __inject(valAlice, __loc_alice));
__dynArrayPush(__inject(arrAlice, __loc_alice), valDyn);
arrAlice.push(valAlice);
__dynArrayLength(arrDyn);
arrAlice.length;`,
        bob: `let arrDyn: __DynVal = __dynArrayAppend(__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(3)), __dynUnbound(4));
let valDyn: __DynVal = __dynUnbound(5);
__dynArrayPush(arrDyn, valDyn);
__dynArrayPush(arrDyn, __inject(null, __loc_alice));
__dynArrayPush(__inject(null, __loc_alice), valDyn);
__dynArrayLength(arrDyn);`,
      },
    );
  });

  it("§print-projection", () => {
    expectEndpoints(
      `
let x: integer@alice = 10@alice;
print(x);
let s: string@every = "ready"@every;
print(s);
let d: integer@dyn = 3@dyn;
print(d);
`,
      {
        runtime: ["__DynVal", "__dynUnbound", "__dynPrint"],
        alice: `let x: integer = 10;
print(x);
let s: string = "ready";
print(s);
let d: __DynVal = __dynUnbound(3);
__dynPrint(d);`,
        bob: `let s: string = "ready";
print(s);
let d: __DynVal = __dynUnbound(3);
__dynPrint(d);`,
      },
    );
  });

  it("§epp-choreography-function arguments", () => {
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
      {
        runtime: {
          alice: ["__DynVal", "__dynUnbound", "__inject", "__cast", "__loc_alice"],
          bob: ["__nothing1", "__DynVal", "__dynUnbound", "__inject", "__cast", "__loc_alice"],
        },
        alice: `function funcDyn(a: __DynVal): void {
}

function funcAlice(a: integer): void {
}

function useAlice(a: integer): void {
}
let valDyn: __DynVal = __dynUnbound(5);
let valAlice: integer = 5;
funcDyn(valDyn);
funcDyn(__inject(valAlice, __loc_alice));
funcAlice(__cast(valDyn, __loc_alice));
funcAlice(valAlice);
useAlice(__cast(valDyn, __loc_alice));`,
        bob: `function funcDyn(a: __DynVal): void {
}

function funcAlice(a: null): void {
}
let valDyn: __DynVal = __dynUnbound(5);
funcDyn(valDyn);
funcDyn(__inject(null, __loc_alice));
funcAlice(__cast(valDyn, __loc_alice));
funcAlice(null);
__nothing1(__cast(valDyn, __loc_alice));`,
      },
    );
  });

  it("§epp-choreography-function return", () => {
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
      {
        runtime: ["__DynVal", "__inject", "__cast", "__loc_alice", "__loc_every"],
        alice: `function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(3, __loc_alice);
  } else {
    return __inject(4, __loc_every);
  }
}

function toAlice(a: __DynVal): integer {
  return __cast(a, __loc_alice);
}`,
        bob: `function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(null, __loc_alice);
  } else {
    return __inject(4, __loc_every);
  }
}

function toAlice(a: __DynVal): null {
  return __cast(a, __loc_alice);
}`,
      },
    );
  });

  it("§let-projection variable declarations", () => {
    expectEndpoints(
      `
let valDyn1: integer@dyn = 3@dyn;
let valDyn2: integer@dyn = 3@alice;
let valAlice1: integer@alice = 3@dyn;
let valAlice2: integer@alice = 3@alice;
`,
      {
        runtime: ["__DynVal", "__dynUnbound", "__inject", "__cast", "__loc_alice"],
        alice: `let valDyn1: __DynVal = __dynUnbound(3);
let valDyn2: __DynVal = __inject(3, __loc_alice);
let valAlice1: integer = __cast(__dynUnbound(3), __loc_alice);
let valAlice2: integer = 3;`,
        bob: `let valDyn1: __DynVal = __dynUnbound(3);
let valDyn2: __DynVal = __inject(null, __loc_alice);
__cast(__dynUnbound(3), __loc_alice);`,
      },
    );
  });

  it("§assignment-projection assignment", () => {
    expectEndpoints(
      `
let valDyn: integer@dyn = 3@dyn;
let valAlice: integer@alice = 3@alice;
valDyn = 4@dyn;
valDyn = 4@alice;
valAlice = 5@dyn;
valAlice = 5@alice;
`,
      {
        runtime: ["__DynVal", "__dynUnbound", "__inject", "__cast", "__loc_alice"],
        alice: `let valDyn: __DynVal = __dynUnbound(3);
let valAlice: integer = 3;
valDyn = __dynUnbound(4);
valDyn = __inject(4, __loc_alice);
valAlice = __cast(__dynUnbound(5), __loc_alice);
valAlice = 5;`,
        bob: `let valDyn: __DynVal = __dynUnbound(3);
valDyn = __dynUnbound(4);
valDyn = __inject(null, __loc_alice);
__cast(__dynUnbound(5), __loc_alice);`,
      },
    );
  });

  it("§for-projection conditions", () => {
    expectEndpoints(
      `
let boolDyn: boolean@dyn = true@dyn;
if (boolDyn) {}
while (boolDyn) {}
for (let i = 0; i < 10; i = i + 1) {}
`,
      {
        runtime: ["__DynVal", "__dynUnbound", "__cast", "__dynPlus", "__dynLt", "__loc_every"],
        alice: `let boolDyn: __DynVal = __dynUnbound(true);
if (__cast(boolDyn, __loc_every)) {
}
while (__cast(boolDyn, __loc_every)) {
}
for (let i: __DynVal = __dynUnbound(0); __cast(__dynLt(i, __dynUnbound(10)), __loc_every); i = __dynPlus(i, __dynUnbound(1))) {
}`,
        bob: `let boolDyn: __DynVal = __dynUnbound(true);
if (__cast(boolDyn, __loc_every)) {
}
while (__cast(boolDyn, __loc_every)) {
}
for (let i: __DynVal = __dynUnbound(0); __cast(__dynLt(i, __dynUnbound(10)), __loc_every); i = __dynPlus(i, __dynUnbound(1))) {
}`,
      },
    );
  });
});

describe("dynamic operations beyond the spec.md examples", () => {
  it("puts a dynamic element assignment in a for header as a bare call (spec §dyn-array-projection)", () => {
    const result = compile(`
let xs: integer[]@dyn = [0, 0]@dyn;
for (let i: integer@every = 0@every; i < 2@every; xs[i] = 1@every) {
}
`);
    expectSuccess(result);
    assert.match(
      bs(result, "bob"),
      /^for \(let i: integer = 0; i < 2; __dynArraySet\(xs, __inject\(i, __loc_every\), __inject\(1, __loc_every\)\)\) \{$/m,
    );
  });

  it("performs a static transfer's dynamic operations at every endpoint, once (spec §dyn-lowering)", () => {
    const result = compile(
      `
function g@alice(a: integer@alice): integer@alice { return a; }
let d: integer@dyn = 1@dyn;
let y: integer@bob <- g(d);
`,
      aliceBobCarol,
    );
    expectSuccess(result);
    const body = (endpoint: string) => withoutRuntimeImport(bs(result, endpoint));
    assert.equal(
      body("alice"),
      `function g(a: integer): integer {
  return a;
}
let d: __DynVal = __dynUnbound(1);
sendInteger("bob", "__top_0", g(__cast(d, __loc_alice)));`,
    );
    assert.equal(
      body("bob"),
      `let d: __DynVal = __dynUnbound(1);
__nothing1(__cast(d, __loc_alice));
let y: integer = receiveInteger("alice", "__top_0");`,
    );
    assert.equal(
      body("carol"),
      `let d: __DynVal = __dynUnbound(1);
__nothing1(__cast(d, __loc_alice));`,
    );
  });
});
