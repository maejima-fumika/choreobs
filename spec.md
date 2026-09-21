# ChoreoBS Core v0 Specification

ChoreoBS Core v0 is an explicitly located choreographic programming language designed to be transpiled to BlueScript through Endpoint Projection (EPP).

This specification defines the initial core language for implementing the first ChoreoBS transpiler. Core v0 supports simple local type inference for initialized `let` declarations, `for` initializer `let` declarations, expression result types, and function return types. Future features such as Gradual Choreographic Programming, general location inference, `any`, `undefined`, asynchronous execution, and dynamic checks are outside the scope of v0.

---

## 1. Overview

### 1.1 Language Name

- Language name: `ChoreoBS`
- Source file extension: `.cbs`
- Output file extension: `.bs`
- Compilation target: BlueScript

### 1.2 Design Goals

ChoreoBS Core v0 aims to:

- describe communication among multiple endpoints as a single choreography;
- statically track where values are located using explicit location annotations;
- reduce annotation burden through simple local type inference;
- generate BlueScript endpoint programs for each endpoint;
- reduce send/receive mismatches through syntax, typing, and EPP rules;
- serve as the foundation for future Gradual Choreographic Programming.

### 1.3 Basic Example

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
```

This program declares `x` as `integer@alice`, sends its value from `alice` to
`bob`, and stores the received value in `y`. Writing `let x = 10@alice;` would
infer the same type from the initializer (spec §7.14.1).

After EPP:

```ts
// index_alice.bs
let x: integer = 10;
sendInteger("bob", "top_0", x);
```

```ts
// index_bob.bs
let y: integer = receiveInteger("alice", "top_0");
```

***

## 2. Input and Output

### 2.1 Input Files

The ChoreoBS transpiler takes the following inputs:

* a `.cbs` source file;
* a `choreobs.json` configuration file.

Example:

```text
project/
  index.cbs
  choreobs.json
```

### 2.2 `choreobs.json`

`choreobs.json` specifies the list of endpoints.

```json
{
  "endpoints": ["alice", "bob"]
}
```

#### Rules

* `endpoints` must be an array of strings.
* Each string in `endpoints` names one endpoint and defines an individual location.
* The names must be distinct. A repeated name is an error: it would give two output files the same name, and make one endpoint both the sender and the receiver of the same communication.
* `every` is a reserved word and must not appear in `endpoints`.
* Every individual location used in a `.cbs` source file must be listed in `endpoints`. The location `every` is never listed.
* The compiler generates a `.bs` file for each endpoint listed in `endpoints`, even if that endpoint is not used in the source.
* By default, the compiler reads `choreobs.json` from the same directory as the input `.cbs` file.
* Implementations may provide a CLI option to override the config path.

Example:

```bash
choreobs compile index.cbs
```

Or:

```bash
choreobs compile index.cbs --config path/to/choreobs.json
```

### 2.3 Output Files

The compiler emits one `.bs` file per endpoint.

Input:

```text
index.cbs
```

`choreobs.json`:

```json
{
  "endpoints": ["alice", "bob"]
}
```

Output:

```text
index_alice.bs
index_bob.bs
```

***

## 3. Endpoints and Locations

### 3.1 Endpoints

An **endpoint** is an agent that executes a program. The endpoints taking part in a
choreography are declared by the `endpoints` field of `choreobs.json` (spec §2.2).

A choreography is a single global program. The compiler projects it, by Endpoint
Projection (spec §12), into one BlueScript program per endpoint.

### 3.2 Locations

A location denotes where a value is placed. ChoreoBS has the following kinds of
locations:

```text
Location         ::= ConcreteLocation
ConcreteLocation ::= IndividualLocation | every
IndividualLocation ::= endpoint name
```

An **individual location** names exactly one endpoint. A **concrete location** is
either an individual location or `every`. In Core v0 every location is a concrete
location; location abstraction is deferred to §17.1.

`every` and the individual locations are independent kinds of location. `every` is
not an individual location, and it does not name any particular endpoint.

Examples of concrete locations:

```text
alice
bob
sensor1
Controller
every
```

Of these, `alice`, `bob`, `sensor1`, and `Controller` are individual locations, and
`every` is not.

### 3.3 Individual Locations

Individual locations are defined by the `endpoints` field in `choreobs.json`.

```json
{
  "endpoints": ["alice", "bob", "sensor"]
}
```

In this example, the individual locations are:

```text
alice
bob
sensor
```

### 3.4 `every`

`every` is a special location.

A value of type `T@every` means:

> All endpoints locally hold the same value of type `T`.

A `T@every` value is not a value at any individual location. It cannot be used
where a `T@alice` value is required; use `<-` to copy it to `alice` (spec §7.6,
§11.4).

Example:

```ts
let c: boolean@every = true@every;
```

This means all endpoints locally hold `c = true`.

For mutable arrays, `T[]@every` means that each endpoint has an independent local mutable array with the same contents. It is not shared memory.

A local copy of an `@every` array with `<-` creates a fresh mutable array at the destination (spec §11.4).

### 3.5 Location Names

* Location names follow the same lexical rules as ordinary identifiers.
* Location names may contain uppercase letters.
* An individual location name may be the same as a variable name or a function name.
* `every` is reserved.

***

## 4. Lexical Specification

### 4.1 Whitespace

The following characters are treated as whitespace:

```text
space
tab
carriage return
line feed
```

### 4.2 Comments

ChoreoBS supports TypeScript-style comments.

```ts
// line comment

/* block comment */
```

### 4.3 Identifiers

Identifiers have the following form:

```text
Identifier ::= [A-Za-z_][A-Za-z0-9_]*
```

Reserved words cannot be used as ordinary identifiers, and identifiers beginning
with two underscores are reserved for the compiler (spec §6.2).

### 4.4 Keywords

The following words are reserved:

```text
function
let
if
else
while
for
return
true
false
null
every
integer
float
boolean
string
void
```

The following words are reserved as well. The features they name are not
supported in v0 (spec §17), but the words are still keywords, so using one is
reported as an unsupported feature rather than as an undefined name:

```text
break
continue
const
any
undefined
async
await
class
import
export
```

### 4.5 Literals

#### Integer Literal

```text
IntegerLiteral ::= [0-9]+
```

Examples:

```ts
123
0
42
```

#### Float Literal

```text
FloatLiteral ::= [0-9]+ "." [0-9]+
```

Examples:

```ts
1.0
3.14
0.5
```

#### Boolean Literal

```ts
true
false
```

#### String Literal

String literals use double quotes.

```ts
"hello"
"alice"
```

#### Null Literal

```ts
null
```

### 4.6 Operators and Punctuation

The lexer recognizes the following tokens:

```text
+
-
*
/
%
<
<=
>
>=
===
!==
&&
||
!
=
<-
@
:
;
,
.
(
)
{
}
[
]
```

`==` and `!=` are not supported in v0.

`.` introduces the two array operations, `xs.length` and `xs.push(v)`
(spec §5.14). It is not general property access: those two names are the whole
set, and ChoreoBS has no objects to access fields of (spec §17.2).

A float literal's dot is consumed by the literal rule (spec §4.5), which takes
`.` only when a digit follows, so `xs.length` lexes as three tokens and `1.5` as
one.

#### Maximal Munch and `<-`

Tokens are formed by maximal munch over the raw character stream, so the
character immediately following `<` decides the token. `a<-b` is therefore a
transfer, not a comparison against `-b`. Write a space to compare against a
negated operand:

```ts
a <- b      // transfer
a < -b      // comparison with -b
```

***

## 5. Syntax

This section defines the grammar in an EBNF-like notation.

### 5.1 Program

```ebnf
Program ::= TopLevelItem*
```

```ebnf
TopLevelItem ::= FunctionDeclaration
               | Statement
```

Top-level statements are executed in an implicit choreography context.

### 5.2 Types

```ebnf
Type ::= NonLocatedType LocationAnnotation?
```

```ebnf
NonLocatedType ::= BaseType
                 | ArrayType
```

```ebnf
BaseType ::= "integer"
           | "float"
           | "boolean"
           | "string"
           | "null"
           | "void"
```

```ebnf
ArrayType ::= BaseType "[" "]"
```

The grammar admits an array of any base type, and admits only one `[` `]`: a
nested array is rejected by the grammar (spec §16.30). Which element types are
actually supported is a typing rule, not a syntactic one, so `string[]`,
`null[]` and `void[]` parse and are then rejected by the type checker
(spec §7.1.1, §16.29). Keeping it here would only turn a clear type error into a
syntax error.

```ebnf
LocationAnnotation ::= "@" Location
```

```ebnf
Location ::= Identifier | "every"
```

`void` is the one base type that takes no `LocationAnnotation`, and it may only
appear as a function return type (spec §7.3, §16.40).

Arrays are mutable reference values. ChoreoBS Core v0 with the mutable array extension supports only one-dimensional arrays whose element type is `integer`, `float`, or `boolean`.

The following array types are not supported:

```text
string[]
null[]
void[]
integer[][]
float[][]
boolean[][]
```

### 5.3 Function Declaration

```ebnf
FunctionDeclaration ::=
  "function" Identifier ("@" Location)? "(" ParameterList? ")" FunctionReturnType? Block
```

```ebnf
FunctionReturnType ::= ":" Type
```

The two forms of the production are the two kinds of function (spec §10.1): a
declaration carrying a location is a local function, and one carrying none is a
choreography function. A function location must be an individual location
(spec §16.39).

The return type annotation may be omitted. When omitted, the return type is inferred according to Section 7.14.

```ebnf
ParameterList ::= Parameter ("," Parameter)*
```

```ebnf
Parameter ::= Identifier ":" Type
```

Examples:

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}
```

```ts
function addInferred@alice(a: integer@alice, b: integer@alice) {
    return a + b;
}
```

```ts
function main(x: integer@alice): void {
    return;
}
```

### 5.4 Blocks

```ebnf
Block ::= "{" Statement* "}"
```

### 5.5 Statements

```ebnf
Statement ::= LetStatement
            | AssignmentStatement
            | TransferStatement
            | IfStatement
            | WhileStatement
            | ForStatement
            | ReturnStatement
            | ExpressionStatement
```

### 5.6 Let Statement

```ebnf
LetStatement ::= "let" Identifier TypeAnnotation? "=" Expression ";"
               | "let" Identifier ":" Type "<-" Expression ";"
TypeAnnotation ::= ":" Type
```

Uninitialized `let` declarations are not allowed in v0.

For ordinary initialized `let` declarations using `=`, the type annotation may be omitted and inferred from the right-hand side according to Section 7.14.

For transfer declarations using `<-`, the type annotation is still required. Core v0 does not infer the destination type or destination location of a transfer declaration.

Allowed:

```ts
let x: integer@alice = 1@alice;
let y = x + 1@alice;
let z: integer@bob <- x;
```

Disallowed:

```ts
let x: integer@alice;
let y <- x;
```

### 5.7 Assignment Statement

```ebnf
AssignmentStatement ::= AssignmentTarget "=" Expression ";"
```

```ebnf
AssignmentTarget ::= Identifier
                   | Identifier "[" Expression "]"
```

The left-hand side must be either an identifier or a single-level array element target of the form `Identifier[Expression]`.

General lvalues such as `f()[i]`, `xs[i][j]`, and property assignments are not supported.

```ts
x = y + 1@alice;
xs[0@alice] = 10@alice;
```

### 5.8 Transfer Statement

```ebnf
TransferStatement ::= Identifier "<-" Expression ";"
```

```ts
y <- x;
```

### 5.9 If Statement

```ebnf
IfStatement ::= "if" "(" Expression ")" Block ("else" Block)?
```

`if` is a statement, not an expression.

### 5.10 While Statement

```ebnf
WhileStatement ::= "while" "(" Expression ")" Block
```

### 5.11 For Statement

Only C-style `for` loops are supported in v0.

```ebnf
ForStatement ::=
  "for" "(" ForInit? ";" Expression ";" ForUpdate? ")" Block
```

The condition is required. An omitted one would have to mean an implicit `true`,
and a literal takes no location from its context (spec §8.1), so there would be
nothing to say where the condition is evaluated. `while (true@every)` expresses
an unbounded loop explicitly instead.

```ebnf
ForInit ::= LetStatementNoSemicolon
          | AssignmentStatementNoSemicolon
```

```ebnf
ForUpdate ::= AssignmentStatementNoSemicolon
```

```ebnf
LetStatementNoSemicolon ::=
  "let" Identifier TypeAnnotation? "=" Expression
```

```ebnf
AssignmentStatementNoSemicolon ::=
  AssignmentTarget "=" Expression
```

An assignment in a `for` header takes the same targets an assignment statement
does (spec §5.7), so an array element may be assigned there too:

```ts
for (let i = 0@alice; i < 3@alice; xs[i] = 0@alice) {
}
```

Example:

```ts
for (let i = 0@every; i < 10@every; i = i + 1@every) {
    // body
}
```

The type annotation in a `for` initializer `let` may be omitted and inferred from the initializer expression according to Section 7.14.

The following forms are not supported in v0:

```ts
for (x of xs) {
}
```

```ts
for (k in obj) {
}
```

### 5.12 Return Statement

```ebnf
ReturnStatement ::= "return" Expression? ";"
```

`return;` is allowed only when the function return type is `void`, or when an omitted function return type is inferred as `void`.

`return` may appear only inside a function body. The implicit top-level context
(spec §6.5) has nothing to return from, so a top-level `return` is an error even
though that context behaves like a `void` function in every other respect.

### 5.13 Expression Statement

```ebnf
ExpressionStatement ::= Expression ";"
```

### 5.14 Expressions

```ebnf
Expression ::= LogicalOrExpression
```

```ebnf
LogicalOrExpression ::= 
  LogicalAndExpression ("||" LogicalAndExpression)*
```

```ebnf
LogicalAndExpression ::= 
  EqualityExpression ("&&" EqualityExpression)*
```

```ebnf
EqualityExpression ::= 
  RelationalExpression (("===" | "!==") RelationalExpression)*
```

```ebnf
RelationalExpression ::= 
  AdditiveExpression (("<" | "<=" | ">" | ">=") AdditiveExpression)*
```

```ebnf
AdditiveExpression ::= 
  MultiplicativeExpression (("+" | "-") MultiplicativeExpression)*
```

```ebnf
MultiplicativeExpression ::= 
  UnaryExpression (("*" | "/" | "%") UnaryExpression)*
```

```ebnf
UnaryExpression ::= ("!" | "-") UnaryExpression
                  | PostfixExpression
```

```ebnf
PostfixExpression ::= PrimaryExpression PostfixOp*
```

```ebnf
PostfixOp ::= "[" Expression "]"
```

```ebnf
PrimaryExpression ::= Literal
                    | ArrayLiteral
                    | LengthExpression
                    | Identifier
                    | FunctionCall
                    | "(" Expression ")"
```

```ebnf
LengthExpression ::= Identifier "." "length"
```

```ebnf
PushExpression ::= Identifier "." "push" "(" Expression ")"
```

