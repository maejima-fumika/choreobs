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

- describe communication among multiple nodes as a single choreography;
- statically track where values are located using explicit location annotations;
- reduce annotation burden through simple local type inference;
- generate BlueScript endpoint programs for each participant;
- reduce send/receive mismatches through syntax, typing, and EPP rules;
- serve as the foundation for future Gradual Choreographic Programming.

### 1.3 Basic Example

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <~ x;
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

`choreobs.json` specifies the list of participants.

```json
{
  "participants": ["alice", "bob"]
}
```

#### Rules

* `participants` must be an array of strings.
* Each string in `participants` defines a concrete location.
* `every` is a reserved word and must not appear in `participants`.
* Every concrete location used in a `.cbs` source file must be listed in `participants`.
* The compiler generates a `.bs` file for every participant listed in `participants`, even if the participant is not used in the source.
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

The compiler emits one `.bs` file per participant.

Input:

```text
index.cbs
```

`choreobs.json`:

```json
{
  "participants": ["alice", "bob"]
}
```

Output:

```text
index_alice.bs
index_bob.bs
```

***

## 3. Participants and Locations

### 3.1 Locations

ChoreoBS has the following kinds of locations:

```text
Location ::= concrete node name | every
```

Examples:

```text
alice
bob
sensor1
Controller
every
```

### 3.2 Concrete Locations

Concrete locations are defined by the `participants` field in `choreobs.json`.

```json
{
  "participants": ["alice", "bob", "sensor"]
}
```

In this example, the concrete locations are:

```text
alice
bob
sensor
```

### 3.3 `every`

`every` is a special location.

A value of type `T@every` means:

> Every participant locally has the same value of type `T`.

For immutable scalar values, a value of type `T@every` can be used as a local value at any concrete location.

Example:

```ts
let c: boolean@every = true@every;
```

This means every participant locally has `c = true`.

For mutable arrays, `T[]@every` means that each participant has an independent local mutable array with the same contents. It is not shared memory.

A mutable array located at `@every` must not be implicitly assigned to, or passed as, a mutable array at a concrete location. To obtain a concrete-location mutable array from an `@every` array, use explicit localization with `<~`, which creates a fresh mutable copy at the destination.

### 3.4 Location Names

* Location names follow the same lexical rules as ordinary identifiers.
* Location names may contain uppercase letters.
* A node name may be the same as a variable name or a function name.
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
<~
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
            | CommunicationStatement
            | IfStatement
            | WhileStatement
            | ForStatement
            | ReturnStatement
            | ExpressionStatement
```

### 5.6 Let Statement

```ebnf
LetStatement ::= "let" Identifier TypeAnnotation? "=" Expression ";"
               | "let" Identifier ":" Type "<~" Expression ";"
TypeAnnotation ::= ":" Type
```

Uninitialized `let` declarations are not allowed in v0.

For ordinary initialized `let` declarations using `=`, the type annotation may be omitted and inferred from the right-hand side according to Section 7.14.

For communication declarations using `<~`, the type annotation is still required. Core v0 does not infer the destination type or destination location of a communication declaration.

Allowed:

```ts
let x: integer@alice = 1@alice;
let y = x + 1@alice;
let z: integer@bob <~ x;
```

Disallowed:

```ts
let x: integer@alice;
let y <~ x;
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

### 5.8 Communication Statement

```ebnf
CommunicationStatement ::= Identifier "<~" Expression ";"
```

```ts
y <~ x;
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

Inside a local function declared at concrete location `P`, omitted locations in array literals are elaborated to `@P`, following the ordinary local function location omission rule.

***

## 6. Namespaces and Scopes

### 6.1 Namespaces

ChoreoBS has the following namespaces:

* participant / location names;
* variable names;
* function names;
* type names / keywords.

Participant names may be the same as variable names or function names.

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
let y: integer@bob <~ x;
```

Conceptually, this is similar to:

```ts
function __top@every(): unit@every {
    let x: integer@alice = 1@alice;
    let y: integer@bob <~ x;
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

Communication and broadcast transfer array contents by serialized value transfer. The receiver obtains a fresh mutable array that does not share identity with the sender's array. For broadcast to `@every`, the sender-side binding is also a fresh mutable array copy.

A value of type `T[]@every` means that every participant has an independent local mutable array with the same contents. It is not shared memory.

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

### 7.6 Location Availability

Define `available(Lvalue, Luse)` as follows:

```text
available(L, L) = true
available(every, P) = true  where P is a concrete location
available(every, every) = true
available(P, every) = false where P is a concrete location
available(P, Q) = false where P != Q
```

Meaning:

> A value located at `Lvalue` can be used locally in context `Luse`.

Examples:

```text
integer@alice is available at alice
integer@alice is not available at bob
integer@every is available at alice and bob
integer@alice is not available in an every context
```

For mutable arrays, the general `available` relation only describes where an array value exists. It is not sufficient by itself to allow implicit conversion from `T[]@every` to `T[]@P`, where `P` is a concrete location. Such implicit assignment and function argument passing are prohibited; use explicit localization with `<~` to create a fresh concrete-location mutable array.

#### Local Function Strict Availability

Local functions use a stricter availability rule than the general `available` relation.

For a local function declared at a concrete location `P`, only values located exactly at `P` may be used inside the function.

Define `localAvailable(Lvalue, P)` as follows:

```text
localAvailable(P, P) = true
localAvailable(every, P) = false
localAvailable(Q, P) = false where Q is a concrete location and Q != P
```

Meaning:

- A value of type `T@P` may be used inside `function f@P`.
- A value of type `T@Q`, where `Q != P`, must not be used inside `function f@P`.
- A value of type `T@every` must not be used inside any local function.

This rule is intentionally stricter than `available(every, P) = true`. Although `T@every` values are generally available at concrete locations in choreographic contexts, Core v0 local functions are purely endpoint-local computations and do not accept, create, or use `@every` values.

This strict rule applies only to local functions. It does not apply to `@every` choreographic functions.

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
available(L2, L1)
```

For mutable arrays, compatibility is checked by array invariance as defined in Section 7.11.1. Therefore, `T1[]` and `T2[]` are compatible only when `T1` and `T2` are the same element type.

Additionally, assignment from `T[]@every` to `T[]@P`, where `P` is a concrete location, is invalid. Use explicit localization with `<~` instead.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@alice = x;
```

Example:

```ts
let c: boolean@every = true@every;
let d: boolean@alice = c;
```

Disallowed:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob = x;
```

Communication must be used instead.

Disallowed:

```ts
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice = xs;
```

Use explicit localization instead:

```ts
let ys: float[]@alice <~ xs;
```

### 7.8 Communication Typing

Communication:

```ts
a <~ b;
```

moves a value from the location of `b` to the location of `a`. Depending on the source and destination locations, `<~` has one of the following modes.

#### Direct Communication

```text
a : Tdst@Q
b : Tsrc@P
P and Q are concrete locations
P != Q
Tsrc is compatible with Tdst
```

This is direct network communication from `P` to `Q`.

#### Broadcast

```text
a : Tdst@every
b : Tsrc@P
P is a concrete location
Tsrc is compatible with Tdst
```

This is broadcast from `P` to every participant.

#### Localization

```text
a : Tdst@P
b : Tsrc@every
P is a concrete location
Tsrc is compatible with Tdst
```

This is explicit localization from `@every` to the concrete location `P`. It does not perform network communication.

For scalar values, localization is equivalent to local initialization or assignment at the destination.

For mutable arrays, localization creates a fresh mutable copy at the destination.

For array communication, broadcast, and localization, the array element type must match exactly because arrays are invariant. There is no array element type conversion.

Disallowed:

```ts
let xs: integer[]@every = [1, 2]@every;
let ys: float[]@alice <~ xs;
```

The following forms are invalid:

```text
@every -> @every
P -> P where P is the same concrete location
```

Use ordinary assignment for those cases.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <~ x;
```

This is direct communication from `alice` to `bob`.

Example:

```ts
let x: integer@every = 1@every;
let y: integer@alice <~ x;
```

This is localization at `alice`.

### 7.9 If Condition Typing

An `if` condition must be a `boolean` available in the current context.

Let the current context be `C`.

```text
cond : boolean@L
available(L, C)
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

A condition of type `boolean@every` is not allowed inside a local function, because local functions use the stricter `localAvailable` relation.

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

The result is located at the operand location.

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

For an array literal `[e1, ..., en]@L`, each element must be available at `L`. Unlocated literal elements are elaborated to `@L` before type checking. Only unlocated literal elements are elaborated to `@L`; other expressions keep their inferred located types.

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
available(M, L)
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
available(Li, L)
available(Lv, L)
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
available(M, L)
```

then:

```text
push(xs, v) : unit@L
```

In this rule, `T` must be `integer`, `float`, or `boolean`.

During BlueScript code generation, `push(xs, v)` is emitted as `xs.push(v)`.

#### `@every` Array Restrictions

Mutable arrays located at `@every` must not be implicitly converted to concrete-location arrays.

Disallowed:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice = xs;
```

Similarly, a value of type `T[]@every` must not be passed to a function parameter of type `T[]@P` where `P` is a concrete location. This restriction applies to all functions, not only local functions.

Disallowed:

```ts
function f@alice(xs: integer[]): unit {
    return;
}
let xs: integer[]@every = [1, 2, 3]@every;
f(xs);
```

