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

This program infers `x` as `integer@alice`, sends the value `x` located at `alice` to `bob`, and stores it in `y`.

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

Reserved words cannot be used as ordinary identifiers.

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
unit
```

The following words may also be treated as reserved in v0:

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

These features are not supported in v0.

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

#### Maximal Munch and `<-`

Tokens are formed by maximal munch over the raw character stream, so the
character immediately following `<` decides the token. `a<-b` is therefore a
a transfer, not a comparison against `-b`. Write a space to compare against a
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

Top-level statements are executed in an implicit `@every` context.

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
           | "unit"
```

```ebnf
ArrayType ::= ArrayElementType "[" "]"
```

```ebnf
ArrayElementType ::= "integer"
                   | "float"
                   | "boolean"
```

```ebnf
LocationAnnotation ::= "@" Location
```

```ebnf
Location ::= Identifier | "every"
```

Arrays are mutable reference values. ChoreoBS Core v0 with the mutable array extension supports only one-dimensional arrays whose element type is `integer`, `float`, or `boolean`.

The following array types are not supported:

```text
string[]
null[]
unit[]
integer[][]
float[][]
boolean[][]
```

### 5.3 Function Declaration

```ebnf
FunctionDeclaration ::=
  "function" Identifier "@" Location "(" ParameterList? ")" FunctionReturnType? Block
```

```ebnf
FunctionReturnType ::= ":" Type
```

The return type annotation may be omitted. When omitted, the return type is inferred according to Section 7.14.

```ebnf
ParameterList ::= Parameter ("," Parameter)*
```

```ebnf
Parameter ::= Identifier ":" Type
```

Examples:

```ts
function add@alice(a: integer, b: integer): integer {
    return a + b;
}
```

```ts
function addInferred@alice(a: integer, b: integer) {
    return a + b;
}
```

```ts
function main@every(x: integer@alice): unit@every {
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
  "for" "(" ForInit? ";" Expression? ";" ForUpdate? ")" Block
```

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
  Identifier "=" Expression
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

`return;` is allowed only when the function return type is `unit@L`, or when an omitted function return type is inferred as `unit@L`.

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
                    | Identifier
                    | FunctionCall
                    | "(" Expression ")"
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

If an array literal has an explicit location annotation `@L`, unlocated literal elements inside the array literal are elaborated as located at `L`.

Example:

```ts
[1, 2, 3]@alice
```

is elaborated as:

```ts
[1@alice, 2@alice, 3@alice]@alice
```

In top-level and `@every` contexts, an array literal without an explicit location annotation must not contain unlocated literal elements. The expected type of a `let` declaration, assignment, function argument, or return does not provide a location for unlocated array literal elements.

Allowed at top level:

```ts
let arr: integer[]@alice = [1, 2, 3]@alice;
```

Disallowed at top level:

```ts
let arr: integer[]@alice = [1, 3, 5];
```

Inside a local function declared at individual location `P`, omitted locations in array literals are elaborated to `@P`, following the ordinary local function location omission rule.

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
function alice@alice(): unit {
    return;
}
```

However, the same variable name must not be defined more than once in the same scope.

### 6.2 Function Names

* Function overloading is not supported in v0.
* The same function name must not be defined more than once.
* Functions with the same name but different locations are also disallowed.
* `length` and `push` are compiler-known builtin function names and cannot be used as user-defined function names.

Disallowed:

```ts
function f@alice(): unit {
    return;
}

function f@bob(): unit {
    return;
}
```

### 6.3 Function Declaration Hoisting

Function declarations are visible throughout the whole file.

```ts
let x: integer@alice = f();