`.length` and `.push` are the two array member operations, not postfix
operators: the receiver of each is an `Identifier`. `f().length`,
`xs.length.length`, `(xs).push(v)` and `xs[0].push(v)` are therefore syntax
errors, and so is any other member name (spec §16.44).

`xs.length` yields the length; `xs.push(v)` appends and yields nothing, so its
type is `void` (spec §7.11.1). Like a call to a `void` function, it can only
stand as an expression statement — every value position rejects it
(spec §7.2, §16.40).

```ts
xs.push(1@alice);            // valid
let n = xs.push(1@alice);    // invalid — produces no value
```

```ebnf
FunctionCall ::= Identifier "(" ArgumentList? ")"
```

```ebnf
ArgumentList ::= Expression ("," Expression)*
```

```ebnf
ArrayLiteral ::= "[" ArgumentList? "]" LocationAnnotation?
```

### 5.15 Located Literals

Literals may have location annotations.

```ebnf
Literal ::= RawLiteral LocationAnnotation?
```

```ebnf
RawLiteral ::= IntegerLiteral
             | FloatLiteral
             | StringLiteral
             | BooleanLiteral
             | NullLiteral
```

Examples:

```ts
1@alice
3.14@bob
"hello"@alice
true@every
null@alice
```

### 5.16 Array Literals

Array literals have the following form:

```ebnf
ArrayLiteral ::= "[" ArgumentList? "]" LocationAnnotation?
```

Examples:

```ts
[1, 2, 3]@alice
[true, false]@bob
[]@alice
```

If an array literal has an explicit location annotation `@L`, unlocated literal
elements inside the array literal are elaborated as located at `L`.

This reaches the literal elements **directly** inside the brackets, and nothing
else. An element that is a compound expression is not elaborated, so every
literal inside it still needs its own annotation:

```ts
[1, 2]@alice          // valid: both elements are direct literals
[1 + 0, 2]@alice      // invalid: the `1` inside `1 + 0` has no location
[1@alice + 0@alice, 2]@alice   // valid
```

Example:

```ts
[1, 2, 3]@alice
```

is elaborated as:

```ts
[1@alice, 2@alice, 3@alice]@alice
```

**Every array literal must carry its own location annotation.** This holds
everywhere and regardless of its elements: the expected type of a `let`
declaration, an assignment, a function argument or a return does not supply one,
a local function's location does not supply one (spec §8.1), and neither do the
elements, even when they are all located at the same place.

Allowed:

```ts
let arr: integer[]@alice = [1, 2, 3]@alice;
```

Disallowed — the annotation is missing, whether or not the elements have one:

```ts
let arr: integer[]@alice = [1, 3, 5];

let a: integer@alice = 1@alice;
let b: integer@alice = 2@alice;
let xs = [a, b];                     // still invalid
let ys = [a, b]@alice;               // valid
```

The reason to require it even in the second case is that an array is a value in
its own right — it has a location of its own, not one computed from what happens
to be inside it — and v0 never infers a location from context (spec §8.1).

***

### 5.17 Evaluation Order

Evaluation is eager and left to right.

* The operands of a strict binary operator are evaluated left first, and both
  are always evaluated.
* The arguments of a call are evaluated left to right, and all of them before
  the call itself.
* In `xs[i]`, `xs` is evaluated before `i`.
* In an array literal, elements are evaluated left to right.
* In a simple assignment `x = e` and in a transfer, the right-hand side is
  evaluated before the store.
* In an array element assignment `xs[i] = e`, the receiver `xs` is evaluated
  first, then `i`, then `e`, and the store happens last. In Core v0 the
  receiver is always an identifier, so evaluating it has no effect of its own,
  but the order is defined this way for when it is generalized.
* In `xs.push(e)`, the receiver is evaluated first, then the argument, then the
  mutation. The expression itself yields nothing (spec §7.11.1).
* A `for` header evaluates its initializer once, then, on each iteration, the
  condition before the body and the body before the update.
* The arguments of the compiler-generated `nothing(...)` (spec §14.1) are
  evaluated left to right, and each exactly once.

There are no short-circuiting exceptions in v0 beyond `&&` and `||`, which
evaluate their right operand only when the left one does not already decide the
result. Because a projected endpoint that does not hold the result cannot tell
which way that went, neither operand of `&&` or `||` may contain a choreography
function call (spec §16.46).

Order matters here more than it does in a single-endpoint language: an
expression may contain a call whose body communicates, so two endpoints that
evaluated the same expression in different orders would exchange messages in
different orders. Every endpoint program therefore preserves this one order
(spec §12.3).

***

## 6. Namespaces and Scopes

### 6.1 Namespaces

ChoreoBS has the following namespaces:

* location names;
* variable names;
* function names;
* type names / keywords.

Location names may be the same as variable names or function names.

Example:

```ts
function alice@alice(): void {
    return;
}
```

### 6.2 Function Names

* Function overloading is not supported in v0.
* The same function name must not be defined more than once.
* Function names are global: two functions may not share a name, whatever their locations, and a choreography function may not share a name with a local one.
* The **reserved runtime names** listed below cannot be used as a function name, a variable name, or a parameter name.

#### Reserved Runtime Names

Generated BlueScript keeps the original ChoreoBS name (spec §13.3), so a user
identifier that matches a name the generated code itself calls would capture
that call. The following are therefore reserved in every one of the three
positions:

* `nothing` — the compiler-generated placeholder helper (spec §14.1);
* every communication and clone API name (spec §13.8): `sendInteger`,
  `receiveInteger`, `broadcastInteger`, `cloneInteger`, and the corresponding
  names for `Float`, `Boolean`, `String`, `Null`, `IntegerArray`, `FloatArray`
  and `BooleanArray`;
* `__array` and `__push` — compiler-internal call sentinels;
* every identifier beginning with `__`. EPP introduces names of its own, such as the `__transfer_N` temporaries that keep a transfer source to a single evaluation (spec §7.8, §12.9), and reserving the prefix lets it do so without consulting the program.

These are reserved for variables and parameters too, not only for functions: a
variable emitted into the same BlueScript scope shadows the runtime function
just as a function of that name would replace it.

`length` and `push` are **not** reserved. They name array operations only after
a `.` (spec §5.14), so nothing stops a program from also using them as
ordinary names:

```ts
function length@alice(xs: integer[]@alice): integer@alice {
    return xs.length;   // the operation, not a recursive call
}
```

Disallowed:

```ts
function nothing@alice(): void { return; }   // captures the compiler's helper
let sendInteger: integer@alice = 1@alice;    // shadows the runtime API
function f@alice(receiveFloat: integer@alice): void { return; }
```

Disallowed:

```ts
function f@alice(): void {
    return;
}

function f@bob(): void {
    return;
}
```

### 6.3 Function Declaration Hoisting

Function declarations are visible throughout the whole file.

```ts
let x: integer@alice = f();

function f@alice(): integer@alice {
    return 1@alice;
}
```

This is allowed.

### 6.4 Variable Scope

`let` variables are block-scoped.

```ts
if (c) {
    let x: integer@alice = 1@alice;
}
```

`x` is not visible outside the `if` block.

The same variable name must not be defined more than once in the same scope.

Disallowed:

```ts
let x: integer@alice = 1@alice;
let x: integer@alice = 2@alice;
```

A declaration in an inner block may shadow one from an outer block, and a `let`
in a function body may shadow a parameter.

```ts
let x: integer@alice = 1@alice;

if (c) {
    let x: integer@alice = 2@alice;   // shadows the outer `x`
}
```

### 6.5 Top-Level Statements

Non-function top-level statements are treated as the body of an implicit choreography context.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
```

Conceptually, this is similar to:

```ts
function __top(): void {
    let x: integer@alice = 1@alice;
    let y: integer@bob <- x;
}
```

The implementation does not need to generate an actual function named `__top`.

The analogy stops at `return`: there is no function to return from, so `return`
is not allowed at top level (spec §5.12).

### 6.6 Top-Level Let

Top-level `let` declarations are local variables of the implicit top-level context.

Therefore, top-level `let` variables are not visible from functions.

Disallowed:

```ts
let x: integer@alice = 1@alice;

function f@alice(): integer@alice {
    return x;
}
```

***

## 7. Type System

### 7.1 Base Types

The base types in v0 are:

```text
integer
float
boolean
string
null
void
```

`any` and `undefined` do not exist in v0.

#### 7.1.1 Array Types

The mutable array extension adds the following array types:

```text
T[]
```

where `T` is one of:

```text
integer
float
boolean
```

Examples:

```text
integer[]@alice
float[]@bob
boolean[]@every
```

The following array types are not supported:

```text
string[]
null[]
void[]
integer[][]
float[][]
boolean[][]
```

Arrays are mutable reference values.

Within the same location, array assignment, function argument passing, and function return preserve array identity. Therefore, two variables may refer to the same mutable array.

Example:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@alice = xs;
ys[0@alice] = 99@alice;
```

After the element assignment, `xs[0]` is also `99` at `alice`.

A transfer moves array contents by serialized value. The receiver obtains a fresh mutable array that does not share identity with the sender's array. For broadcast to `@every`, the sender-side binding is also a fresh mutable array copy.

A value of type `T[]@every` means that each endpoint has an independent local mutable array with the same contents. It is not shared memory.

### 7.2 Located Types

Expressions fall into two kinds, and most rules in this specification are about
the first:

```text
Gamma |- e : T@L      a value expression
Gamma |- e : void     a void computation
```

A **value expression** produces a value, and that value has a located type:

```text
T@L
```

A **void computation** produces no value. v0 has two: a call to a function whose
return type is `void`, and `xs.push(v)` (spec §7.11.1). Having no value, it has no location (spec §7.3) — but it still
has to run *somewhere*, and where that is comes from the operation itself, not
from a location on its type:

* a call to a local function at `P` runs at `P`;
* a call to a choreography function runs at every endpoint.

Every rule stated for `T@L` — location matching (§7.6), assignment (§7.7),
transfer (§7.8), conditions (§7.9) and the Local Function Strict Location Rule
(§8.2) — applies to value expressions. A void computation satisfies none of them
and needs none of them: it may appear only as an expression statement, where
there is no value to place.

Wherever a value is required, a void computation is an error (spec §16.40).
Type inference is no exception: an omitted annotation infers the initializer's
type, so a `let` initialized by a void call is rejected just as the written form
`let x: void = f();` is. The same applies to a `for` initializer and to an array
literal element.

```ts
function f@alice(): void { return; }

f();                       // valid — a statement
let x = f();               // invalid: the initializer produces no value
let xs = [f()]@alice;      // invalid: an element produces no value
```

Examples:

```text
integer@alice
float@bob
boolean@every
string@sensor
```

### 7.3 Void

`void` is the return type of a function that does not return a value.

Unlike every other type, **`void` has no location**. A location says where a
value is; `void` has no value, so there is nothing to place. Writing one is an
error (spec §16.40):

```ts
function f@alice(): void { ... }         // valid
function f@alice(): void@alice { ... }   // invalid
```

For the same reason `void` is not a value type: it may appear only as a function
return type, never as a variable type, a parameter type, a transfer destination,
or an array element type (spec §16.40).

```ts
function f@alice(): void {
    return;
}
```

After EPP — a `void` return type is kept at every endpoint, because there is no
value that could be absent at one of them (spec §12.2):

```ts
function f(): void {
    return;
}
```

`void` is distinct from `null` (spec §7.4), which is an ordinary value type and
does carry a location.

### 7.4 Null

`null` is a singleton type.

```text
null is the only value of type null.
null is not a subtype of integer, float, boolean, string, or void.
```

Allowed:

```ts
let x: null@alice = null@alice;
```

Disallowed:

```ts
let x: integer@alice = null@alice;
```

### 7.5 Subtyping

The base type subtyping relation is:

```text
integer <: float
T <: T
```

There are no other base type subtyping relations.

### 7.6 Location Matching and Residency

Two distinct relations are used in this specification. They must not be confused.

#### Location Matching (type system)

A value located at `Lvalue` may be used where a value at `Luse` is required only
when the two locations are the same:

```text
match(L, L) = true
match(every, P) = false  where P is an individual location
match(P, every) = false  where P is an individual location
match(P, Q) = false      where P and Q are individual locations and P != Q
```

`every` and the individual locations are independent (spec §3.2): neither
subsumes the other. In particular, a value of type `T@every` may **not** be used
as a `T@P` value, and a value of type `T@P` may **not** be used as a `T@every`
value. To move a value between two different locations, use the transfer
operator `<-` (spec §7.8).

Examples:

```text
integer@alice matches alice
integer@alice does not match bob
integer@every does not match alice
integer@alice does not match an every context
```

This rule applies uniformly to scalars and to mutable arrays, and it is the only
location rule used by assignment (§7.7), function arguments (§7.12), and return
values (§7.13). It also subsumes the local function discipline: inside
`function f@P` the required location is `P`, so a value at `every` or at another
individual location is rejected by the same rule. The additional restrictions
specific to local function declarations are stated in §8.2.

#### Location Residency (endpoint projection)

Endpoint Projection needs a different question answered: which endpoints
physically hold a copy of a value? Define `residesAt(L, P)`, where `P` is an
endpoint:

```text
residesAt(P, P) = true
residesAt(every, P) = true
residesAt(Q, P) = false  where Q is an individual location and Q != P
```

A value at `every` resides at every endpoint, because every endpoint holds its
own copy (spec §3.4). This is why `T@every` declarations are projected into every
endpoint program rather than becoming `absent` (spec §12.2).

Residency does **not** imply matching. That an endpoint `alice` holds a copy of a
`T@every` value does not make that value usable as a `T@alice` value; an explicit
`<-` transfer is still required. `residesAt` is used only by §12 and must
never be used as a typing rule.

### 7.7 Assignment Typing

Assignment:

```ts
a = b;
```

is valid if:

```text
a : T1@L1
b : T2@L2

T2 <: T1
match(L2, L1)
```

For mutable arrays, compatibility is checked by array invariance as defined in Section 7.11.1. Therefore, `T1[]` and `T2[]` are compatible only when `T1` and `T2` are the same element type.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@alice = x;
```

Disallowed:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob = x;
```

Disallowed:

```ts
let c: boolean@every = true@every;
let d: boolean@alice = c;
```

A transfer must be used instead. `every` and `alice` are different locations,
so the copy has to be explicit:

```ts
let d: boolean@alice <- c;
```

The same applies to mutable arrays, by the same rule:

```ts
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice = xs;      // invalid
let ys: float[]@alice <- xs;     // valid: local copy
```

### 7.8 Transfer Typing

The transfer operator:

```ts
a <- b;
```

evaluates `b` at its own location and copies the resulting value to the location
of `a`, storing it in `a`.

#### Base Type Rule

For `a : T1@p` and `b : T2@q`, the transfer is well typed only when

```text
T2 <: T1
```

that is, the source base type must be a subtype of the destination base type
(spec §7.5). Locations play no part in this rule.