To create a concrete-location mutable array from an `@every` array, use explicit localization with `<~`:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice <~ xs;
```

This creates a fresh mutable copy at `alice`.

To create an `@every` array from a concrete-location array, use broadcast:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys: integer[]@every <~ xs;
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
available(Mi, Li)
```

The argument location does not need to be syntactically equal to the parameter location.

In particular, a value of type `T@every` may be passed to a parameter of type `T@P`, where `P` is a concrete location, because:

```text
available(every, P) = true
```
For mutable array parameters, array invariance applies. A parameter of type `T[]@L` accepts an argument of type `T[]@M` only when the element types are exactly the same and the location rule is satisfied.

Additionally, a value of type `T[]@every` must not be passed to a parameter of type `T[]@P`, where `P` is a concrete location. Use explicit localization with `<~` to create a fresh `T[]@P` value first.

```ts
let arr: float[]@every = [1.1, 2.2]@every;
let arrAlice: float[]@alice <~ arr;
average(arrAlice);
```

Example:

```cbs
function add@alice(a: integer): integer {
    return a;
}

add(10@every);
```

This is valid. The parameter `a` is treated inside the local function as `integer@alice`, not as `integer@every`.

For calls to local functions, argument checking is performed at the call boundary using the general `available` relation. If an argument of type `T@every` is passed to a parameter of type `T@P`, the parameter is bound as a local value of type `T@P` inside the local function. This does not violate the Local Function Strict Location Rule, because the local function body only sees the parameter as `T@P`.

The Local Function Strict Location Rule still applies to the local function declaration and body. Therefore, a local function parameter explicitly declared as `T@every` remains invalid.

#### In an `@every` Context

The following function calls are allowed:

* calls to `@every` functions;
* calls to local functions.

#### In a Local Context

Inside `function@alice`, only `@alice` local functions may be called.

The following are disallowed:

* calls to local functions at other nodes;
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

#### 7.14.3 Communication Let Does Not Infer Destination Type

Communication declarations keep the existing syntax:

```ts
let y: integer@bob <~ x;
```

The type annotation is required. The following remains invalid:

```ts
let y <~ x;
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

For a local function declared at a concrete location `P`:

```cbs
function f@P(...) {
    ...
}
```

all parameters, return values, and expressions evaluated in the function body must be located at `P`.

Rules:

- Every parameter type must be located at `P` after location elaboration.
- If a parameter type omits its location, it is elaborated to `@P`.
- A parameter type explicitly located at another concrete location `Q`, where `Q != P`, is a compile-time error.
- A parameter type explicitly located at `every` is a compile-time error.
- The explicit or inferred return type of a local function must be located at `P`, except that `unit` with an omitted location is elaborated to `unit@P`.
- A return type explicitly or implicitly located at another concrete location `Q`, where `Q != P`, is a compile-time error.
- A return type explicitly or implicitly located at `every` is a compile-time error.
- Every expression evaluated inside the local function body must have a type located at `P`.
- Values located at `every` are not allowed inside local function bodies.
- Values located at another concrete location are not allowed inside local function bodies.
- Communication is not allowed inside local functions.

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

Communication declarations are also allowed.

```ts
let y: integer@bob <~ x;
```

### 9.3 Assignment Statements

Assignment is a statement only.

```ts
x = y;
```

Assignments do not produce values.

### 9.4 Communication Statements

Communication is a statement only.

```ts
y <~ x;
```

Communication statements do not produce values.

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

After EPP, expressions unrelated to the current node may be transformed into `nothing(...)` or `null`.

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
- May contain communication.
- Is projected to every participant.
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

- Runs on a single node.
- Must not contain communication.
- Is generated only for the corresponding node.
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

When calling a local function from an `@every` context, a mutable `T[]@every` value must not be passed directly to a `T[]@P` parameter. Use explicit localization with `<~` first.

```ts
function average@alice(arr: float[]): float {
    return 0.0;
}

let arr: float[]@every = [1.1, 2.2]@every;
let arrAlice: float[]@alice <~ arr;
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

## 11. Communication Semantics

### 11.1 Communication Operator

```ts
a <~ b;
```

means:

> Move the value of `b` to the location of `a`, then store it in `a`.

Depending on the source and destination locations, this is one of:

* direct communication from one concrete location to another concrete location;
* broadcast from one concrete location to `@every`;
* localization from `@every` to one concrete location.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <~ x;
```

Meaning:

```text
alice -> bob: x
```

### 11.2 Direct Communication

If the source and destination are different concrete locations, direct communication is used.

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <~ x;
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

If the destination is `@every` and the source is a concrete location, the communication is treated as a broadcast.

```ts
let x: boolean@alice = true@alice;
let c: boolean@every <~ x;
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
let ys: float[]@every <~ xs;
```

EPP at `alice`:

```ts
let xs: float[] = [1.1, 2.2];
broadcastFloatArray("top_0", xs);
let ys: float[] = cloneFloatArray(xs);
```

### 11.4 Localization from `@every`

A value located at `@every` already exists locally at every participant. Therefore, `<~` from `@every` to a concrete location does not perform network communication.

Instead, it is treated as explicit localization.

For scalar values, localization is equivalent to local initialization or assignment at the destination.

```ts
let x: integer@every = 1@every;
let y: integer@alice <~ x;
```

EPP at `alice`:

```ts
let x: integer = 1;
let y: integer = x;
```

For mutable arrays, localization creates a fresh mutable copy at the destination.

```ts
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <~ xs;
```

EPP at `alice`:

```ts
let xs: float[] = [1.1, 2.2];
let ys: float[] = cloneFloatArray(xs);
```

No `send`, `receive`, `broadcast`, or communication tag is generated for localization.

### 11.5 Communication Tags

Each communication statement is assigned a static tag.

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

Endpoint Projection, EPP, transforms a ChoreoBS program into a BlueScript program for each participant.

```text
EPP(program, participant) -> BlueScript program
```

Before EPP, all inferred types must be elaborated into explicit located types in the internal AST.

### 12.2 Type Projection

Projection of type `T@L` to participant `P` is:

```text
if available(L, P):
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

Projection of expression `e : T@L` to participant `P` is:

```text
if available(L, P):
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

For variable `x : T@L`, projection to participant `P` is:

```text
if available(L, P):
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

### 12.9 Communication Projection

#### Direct Communication

```ts
let y: integer@bob <~ x;
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

For concrete-to-`@every` communication, EPP generates a broadcast at the sender and a receive at every other participant.

For array broadcast, the sender-side `@every` binding is a fresh mutable copy.

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@every <~ xs;
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

#### Localization

If the source is `@every` and the destination is a concrete location `P`, the communication is projected as localization. No `send`, `receive`, `broadcast`, or communication tag is generated.

For scalar values, localization generates local initialization or assignment at `P`.

```ts
let x: integer@every = 1@every;
let y: integer@alice <~ x;
```

EPP at `alice`:

```ts
let x: integer = 1;
let y: integer = x;
```

For array values, localization generates a fresh mutable copy at `P`.

```ts
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <~ xs;
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

EPP to participant `P`:

* If `x` is available at `P`, generate the assignment.
* Otherwise, generate `nothing(...)` or `null`, which may be removed by the cleanup pass.

For array element assignment `xs[i] = v;`, projection is generated only at participants where `xs` is available. If `xs` is not available at participant `P`, the entire statement is projected to an absent/nothing artifact. The compiler must not generate invalid code such as `null[null] = null`.

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

EPP at each participant:

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

EPP at each relevant participant:

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

EPP at each participant:

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

Array communication sends the current contents of the array at the communication statement and produces a fresh mutable array at the receiver.

Example:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@bob <~ xs;
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

Broadcast to `@every` uses a fresh copy at every participant, including the sender.

Example:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@every <~ xs;
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

Top-level non-function statements are projected as the entry program for each participant.

Input:

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <~ x;
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

participants:

```json
{
  "participants": ["alice", "bob"]
}
```

Output:

```text
index_alice.bs
index_bob.bs
```

### 13.5 Local Functions

A local function is emitted only for the corresponding node.

### 13.6 `@every` Functions

An `@every` function is emitted for every node.

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
* localization copies from `T[]@every` to `T[]@P`.

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

`nothing` is a compiler-generated helper expression used to make projected code syntactically valid when some source expression has no runtime meaning for the current node.

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
let y: integer@bob <~ x;
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
let ok: boolean@every <~ localOk;

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

### 15.5 While with Communication

Input:

