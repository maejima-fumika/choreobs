# ChoreoBS Core v0 Specification <a id="choreobs-core-v0-specification"></a>

ChoreoBS Core v0 is an explicitly located choreographic programming language designed to be transpiled to BlueScript through Endpoint Projection (EPP).

This specification defines the initial core language for implementing the first ChoreoBS transpiler. Core v0 supports simple local type inference for initialized `let` declarations, `for` initializer `let` declarations, expression result types, and function return types. Future features such as Gradual Choreographic Programming, general location inference, `any`, `undefined`, asynchronous execution, and dynamic checks are outside the scope of v0.

---

## 1. Overview <a id="overview"></a>

### 1.1 Language Name <a id="language-name"></a>

- Language name: `ChoreoBS`
- Source file extension: `.cbs`
- Output file extension: `.bs`
- Compilation target: BlueScript

### 1.2 Design Goals <a id="design-goals"></a>

ChoreoBS Core v0 aims to:

- describe communication among multiple endpoints as a single choreography;
- statically track where values are located using explicit location annotations;
- reduce annotation burden through simple local type inference;
- generate BlueScript endpoint programs for each endpoint;
- reduce send/receive mismatches through syntax, typing, and EPP rules;
- serve as the foundation for future Gradual Choreographic Programming.

### 1.3 Basic Example <a id="basic-example"></a>

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
```

This program declares `x` as `integer@alice`, sends its value from `alice` to
`bob`, and stores the received value in `y`. Writing `let x = 10@alice;` would
infer the same type from the initializer (spec [§7.16.1](#let-type-inference)).

After EPP:

```ts
// index_alice.bs
let x: integer = 10;
sendInteger("bob", "__top_0", x);
```

```ts
// index_bob.bs
let y: integer = receiveInteger("alice", "__top_0");
```

***

## 2. Input and Output <a id="input-and-output"></a>

### 2.1 Input Files <a id="input-files"></a>

The ChoreoBS transpiler takes the following inputs:

* a `.cbs` source file;
* a `choreobs.json` configuration file.

Example:

```text
project/
  index.cbs
  choreobs.json
```

### 2.2 `choreobs.json` <a id="choreobs-json"></a>

`choreobs.json` specifies the list of endpoints.

```json
{
  "endpoints": ["alice", "bob"]
}
```

#### Rules <a id="endpoint-rules"></a>

* `endpoints` must be an array of strings.
* Each string in `endpoints` names one endpoint and defines an individual location.
* Each name is held in the value namespace for the whole program (spec [§6.1](#namespaces)): no function, variable or parameter may take an endpoint's name, whether or not the source ever writes `@` with it.
* Each name must be an identifier (spec [§4.3](#identifiers)) and must not be a reserved word (spec [§4.4](#keywords)). An endpoint name is written after `@` in the source (spec [§5.2](#types)) and is also pasted into the output file name (spec [§2.3](#output-files)): a name that is not an identifier would name an endpoint no program could refer to, and would still name a file — `../x` would place that file outside the output directory.
* A name must not begin with `__`, which is reserved for the compiler (spec [§4.3](#identifiers), [§6.2](#function-names)), on the same terms as every other identifier the source writes.
* The **reserved runtime names** of spec [§6.2](#function-names) — `nothing`, the communication API names, `__array`, `__push`, `__and` and `__or` — are *not* reserved here, apart from the `__` prefix above. An endpoint name reaches the generated code only as a string literal (spec [§13.11](#communication-api)) and as part of a file name, never as a BlueScript identifier, so it cannot capture a runtime function the way a variable of that name would.
* The names must be distinct. A repeated name is an error: it would give two output files the same name, and make one endpoint both the sender and the receiver of the same communication.
* `every` is a reserved word and must not appear in `endpoints`. This is a special case of the reserved-word rule above, called out separately because `every` names the location that is deliberately never listed (spec [§3.4](#every)).
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

### 2.3 Output Files <a id="output-files"></a>

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

## 3. Endpoints and Locations <a id="endpoints-and-locations"></a>

### 3.1 Endpoints <a id="endpoints"></a>

An **endpoint** is an agent that executes a program. The endpoints taking part in a
choreography are declared by the `endpoints` field of `choreobs.json` (spec [§2.2](#choreobs-json)).

A choreography is a single global program. The compiler projects it, by Endpoint
Projection (spec [§12](#endpoint-projection)), into one BlueScript program per endpoint.

### 3.2 Locations <a id="locations"></a>

A location denotes where a value is placed. ChoreoBS has the following kinds of
locations:

```text
Location         ::= ConcreteLocation
ConcreteLocation ::= IndividualLocation | every
IndividualLocation ::= endpoint name
```

An **individual location** names exactly one endpoint. A **concrete location** is
either an individual location or `every`. In Core v0 every location is a concrete
location; location abstraction is deferred to [§17.1](#gradual-features).

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

### 3.3 Individual Locations <a id="individual-locations"></a>

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

### 3.4 `every` <a id="every"></a>

`every` is a special location.

A value of type `T@every` means:

> All endpoints locally hold the same value of type `T`.

A `T@every` value is not a value at any individual location. It cannot be used
where a `T@alice` value is required; use `<-` to copy it to `alice` (spec [§7.6](#location-matching-and-residency),
[§11.4](#local-copy)).

Example:

```ts
let c: boolean@every = true@every;
```

This means all endpoints locally hold `c = true`.

For mutable arrays, `T[]@every` means that each endpoint has an independent local mutable array with the same contents. It is not shared memory.

A local copy of an `@every` array with `<-` creates a fresh mutable array at the destination (spec [§11.4](#local-copy)).

### 3.5 Location Names <a id="location-names"></a>

* Location names follow the same lexical rules as ordinary identifiers.
* Location names may contain uppercase letters.
* A location name is held in the value namespace for the whole program, so no function, variable or parameter may take it (spec [§6.1](#namespaces), [§16.48](#err-name-already-held)).
* `every` is reserved.

***

## 4. Lexical Specification <a id="lexical-specification"></a>

### 4.1 Whitespace <a id="whitespace"></a>

The following characters are treated as whitespace:

```text
space
tab
carriage return
line feed
```

### 4.2 Comments <a id="comments"></a>

ChoreoBS supports TypeScript-style comments.

```ts
// line comment

/* block comment */
```

### 4.3 Identifiers <a id="identifiers"></a>

Identifiers have the following form:

```text
Identifier ::= [A-Za-z_][A-Za-z0-9_]*
```

Reserved words cannot be used as ordinary identifiers, and identifiers beginning
with two underscores are reserved for the compiler (spec [§6.2](#function-names)).

### 4.4 Keywords <a id="keywords"></a>

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
as
```