Every value type may be transferred: `integer`, `float`, `boolean`, `string`,
`null`, and the array types. Each has its own entry in the communication API
(spec §13.8), so no payload is ever sent through a channel of the wrong type. A
`null` transfer carries no data — it is a synchronisation signal — but it is an
ordinary transfer in every other respect. `void` is not a value type at all and
cannot appear on either side (spec §7.3, §16.40).

Allowed — `integer <: float`:

```ts
let y: integer@alice = 1@alice;
let x: float@bob <- y;
```

Disallowed — `float` is not a subtype of `integer`:

```ts
let y: float@alice = 1.5@alice;
let x: integer@bob <- y;
```

Disallowed — unrelated base types:

```ts
let y: float@alice = 1.5@alice;
let x: string@bob <- y;
```

Arrays remain invariant: for `T[]`, the element types must be exactly the same.
There is no element type conversion.

Disallowed:

```ts
let xs: integer[]@every = [1, 2]@every;
let ys: float[]@alice <- xs;
```

#### Location Rule

There is none. Any concrete location may appear as the source or the
destination, in any combination. What the locations decide is not whether the
transfer is legal, but how it is carried out:

| source | destination | behaviour |
|---|---|---|
| `p` | `p` | local copy |
| `p` | `q`, `q != p` | endpoint-to-endpoint communication |
| `p` | `every` | broadcast; the sender also makes a local copy |
| `every` | `p` | local copy |
| `every` | `every` | local copy at every endpoint |

The unifying rule is residency (spec §7.6). At an endpoint `E` that the
destination resides at, the transfer is a local copy when the source also
resides at `E`, and a receive otherwise. A transfer is therefore a pure local
copy exactly when every endpoint the destination resides at already holds the
source payload — that is, when the source is `@every`, or when the source and
destination locations are the same.

A transfer that performs no communication is ordinary and expected; it is not an
error.

#### The Source Is Evaluated Once

The source of a transfer is an arbitrary expression and may call a function, so
how many times it is evaluated is observable:

> The source expression of a transfer is evaluated exactly once at each endpoint
> where it is evaluated at all.

This needs saying because a broadcast uses the source value twice at the sender
— once as the payload and once for the sender's own binding (spec §11.3). Those
two uses must be the same value. Where the generated code needs the value more
than once, EPP binds it to a temporary first (spec §12.9).

#### Local Copy Is Always a Fresh Copy

Whenever a transfer results in a local copy, the destination receives a **fresh**
value, for scalars and for mutable arrays alike. For a mutable array this means
the destination does not share identity with the source.

This is what distinguishes `<-` from `=` at one and the same location:

```ts
let xs: float[]@alice = [1.1, 2.2]@alice;
let alias: float[]@alice = xs;   // same array
let copy: float[]@alice <- xs;   // fresh array
```

For scalars the two are equivalent, since a scalar assignment already copies the
value.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
```

This is direct communication from `alice` to `bob`.

Example:

```ts
let x: integer@every = 1@every;
let y: integer@alice <- x;
```

This is a local copy at `alice`.

### 7.9 If Condition Typing

An `if` condition must be a `boolean` located at the current context's location.

Let the current context be `C`.

```text
cond : boolean@L
match(L, C)
```

#### Choreography Context

In a choreography function or at top level, the condition must be `boolean@every`. The same applies to `while` and `for` conditions (spec §7.10).

```ts
let c: boolean@every = true@every;

if (c) {
}
```

#### Local Context

Inside `function@alice`, the condition must be `boolean@alice`.

A condition of type `boolean@every` is not allowed inside a local function: `every` does not match `alice` (spec §7.6).

Allowed:

```cbs
function f@alice(c: boolean@alice): void {
    if (c) {
        return;
    }
}
```

Disallowed:

```cbs
function f@alice(c: boolean@every): void {
    if (c) {
        return;
    }
}
```

### 7.10 While and For Condition Typing

The termination conditions of `while` and `for` follow the same rule as `if`.

* In a choreography context, the condition must be `boolean@every`.
* In a local `@p` context, the condition must be `boolean@p`. `boolean@every` is not allowed inside local functions.

### 7.11 Operators

Every operator requires its operands to be scalars: no operator is defined over
array types (spec §7.11.1). Sections 7.11 and 7.11.1 together cover all of them.

#### Arithmetic Operators

```text
+ - * / %
```

These operators are available for `integer` and `float`.

Because `integer <: float`, an `integer` may be used where a `float` is expected.

BlueScript performs implicit conversion from `integer` to `float`; therefore, the ChoreoBS transpiler does not insert explicit conversion functions.

The inferred result base type is:

```text
integer op integer => integer
integer op float   => float
float   op integer => float
float   op float   => float
```

Both operands must be located at the same location (spec §7.6); the result is
located there too. Mixing an `@every` operand with an individual-location operand
is a compile-time error.

#### String Concatenation

`string + string` is allowed.

```ts
let s: string@alice = "hello "@alice + "world"@alice;
```

The inferred result type is `string` at the operand location.

#### Comparison Operators

```text
< <= > >=
```

These operators are available for numeric values — `integer` and `float` only.
`string`, `boolean`, `null` and array operands are rejected (spec §16.43).

They promote like the arithmetic operators do: an `integer` operand may be
compared with a `float` one, because `integer <: float` (spec §7.5).

```ts
1@alice < 1.5@alice     // valid
```

Both operands must be located at the same location, and the result is a
`boolean` there.

Example:

```ts
let x: integer@alice = 1@alice;
let c = x < 10@alice;
```

`c` is inferred as `boolean@alice`.

#### Equality Operators

```text
===
!==
```

These operators are available for values of **exactly** the same base type.
Unlike the arithmetic and relational operators, they do not promote:
`integer === float` is rejected even though `integer <: float` (spec §16.43).
Equality is the one place where the two numeric types stay apart, so that
`===` never has to decide what equality across representations means.

```ts
1@alice === 1.0@alice   // invalid
1@alice === 2@alice     // valid
```

Both operands must be located at the same location, and the result is a
`boolean` there.

`==` and `!=` are not allowed.

Array types are not base types. The equality operators `===` and `!==` are not defined for array types.

Nor is `void`. A void computation produces no value (spec §7.2), so there is
nothing for `===` to compare — and `void === void` would otherwise slip past
the same-base-type rule above (spec §16.43).

#### Logical Operators

```text
&&
||
```

These operators are available for `boolean`.

The inferred result type is `boolean` at the operand location.

Unlike every other operator, these two evaluate their right operand
conditionally (spec §5.17). Neither operand may contain a call to a
choreography function, directly or through a nested expression: such a call
runs at every endpoint (spec §12.11), but only the endpoints holding the
operand's value can tell whether the short circuit skipped it. See §16.46, and
§17.6 for what lifting the restriction would take.

#### Unary Operators

```text
-  !
```

`-` requires an `integer` or a `float` operand; the result has the operand's own
base type. `!` requires a `boolean` operand; the result is `boolean`.

In both cases the result is located where the operand is:

```text
e : T@L
-e : T@L      where T is integer or float
!e : boolean@L    where e : boolean@L
```

A unary expression is evaluated wherever its operand is, so it introduces no
location constraint of its own beyond the one the operand already carries: in a
local function at `P` the operand must be at `P` like any other expression
(spec §8.2), and in a choreography context the operand may be at any single
location.

Examples:

```ts
let x: integer@alice = 1@alice;
let y = -x;               // y : integer@alice
let c = !(x < 10@alice);  // c : boolean@alice
```

Neither operator accepts an array operand, even when the element type would fit
(spec §16.42):

```ts
let xs: boolean[]@alice = [true]@alice;
let bad = !xs;            // invalid
```

Unary operators bind tighter than every binary operator and are right
associative (spec §5.14), so `-a * b` is `(-a) * b` and `!!c` is `!(!c)`.

### 7.11.1 Array Typing

#### Array Invariance

Array types are invariant. `T1[]` is compatible with `T2[]` only when `T1` and `T2` are the same element type.

Therefore, `integer[]` is not a subtype of `float[]`, even though `integer <: float`.

Disallowed:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: float[]@alice = xs;
```

Array literals may still be checked against an explicitly expected array type.

```ts
let xs: float[]@alice = [1, 2]@alice;
```

This is allowed because each integer element is checked against the expected `float` element type. It is not an array subtyping conversion.

#### Array Literal Typing

For an array literal `[e1, ..., en]@L`, each element must be located at `L`. Unlocated literal elements are elaborated to `@L` before type checking. Only unlocated literal elements are elaborated to `@L`; other expressions keep their inferred located types.

The inferred element type of a non-empty array literal is computed from the element base types. `integer` and `float` elements have LUB `float`. Other mixed element types are invalid.

Examples:

```ts
let xs = [1, 2, 3]@alice;
// xs : integer[]@alice

let ys = [1, 2.5]@alice;
// ys : float[]@alice

let zs = [true, false]@alice;
// zs : boolean[]@alice
```

Disallowed:

```ts
let bad = [1, true]@alice;
```

An empty array literal cannot infer its element type. It is allowed only when checked against an explicit array type and when the array literal has an explicit location annotation.

Allowed:

```ts
let xs: integer[]@alice = []@alice;
```

Disallowed:

```ts
let xs = []@alice;
let ys: integer[]@alice = [];
```

#### Index Access

For an index expression `xs[i]`:

```text
xs : T[]@L
i  : integer@M
match(M, L)
```

then:

```text
xs[i] : T@L
```

The index expression must have type `integer`. Bounds checking is a runtime responsibility of BlueScript.

#### Array Element Assignment

For an array element assignment `xs[i] = v;`:

```text
xs : T[]@L
i  : integer@Li
v  : S@Lv
S <: T
match(Li, L)
match(Lv, L)
```

then the assignment is valid.

Only assignment targets of the form `Identifier[Expression]` are supported. General lvalues such as `f()[i]`, `xs[i][j]`, and property assignments are not supported.

#### `.length`

`xs.length` is a compiler-known array operation (spec §5.14).

```text
xs : T[]@L
```

then:

```text
xs.length : integer@L
```

In this rule, `T` must be `integer`, `float`, or `boolean`. In particular
`.length` is **not** defined on `string`: v0 has no string operations at all
(spec §17.2).

#### `.push`

`xs.push(v)` is a compiler-known expression (spec §5.14).

```text
xs : T[]@L
v  : S@M
S <: T
match(M, L)
```

then:

```text
xs.push(v) : void
```

Appending produces no value, so the result is `void` and carries no location a
program can write or observe (spec §7.3). It is a void computation (spec §7.2):
the only place it can stand is an expression statement, and every value
position rejects it exactly as it rejects a call to a `void` function
(spec §16.40).

```ts
xs.push(1@alice);            // valid
let n = xs.push(1@alice);    // invalid (spec §16.40)
```

Internally the result still travels with the array's location, which is what
decides the endpoints that perform the append (spec §12.14.1).

In this rule, `T` must be `integer`, `float`, or `boolean`.

#### `@every` Arrays Are Not Special

The location rule of §7.6 applies to arrays exactly as it does to scalars; there
is no array-specific restriction. This section only spells the rule out for
arrays, because the shared-memory reading of `T[]@every` is the one people
reach for. `T[]@every` is *not* shared memory: each endpoint has its own array
(spec §3.4), so there is nothing an individual location could borrow.

An `@every` array therefore cannot be used where an individual-location array is
required, for the same reason a `boolean@every` cannot be used as a
`boolean@alice` (spec §7.7, §16.7).

Disallowed:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice = xs;
```

Similarly, a value of type `T[]@every` must not be passed to a function parameter of type `T[]@P` where `P` is an individual location. This restriction applies to all functions, not only local functions.

Disallowed:

```ts
function f@alice(xs: integer[]@alice): void {
    return;
}
let xs: integer[]@every = [1, 2, 3]@every;
f(xs);
```

To create an individual-location mutable array from an `@every` array, transfer it with `<-`:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice <- xs;
```

This creates a fresh mutable copy at `alice`.

To create an `@every` array from an individual-location array, use broadcast:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys: integer[]@every <- xs;
```

#### Array Equality

The equality operators `===` and `!==` are not defined for array types.

Disallowed:

```ts
let xs: integer[]@alice = [1]@alice;
xs === xs;
```

### 7.12 Function Call Typing

Function calls do not specify locations at the call site.

```ts
add(1@alice, 2@alice)
```

Whether a function call is valid depends on the location of the function definition.

The inferred type of a function call expression is the declared or inferred return type of the called function.


#### Function Argument Typing

For a function call:

```cbs
f(arg1, ..., argN)
```

let the corresponding parameter types be:

```text
p1 : T1@L1, ..., pN : TN@LN
```

and let the argument expression types be:

```text
arg1 : S1@M1, ..., argN : SN@MN
```

Each argument is valid if:

```text
Si <: Ti
match(Mi, Li)
```

The argument location must be the same as the parameter location. A value of
type `T@every` is therefore **not** accepted by a parameter of type `T@P`, where
`P` is an individual location; copy it first with `<-` (spec §7.6).

For mutable array parameters, array invariance applies. A parameter of type `T[]@L` accepts an argument of type `T[]@M` only when the element types are exactly the same and the location rule is satisfied.

Disallowed:

```cbs
function add@alice(a: integer@alice): integer@alice {
    return a;
}