```ts
let cont: boolean@every = true@every;

while (cont) {
    let x: integer@alice = 1@alice;
    let y: integer@bob <~ x;

    let nextLocal: boolean@bob = false@bob;
    cont <~ nextLocal;
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
    let x: integer@alice = i;
    let y: integer@bob <~ x;
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
let ys: integer[]@bob <~ xs;
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

EPP at every participant:

```ts
let xs: integer[] = [1, 2, 3];
xs[0] = 10;
```

## 16. Compile-time Errors

The following are compile-time errors.

### 16.1 Unknown Participant

```ts
let x: integer@carol = 1@carol;
```

This is an error if `carol` is not listed in `choreobs.json`.

### 16.2 Using `every` as a Participant

```json
{
  "participants": ["alice", "every"]
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

Use communication instead:

```ts
let y: integer@bob <~ x;
```

### 16.8 Invalid Non-Transferring Communication

`<~` must represent direct communication, broadcast, or localization. It must not be used when source and destination are both `@every`, or when source and destination are the same concrete location.

Disallowed:

```ts
let x: integer@every = 1@every;
let y: integer@every <~ x;
```

Use assignment instead:

```ts
let y: integer@every = x;
```

Disallowed:

```ts
let a: integer@alice = 1@alice;
let b: integer@alice <~ a;
```

Use assignment instead:

```ts
let b: integer@alice = a;
```

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

### 16.12 Calling Another Node's Local Function

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

### 16.18 Communication Let Without Type Annotation

```ts
let y <~ x;
```

Communication declarations require an explicit destination type.

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

A local function parameter must be located at the function's own concrete location after location elaboration.

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

A local function return type must be located at the function's own concrete location after location elaboration.

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

Inside a local function declared at concrete location `P`, every evaluated expression must be located at `P`.

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

A function argument must be compatible with the corresponding parameter type using base type subtyping and the general `available` relation.

Allowed:

```cbs
function add@alice(a: integer): integer {
    return a;
}

add(10@every);
```

This is valid because `available(every, alice) = true`.

Disallowed:

```cbs
function add@alice(a: integer): integer {
    return a;
}

add(10@bob);
```

This is invalid because `available(bob, alice) = false`.

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

### 16.34 Invalid `@every` Array Assignment to Concrete Location

A mutable array located at `@every` cannot be assigned to a concrete-location array variable.

Disallowed:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice = xs;
```

### 16.35 Invalid `@every` Array Argument to Concrete Location Parameter

A mutable array located at `@every` cannot be passed to a function parameter located at a concrete location.

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

The index expression must be available at the array location.

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

### 18. Gradual ChoreoBS Extension

This section defines the Gradual ChoreoBS extension built on top of ChoreoBS Core v0. Sections 1 through 17 define the explicitly located Core v0 language. This section extends Core v0 with dynamic locations, runtime location checks, and dynamic endpoint projection support.

The Gradual extension is intended to preserve the Core v0 meaning of explicitly located programs while allowing programmers to replace explicit static locations with `@dynamic`. If a static location annotation is replaced by `@dynamic`, then, as long as all inserted dynamic checks succeed, the observable result is the same as the corresponding explicitly located program. Static location errors are delayed to runtime dynamic location errors.

However, if a location is completely omitted, the default dynamic runtime location is `every` in global and `@every` contexts. Therefore, replacing a static location with `@dynamic` and completely omitting a location are not the same operation.

#### 18.1 Design Goals

Gradual ChoreoBS aims to:

- allow location annotations to be weakened to `@dynamic`;
- preserve base type checking from Core v0;
- move selected static location checks to runtime checks;
- keep all endpoints executing the same projected control-flow structure;
- ensure that endpoints know the runtime location tag of dynamic values even when they do not know the payload value;
- avoid communication mismatch deadlocks caused by dynamic locations by raising controlled runtime dynamic errors;
- preserve explicit communication as the only source-level mechanism for transferring values between locations;
- support dynamic scalar values and the existing mutable one-dimensional array extension.

#### 18.2 Dynamic Location

The Gradual extension adds a special location:

```text
Location ::= concrete node name
           | every
           | dynamic
```

`dynamic` is a reserved word. It must not appear as a participant name in `choreobs.json`.

A type `T@dynamic` means that the value has base type `T`, but its runtime location is represented by a runtime location tag. The tag is either `every` or a concrete participant name.

Examples:

```ts
let x: integer@dynamic = 1;
let y: integer@dynamic = 1@alice;
let z = 1@dynamic;
```

`@dynamic` is not a concrete participant. It exists only in the source type system and is represented after EPP by a runtime `DynValue` wrapper.

#### 18.3 Dynamic Literals

A programmer may explicitly make a literal dynamic by writing `v@dynamic`.

Examples:

```ts
1@dynamic
true@dynamic
"hello"@dynamic
null@dynamic
[1, 2, 3]@dynamic
```

A literal annotated with `@dynamic` is initialized as a dynamic value whose runtime location is `every`.

Example:

```ts
let x = 1@dynamic;
```

After EPP at every participant:

```ts
let x = new DynValue(1, EVERY);
```

This means `1@dynamic` is not an unknown concrete-location literal. It is a dynamic value whose initial runtime location is `every`.

#### 18.4 Location Omission in Gradual ChoreoBS

In global and `@every` contexts, omitted type locations default to `@dynamic`.

Examples:

```ts
let x: integer = 1;
let b: boolean = true;
function f@every(x: integer): integer {
  return x + 1;
}
```

These are elaborated as:

```ts
let x: integer@dynamic = 1;
let b: boolean@dynamic = true;
function f@every(x: integer@dynamic): integer@dynamic {
  return x + 1;
}
```

In local functions, omitted type locations follow Core v0 and default to the function's own concrete location.

```ts
function add@alice(a: integer, b: integer): integer {
  return a + b;
}
```

This is elaborated as:

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
  return a + b;
}
```

Local functions do not accept or return `@dynamic` values.

Disallowed:

```ts
function bad@alice(x: integer@dynamic): integer {
  return x;
}

function bad2@alice(): integer@dynamic {
  return 1@alice;
}
```

#### 18.5 Gradual Let Type Inference

For an ordinary initialized let declaration:

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

This is the same shape as Core v0 inference. The difference is that unlocated literals in global and `@every` contexts are dynamic values with runtime location `every`.

Examples:

```ts
let x = 1@alice;       // x : integer@alice
let y = 1@dynamic;     // y : integer@dynamic, runtime location every
let z = 1;             // z : integer@dynamic, runtime location every
let w = x;             // w : integer@alice
```

If `expr` is a local function call returning a static value, the inferred type is the static return type.

```ts
function add@alice(a: integer, b: integer): integer {
  return a + b;
}

let x = add(1@alice, 2@alice); // x : integer@alice
```

#### 18.6 Communication Let with Omitted Destination Location

In Gradual ChoreoBS, if the destination type of a communication let is written without a location in a global or `@every` context, the destination location defaults to `@dynamic` with runtime location `every`.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer <~ x;
```

This means `y : integer@dynamic`, with destination runtime location `every`.

After EPP at alice:

```ts
let x: integer = 1;
let y = dynMove(packDynamic(x, "alice"), "top_0", EVERY);
```

After EPP at bob:

```ts
let y = dynMove(packDynamic(null, "alice"), "top_0", EVERY);
```

This rule does not infer the destination location from the source expression. The destination is always `@dynamic`, and the runtime destination location is always `EVERY`.

#### 18.6.1 Communication Let with Completely Omitted Destination Type

In Gradual ChoreoBS, a communication let declaration may omit the destination type entirely in a global or `@every` context.

```ts
let x <~ e;
```

If the source expression has type `T@L`, then the declaration is elaborated as:

```ts
let x: T@dynamic <~ e;
```

The base type `T` is inferred from the source expression. The destination location is not inferred from the source expression. It is always `@dynamic`, and the runtime destination location is always `EVERY`.

This rule is available only in Gradual ChoreoBS. Core v0 continues to reject communication let declarations without type annotations.

Examples:

```ts
let a <~ 14@alice;
```

is elaborated as:

```ts
let a: integer@dynamic <~ 14@alice;
```

After EPP at alice:

```ts
let a = dynMove(packDynamic(14, "alice"), "top_0", EVERY);
```

After EPP at bob:

```ts
let a = dynMove(packDynamic(null, "alice"), "top_0", EVERY);
```

For scalar values, the inferred base type is the inferred base type of the source expression. Numeric widening is not introduced by this inference rule. For example, `let a <~ 14@alice;` infers `a : integer@dynamic`, while `let a: float <~ 14@alice;` explicitly checks the integer source against a `float@dynamic` destination using the ordinary base type compatibility rule.

For array values, the inferred destination type preserves the source array element type exactly.

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys <~ xs;
```

is elaborated as:

```ts
let ys: integer[]@dynamic <~ xs;
```

Array invariance is preserved. Communication, broadcast, and localization of arrays keep the existing fresh-copy communication semantics.

The generated code lowers this form to `dynMove`. Static source expressions are packed into `DynValue` using the ordinary packing rules.

Because the runtime destination location is `EVERY`, this form may raise `InvalidDynamicCommunication` at runtime if the source runtime location is also `EVERY`.

Example:

```ts
let x = 1;
let y <~ x;
```

Both `x` and the omitted communication destination have runtime location `EVERY`, so the communication attempts `every -> every` and raises `InvalidDynamicCommunication` at runtime.

For an existing dynamic destination variable, the rule is different. In `x <~ e;`, where `x : T@dynamic`, the runtime destination location is the current runtime location of `x` immediately before the communication. In `let x <~ e;`, there is no previous runtime location for `x`, so the destination runtime location is `EVERY`.


#### 18.7 Base Type Checking and Dynamic Location Checking

Gradual ChoreoBS only gradualizes locations. Base type checking remains static and follows Core v0.

The compiler must use the following decision rule throughout Section 18:

```text
If a program has a base type error:
  reject it at compile time.

Else if a program only has a potential location mismatch involving @dynamic:
  accept it at compile time;
  insert the specified runtime helper;
  let the helper raise a dynamic runtime error if the runtime location is incompatible.

Else if a program violates a non-gradual static rule:
  reject it at compile time.
```

Examples:

```ts
let x: integer = 1;
let y: string@alice = "foo"@alice;
x + y; // compile-time error
```

This is a compile-time error because `integer + string` is invalid. Runtime dynamic operators do not check base types. The compiler must only generate dynamic runtime helpers after Core v0 base type checking succeeds.

By contrast:

```ts
let d: integer@dynamic = 1@bob;
let x: integer@alice = d;
```

This is not a compile-time error. The base type is compatible, so the compiler inserts `requireIntegerAt(d, "alice")`. If `d.location` is not `alice` or `every`, the generated code raises `DynamicLocationMismatch` at runtime.
### 18.8 Dynamic Runtime Representation

A dynamic value is represented after EPP by `DynValue`.

```ts
type RuntimeLocation = string;

const EVERY: RuntimeLocation = "every";
const HERE: RuntimeLocation = "alice"; // generated per endpoint

class DynValue {
  value: any;
  location: RuntimeLocation;

  constructor(value: any, location: RuntimeLocation) {
    this.value = value;
    this.location = location;
  }

  copyWrapper() {
    return new DynValue(this.value, this.location);
  }
}
```

Rules:

- `DynValue` does not have a `hasValue` field.
- `value = null` does not mean payload absence.
- Payload availability is determined by `location` and `HERE`.
- If `location == every`, every endpoint has a meaningful payload value.
- If `location == P`, only endpoint `P` has a meaningful payload value.
- For all endpoints, a given dynamic variable has the same `location` tag.
- If an endpoint does not have the payload, the generated `value` must be `null`.

The global location-tag invariant is:

```text
For every source variable x : T@dynamic, after EPP, every endpoint has a DynValue binding for x with the same location tag.
Only endpoints where the value is available have a meaningful payload.
```

This invariant is preserved by packing, dynamic operators, dynamic communication, dynamic array operations, and dynamic assignment using `copyWrapper()`.

#### 18.9 Packing Static Values into Dynamic Values

Compiler-side packing rule:

```text
pack_P(e) =
  if P == every:
    DynValue(e, every) at all endpoints
  else if HERE == P:
    DynValue(e, P)
  else:
    DynValue(null, P)
```

Runtime helper:

```ts
function packDynamic(value: any, location: RuntimeLocation) {
  return new DynValue(value, location);
}
```

If `e : T@P` is checked against `T@dynamic`, then `e` is packed as follows:

- if `P == every`, every endpoint emits `packDynamic(e, EVERY)`;
- if `P` is concrete and `HERE == P`, emit `packDynamic(e, P)`;
- if `P` is concrete and `HERE != P`, emit `packDynamic(null, P)`.

Example:

```ts
let x: integer@dynamic = 1@alice;
```

After EPP at alice:

```ts
let x = packDynamic(1, "alice");
```

After EPP at bob:

```ts
let x = packDynamic(null, "alice");
```

#### 18.10 Requiring Dynamic Values at Static Locations

This section specifies what the compiler must do when a value of type `T@dynamic` is used in a context that expects a statically located value such as `T@alice` or `T@every`.

The key rule is:

```text
A dynamic-to-static location conversion is not a compile-time location error.
If the base type is compatible, the compiler accepts the program and inserts a require helper.
If the runtime location tag is incompatible, the generated helper raises DynamicLocationMismatch at runtime.
```

This rule applies to ordinary let declarations, assignments, function arguments, returns, and any other context where an expression is checked against an expected statically located type.

Base type checking is still static. If the base type is incompatible, the compiler must reject the program before EPP.

Examples:

```ts
let d: integer@dynamic = 1@alice;
let x: integer@alice = d; // allowed; inserts requireIntegerAt(d, "alice")
```

```ts
let d: string@dynamic = "hello";
let x: integer@alice = d; // compile-time error: string is not compatible with integer
```

##### 18.10.1 Scalar Require

When a scalar expression of type `T@dynamic` is checked against an expected scalar type `T@L`, the compiler inserts the corresponding `requireTAt` helper.

```text
integer@dynamic checked against integer@L  => requireIntegerAt(e, L)
float@dynamic   checked against float@L    => requireFloatAt(e, L)
boolean@dynamic checked against boolean@L  => requireBooleanAt(e, L)
string@dynamic  checked against string@L   => requireStringAt(e, L)
```

This is accepted at compile time if the base type is compatible. Location incompatibility is handled at runtime by the require helper.

```ts
function requireIntegerAt(dynamic: DynValue, location: RuntimeLocation): integer {
  if (location === EVERY) {
    if (dynamic.location === EVERY) {
      return dynamic.value;
    } else {
      throw DynamicLocationMismatch();
    }
  } else {
    if (dynamic.location === EVERY) {
      return dynamic.value;
    } else if (dynamic.location === location) {
      if (location === HERE)
        return dynamic.value;
      else
        return 0; // dummy value; will not be used
    } else {
      throw DynamicLocationMismatch();
    }
  }
}
```

Similarly:

```ts
requireFloatAt(dynamic: DynValue, location: RuntimeLocation): float;
requireBooleanAt(dynamic: DynValue, location: RuntimeLocation): boolean;
requireStringAt(dynamic: DynValue, location: RuntimeLocation): string;
```

Scalar require runtime behavior:

```text
requireTAt(d, every):
  succeeds only if d.location == every.
  otherwise raises DynamicLocationMismatch.

requireTAt(d, P), where P is concrete:
  succeeds if d.location == every or d.location == P.
  if d.location == P and HERE == P, it returns d.value.
  if d.location == P and HERE != P, it returns a dummy value that must not be observed.
  otherwise raises DynamicLocationMismatch.
```

The dummy value exists only to keep generated BlueScript syntactically valid on non-owner endpoints. It must not be observed by user code.

##### 18.10.2 Scalar Require in Let Declarations

For an ordinary let declaration with an explicit statically located scalar type:

```ts
let x: T@L = e;
```

if `e : T@dynamic`, then the declaration is accepted at compile time and lowered using `requireTAt(e, L)`.

Example:

```ts
let d: integer@dynamic = 1@alice;
let x: integer@alice = d;
```

After EPP at alice:

```ts
let d = packDynamic(1, "alice");
let x: integer = requireIntegerAt(d, "alice");
```

After EPP at bob:

```ts
let d = packDynamic(null, "alice");
nothing(requireIntegerAt(d, "alice"));
```

This program is not rejected at compile time. If `d.location` is `alice` or `every`, the runtime check succeeds. If `d.location` is another concrete location, the generated code raises `DynamicLocationMismatch`.

Example with runtime success through `every`:

```ts
let d = 1;
let x: integer@alice = d;
```

After EPP at alice:

```ts
let d = new DynValue(1, EVERY);
let x: integer = requireIntegerAt(d, "alice");
```

Example with runtime failure:

```ts
let d: integer@dynamic = 1@bob;
let x: integer@alice = d;
```

After EPP at alice:

```ts
let d = packDynamic(null, "bob");
let x: integer = requireIntegerAt(d, "alice"); // DynamicLocationMismatch
```

After EPP at bob:

```ts
let d = packDynamic(1, "bob");
nothing(requireIntegerAt(d, "alice")); // DynamicLocationMismatch
```

##### 18.10.3 Scalar Require in Assignment Statements

For an assignment to a statically located scalar variable:

```ts
x = e;
```

if `x : T@L` and `e : T@dynamic`, then the assignment is accepted at compile time and lowered using `requireTAt(e, L)`.

Example:

```ts
let x: integer@alice = 0@alice;
let d: integer@dynamic = 1@alice;
x = d;
```

After EPP at alice:

```ts
let x: integer = 0;
let d = packDynamic(1, "alice");
x = requireIntegerAt(d, "alice");
```

After EPP at bob:

```ts
let d = packDynamic(null, "alice");
nothing(requireIntegerAt(d, "alice"));
```

Again, this is not a compile-time location error. The runtime check may raise `DynamicLocationMismatch`.

##### 18.10.4 Scalar Require in Function Arguments

For a function call:

```ts
f(e);
```

if the parameter type is scalar `T@L` and the argument expression has type `T@dynamic`, then the argument is accepted at compile time and lowered using `requireTAt(e, L)`.

Example:

```ts
function use@alice(x: integer): integer {
  return x;
}

let d: integer@dynamic = 1@alice;
let y: integer@alice = use(d);
```

After EPP at alice:

```ts
function use(x: integer): integer {
  return x;
}

let d = packDynamic(1, "alice");
let y: integer = use(requireIntegerAt(d, "alice"));
```

After EPP at bob, the local function is not called, but the dynamic check in the argument must still be evaluated:

```ts
let d = packDynamic(null, "alice");
nothing(requireIntegerAt(d, "alice"));
```

##### 18.10.5 Scalar Require in Return Statements

For a return statement:

```ts
return e;
```

if the function return type is scalar `T@L` and `e : T@dynamic`, then the return expression is accepted at compile time and lowered using `requireTAt(e, L)`.

Example:

```ts
function f@every(d: integer@dynamic): integer@alice {
  return d;
}
```

After EPP at alice:

```ts
function f(d: DynValue): integer {
  return requireIntegerAt(d, "alice");
}
```

After EPP at bob:

```ts
function f(d: DynValue): null {
  return null;
}
```

The compiler must still preserve dynamic checks in non-owner contexts when those checks appear in evaluated expressions, as described in Sections 18.16 and 18.18.

##### 18.10.6 Array Require

When an array expression of type `T[]@dynamic` is checked against an expected array type `T[]@L`, the compiler inserts the corresponding `requireTArrayAt` helper.

```text
integer[]@dynamic checked against integer[]@L => requireIntegerArrayAt(e, L)
float[]@dynamic   checked against float[]@L   => requireFloatArrayAt(e, L)
boolean[]@dynamic checked against boolean[]@L => requireBooleanArrayAt(e, L)
```

This is accepted at compile time only if the array element type matches exactly. Array types remain invariant.

```ts
function requireIntegerArrayAt(dynamic: DynValue, location: RuntimeLocation): integer[] {
  if (dynamic.location === location)
    return dynamic.value;
  else
    throw DynamicLocationMismatch();
}
```

Similarly:

```ts
requireFloatArrayAt(dynamic: DynValue, location: RuntimeLocation): float[];
requireBooleanArrayAt(dynamic: DynValue, location: RuntimeLocation): boolean[];
```

Array require uses exact location matching:

```text
requireTArrayAt(d, L):
  succeeds only if d.location == L.
  otherwise raises DynamicLocationMismatch.
```

Unlike scalar require, array require does not allow an `@every` array to be implicitly required at a concrete location. This preserves the Core v0 restriction that mutable arrays located at `@every` must not be implicitly converted to concrete-location arrays.

Example:

```ts
let xs = [1, 2, 3];
let ys: integer[]@every = xs;
let zs: integer[]@alice = xs;
```

After EPP at alice:

```ts
let xs = new DynValue([1, 2, 3], EVERY);
let ys = requireIntegerArrayAt(xs, EVERY);
let zs = requireIntegerArrayAt(xs, "alice"); // DynamicLocationMismatch
```

After EPP at bob:

```ts
let xs = new DynValue([1, 2, 3], EVERY);
let ys = requireIntegerArrayAt(xs, EVERY);
let zs = requireIntegerArrayAt(xs, "alice"); // DynamicLocationMismatch
```

##### 18.10.7 Condition Require

Dynamic conditions must be located at `every` at runtime.

```ts
function requireCondition(dynamic: DynValue): boolean {
  if (dynamic.location === EVERY) {
    return dynamic.value;
  } else {
    throw DynamicLocationMismatch();
  }
}
```

`if`, `while`, and `for` conditions use `requireCondition` when the condition expression has type `boolean@dynamic`.

Example:

```ts
let c: boolean@dynamic = true@alice;
if (c) {
}
```

This is accepted at compile time. It is lowered to `requireCondition(c)` and may fail at runtime.

After EPP at alice:

```ts
let c = packDynamic(true, "alice");
if (requireCondition(c)) { // DynamicLocationMismatch
}
```

After EPP at bob:

```ts
let c = packDynamic(null, "alice");
if (requireCondition(c)) { // DynamicLocationMismatch
}
```

##### 18.10.8 Compile-time vs Runtime Summary for Require

The following are compile-time errors:

```ts
let d: string@dynamic = "hello";
let x: integer@alice = d; // base type mismatch
```

```ts
let xs: integer[]@dynamic = [1, 2, 3]@alice;
let ys: float[]@alice = xs; // array element type mismatch
```

The following are not compile-time errors; they are accepted and lowered to runtime require helpers:

```ts
let d: integer@dynamic = 1@alice;
let x: integer@alice = d; // requireIntegerAt(d, "alice")
```

```ts
let d: integer@dynamic = 1@bob;
let x: integer@alice = d; // runtime DynamicLocationMismatch
```

```ts
let xs: integer[]@dynamic = [1, 2, 3]@bob;
let ys: integer[]@alice = xs; // runtime DynamicLocationMismatch
```

```ts
let c: boolean@dynamic = true@alice;
if (c) {
} // runtime DynamicLocationMismatch
```
### 18.11 Dynamic Runtime Errors

The Gradual runtime distinguishes the following dynamic errors:

```ts
DynamicLocationMismatch
InvalidDynamicCommunication
InvalidDynamicArrayAccess
```

`DynamicLocationMismatch` is raised when a dynamic value is required at an incompatible location.

`InvalidDynamicCommunication` is raised when a dynamic communication attempts a non-transferring communication such as `every -> every` or `P -> P`.

`InvalidDynamicArrayAccess` is raised when dynamic array availability rules are violated.

Ordinary runtime errors, such as array bounds errors or division by zero, are not dynamic location errors. Ordinary runtime errors are raised only at endpoints where the actual computation occurs.

#### 18.12 Dynamic Operators

Compile-time vs runtime rule for dynamic operators:

```text
If the operator is invalid for the base types:
  compile-time error.

If the operator is valid for the base types but operand runtime locations may be incompatible:
  compile-time success;
  lower to dyn* helper;
  runtime helper may raise DynamicLocationMismatch.
```

Examples:

```ts
let x: integer@dynamic = 1@alice;
let y: integer@dynamic = 2@bob;
x + y; // accepted at compile time; DynamicLocationMismatch at runtime
```

```ts
let x: integer@dynamic = 1;
let s: string@dynamic = "foo";
x + s; // compile-time error: invalid base types for +
```


If either operand of an operator is dynamic, all static operands are packed into `DynValue` first. The operator result is dynamic.

```text
T@dynamic op T@dynamic -> T@dynamic
T@dynamic op T@L       -> T@dynamic
T@L       op T@dynamic -> T@dynamic
```

Base type checking is performed statically before dynamic lowering.

##### 18.12.1 Arithmetic Operators

Supported dynamic arithmetic operators:

```text
+ - * / %
```

Example runtime helper:

```ts
function dynAdd(a: DynValue, b: DynValue) {
  if (a.location === EVERY && b.location === EVERY) {
    return new DynValue(a.value + b.value, EVERY);
  }
  else if (a.location === EVERY) {
    if (b.location === HERE) return new DynValue(a.value + b.value, b.location);
    else return new DynValue(null, b.location);
  }
  else if (b.location === EVERY) {
    if (a.location === HERE) return new DynValue(a.value + b.value, a.location);
    else return new DynValue(null, a.location);
  }
  else {
    if (a.location === b.location) {
      if (a.location === HERE) return new DynValue(a.value + b.value, a.location);
      else return new DynValue(null, a.location);
    } else {
      throw DynamicLocationMismatch();
    }
  }
}
```

Similarly:

```ts
dynSub(a: DynValue, b: DynValue): DynValue;
dynMul(a: DynValue, b: DynValue): DynValue;
dynDiv(a: DynValue, b: DynValue): DynValue;
dynMod(a: DynValue, b: DynValue): DynValue;
```

Examples:

```ts
let a: integer = 100;
let b: integer = 200;

a + b;
a + 10@alice;
a + 20@every;
```

After EPP at alice:

```ts
let a: DynValue = new DynValue(100, EVERY);
let b: DynValue = new DynValue(200, EVERY);

dynAdd(a, b);
dynAdd(a, packDynamic(10, "alice"));
dynAdd(a, packDynamic(20, EVERY));
```

After EPP at bob:

```ts
let a: DynValue = new DynValue(100, EVERY);
let b: DynValue = new DynValue(200, EVERY);

dynAdd(a, b);
dynAdd(a, packDynamic(null, "alice"));
dynAdd(a, packDynamic(20, EVERY));
```

A dynamic location mismatch raises an error at every endpoint:

```ts
let x: integer@dynamic = 1@alice;
let y: integer@dynamic = 2@bob;
x + y; // DynamicLocationMismatch
```

##### 18.12.2 Logical Operators

Supported dynamic logical operators:

```text
&& ||
```

Dynamic logical operators follow the same location rules as dynamic binary arithmetic operators. Gradual ChoreoBS does not use short-circuit evaluation for dynamic logical operators.

```ts
dynAnd(a: DynValue, b: DynValue): DynValue;
dynOr(a: DynValue, b: DynValue): DynValue;
```

##### 18.12.3 Comparison and Equality Operators

Supported dynamic comparison and equality operators:

```text
< <= > >= === !==
```

Dynamic comparison and equality operators follow the same location rules as dynamic binary arithmetic operators. Array equality remains disallowed by static base type checking.

```ts
dynLt(a: DynValue, b: DynValue): DynValue;
dynLe(a: DynValue, b: DynValue): DynValue;
dynGt(a: DynValue, b: DynValue): DynValue;
dynGe(a: DynValue, b: DynValue): DynValue;
dynEq(a: DynValue, b: DynValue): DynValue;
dynNeq(a: DynValue, b: DynValue): DynValue;
```

##### 18.12.4 Unary Operators

Supported dynamic unary operators:

```text
! -
```

Example:

```ts
function dynNot(a: DynValue): DynValue {
  if (a.location === EVERY || a.location === HERE) {
    return new DynValue(!a.value, a.location);
  } else {
    return new DynValue(null, a.location);
  }
}
```

Similarly:

```ts
dynNeg(a: DynValue): DynValue;
```

#### 18.13 Dynamic Communication

Compile-time vs runtime rule for dynamic communication:

```text
If the communication has a base type incompatibility:
  compile-time error.

If a communication involving @dynamic may become P -> P or every -> every at runtime:
  compile-time success;
  lower to dynMove;
  dynMove raises InvalidDynamicCommunication if the runtime source and destination form is invalid.

If neither source nor destination is dynamic and Core v0 says the communication is non-transferring:
  compile-time error, as in Core v0.
```

Example:

```ts
let a: integer@dynamic = 1@alice;
let b: integer@dynamic = 2@alice;
a <~ b; // accepted at compile time; InvalidDynamicCommunication at runtime
```

```ts
let a: integer@alice = 1@alice;
let b: integer@alice <~ a; // compile-time error: static alice -> alice communication
```


Source-level communication remains a statement. The compiler may lower it to an expression-returning runtime helper.

Dynamic communication uses `dynMove`.

```ts
function dynMove(from: DynValue, tag: string, toLocation: RuntimeLocation): DynValue {
  if (from.location === EVERY && toLocation === EVERY) {
    throw InvalidDynamicCommunication();
  }
  else if (from.location === EVERY) {
    if (toLocation === HERE)
      return new DynValue(clonePayload(from.value), toLocation);
    else
      return new DynValue(null, toLocation);
  }
  else if (toLocation === EVERY) {
    if (from.location === HERE) {
      broadcastAny(tag, from.value);
      return new DynValue(clonePayload(from.value), toLocation);
    }
    else
      return new DynValue(receiveAny(from.location, tag), toLocation);
  }
  else {
    if (from.location === toLocation) {
      throw InvalidDynamicCommunication();
    } else {
      if (from.location === HERE) {
        sendAny(toLocation, tag, from.value);
        return new DynValue(null, toLocation);
      }
      else if (toLocation === HERE)
        return new DynValue(receiveAny(from.location, tag), toLocation);
      else
        return new DynValue(null, toLocation);
    }
  }
}
```

Dynamic communication modes:

- `P -> Q`, where `P` and `Q` are different concrete locations: direct communication;
- `P -> every`: broadcast;
- `every -> P`: localization;
- `P -> P`: `InvalidDynamicCommunication`;
- `every -> every`: `InvalidDynamicCommunication`.

For array direct communication, broadcast, and localization, the receiver obtains a fresh mutable copy. For array broadcast to `every`, every endpoint, including the sender, obtains a fresh mutable copy.

If a dynamic variable is the communication destination, the destination location is the runtime location of the destination variable immediately before the communication.

Example:

```ts
let a: integer = 100;
let b: integer = 200;
let c: integer = 300@alice;

a <~ b;
a <~ c;
c <~ a;
let d: integer <~ a;
let e: integer@alice <~ a;
```

After EPP at alice:

```ts
let a: DynValue = new DynValue(100, EVERY);
let b: DynValue = new DynValue(200, EVERY);
let c: integer = 300;

a = dynMove(b, "tag1", a.location);
a = dynMove(packDynamic(c, "alice"), "tag2", a.location);
c = requireIntegerAt(dynMove(a, "tag3", "alice"), "alice");

let d = dynMove(a, "tag4", EVERY);
let e = requireIntegerAt(dynMove(a, "tag5", "alice"), "alice");
```

After EPP at bob:

```ts
let a: DynValue = new DynValue(100, EVERY);
let b: DynValue = new DynValue(200, EVERY);

a = dynMove(b, "tag1", a.location);
a = dynMove(packDynamic(null, "alice"), "tag2", a.location);
requireIntegerAt(dynMove(a, "tag3", "alice"), "alice");

let d = dynMove(a, "tag4", EVERY);
requireIntegerAt(dynMove(a, "tag5", "alice"), "alice");
```

The following dynamic communication raises `InvalidDynamicCommunication`:

```ts
let a: integer@dynamic = 1@alice;
let b: integer@dynamic = 2@alice;
a <~ b; // destination is a.location, so this is alice -> alice
```

#### 18.14 Dynamic Arrays

Compile-time vs runtime rule for dynamic arrays:

```text
If the array element type, index type, or item type is invalid:
  compile-time error.

If the base/element types are valid but runtime locations may be incompatible:
  compile-time success;
  lower to dynArray* helper;
  helper may raise InvalidDynamicArrayAccess at runtime.
```

Examples:

```ts
let arr = [1, 3, 5];
arr[0] = 3@alice; // accepted at compile time; InvalidDynamicArrayAccess at runtime
```

```ts
let arr = [1, 3, 5];
arr[0] = true; // compile-time error: boolean is not compatible with integer
```


Dynamic arrays use `DynValue` wrappers. The payload is a mutable one-dimensional array.

For dynamic arrays:

- if `arr.location == every`, every endpoint has an independent mutable array with the same contents;
- if `arr.location == P`, only endpoint `P` has the payload array;
- non-owner endpoints must not access `arr.value`;
- `arr.value` may be accessed only when `arr.location == every` or `arr.location == HERE`.

##### 18.14.1 Dynamic Array Get

```ts
function dynArrayGet(arr: DynValue, index: DynValue): DynValue {
  if (arr.location === EVERY && index.location === EVERY) {
    return new DynValue(arr.value[index.value], EVERY);
  }
  else if (arr.location === EVERY) {
    throw InvalidDynamicArrayAccess();
  }
  else if (index.location === EVERY) {
    if (arr.location === HERE) return new DynValue(arr.value[index.value], arr.location);
    else return new DynValue(null, arr.location);
  }
  else {
    if (arr.location === index.location) {
      if (arr.location === HERE) return new DynValue(arr.value[index.value], arr.location);
      else return new DynValue(null, arr.location);
    } else {
      throw InvalidDynamicArrayAccess();
    }
  }
}
```

Rules:

```text
arr.location == every:
  index.location must be every.

arr.location == P:
  index.location must be every or P.
```

Examples:

```ts
let arr = [1, 3, 5];
let arr2 = [1, 3, 5]@alice;
let i = 0;

arr[i];
arr[0@alice];
arr2[i];
```

After EPP at alice:

```ts
let arr = new DynValue([1, 3, 5], EVERY);
let arr2 = [1, 3, 5];
let i = new DynValue(0, EVERY);

dynArrayGet(arr, i);
dynArrayGet(arr, packDynamic(0, "alice")); // InvalidDynamicArrayAccess
dynArrayGet(packDynamic(arr2, "alice"), i);
```

After EPP at bob:

```ts
let arr = new DynValue([1, 3, 5], EVERY);
let i = new DynValue(0, EVERY);

dynArrayGet(arr, i);
dynArrayGet(arr, packDynamic(null, "alice")); // InvalidDynamicArrayAccess
dynArrayGet(packDynamic(null, "alice"), i);
```

##### 18.14.2 Dynamic Array Set

```ts
function dynArraySet(arr: DynValue, index: DynValue, item: DynValue): void {
  if (arr.location === EVERY) {
    if (index.location === EVERY && item.location === EVERY) {
      arr.value[index.value] = item.value;
    } else {
      throw InvalidDynamicArrayAccess();
    }
  }
  else {
    if (
      (index.location === EVERY || index.location === arr.location) &&
      (item.location === EVERY || item.location === arr.location)
    ) {
      if (arr.location === HERE) {
        arr.value[index.value] = item.value;
      }
    } else {
      throw InvalidDynamicArrayAccess();
    }
  }
}
```

Rules:

```text
arr.location == every:
  index.location == every and item.location == every are required.
  all endpoints perform the same mutation.

arr.location == P:
  index.location must be every or P.
  item.location must be every or P.
  only endpoint P performs the mutation.
  other endpoints do nothing if checks succeed.
```

Examples:

```ts
let arr = [1, 3, 5];
let arr2 = [1, 3, 5]@alice;

arr[0] = 5;
arr[0] = 3@alice;
arr2[0] = 3;
arr2[0@alice] = 3;
```

After EPP at alice:

```ts
let arr = new DynValue([1, 3, 5], EVERY);
let arr2 = [1, 3, 5];

dynArraySet(arr, new DynValue(0, EVERY), new DynValue(5, EVERY));
dynArraySet(arr, new DynValue(0, EVERY), packDynamic(3, "alice")); // InvalidDynamicArrayAccess
dynArraySet(packDynamic(arr2, "alice"), new DynValue(0, EVERY), new DynValue(3, EVERY));
dynArraySet(packDynamic(arr2, "alice"), packDynamic(0, "alice"), new DynValue(3, EVERY));
```

After EPP at bob:

```ts
let arr = new DynValue([1, 3, 5], EVERY);

dynArraySet(arr, new DynValue(0, EVERY), new DynValue(5, EVERY));
dynArraySet(arr, new DynValue(0, EVERY), packDynamic(null, "alice")); // InvalidDynamicArrayAccess
dynArraySet(packDynamic(null, "alice"), new DynValue(0, EVERY), new DynValue(3, EVERY));
dynArraySet(packDynamic(null, "alice"), packDynamic(null, "alice"), new DynValue(3, EVERY));
```

##### 18.14.3 Dynamic Array Push

```ts
function dynArrayPush(arr: DynValue, item: DynValue): void {
  if (arr.location === EVERY) {
    if (item.location === EVERY) {
      arr.value.push(item.value);
    } else {
      throw InvalidDynamicArrayAccess();
    }
  } else {
    if (item.location === EVERY || arr.location === item.location) {
      if (arr.location === HERE) {
        arr.value.push(item.value);
      }
    } else {
      throw InvalidDynamicArrayAccess();
    }
  }
}
```

Rules:

```text
arr.location == every:
  item.location must be every.
  all endpoints perform the same push.

arr.location == P:
  item.location must be every or P.
  only endpoint P performs the push.
  other endpoints do nothing if checks succeed.
```

##### 18.14.4 Dynamic Array Length

```ts
function dynArrayLength(arr: DynValue): DynValue {
  if (arr.location === EVERY || arr.location === HERE) {
    return new DynValue(arr.value.length, arr.location);
  } else {
    return new DynValue(null, arr.location);
  }
}
```

`dynArrayLength(arr)` returns an `integer@dynamic` whose runtime location is `arr.location`.

Example:

```ts
let arr = [1, 3, 5];
push(arr, 3);
length(arr);
```

After EPP at every participant:

```ts
let arr = new DynValue([1, 3, 5], EVERY);
dynArrayPush(arr, new DynValue(3, EVERY));
dynArrayLength(arr);
```

#### 18.15 Dynamic Assignment

This section is only about assignment whose destination variable has type `T@dynamic`.

Compile-time vs runtime note:

```text
T@dynamic = T@dynamic:
  copyWrapper().

T@dynamic = T@P:
  pack_P(e), then assign/copy wrapper.

T@P = T@dynamic:
  not handled by copyWrapper(); use Section 18.10 require helpers.
```


Assignment to a `@dynamic` variable copies the `DynValue` wrapper.

```ts
let d: integer@dynamic = 1@alice;
let c: integer@dynamic = 1;
d = c;
```

After EPP:

```ts
d = c.copyWrapper();
```

Rules:

- the `DynValue` wrapper is copied;
- the `location` tag is copied;
- scalar payloads are copied by value according to the host language semantics;
- array payload references are shared within the same endpoint;
- payload arrays are not cloned by assignment.

Example:

```ts
let xs = [1, 2, 3];
let ys = xs;
push(xs, 4);
```

After EPP at every participant:

```ts
let xs = new DynValue([1, 2, 3], EVERY);
let ys = xs.copyWrapper();
dynArrayPush(xs, new DynValue(4, EVERY));
```

After the push, `ys.value` refers to the same local array payload as `xs.value`, so `ys` observes the pushed element on each endpoint.

Communication is different from assignment: dynamic communication uses `clonePayload` for arrays and creates fresh mutable copies at receivers.

#### 18.16 Dynamic Functions

Compile-time vs runtime note for functions:

```text
Local function parameter or return type annotated with @dynamic:
  compile-time error.

@every function return type omitted:
  infer using Core v0 rules;
  incompatible inferred static locations are compile-time errors.

@every function return type explicitly T@dynamic, or base-only return type in @every function:
  pack returned static values into DynValue;
  location variation is allowed at compile time.

Dynamic checks inside arguments to local function calls from @every context:
  preserve and evaluate on non-owner endpoints using nothing(...).
```


##### 18.16.1 @every Functions

In an `@every` function, omitted parameter locations default to `@dynamic`.

Example:

```ts
function add@every(a: integer, b: integer) {
  return a + b;
}
```

This is elaborated as:

```ts
function add@every(a: integer@dynamic, b: integer@dynamic) {
  return a + b;
}
```

After EPP at every participant:

```ts
function add(a: DynValue, b: DynValue) {
  return dynAdd(a, b);
}
```

##### 18.16.2 @every Function Return Types

If an `@every` function return type annotation is completely omitted, the return type is inferred from return expressions using Core v0 return type inference.

Example:

```ts
function f@every() {
  return 1@alice;
}
```

The inferred return type is `integer@alice`.

After EPP at alice:

```ts
function f() {
  return 1;
}
```

After EPP at bob:

```ts
function f() {
  return null;
}
```

If an `@every` function return type annotation includes only a base type and omits the location, the return type location is `@dynamic`.

Example:

```ts
function f2@every(): integer {
  return 1@alice;
}
```

This is treated as:

```ts
function f2@every(): integer@dynamic {
  return 1@alice;
}
```

After EPP at alice:

```ts
function f2() {
  return packDynamic(1, "alice");
}
```

After EPP at bob:

```ts
function f2() {
  return packDynamic(null, "alice");
}
```

If a return type is explicitly `T@dynamic`, return expressions of type `T@P` are packed into dynamic values.

Allowed:

```ts
function choose@every(c: boolean@every): integer@dynamic {
  if (c) {
    return 1@alice;
  } else {
    return 2@bob;
  }
}
```

If the return type annotation is omitted, the same function is rejected because the inferred return locations `alice` and `bob` are incompatible under Core v0 return type inference.

Disallowed:

```ts
function bad@every(c: boolean@every) {
  if (c) {
    return 1@alice;
  } else {
    return 2@bob;
  }
}
```

##### 18.16.3 Local Functions

Local functions follow Core v0 location omission rules. Omitted parameter and return locations are elaborated to the function's concrete location.

Local functions must not declare `@dynamic` parameters or return types.

Disallowed:

```ts
function bad@alice(x: integer@dynamic): integer {
  return x;
}

function bad2@alice(): integer@dynamic {
  return 1@alice;
}
```

##### 18.16.4 Calling Local Functions from @every Contexts

When a local function is called from an `@every` context, the local function is emitted only at its owner endpoint. At non-owner endpoints, the callee itself is not called, but argument expressions containing dynamic checks must still be evaluated.

Example:

```ts
function add3@alice(a: integer, b: integer) {
  return a + b;
}

add3(1, 3);
```

After EPP at alice:

```ts
function add3(a: integer, b: integer) {
  return a + b;
}

add3(requireIntegerAt(new DynValue(1, EVERY), "alice"),
     requireIntegerAt(new DynValue(3, EVERY), "alice"));
```

After EPP at bob:

```ts
nothing(requireIntegerAt(new DynValue(1, EVERY), "alice"),
        requireIntegerAt(new DynValue(3, EVERY), "alice"));
```

The `nothing(...)` call must not be removed, because its arguments contain dynamic checks.

If the arguments are static-only absent expressions, the non-owner endpoint may generate `nothing(null, ..., null)`, which may be cleaned up.

##### 18.16.5 Local Function Return Used as Dynamic

A static local function result may be packed into a dynamic value.

Example:

```ts
function add3@alice(a: integer, b: integer) {
  return a + b;
}

let y: integer@dynamic = add3(1@alice, 2@alice);
```

After EPP at alice:

```ts
function add3(a: integer, b: integer) {
  return a + b;
}

let y: DynValue = packDynamic(add3(1, 2), "alice");
```

After EPP at bob:

```ts
let y: DynValue = packDynamic(null, "alice");
```

#### 18.17 Dynamic Conditions

Compile-time vs runtime rule for dynamic conditions:

```text
If the condition base type is not boolean:
  compile-time error.

If the condition has type boolean@dynamic:
  compile-time success;
  lower to requireCondition;
  runtime helper raises DynamicLocationMismatch if the runtime location is not every.
```

Example:

```ts
let c: boolean@dynamic = true@alice;
if (c) {
} // accepted at compile time; DynamicLocationMismatch at runtime
```


If an `if`, `while`, or `for` condition has type `boolean@dynamic`, its runtime location must be `every`.

The generated code uses `requireCondition`.

Example:

```ts
let c = true;
if (c) {
  let x = 1;
}
```

After EPP at every participant:

```ts
let c = new DynValue(true, EVERY);
if (requireCondition(c)) {
  let x = new DynValue(1, EVERY);
}
```

Runtime error:

```ts
let c: boolean@dynamic = true@alice;
if (c) {
  let x = 1;
}
```

After EPP at alice:

```ts
let c = packDynamic(true, "alice");
if (requireCondition(c)) { // DynamicLocationMismatch
  let x = new DynValue(1, EVERY);
}
```

After EPP at bob:

```ts
let c = packDynamic(null, "alice");
if (requireCondition(c)) { // DynamicLocationMismatch
  let x = new DynValue(1, EVERY);
}
```

#### 18.18 Dynamic Endpoint Projection

For `T@dynamic`, EPP does not project values away as `absent`. Instead, every endpoint receives a `DynValue` expression.

Rules:

```text
EPP(e : T@dynamic, P) = DynValue expression at P
```

The `location` field is the same at every endpoint. The `value` field is meaningful only where the runtime location is available.

Static-only absent expressions may be finalized as `null`. Expressions containing dynamic runtime helper calls must be preserved, even on non-owner endpoints.

Dynamic runtime helper calls include, but are not limited to:

```text
requireIntegerAt
requireFloatAt
requireBooleanAt
requireStringAt
requireIntegerArrayAt
requireFloatArrayAt
requireBooleanArrayAt
requireCondition
dynAdd, dynSub, dynMul, dynDiv, dynMod
dynAnd, dynOr
dynLt, dynLe, dynGt, dynGe, dynEq, dynNeq
dynNot, dynNeg
dynMove
dynArrayGet, dynArraySet, dynArrayPush, dynArrayLength
```

These calls may raise dynamic runtime errors or perform communication, so they must not be removed by EPP cleanup.

#### 18.19 Dynamic Cleanup Rules

Gradual ChoreoBS refines the Core v0 cleanup rules.

The only `nothing(...)` calls that may be simplified are those whose recursively simplified arguments are all exactly `null`:

```text
nothing(null, ..., null) => null
```

Then `null;` expression statements may be removed.

The compiler must not remove `nothing(...)` if any argument is a dynamic runtime helper call or an expression that may contain a dynamic check.

Must not be removed:

```ts
nothing(requireIntegerAt(x, "alice"));
nothing(dynAdd(x, y));
nothing(dynMove(x, "tag", "alice"));
nothing(dynArrayGet(xs, i));
```

May be removed:

```ts
nothing(null, null);
```

Cleanup must remain AST-based or IR-based. It must not be implemented as string-based post-processing.

#### 18.20 Dynamic BlueScript Runtime API

The generated BlueScript code for Gradual ChoreoBS uses the following additional runtime support.

```ts
type RuntimeLocation = string;

const EVERY: RuntimeLocation = "every";
const HERE: RuntimeLocation = "alice"; // generated per endpoint

class DynValue {
  value: any;
  location: RuntimeLocation;

  constructor(value: any, location: RuntimeLocation);
  copyWrapper(): DynValue;
}

sendAny(dst: RuntimeLocation, tag: string, value: any): void;
receiveAny(src: RuntimeLocation, tag: string): any;
broadcastAny(tag: string, value: any): void;
clonePayload(value: any): any;
packDynamic(value: any, location: RuntimeLocation): DynValue;

requireIntegerAt(x: DynValue, location: RuntimeLocation): integer;
requireFloatAt(x: DynValue, location: RuntimeLocation): float;
requireBooleanAt(x: DynValue, location: RuntimeLocation): boolean;
requireStringAt(x: DynValue, location: RuntimeLocation): string;
requireIntegerArrayAt(x: DynValue, location: RuntimeLocation): integer[];
requireFloatArrayAt(x: DynValue, location: RuntimeLocation): float[];
requireBooleanArrayAt(x: DynValue, location: RuntimeLocation): boolean[];
requireCondition(x: DynValue): boolean;

dynAdd(a: DynValue, b: DynValue): DynValue;
dynSub(a: DynValue, b: DynValue): DynValue;
dynMul(a: DynValue, b: DynValue): DynValue;
dynDiv(a: DynValue, b: DynValue): DynValue;
dynMod(a: DynValue, b: DynValue): DynValue;
dynAnd(a: DynValue, b: DynValue): DynValue;
dynOr(a: DynValue, b: DynValue): DynValue;
dynLt(a: DynValue, b: DynValue): DynValue;
dynLe(a: DynValue, b: DynValue): DynValue;
dynGt(a: DynValue, b: DynValue): DynValue;
dynGe(a: DynValue, b: DynValue): DynValue;
dynEq(a: DynValue, b: DynValue): DynValue;
dynNeq(a: DynValue, b: DynValue): DynValue;
dynNot(a: DynValue): DynValue;
dynNeg(a: DynValue): DynValue;
dynMove(from: DynValue, tag: string, toLocation: RuntimeLocation): DynValue;
dynArrayGet(arr: DynValue, index: DynValue): DynValue;
dynArraySet(arr: DynValue, index: DynValue, item: DynValue): void;
dynArrayPush(arr: DynValue, item: DynValue): void;
dynArrayLength(arr: DynValue): DynValue;
```

`receiveAny` returns a fresh mutable array when the transmitted payload is an array.

`clonePayload` returns the value itself for scalar values and returns a fresh one-dimensional mutable copy for arrays.

#### 18.21 Dynamic Compile-time Errors

The following are compile-time errors in Gradual ChoreoBS.

##### 18.21.1 Using dynamic as a Participant

```json
{
  "participants": ["alice", "dynamic"]
}
```

##### 18.21.2 Base Type Error Remains Static

```ts
let x: integer = 1;
let s: string@alice = "foo"@alice;
x + s;
```

##### 18.21.3 Dynamic Parameter in Local Function

```ts
function bad@alice(x: integer@dynamic): integer {
  return x;
}
```

##### 18.21.4 Dynamic Return in Local Function

```ts
function bad@alice(): integer@dynamic {
  return 1@alice;
}
```

##### 18.21.5 Incompatible Omitted Return Locations

```ts
function bad@every(c: boolean@every) {
  if (c) {
    return 1@alice;
  } else {
    return 2@bob;
  }
}
```

Use an explicit dynamic return type instead:

```ts
function ok@every(c: boolean@every): integer@dynamic {
  if (c) {
    return 1@alice;
  } else {
    return 2@bob;
  }
}
```

##### 18.21.6 Not Compile-time Errors Merely Due to Dynamic Locations

The following cases are not compile-time errors merely because runtime locations might be incompatible. They must be accepted if base types are valid and then lowered to runtime helpers:

```ts
let d: integer@dynamic = 1@bob;
let x: integer@alice = d; // requireIntegerAt; may raise DynamicLocationMismatch
```

```ts
let x: integer@dynamic = 1@alice;
let y: integer@dynamic = 2@bob;
x + y; // dynAdd; may raise DynamicLocationMismatch
```

```ts
let c: boolean@dynamic = true@alice;
if (c) {
} // requireCondition; may raise DynamicLocationMismatch
```

```ts
let a: integer@dynamic = 1@alice;
let b: integer@dynamic = 2@alice;
a <~ b; // dynMove; may raise InvalidDynamicCommunication
```

```ts
let arr = [1, 2, 3];
arr[0@alice]; // dynArrayGet; may raise InvalidDynamicArrayAccess
let a <~ 14@alice; // base type inferred as integer, destination is integer@dynamic
let x = 1;
let y <~ x; // dynMove; may raise InvalidDynamicCommunication because this is every -> every
```
### 18.22 Dynamic Runtime Error Examples

##### 18.22.1 Dynamic Location Mismatch in Operator

```ts
let x: integer@dynamic = 1@alice;
let y: integer@dynamic = 2@bob;
x + y;
```

Runtime behavior:

```text
DynamicLocationMismatch
```

##### 18.22.2 Dynamic Condition Not Located at every

```ts
let c: boolean@dynamic = true@alice;
if (c) {
}
```

Runtime behavior:

```text
DynamicLocationMismatch
```

##### 18.22.3 Invalid Dynamic Communication: same concrete location

```ts
let a: integer@dynamic = 1@alice;
let b: integer@dynamic = 2@alice;
a <~ b;
```

Runtime behavior:

```text
InvalidDynamicCommunication
```

##### 18.22.4 Invalid Dynamic Communication: every to every

```ts
let a = 1;
let b = 2;
a <~ b;
```

Both `a` and `b` have dynamic runtime location `every`, so this is an invalid non-transferring dynamic communication.

Runtime behavior:

```text
InvalidDynamicCommunication
```

##### 18.22.5 Invalid Dynamic Communication from Completely Omitted Communication Let

```ts
let x = 1;
let y <~ x;
```

Both `x` and the omitted communication destination have runtime location `every`, so this communication attempts `every -> every`.

Runtime behavior:

```text
InvalidDynamicCommunication
```

##### 18.22.6 Invalid Dynamic Array Access

```ts
let arr = [1, 2, 3];
arr[0@alice];
```

Runtime behavior:

```text
InvalidDynamicArrayAccess
```

##### 18.22.7 Invalid Dynamic Array Mutation

```ts
let arr = [1, 2, 3];
arr[0] = 10@alice;
```

Runtime behavior:

```text
InvalidDynamicArrayAccess
```

#### 18.23 Dynamic Examples

##### 18.23.1 Dynamic Default Location

Input:

```ts
let x = 1;
let y = x + 2;
```

After EPP at every participant:

```ts
let x = new DynValue(1, EVERY);
let y = dynAdd(x, new DynValue(2, EVERY));
```

##### 18.23.2 Static Location Packed into Dynamic

Input:

```ts
let x: integer@dynamic = 1@alice;
let y = x + 10;
```

After EPP at alice:

```ts
let x = packDynamic(1, "alice");
let y = dynAdd(x, new DynValue(10, EVERY));
```

After EPP at bob:

```ts
let x = packDynamic(null, "alice");
let y = dynAdd(x, new DynValue(10, EVERY));
```

##### 18.23.3 Dynamic Broadcast via Omitted Communication Destination

Input:

```ts
let x: integer@dynamic = 1@alice;
let y: integer <~ x;
```

After EPP at alice:

```ts
let x = packDynamic(1, "alice");
let y = dynMove(x, "top_0", EVERY);
```

After EPP at bob:

```ts
let x = packDynamic(null, "alice");
let y = dynMove(x, "top_0", EVERY);
```

##### 18.23.4 Completely Omitted Communication Let Type

Input:

```ts
let a <~ 14@alice;
```

This is elaborated as:

```ts
let a: integer@dynamic <~ 14@alice;
```

After EPP at alice:

```ts
let a = dynMove(packDynamic(14, "alice"), "top_0", EVERY);
```

After EPP at bob:

```ts
let a = dynMove(packDynamic(null, "alice"), "top_0", EVERY);
```

The source base type `integer` is inferred from `14@alice`. The destination location is not inferred from `alice`; it is `@dynamic` with runtime destination location `EVERY`.

##### 18.23.5 Completely Omitted Communication Let Type for Arrays

Input:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys <~ xs;
```

This is elaborated as:

```ts
let ys: integer[]@dynamic <~ xs;
```

After EPP at alice:

```ts
let xs: integer[] = [1, 2, 3];
let ys = dynMove(packDynamic(xs, "alice"), "top_0", EVERY);
```

After EPP at bob:

```ts
let ys = dynMove(packDynamic(null, "alice"), "top_0", EVERY);
```

Every endpoint obtains a fresh mutable array payload for `ys`, because this is an array broadcast to `every`.

##### 18.23.6 Dynamic Assignment Shares Array Payload Reference

Input:

```ts
let xs = [1, 2, 3];
let ys = xs;
push(xs, 4);
length(ys);
```

After EPP at every participant:

```ts
let xs = new DynValue([1, 2, 3], EVERY);
let ys = xs.copyWrapper();
dynArrayPush(xs, new DynValue(4, EVERY));
dynArrayLength(ys);
```

`ys` observes the mutation because assignment copies the wrapper but shares the payload array reference within the endpoint.

##### 18.23.7 Dynamic Communication Creates Fresh Array Copy

Input:

```ts
let xs = [1, 2, 3]@alice;
let ys: integer[] <~ xs;
```

After EPP at alice:

```ts
let xs = [1, 2, 3];
let ys = dynMove(packDynamic(xs, "alice"), "top_0", EVERY);
```

After EPP at bob:

```ts
let ys = dynMove(packDynamic(null, "alice"), "top_0", EVERY);
```

Every endpoint obtains a fresh mutable array payload for `ys` because this is an array broadcast to `every`.