function f@alice(): integer {
    return 1;
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

### 6.5 Top-Level Statements

Non-function top-level statements are treated as the body of an implicit `@every` context.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
```

Conceptually, this is similar to:

```ts
function __top@every(): unit@every {
    let x: integer@alice = 1@alice;
    let y: integer@bob <- x;
}
```

The implementation does not need to generate an actual function named `__top`.

### 6.6 Top-Level Let

Top-level `let` declarations are local variables of the implicit top-level context.

Therefore, top-level `let` variables are not visible from functions.

Disallowed:

```ts
let x: integer@alice = 1@alice;

function f@alice(): integer {
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
unit
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
unit[]
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

Every value has a located type.

```text
T@L
```

Examples:

```text
integer@alice
float@bob
boolean@every
string@sensor
```

### 7.3 Unit

`unit` is used as the return type of functions that do not return a value.

During BlueScript code generation, `unit` is converted to `void`.

```ts
function f@alice(): unit {
    return;
}
```

After EPP:

```ts
function f(): void {
    return;
}
```

### 7.4 Null

`null` is a singleton type.

```text
null is the only value of type null.
null is not a subtype of integer, float, boolean, string, or unit.
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
specific to local function declarations are stated in §8.1.1.

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

#### `@every` Context

In an `@every` function or top-level context, the condition must be `boolean@every`.

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
function f@alice(c: boolean): unit {
    if (c) {
        return;
    }
}
```

Disallowed:

```cbs
function f@alice(c: boolean@every): unit {
    if (c) {
        return;
    }
}
```

### 7.10 While and For Condition Typing

The termination conditions of `while` and `for` follow the same rule as `if`.

* In an `@every` context, the condition must be `boolean@every`.
* In a local `@p` context, the condition must be `boolean@p`. `boolean@every` is not allowed inside local functions.

### 7.11 Binary Operators

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

These operators are available for numeric values.

The result is a `boolean` at the same location.

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

These operators are available for values of the same base type.

The inferred result type is `boolean` at the operand location.

`==` and `!=` are not allowed.

Array types are not base types. The equality operators `===` and `!==` are not defined for array types.

#### Logical Operators

```text
&&
||
!
```

These operators are available for `boolean`.

The inferred result type is `boolean` at the operand location.

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

An empty array literal cannot infer its element type. It is allowed only when checked against an explicit array type and when the array literal has an explicit location annotation, except inside local functions where location omission is allowed.

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

#### `length` Builtin

`length(xs)` is a compiler-known builtin operation.

```text
xs : T[]@L
```

then:

```text
length(xs) : integer@L
```

In this rule, `T` must be `integer`, `float`, or `boolean`.

During BlueScript code generation, `length(xs)` is emitted as `xs.length`.

#### `push` Builtin

`push(xs, v)` is a compiler-known statement-like builtin operation. It may appear only as an expression statement.

```text
xs : T[]@L
v  : S@M
S <: T
match(M, L)
```

then:

```text
push(xs, v) : unit@L
```

In this rule, `T` must be `integer`, `float`, or `boolean`.

During BlueScript code generation, `push(xs, v)` is emitted as `xs.push(v)`.

#### `@every` Array Restrictions

Mutable arrays located at `@every` must not be implicitly converted to individual-location arrays.

Disallowed:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice = xs;
```

Similarly, a value of type `T[]@every` must not be passed to a function parameter of type `T[]@P` where `P` is an individual location. This restriction applies to all functions, not only local functions.

Disallowed:

```ts
function f@alice(xs: integer[]): unit {
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
function add@alice(a: integer): integer {
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
separate reason, stated in §8.1.1.

#### In an `@every` Context

The following function calls are allowed:

* calls to `@every` functions;
* calls to local functions.

#### In a Local Context

Inside `function@alice`, only `@alice` local functions may be called.

The following are disallowed:

* calls to local functions at other endpoints;
* calls to `@every` functions.

### 7.13 Return Typing

When a function has an explicit return type:

```ts
return expr;
```

is allowed if the type of `expr` is compatible with the function return type.

```ts
return;
```

is allowed only if the function return type is `unit@L`.

When a function omits its return type, the return type is inferred according to Section 7.14.

### 7.14 Type Inference

ChoreoBS Core v0 supports simple, local type inference. This feature does not perform general location inference. It only uses types and locations already determined by literals, identifiers, function signatures, local context elaboration, and expression typing.

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

A `let` declaration with an explicit type annotation is still checked using the normal assignment typing rule.

```ts
let x: float@alice = 1@alice;
```

This is valid because `integer <: float`.

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

The type annotation is required. The following remains invalid:

```ts
let y <- x;
```

#### 7.14.4 Function Return Type Inference

A function declaration may omit its return type:

```ts
function f@L(params) {
    body
}
```

The compiler infers the function return type from `return` statements in the body.

If all returns are bare `return;`, or if there are no return statements, the inferred return type is:

```text
unit@L
```

where `L` is the function location.

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
function f@alice(c: boolean) {
    if (c) {
        return 1;
    } else {
        return 2.5;
    }
}
```

The return type is inferred as `float@alice`.

#### 7.14.5 Mixing `return;` and `return expr;`

A function with an omitted return type must not mix bare `return;` and value-returning `return expr;`.

#### 7.14.6 Return Coverage for Inferred Non-Unit Functions

If a function with an omitted return type contains any `return expr;`, then all execution paths must return a value.

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
function add@alice(a: integer, b: integer) {
    return a + b;
}
```

#### 7.14.8 Inference and Recursion

Local function recursion is allowed, but recursive local functions must have explicit return types in Core v0.

Therefore:

- direct or indirect recursive local functions with omitted return types are compile-time errors;
- direct or indirect recursive local functions with explicit return types are allowed;
- `@every` recursion remains unsupported.

***

## 8. Location Elaboration Rules

### 8.1 Local Function Context

Inside a local function, location annotations on types and literals may be omitted.

```ts
function add@alice(a: integer, b: integer): integer {
    return a + b + 1;
}
```

This is equivalent to:

```ts
function add@alice(
    a: integer@alice,
    b: integer@alice
): integer@alice {
    return a + b + 1@alice;
}
```

This rule also applies when the function return type is omitted and inferred.

```ts
function add@alice(a: integer, b: integer) {
    let c = a + b + 1;
    return c;
}
```

This is elaborated to:

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    let c: integer@alice = a + b + 1@alice;
    return c;
}
```

### 8.1.1 Local Function Strict Location Rule

For a local function declared at an individual location `P`:

```cbs
function f@P(...) {
    ...
}
```

all parameters, return values, and expressions evaluated in the function body must be located at `P`.

Rules:

- Every parameter type must be located at `P` after location elaboration.
- If a parameter type omits its location, it is elaborated to `@P`.
- A parameter type explicitly located at another individual location `Q`, where `Q != P`, is a compile-time error.
- A parameter type explicitly located at `every` is a compile-time error.
- The explicit or inferred return type of a local function must be located at `P`, except that `unit` with an omitted location is elaborated to `unit@P`.
- A return type explicitly or implicitly located at another individual location `Q`, where `Q != P`, is a compile-time error.
- A return type explicitly or implicitly located at `every` is a compile-time error.
- Every expression evaluated inside the local function body must have a type located at `P`.
- Values located at `every` are not allowed inside local function bodies.
- Values located at another individual location are not allowed inside local function bodies.
- Transfers are not allowed inside local functions.

Allowed:

```cbs
function add@bob(a: integer, b: integer): integer {
    return a + b;
}
```

This is elaborated to:

```cbs
function add@bob(a: integer@bob, b: integer@bob): integer@bob {
    return a + b;
}
```

Also allowed:

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

This rule is intentionally stricter than ordinary location availability. In particular, `T@every` is not permitted in local function parameters, local function return types, or local function bodies.

### 8.2 `@every` Function Context

Inside an `@every` function, location omission is not allowed.

Disallowed:

```ts
function f@every(): unit@every {
    let x: integer = 1;
}
```

Allowed:

```ts
function f@every(): unit@every {
    let x: integer@alice = 1@alice;
}
```

### 8.3 Top-Level Context

Top-level non-function statements are treated as an `@every` context.

Therefore, location omission is not allowed at top level.

Disallowed:

```ts
let x = 1;
let y: integer = 1;
```

Allowed:

```ts
let x = 1@alice;
let y: integer@alice = 1@alice;
```

Here `x` omits its type annotation, but the literal location is explicit, so `x` is inferred as `integer@alice`.

### 8.4 `@every` Literals

`@every` literals are allowed in choreographic contexts.

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

Required:

```ts
let x: integer@alice = 1@alice;
x = x + 1@alice;
return x;
```

Not required after compound constructs:

```ts
function f@alice(): unit {
    return;
}

if (c) {
    return;
}

while (c) {
    return;
}

for (let i: integer = 0; i < 10; i = i + 1) {
    return;
}
```

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

Expression statements are allowed.

After EPP, expressions unrelated to the current endpoint may be transformed into `nothing(...)` or `null`.

These compiler-generated artifacts are cleaned up by the Projected AST Cleanup pass defined in Section 13.9.

The builtin `push(xs, v)` may appear only as an expression statement. It must not be used as a subexpression or initializer.

***

## 10. Function Rules

### 10.1 Function Kinds

ChoreoBS has two kinds of functions.

#### Choreographic Function

```ts
function f@every(...): T@L {
    ...
}
```

or, with inferred return type:

```ts
function f@every(...) {
    ...
}
```

- Describes choreography.
- May contain transfers.
- Is projected to all endpoints.
- Does not allow location omission.
- Allows return type inference.
- Recursion is not supported in v0.

#### Local Function

```ts
function f@alice(...): T {
    ...
}
```

or, with inferred return type:

```ts
function f@alice(...) {
    ...
}
```

- Runs on a single endpoint.
- Must not contain transfers.
- Is generated only for the corresponding endpoint.
- Allows location omission.
- Allows return type inference.
- Recursion is allowed only when the recursive function has an explicit return type.

### 10.2 Calling Local Functions from an `@every` Context

An `@every` context may call local functions.

```ts
function add@alice(a: integer, b: integer): integer {
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

EPP at `bob` before cleanup:

```ts
nothing(null, null);
```

EPP at `bob` after cleanup:

```ts
// removed
```

An argument must already be located at the parameter's location. A value at
`@every` — a mutable array or otherwise — must be localized with `<-` first.

```ts
function average@alice(arr: float[]): float {
    return 0.0;
}

let arr: float[]@every = [1.1, 2.2]@every;
let arrAlice: float[]@alice <- arr;
let avg: float@alice = average(arrAlice);
```

### 10.3 Calling Functions from a Local Context

Inside `function@alice`, only `@alice` local functions may be called.

Allowed:

```ts
function f@alice(): integer {
    return 1;
}

function g@alice(): integer {
    return f();
}
```

Disallowed:

```ts
function f@bob(): integer {
    return 1;
}

function g@alice(): integer {
    return f();
}
```

Disallowed:

```ts
function h@every(): unit@every {
    return;
}

function g@alice(): unit {
    h();
}
```

### 10.4 Recursion

* Local function recursion is allowed.
* `@every` function recursion is not supported in v0.
* ChoreoBS v0 does not guarantee termination of local recursion.

Allowed:

```ts
function fact@alice(n: integer): integer {
    if (n <= 1) {
        return 1;
    } else {
        return n * fact(n - 1);
    }
}
```

Disallowed:

```ts
function fact@alice(n: integer) {
    if (n <= 1) {
        return 1;
    } else {
        return n * fact(n - 1);
    }
}
```

Disallowed:

```ts
function loop@every(n: integer@every): unit@every {
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

* They are unique within the same function.
* They should be stable within the same compilation unit.
* Implementations may choose any string format.

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

Projection of type `T@L` to endpoint `P` is:

```text
if residesAt(L, P):
    T
else:
    absent
```

`unit` is mapped to `void` in BlueScript.

Examples:

```text
integer@alice projected to alice -> integer
integer@alice projected to bob   -> absent
integer@every projected to bob   -> integer
unit@alice projected to alice    -> void
```

### 12.3 Expression Projection

Projection of expression `e : T@L` to endpoint `P` is:

```text
if residesAt(L, P):
    preserve expression
else:
    absent
```

### 12.4 Absent

`absent` is an internal intermediate representation used only during EPP.

* It does not exist in the source language.
* It is distinct from source-level `null`.
* It is never emitted directly to final BlueScript output.
* It is finalized into either `null` or a compiler-generated `nothing(...)` expression before or during the cleanup/code generation pipeline.

The compiler may temporarily generate `null` and `nothing(...)` expressions to preserve AST shape after EPP. These artifacts are subject to the cleanup rules defined in Section 13.9.

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

### 12.7 Binary Operation Projection

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

EPP at `bob` before cleanup:

```ts
nothing(null, null);
```

EPP at `bob` after cleanup:

```ts
// removed
```

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

EPP at `bob` before cleanup:

```ts
nothing(null);
```

EPP at `bob` after cleanup:

```ts
// removed
```

### 12.9 Transfer Projection

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

### 12.10 Assignment Projection

```ts
x = y;
```

EPP to endpoint `P`:

* If `x` resides at `P`, generate the assignment.
* Otherwise, generate `nothing(...)` or `null`, which may be removed by the cleanup pass.

For array element assignment `xs[i] = v;`, projection is generated only at endpoints where `xs` resides. If `xs` does not reside at endpoint `P`, the entire statement is projected to an absent/nothing artifact. The compiler must not generate invalid code such as `null[null] = null`.

### 12.11 Function Projection

#### Local Function

```ts
function add@alice(a: integer, b: integer) {
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

#### `@every` Function

```ts
function foo@every(a: integer@alice, b: integer@bob): integer@alice {
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

### 12.14.1 Array Projection

Array types, array literals, index expressions, element assignments, `length(xs)`, and `push(xs, v)` are projected according to the location of the array value.

Example:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let x: integer@alice = xs[0@alice];
xs[1@alice] = 10@alice;
push(xs, 20@alice);
let n: integer@alice = length(xs);
```

EPP at `alice`:

```ts
let xs: integer[] = [1, 2, 3];
let x: integer = xs[0];
xs[1] = 10;
xs.push(20);
let n: integer = xs.length;
```

EPP at `bob` before cleanup:

```ts
nothing(null);
nothing(null, null);
nothing(null, null, null);
nothing(null, null);
nothing(null);
```

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
ChoreoBS unit    -> BlueScript void
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

### 13.2.1 Array Builtin Code Generation

The ChoreoBS builtin expression `length(xs)` is emitted as BlueScript property access:

```ts
xs.length
```

The ChoreoBS builtin statement `push(xs, v);` is emitted as BlueScript method call:

```ts
xs.push(v);
```

ChoreoBS does not otherwise expose property access or method calls in source programs.

### 13.3 Function Names

Generated function names are the same as the original ChoreoBS function names.

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

endpoints:

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

### 13.6 `@every` Functions

An `@every` function is emitted for all endpoints.

### 13.7 Absent Finalization

After EPP, remaining `absent` values must be finalized before final BlueScript output.

An `absent` value may be finalized into one of the following compiler-generated artifacts:

* `null`
* `nothing(...)`

These artifacts are used only to keep the projected AST syntactically valid.

The final BlueScript output should not contain unnecessary `null;` statements or unnecessary `nothing(...)` calls when they can be removed by the cleanup pass defined in Section 13.9.

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

sendIntegerArray(dst: string, tag: string, value: integer[]): void;
receiveIntegerArray(src: string, tag: string): integer[];

sendFloatArray(dst: string, tag: string, value: float[]): void;
receiveFloatArray(src: string, tag: string): float[];

sendBooleanArray(dst: string, tag: string, value: boolean[]): void;
receiveBooleanArray(src: string, tag: string): boolean[];
```

Broadcast APIs:

```ts
broadcastInteger(tag: string, value: integer): void;
broadcastFloat(tag: string, value: float): void;
broadcastBoolean(tag: string, value: boolean): void;
broadcastString(tag: string, value: string): void;

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

After Endpoint Projection and before BlueScript code generation, the compiler performs a cleanup pass over the projected AST.

The purpose of this pass is to remove or simplify compiler-generated artifacts such as unnecessary `null` statements and `nothing(...)` calls.

This cleanup pass must operate on the projected AST or projected IR. It must not be implemented as string-based post-processing over generated BlueScript code.

#### 13.9.1 Cleanup Pipeline

The cleanup pass consists of two stages:

```text
1. Expression simplification
2. Statement cleanup
```

Expression simplification is applied before statement cleanup.

#### 13.9.2 Expression Simplification

The compiler recursively simplifies expressions in a bottom-up manner.

The main rule is:

```text
nothing(null, ..., null) => null
```

This rule applies only when, after recursively simplifying all arguments, every argument of `nothing(...)` is exactly `null`.

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

Nested `nothing(...)` expressions must be simplified recursively.

Example:

```ts
nothing(nothing(null), null, null)
```

is simplified as follows:

```ts
nothing(nothing(null), null, null)
=> nothing(null, null, null)
=> null
```

#### 13.9.3 Simplification Inside Function Arguments

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

#### 13.9.4 Statement Cleanup

After expression simplification, the compiler removes expression statements consisting only of `null`.

Example:

```ts
null;
```

is removed.

Therefore:

```ts
nothing(nothing(null), null, null);
```

is cleaned as follows:

```ts
nothing(nothing(null), null, null);
=> null;
=> removed
```

#### 13.9.5 What This Cleanup Pass Must Not Remove

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

It must not remove communication operations such as:

```ts
sendInteger("bob", "top_0", x);
receiveInteger("alice", "top_0");
broadcastBoolean("top_1", c);
```

It must not remove assignments, loops, conditionals, or function declarations merely because they contain `null` values.

This initial cleanup pass only performs the following transformations:

* recursively simplify `nothing(...)` to `null` when all arguments simplify to `null`;
* remove `null;` expression statements.

More advanced dead-code elimination may be added in future versions.

***

## 14. Runtime Support Functions

### 14.1 `nothing`

`nothing` is a compiler-generated helper expression used to make projected code syntactically valid when some source expression has no runtime meaning for the current endpoint.

Conceptually:

```ts
function nothing(...params: any[]): null {
    return null;
}
```

However, `nothing` should be treated primarily as a compiler-generated artifact, not as an ordinary user-defined function.

The cleanup pass in Section 13.9 may simplify `nothing(...)` to `null` when all arguments recursively simplify to `null`.

Examples:

```ts
nothing(null)
```

is simplified to:

```ts
null
```

```ts
nothing(nothing(null), null, null)
```

is simplified to:

```ts
null
```

If a `nothing(...)` expression appears as an expression statement and is simplified to `null`, the resulting `null;` statement is removed.

Example:

```ts
nothing(null);
```

is simplified to:

```ts
null;
```

and then removed.

If `nothing(...)` appears as an argument to another function call, only the `nothing(...)` expression is simplified.

Example:

```ts
foo(nothing(null), null);
```

is simplified to:

```ts
foo(null, null);
```

The call to `foo` itself is not removed.

The BlueScript backend may choose a concrete implementation of `nothing` depending on BlueScript feature support. For example, if rest parameters are not supported, the backend may generate fixed-arity helper functions. However, unnecessary `nothing(...)` calls should be removed or simplified before final code generation whenever possible.

### 14.2 Semantics

`nothing` must satisfy the following conceptual semantics:

* it has no side effects;
* it always evaluates to `null`;
* it performs no communication;
* it is compiler-generated;
* it may be simplified by the cleanup pass.

The compiler must distinguish compiler-generated `nothing(...)` artifacts from ordinary user-defined function calls.

In ChoreoBS Core v0, the cleanup pass only simplifies `nothing(...)` when all of its arguments recursively simplify to `null`.

***

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
function add@alice(a: integer, b: integer): integer {
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

EPP at `bob` before cleanup:

```ts
nothing(null, null);
```

EPP at `bob` after cleanup:

```ts
// removed
```

***

### 15.4 `@every` Function

Input:

```ts
function choose@every(c: boolean@every): integer@alice {
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

EPP at `bob` before cleanup:

```ts
function choose(c: boolean): null {
    if (c) {
        return null;
    } else {
        return null;
    }
}

let c: boolean = true;
nothing(choose(c));
```

EPP at `bob` after cleanup:

```ts
function choose(c: boolean): null {
    if (c) {
        return null;
    } else {
        return null;
    }
}

let c: boolean = true;
nothing(choose(c));
```

Note: `nothing(choose(c))` is not simplified because its argument is not exactly `null` after recursive simplification. This conservative behavior preserves possible function-call effects.

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

### 15.8 Return Type Inference with Numeric LUB

Input:

```ts
function f@alice(c: boolean) {
    if (c) {
        return 1;
    } else {
        return 2.5;
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
push(xs, 20@alice);
let n: integer@alice = length(xs);
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

### 16.3 Location Omission in an `@every` Context

```ts
function f@every(): unit@every {
    let x: integer = 1;
}
```

### 16.4 Top-Level Location Omission

```ts
let x: integer = 1;
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
function f@every(c: boolean@alice): unit@every {
    if (c) {
        return;
    }
}
```

### 16.10 Invalid While Condition

```ts
function f@every(c: boolean@alice): unit@every {
    while (c) {
        return;
    }
}
```

### 16.11 Invalid For Condition

```ts
function f@every(): unit@every {
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
function f@bob(): integer {
    return 1;
}

function g@alice(): integer {
    return f();
}
```

### 16.13 Calling an `@every` Function from a Local Function

```ts
function f@every(): unit@every {
    return;
}

function g@alice(): unit {
    f();
}
```

### 16.14 Recursive `@every` Function

```ts
function f@every(): unit@every {
    f();
}
```

### 16.15 Function Overloading

```ts
function f@alice(): unit {
    return;
}

function f@bob(): unit {
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
function maybe@alice(c: boolean) {
    if (c) {
        return 1;
    }
}
```

### 16.20 Mixed Bare and Value Returns

```ts
function bad@alice(c: boolean) {
    if (c) {
        return 1;
    }
    return;
}
```

### 16.21 Incompatible Inferred Return Types

```ts
function bad@alice(c: boolean) {
    if (c) {
        return 1;
    } else {
        return "one";
    }
}
```

### 16.22 Incompatible Inferred Return Locations

```ts
function bad@every(c: boolean@every) {
    if (c) {
        return 1@alice;
    } else {
        return 1@bob;
    }
}
```

### 16.23 Recursive Function With Omitted Return Type

```ts
function fact@alice(n: integer) {
    if (n <= 1) {
        return 1;
    } else {
        return n * fact(n - 1);
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

A local function parameter must be located at the function's own individual location after location elaboration.

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
function add@bob(a: integer, b: integer): integer {
    return a + b;
}
```

This is elaborated to parameters located at `bob`.

### 16.26 Invalid Local Function Return Location

A local function return type must be located at the function's own individual location after location elaboration.

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
function ok@bob(): integer {
    return 1;
}
```

This is elaborated to `integer@bob`.

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

Allowed:

```cbs
function ok@bob(): integer {
    let x: integer = 1;
    return x;
}
```

### 16.28 Invalid Function Argument Location

A function argument must be compatible with the corresponding parameter type
using base type subtyping, and must be located at the parameter's location
(spec §7.6).

Disallowed:

```cbs
function add@alice(a: integer): integer {
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
function add@alice(a: integer): integer {
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

`string[]`, `null[]`, and `unit[]` are not supported in the mutable array extension.

Disallowed:

```ts
let xs: string[]@alice = []@alice;
let ys: null[]@alice = []@alice;
let zs: unit[]@alice = []@alice;
```

### 16.30 Nested Array

Nested arrays are not supported.

Disallowed:

```ts
let xs: integer[][]@alice = []@alice;
```

### 16.31 Array Literal Without Required Location

At top level and inside `@every` functions, array literals without explicit location annotations must not contain unlocated literal elements.

Disallowed:

```ts
let xs: integer[]@alice = [1, 2, 3];
```

Use:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
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
function f@alice(xs: integer[]): unit {
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

### 16.38 Invalid `push` Element Type

The pushed value must be compatible with the array element type.

Disallowed:

```ts
let xs: integer[]@alice = []@alice;
push(xs, 1.5@alice);
```

## 17. Non-goals and Future Extensions

The following features are not part of ChoreoBS Core v0.

### 17.1 Gradual Features

* location inference;
* omitted locations in `@every` context;
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
* property access as lvalue;
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
* unit arrays;
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
* endpoint protocol verification.

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
* side-effect analysis for ordinary function calls.