add(10@every);
```

Use an argument already located at `alice`:

```cbs
add(10@alice);
```

Or, when the value only exists at `every`, localize it first:

```ts
let arr: float[]@every = [1.1, 2.2]@every;
let arrAlice: float[]@alice <- arr;
average(arrAlice);
```

A local function parameter explicitly declared as `T@every` is invalid for a
separate reason, stated in §8.2.

#### In a Choreography Context

The following function calls are allowed:

* calls to choreography functions;
* calls to local functions.

#### In a Local Context

Inside `function@alice`, only `@alice` local functions may be called.

The following are disallowed:

* calls to local functions at other endpoints;
* calls to choreography functions.

`.length` and `.push` are array operations, not calls (spec §5.14), so this rule
does not reach them: they may be used in any context, local or choreography.

### 7.13 Return Typing

When a function has an explicit return type:

```ts
return expr;
```

is allowed if the type of `expr` is compatible with the function return type.

```ts
return;
```

is allowed only if the function return type is `void`.

When a function omits its return type, the return type is inferred according to Section 7.14.

#### Return Coverage

A function whose return type is not `void` must return a value on every
execution path. This holds whether the return type is written or inferred, and
is checked by the same conservative syntactic analysis in both cases
(spec §7.14.6, §16.41).

```ts
function bad@alice(c: boolean@alice): integer@alice {   // invalid (spec §16.41)
    if (c) {
        return 1@alice;
    }
}
```

A `void` function needs no coverage: falling off the end is the same as
`return;`.

### 7.14 Type Inference

ChoreoBS Core v0 supports simple, local type inference. This feature does not perform general location inference. It only uses types and locations already determined by literals, identifiers, function signatures, and expression typing.

The compiler should elaborate inferred constructs into a fully typed AST before Endpoint Projection.

#### 7.14.1 Let Type Inference

For an ordinary initialized `let` declaration:

```ts
let x = expr;
```

if:

```text
expr : T@L
```

then:

```text
x : T@L
```

Examples:

```ts
let x = 1@alice;          // x : integer@alice
let y = x + 2@alice;      // y : integer@alice
let c = y < 10@alice;     // c : boolean@alice
let e = true@every;       // e : boolean@every
```

A `let` declaration with a fully explicit type annotation is still checked using the normal assignment typing rule.

```ts
let x: float@alice = 1@alice;
```

This is valid because `integer <: float`.

#### Partial Annotations

The location may be omitted from the type annotation of an initialized `let`. It
is then taken from the initializer, while the base type comes from the
annotation:

```ts
let a: integer = 3@mcu;   // a : integer@mcu
let b: float = 3@mcu;     // b : float@mcu   (base from the annotation)
```

A written location always wins, so a mismatch is still reported:

```ts
let c: integer@server = 3@mcu;   // invalid (spec §16.7)
```

This applies to a `for` initializer `let` as well (spec §7.14.2). It does **not**
apply anywhere there is no initializer to read the location from — function
parameters and return types still require an explicit location (spec §16.3) —
nor to a transfer `let` (spec §7.14.3).

#### 7.14.2 For Initializer Let Type Inference

For a C-style `for` initializer:

```ts
for (let i = expr; cond; update) {
    ...
}
```

if:

```text
expr : T@L
```

then:

```text
i : T@L
```

#### 7.14.3 Transfer Let Does Not Infer Destination Type

Transfer declarations keep the existing syntax:

```ts
let y: integer@bob <- x;
```

The type annotation is required, including its location. Unlike an initialized
`let` (spec §7.14.1), the location is **not** taken from the right-hand side:
the destination location is the whole point of a transfer, and inferring it from
the source would make every transfer a no-op local copy.

The following remain invalid:

```ts
let y <- x;
let y: integer <- x;
```

#### 7.14.4 Function Return Type Inference

A function declaration may omit its return type:

```ts
function f@L(params) {
    body
}
```

The compiler infers the function return type from `return` statements in the body.

If all returns are bare `return;`, or if there are no return statements, the inferred return type is `void`, which carries no location (spec §7.3).

For `return expr;`, the return candidate is the type of `expr`.

For multiple return candidates, the compiler computes their least upper bound using the following rules.

For base types:

```text
lub(integer, integer) = integer
lub(integer, float)   = float
lub(float, integer)   = float
lub(float, float)     = float
lub(T, T)             = T
```

All other base type combinations are invalid.

For array types, return type inference uses array invariance:

```text
lub(T[], T[]) = T[]
```

All other array type combinations are invalid. In particular, `integer[]` and `float[]` do not have a LUB for inferred return types.

For locations, Core v0 return type inference is conservative:

```text
lub_location(L, L) = L
```

All other location combinations are invalid.

Example:

```ts
function f@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    } else {
        return 2.5@alice;
    }
}
```

The return type is inferred as `float@alice`.

#### 7.14.5 Mixing `return;` and `return expr;`

A function with an omitted return type must not mix bare `return;` and value-returning `return expr;`.

#### 7.14.6 Return Coverage for Non-`void` Functions

If a function with an omitted return type contains any `return expr;`, then all execution paths must return a value. The same requirement applies to a function with a written non-`void` return type (spec §7.13).

Core v0 requires only a conservative syntactic return coverage analysis. At minimum, an implementation must accept:

- a final `return expr;` statement in the function body;
- an `if (...) { ... } else { ... }` statement where both branches are definitely returning;
- nested combinations of the above.

The compiler may reject programs whose totality is not proven by this conservative analysis.

#### 7.14.7 Parameter Types Are Not Inferred

Function parameter types are not inferred in Core v0.

Disallowed:

```ts
function add@alice(a, b) {
    return a + b;
}
```

Allowed:

```ts
function add@alice(a: integer@alice, b: integer@alice) {
    return a + b;
}
```

#### 7.14.8 Inference and Recursion

Local function recursion is allowed, but recursive local functions must have explicit return types in Core v0.

Therefore:

- direct or indirect recursive local functions with omitted return types are compile-time errors;
- direct or indirect recursive local functions with explicit return types are allowed;
- choreography recursion remains unsupported.

***

## 8. Location Annotation Rules

### 8.1 Explicit Location Annotations

Every type annotation and every literal must carry its own location annotation,
except on an initialized `let`, where the location is taken from the initializer
(spec §7.14.1).

`void` is outside this rule rather than an exception to it: it has no value to
place, so it takes no location annotation at all, and writing one is an error
(spec §7.3, §16.40).

A location is **never** inferred from the surrounding *context*: the enclosing
function's location does not supply a default. The `let` case is not a context
rule — the location comes from the declaration's own right-hand side.

Disallowed, in a local function:

```ts
function add@alice(a: integer, b: integer): integer {
    return a + b + 1;
}
```

Allowed:

```ts
function add@alice(
    a: integer@alice,
    b: integer@alice
): integer@alice {
    return a + b + 1@alice;
}
```

The same rule applies in a choreography function and at top level, which are not
special cases of it:

```ts
function f(): void {
    let x: integer = 1;              // invalid: the literal has no location
    let y: integer = 1@alice;        // valid: y : integer@alice (§7.14.1)
    let z: integer@alice = 1@alice;  // valid
}
```

```ts
let x = 1;                       // invalid: the literal has no location
let y: integer = 1;              // invalid: same reason
let z: integer = 1@alice;        // valid: z : integer@alice
let w: integer@alice = 1@alice;  // valid
```

Note that in `let y: integer = 1;` it is the **literal** that is missing its
location, not the type annotation.

This rule is about the location annotation on a **type or literal**. It does not
reach a **function declaration** at all. There, the presence of a location
selects the kind of function — a location declares a local function, no location
declares a choreography function (spec §10.1) — so neither form is an omission.

This rule governs location annotations only. It does not affect **type**
inference (§7.14), which is a separate mechanism:

```ts
let x = 1@alice;   // valid: `x : integer@alice` is inferred from the initializer
```

and a function may still omit its return type entirely, in which case the return
type — including its location — is inferred from the `return` statements (§7.14.4).

```ts
function f@alice(a: integer@alice) {   // valid: returns@alice integer@alice
    return a;
}
```

Nor does it affect the filling of unlocated literal elements of an array literal
from that literal's **own** annotation (§5.16), which reads no context:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;   // valid
```

### 8.2 Local Function Strict Location Rule

For a local function declared at an individual location `P`:

```cbs
function f@P(...) {
    ...
}
```

all parameters, return values, and expressions evaluated in the function body must be located at `P`.

Rules:

- Every parameter type must be located at `P`.
- A parameter type explicitly located at another individual location `Q`, where `Q != P`, is a compile-time error.
- A parameter type explicitly located at `every` is a compile-time error.
- The explicit or inferred return type of a local function must be located at `P`, unless it is `void`, which has no location (spec §7.3) and is allowed in a local function like any other.
- A return type explicitly or implicitly located at another individual location `Q`, where `Q != P`, is a compile-time error.
- A return type explicitly or implicitly located at `every` is a compile-time error.
- Every **value** expression evaluated inside the local function body must have a type located at `P`. A void computation has no location to check (spec §7.2); a call to a local `void` function is instead governed by §10.3, which already restricts a local body to calling local functions at `P`.
- Every variable declared in the local function body must have a type located at `P`. This includes the destination type of a transfer `let`, which is a declaration and not an expression.
- Values located at `every` are not allowed inside local function bodies.
- Values located at another individual location are not allowed inside local function bodies.
- A transfer inside a local function has the function's own location on both sides, so it is always a local copy (spec §11.4). This follows from the rules above rather than being a separate restriction: the source must be an expression at `P`, and the destination must be a variable at `P`.

Allowed:

```cbs
function add@bob(a: integer@bob, b: integer@bob): integer@bob {
    return a + b;
}
```

Disallowed:

```cbs
function bad@bob(a: integer@alice, b: integer@bob): integer@bob {
    return a;
}
```

Disallowed:

```cbs
function bad@bob(x: integer@every): integer@bob {
    return x;
}
```

Disallowed:

```cbs
function bad@bob(): integer@every {
    return 1@every;
}
```

Disallowed:

```cbs
function bad@bob(): integer@alice {
    return 1@alice;
}
```

Disallowed:

```cbs
function bad@bob(): integer@bob {
    let x = 1@every;
    return x;
}
```

Disallowed — the destination of a transfer is a variable of this body, so it
must be at `bob`. Were this accepted, `bob` would send from inside a function
that only `bob` runs, and `alice` would have no matching receive:

```cbs
function bad@bob(x: integer@bob): integer@bob {
    let y: integer@alice <- x;
    return x;
}
```

This rule is intentionally stricter than ordinary location availability. In particular, `T@every` is not permitted in local function parameters, local function return types, or local function bodies.

### 8.3 `@every` Literals

`@every` literals are allowed in choreography contexts.

```ts
true@every
1@every
"ok"@every
null@every
```

`@every` literals are not allowed inside local function bodies, because local functions use the Local Function Strict Location Rule.

## 9. Statements and Expressions

### 9.1 Semicolons

In v0, statement-ending semicolons are required.

Required, inside a function at `alice`:

```ts
let x: integer@alice = 1@alice;
x = x + 1@alice;
return x;
```

Not required after the closing brace of a compound construct:

```ts
function f@alice(): void {
    return;
}
```

```ts
function g@alice(c: boolean@alice): void {
    if (c) {
        return;
    }

    while (c) {
        return;
    }

    for (let i = 0@alice; i < 10@alice; i = i + 1@alice) {
        return;
    }
}
```

The bodies are written out in full here because the location rules still apply
inside them: every literal carries its own location (spec §8.1), and `return`
only appears inside a function (spec §5.12).

### 9.2 Let Statements

Only initialized `let` declarations are allowed.

```ts
let x: integer@alice = 1@alice;
```

Transfer declarations are also allowed.

```ts
let y: integer@bob <- x;
```

### 9.3 Assignment Statements

Assignment is a statement only.

```ts
x = y;
```

Assignments do not produce values.

### 9.4 Transfer Statements

A transfer is a statement only.

```ts
y <- x;
```

Transfer statements do not produce values.

### 9.5 If Statements

`else` is optional.

```ts
if (c) {
    return;
}
```

```ts
if (c) {
    return;
} else {
    return;
}
```

### 9.6 While Statements

`while` is a statement.

```ts
while (c) {
    // body
}
```

### 9.7 For Statements

Only C-style `for` loops are supported.

```ts
for (let i = 0@every; i < 10@every; i = i + 1@every) {
    // body
}
```

`for-of` and `for-in` are not supported.

### 9.8 Break and Continue

`break` and `continue` are not supported in v0.

### 9.9 Expression Statements

Expression statements are allowed. The expression need not have an effect:
`xs[0@alice];` and `xs.length;` are legal, if pointless. v0 performs no
dead-code elimination (spec §17.7) and singles out no expression form here.

After EPP, expressions unrelated to the current endpoint may be transformed into `nothing(...)` or `null`.

These compiler-generated artifacts are cleaned up by the Projected AST Cleanup pass defined in Section 13.9.

`xs.push(v);` is an expression statement like any other. Its expression is a
void computation (spec §7.2, §7.11.1), so this is the only position it may
stand in; using it as a subexpression or an initializer is a type error
(spec §16.40).

***

## 10. Function Rules

### 10.1 Function Kinds

ChoreoBS has two kinds of functions, distinguished by how many endpoints run
them.

A local function runs at the single endpoint named by its location. A
choreography function runs at **every** endpoint: each endpoint executes its own
projection of it (spec §12.11). The two are separate kinds, not one derived from
the other — a choreography function is not a local function with something left
out. Since it is not the function of any one endpoint, no single location names
it, and its declaration carries none.

#### Choreography Function

Declared with no location:

```ts
function f(...): T@L {
    ...
}
```

or, with inferred return type:

```ts
function f(...) {
    ...
}
```

- Describes choreography.
- May contain transfers.
- Is projected to all endpoints.
- May call choreography functions and local functions (spec §10.2).
- Allows return type inference.
- Recursion, direct or mutual, is not supported in v0 (spec §10.4).

A location on a function declaration names the one endpoint that runs the
function, so it always declares a local function and must be an individual
location; `@every` is not a function location (spec §16.39). `@every` remains
available as a value location, e.g. `boolean@every`.

#### Local Function

```ts
function f@alice(...): T@alice {
    ...
}
```

or, with inferred return type:

```ts
function f@alice(...) {
    ...
}
```

- Runs on a single endpoint; the location must be an individual location.
- Is generated only for the corresponding endpoint.
- May call only local functions at the same endpoint (spec §10.3).
- May contain transfers, but both sides are necessarily at the function's own
  location, so a transfer there is always a local copy (spec §11.4).
- Allows return type inference.
- Recursion is allowed only when the recursive function has an explicit return type.

### 10.2 Calling Local Functions from a Choreography Context

A choreography context may call local functions. At endpoints where the function's location does not match, the callee is not generated and the call projects to `nothing(...)` over its arguments (spec §12.11). It is removed by cleanup when none of those arguments holds a computation this endpoint owes (spec §13.9).

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}

let x: integer@alice = add(1@alice, 2@alice);
```

EPP at `alice`:

```ts
function add(a: integer, b: integer): integer {
    return a + b;
}

let x: integer = add(1, 2);
```

EPP at `bob` — `add` is not generated there, so there is no call for `bob` to
make and the binding has nowhere to go (spec §12.3):

```ts
// removed
```

An argument must already be located at the parameter's location. A value at
`@every` — a mutable array or otherwise — must be localized with `<-` first.

```ts
function average@alice(arr: float[]@alice): float@alice {
    return 0.0@alice;
}

let arr: float[]@every = [1.1, 2.2]@every;
let arrAlice: float[]@alice <- arr;
let avg: float@alice = average(arrAlice);
```

### 10.3 Calling Functions from a Local Context

Inside `function@alice`, only `@alice` local functions may be called.

Allowed:

```ts
function f@alice(): integer@alice {
    return 1@alice;
}

function g@alice(): integer@alice {
    return f();
}
```

Disallowed:

```ts
function f@bob(): integer@bob {
    return 1@bob;
}

function g@alice(): integer@alice {
    return f();
}
```

Disallowed:

```ts
function h(): void {
    return;
}

function g@alice(): void {
    h();
}
```

### 10.4 Recursion

* Local function recursion is allowed.
* choreography function recursion is not supported in v0, whether direct or mutual;
* ChoreoBS v0 does not guarantee termination of local recursion.

Allowed:

```ts
function fact@alice(n: integer@alice): integer@alice {
    if (n <= 1@alice) {
        return 1@alice;
    } else {
        return n * fact(n - 1@alice);
    }
}
```

Disallowed:

```ts
function fact@alice(n: integer@alice) {
    if (n <= 1@alice) {
        return 1@alice;
    } else {
        return n * fact(n - 1@alice);
    }
}
```

Disallowed:

```ts
function loop(n: integer@every): void {
    if (n > 0@every) {
        loop(n - 1@every);
    }
    return;
}
```

***

## 11. Transfer Semantics

### 11.1 Transfer Operator

```ts
a <- b;
```

means:

> Copy the value of `b` to the location of `a`, then store it in `a`.

Depending on the source and destination locations, this is one of:

* direct communication between two different individual locations;
* broadcast from one individual location to `@every`;
* a local copy, when the destination already holds the source payload
  (spec §11.4).

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
```