The following words are reserved as well. The features they name are not
supported in v0 (spec [§17](#non-goals-and-future-extensions)), but the words are still keywords, so using one is
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

### 4.5 Literals <a id="literals"></a>

#### Integer Literal <a id="integer-literal"></a>

```text
IntegerLiteral ::= [0-9]+
```

Examples:

```ts
123
0
42
```

#### Float Literal <a id="float-literal"></a>

```text
FloatLiteral ::= [0-9]+ "." [0-9]+
```

Examples:

```ts
1.0
3.14
0.5
```

#### Boolean Literal <a id="boolean-literal"></a>

```ts
true
false
```

#### String Literal <a id="string-literal"></a>

String literals use double quotes.

```ts
"hello"
"alice"
```

#### Null Literal <a id="null-literal"></a>

```ts
null
```

### 4.6 Operators and Punctuation <a id="operators-and-punctuation"></a>

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
(spec [§5.14](#expressions)). It is not general property access: those two names are the whole
set, and ChoreoBS has no objects to access fields of (spec [§17.2](#typescript-javascript-features)).

A float literal's dot is consumed by the literal rule (spec [§4.5](#literals)), which takes
`.` only when a digit follows, so `xs.length` lexes as three tokens and `1.5` as
one.

#### Maximal Munch and `<-` <a id="maximal-munch-and-transfer"></a>

Tokens are formed by maximal munch over the raw character stream, so the
character immediately following `<` decides the token. `a<-b` is therefore a
transfer, not a comparison against `-b`. Write a space to compare against a
negated operand:

```ts
a <- b      // transfer
a < -b      // comparison with -b
```

***

## 5. Syntax <a id="syntax"></a>

This section defines the grammar in an EBNF-like notation.

### 5.1 Program <a id="program"></a>

```ebnf
Program ::= TopLevelItem*
```

```ebnf
TopLevelItem ::= FunctionDeclaration
               | Statement
```

Top-level statements are executed in an implicit choreography context.

### 5.2 Types <a id="types"></a>

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
nested array is rejected by the grammar (spec [§16.30](#nested-array)). Which element types are
actually supported is a typing rule, not a syntactic one, so `string[]`,
`null[]` and `void[]` parse and are then rejected by the type checker
(spec [§7.1.1](#array-types), [§16.29](#unsupported-array-element-type)). Keeping it here would only turn a clear type error into a
syntax error.

```ebnf
LocationAnnotation ::= "@" Location
```

```ebnf
Location ::= Identifier | "every"
```

`void` is the one base type that takes no `LocationAnnotation`, and it may only
appear as a function return type (spec [§7.3](#void), [§16.40](#invalid-use-of-void)).

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

### 5.3 Function Declaration <a id="function-declaration"></a>

```ebnf
FunctionDeclaration ::=
  "function" Identifier ("@" Location)? "(" ParameterList? ")" FunctionReturnType? Block
```

```ebnf
FunctionReturnType ::= ":" Type
```

The two forms of the production are the two kinds of function (spec [§10.1](#function-kinds)): a
declaration carrying a location is a local function, and one carrying none is a
choreography function. A function location must be an individual location
(spec [§16.39](#every-on-a-function-declaration)).

The return type annotation may be omitted. When omitted, the return type is inferred according to [Section 7.16](#type-inference).

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

### 5.4 Blocks <a id="blocks"></a>

```ebnf
Block ::= "{" Statement* "}"
```

### 5.5 Statements <a id="statements"></a>

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

### 5.6 Let Statement <a id="let-statement"></a>

```ebnf
LetStatement ::= "let" Identifier TypeAnnotation? "=" Expression ";"
               | "let" Identifier ":" Type "<-" Expression ";"
TypeAnnotation ::= ":" Type
```

Uninitialized `let` declarations are not allowed in v0.

For ordinary initialized `let` declarations using `=`, the type annotation may be omitted and inferred from the right-hand side according to [Section 7.16](#type-inference).

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

### 5.7 Assignment Statement <a id="assignment-statement"></a>

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

### 5.8 Transfer Statement <a id="transfer-statement"></a>

```ebnf
TransferStatement ::= Identifier "<-" Expression ";"
```

```ts
y <- x;
```

### 5.9 If Statement <a id="if-statement"></a>

```ebnf
IfStatement ::= "if" "(" Expression ")" Block ("else" Block)?
```

`if` is a statement, not an expression.

### 5.10 While Statement <a id="while-statement"></a>

```ebnf
WhileStatement ::= "while" "(" Expression ")" Block
```

### 5.11 For Statement <a id="for-statement"></a>

Only C-style `for` loops are supported in v0.

```ebnf
ForStatement ::=
  "for" "(" ForInit? ";" Expression ";" ForUpdate? ")" Block
```

The condition is required. An omitted one would have to mean an implicit `true`,
and a literal takes no location from its context (spec [§8.1](#explicit-location-annotations)), so there would be
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
does (spec [§5.7](#assignment-statement)), so an array element may be assigned there too:

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

The type annotation in a `for` initializer `let` may be omitted and inferred from the initializer expression according to [Section 7.16](#type-inference).

The following forms are not supported in v0:

```ts
for (x of xs) {
}
```

```ts
for (k in obj) {
}
```

### 5.12 Return Statement <a id="return-statement"></a>

```ebnf
ReturnStatement ::= "return" Expression? ";"
```

`return;` is allowed only when the function return type is `void`, or when an omitted function return type is inferred as `void`.

`return` may appear only inside a function body. The implicit top-level context
(spec [§6.5](#top-level-statements)) has nothing to return from, so a top-level `return` is an error even
though that context behaves like a `void` function in every other respect.

### 5.13 Expression Statement <a id="expression-statement"></a>

```ebnf
ExpressionStatement ::= Expression ";"
```

### 5.14 Expressions <a id="expressions"></a>

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
  AdditiveExpression (RelationalTail | ConversionTail)*
```

```ebnf
RelationalTail ::= ("<" | "<=" | ">" | ">=") AdditiveExpression
```

```ebnf
ConversionTail ::= 
  "as" NumericType (("*" | "/" | "%") UnaryExpression)* (("+" | "-") MultiplicativeExpression)*
```

```ebnf
NumericType ::= "integer" | "float"
```

`as` is a numeric conversion (spec [§7.12](#numeric-conversion)). As in TypeScript, it shares the
level of the relational operators and associates to the left, so `a + b as float`
is `(a + b) as float` and `x as float < y` is `(x as float) < y`. Also as in
TypeScript, a conversion is the left operand of any `* / %` and then `+ -` that
follow it: `x as float * 2.0 + 1.0` is `((x as float) * 2.0) + 1.0`. What follows
`as` is a bare numeric base type: `x as float[]`, `x as float@bob` and
`x as boolean` are syntax errors (spec [§16.49](#invalid-numeric-conversion)).

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
                    | PushExpression
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
errors, and so is any other member name (spec [§16.45](#invalid-array-operation-syntax)).

`xs.length` yields the length; `xs.push(v)` appends and yields nothing, so its
type is `void` (spec [§7.13](#array-typing)). Like a call to a `void` function, it can only
stand as an expression statement — every value position rejects it
(spec [§7.2](#located-types), [§16.40](#invalid-use-of-void)).

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

### 5.15 Located Literals <a id="located-literals"></a>

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

### 5.16 Array Literals <a id="array-literals"></a>

Array literals are produced by the `ArrayLiteral` rule of [§5.14](#expressions).
This section gives their typing and elaboration rules.

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
a local function's location does not supply one (spec [§8.1](#explicit-location-annotations)), and neither do the
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
to be inside it — and v0 never infers a location from context (spec [§8.1](#explicit-location-annotations)).

***

### 5.17 Evaluation Order <a id="evaluation-order"></a>

Evaluation is eager and left to right.

* The operands of a binary operator are evaluated left first, and both are
  always evaluated. This includes `&&` and `||`.
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
  mutation. The expression itself yields nothing (spec [§7.13](#array-typing)).
* A `for` header evaluates its initializer once, then, on each iteration, the
  condition before the body and the body before the update.
* The arguments of the compiler-generated `nothing(...)` (spec [§14.1](#nothing)) are
  evaluated left to right, and each exactly once.

There are no short-circuiting operators in v0. Unlike JavaScript and
BlueScript, `&&` and `||` evaluate their right operand even when the left one
already decides the result (spec [§7.11](#operators)). A guard such as

```ts
i < xs.length && xs[i] > 0@alice
```

therefore still evaluates `xs[i]` when `i` is out of range. A short circuit
would decide from a value that lives at one location whether the right operand
runs, and an endpoint that does not hold that value could not follow the
decision; evaluating both operands everywhere is what lets every endpoint agree
on which calls are made.

Order matters here more than it does in a single-endpoint language: an
expression may contain a call whose body communicates, so two endpoints that
evaluated the same expression in different orders would exchange messages in
different orders. Every endpoint program therefore preserves this one order
(spec [§12.3](#expression-projection)).

***

## 6. Namespaces and Scopes <a id="namespaces-and-scopes"></a>

### 6.1 Namespaces <a id="namespaces"></a>

ChoreoBS has two namespaces:

* the **value namespace**, which holds location names, function names, and
  variable and parameter names together;
* type names / keywords, which are reserved words (spec [§4.4](#keywords)) and so can never
  be written as an identifier at all.

There is one value namespace rather than three because the generated code has
one. BlueScript keeps the source name (spec [§13.6](#codegen-function-names)), so a variable emitted
beside a function of the same name shadows it, and the call the program meant
to make would reach the variable instead. This is the same reasoning that
reserves the runtime names in spec [§6.2](#function-names), applied to the program's own names.

#### What holds a name, and for how long <a id="what-holds-a-name-and-for-how-long"></a>

* An **endpoint name** is declared in `choreobs.json` (spec [§2.2](#choreobs-json)) and holds its
  name for the whole program, whether or not the source ever writes `@` with
  it.
* A **function name** is global and hoisted (spec [§6.2](#function-names), [§6.3](#function-declaration-hoisting)), so it too holds
  its name for the whole program.
* A **variable or parameter name** is block-scoped (spec [§6.4](#variable-scope)). It may shadow
  another variable or parameter, but it may not take a name an endpoint or a
  function already holds.

So the following are errors (spec [§16.48](#err-name-already-held)):

```ts
function alice@alice(): void {   // `alice` is an endpoint name
    return;
}
```

```ts
let bob: integer@alice = 1@alice;   // `bob` is an endpoint name
```

```ts
function g@alice(): integer@alice { return 1@alice; }

function h@alice(): integer@alice {
    let g: integer@alice = 5@alice;   // `g` is a function name
    return g + g();
}
```

The last one is the case the single namespace exists to prevent: with separate
namespaces `g` would read as the variable and `g()` as the function, and the
projection would emit a BlueScript body in which `g` is a number and `g()` is
not callable.

The rule is stated over the whole program, not over each generated file. A
function and a variable that would never be projected to the same endpoint are
still an error, on the same terms as the reserved runtime names of spec [§6.2](#function-names),
which are reserved everywhere and not only where the compiler happens to call
them.

Allowed — shadowing between variables is unaffected (spec [§6.4](#variable-scope)), and a name
merely resembling a held one is an ordinary name:

```ts
function alice2@alice(): integer@alice { return 1@alice; }

let aliceCount: integer@alice = alice2();
```

### 6.2 Function Names <a id="function-names"></a>

* Function overloading is not supported in v0.
* Function names are global: a name may be defined only once, whatever the functions' locations, and a choreography function may not share a name with a local one.
* A function name is held in the value namespace (spec [§6.1](#namespaces)), so no variable or parameter may take it, and it may not be an endpoint name either.
* The **reserved runtime names** listed below cannot be used as a function name, a variable name, or a parameter name.

#### Reserved Runtime Names <a id="reserved-runtime-names"></a>

Generated BlueScript keeps the original ChoreoBS name (spec [§13.6](#codegen-function-names)), so a user
identifier that matches a name the generated code itself calls would capture
that call. The following are therefore reserved in every one of the three
positions:

* `nothing` — the compiler-generated placeholder helper (spec [§14.1](#nothing));
* every communication and clone API name (spec [§13.11](#communication-api)). These are
  `sendInteger`, `receiveInteger` and `broadcastInteger`, and the corresponding
  names for `Float`, `Boolean`, `String`, `Null`, `IntegerArray`, `FloatArray`
  and `BooleanArray`; plus the three clone helpers, which exist for the array
  types alone: `cloneIntegerArray`, `cloneFloatArray` and `cloneBooleanArray`.
  There is no `cloneInteger` and no scalar clone of any type, so none is
  reserved;
* `__array` and `__push` — compiler-internal call sentinels;
* `__and` and `__or` — the runtime helpers that `&&` and `||` are emitted as
  (spec [§14.3](#and-or-helpers));
* every identifier beginning with `__`. EPP introduces names of its own, such as the `__transfer_N` temporaries that keep a transfer source to a single evaluation (spec [§7.8](#transfer-typing), [§12.9](#transfer-projection)), and reserving the prefix lets it do so without consulting the program.

These are reserved for variables and parameters too, not only for functions: a
variable emitted into the same BlueScript scope shadows the runtime function
just as a function of that name would replace it.

`length` and `push` are **not** reserved. They name array operations only after
a `.` (spec [§5.14](#expressions)), so nothing stops a program from also using them as
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

### 6.3 Function Declaration Hoisting <a id="function-declaration-hoisting"></a>

Function declarations are visible throughout the whole file.

```ts
let x: integer@alice = f();

function f@alice(): integer@alice {
    return 1@alice;
}
```

This is allowed.

### 6.4 Variable Scope <a id="variable-scope"></a>

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

Shadowing reaches variables and parameters only. A `let` may not shadow a
function name or an endpoint name: those are held for the whole program
(spec [§6.1](#namespaces)).

```ts
let x: integer@alice = 1@alice;

if (c) {
    let x: integer@alice = 2@alice;   // shadows the outer `x`
}
```

### 6.5 Top-Level Statements <a id="top-level-statements"></a>

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
is not allowed at top level (spec [§5.12](#return-statement)).

### 6.6 Top-Level Let <a id="top-level-let"></a>

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

## 7. Type System <a id="type-system"></a>

### 7.1 Base Types <a id="base-types"></a>

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

An integer literal such as `1` has type `integer`, and a float literal such as
`1.0` has type `float` (spec [§4.5](#literals)). The two types are unrelated (spec [§7.5](#subtyping)), so a
`float` literal is always written with a fractional part: `1@alice` is never a
`float`, though `1@alice as float` is one (spec [§7.12](#numeric-conversion)).

#### 7.1.1 Array Types <a id="array-types"></a>

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

### 7.2 Located Types <a id="located-types"></a>

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
return type is `void`, and `xs.push(v)` (spec [§7.13](#array-typing)). Having no value, it has no location (spec [§7.3](#void)) — but it still
has to run *somewhere*, and where that is comes from the operation itself, not
from a location on its type:

* a call to a local function at `P` runs at `P`;
* a call to a choreography function runs at every endpoint.

Every rule stated for `T@L` — location matching ([§7.6](#location-matching-and-residency)), assignment ([§7.7](#assignment-typing)),
transfer ([§7.8](#transfer-typing)), conditions ([§7.9](#if-condition-typing)) and the Local Function Strict Location Rule
([§8.2](#local-function-strict-location-rule)) — applies to value expressions. A void computation satisfies none of them
and needs none of them: it may appear only as an expression statement, where
there is no value to place.

Wherever a value is required, a void computation is an error (spec [§16.40](#invalid-use-of-void)).
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

### 7.3 Void <a id="void"></a>

`void` is the return type of a function that does not return a value.

Unlike every other type, **`void` has no location**. A location says where a
value is; `void` has no value, so there is nothing to place. Writing one is an
error (spec [§16.40](#invalid-use-of-void)):

```ts
function f@alice(): void { ... }         // valid
function f@alice(): void@alice { ... }   // invalid
```

For the same reason `void` is not a value type: it may appear only as a function
return type, never as a variable type, a parameter type, a transfer destination,
or an array element type (spec [§16.40](#invalid-use-of-void)).

```ts
function f@alice(): void {
    return;
}
```

After EPP — a `void` return type is kept at every endpoint, because there is no
value that could be absent at one of them (spec [§12.2](#type-projection)):

```ts
function f(): void {
    return;
}
```

`void` is distinct from `null` (spec [§7.4](#null)), which is an ordinary value type and
does carry a location.

### 7.4 Null <a id="null"></a>

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

### 7.5 Subtyping <a id="subtyping"></a>

The base type subtyping relation is reflexivity alone:

```text
T <: T
```

There are no other base type subtyping relations. In particular, `integer` and
`float` are unrelated: neither is a subtype of the other, so an `integer` is
never accepted where a `float` is expected, nor the other way round. There is no
implicit conversion between them; a value is converted explicitly with `as`
(spec [§7.12](#numeric-conversion)).

### 7.6 Location Matching and Residency <a id="location-matching-and-residency"></a>

Two distinct relations are used in this specification. They must not be confused.

#### Location Matching (type system) <a id="location-matching-type-system"></a>

A value located at `Lvalue` may be used where a value at `Luse` is required only
when the two locations are the same:

```text
match(L, L) = true
match(every, P) = false  where P is an individual location
match(P, every) = false  where P is an individual location
match(P, Q) = false      where P and Q are individual locations and P != Q
```

`every` and the individual locations are independent (spec [§3.2](#locations)): neither
subsumes the other. In particular, a value of type `T@every` may **not** be used
as a `T@P` value, and a value of type `T@P` may **not** be used as a `T@every`
value. To move a value between two different locations, use the transfer
operator `<-` (spec [§7.8](#transfer-typing)).

Examples:

```text
integer@alice matches alice
integer@alice does not match bob
integer@every does not match alice
integer@alice does not match an every context
```

This rule applies uniformly to scalars and to mutable arrays, and it is the only
location rule used by assignment ([§7.7](#assignment-typing)), function arguments ([§7.14](#function-call-typing)), and return
values ([§7.15](#return-typing)). It also subsumes the local function discipline: inside
`function f@P` the required location is `P`, so a value at `every` or at another
individual location is rejected by the same rule. The additional restrictions
specific to local function declarations are stated in [§8.2](#local-function-strict-location-rule).

#### Location Residency (endpoint projection) <a id="location-residency-endpoint-projection"></a>

Endpoint Projection needs a different question answered: which endpoints
physically hold a copy of a value? Define `residesAt(L, P)`, where `P` is an
endpoint:

```text
residesAt(P, P) = true
residesAt(every, P) = true
residesAt(Q, P) = false  where Q is an individual location and Q != P
```

A value at `every` resides at every endpoint, because every endpoint holds its
own copy (spec [§3.4](#every)). This is why `T@every` declarations are projected into every
endpoint program rather than becoming `absent` (spec [§12.2](#type-projection)).

Residency does **not** imply matching. That an endpoint `alice` holds a copy of a
`T@every` value does not make that value usable as a `T@alice` value; an explicit
`<-` transfer is still required. `residesAt` is used only by [§12](#endpoint-projection) and must
never be used as a typing rule.

### 7.7 Assignment Typing <a id="assignment-typing"></a>

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

For mutable arrays, compatibility is checked by array invariance as defined in [Section 7.13](#array-typing). Therefore, `T1[]` and `T2[]` are compatible only when `T1` and `T2` are the same element type.

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

### 7.8 Transfer Typing <a id="transfer-typing"></a>

The transfer operator:

```ts
a <- b;
```

evaluates `b` at its own location and copies the resulting value to the location
of `a`, storing it in `a`.

#### Base Type Rule <a id="base-type-rule"></a>

For `a : T1@p` and `b : T2@q`, the transfer is well typed only when

```text
T2 <: T1
```

that is, the source base type must be a subtype of the destination base type
(spec [§7.5](#subtyping)). Since subtyping is reflexivity alone, this means the two base
types must be the same. Locations play no part in this rule.

Every value type may be transferred: `integer`, `float`, `boolean`, `string`,
`null`, and the array types. Each has its own entry in the communication API
(spec [§13.11](#communication-api)), so no payload is ever sent through a channel of the wrong type. A
`null` transfer carries no data — it is a synchronisation signal — but it is an
ordinary transfer in every other respect. `void` is not a value type at all and
cannot appear on either side (spec [§7.3](#void), [§16.40](#invalid-use-of-void)).

Allowed — the same base type:

```ts
let y: integer@alice = 1@alice;
let x: integer@bob <- y;
```

Disallowed — `integer` and `float` are unrelated, in either direction:

```ts
let y: integer@alice = 1@alice;
let x: float@bob <- y;
```

```ts
let y: float@alice = 1.5@alice;
let x: integer@bob <- y;
```

Convert explicitly instead, on whichever side should do the work
(spec [§7.12](#numeric-conversion)):

```ts
let y: integer@alice = 1@alice;
let x: float@bob <- y as float;
```

Disallowed — any other pair of different base types:

```ts
let y: float@alice = 1.5@alice;
let x: string@bob <- y;
```

Arrays follow the same rule: for `T[]`, the element types must be exactly the
same (spec [§7.13](#array-typing)).

Disallowed:

```ts
let xs: integer[]@every = [1, 2]@every;
let ys: float[]@alice <- xs;
```

#### Location Rule <a id="location-rule"></a>

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

The unifying rule is residency (spec [§7.6](#location-matching-and-residency)). At an endpoint `E` that the
destination resides at, the transfer is a local copy when the source also
resides at `E`, and a receive otherwise. A transfer is therefore a pure local
copy exactly when every endpoint the destination resides at already holds the
source payload — that is, when the source is `@every`, or when the source and
destination locations are the same.

A transfer that performs no communication is ordinary and expected; it is not an
error.

#### The Source Is Evaluated Once <a id="the-source-is-evaluated-once"></a>

The source of a transfer is an arbitrary expression and may call a function, so
how many times it is evaluated is observable:

> The source expression of a transfer is evaluated exactly once at each endpoint
> where it is evaluated at all.

This needs saying because a broadcast uses the source value twice at the sender
— once as the payload and once for the sender's own binding (spec [§11.3](#broadcast-communication)). Those
two uses must be the same value. Where the generated code needs the value more
than once, EPP binds it to a temporary first (spec [§12.9](#transfer-projection)).

#### Local Copy Is Always a Fresh Copy <a id="local-copy-is-always-a-fresh-copy"></a>

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

### 7.9 If Condition Typing <a id="if-condition-typing"></a>

An `if` condition must be a `boolean` located at the current context's location.

Let the current context be `C`.

```text
cond : boolean@L
match(L, C)
```

#### Choreography Context <a id="if-condition-choreography-context"></a>

In a choreography function or at top level, the condition must be `boolean@every`. The same applies to `while` and `for` conditions (spec [§7.10](#while-and-for-condition-typing)).

```ts
let c: boolean@every = true@every;

if (c) {
}
```

#### Local Context <a id="if-condition-local-context"></a>

Inside `function@alice`, the condition must be `boolean@alice`.

A condition of type `boolean@every` is not allowed inside a local function: `every` does not match `alice` (spec [§7.6](#location-matching-and-residency)).

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

### 7.10 While and For Condition Typing <a id="while-and-for-condition-typing"></a>

The termination conditions of `while` and `for` follow the same rule as `if`.

* In a choreography context, the condition must be `boolean@every`.
* In a local `@p` context, the condition must be `boolean@p`. `boolean@every` is not allowed inside local functions.

### 7.11 Operators <a id="operators"></a>

Every operator requires its operands to be scalars: no operator, and no numeric
conversion (spec [§7.12](#numeric-conversion)), is defined over array types (spec [§7.13](#array-typing)).
[§7.11](#operators), [§7.12](#numeric-conversion) and [§7.13](#array-typing) together cover all of them.

#### Arithmetic Operators <a id="arithmetic-operators"></a>

```text
+ - * / %
```

These operators are available for `integer` and `float`. `boolean`, `null`,
`string` (apart from the concatenation below) and array operands are rejected
(spec [§16.44](#invalid-arithmetic-or-logical-operand)).

Both operands must have the same numeric type. `integer` and `float` are
unrelated (spec [§7.5](#subtyping)), so there is no promotion, and an `integer` operand
mixed with a `float` one is rejected (spec [§16.44](#invalid-arithmetic-or-logical-operand)). Convert one of
them explicitly instead (spec [§7.12](#numeric-conversion)).

The inferred result base type is:

```text
integer op integer => integer
float   op float   => float
```

```ts
1@alice + 2@alice                // valid: integer@alice
1.5@alice * 2.0@alice            // valid: float@alice
1@alice + 1.5@alice              // invalid
(1@alice as float) + 1.5@alice   // valid: float@alice
```

Both operands must be located at the same location (spec [§7.6](#location-matching-and-residency)); the result is
located there too. Mixing an `@every` operand with an individual-location operand
is a compile-time error.

#### String Concatenation <a id="string-concatenation"></a>

`string + string` is allowed.

```ts
let s: string@alice = "hello "@alice + "world"@alice;
```

The inferred result type is `string` at the operand location.

#### Comparison Operators <a id="comparison-operators"></a>

```text
< <= > >=
```

These operators are available for numeric values — `integer` and `float` only.
`string`, `boolean`, `null` and array operands are rejected (spec [§16.43](#invalid-comparison-or-equality-operands)).

Like the arithmetic operators, they require both operands to have the same
numeric type: an `integer` is not compared with a `float` (spec [§7.5](#subtyping)).

```ts
1@alice < 2@alice       // valid
1.0@alice < 1.5@alice   // valid
1@alice < 1.5@alice     // invalid
```

Both operands must be located at the same location, and the result is a
`boolean` there.

Example:

```ts
let x: integer@alice = 1@alice;
let c = x < 10@alice;
```

`c` is inferred as `boolean@alice`.

#### Equality Operators <a id="equality-operators"></a>

```text
===
!==
```

These operators are available for values of **exactly** the same base type.
Like the arithmetic and relational operators, they do not mix the two numeric
types: `integer === float` is rejected (spec [§16.43](#invalid-comparison-or-equality-operands)).

```ts
1@alice === 1.0@alice   // invalid
1@alice === 2@alice     // valid
```

Both operands must be located at the same location, and the result is a
`boolean` there.

`==` and `!=` are not allowed.

Array types are not base types. The equality operators `===` and `!==` are not defined for array types.

Nor is `void`. A void computation produces no value (spec [§7.2](#located-types)), so there is
nothing for `===` to compare — and `void === void` would otherwise slip past
the same-base-type rule above (spec [§16.43](#invalid-comparison-or-equality-operands)).

#### Logical Operators <a id="logical-operators"></a>

```text
&&
||
```

These operators are available for `boolean` alone. Any other operand, a
`boolean[]` among them, is rejected (spec [§16.44](#invalid-arithmetic-or-logical-operand)).

Both operands must be located at the same location (spec [§7.6](#location-matching-and-residency)),
and the result is a `boolean` there.

They do **not** short-circuit: both operands are always evaluated, left first,
like those of every other binary operator (spec [§5.17](#evaluation-order)). Beyond the rules
above, an operand may be any well-typed expression, including one that calls a
choreography function:

```cbs
function ping(): boolean@alice {
    let b: integer@bob = 1@bob;
    let c: integer@alice <- b;
    return true@alice;
}

let c: boolean@alice = false@alice;
let d: boolean@alice = c && ping();   // ping() runs although c is false
```

Their projection is that of any other binary operator (spec [§12.7](#binary-and-unary-operation-projection)).

#### Unary Operators <a id="unary-operators"></a>

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
(spec [§8.2](#local-function-strict-location-rule)), and in a choreography context the operand may be at any single
location.

Examples:

```ts
let x: integer@alice = 1@alice;
let y = -x;               // y : integer@alice
let c = !(x < 10@alice);  // c : boolean@alice
```

Neither operator accepts an array operand, even when the element type would fit
(spec [§16.42](#invalid-unary-operand)):

```ts
let xs: boolean[]@alice = [true]@alice;
let bad = !xs;            // invalid
```

Unary operators bind tighter than every binary operator and than `as`, and are
right associative (spec [§5.14](#expressions)), so `-a * b` is `(-a) * b`, `-a as float` is
`(-a) as float`, and `!!c` is `!(!c)`.

### 7.12 Numeric Conversion <a id="numeric-conversion"></a>

```text
e as integer
e as float
```

A numeric conversion changes the base type of a numeric value. `integer` and
`float` are unrelated (spec [§7.5](#subtyping)), so this is the only way to use a value of one
where the other is expected.

```text
e : S@L          where S is integer or float
(e as T) : T@L   where T is integer or float
```

* The operand must be an `integer` or `float` scalar. `boolean`, `string`,
  `null`, `void` and array operands are rejected (spec [§16.49](#invalid-numeric-conversion)).
* Only the base type changes. The result is located where the operand is, and
  the target carries no location: moving a value between locations is what `<-`
  is for (spec [§7.8](#transfer-typing)). As for a unary operator, the operand must be
  usable in the current context (spec [§8.2](#local-function-strict-location-rule)).
* `T` may be the operand's own type, in which case the conversion changes
  nothing.
* The conversion is carried out by BlueScript's `as` (spec [§13.5](#numeric-conversion-code-generation)), which also
  decides how a `float` becomes an `integer`.
* It is a conversion and not a TypeScript type assertion: no other type may
  follow `as` (spec [§17.2](#typescript-javascript-features)).

Examples:

```ts
let n: integer@alice = 3@alice;
let x: float@alice = n as float;          // x : float@alice
let y = 1.5@alice + (n as float);         // y : float@alice
let m: integer@alice = x as integer;      // m : integer@alice
let bad = 1.5@alice + n as float;         // invalid: (1.5@alice + n) as float
```

The parentheses in `y` are needed because `as` binds more loosely than `+`
(spec [§5.14](#expressions)).

A conversion runs where its operand is. Combined with a transfer, the order of
the two decides which endpoint converts:

```ts
let n: integer@alice = 3@alice;
let x: float@bob <- n as float;       // alice converts, then sends a float

let k: integer@bob <- n;
let y: float@bob = k as float;        // bob converts after receiving an integer
```

### 7.13 Array Typing <a id="array-typing"></a>

#### Array Invariance <a id="array-invariance"></a>

Array types are invariant. `T1[]` is compatible with `T2[]` only when `T1` and `T2` are the same element type.

Therefore, `integer[]` is not compatible with `float[]`.

Disallowed:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: float[]@alice = xs;
```

An array literal is no exception. It is typed on its own, by the array literal typing rule below, and the resulting array type is then checked against the annotation by the same invariance rule.

Disallowed:

```ts
let xs: float[]@alice = [1, 2]@alice;
```

`[1, 2]@alice` is an `integer[]@alice`, and `integer[]` is not compatible with `float[]`. An annotation does not push an expected element type into the literal's elements; write the elements at the element type instead:

```ts
let xs: float[]@alice = [1.0, 2.0]@alice;
```

The one initializer that does take its element type from the annotation is the empty array literal, which has no element type of its own.

#### Array Literal Typing <a id="array-literal-typing"></a>

For an array literal `[e1, ..., en]@L`, each element must be located at `L`. Unlocated literal elements are elaborated to `@L` before type checking. Only unlocated literal elements are elaborated to `@L`; other expressions keep their inferred located types.

The inferred element type of a non-empty array literal is the base type shared by all of its elements. Elements of different base types are invalid; this includes mixing `integer` and `float`, which are unrelated (spec [§7.5](#subtyping)).

Examples:

```ts
let xs = [1, 2, 3]@alice;
// xs : integer[]@alice

let ys = [1.0, 2.5]@alice;
// ys : float[]@alice

let zs = [true, false]@alice;
// zs : boolean[]@alice
```

Disallowed:

```ts
let bad = [1, true]@alice;
let mixed = [1, 2.5]@alice;
```

Write the elements at one type, converting where needed (spec [§7.12](#numeric-conversion)). Only an
element that is itself a bare literal takes the array's location, so a literal
inside a conversion needs its own:

```ts
let ys = [1.0, 2.5]@alice;
let zs = [1@alice as float, 2.5]@alice;
let bad = [1 as float, 2.5]@alice;       // invalid: `1` has no location
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

#### Index Access <a id="index-access"></a>

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

#### Array Element Assignment <a id="array-element-assignment"></a>

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

#### `.length` <a id="array-length"></a>

`xs.length` is a compiler-known array operation (spec [§5.14](#expressions)).

```text
xs : T[]@L
```

then:

```text
xs.length : integer@L
```

In this rule, `T` must be `integer`, `float`, or `boolean`. In particular
`.length` is **not** defined on `string`: v0 has no string operations at all
(spec [§17.2](#typescript-javascript-features)).

#### `.push` <a id="array-push"></a>

`xs.push(v)` is a compiler-known expression (spec [§5.14](#expressions)).

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
program can write or observe (spec [§7.3](#void)). It is a void computation (spec [§7.2](#located-types)):
the only place it can stand is an expression statement, and every value
position rejects it exactly as it rejects a call to a `void` function
(spec [§16.40](#invalid-use-of-void)).

```ts
xs.push(1@alice);            // valid
let n = xs.push(1@alice);    // invalid (spec §invalid-use-of-void)
```

Internally the result still travels with the array's location, which is what
decides the endpoints that perform the append (spec [§12.15](#array-projection)).

In this rule, `T` must be `integer`, `float`, or `boolean`.

#### `@every` Arrays Are Not Special <a id="every-arrays-are-not-special"></a>

The location rule of [§7.6](#location-matching-and-residency) applies to arrays exactly as it does to scalars; there
is no array-specific restriction. This section only spells the rule out for
arrays, because the shared-memory reading of `T[]@every` is the one people
reach for. `T[]@every` is *not* shared memory: each endpoint has its own array
(spec [§3.4](#every)), so there is nothing an individual location could borrow.

An `@every` array therefore cannot be used where an individual-location array is
required, for the same reason a `boolean@every` cannot be used as a
`boolean@alice` (spec [§7.7](#assignment-typing), [§16.7](#invalid-assignment-across-locations)).

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

#### Array Equality <a id="array-equality"></a>

The equality operators `===` and `!==` are not defined for array types.

Disallowed:

```ts
let xs: integer[]@alice = [1]@alice;
xs === xs;
```

### 7.14 Function Call Typing <a id="function-call-typing"></a>

Function calls do not specify locations at the call site.

```ts
add(1@alice, 2@alice)
```

Whether a function call is valid depends on the location of the function definition.

The inferred type of a function call expression is the declared or inferred return type of the called function.


#### Function Argument Typing <a id="function-argument-typing"></a>

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
`P` is an individual location; copy it first with `<-` (spec [§7.6](#location-matching-and-residency)).

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
separate reason, stated in [§8.2](#local-function-strict-location-rule).

#### In a Choreography Context <a id="call-in-a-choreography-context"></a>

The following function calls are allowed:

* calls to choreography functions;
* calls to local functions.

#### In a Local Context <a id="call-in-a-local-context"></a>

Inside `function@alice`, only `@alice` local functions may be called.

The following are disallowed:

* calls to local functions at other endpoints;
* calls to choreography functions.

`.length` and `.push` are array operations, not calls (spec [§5.14](#expressions)), so this rule
does not reach them: they may be used in any context, local or choreography.

### 7.15 Return Typing <a id="return-typing"></a>

When a function has an explicit return type:

```ts
return expr;
```

is allowed if the type of `expr` is compatible with the function return type,
by the same rule as assignment (spec [§7.7](#assignment-typing)): its base type must be a subtype of
the return base type, and its location must match the return location. So a
function declared to return `float@alice` cannot `return 1@alice;`; it can
`return 1@alice as float;` (spec [§7.12](#numeric-conversion)).

```ts
return;
```

is allowed only if the function return type is `void`.

When a function omits its return type, the return type is inferred according to [Section 7.16](#type-inference).

#### Return Coverage <a id="return-coverage"></a>

A function whose return type is not `void` must return a value on every
execution path. This holds whether the return type is written or inferred, and
is checked by the same conservative syntactic analysis in both cases
(spec [§7.16.6](#return-coverage-for-non-void-functions), [§16.41](#missing-return-in-a-non-void-function)).

```ts
function bad@alice(c: boolean@alice): integer@alice {   // invalid (spec §missing-return-in-a-non-void-function)
    if (c) {
        return 1@alice;
    }
}
```

A `void` function needs no coverage: falling off the end is the same as
`return;`.

### 7.16 Type Inference <a id="type-inference"></a>

ChoreoBS Core v0 supports simple, local type inference. This feature does not perform general location inference. It only uses types and locations already determined by literals, identifiers, function signatures, and expression typing.

The compiler should elaborate inferred constructs into a fully typed AST before Endpoint Projection.

#### 7.16.1 Let Type Inference <a id="let-type-inference"></a>

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
let x: float@alice = 1.0@alice;
```

The annotation does not convert the initializer. `let x: float@alice = 1@alice;`
is invalid, because `integer` is not a subtype of `float` (spec [§16.6](#type-mismatch)); the
conversion has to be written: `let x: float@alice = 1@alice as float;`
(spec [§7.12](#numeric-conversion)).

#### Partial Annotations <a id="partial-annotations"></a>

The location may be omitted from the type annotation of an initialized `let`. It
is then taken from the initializer, while the base type comes from the
annotation:

```ts
let a: integer = 3@mcu;   // a : integer@mcu
let b: float = 3.0@mcu;   // b : float@mcu
```

The annotated base type is still checked against the initializer by the
assignment rule (spec [§7.7](#assignment-typing)), so it does not convert the initializer either:

```ts
let b: float = 3@mcu;     // invalid (spec §type-mismatch)
```

A written location always wins, so a mismatch is still reported:

```ts
let c: integer@server = 3@mcu;   // invalid (spec §invalid-assignment-across-locations)
```

This applies to a `for` initializer `let` as well (spec [§7.16.2](#for-initializer-let-type-inference)). It does **not**
apply anywhere there is no initializer to read the location from — function
parameters and return types still require an explicit location (spec [§16.3](#location-annotation-omission)) —
nor to a transfer `let` (spec [§7.16.3](#transfer-let-does-not-infer-destination-type)).

#### 7.16.2 For Initializer Let Type Inference <a id="for-initializer-let-type-inference"></a>

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

#### 7.16.3 Transfer Let Does Not Infer Destination Type <a id="transfer-let-does-not-infer-destination-type"></a>

Transfer declarations keep the existing syntax:

```ts
let y: integer@bob <- x;
```

The type annotation is required, including its location. Unlike an initialized
`let` (spec [§7.16.1](#let-type-inference)), the location is **not** taken from the right-hand side:
the destination location is the whole point of a transfer, and inferring it from
the source would make every transfer a no-op local copy.

The following remain invalid:

```ts
let y <- x;
let y: integer <- x;
```

#### 7.16.4 Function Return Type Inference <a id="function-return-type-inference"></a>

A function declaration may omit its return type:

```ts
function f@L(params) {
    body
}
```

The compiler infers the function return type from `return` statements in the body.

If all returns are bare `return;`, or if there are no return statements, the inferred return type is `void`, which carries no location (spec [§7.3](#void)).

For `return expr;`, the return candidate is the type of `expr`.

For multiple return candidates, the compiler computes their least upper bound using the following rules.

For base types:

```text
lub(T, T) = T
```

All other base type combinations are invalid. In particular, `integer` and
`float` have no LUB, since neither is a subtype of the other (spec [§7.5](#subtyping)).

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
        return 1.5@alice;
    } else {
        return 2.5@alice;
    }
}
```

The return type is inferred as `float@alice`. Had the first branch returned
`1@alice`, the candidates would be `integer@alice` and `float@alice`, which have no
LUB, and the function would be rejected (spec [§16.21](#incompatible-inferred-return-types)); returning
`1@alice as float` there would be accepted (spec [§7.12](#numeric-conversion)).

#### 7.16.5 Mixing `return;` and `return expr;` <a id="mixing-return-and-return-expr"></a>

A function with an omitted return type must not mix bare `return;` and value-returning `return expr;`.

#### 7.16.6 Return Coverage for Non-`void` Functions <a id="return-coverage-for-non-void-functions"></a>

If a function with an omitted return type contains any `return expr;`, then all execution paths must return a value. The same requirement applies to a function with a written non-`void` return type (spec [§7.15](#return-typing)).

Core v0 requires only a conservative syntactic return coverage analysis. At minimum, an implementation must accept:

- a final `return expr;` statement in the function body;
- an `if (...) { ... } else { ... }` statement where both branches are definitely returning;
- nested combinations of the above.

The compiler may reject programs whose totality is not proven by this conservative analysis.

#### 7.16.7 Parameter Types Are Not Inferred <a id="parameter-types-are-not-inferred"></a>

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

#### 7.16.8 Inference and Recursion <a id="inference-and-recursion"></a>

Local function recursion is allowed, but recursive local functions must have explicit return types in Core v0.

Therefore:

- direct or indirect recursive local functions with omitted return types are compile-time errors;
- direct or indirect recursive local functions with explicit return types are allowed;
- choreography recursion remains unsupported.

***

## 8. Location Annotation Rules <a id="location-annotation-rules"></a>

### 8.1 Explicit Location Annotations <a id="explicit-location-annotations"></a>

Every type annotation and every literal must carry its own location annotation,
except on an initialized `let`, where the location is taken from the initializer
(spec [§7.16.1](#let-type-inference)).

`void` is outside this rule rather than an exception to it: it has no value to
place, so it takes no location annotation at all, and writing one is an error
(spec [§7.3](#void), [§16.40](#invalid-use-of-void)).

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
    let y: integer = 1@alice;        // valid: y : integer@alice (§let-type-inference)
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
declares a choreography function (spec [§10.1](#function-kinds)) — so neither form is an omission.

This rule governs location annotations only. It does not affect **type**
inference ([§7.16](#type-inference)), which is a separate mechanism:

```ts
let x = 1@alice;   // valid: `x : integer@alice` is inferred from the initializer
```

and a function may still omit its return type entirely, in which case the return
type — including its location — is inferred from the `return` statements ([§7.16.4](#function-return-type-inference)).

```ts
function f@alice(a: integer@alice) {   // valid: returns@alice integer@alice
    return a;
}
```

Nor does it affect the filling of unlocated literal elements of an array literal
from that literal's **own** annotation ([§5.16](#array-literals)), which reads no context:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;   // valid
```

### 8.2 Local Function Strict Location Rule <a id="local-function-strict-location-rule"></a>

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
- The explicit or inferred return type of a local function must be located at `P`, unless it is `void`, which has no location (spec [§7.3](#void)) and is allowed in a local function like any other.
- A return type explicitly or implicitly located at another individual location `Q`, where `Q != P`, is a compile-time error.
- A return type explicitly or implicitly located at `every` is a compile-time error.
- Every **value** expression evaluated inside the local function body must have a type located at `P`. A void computation has no location to check (spec [§7.2](#located-types)); a call to a local `void` function is instead governed by [§10.3](#calling-functions-from-a-local-context), which already restricts a local body to calling local functions at `P`.
- Every variable declared in the local function body must have a type located at `P`. This includes the destination type of a transfer `let`, which is a declaration and not an expression.
- Values located at `every` are not allowed inside local function bodies.
- Values located at another individual location are not allowed inside local function bodies.
- A transfer inside a local function has the function's own location on both sides, so it is always a local copy (spec [§11.4](#local-copy)). This follows from the rules above rather than being a separate restriction: the source must be an expression at `P`, and the destination must be a variable at `P`.

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

### 8.3 `@every` Literals <a id="every-literals"></a>

`@every` literals are allowed in choreography contexts.

```ts
true@every
1@every
"ok"@every
null@every
```

`@every` literals are not allowed inside local function bodies, because local functions use the Local Function Strict Location Rule.

## 9. Statements and Expressions <a id="statements-and-expressions"></a>

### 9.1 Semicolons <a id="semicolons"></a>

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
inside them: every literal carries its own location (spec [§8.1](#explicit-location-annotations)), and `return`
only appears inside a function (spec [§5.12](#return-statement)).

### 9.2 Let Statements <a id="let-statements"></a>

Only initialized `let` declarations are allowed.

```ts
let x: integer@alice = 1@alice;
```

Transfer declarations are also allowed.

```ts
let y: integer@bob <- x;
```

### 9.3 Assignment Statements <a id="assignment-statements"></a>

Assignment is a statement only.

```ts
x = y;
```

Assignments do not produce values.

### 9.4 Transfer Statements <a id="transfer-statements"></a>

A transfer is a statement only.

```ts
y <- x;
```

Transfer statements do not produce values.

### 9.5 If Statements <a id="if-statements"></a>

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

### 9.6 While Statements <a id="while-statements"></a>

`while` is a statement.

```ts
while (c) {
    // body
}
```

### 9.7 For Statements <a id="for-statements"></a>

Only C-style `for` loops are supported.

```ts
for (let i = 0@every; i < 10@every; i = i + 1@every) {
    // body
}
```

`for-of` and `for-in` are not supported.

### 9.8 Break and Continue <a id="break-and-continue"></a>

`break` and `continue` are not supported in v0.

### 9.9 Expression Statements <a id="expression-statements"></a>

Expression statements are allowed. The expression need not have an effect:
`xs[0@alice];` and `xs.length;` are legal, if pointless. v0 performs no
dead-code elimination (spec [§17.7](#future-cleanup-optimizations)) and singles out no expression form here.

After EPP, expressions unrelated to the current endpoint may be transformed into `nothing(...)` or `null`.

These compiler-generated artifacts are cleaned up by the Projected AST Cleanup pass defined in [Section 13.12](#projected-ast-cleanup).

`xs.push(v);` is an expression statement like any other. Its expression is a
void computation (spec [§7.2](#located-types), [§7.13](#array-typing)), so this is the only position it may
stand in; using it as a subexpression or an initializer is a type error
(spec [§16.40](#invalid-use-of-void)).

***

## 10. Function Rules <a id="function-rules"></a>

### 10.1 Function Kinds <a id="function-kinds"></a>

ChoreoBS has two kinds of functions, distinguished by how many endpoints run
them.

A local function runs at the single endpoint named by its location. A
choreography function runs at **every** endpoint: each endpoint executes its own
projection of it (spec [§12.11](#function-projection)). The two are separate kinds, not one derived from
the other — a choreography function is not a local function with something left
out. Since it is not the function of any one endpoint, no single location names
it, and its declaration carries none.

#### Choreography Function <a id="choreography-function-kind"></a>

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
- May call choreography functions and local functions (spec [§10.2](#calling-local-from-choreography)).
- Allows return type inference.
- Recursion, direct or mutual, is not supported in v0 (spec [§10.4](#recursion)).

A location on a function declaration names the one endpoint that runs the
function, so it always declares a local function and must be an individual
location; `@every` is not a function location (spec [§16.39](#every-on-a-function-declaration)). `@every` remains
available as a value location, e.g. `boolean@every`.

#### Local Function <a id="local-function-kind"></a>

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
- May call only local functions at the same endpoint (spec [§10.3](#calling-functions-from-a-local-context)).
- May contain transfers, but both sides are necessarily at the function's own
  location, so a transfer there is always a local copy (spec [§11.4](#local-copy)).
- Allows return type inference.
- Recursion is allowed only when the recursive function has an explicit return type.

### 10.2 Calling Local Functions from a Choreography Context <a id="calling-local-from-choreography"></a>

A choreography context may call local functions. At endpoints where the function's location does not match, the callee is not generated and the call projects to `nothing(...)` over its arguments (spec [§12.11](#function-projection)). It is removed by cleanup when none of those arguments holds a computation this endpoint owes (spec [§13.12](#projected-ast-cleanup)).

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
make and the binding has nowhere to go (spec [§12.3](#expression-projection)):

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

### 10.3 Calling Functions from a Local Context <a id="calling-functions-from-a-local-context"></a>

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

### 10.4 Recursion <a id="recursion"></a>

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

## 11. Transfer Semantics <a id="transfer-semantics"></a>

### 11.1 Transfer Operator <a id="transfer-operator"></a>

```ts
a <- b;
```

means:

> Copy the value of `b` to the location of `a`, then store it in `a`.

Depending on the source and destination locations, this is one of:

* direct communication between two different individual locations;
* broadcast from one individual location to `@every`;
* a local copy, when the destination already holds the source payload
  (spec [§11.4](#local-copy)).

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
```

Meaning:

```text
alice -> bob: x
```

### 11.2 Direct Communication <a id="direct-communication"></a>

If the source and destination are different individual locations, direct communication is used.

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
```

EPP at `alice`:

```ts
let x: integer = 10;
sendInteger("bob", "__top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "__top_0");
```

### 11.3 Broadcast Communication <a id="broadcast-communication"></a>

If the destination is `@every` and the source is an individual location, the communication is treated as a broadcast.

```ts
let x: boolean@alice = true@alice;
let c: boolean@every <- x;
```

EPP at `alice`:

```ts
let x: boolean = true;
broadcastBoolean("__top_0", x);
let c: boolean = x;
```

EPP at `bob`:

```ts
let c: boolean = receiveBoolean("alice", "__top_0");
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
broadcastFloatArray("__top_0", xs);
let ys: float[] = cloneFloatArray(xs);
```

### 11.4 Local Copy <a id="local-copy"></a>

When the destination already holds the source payload, `<-` performs no network
communication. It is a local copy instead. This covers three cases (spec [§7.8](#transfer-typing)):

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

### 11.5 Communication Tags <a id="communication-tags"></a>

Each transfer that performs communication — that is, each `direct` or `broadcast` transfer — is assigned a static tag. A local copy performs no communication and is given no tag (spec [§11.4](#local-copy)).

Tags have the following properties:

* They are unique within a compilation unit. Uniqueness within a function is not enough: two communications in different functions could otherwise share a tag and be in flight at the same time. The recommended format below achieves this because function names are global (spec [§6.2](#function-names)), and because the top-level scope name carries the compiler-reserved `__` prefix, which no function name may take (spec [§4.3](#identifiers), [§6.2](#function-names)). A scope name is therefore either a function's name or `__top`, and the two can never be the same.
* They are stable within the same compilation unit.
* Implementations may choose any string format.

A tag identifies a *communication in the program*, not a single message. The
same tag is reused by every execution of that communication — on each iteration
of a loop, and on each call of the function containing it (spec [§15.5](#example-while-with-transfer)).

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
__top_0
__top_1
foo_0
foo_1
```

***

## 12. Endpoint Projection <a id="endpoint-projection"></a>

### 12.1 Definition <a id="epp-definition"></a>

Endpoint Projection, EPP, transforms a ChoreoBS program into a BlueScript program for each endpoint.

```text
EPP(program, endpoint) -> BlueScript program
```

Before EPP, all inferred types must be elaborated into explicit located types in the internal AST.

### 12.2 Type Projection <a id="type-projection"></a>

Projection of a located type `T@L` to endpoint `P` is:

```text
if residesAt(L, P):
    T
else:
    absent
```

`void` has no location (spec [§7.3](#void)) and is never absent: it projects to `void` at
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

### 12.3 Expression Projection <a id="expression-projection"></a>

Two questions have to be kept apart, and conflating them is the single easiest
way to get EPP wrong:

* **where a value resides** — which endpoints hold a copy of the result; and
* **where a computation must execute** — which endpoints have to run it.

For most expression forms the two coincide. They come apart at a call: a
choreography function runs at every endpoint (spec [§12.11](#function-projection)), so `P` must execute
the call even when the result lives somewhere else entirely.

#### The Rule <a id="expression-projection-rule"></a>

Projection is a structural recursion over the expression, and it has two modes.
Which one applies is decided by whoever asks for the projection, not by the
expression:

```text
project_P(e)    the value projection: what P computes when it needs e's value
discard_P(e)    the evaluation-only projection: what P still runs when it does not
```

`project_P` is the one the source's own value positions use. For an expression
`e : T@L` at endpoint `P`:

```text
project_P(e : T@L) =
    if residesAt(L, P):  keep the form, projecting each subexpression with project_P
    else:                discard_P(e)
```

`discard_P` is the whole of the difference. `P` has no value to apply the
operator or the callee to, so neither is reproduced. What *is* reproduced is
the evaluation of the operands, structurally and in source order, collected in
a compiler-generated `nothing(...)` that evaluates each one exactly once,
discards their values and yields `null` (spec [§14.1](#nothing)).

**`discard_P` is defined on the form of `e` alone, and never consults
`residesAt`.** Once a result is being discarded, a subexpression whose value
happens to reside at `P` is still only evaluated, never handed back as a value.
A call's arguments are the one exception, since the call does want those
values: they are projected with `project_P`, and each then decides for itself.

```text
binary:               e1 op e2    =>  nothing(discard(e1), discard(e2))
unary:                op e        =>  nothing(discard(e))
conversion:           e as T      =>  discard(e)
parenthesized:        ( e )       =>  discard(e)
index:                xs[i]       =>  nothing(discard(xs), discard(i))
length:               xs.length   =>  nothing()
push:                 xs.push(v)  =>  nothing(discard(v))
array literal:        [e1, ...]   =>  nothing(discard(e1), ...)
call, callee here:    f(e1, ...)  =>  f(project(e1), ...)
call, callee absent:  f(e1, ...)  =>  nothing(project(e1), ...)
literal, identifier:                  absent
```

The statement forms that discard a result name `discard_P` directly: a `let`
whose binding is absent here ([§12.8](#let-projection)), an assignment whose
target is ([§12.10](#assignment-projection)), a `for` header slot
([§12.14](#for-projection)), and — the one case where the expression's own
residency is beside the point — the source of a transfer at every endpoint
that is not its sender ([§12.9](#transfer-projection)).

A statement that discards a single expression keeps that expression's
projection as it stands. `nothing(...)` appears only where two or more
expressions have to be held in one slot (spec [§12.10](#assignment-projection)),
or where a form has no operands left to hold — `xs.length`, and a call to an
absent function with no arguments.

A call whose callee `P` does generate is kept as a call, not wrapped: the
projected callee returns `null` at `P` (spec [§12.2](#type-projection)), so the call already stands
in for the absent value wherever one is needed. A call whose callee `P` does
not generate — a local function at another endpoint — disappears, but its
arguments do not: they are ordinary expressions that may contain choreography
calls of their own. With no arguments that leaves `nothing()`, which cleanup
removes (spec [§13.12](#projected-ast-cleanup)).

The binary row covers `&&` and `||` as well. They do not short-circuit
(spec [§5.17](#evaluation-order)), so hoisting both operands into one `nothing(...)` runs
exactly what the original runs.

`.length` drops its receiver where `xs[i]` keeps its own, because the two are
not the same kind of operand. The receiver of `.length` must be a variable
(spec [§5.14](#expressions)), so reading it cannot call anything and there is nothing to
preserve; that leaves `nothing()`, which cleanup removes (spec [§13.12](#projected-ast-cleanup)). The
receiver of `[]` is an arbitrary expression — `f()[i]` is well-formed — and may
hold a choreography call, so it is reproduced like any other operand.

`xs.push(v)` is `void`, so it never stands in a value position (spec
[§7.2](#located-types), [§16.40](#invalid-use-of-void)); the only place it occurs
is as an expression statement. Its result still travels with the array's
location (spec [§7.13](#array-typing)), so at an endpoint that does not hold the
array `project_P` falls through to the `push` row above — which is exactly the
statement rule [§12.10](#assignment-projection) states. It drops its receiver for
the same reason `.length` does.

Nested `nothing(...)` artifacts are left nested. Flattening them is not part of
Core v0 (spec [§13.12](#projected-ast-cleanup), [§17.7](#future-cleanup-optimizations)).

#### Why the Operands Are Enough <a id="why-the-operands-are-enough"></a>

Whenever a composite expression's result is absent at `P`, the subexpressions
that carry its value are absent at `P` too — the type rules leave no room for
anything else:

* both operands of a binary operator are at one location, and so is the result
  (spec [§7.11](#operators));
* the operand of a unary operator or of a numeric conversion is where the result
  is (spec [§7.11](#operators), [§7.12](#numeric-conversion));
* an index expression is at its array's location (spec [§16.37](#invalid-array-index-location));
* a local function's parameters are at its own endpoint (spec [§16.25](#invalid-local-function-parameter-location)), and
  arguments must match (spec [§16.28](#invalid-function-argument-location));
* a `let` and a simple assignment have one location on both sides (spec [§7.7](#assignment-typing)).

So a `nothing(...)` built this way holds only `absent` leaves and calls `P`
must make. Nothing resident is discarded, and cleanup's deliberately blunt rule
— fold only when every argument is syntactically `null` — loses nothing
(spec [§13.12](#projected-ast-cleanup)).

A transfer is the one place a location boundary is crossed on purpose, so its
source needs the rule stated separately; see [§12.9](#transfer-projection).

#### Calls Survive an Absent Result <a id="calls-survive-an-absent-result"></a>

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

#### A Discarded Result Is Not a Discarded Call <a id="a-discarded-result-is-not-a-discarded-call"></a>

Where the projected expression sits in a statement whose value has nowhere to go
at `P`, the statement becomes an evaluation-only expression statement ([§12.8](#let-projection),
[§12.9](#transfer-projection), [§12.10](#assignment-projection)). No wrapper is added on top of what projection already produced:

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
disappears entirely (spec [§13.12](#projected-ast-cleanup)).

#### Positions With No Room for a Statement <a id="positions-with-no-room-for-a-statement"></a>

A call argument, a `return` value and a `for` header slot are expressions, not
statements. Nothing special is needed there: the projection of [§12.3](#expression-projection) is already
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

### 12.4 Absent <a id="absent"></a>

`absent` is an internal intermediate representation used only during EPP.

* It does not exist in the source language.
* It is distinct from source-level `null`.
* It is never emitted to final BlueScript output.
* It is turned into `null` by absent finalization, a stage of its own that runs
  after EPP and before cleanup (spec [§13.10](#absent-finalization)).

`absent` and the compiler-generated `nothing(...)` (spec [§14.1](#nothing)) are different
artifacts and are kept apart. `absent` marks a value that does not exist here;
`nothing(...)` preserves computations whose result is discarded. EPP produces
both, finalization rewrites the first, and cleanup folds the second
(spec [§13.12](#projected-ast-cleanup)).

### 12.5 Literal Projection <a id="literal-projection"></a>

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

### 12.6 Identifier Projection <a id="identifier-projection"></a>

For variable `x : T@L`, projection to endpoint `P` is:

```text
if residesAt(L, P):
    x
else:
    absent
```

### 12.7 Operator and Conversion Projection <a id="binary-and-unary-operation-projection"></a>

Every binary operator — `+ - * / %`, `< <= > >=`, `=== !==` and `&& ||` —
always evaluates both operands (spec [§5.17](#evaluation-order)). Where the result resides at
`P`, the operator is preserved:

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
evaluated, in order (spec [§12.3](#expression-projection)):

```text
discard_P(e1 op e2) = nothing(discard_P(e1), discard_P(e2))
discard_P(op e)     = nothing(discard_P(e))
```

EPP at `bob` — both operands are literals there, so the statement simplifies to
`null` and disappears (spec [§13.12](#projected-ast-cleanup)):

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

#### Logical Operators <a id="logical-operator-projection"></a>

`&&` and `||` follow the rule above with no exception. Since they do not
short-circuit, hoisting both operands into `nothing(...)` where the result is
absent runs exactly what the original runs. Written out, with the residing side
in the spelling code generation gives it (spec [§13.4](#logical-operator-code-generation)):

```text
project_P(e1 && e2 : boolean@L) =
    if residesAt(L, P):  __and(project_P(e1), project_P(e2))
    else:                nothing(discard_P(e1), discard_P(e2))

project_P(e1 || e2 : boolean@L) =
    if residesAt(L, P):  __or(project_P(e1), project_P(e2))
    else:                nothing(discard_P(e1), discard_P(e2))
```

There is one rule for every context. In a local function body every value
resides at the function's own endpoint (spec [§8.2](#local-function-strict-location-rule)), so the first
branch is the only one taken there.

An operand may call a choreography function (spec [§7.11](#operators)):

```cbs
function ping(): boolean@alice {
    let b: integer@bob = 1@bob;
    let c: integer@alice <- b;
    return true@alice;
}

let c: boolean@alice = false@alice;
let d: boolean@alice = c && ping();
```

EPP at `alice`:

```ts
let c: boolean = false;
let d: boolean = __and(c, ping());
```

EPP at `bob` — the binding is absent, but `ping()` still runs, so `bob` takes
part in the communication inside it:

```ts
nothing(null, ping());
```

#### Numeric Conversion Projection <a id="numeric-conversion-projection"></a>

A conversion is kept, as BlueScript's `as`, where its result resides. Where it
does not, nothing of the conversion is emitted — not even the `nothing(...)` a
unary operator leaves. Like parentheses, a conversion contributes nothing of its
own, so only the operand's evaluation remains (spec [§12.3](#expression-projection)).

```text
project_P(e as T : T@L) =
    if residesAt(L, P):  project_P(e) as T
    else:                discard_P(e)
```

The result is located where the operand is (spec [§7.12](#numeric-conversion)), so wherever the
result resides the operand does too, and a conversion is never applied to the
`null` that stands in for an absent value.

```cbs
function relay(v: integer@alice): integer@alice {
    let w: integer@bob <- v;
    let back: integer@alice <- w;
    return back;
}

let n: integer@alice = 3@alice;
let x: float@alice = n as float;
let y: float@alice = relay(n) as float;
```

EPP at `alice`:

```ts
let n: integer = 3;
let x: float = (n as float);
let y: float = (relay(n) as float);
```

EPP at `bob` — `x` disappears altogether, and of `y` only the call remains,
bare, where the unary `-relay(x)` above leaves `nothing(relay(null))`:

```ts
relay(null);
```

### 12.8 Let Projection <a id="let-projection"></a>

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
project_P(let x = e;) = discard_P(e);
```

A `let` in a `for` header is the exception: it keeps its binding at every
endpoint, because the name has to stay declared for the rest of the header
(spec [§12.14](#for-projection)).

EPP at `bob` — the initializer is a literal, so the statement simplifies to
`null` and disappears (spec [§13.12](#projected-ast-cleanup)):

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

### 12.9 Transfer Projection <a id="transfer-projection"></a>

#### The Source Is Evaluated at Every Endpoint <a id="the-source-is-evaluated-at-every-endpoint"></a>

A transfer crosses a location boundary on purpose, so [§12.3](#expression-projection)'s reasoning about
subexpressions does not carry over to it: the source expression belongs to the
sender's location, but the computations inside it may not.

> A transfer's source expression is evaluated exactly once at **every** endpoint
> that evaluates the statement, and before that endpoint's own send, receive or
> copy.

The sender evaluates it as the payload, with `project_P`. Every other endpoint
evaluates it for its computations alone, as `discard_P(source)` standing as an
expression statement placed *before* the receive, so that the calls inside it
meet the sender's in the same order.

`discard_P` is what makes this work in both directions. The source belongs to
the sender's location, but a source at `@every` resides at every endpoint, and
a receiver has no use for its value either way — it is about to receive one.
Because `discard_P` never consults `residesAt`
(spec [§12.3](#expression-projection)), the source is reduced to its
computations at every non-sender alike, whatever its location.

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
sendInteger("bob", "__top_0", g());
```

EPP at `bob`:

```ts
g();
let y: integer = receiveInteger("alice", "__top_0");
```

Omitting `g()` at `bob` would leave `alice` blocked inside `g` forever. The same
holds at every receiver of a broadcast, and at endpoints the transfer skips
altogether.

Where `discard_P` of the source yields `null` — that is, where the source holds
no call this endpoint has to make — the statement disappears in cleanup
(spec [§13.12](#projected-ast-cleanup)), which is why the ordinary cases below
show no extra statement. A bare identifier or literal source is the common
case: it discards to `absent`, and so to `null`.

Where the source value has to be used more than once at the sender — a
broadcast, which both sends and keeps its own copy — a compiler-generated
temporary holds it so that it is still evaluated exactly once (spec [§7.8](#transfer-typing)).

#### Direct Communication <a id="epp-direct-communication"></a>

```ts
let y: integer@bob <- x;
```

where `x : integer@alice`.

EPP at `alice`:

```ts
sendInteger("bob", "__top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "__top_0");
```

#### Broadcast <a id="epp-broadcast"></a>

For individual-to-`@every` communication, EPP generates a broadcast at the sender and a receive at all other endpoints.

For array broadcast, the sender-side `@every` binding is a fresh mutable copy.

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@every <- xs;
```

EPP at `alice`:

```ts
let xs: integer[] = [1, 2];
broadcastIntegerArray("__top_0", xs);
let ys: integer[] = cloneIntegerArray(xs);
```

EPP at `bob`:

```ts
let ys: integer[] = receiveIntegerArray("alice", "__top_0");
```

#### Local Copy <a id="epp-local-copy"></a>

When the destination already holds the source payload (spec [§11.4](#local-copy)), the transfer is projected as a local copy at each endpoint the destination resides at. No `send`, `receive`, `broadcast`, or communication tag is generated.

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

#### Transfer Declaration Versus Transfer Assignment <a id="transfer-decl-vs-assignment"></a>

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
sendInteger("bob", "__top_0", src);
let e: integer = 0;
broadcastInteger("__top_1", src);
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
d = receiveInteger("alice", "__top_0");
let e: integer = 0;
e = receiveInteger("alice", "__top_1");
```

A receiver must not re-declare the destination — `let d: integer = receive...`
would shadow the variable the program meant to update. For an array, the
assignment replaces the destination's reference with the fresh clone, which is
what makes `<-` differ from `=` at one location (spec [§7.8](#transfer-typing)).

#### Single Evaluation at the Sender <a id="single-evaluation-at-the-sender"></a>

A broadcast uses the source value twice at the sender, so when the source is not
already a simple reference EPP binds it to a temporary and uses that in both
places (spec [§7.8](#transfer-typing)). Temporaries are named with the reserved `__` prefix
(spec [§6.2](#function-names)), so they cannot capture a program name.

```ts
function nextValue(): integer@alice {
    return 1@alice;
}

let n: integer@every <- nextValue();
```

EPP at `alice`:

```ts
let __transfer_0: integer = nextValue();
broadcastInteger("__top_0", __transfer_0);
let n: integer = __transfer_0;
```

Without the temporary the sender would call `nextValue()` twice and could
broadcast one value while keeping another. A source that is already an
identifier or a literal is used directly, since re-reading it cannot call
anything.

### 12.10 Assignment Projection <a id="assignment-projection"></a>

```ts
x = y;
```

EPP to endpoint `P`:

* If `x` resides at `P`, generate the assignment.
* Otherwise, drop the store but keep the right-hand side's evaluation:

```text
project_P(x = e;) = discard_P(e);
```

For an array element assignment `xs[i] = v;`, the assignment is generated only
where `xs` resides. Where it does not, the store goes and both remaining
expressions are kept, in the order [§5.17](#evaluation-order) evaluates them — index first, then
value:

```text
project_P(xs[i] = v;) = nothing(discard_P(i), discard_P(v));
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
and elsewhere only the argument's evaluation is left behind (spec [§12.15](#array-projection)):

```text
project_P(xs.push(v);) = nothing(discard_P(v));
```

The receiver is dropped in both rules for the same reason, and in `xs.length`
for that reason too (spec [§12.3](#expression-projection)). `xs` is a variable — the grammar admits
nothing else as an assignment target or as the receiver of `.length` and
`.push` (spec [§5.14](#expressions)) — so reading it cannot call anything, and there is no
evaluation to preserve. Reproducing it would leave a `null` argument that
carries no computation and that cleanup cannot fold away once a sibling
argument holds one (spec [§13.12.2](#expression-simplification)).

### 12.11 Function Projection <a id="function-projection"></a>

#### Local Function <a id="epp-local-function"></a>

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
they are ordinary expressions and may hold choreography calls (spec [§12.3](#expression-projection)).

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
by cleanup (spec [§13.12](#projected-ast-cleanup)). A call names no location
(spec [§7.14](#function-call-typing)), so this is an ordinary call to a
`localFunction` declared at `mcu`, projected at `server`:

```ts
localFunction();
```

```text
nothing();  =>  null;  =>  removed
```

#### Choreography Function <a id="epp-choreography-function"></a>

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
communicate (spec [§12.3](#expression-projection)). A `void` call has no result to reside anywhere and is
likewise never removed for want of one.

### 12.12 If Projection <a id="if-projection"></a>

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

### 12.13 While Projection <a id="while-projection"></a>

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

### 12.14 For Projection <a id="for-projection"></a>

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

#### Absent Header Clauses <a id="absent-header-clauses"></a>

A `let` in the header keeps its binding at every endpoint, as `null` where the
value is absent (spec [§12.2](#type-projection)), so the name stays declared.
This is the one place a `let` binding survives its value; a `let` *statement*
drops the binding instead (spec [§12.8](#let-projection)).

An assignment clause has no such fallback: the variable it assigns to may not
exist at this endpoint at all, and a header slot holds an expression, not the
*statement* that [§12.10](#assignment-projection) would produce. The clause therefore keeps just
`discard_P` of the expressions it evaluated — the same `nothing(...)` [§12.10](#assignment-projection)
builds, sitting in the slot as an expression. Once that simplifies to `null`,
the slot is **omitted** entirely (spec [§13.12](#projected-ast-cleanup)). The compiler must not emit an
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

If the clause's expressions still hold a call `bob` has to make (spec [§12.3](#expression-projection)),
the slot keeps it instead of disappearing.

The condition slot is not optional and is never replaced by `null`: it needs a
boolean value, which the typing rules of [§7.9](#if-condition-typing) and [§7.10](#while-and-for-condition-typing) already guarantee is
available at every endpoint.

### 12.15 Array Projection <a id="array-projection"></a>

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
(spec [§12.3](#expression-projection), [§12.10](#assignment-projection)), and since all of them are literals here, everything
simplifies to `null` and disappears (spec [§13.12](#projected-ast-cleanup)):

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
sendIntegerArray("bob", "__top_0", xs);
```

EPP at `bob`:

```ts
let ys: integer[] = receiveIntegerArray("alice", "__top_0");
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
broadcastIntegerArray("__top_0", xs);
let ys: integer[] = cloneIntegerArray(xs);
```

EPP at `bob`:

```ts
let ys: integer[] = receiveIntegerArray("alice", "__top_0");
```

### 12.16 Top-Level Projection <a id="top-level-projection"></a>

Top-level non-function statements are projected as the entry program for each endpoint.

Input:

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
```

EPP at `alice`:

```ts
let x: integer = 10;
sendInteger("bob", "__top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "__top_0");
```

***

## 13. BlueScript Code Generation <a id="bluescript-code-generation"></a>

### 13.1 Type Mapping <a id="type-mapping"></a>

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

### 13.2 Location Annotation Removal <a id="location-annotation-removal"></a>

BlueScript output does not contain location annotations.

```ts
let x: integer@alice = 1@alice;
```

EPP at `alice`:

```ts
let x: integer = 1;
```

### 13.3 Array Operation Code Generation <a id="array-operation-code-generation"></a>

`xs.length` and `xs.push(v)` are emitted unchanged: BlueScript spells them the
same way ChoreoBS does, so code generation for these two is the identity.

```ts
xs.length
xs.push(v)
```

These two are the whole of ChoreoBS's dot syntax. A program cannot access a
field or call a method on anything else (spec [§17.2](#typescript-javascript-features)).

### 13.4 Logical Operator Code Generation <a id="logical-operator-code-generation"></a>

The projected IR keeps `&&` and `||` as binary operations. Code generation
spells them as calls to the runtime helpers `__and` and `__or`
(spec [§14.3](#and-or-helpers)):

```text
e1 && e2  =>  __and(e1, e2)
e1 || e2  =>  __or(e1, e2)
```

They cannot be emitted unchanged, as the arithmetic operators are, because
BlueScript's `&&` and `||` short-circuit and ChoreoBS's do not
(spec [§5.17](#evaluation-order)). A call evaluates both of its arguments, left to right, before
the helper runs, which is exactly the evaluation ChoreoBS prescribes. The
spelling is the same whatever the operands are, including in a local
function.

### 13.5 Numeric Conversion Code Generation <a id="numeric-conversion-code-generation"></a>

A projected conversion is emitted as BlueScript's own `as`, in parentheses:

```text
e as T  =>  (e as T)
```

The parentheses keep the conversion together whatever operator surrounds it.
A conversion the source already parenthesizes is not wrapped a second time:
`total / (n as float)` is emitted as written.

Only an endpoint that holds the value emits one (spec [§12.7](#binary-and-unary-operation-projection)); where the value
is absent there is no `as` at all, so `null as T` is never emitted.

### 13.6 Function Names <a id="codegen-function-names"></a>

Generated function names are the same as the original ChoreoBS function names.
Because there is no renaming, the names the generated code relies on are
reserved in the source language (spec [§6.2](#function-names)).

```ts
function add@alice(...)
```

EPP at `alice`:

```ts
function add(...)
```

### 13.7 Output File Naming <a id="output-file-naming"></a>

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

### 13.8 Local Functions <a id="codegen-local-functions"></a>

A local function is emitted only for the corresponding endpoint.

### 13.9 Choreography Functions <a id="codegen-choreography-functions"></a>

A choreography function is emitted for all endpoints.

### 13.10 Absent Finalization <a id="absent-finalization"></a>

Absent finalization is a stage of its own, between endpoint projection and
cleanup:

```text
Typed AST
  -> Endpoint Projection
  -> Projected IR containing absent and nothing(...)
  -> Absent finalization
  -> Projected IR containing null and nothing(...)
  -> Bottom-up cleanup (spec §projected-ast-cleanup)
  -> BlueScript emission
```

It does exactly one thing: every remaining `absent` leaf becomes `null`
(spec [§12.4](#absent)).

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
cleanup pass in [Section 13.12](#projected-ast-cleanup).

### 13.11 Communication API <a id="communication-api"></a>

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
[§7.1.1](#array-types)), so there is no array form of the `null` API.

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
* local copies produced by a transfer (spec [§11.4](#local-copy)).

APIs:

```ts
cloneIntegerArray(value: integer[]): integer[];
cloneFloatArray(value: float[]): float[];
cloneBooleanArray(value: boolean[]): boolean[];
```

### 13.12 Projected AST Cleanup <a id="projected-ast-cleanup"></a>

After absent finalization (spec [§13.10](#absent-finalization)) and before BlueScript code generation, the compiler performs a cleanup pass over the projected AST.

The purpose of this pass is to remove or simplify compiler-generated artifacts such as unnecessary `null` statements and `nothing(...)` expressions.

This cleanup pass must operate on the projected AST or projected IR. It must not be implemented as string-based post-processing over generated BlueScript code.

#### 13.12.1 A Single Bottom-Up Pass <a id="a-single-bottom-up-pass"></a>

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

An `absent` reaching this pass is an internal error (spec [§13.10](#absent-finalization)).

#### 13.12.2 Expression Simplification <a id="expression-simplification"></a>

The only rule is:

```text
nothing(null, ..., null) => null
nothing()                => null
```

It applies only when, after recursively simplifying all arguments, every
argument of `nothing(...)` is exactly `null`. The zero-argument case is included:
it arises when a call to a local function with no parameters is projected to an
endpoint that does not generate that function (spec [§12.11](#function-projection)).

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

#### 13.12.3 Nested `nothing(...)` Is Not Flattened <a id="nested-nothing-is-not-flattened"></a>

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
runtime checks later. Flattening is listed under [§17.7](#future-cleanup-optimizations).

#### 13.12.4 Simplification Inside Function Arguments <a id="simplification-inside-function-arguments"></a>

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

#### 13.12.5 Statement Cleanup <a id="statement-cleanup"></a>

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
(spec [§12.14](#for-projection)). A binding or a real assignment in the header stays.

None of these are removed, however much `null` they carry:

```ts
return null;
let x = null;
x = null;
f(null);
```

#### 13.12.6 What This Cleanup Pass Must Not Remove <a id="what-this-cleanup-pass-must-not-remove"></a>

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
may communicate (spec [§12.3](#expression-projection)). So these stay as they are:

```text
nothing(f(), null)
nothing(null, g())
nothing(nothing(f()), null)
```

It must not remove communication operations such as:

```ts
sendInteger("bob", "__top_0", x);
receiveInteger("alice", "__top_0");
broadcastBoolean("__top_1", c);
```

It must not remove assignments, loops, conditionals, or function declarations merely because they contain `null` values.

Core v0 cleanup performs none of the following, and must not be extended with
them without revisiting [§12.3](#expression-projection):

* purity analysis;
* side-effect analysis;
* return-value equivalence analysis;
* general dead-code elimination;
* removal of ordinary function calls.

#### 13.12.7 Source-Level `null` <a id="source-level-null"></a>

A `null` that came from a source-level `null` literal and a `null` produced by
absent finalization are the same node by the time cleanup runs, and are treated
alike. A statement that is exactly `null;` has no effect in either case, so
removing it is sound.

***

## 14. Runtime Support Functions <a id="runtime-support-functions"></a>

### 14.1 `nothing` <a id="nothing"></a>

`nothing(e1, ..., en)` is a compiler-generated artifact, not a user-callable
function and not an ordinary call. It is the projected IR node that preserves
the evaluation of subexpressions whose result this endpoint has no use for
(spec [§12.3](#expression-projection)).

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
simplification rule in [§13.12](#projected-ast-cleanup).

The BlueScript backend may choose a concrete implementation depending on what
BlueScript supports. If rest parameters are unavailable, it may emit
fixed-arity helpers instead. Whatever it emits, the artifacts that can be
removed are removed first (spec [§13.12](#projected-ast-cleanup)).

### 14.2 Where It Appears <a id="nothing-where-it-appears"></a>

`nothing(...)` appears wherever [§12.3](#expression-projection) preserves the operands of an operation
this endpoint does not perform — in a statement, in a call argument, in a
`return` value, or in a `for` header slot.

It does *not* wrap a call that the endpoint does make: the projected callee
already returns `null` there, so the call stands on its own (spec [§12.3](#expression-projection)).

### 14.3 `__and` and `__or` <a id="and-or-helpers"></a>

`__and(a, b)` and `__or(a, b)` are the runtime helpers that code generation
emits for `&&` and `||` (spec [§13.4](#logical-operator-code-generation)). Each takes two `boolean` arguments and
returns a `boolean`:

```text
__and(a, b) = a and b
__or(a, b)  = a or b
```

Unlike `nothing(...)`, they are ordinary calls. Their arguments are evaluated
left to right, both before the helper runs, as for any call
(spec [§5.17](#evaluation-order)); the helper itself only combines the two values, and has no
effect of its own. They produce a value that the program uses, so cleanup
never touches them (spec [§13.12](#projected-ast-cleanup)).

Like `nothing`, they are supplied by the BlueScript runtime rather than
generated into each endpoint program.

## 15. Examples <a id="examples"></a>

### 15.1 Direct Communication <a id="example-direct-communication"></a>

Input:

```ts
let x: integer@alice = 42@alice;
let y: integer@bob <- x;
```

EPP at `alice`:

```ts
let x: integer = 42;
sendInteger("bob", "__top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "__top_0");
```

***

### 15.2 Broadcast <a id="example-broadcast"></a>

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
broadcastBoolean("__top_0", localOk);
let ok: boolean = localOk;

if (ok) {
    null;
} else {
    null;
}
```

Each branch declares a variable at `bob`, so `alice` keeps only the
initializer's evaluation (spec [§12.8](#let-projection)). That is a single
expression, and a single discarded expression takes no `nothing(...)` wrapper
(spec [§12.3](#expression-projection)); the literal projects to `absent`, which
finalization turns into `null` (spec [§13.10](#absent-finalization)).

EPP at `alice` after cleanup:

```ts
let localOk: boolean = true;
broadcastBoolean("__top_0", localOk);
let ok: boolean = localOk;

if (ok) {
} else {
}
```

EPP at `bob`:

```ts
let ok: boolean = receiveBoolean("alice", "__top_0");

if (ok) {
    let msg: string = "ok";
} else {
    let msg: string = "ng";
}
```

Note: ChoreoBS Core v0 cleanup does not remove empty `if` statements. Removing empty `if` statements is a future optimization.

***

### 15.3 Local Function <a id="example-local-function"></a>

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

### 15.4 Choreography Function <a id="example-choreography-function"></a>

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

Note the asymmetry with [§15.3](#example-local-function). There, `add` is a local function at `alice`, so
`bob` does not generate it and the whole statement goes. Here `choose` is a
choreography function, so `bob` generates it and must run it; only the result is
discarded (spec [§12.3](#expression-projection)). Were the call dropped, any communication inside
`choose` would be performed by `alice` alone.

***

### 15.5 While with Transfer <a id="example-while-with-transfer"></a>

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
    sendInteger("bob", "__top_0", x);

    cont = receiveBoolean("bob", "__top_1");
}
```

EPP at `bob`:

```ts
let cont: boolean = true;

while (cont) {
    let y: integer = receiveInteger("alice", "__top_0");

    let nextLocal: boolean = false;
    broadcastBoolean("__top_1", nextLocal);
    cont = nextLocal;
}
```

***

### 15.6 For Loop <a id="example-for-loop"></a>

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
    sendInteger("bob", "__top_0", x);
}
```

EPP at `bob`:

```ts
for (let i: integer = 0; i < 3; i = i + 1) {
    let y: integer = receiveInteger("alice", "__top_0");
}
```

***

### 15.7 Cleanup of `nothing(...)` <a id="example-cleanup-of-nothing"></a>

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

Unchanged — one argument is a call, so the rule of [§13.12.2](#expression-simplification) does not apply, and
the nesting is not flattened either.

***

Input after EPP, from a call to a local function this endpoint does not
generate (spec [§12.11](#function-projection)):

```ts
nothing();
```

After cleanup:

```text
nothing();  =>  null;  =>  removed
```

### 15.8 Return Type Inference <a id="example-return-type-inference"></a>

Input:

```ts
function f@alice(c: boolean@alice) {
    if (c) {
        return 1.0@alice;
    } else {
        return 2.5@alice;
    }
}
```

The inferred return type is `float@alice`. Writing `1@alice` in the first
branch would make the function invalid instead: `integer` and `float` have no
LUB (spec [§16.21](#incompatible-inferred-return-types)).

***

### 15.9 Mutable Arrays <a id="example-mutable-arrays"></a>

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
sendIntegerArray("bob", "__top_0", xs);
```

EPP at `bob`:

```ts
let ys: integer[] = receiveIntegerArray("alice", "__top_0");
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

## 16. Compile-time Errors <a id="compile-time-errors"></a>

The following are compile-time errors.

### 16.1 Unknown Endpoint <a id="unknown-endpoint"></a>

```ts
let x: integer@carol = 1@carol;
```

This is an error if `carol` is not listed in `choreobs.json`.

### 16.2 Using `every` as an Endpoint <a id="using-every-as-an-endpoint"></a>

```json
{
  "endpoints": ["alice", "every"]
}
```

This is an error.

### 16.3 Location Annotation Omission <a id="location-annotation-omission"></a>

A type annotation or a literal without a location annotation is an error, unless
the location can be taken from an initializer (spec [§7.16.1](#let-type-inference)).

```ts
let x: integer = 1;          // the initializer has no location either
```

```ts
function f@alice(a: integer): integer@alice {   // no initializer to read
    return a;
}
```

### 16.4 Location Omission in a Local Function <a id="location-omission-in-a-local-function"></a>

A local function's own location does not supply a default. Parameter types,
return types, and literals must all be annotated explicitly (spec [§8.1](#explicit-location-annotations)). An
initialized `let` is the one exception, since it can read the location from its
initializer (spec [§7.16.1](#let-type-inference)).

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

### 16.5 Uninitialized Let <a id="uninitialized-let"></a>

```ts
let x: integer@alice;
```

### 16.6 Type Mismatch <a id="type-mismatch"></a>

```ts
let x: integer@alice = "hello"@alice;
```

`integer` and `float` are unrelated (spec [§7.5](#subtyping)), so neither is accepted for
the other:

```ts
let x: float@alice = 1@alice;
let y: integer@alice = 1.5@alice;
```

Convert explicitly instead (spec [§7.12](#numeric-conversion)):

```ts
let x: float@alice = 1@alice as float;
let y: integer@alice = 1.5@alice as integer;
```

### 16.7 Invalid Assignment Across Locations <a id="invalid-assignment-across-locations"></a>

```ts
let x: integer@alice = 1@alice;
let y: integer@bob = x;
```

Use a transfer instead:

```ts
let y: integer@bob <- x;
```

The same applies between `@every` and an individual location, which are
independent ([§7.6](#location-matching-and-residency)):

```ts
let c: boolean@every = true@every;
let d: boolean@alice = c;
```

Use a transfer instead:

```ts
let d: boolean@alice <- c;
```

### 16.8 Invalid Transfer Base Type <a id="invalid-transfer-base-type"></a>

For `a <- b` with `a : T1@p` and `b : T2@q`, the source base type must be a
subtype of the destination base type: `T2 <: T1` (spec [§7.8](#transfer-typing)).

Disallowed — `integer` and `float` are unrelated, in either direction:

```ts
let y: float@alice = 1.5@alice;
let x: integer@bob <- y;
```

```ts
let y: integer@alice = 1@alice;
let x: float@bob <- y;
```

Convert explicitly instead (spec [§7.12](#numeric-conversion)): here `alice` converts, then sends a
`float`:

```ts
let y: integer@alice = 1@alice;
let x: float@bob <- y as float;
```

Disallowed — any other pair of different base types:

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
destination share a location is valid and denotes a local copy (spec [§11.4](#local-copy)).

### 16.9 Invalid If Condition <a id="invalid-if-condition"></a>

```ts
function f(c: boolean@alice): void {
    if (c) {
        return;
    }
}
```

### 16.10 Invalid While Condition <a id="invalid-while-condition"></a>

```ts
function f(c: boolean@alice): void {
    while (c) {
        return;
    }
}
```

### 16.11 Invalid For Condition <a id="invalid-for-condition"></a>

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

### 16.12 Calling Another Endpoint's Local Function <a id="calling-another-endpoints-local-function"></a>

```ts
function f@bob(): integer@bob {
    return 1@bob;
}

function g@alice(): integer@alice {
    return f();
}
```

### 16.13 Calling a Choreography Function from a Local Function <a id="calling-choreography-from-local"></a>

```ts
function f(): void {
    return;
}

function g@alice(): void {
    f();
}
```

### 16.14 Recursive Choreography Function <a id="recursive-choreography-function"></a>

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

### 16.15 Function Overloading <a id="function-overloading"></a>

```ts
function f@alice(): void {
    return;
}

function f@bob(): void {
    return;
}
```

### 16.16 Break and Continue <a id="err-break-and-continue"></a>

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

### 16.17 Unsupported Equality Operators <a id="unsupported-equality-operators"></a>

```ts
x == y;
x != y;
```

Use:

```ts
x === y;
x !== y;
```

### 16.18 Transfer Let Without Type Annotation <a id="transfer-let-without-type-annotation"></a>

```ts
let y <- x;
```

Transfer declarations require an explicit destination type.

### 16.19 Cannot Infer Function Return Type <a id="cannot-infer-function-return-type"></a>

A function return type cannot be inferred if value-returning paths are not proven to return.

```ts
function maybe@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    }
}
```

### 16.20 Mixed Bare and Value Returns <a id="mixed-bare-and-value-returns"></a>

```ts
function bad@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    }
    return;
}
```

### 16.21 Incompatible Inferred Return Types <a id="incompatible-inferred-return-types"></a>

```ts
function bad@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    } else {
        return "one"@alice;
    }
}
```

`integer` and `float` have no LUB either (spec [§7.5](#subtyping)):

```ts
function bad@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    } else {
        return 2.5@alice;
    }
}
```

Converting one of them makes the candidates agree (spec [§7.12](#numeric-conversion)):

```ts
function good@alice(c: boolean@alice) {
    if (c) {
        return 1@alice as float;
    } else {
        return 2.5@alice;
    }
}
```

### 16.22 Incompatible Inferred Return Locations <a id="incompatible-inferred-return-locations"></a>

```ts
function bad(c: boolean@every) {
    if (c) {
        return 1@alice;
    } else {
        return 1@bob;
    }
}
```

### 16.23 Recursive Function With Omitted Return Type <a id="recursive-function-with-omitted-return-type"></a>

```ts
function fact@alice(n: integer@alice) {
    if (n <= 1@alice) {
        return 1@alice;
    } else {
        return n * fact(n - 1@alice);
    }
}
```

### 16.24 Parameter Type Omission <a id="parameter-type-omission"></a>

```ts
function add@alice(a, b) {
    return a + b;
}
```

Parameter types are not inferred in Core v0.

***

### 16.25 Invalid Local Function Parameter Location <a id="invalid-local-function-parameter-location"></a>

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

### 16.26 Invalid Local Function Return Location <a id="invalid-local-function-return-location"></a>

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

### 16.27 Invalid Value Used Inside Local Function <a id="invalid-value-used-inside-local-function"></a>

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
transfer `let` (spec [§8.2](#local-function-strict-location-rule)):

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

### 16.28 Invalid Function Argument Location <a id="invalid-function-argument-location"></a>

A function argument must be compatible with the corresponding parameter type
using base type subtyping, and must be located at the parameter's location
(spec [§7.6](#location-matching-and-residency)).

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

### 16.29 Unsupported Array Element Type <a id="unsupported-array-element-type"></a>

`string[]`, `null[]`, and `void[]` are not supported in the mutable array
extension. They parse — the grammar admits an array of any base type
(spec [§5.2](#types)) — and are rejected as a typing error (spec [§7.1.1](#array-types)).

Disallowed:

```ts
let xs: string[]@alice = []@alice;
let ys: null[]@alice = []@alice;
let zs: void[]@alice = []@alice;
```

### 16.30 Nested Array <a id="nested-array"></a>

Nested arrays are not supported. Unlike [§16.29](#unsupported-array-element-type), this one is ruled out by the
grammar: `ArrayType` takes a single `[` `]` (spec [§5.2](#types)), so it is reported as a
syntax error.

Disallowed:

```ts
let xs: integer[][]@alice = []@alice;
```

### 16.31 Array Literal Without Required Location <a id="array-literal-without-required-location"></a>

An array literal must carry its own location annotation (spec [§5.16](#array-literals)). The error
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

### 16.32 Cannot Infer Empty Array Element Type <a id="cannot-infer-empty-array-element-type"></a>

An empty array literal cannot infer its element type.

Disallowed:

```ts
let xs = []@alice;
```

Allowed:

```ts
let xs: integer[]@alice = []@alice;
```

### 16.33 Array Type Invariance <a id="array-type-invariance"></a>

Array types are invariant (spec [§7.13](#array-typing)).

Disallowed:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: float[]@alice = xs;
```

An array literal is typed on its own and then checked by the same rule, so an annotation does not change its element type either.

Also disallowed:

```ts
let zs: float[]@alice = [1, 2]@alice;
```

### 16.34 Invalid `@every` Array Assignment to Individual Location <a id="err-every-array-assignment"></a>

A mutable array located at `@every` cannot be assigned to an individual-location
array variable. This is an instance of the general location rule ([§7.6](#location-matching-and-residency), [§16.7](#invalid-assignment-across-locations)),
not an array-specific restriction; use `<-` to localize.

Disallowed:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice = xs;
```

### 16.35 Invalid `@every` Array Argument to Individual Location Parameter <a id="err-every-array-argument"></a>

A mutable array located at `@every` cannot be passed to a function parameter
located at an individual location. This is an instance of the general location
rule ([§7.6](#location-matching-and-residency), [§16.28](#invalid-function-argument-location)), not an array-specific restriction; localize with `<-` first.

Disallowed:

```ts
function f@alice(xs: integer[]@alice): void {
    return;
}
let xs: integer[]@every = [1, 2, 3]@every;
f(xs);
```

### 16.36 Invalid Array Equality <a id="invalid-array-equality"></a>

The equality operators `===` and `!==` are not defined for array types.

Disallowed:

```ts
let xs: integer[]@alice = [1]@alice;
xs === xs;
```

### 16.37 Invalid Array Index Location <a id="invalid-array-index-location"></a>

The index expression must be located at the array location.

Disallowed:

```ts
let xs: integer[]@alice = [1]@alice;
let i: integer@bob = 0@bob;
let x: integer@alice = xs[i];
```

### 16.38 Invalid `.push` Element Type <a id="invalid-push-element-type"></a>

The pushed value must be compatible with the array element type.

Disallowed:

```ts
let xs: integer[]@alice = []@alice;
xs.push(1.5@alice);
```

`integer` and `float` are unrelated (spec [§7.5](#subtyping)), so the reverse is rejected too:

```ts
let ys: float[]@alice = []@alice;
ys.push(1@alice);
```

Convert the value first (spec [§7.12](#numeric-conversion)):

```ts
let ys: float[]@alice = []@alice;
ys.push(1@alice as float);
```

### 16.39 `@every` on a Function Declaration <a id="every-on-a-function-declaration"></a>

A location on a function declaration names the one endpoint that runs the
function. It therefore declares a local function, and must be an individual
location (spec [§10.1](#function-kinds)).

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

### 16.40 Invalid Use of `void` <a id="invalid-use-of-void"></a>

`void` has no location and is not a value type (spec [§7.3](#void)).

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

A `return` value is a value position like any other, so a `void` computation is
rejected there too — even inside a `void` function, where `return;` is the form
to write (spec [§5.12](#return-statement), [§7.15](#return-typing)):

```ts
function g@alice(): void { return; }

function h@alice(): void {
    return g();             // return value
}
```

`xs.push(v)` is the other void computation (spec [§7.2](#located-types), [§7.13](#array-typing)), and is
rejected in the same positions for the same reason:

```ts
let xs: integer[]@alice = []@alice;

xs.push(1@alice);                        // valid — an expression statement
let n = xs.push(1@alice);                // produces no value
let m: integer@alice = xs.push(1@alice); // cannot assign void
f(xs.push(1@alice));                     // not assignable to the parameter
```

`void[]` is rejected separately, as an unsupported array element type
(spec [§16.29](#unsupported-array-element-type)).

### 16.41 Missing Return in a Non-`void` Function <a id="missing-return-in-a-non-void-function"></a>

A function whose return type is not `void` must return a value on every path
(spec [§7.15](#return-typing), [§7.16.6](#return-coverage-for-non-void-functions)). This applies to a written return type just as it does to
an inferred one (spec [§16.19](#cannot-infer-function-return-type)).

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

The analysis is the conservative one of [§7.16.6](#return-coverage-for-non-void-functions), so a function whose totality
rests on a loop condition is rejected even when it does always return:

```ts
function alsoRejected@alice(): integer@alice {
    while (true@alice) {
        return 1@alice;
    }
}
```

### 16.42 Invalid Unary Operand <a id="invalid-unary-operand"></a>

`-` requires a numeric scalar and `!` requires a boolean scalar (spec [§7.11](#operators)).
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

### 16.43 Invalid Comparison or Equality Operands <a id="invalid-comparison-or-equality-operands"></a>

`<`, `<=`, `>` and `>=` require numeric operands (spec [§7.11](#operators)):

```ts
let b: boolean@alice = "a"@alice < "b"@alice;
```

```ts
let xs: integer[]@alice = [1]@alice;
let c: boolean@alice = xs < xs;
```

They also require operands of the same numeric type, so `integer` and `float`
are not compared with each other (spec [§7.5](#subtyping)):

```ts
let b: boolean@alice = 1@alice < 1.5@alice;
```

Convert one operand explicitly instead (spec [§7.12](#numeric-conversion)):

```ts
let b: boolean@alice = (1@alice as float) < 1.5@alice;
```

`===` and `!==` require operands of the same base type, which likewise rules
out comparing an `integer` with a `float`:

```ts
let b: boolean@alice = 1@alice === 1.0@alice;
```

They also require operands that produce a value, so a void computation
(spec [§7.2](#located-types)) is rejected on either side. Two of them have the same base type,
which is why this needs a rule of its own:

```ts
function g@alice(): void { return; }
let xs: integer[]@alice = [1]@alice;

let b: boolean@alice = g() === g();
let c: boolean@alice = xs.push(1@alice) === xs.push(2@alice);
```

For array operands see [§16.36](#invalid-array-equality).

### 16.44 Invalid Arithmetic or Logical Operand <a id="invalid-arithmetic-or-logical-operand"></a>

`+ - * / %` require numeric scalars, apart from `string + string`
(spec [§7.11](#operators)). An array is rejected even when its elements are numeric:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@alice = xs + xs;
```

```ts
let s: string@alice = "a"@alice - "b"@alice;
```

Both operands must also have the same numeric type. `integer` and `float` are
unrelated (spec [§7.5](#subtyping)), so neither is promoted to the other:

```ts
let x = 1@alice + 1.5@alice;
```

Convert one operand explicitly instead (spec [§7.12](#numeric-conversion)):

```ts
let x = (1@alice as float) + 1.5@alice;
```

`&&` and `||` require boolean scalars:

```ts
let bs: boolean[]@alice = [true]@alice;
let b: boolean@alice = bs && bs;
```

```ts
let c: boolean@alice = 1@alice && true@alice;
```

### 16.45 Invalid Array Operation Syntax <a id="invalid-array-operation-syntax"></a>

These are **parse** errors, reported before type checking.

The receiver of `.length` and `.push` must be a variable (spec [§5.14](#expressions)), so a
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
error, because its result is `void` (spec [§7.13](#array-typing), [§16.40](#invalid-use-of-void)).

### 16.46 Missing `for` Condition <a id="missing-for-condition"></a>

The condition of a `for` loop is required (spec [§5.11](#for-statement)).

```ts
for (let i = 0@every; ; i = i + 1@every) {
}
```

Use `while (true@every)` for an unbounded loop.

### 16.47 Invalid Endpoint Name <a id="invalid-endpoint-name"></a>

An endpoint name must be an identifier (spec [§4.3](#identifiers)), must not be a reserved word
(spec [§4.4](#keywords)), and must not begin with `__` (spec [§6.2](#function-names)). See [§2.2](#choreobs-json).

Disallowed:

```json
{
  "endpoints": ["alice", "worker-1"]
}
```

```json
{
  "endpoints": ["alice", "while"]
}
```

```json
{
  "endpoints": ["alice", "__internal"]
}
```

A name that is not an identifier cannot be written after `@`, so it would name
an endpoint no program could refer to — and it would still name an output file
(spec [§2.3](#output-files)), which `../x` would place outside the output directory.

Allowed — the reserved runtime names (spec [§6.2](#function-names)) do not apply to endpoints,
which reach the generated code only as string literals and file names:

```json
{
  "endpoints": ["alice", "sendInteger"]
}
```

### 16.48 Name Already Held in the Value Namespace <a id="err-name-already-held"></a>

Location names, function names, and variable and parameter names share one
namespace (spec [§6.1](#namespaces)). Endpoint names and function names are held for the whole
program; a variable or parameter may not take one.

Disallowed — a variable or parameter taking a function's name:

```ts
function g@alice(): integer@alice { return 1@alice; }

function h@alice(): integer@alice {
    let g: integer@alice = 5@alice;
    return g + g();
}
```

Disallowed in either order, because functions are hoisted (spec [§6.3](#function-declaration-hoisting)):

```ts
let g: integer@alice = 5@alice;

function g@alice(): integer@alice {
    return 1@alice;
}
```

Disallowed — a function taking an endpoint's name:

```ts
function alice@alice(): void {
    return;
}
```

Disallowed — a variable or parameter taking an endpoint's name, even one the
source never writes after `@`:

```ts
let bob: integer@alice = 1@alice;
```

The rule is stated over the whole program. A function and a variable that
would never be projected to the same endpoint are still an error; see the
reasoning in spec [§6.1](#namespaces).

Allowed — shadowing between variables and parameters is unaffected
(spec [§6.4](#variable-scope)):

```ts
function f@alice(p: integer@alice): integer@alice {
    let p: integer@alice = 1@alice;
    return p;
}
```

***

### 16.49 Invalid Numeric Conversion <a id="invalid-numeric-conversion"></a>

The operand of `as` must be an `integer` or `float` scalar (spec [§7.12](#numeric-conversion)):

```ts
let b: float@alice = true@alice as float;
```

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys = xs as float;
```

The following are **parse** errors. What follows `as` must be a bare `integer`
or `float` (spec [§5.14](#expressions)): there is no conversion to any other base type, no
conversion of arrays, and no location on the target, since the result stays
where the operand is:

```ts
let s = 1@alice as string;
```

```ts
let ys = xs as float[];
```

```ts
let x = 1@alice as float@bob;
```

## 17. Non-goals and Future Extensions <a id="non-goals-and-future-extensions"></a>

The following features are not part of ChoreoBS Core v0.

### 17.1 Gradual Features <a id="gradual-features"></a>

* location inference;
* omitted locations on types and literals — omission is an error everywhere in v0, in local functions and choreography contexts alike (spec [§8.1](#explicit-location-annotations));
* use of `@every` values inside local functions;
* local function parameters or return types located at `every`;
* `any`;
* `undefined`;
* runtime location checks;
* gradual choreographic typing.

### 17.2 TypeScript / JavaScript Features <a id="typescript-javascript-features"></a>

* `const`;
* object literals;
* arrays beyond the mutable one-dimensional `integer[]` / `float[]` / `boolean[]` support defined in this specification;
* property access as lvalue — `xs[i] = v` is the only assignable form, and `.length` is read-only;
* property access and method calls in general: `.length` and `.push` are a closed set of array operations (spec [§5.14](#expressions)), not a facility for user types;
* type assertions: `as` is only the numeric conversion between `integer` and `float` (spec [§7.12](#numeric-conversion));
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

### 17.3 Control Flow <a id="future-control-flow"></a>

* `break`;
* `continue`;
* `switch`;
* `try`;
* `catch`;
* `throw`;
* `for-of`;
* `for-in`.

### 17.4 Communication Features <a id="future-communication-features"></a>

* asynchronous communication syntax;
* timeout;
* failure handling;
* retries;
* explicit channels;
* session types;
* label selection;
* non-blocking receive.

### 17.5 Data Structures <a id="future-data-structures"></a>

* string arrays;
* null arrays;
* void arrays;
* nested arrays;
* records;
* structs;
* tuples;
* maps.

### 17.6 Future Work <a id="future-work"></a>

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

### 17.7 Future Cleanup Optimizations <a id="future-cleanup-optimizations"></a>

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
* flattening nested `nothing(...)` (spec [§13.12.3](#nested-nothing-is-not-flattened)).
