# ChoreoBS Core v0 Specification

ChoreoBS Core v0 is an explicitly located choreographic programming language designed to be transpiled to BlueScript through Endpoint Projection (EPP).

This specification defines the initial core language for implementing the first ChoreoBS transpiler. Future features such as Gradual Choreographic Programming, location inference, `any`, `undefined`, asynchronous execution, and dynamic checks are outside the scope of v0.

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
- generate BlueScript endpoint programs for each participant;
- reduce send/receive mismatches through syntax, typing, and EPP rules;
- serve as the foundation for future Gradual Choreographic Programming.

### 1.3 Basic Example

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <~ x;
```

This program sends the value `x` located at `alice` to `bob`, and stores it in `y`.

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

Therefore, a value of type `T@every` can be used as a local value at any concrete location.

Example:

```ts
let c: boolean@every = true@every;
```

This means every participant locally has `c = true`.

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
Type ::= BaseType LocationAnnotation?
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
LocationAnnotation ::= "@" Location
```

```ebnf
Location ::= Identifier | "every"
```

### 5.3 Function Declaration

```ebnf
FunctionDeclaration ::=
  "function" Identifier "@" Location "(" ParameterList? ")" ":" Type Block
```

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
LetStatement ::= "let" Identifier ":" Type "=" Expression ";"
               | "let" Identifier ":" Type "<~" Expression ";"
```

Uninitialized `let` declarations are not allowed in v0.

Allowed:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <~ x;
```

Disallowed:

```ts
let x: integer@alice;
```

### 5.7 Assignment Statement

```ebnf
AssignmentStatement ::= Identifier "=" Expression ";"
```

The left-hand side must be an identifier.

```ts
x = y + 1@alice;
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
  "let" Identifier ":" Type "=" Expression
```

```ebnf
AssignmentStatementNoSemicolon ::=
  Identifier "=" Expression
```

Example:

```ts
for (let i: integer@every = 0@every; i < 10@every; i = i + 1@every) {
    // body
}
```

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

`return;` is allowed only when the function return type is `unit@L`.

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
                  | PrimaryExpression
```

```ebnf
PrimaryExpression ::= Literal
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

### 7.8 Communication Typing

Communication:

```ts
a <~ b;
```

sends the value of `b` to the location of `a`.

It is valid if:

```text
a : T1@Ldst
b : T2@Lsrc

T2 <: T1
Lsrc != every
Ldst != Lsrc
```

If `Ldst = every`, the communication is treated as a broadcast.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <~ x;
```

This is a communication from `alice` to `bob`.

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

Inside `function@alice`, the condition may be either `boolean@alice` or `boolean@every`.

```ts
function f@alice(c: boolean): unit {
    if (c) {
        return;
    }
}
```

### 7.10 While and For Condition Typing

The termination conditions of `while` and `for` follow the same rule as `if`.

* In an `@every` context, the condition must be `boolean@every`.
* In a local `@p` context, the condition may be `boolean@p` or `boolean@every`.

### 7.11 Binary Operators

#### Arithmetic Operators

```text
+ - * / %
```

These operators are available for `integer` and `float`.

Because `integer <: float`, an `integer` may be used where a `float` is expected.

BlueScript performs implicit conversion from `integer` to `float`; therefore, the ChoreoBS transpiler does not insert explicit conversion functions.

#### String Concatenation

`string + string` is allowed.

```ts
let s: string@alice = "hello "@alice + "world"@alice;
```

#### Comparison Operators

```text
< <= > >=
```

These operators are available for numeric values.

The result is a `boolean` at the same location.

Example:

```ts
let x: integer@alice = 1@alice;
let c: boolean@alice = x < 10@alice;
```

#### Equality Operators

```text
===
!==
```

These operators are available for values of the same base type.

`==` and `!=` are not allowed.

#### Logical Operators

```text
&&
||
!
```

These operators are available for `boolean`.

### 7.12 Function Call Typing

Function calls do not specify locations at the call site.

```ts
add(1@alice, 2@alice)
```

Whether a function call is valid depends on the location of the function definition.

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

```ts
return expr;
```

is allowed if the type of `expr` is compatible with the function return type.

```ts
return;
```

is allowed only if the function return type is `unit@L`.

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
let x: integer = 1;
```

Allowed:

```ts
let x: integer@alice = 1@alice;
```

### 8.4 `@every` Literals

`@every` literals are allowed.

```ts
true@every
1@every
"ok"@every
null@every
```

***

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
for (let i: integer@every = 0@every; i < 10@every; i = i + 1@every) {
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

* Describes choreography.
* May contain communication.
* Is projected to every participant.
* Does not allow location omission.
* Recursion is not supported in v0.

#### Local Function

```ts
function f@alice(...): T {
    ...
}
```

* Runs on a single node.
* Must not contain communication.
* Is generated only for the corresponding node.
* Allows location omission.
* Recursion is allowed.

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

> Send the value of `b` to the location of `a`, then store it in `a`.

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

If the destination is `@every`, the communication is treated as a broadcast.

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

### 11.4 Communication from `@every`

A value located at `@every` already exists at every node. Therefore, it should not be used as the source of communication.

Disallowed:

```ts
let x: integer@every = 1@every;
let y: integer@alice <~ x;
```

Use assignment instead:

```ts
let y: integer@alice = x;
```

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

### 12.10 Assignment Projection

```ts
x = y;
```

EPP to participant `P`:

* If `x` is available at `P`, generate the assignment.
* Otherwise, generate `nothing(...)` or `null`, which may be removed by the cleanup pass.

### 12.11 Function Projection

#### Local Function

```ts
function add@alice(a: integer, b: integer): integer {
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
```

Broadcast APIs:

```ts
broadcastInteger(tag: string, value: integer): void;
broadcastFloat(tag: string, value: float): void;
broadcastBoolean(tag: string, value: boolean): void;
broadcastString(tag: string, value: string): void;
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
    let i: integer@every = 0@every;
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

***

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

### 16.8 Invalid Communication from `@every`

```ts
let x: integer@every = 1@every;
let y: integer@alice <~ x;
```

Use assignment instead.

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

***

## 17. Non-goals and Future Extensions

The following features are not part of ChoreoBS Core v0.

### 17.1 Gradual Features

* location inference;
* omitted locations in `@every` context;
* `any`;
* `undefined`;
* runtime location checks;
* gradual choreographic typing.

### 17.2 TypeScript / JavaScript Features

* `const`;
* object literals;
* arrays;
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

* arrays;
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
* local object and array support;
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