Meaning:

```text
alice -> bob: x
```

### 11.2 Direct Communication

If the source and destination are different individual locations, direct communication is used.

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
```

EPP at `alice`:

```ts
let x: integer = 10;
sendInteger("bob", "top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "top_0");
```

### 11.3 Broadcast Communication

If the destination is `@every` and the source is an individual location, the communication is treated as a broadcast.

```ts
let x: boolean@alice = true@alice;
let c: boolean@every <- x;
```

EPP at `alice`:

```ts
let x: boolean = true;
broadcastBoolean("top_0", x);
let c: boolean = x;
```

EPP at `bob`:

```ts
let c: boolean = receiveBoolean("alice", "top_0");
```

For scalar broadcast, the sender-side `@every` binding may be initialized from the source value.

For array broadcast, the sender-side `@every` binding must be a fresh mutable copy of the source array.

```ts
let xs: float[]@alice = [1.1, 2.2]@alice;
let ys: float[]@every <- xs;
```

EPP at `alice`:

```ts
let xs: float[] = [1.1, 2.2];
broadcastFloatArray("top_0", xs);
let ys: float[] = cloneFloatArray(xs);
```

### 11.4 Local Copy

When the destination already holds the source payload, `<-` performs no network
communication. It is a local copy instead. This covers three cases (spec §7.8):

* `every -> P` — the value already exists at every endpoint, so `P` has it;
* `P -> P` — source and destination are the same individual location;
* `every -> every` — a local copy at every endpoint.

A local copy always produces a **fresh** value at the destination.

For scalar values, a local copy is ordinary local initialization or assignment,
which already copies the value.

```ts
let x: integer@every = 1@every;
let y: integer@alice <- x;
```

EPP at `alice`:

```ts
let x: integer = 1;
let y: integer = x;
```

For mutable arrays, a local copy creates a fresh mutable array at the
destination, so the two do not share identity.

```ts
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <- xs;
```

EPP at `alice`:

```ts
let xs: float[] = [1.1, 2.2];
let ys: float[] = cloneFloatArray(xs);
```

An `every -> every` local copy is emitted at every endpoint:

```ts
let a: integer@every = 1@every;
let b: integer@every <- a;
```

EPP at `alice` and at `bob`:

```ts
let a: integer = 1;
let b: integer = a;
```

No `send`, `receive`, `broadcast`, or communication tag is generated for a local
copy.

### 11.5 Communication Tags

Each transfer that performs communication — that is, each `direct` or `broadcast` transfer — is assigned a static tag. A local copy performs no communication and is given no tag (spec §11.4).

Tags have the following properties:

* They are unique within a compilation unit. Uniqueness within a function is not enough: two communications in different functions could otherwise share a tag and be in flight at the same time. The recommended format below achieves this because function names are global (spec §6.2) — but note that the top-level scope name must then not be one a function can take.
* They are stable within the same compilation unit.
* Implementations may choose any string format.

A tag identifies a *communication in the program*, not a single message. The
same tag is reused by every execution of that communication — on each iteration
of a loop, and on each call of the function containing it (spec §15.5).

Reusing a static tag this way is only sound under the execution model v0
assumes, so that model is stated here rather than left implicit:

> ChoreoBS Core v0 execution is synchronous. A choreography has one thread of
> control per endpoint, and a choreography function is never invoked
> concurrently with itself. Communications between a given pair of endpoints are
> matched in the order they are performed, so the runtime must deliver messages
> between that pair in FIFO order.

Under that model, two messages carrying the same tag can never be in flight
between the same pair of endpoints at once, and the receiver's `n`-th receive
for a tag pairs with the sender's `n`-th send for it.

A runtime that matched messages by tag alone and allowed overlapping
invocations would need something stronger — a dynamic invocation identifier, or
a tag scheme that distinguishes activations.

Recommended format:

```text
<scopeName>_<serial>
```

Examples:

```text
top_0
top_1
foo_0
foo_1
```

***

## 12. Endpoint Projection

### 12.1 Definition

Endpoint Projection, EPP, transforms a ChoreoBS program into a BlueScript program for each endpoint.

```text
EPP(program, endpoint) -> BlueScript program
```

Before EPP, all inferred types must be elaborated into explicit located types in the internal AST.

### 12.2 Type Projection

Projection of a located type `T@L` to endpoint `P` is:

```text
if residesAt(L, P):
    T
else:
    absent
```

`void` has no location (spec §7.3) and is never absent: it projects to `void` at
every endpoint. A `void` return type therefore keeps its signature everywhere,
which is what makes the projected `return;` well formed.

```text
void projected to any endpoint -> void
```

Examples:

```text
integer@alice projected to alice -> integer
integer@alice projected to bob   -> absent
integer@every projected to bob   -> integer
void projected to bob            -> void
```

### 12.3 Expression Projection

Two questions have to be kept apart, and conflating them is the single easiest
way to get EPP wrong:

* **where a value resides** — which endpoints hold a copy of the result; and
* **where a computation must execute** — which endpoints have to run it.

For most expression forms the two coincide. They come apart at a call: a
choreography function runs at every endpoint (spec §12.11), so `P` must execute
the call even when the result lives somewhere else entirely.

#### The Rule

Projection is a structural recursion over the expression. For an expression
`e : T@L` at endpoint `P`:

```text
if residesAt(L, P):
    project each subexpression and keep the form
else:
    do not perform the operation; preserve the subexpressions' evaluation
```

The second branch is the whole of the difference. `P` has no value to apply the
operator or the callee to, so neither is reproduced. What *is* reproduced is
the evaluation of the operands, structurally and in source order, collected in
a compiler-generated `nothing(...)` that evaluates each one exactly once,
discards their values and yields `null` (spec §14.1).

```text
strict binary:        e1 op e2   =>  nothing(project(e1), project(e2))
unary:                op e       =>  nothing(project(e))
index:                xs[i]      =>  nothing(project(xs), project(i))
length:               xs.length  =>  nothing(project(xs))
array literal:        [e1, ...]  =>  nothing(project(e1), ...)
call, callee here:    f(e1, ...) =>  f(project(e1), ...)
call, callee absent:  f(e1, ...) =>  nothing(project(e1), ...)
literal, identifier:                 absent
```

A call whose callee `P` does generate is kept as a call, not wrapped: the
projected callee returns `null` at `P` (spec §12.2), so the call already stands
in for the absent value wherever one is needed. A call whose callee `P` does
not generate — a local function at another endpoint — disappears, but its
arguments do not: they are ordinary expressions that may contain choreography
calls of their own. With no arguments that leaves `nothing()`, which cleanup
removes (spec §13.9).

`&&` and `||` are the exception. `nothing(...)` evaluates all of its arguments,
so hoisting a short-circuit operand into one would run code the original
skipped. They project to `absent` instead, which is sound because §16.46 keeps
choreography calls out of both operands: there is nothing left for `P` to run.

The recursion never crosses back: a subexpression whose value happens to reside
at `P` is still only evaluated, never handed back as a value. A call's
arguments are the one exception, since the call does want those values.

Nested `nothing(...)` artifacts are left nested. Flattening them is not part of
Core v0 (spec §13.9, §17.6).

#### Why the Operands Are Enough

Whenever a composite expression's result is absent at `P`, the subexpressions
that carry its value are absent at `P` too — the type rules leave no room for
anything else:

* both operands of a binary operator are at one location, and so is the result
  (spec §7.11);
* an index expression is at its array's location (spec §16.37);
* a local function's parameters are at its own endpoint (spec §16.25), and
  arguments must match (spec §16.28);
* a `let` and a simple assignment have one location on both sides (spec §7.7).

So a `nothing(...)` built this way holds only `absent` leaves and calls `P`
must make. Nothing resident is discarded, and cleanup's deliberately blunt rule
— fold only when every argument is syntactically `null` — loses nothing
(spec §13.9).

A transfer is the one place a location boundary is crossed on purpose, so its
source needs the rule stated separately; see §12.9.

#### Calls Survive an Absent Result

An absent *value* does not mean absent *work*. A choreography function is
projected to every endpoint and its body may communicate, so `P` must still
call it even when the call's result is located elsewhere.

```ts
function relay(a: integer@alice): integer@alice {
    let b: integer@bob <- a;
    let c: integer@alice <- b;
    return c;
}

let x: integer@alice = 1@alice;
let y: integer@alice = -relay(x);
```

EPP at `bob`:

```ts
function relay(a: null): null {
    let b: integer = receiveInteger("alice", "relay_0");
    sendInteger("alice", "relay_1", b);
    return null;
}

nothing(relay(null));
```

Erasing that statement at `bob` would leave `alice` blocked forever on the
matching receive.

Order is preserved along with the calls, because the `nothing(...)` tree mirrors
the source tree and both evaluate left to right:

```ts
get3() + get3() * get4();
```

at an endpoint where the result is absent:

```ts
nothing(
    get3(),
    nothing(get3(), get4())
);
```

`get3`, `get3`, `get4` — the same order as the source, and each called once.

#### A Discarded Result Is Not a Discarded Call

Where the projected expression sits in a statement whose value has nowhere to go
at `P`, the statement becomes an evaluation-only expression statement (§12.8,
§12.9, §12.10). No wrapper is added on top of what projection already produced:

```ts
function choose(c: boolean@every): integer@alice {
    if (c) {
        return 1@alice;
    } else {
        return 0@alice;
    }
}

let c: boolean@every = true@every;
let x: integer@alice = choose(c);
```

EPP at `bob`:

```ts
function choose(c: boolean): null {
    if (c) {
        return null;
    } else {
        return null;
    }
}

let c: boolean = true;
choose(c);
```

When such a statement holds nothing `P` must run, it simplifies to `null` and
disappears entirely (spec §13.9).

#### Positions With No Room for a Statement

A call argument, a `return` value and a `for` header slot are expressions, not
statements. Nothing special is needed there: the projection of §12.3 is already
an expression that yields `null`, so it goes straight into the slot.

```ts
function get3(): integer@mcu {
    let a: integer@server <- 3@mcu;
    return 3@mcu;
}

function add(a: integer@mcu, b: integer@mcu): integer@mcu {
    let c: integer@server <- 3@mcu;
    return a + b;
}

add(3@mcu, get3());
```

EPP at `server`:

```ts
function get3(): null {
    let a: integer = receiveInteger("mcu", "get3_0");
    return null;
}

function add(a: null, b: null): null {
    let c: integer = receiveInteger("mcu", "add_0");
    return null;
}

add(null, get3());
```

`server` calls `get3` and `add` in the same order `mcu` does, so each receive
runs against the matching send. Projecting the argument `get3()` to a bare
`null` would drop that call, and `mcu` would block on the receive inside
`get3` forever.

### 12.4 Absent

`absent` is an internal intermediate representation used only during EPP.

* It does not exist in the source language.
* It is distinct from source-level `null`.
* It is never emitted to final BlueScript output.
* It is turned into `null` by absent finalization, a stage of its own that runs
  after EPP and before cleanup (spec §13.7).

`absent` and the compiler-generated `nothing(...)` (spec §14.1) are different
artifacts and are kept apart. `absent` marks a value that does not exist here;
`nothing(...)` preserves computations whose result is discarded. EPP produces
both, finalization rewrites the first, and cleanup folds the second
(spec §13.9).

### 12.5 Literal Projection

```ts
14@alice
"Hello"@alice
true@every
```

EPP at `alice`:

```ts
14
"Hello"
true
```

EPP at `bob`:

```ts
absent
absent
true
```

### 12.6 Identifier Projection

For variable `x : T@L`, projection to endpoint `P` is:

```text
if residesAt(L, P):
    x
else:
    absent
```

### 12.7 Binary and Unary Operation Projection

#### Strict Operators

`+ - * / %`, `< <= > >=` and `=== !==` always evaluate both operands. Where the
result resides at `P`, the operator is preserved:

```ts
let a: integer@alice = 1@alice;
let b: integer@alice = 2@alice;
let c: integer@alice = a + b;
```

EPP at `alice`:

```ts
let a: integer = 1;
let b: integer = 2;
let c: integer = a + b;
```

Where it does not, the operator is not applied at all; the operands are still
evaluated, in order (spec §12.3):

```text
project_P(e1 op e2) = nothing(project_P(e1), project_P(e2))
project_P(op e)     = nothing(project_P(e))
```

EPP at `bob` — both operands are literals there, so the statement simplifies to
`null` and disappears (spec §13.9):

```ts
// removed
```

With a call in one of them, it does not:

```ts
let y: integer@alice = -relay(x);
```

EPP at `bob`:

```ts
nothing(relay(null));
```

#### Short-Circuit Operators

`&&` and `||` do **not** follow the rule above. `nothing(...)` evaluates every
argument, so

```text
e1 && e2  =>  nothing(project(e1), project(e2))
e1 || e2  =>  nothing(project(e1), project(e2))
```

would run a right operand the original short-circuited past. In Core v0 they
project to `absent` where the result is absent, which loses nothing because
§16.46 forbids choreography calls in either operand — the only work that would
have to survive.

### 12.8 Let Projection

```ts
let x = 1@alice;
```

After type inference, this is treated internally as:

```ts
let x: integer@alice = 1@alice;
```

EPP at `alice`:

```ts
let x: integer = 1;
```

Where the binding is absent at `P`, no binding is generated, but the
initializer is still evaluated — the store goes, the evaluation stays:

```text
project_P(let x = e;) = project_P(e);
```

EPP at `bob` — the initializer is a literal, so the statement simplifies to
`null` and disappears (spec §13.9):

```ts
// removed
```

With a call in the initializer it survives as an evaluation-only statement:

```ts
let x: integer@alice = choreographyCall();
```

EPP at `bob`:

```ts
choreographyCall();
```

### 12.9 Transfer Projection

#### The Source Is Evaluated at Every Endpoint

A transfer crosses a location boundary on purpose, so §12.3's reasoning about
subexpressions does not carry over to it: the source expression belongs to the
sender's location, but the computations inside it may not.

> A transfer's source expression is evaluated exactly once at **every** endpoint
> that evaluates the statement, and before that endpoint's own send, receive or
> copy.

The sender evaluates it as the payload. Every other endpoint evaluates it for
its computations alone, as an evaluation-only expression statement placed
*before* the receive, so that the calls inside it meet the sender's in the same
order.

```ts
function g(): integer@alice {
    let b: integer@bob = 7@bob;
    let c: integer@alice <- b;
    return c;
}

let y: integer@bob <- g();
```

EPP at `alice`:

```ts
sendInteger("bob", "top_0", g());
```

EPP at `bob`:

```ts
g();
let y: integer = receiveInteger("alice", "top_0");
```

Omitting `g()` at `bob` would leave `alice` blocked inside `g` forever. The same
holds at every receiver of a broadcast, and at endpoints the transfer skips
altogether.

Where the source holds no computation for an endpoint, the statement simplifies
to `null` and disappears (spec §13.9), which is why the ordinary cases below
show no extra statement.

Where the source value has to be used more than once at the sender — a
broadcast, which both sends and keeps its own copy — a compiler-generated
temporary holds it so that it is still evaluated exactly once (spec §7.8).

#### Direct Communication

```ts
let y: integer@bob <- x;
```

where `x : integer@alice`.

EPP at `alice`:

```ts
sendInteger("bob", "top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "top_0");
```

#### Broadcast

For individual-to-`@every` communication, EPP generates a broadcast at the sender and a receive at all other endpoints.

For array broadcast, the sender-side `@every` binding is a fresh mutable copy.

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@every <- xs;
```

EPP at `alice`:

```ts
let xs: integer[] = [1, 2];
broadcastIntegerArray("top_0", xs);
let ys: integer[] = cloneIntegerArray(xs);
```

EPP at `bob`:

```ts
let ys: integer[] = receiveIntegerArray("alice", "top_0");
```

#### Local Copy

When the destination already holds the source payload (spec §11.4), the transfer is projected as a local copy at each endpoint the destination resides at. No `send`, `receive`, `broadcast`, or communication tag is generated.

For scalar values, a local copy generates local initialization or assignment.

```ts
let x: integer@every = 1@every;
let y: integer@alice <- x;
```

EPP at `alice`:

```ts
let x: integer = 1;
let y: integer = x;
```

For array values, a local copy generates a fresh mutable array.

```ts
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <- xs;
```

EPP at `alice`:

```ts
let xs: float[] = [1.1, 2.2];
let ys: float[] = cloneFloatArray(xs);
```

#### Transfer Declaration Versus Transfer Assignment

The rules above are those of a transfer **declaration**, `let y: T@L <- e;`,
which introduces `y`. A transfer **assignment**, `y <- e;`, stores into a
variable that already exists, so every rule above holds except that the
destination side emits an assignment rather than a `let`. Nothing else differs:
the same tag is allocated, the same send, broadcast, receive and clone are
chosen, and the sender still binds its own copy after a broadcast.

```ts
let src: integer@alice = 1@alice;
let d: integer@bob = 0@bob;
d <- src;                      // direct
let e: integer@every = 0@every;
e <- src;                      // broadcast
let s: integer@alice = 0@alice;
s <- src;                      // local copy, alice to alice
let arr: float[]@alice = [1.1]@alice;
let a2: float[]@alice = [0.0]@alice;
a2 <- arr;                     // local copy, fresh array
```

EPP at `alice`:

```ts
let src: integer = 1;
sendInteger("bob", "top_0", src);
let e: integer = 0;
broadcastInteger("top_1", src);
e = src;
let s: integer = 0;
s = src;
let arr: float[] = [1.1];
let a2: float[] = [0.0];
a2 = cloneFloatArray(arr);
```

EPP at `bob`:

```ts
let d: integer = 0;
d = receiveInteger("alice", "top_0");
let e: integer = 0;
e = receiveInteger("alice", "top_1");
```

A receiver must not re-declare the destination — `let d: integer = receive...`
would shadow the variable the program meant to update. For an array, the
assignment replaces the destination's reference with the fresh clone, which is
what makes `<-` differ from `=` at one location (spec §7.8).

#### Single Evaluation at the Sender

A broadcast uses the source value twice at the sender, so when the source is not
already a simple reference EPP binds it to a temporary and uses that in both
places (spec §7.8). Temporaries are named with the reserved `__` prefix
(spec §6.2), so they cannot capture a program name.

```ts
function nextValue(): integer@alice {
    return 1@alice;
}

let n: integer@every <- nextValue();
```

EPP at `alice`:

```ts
let __transfer_0: integer = nextValue();
broadcastInteger("top_0", __transfer_0);
let n: integer = __transfer_0;
```

Without the temporary the sender would call `nextValue()` twice and could
broadcast one value while keeping another. A source that is already an
identifier or a literal is used directly, since re-reading it cannot call
anything.

### 12.10 Assignment Projection

```ts
x = y;
```

EPP to endpoint `P`:

* If `x` resides at `P`, generate the assignment.
* Otherwise, drop the store but keep the right-hand side's evaluation:

```text
project_P(x = e;) = project_P(e);
```

For an array element assignment `xs[i] = v;`, the assignment is generated only
where `xs` resides. Where it does not, the store goes and both remaining
expressions are kept, in the order §5.17 evaluates them — index first, then
value:

```text
project_P(xs[i] = v;) = nothing(project_P(i), project_P(v));
```

Dropping the index would be a communication bug, not just dead code: the index
is an ordinary expression and may hold a choreography call.

```ts
let xs: integer[]@alice = [0, 0]@alice;
xs[indexCall()] = valueCall();
```

EPP at `bob`, where both calls are choreography functions:

```ts
nothing(indexCall(), valueCall());
```

The compiler must not generate invalid code such as `null[null] = null`.

`xs.push(v)` follows the same shape: the append is performed where `xs` resides,
and elsewhere only the receiver's and the argument's evaluation is left behind
(spec §12.14.1).

### 12.11 Function Projection

#### Local Function

```ts
function add@alice(a: integer@alice, b: integer@alice) {
    return a + b;
}
```

After type inference, this is treated internally as:

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}
```

EPP at `alice`:

```ts
function add(a: integer, b: integer): integer {
    return a + b;
}
```

EPP at `bob`:

```ts
// not generated
```

A *call* to it at `bob` is not generated either, but its arguments still are:
they are ordinary expressions and may hold choreography calls (spec §12.3).

```text
project_P(f(e1, ..., en)) = nothing(project_P(e1), ..., project_P(en))
    where f is local at Q and P != Q
```

```ts
function add@mcu(a: integer@mcu, b: integer@mcu): integer@mcu {
    return a + b;
}

add(get3Mcu(), get4Mcu());
```

EPP at `server`, where `get3Mcu` and `get4Mcu` are choreography functions:

```ts
nothing(get3Mcu(), get4Mcu());
```

With no arguments there is nothing left to evaluate, and `nothing()` is removed
by cleanup (spec §13.9):

```ts
localFunction@mcu();
```

```text
nothing();  =>  null;  =>  removed
```

#### Choreography Function

```ts
function foo(a: integer@alice, b: integer@bob): integer@alice {
    return a;
}
```

EPP at `alice`:

```ts
function foo(a: integer, b: null): integer {
    return a;
}
```

EPP at `bob`:

```ts
function foo(a: null, b: integer): null {
    return null;
}
```

A choreography function is generated at every endpoint, so a call to it is kept
at every endpoint — including where its result is absent, since the body may
communicate (spec §12.3). A `void` call has no result to reside anywhere and is
likewise never removed for want of one.

### 12.12 If Projection

```ts
if (c) {
    ...
} else {
    ...
}
```

where `c : boolean@every` in an `@every` context.

EPP at each endpoint:

```ts
if (c) {
    ...
} else {
    ...
}
```

### 12.13 While Projection

```ts
while (c) {
    ...
}
```

EPP at each relevant endpoint:

```ts
while (c) {
    ...
}
```

### 12.14 For Projection

```ts
for (let i: integer@every = 0@every; i < 10@every; i = i + 1@every) {
    ...
}
```

EPP at each endpoint:

```ts
for (let i: integer = 0; i < 10; i = i + 1) {
    ...
}
```

#### Absent Header Clauses

A `let` in the header keeps its binding at every endpoint, as `null` where the
value is absent (spec §12.2), so the name stays declared.

An assignment clause has no such fallback: the variable it assigns to may not
exist at this endpoint at all, and a header slot holds an expression, not the
*statement* that §12.10 would produce. The clause therefore keeps just the
projection of the expressions it evaluated — the same `nothing(...)` §12.10
builds, sitting in the slot as an expression. Once that simplifies to `null`,
the slot is **omitted** entirely (spec §13.9). The compiler must not emit an
assignment to a name that is absent here, nor `null[null] = null` for an absent
array.

```ts
let c: boolean@every = true@every;
let i: integer@alice = 0@alice;
for (i = 0@alice; c; i = i + 1@alice) {
    ...
}
```

EPP at `alice`:

```ts
let c: boolean = true;
let i: integer = 0;
for (i = 0; c; i = i + 1) {
    ...
}
```

EPP at `bob`:

```ts
let c: boolean = true;
for (; c; ) {
}
```

If the clause's expressions still hold a call `bob` has to make (spec §12.3),
the slot keeps it instead of disappearing.

The condition slot is not optional and is never replaced by `null`: it needs a
boolean value, which the typing rules of §7.9 and §7.10 already guarantee is
available at every endpoint.

### 12.14.1 Array Projection

Array types, array literals, index expressions, element assignments, `xs.length`, and `xs.push(v)` are projected according to the location of the array value.

Example:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let x: integer@alice = xs[0@alice];
xs[1@alice] = 10@alice;
xs.push(20@alice);
let n: integer@alice = xs.length;
```

EPP at `alice`:

```ts
let xs: integer[] = [1, 2, 3];
let x: integer = xs[0];
xs[1] = 10;
xs.push(20);
let n: integer = xs.length;
```

EPP at `bob` — the array is absent there, so none of these operations is
performed. Each statement keeps only the evaluation of its subexpressions
(spec §12.3, §12.10), and since all of them are literals here, everything
simplifies to `null` and disappears (spec §13.9):

```ts
// all removed
```

Had any of those subexpressions held a choreography call, that call would have
remained. An operation's own runtime checks — an array bounds check, a division
by zero — belong to the operation and therefore run only at the endpoints that
keep it.

An array transfer sends the current contents of the array at the transfer statement and produces a fresh mutable array at the receiver.

Example:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@bob <- xs;
```

EPP at `alice`:

```ts
let xs: integer[] = [1, 2];
sendIntegerArray("bob", "top_0", xs);
```

EPP at `bob`:

```ts
let ys: integer[] = receiveIntegerArray("alice", "top_0");
```

Broadcast to `@every` uses a fresh copy at all endpoints, including the sender.

Example:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@every <- xs;
```

EPP at `alice`:

```ts
let xs: integer[] = [1, 2];
broadcastIntegerArray("top_0", xs);
let ys: integer[] = cloneIntegerArray(xs);
```

EPP at `bob`:

```ts
let ys: integer[] = receiveIntegerArray("alice", "top_0");
```

### 12.15 Top-Level Projection

Top-level non-function statements are projected as the entry program for each endpoint.

Input:

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
```

EPP at `alice`:

```ts
let x: integer = 10;
sendInteger("bob", "top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "top_0");
```

***

## 13. BlueScript Code Generation

### 13.1 Type Mapping

```text
ChoreoBS integer -> BlueScript integer
ChoreoBS float   -> BlueScript float
ChoreoBS boolean -> BlueScript boolean
ChoreoBS string  -> BlueScript string
ChoreoBS null    -> BlueScript null
ChoreoBS void    -> BlueScript void
ChoreoBS integer[] -> BlueScript integer[]
ChoreoBS float[]   -> BlueScript float[]
ChoreoBS boolean[] -> BlueScript boolean[]
```

### 13.2 Location Annotation Removal

BlueScript output does not contain location annotations.

```ts
let x: integer@alice = 1@alice;
```

EPP at `alice`:

```ts
let x: integer = 1;
```

### 13.2.1 Array Operation Code Generation

`xs.length` and `xs.push(v)` are emitted unchanged: BlueScript spells them the
same way ChoreoBS does, so code generation for these two is the identity.

```ts
xs.length
xs.push(v)
```

These two are the whole of ChoreoBS's dot syntax. A program cannot access a
field or call a method on anything else (spec §17.2).

### 13.3 Function Names

Generated function names are the same as the original ChoreoBS function names.
Because there is no renaming, the names the generated code relies on are
reserved in the source language (spec §6.2).

```ts
function add@alice(...)
```

EPP at `alice`:

```ts
function add(...)
```

### 13.4 Output File Naming

Input:

```text
index.cbs
```

`choreobs.json`:

```json
{
  "endpoints": ["alice", "bob"]
}
```

Output:

```text
index_alice.bs
index_bob.bs
```

### 13.5 Local Functions

A local function is emitted only for the corresponding endpoint.

### 13.6 Choreography Functions

A choreography function is emitted for all endpoints.

### 13.7 Absent Finalization

Absent finalization is a stage of its own, between endpoint projection and
cleanup:

```text
Typed AST
  -> Endpoint Projection
  -> Projected IR containing absent and nothing(...)
  -> Absent finalization
  -> Projected IR containing null and nothing(...)
  -> Bottom-up cleanup (spec §13.9)
  -> BlueScript emission
```

It does exactly one thing: every remaining `absent` leaf becomes `null`
(spec §12.4).

```text
absent => null
```

It does not fold `nothing(...)`, and it does not remove statements. Given

```text
nothing(absent, nothing(absent, absent))
```

it produces

```text
nothing(null, nothing(null, null))
```

and leaves the folding to cleanup.

Keeping the two apart is what lets each be stated as one rule. Cleanup's rule is
written over arguments that are *syntactically* `null`; an `absent` is not one,
so fusing the two stages would make that rule depend on an unstated ordering. An
`absent` that reaches cleanup or code generation is an internal error, not
something to paper over with a `null`.

After finalization the output contains no `absent`. The remaining `null;`
statements and `nothing(...)` artifacts are removed where possible by the
cleanup pass in Section 13.9.

### 13.8 Communication API

The generated BlueScript code uses type-specific communication APIs.

```ts
sendInteger(dst: string, tag: string, value: integer): void;
receiveInteger(src: string, tag: string): integer;

sendFloat(dst: string, tag: string, value: float): void;
receiveFloat(src: string, tag: string): float;

sendBoolean(dst: string, tag: string, value: boolean): void;
receiveBoolean(src: string, tag: string): boolean;

sendString(dst: string, tag: string, value: string): void;
receiveString(src: string, tag: string): string;

sendNull(dst: string, tag: string, value: null): void;
receiveNull(src: string, tag: string): null;

sendIntegerArray(dst: string, tag: string, value: integer[]): void;
receiveIntegerArray(src: string, tag: string): integer[];

sendFloatArray(dst: string, tag: string, value: float[]): void;
receiveFloatArray(src: string, tag: string): float[];

sendBooleanArray(dst: string, tag: string, value: boolean[]): void;
receiveBooleanArray(src: string, tag: string): boolean[];
```

There is one send/receive pair and one broadcast per transferable type, and the
compiler selects it from the transfer's base type. There is no default: a base
type with no entry here cannot be transferred, and the compiler must reject it
rather than fall back on another type's API. `null[]` is not a type (spec
§7.1.1), so there is no array form of the `null` API.

Broadcast APIs:

```ts
broadcastInteger(tag: string, value: integer): void;
broadcastFloat(tag: string, value: float): void;
broadcastBoolean(tag: string, value: boolean): void;
broadcastString(tag: string, value: string): void;
broadcastNull(tag: string, value: null): void;

broadcastIntegerArray(tag: string, value: integer[]): void;
broadcastFloatArray(tag: string, value: float[]): void;
broadcastBooleanArray(tag: string, value: boolean[]): void;
```

Array clone helper APIs used by generated code for:

* sender-side fresh copies in array broadcast;
* local copies produced by a transfer (spec §11.4).

APIs:

```ts
cloneIntegerArray(value: integer[]): integer[];
cloneFloatArray(value: float[]): float[];
cloneBooleanArray(value: boolean[]): boolean[];
```

### 13.9 Projected AST Cleanup

After absent finalization (spec §13.7) and before BlueScript code generation, the compiler performs a cleanup pass over the projected AST.

The purpose of this pass is to remove or simplify compiler-generated artifacts such as unnecessary `null` statements and `nothing(...)` expressions.

This cleanup pass must operate on the projected AST or projected IR. It must not be implemented as string-based post-processing over generated BlueScript code.

#### 13.9.1 A Single Bottom-Up Pass

Cleanup is one pass in post order: every subexpression is simplified before its
parent is considered, and statements are handled after their expressions.

```text
cleanupExpr(nothing(e1, ..., en)):
    e1' = cleanupExpr(e1)
    ...
    en' = cleanupExpr(en)

    if every ei' is syntactically null:
        return null
    else:
        return nothing(e1', ..., en')
```

Expression simplification is applied before statement cleanup. Every expression
slot is visited, including ones that are easy to overlook: the index of an
array element assignment target, and the initializer, condition and update of a
`for` header.

An `absent` reaching this pass is an internal error (spec §13.7).

#### 13.9.2 Expression Simplification

The only rule is:

```text
nothing(null, ..., null) => null
nothing()                => null
```

It applies only when, after recursively simplifying all arguments, every
argument of `nothing(...)` is exactly `null`. The zero-argument case is included:
it arises when a call to a local function with no parameters is projected to an
endpoint that does not generate that function (spec §12.11).

Examples:

```ts
nothing(null)
```

is simplified to:

```ts
null
```

```ts
nothing(null, null)
```

is simplified to:

```ts
null
```

Nested `nothing(...)` expressions are simplified recursively, innermost first.

```text
nothing(nothing(null), null)
=> nothing(null, null)
=> null
```

```ts
nothing(nothing(null), null, null)
=> nothing(null, null, null)
=> null
```

#### 13.9.3 Nested `nothing(...)` Is Not Flattened

Core v0 does not rewrite

```text
nothing(a, nothing(b, c))
```

into

```text
nothing(a, b, c)
```

The nesting mirrors the source expression's structure and evaluation
boundaries, which keeps EPP a plain structural recursion and leaves room for
runtime checks later. Flattening is listed under §17.6.

#### 13.9.4 Simplification Inside Function Arguments

Expression simplification must also be applied recursively inside ordinary function call arguments.

Example:

```ts
foo(nothing(null), null)
```

is simplified to:

```ts
foo(null, null)
```

The function call itself must not be removed by this cleanup rule.

#### 13.9.5 Statement Cleanup

After expression simplification, the compiler removes expression statements
whose expression is exactly `null`, and only those.

```ts
null;
```

is removed. Therefore:

```ts
nothing(nothing(null), null, null);
=> null;
=> removed
```

A `for` header slot that holds only a discarded expression is dropped once that
expression simplifies to `null` — the header equivalent of the same rule
(spec §12.14). A binding or a real assignment in the header stays.

None of these are removed, however much `null` they carry:

```ts
return null;
let x = null;
x = null;
f(null);
```

#### 13.9.6 What This Cleanup Pass Must Not Remove

This cleanup pass is intentionally conservative.

It must not remove ordinary function calls.

Example:

```ts
foo(null, null);
```

must remain as:

```ts
foo(null, null);
```

A call must be kept even when the type system says it returns `null`: the call
may communicate (spec §12.3). So these stay as they are:

```text
nothing(f(), null)
nothing(null, g())
nothing(nothing(f()), null)
```

It must not remove communication operations such as:

```ts
sendInteger("bob", "top_0", x);
receiveInteger("alice", "top_0");
broadcastBoolean("top_1", c);
```

It must not remove assignments, loops, conditionals, or function declarations merely because they contain `null` values.

Core v0 cleanup performs none of the following, and must not be extended with
them without revisiting §12.3:

* purity analysis;
* side-effect analysis;
* return-value equivalence analysis;
* general dead-code elimination;
* removal of ordinary function calls.

#### 13.9.7 Source-Level `null`

A `null` that came from a source-level `null` literal and a `null` produced by
absent finalization are the same node by the time cleanup runs, and are treated
alike. A statement that is exactly `null;` has no effect in either case, so
removing it is sound.

***

## 14. Runtime Support Functions

### 14.1 `nothing`

`nothing(e1, ..., en)` is a compiler-generated artifact, not a user-callable
function and not an ordinary call. It is the projected IR node that preserves
the evaluation of subexpressions whose result this endpoint has no use for
(spec §12.3).

Its semantics:

1. evaluate `e1` through `en`, left to right;
2. evaluate each argument exactly once;
3. discard each argument's value;
4. contribute no effect of its own;
5. yield `null`.

Equivalently:

```text
evaluate e1;
evaluate e2;
...
evaluate en;
return null;
```

`nothing()` with no arguments is allowed, and yields `null`.

The compiler must distinguish this artifact from an ordinary call, including
from a user-defined function that happens to be named `nothing`. In the
projected IR it is a node of its own; only that node is subject to the
simplification rule in §13.9.

The BlueScript backend may choose a concrete implementation depending on what
BlueScript supports. If rest parameters are unavailable, it may emit
fixed-arity helpers instead. Whatever it emits, the artifacts that can be
removed are removed first (spec §13.9).

### 14.2 Where It Appears

`nothing(...)` appears wherever §12.3 preserves the operands of an operation
this endpoint does not perform — in a statement, in a call argument, in a
`return` value, or in a `for` header slot.

It does *not* wrap a call that the endpoint does make: the projected callee
already returns `null` there, so the call stands on its own (spec §12.3).

## 15. Examples

### 15.1 Direct Communication

Input:

```ts
let x: integer@alice = 42@alice;
let y: integer@bob <- x;
```

EPP at `alice`:

```ts
let x: integer = 42;
sendInteger("bob", "top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "top_0");
```

***

### 15.2 Broadcast

Input:

```ts
let localOk: boolean@alice = true@alice;
let ok: boolean@every <- localOk;

if (ok) {
    let msg: string@bob = "ok"@bob;
} else {
    let msg: string@bob = "ng"@bob;
}
```

EPP at `alice` before cleanup:

```ts
let localOk: boolean = true;
broadcastBoolean("top_0", localOk);
let ok: boolean = localOk;

if (ok) {
    nothing(null);
} else {
    nothing(null);
}
```

EPP at `alice` after cleanup:

```ts
let localOk: boolean = true;
broadcastBoolean("top_0", localOk);
let ok: boolean = localOk;

if (ok) {
} else {
}
```

EPP at `bob`:

```ts
let ok: boolean = receiveBoolean("alice", "top_0");

if (ok) {
    let msg: string = "ok";
} else {
    let msg: string = "ng";
}
```

Note: ChoreoBS Core v0 cleanup does not remove empty `if` statements. Removing empty `if` statements is a future optimization.

***

### 15.3 Local Function

Input:

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}

let x: integer@alice = add(1@alice, 2@alice);
```

EPP at `alice`:

```ts
function add(a: integer, b: integer): integer {
    return a + b;
}

let x: integer = add(1, 2);
```

EPP at `bob`:

```ts
// removed
```

***

### 15.4 Choreography Function

Input:

```ts
function choose(c: boolean@every): integer@alice {
    if (c) {
        return 1@alice;
    } else {
        return 0@alice;
    }
}

let c: boolean@every = true@every;
let x: integer@alice = choose(c);
```

EPP at `alice`:

```ts
function choose(c: boolean): integer {
    if (c) {
        return 1;
    } else {
        return 0;
    }
}

let c: boolean = true;
let x: integer = choose(c);
```

EPP at `bob`:

```ts
function choose(c: boolean): null {
    if (c) {
        return null;
    } else {
        return null;
    }
}

let c: boolean = true;
choose(c);
```

Note the asymmetry with §15.3. There, `add` is a local function at `alice`, so
`bob` does not generate it and the whole statement goes. Here `choose` is a
choreography function, so `bob` generates it and must run it; only the result is
discarded (spec §12.3). Were the call dropped, any communication inside
`choose` would be performed by `alice` alone.

***

### 15.5 While with Transfer

Input:

```ts
let cont: boolean@every = true@every;

while (cont) {
    let x: integer@alice = 1@alice;
    let y: integer@bob <- x;

    let nextLocal: boolean@bob = false@bob;
    cont <- nextLocal;
}
```

EPP at `alice`:

```ts
let cont: boolean = true;

while (cont) {
    let x: integer = 1;
    sendInteger("bob", "top_0", x);

    cont = receiveBoolean("bob", "top_1");
}
```

EPP at `bob`:

```ts
let cont: boolean = true;

while (cont) {
    let y: integer = receiveInteger("alice", "top_0");

    let nextLocal: boolean = false;
    broadcastBoolean("top_1", nextLocal);
    cont = nextLocal;
}
```

***

### 15.6 For Loop

Input:

```ts
for (
    let i = 0@every;
    i < 3@every;
    i = i + 1@every
) {
    let x: integer@alice <- i;
    let y: integer@bob <- x;
}
```

EPP at `alice`:

```ts
for (let i: integer = 0; i < 3; i = i + 1) {
    let x: integer = i;
    sendInteger("bob", "top_0", x);
}
```

EPP at `bob`:

```ts
for (let i: integer = 0; i < 3; i = i + 1) {
    let y: integer = receiveInteger("alice", "top_0");
}
```

***

### 15.7 Cleanup of `nothing(...)`

Input after EPP:

```ts
nothing(null);
```

After expression simplification:

```ts
null;
```

After statement cleanup:

```ts
// removed
```

***

Input after EPP:

```ts
nothing(nothing(null), null, null);
```

After recursive expression simplification:

```ts
nothing(null, null, null);
```

Then:

```ts
null;
```

After statement cleanup:

```ts
// removed
```

***

Input after EPP:

```ts
foo(nothing(null), null);
```

After expression simplification:

```ts
foo(null, null);
```

The function call itself is preserved.

***

Input after EPP:

```ts
foo(null, null);
```

After cleanup:

```ts
foo(null, null);
```

Ordinary function calls are not removed by the v0 cleanup pass.

***

Input after EPP, at an endpoint that must still call `get3Mcu`:

```ts
nothing(get3Mcu(), null);
```

After cleanup:

```ts
nothing(get3Mcu(), null);
```

Unchanged — one argument is a call, so the rule of §13.9.2 does not apply, and
the nesting is not flattened either.

***

Input after EPP, from a call to a local function this endpoint does not
generate (spec §12.11):

```ts
nothing();
```

After cleanup:

```text
nothing();  =>  null;  =>  removed
```

### 15.8 Return Type Inference with Numeric LUB

Input:

```ts
function f@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    } else {
        return 2.5@alice;
    }
}
```

The inferred return type is `float@alice`.

***

### 15.9 Mutable Arrays

Input:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
xs[1@alice] = 10@alice;
xs.push(20@alice);
let n: integer@alice = xs.length;
let ys: integer[]@bob <- xs;
```

EPP at `alice`:

```ts
let xs: integer[] = [1, 2, 3];
xs[1] = 10;
xs.push(20);
let n: integer = xs.length;
sendIntegerArray("bob", "top_0", xs);
```

EPP at `bob`:

```ts
let ys: integer[] = receiveIntegerArray("alice", "top_0");
```

Input:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
xs[0@every] = 10@every;
```

EPP at all endpoints:

```ts
let xs: integer[] = [1, 2, 3];
xs[0] = 10;
```

## 16. Compile-time Errors

The following are compile-time errors.

### 16.1 Unknown Endpoint

```ts
let x: integer@carol = 1@carol;
```

This is an error if `carol` is not listed in `choreobs.json`.

### 16.2 Using `every` as an Endpoint

```json
{
  "endpoints": ["alice", "every"]
}
```

This is an error.

### 16.3 Location Annotation Omission

A type annotation or a literal without a location annotation is an error, unless
the location can be taken from an initializer (spec §7.14.1).

```ts
let x: integer = 1;          // the initializer has no location either
```

```ts
function f@alice(a: integer): integer@alice {   // no initializer to read
    return a;
}
```

### 16.4 Location Omission in a Local Function

A local function's own location does not supply a default. Parameter types,
return types, and literals must all be annotated explicitly (spec §8.1). An
initialized `let` is the one exception, since it can read the location from its
initializer (spec §7.14.1).

```ts
function add@alice(a: integer, b: integer): integer {
    return a + b;
}
```

Write it as:

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}
```

### 16.5 Uninitialized Let

```ts
let x: integer@alice;
```

### 16.6 Type Mismatch

```ts
let x: integer@alice = "hello"@alice;
```

### 16.7 Invalid Assignment Across Locations

```ts
let x: integer@alice = 1@alice;
let y: integer@bob = x;
```

Use a transfer instead:

```ts
let y: integer@bob <- x;
```

The same applies between `@every` and an individual location, which are
independent (§7.6):

```ts
let c: boolean@every = true@every;
let d: boolean@alice = c;
```

Use a transfer instead:

```ts
let d: boolean@alice <- c;
```

### 16.8 Invalid Transfer Base Type

For `a <- b` with `a : T1@p` and `b : T2@q`, the source base type must be a
subtype of the destination base type: `T2 <: T1` (spec §7.8).

Disallowed — `float` is not a subtype of `integer`:

```ts
let y: float@alice = 1.5@alice;
let x: integer@bob <- y;
```

Disallowed — unrelated base types:

```ts
let y: float@alice = 1.5@alice;
let x: string@bob <- y;
```

Disallowed — arrays are invariant, so the element types must match exactly:

```ts
let xs: integer[]@every = [1, 2]@every;
let ys: float[]@alice <- xs;
```

Note that the locations are unconstrained: a transfer whose source and
destination share a location is valid and denotes a local copy (spec §11.4).

### 16.9 Invalid If Condition

```ts
function f(c: boolean@alice): void {
    if (c) {
        return;
    }
}
```

### 16.10 Invalid While Condition

```ts
function f(c: boolean@alice): void {
    while (c) {
        return;
    }
}
```

### 16.11 Invalid For Condition

```ts
function f(): void {
    for (
        let i: integer@alice = 0@alice;
        i < 10@alice;
        i = i + 1@alice
    ) {
    }
}
```

### 16.12 Calling Another Endpoint's Local Function

```ts
function f@bob(): integer@bob {
    return 1@bob;
}

function g@alice(): integer@alice {
    return f();
}
```

### 16.13 Calling a Choreography Function from a Local Function

```ts
function f(): void {
    return;
}

function g@alice(): void {
    f();
}
```

### 16.14 Recursive Choreography Function

Direct recursion:

```ts
function f(): void {
    f();
}
```

Mutual recursion is equally invalid:

```ts
function f(): void {
    g();
}

function g(): void {
    f();
}
```

### 16.15 Function Overloading

```ts
function f@alice(): void {
    return;
}

function f@bob(): void {
    return;
}
```

### 16.16 Break and Continue

```ts
while (true@every) {
    break;
}
```

```ts
while (true@every) {
    continue;
}
```

### 16.17 Unsupported Equality Operators

```ts
x == y;
x != y;
```

Use:

```ts
x === y;
x !== y;
```

### 16.18 Transfer Let Without Type Annotation

```ts
let y <- x;
```

Transfer declarations require an explicit destination type.

### 16.19 Cannot Infer Function Return Type

A function return type cannot be inferred if value-returning paths are not proven to return.

```ts
function maybe@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    }
}
```

### 16.20 Mixed Bare and Value Returns

```ts
function bad@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    }
    return;
}
```

### 16.21 Incompatible Inferred Return Types

```ts
function bad@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    } else {
        return "one"@alice;
    }
}
```

### 16.22 Incompatible Inferred Return Locations

```ts
function bad(c: boolean@every) {
    if (c) {
        return 1@alice;
    } else {
        return 1@bob;
    }
}
```

### 16.23 Recursive Function With Omitted Return Type

```ts
function fact@alice(n: integer@alice) {
    if (n <= 1@alice) {
        return 1@alice;
    } else {
        return n * fact(n - 1@alice);
    }
}
```

### 16.24 Parameter Type Omission

```ts
function add@alice(a, b) {
    return a + b;
}
```

Parameter types are not inferred in Core v0.

***

### 16.25 Invalid Local Function Parameter Location

A local function parameter must be located at the function's own individual location.

Disallowed:

```cbs
function bad@bob(a: integer@alice, b: integer@bob): integer@bob {
    return a;
}
```

Disallowed:

```cbs
function bad@bob(x: integer@every): integer@bob {
    return x;
}
```

Allowed:

```cbs
function add@bob(a: integer@bob, b: integer@bob): integer@bob {
    return a + b;
}
```

### 16.26 Invalid Local Function Return Location

A local function return type must be located at the function's own individual location.

Disallowed:

```cbs
function bad@bob(): integer@alice {
    return 1@alice;
}
```

Disallowed:

```cbs
function bad@bob(): integer@every {
    return 1@every;
}
```

Allowed:

```cbs
function ok@bob(): integer@bob {
    return 1@bob;
}
```

### 16.27 Invalid Value Used Inside Local Function

Inside a local function declared at individual location `P`, every evaluated expression must be located at `P`.

Disallowed:

```cbs
function bad@bob(): integer@bob {
    let x: integer@alice = 1@alice;
    return x;
}
```

Disallowed:

```cbs
function bad@bob(): integer@bob {
    let x: integer@every = 1@every;
    return x;
}
```

The same applies to a variable the body declares, including the destination of a
transfer `let` (spec §8.2):

```cbs
function bad@bob(x: integer@bob): integer@bob {
    let y: integer@alice <- x;
    return x;
}
```

Allowed:

```cbs
function ok@bob(): integer@bob {
    let x: integer@bob = 1@bob;
    return x;
}
```

### 16.28 Invalid Function Argument Location

A function argument must be compatible with the corresponding parameter type
using base type subtyping, and must be located at the parameter's location
(spec §7.6).

Disallowed:

```cbs
function add@alice(a: integer@alice): integer@alice {
    return a;
}

add(10@every);
```

This is invalid because `match(every, alice) = false`. `every` and `alice` are
independent locations. Pass a value already at `alice`:

```cbs
add(10@alice);
```

Disallowed:

```cbs
function add@alice(a: integer@alice): integer@alice {
    return a;
}

add(10@bob);
```

This is invalid because `match(bob, alice) = false`.

Disallowed:

```cbs
function bad@alice(x: integer@every): integer@alice {
    return x;
}
```

This remains invalid because local function parameters must not be located at `every`.

### 16.29 Unsupported Array Element Type

`string[]`, `null[]`, and `void[]` are not supported in the mutable array
extension. They parse — the grammar admits an array of any base type
(spec §5.2) — and are rejected as a typing error (spec §7.1.1).

Disallowed:

```ts
let xs: string[]@alice = []@alice;
let ys: null[]@alice = []@alice;
let zs: void[]@alice = []@alice;
```

### 16.30 Nested Array

Nested arrays are not supported. Unlike §16.29, this one is ruled out by the
grammar: `ArrayType` takes a single `[` `]` (spec §5.2), so it is reported as a
syntax error.

Disallowed:

```ts
let xs: integer[][]@alice = []@alice;
```

### 16.31 Array Literal Without Required Location

An array literal must carry its own location annotation (spec §5.16). The error
is the missing annotation on the literal itself, whether or not its elements
carry one.

Disallowed:

```ts
let xs: integer[]@alice = [1, 2, 3];
```

Disallowed for the same reason, although every element is located:

```ts
let a: integer@alice = 1@alice;
let b: integer@alice = 2@alice;
let xs = [a, b];
```

Use:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys = [a, b]@alice;
```

### 16.32 Cannot Infer Empty Array Element Type

An empty array literal cannot infer its element type.

Disallowed:

```ts
let xs = []@alice;
```

Allowed:

```ts
let xs: integer[]@alice = []@alice;
```

### 16.33 Array Type Invariance

Array types are invariant.

Disallowed:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: float[]@alice = xs;
```

### 16.34 Invalid `@every` Array Assignment to Individual Location

A mutable array located at `@every` cannot be assigned to an individual-location
array variable. This is an instance of the general location rule (§7.6, §16.7),
not an array-specific restriction; use `<-` to localize.

Disallowed:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice = xs;
```

### 16.35 Invalid `@every` Array Argument to Individual Location Parameter

A mutable array located at `@every` cannot be passed to a function parameter
located at an individual location. This is an instance of the general location
rule (§7.6, §16.28), not an array-specific restriction; localize with `<-` first.

Disallowed:

```ts
function f@alice(xs: integer[]@alice): void {
    return;
}
let xs: integer[]@every = [1, 2, 3]@every;
f(xs);
```

### 16.36 Invalid Array Equality

The equality operators `===` and `!==` are not defined for array types.

Disallowed:

```ts
let xs: integer[]@alice = [1]@alice;
xs === xs;
```

### 16.37 Invalid Array Index Location

The index expression must be located at the array location.

Disallowed:

```ts
let xs: integer[]@alice = [1]@alice;
let i: integer@bob = 0@bob;
let x: integer@alice = xs[i];
```

### 16.38 Invalid `.push` Element Type

The pushed value must be compatible with the array element type.

Disallowed:

```ts
let xs: integer[]@alice = []@alice;
xs.push(1.5@alice);
```

### 16.39 `@every` on a Function Declaration

A location on a function declaration names the one endpoint that runs the
function. It therefore declares a local function, and must be an individual
location (spec §10.1).

A choreography function runs at every endpoint rather than at one, so no single
location names it and its declaration carries none. It is a separate kind of
declaration, not a local function with its location left out.

Disallowed:

```ts
function f@every(): void {
    return;
}
```

Write it as:

```ts
function f(): void {
    return;
}
```

### 16.40 Invalid Use of `void`

`void` has no location and is not a value type (spec §7.3).

A location on `void` is an error:

```ts
function g(): void@alice {
    return;
}
```

So is any use outside a function return type:

```ts
function g(): void { return; }

let x: void = g();          // variable type
let y = g();                // same error: inference does not create a way in
let zs = [g()]@alice;       // array literal element
```

```ts
function f(a: void): void { return; }   // parameter type
```

```ts
function g(): void { return; }

let y: void <- g();         // transfer destination
```

`xs.push(v)` is the other void computation (spec §7.2, §7.11.1), and is
rejected in the same positions for the same reason:

```ts
let xs: integer[]@alice = []@alice;

xs.push(1@alice);                        // valid — an expression statement
let n = xs.push(1@alice);                // produces no value
let m: integer@alice = xs.push(1@alice); // cannot assign void
f(xs.push(1@alice));                     // not assignable to the parameter
```

`void[]` is rejected separately, as an unsupported array element type
(spec §16.29).

### 16.41 Missing Return in a Non-`void` Function

A function whose return type is not `void` must return a value on every path
(spec §7.13, §7.14.6). This applies to a written return type just as it does to
an inferred one (spec §16.19).

```ts
function bad@alice(c: boolean@alice): integer@alice {
    if (c) {
        return 1@alice;
    }
}
```

Write it as:

```ts
function ok@alice(c: boolean@alice): integer@alice {
    if (c) {
        return 1@alice;
    } else {
        return 0@alice;
    }
}
```

The analysis is the conservative one of §7.14.6, so a function whose totality
rests on a loop condition is rejected even when it does always return:

```ts
function alsoRejected@alice(): integer@alice {
    while (true@alice) {
        return 1@alice;
    }
}
```

### 16.42 Invalid Unary Operand

`-` requires a numeric scalar and `!` requires a boolean scalar (spec §7.11).
Neither accepts an array.

```ts
let xs: boolean[]@alice = [true]@alice;
let b: boolean@alice = !xs;
```

```ts
let ys: integer[]@alice = [1]@alice;
let n: integer[]@alice = -ys;
```

```ts
let s: string@alice = "x"@alice;
let t: string@alice = -s;
```

### 16.43 Invalid Comparison or Equality Operands

`<`, `<=`, `>` and `>=` require numeric operands (spec §7.11):

```ts
let b: boolean@alice = "a"@alice < "b"@alice;
```

`===` and `!==` require operands of the same base type. They do not widen
`integer` to `float` the way the arithmetic operators do:

```ts
let b: boolean@alice = 1@alice === 1.0@alice;
```

They also require operands that produce a value, so a void computation
(spec §7.2) is rejected on either side. Two of them have the same base type,
which is why this needs a rule of its own:

```ts
function g@alice(): void { return; }
let xs: integer[]@alice = [1]@alice;

let b: boolean@alice = g() === g();
let c: boolean@alice = xs.push(1@alice) === xs.push(2@alice);
```

For array operands see §16.36.

### 16.44 Invalid Array Operation Syntax

These are **parse** errors, reported before type checking.

The receiver of `.length` and `.push` must be a variable (spec §5.14), so a
receiver of any other shape is rejected:

```ts
xs[0@alice].push(1@alice);
(xs).push(1@alice);
let n: integer@alice = f().length;
let m: integer@alice = xs.length.length;
```

`length` and `push` are the only member names:

```ts
let n: integer@alice = xs.pop;
```

Write the operation with a variable receiver:

```ts
xs.push(1@alice);
let n: integer@alice = xs.length;
```

Using `xs.push(v)` where a value is expected is not a syntax error but a type
error, because its result is `void` (spec §7.11.1, §16.40).

### 16.45 Missing `for` Condition

The condition of a `for` loop is required (spec §5.11).

```ts
for (let i = 0@every; ; i = i + 1@every) {
}
```

Use `while (true@every)` for an unbounded loop.

### 16.46 Choreography Call in a Short-Circuit Operand

Neither operand of `&&` or `||` may contain a call to a choreography function,
directly or inside a nested expression.

A choreography function runs at every endpoint (spec §12.11), but `&&` and `||`
evaluate their right operand only conditionally (spec §5.17), and that decision
is made from a value that lives at one location. An endpoint where the result is
absent cannot tell which way it went, so it cannot know whether to make the
call — and projecting the operands unconditionally would make it call every
time (spec §12.7).

Disallowed:

```cbs
function ping(): boolean@alice {
    let b: integer@bob = 1@bob;
    let c: integer@alice <- b;
    return true@alice;
}

let c: boolean@alice = false@alice;
let d: boolean@alice = c && ping();
```

Allowed — a local function cannot call a choreography function (spec §16.13),
so it cannot communicate:

```cbs
function yes@alice(): boolean@alice {
    return true@alice;
}

let c: boolean@alice = false@alice;
let d: boolean@alice = c && yes();
```

The restriction is deliberately blunt in Core v0: it also rejects cases that
would be safe, such as an operation at `@every`, where every endpoint holds the
condition and would short-circuit identically. See §17.6.

***

## 17. Non-goals and Future Extensions

The following features are not part of ChoreoBS Core v0.

### 17.1 Gradual Features

* location inference;
* omitted locations on types and literals — omission is an error everywhere in v0, in local functions and choreography contexts alike (spec §8.1);
* use of `@every` values inside local functions;
* local function parameters or return types located at `every`;
* `any`;
* `undefined`;
* runtime location checks;
* gradual choreographic typing.

### 17.2 TypeScript / JavaScript Features

* `const`;
* object literals;
* arrays beyond the mutable one-dimensional `integer[]` / `float[]` / `boolean[]` support defined in this specification;
* property access as lvalue — `xs[i] = v` is the only assignable form, and `.length` is read-only;
* property access and method calls in general: `.length` and `.push` are a closed set of array operations (spec §5.14), not a facility for user types;
* classes;
* interfaces;
* generics;
* anonymous functions;
* arrow functions;
* closures;
* higher-order functions;
* modules;
* `import`;
* `export`;
* `async`;
* `await`.

### 17.3 Control Flow

* `break`;
* `continue`;
* `switch`;
* `try`;
* `catch`;
* `throw`;
* `for-of`;
* `for-in`.

### 17.4 Communication Features

* asynchronous communication syntax;
* timeout;
* failure handling;
* retries;
* explicit channels;
* session types;
* label selection;
* non-blocking receive.

### 17.5 Data Structures

* string arrays;
* null arrays;
* void arrays;
* nested arrays;
* records;
* structs;
* tuples;
* maps.

### 17.6 Future Work

Future versions may add:

* Gradual Choreographic Programming;
* location inference;
* optional dynamic checks;
* richer communication protocols;
* additional array operations and local object support;
* state-machine based EPP;
* non-blocking runtime support;
* selection-based conditionals;
* endpoint protocol verification;
* a projection that allows choreography computation inside a short-circuit
  operand (spec §16.46), by sharing the short-circuit condition across the
  endpoints that need it, or by a projected IR form that preserves
  short-circuit evaluation.

### 17.7 Future Cleanup Optimizations

ChoreoBS Core v0 only performs a minimal cleanup pass for compiler-generated `nothing(...)` and `null;` artifacts.

The following optimizations are not required in v0:

* general dead-code elimination;
* unused variable elimination;
* unused function elimination;
* constant folding;
* removal of empty `if` statements;
* removal of empty blocks;
* removal of empty loops;
* side-effect analysis for ordinary function calls;
* effect analysis that would let cleanup drop a call it can prove inert;
* flattening nested `nothing(...)` (spec §13.9.3).
