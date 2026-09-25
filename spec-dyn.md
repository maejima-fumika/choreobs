# v1.1 Dynamic ChoreoBS

ChoreoBS に Gradual Locating を導入する仕様。

本書は `choreobs-dyn3.pdf`（v1 Dynamic ChoreoBS）の修正版である。ベースとなる言語仕様は
リポジトリの `spec.md`（ChoreoBS Core v0）で、本書に書いていないことは `spec.md` に従う。
`spec.md` 側で書き換えが要る箇所は[付録 A](#付録-a-specmd-への反映箇所)にまとめた。

## 0. v1 からの変更点

- 転送とコピーに必要な base type の種別（kind）を、コンパイラが引数で渡す（11 節）。
  受信側は payload を持たないので、payload から型を判別できないため
- ロケーション変数をヒープ上のオブジェクト `__LocVar` にし、整数 ID とグローバルな制約ストアを廃止した（6 節）。
  不要になった変数は GC で回収される。ID を一致させる必要も無くなった
- 動的操作（inject・cast・dyn リテラル・動的演算・配列操作・動的転送）を、全エンドポイントで生成される**組み込み関数の呼び出し**として扱うことにした（8 節）。
  - choreography 関数の呼び出しと同じ規則で射影されるので、EPP に新しい射影規則は要らない。追加するのは `residesAt(dyn, P) = true` だけである
  - `__cast` も呼び出しなので、非常駐側で discard に落ちても残る
- `integer <: float` を dyn でも保つ。変換は静的な変換ノード `widen`（出力は `as float`）で行う（3.4 節）
- `dyn` をキーワードにした。生成コード中のロケーションは文字列リテラルで書く。
  ランタイムファイルは `__runtime_<endpoint>.bs` とした（2 節、7 節）
- 型付け規則（一致関係 `~`、結合 `⊔`、変換 `coerce`）と、省略・推論の規則を明記した（3 節、4 節）
- strict モード `"implicitDyn": false` を追加した（4.2 節）
- dyn 配列リテラルは、要素に関係なく `__dynArrayNew` / `__dynArrayAppend` で組み立てることにした（5.2 節）
- 動的転送のタグ規則を明記した（11.1 節）
- ランタイムは `@dyn` を含むプログラムでだけ生成する。`nothing` / `__and` / `__or` は今までどおり外部から供給する（7 節）
- 例の誤りを直した。
  - 型の例の変数名
  - 単項 `-` の例
  - 静的転送が動的転送になっていた箇所
  - typo

***

## 1. Gradual Locating Overview

- ロケーションに `@dyn` を指定できる。ロケーションが省略され、ロケーション推論でも決まらない場合も `@dyn` になる（4 節）。
  - ただし、ローカル関数内ではロケーションを省略してはいけない。`@dyn` も使えない。
- `@dyn` のロケーションを持つ変数・関数引数には、どのロケーションの値も代入できる。
  条件は、base type が部分型関係 `T2 <: T1`（`spec.md` §subtyping）を満たすことだけである。
- `@dyn` のロケーションを持つ値は、base type が合う限り、どのロケーションが要求される箇所でも使用できる。
  - ただし、実行時検査（runtime check）が入る。
- `@dyn` を使うと、静的ロケーション検査を実行時に遅らせられる。
- dynamic location を持つ値を**動的配置値**（dynamically located value）と呼ぶ。
  - 動的配置値は、実行時には payload とロケーション変数から構成される。
  - ロケーション変数の間の等式制約は、union-find で管理する（6 節）。
    - これにより、配列などが導入された場合も gradual にできる。
  - ロケーション変数が具体ロケーションを指している状態を **bound**、そうでない状態を **unbound** と呼ぶ。
  - payload の整合性:
    - individual location `p` に bound された値: `p` だけが論理的な owner で、`p` だけが payload を使用する。
      他のエンドポイントの payload は未規定（`null` か古い値）で、読まれない。
    - `every` に bound された値: 全エンドポイントに、それぞれ独立した同じ内容の payload が存在する。
    - unbound な値: 全エンドポイントが同じ payload の複製を保持する。ただし論理的には `every` ではない。
  - payload の表現: payload は常に、その値の**静的 base type の実行時表現**を持つ。
    integer の値を `float@dyn` に入れるときは、境界で変換する（3.4 節）。
- 動的配置値を含む演算は、全エンドポイントに同じ形で配布され、実行時に演算主体が決まる（ロケーションディスパッチ）。
  - 動的操作は、EPP でも cleanup でも削除しない（8 節）。
- base type は、すべて静的に型付けする。
  - gradual 化するのは location component だけである。
    base type compatibility、array invariance、operator applicability は `spec.md` のまま静的に検査する。
- 実装では、動的配置値の payload はすべて `any` 型になる。
  - base type ごとに `__DynVal` と動的演算を作ると、ランタイム関数が増えすぎる。
  - BlueScript はジェネリクスを持たない。
  - 型情報が必要な操作（転送とコピー）には、コンパイラが静的な種別 `kind` を渡す（11 節）。
- 静的配置値と動的配置値が混在する演算は、静的配置値を `__inject` で動的配置値にしてから行う。
  静的配置値だけの演算と転送は、`spec.md` のとおり静的なままにする。
- 動的操作の一致:
  - 対応する動的操作は、全エンドポイントで同じ順序・同じ回数だけ実行される。理由は次の3つである。
    1. 分岐条件は `every` なので、全エンドポイントが同じ分岐を選ぶ。
    2. ローカル関数は dyn を含まない。
    3. EPP は動的操作を捨てない（8 節）。
  - ロケーション変数はエンドポイント間で送らないので、ID を一致させる必要は無い。
    各エンドポイントのロケーション変数は、対応する操作で作られたもの同士が対応する。
- 存在しない payload は `null` で表現する。
- ランタイム関数・変数には、コンパイラ prefix の `__` を付ける（`spec.md` §function-names）。

***

## 2. ロケーション

```text
Location           ::= ConcreteLocation | dyn
ConcreteLocation   ::= IndividualLocation | every
IndividualLocation ::= endpoint name
```

- location: `dyn` と concrete location からなる。
- dynamic location: `dyn`
- concrete location: individual location と `every`
  - individual location と `every` の関係は `spec.md` のとおりである。両者は別々のロケーションで、sub-location 関係などは定義しない。
- individual location: `alice`、`bob` など。エンドポイント名と一対一に対応する。

`dyn` は予約語である（`spec.md` §keywords に `every` と並べて加える）。したがって、変数名・関数名・エンドポイント名には使えない。
`choreobs.json` の `endpoints` に `dyn` を書くとエラーになる（`every` と同じ扱い）。

### 2.1 Residency

```text
residesAt(dyn, P) = true      すべてのエンドポイント P について
```

これは表現上の residency である。全エンドポイントが `__DynVal` を持つ、という意味にすぎない。
論理的な owner は実行時に決まる。`spec.md` §location-matching-and-residency の `residesAt` と同様に、EPP でだけ使い、型検査には使わない。

***

## 3. 型付け

### 3.1 一致関係と結合

`spec.md` §location-matching-and-residency の `match` を拡張して、一致関係 `~` と結合 `⊔` を定める。

```text
L1 ~ L2   ⇔  L1 = dyn ∨ L2 = dyn ∨ match(L1, L2)

L1 ⊔ L2   =  L1    if L1 = L2
             dyn   if L1 = dyn ∨ L2 = dyn
```

`⊔` は `~` を満たす組でだけ使う。`~` は推移的ではない（`alice ~ dyn` と `dyn ~ bob` は成り立つが、`alice ~ bob` は成り立たない）。
そのため、複数のロケーションが関与する構文では、**関与するロケーションが互いに `~` であること**を要求する。
具体ロケーションが2種類以上混ざったら、静的エラーである。

### 3.2 各構文の規則

base type の規則は `spec.md` のままとし、ロケーションの規則だけを置き換える。

| 構文 | ロケーションの条件 | 結果 |
|---|---|---|
| 代入 `a = b`（`a : T1@L1`, `b : T2@L2`） | `L2 ~ L1` | |
| 引数（仮引数 `Ti@Li`、実引数 `Si@Mi`） | `Mi ~ Li` | |
| `return e`（戻り値型 `T@L`） | `e` のロケーション `~ L` | |
| `if` / `while` / `for` の条件（choreography 文脈） | `boolean@L`、`L ~ every` | |
| 二項演算 `e1 op e2` | `L1 ~ L2` | `T@(L1 ⊔ L2)` |
| 単項演算 `op e` | | `T@L` |
| `xs[i]` | `Li ~ Lxs` | `T@(Lxs ⊔ Li)` |
| `xs[i] = v` | `Lxs`・`Li`・`Lv` が互いに `~` | |
| `xs.length` | | `integer@Lxs` |
| `xs.push(v)` | `Lv ~ Lxs` | `void` |
| 配列リテラル `[e1, …, en]@L` | 各 `Lei` と `L` が互いに `~` | `T[]@L` |
| 転送 `a <- b` | ロケーションの条件は無い（`spec.md` §transfer-typing） | |

要素代入と push は、関与するロケーションの `⊔` が `dyn` なら動的操作になり、そうでなければ静的操作のままである（12 節）。
たとえば `arrAlice[iAlice] = valDyn` も動的操作になる。

### 3.3 変換 `coerce`

型が `S@L` の式 `e` を、型 `T@L'` が要求される位置へ置くときは、`coerce(e : S@L → T@L')` を挿入する（`S <: T`）。
これは論文の C-Id / C-Inj / C-Cast と同じ規則である。

```text
L  = L'              =>  e
L  = q,   L' = dyn   =>  inj<q>(e)
L  = dyn, L' = q     =>  cast<q>(e)
```

`S = integer` かつ `T = float` の場合は、3.4 節の `widen` を合成する。

`inj<q>` と `cast<q>` は、組み込み関数 `__inject` / `__cast` の呼び出しとして型付き AST に置く（8.2 節）。

`coerce` を適用する位置:

- `let` の初期化子
- 代入の右辺
- 関数呼び出しの引数
- `return` の値
- 条件（choreography 文脈では要求が `boolean@every`）
- 要素代入の値と push の値（要求は配列の要素型。動的操作ならロケーションは `dyn`）
- 配列リテラルの要素（要求は要素型 `@` 配列のロケーション）
- 転送の source（3.5 節）

`⊔` が `dyn` になる二項演算・配列操作では、静的なオペランドを `inj<q>` で包む（`coerce(e → T@dyn)`）。

### 3.4 integer から float への変換

`integer <: float` は dyn でも保つ。payload は静的 base type の表現を持たなければならないので（1 節）、
integer の値が float の位置に入るときは変換する。

#### 変換ノード `widen`

静的な値の変換には、変換ノード `widen` を使う。

```text
widen(e) : float@L      ただし e : integer@L、L は具体ロケーション
```

- 出力は BlueScript の `as float` である。
- 射影は単項演算と同じく、結果の residency で決まる。
  - 常駐側では `project(e) as float` になる。
  - 非常駐側では discard される。discard は括弧と同じく `discard(widen(e)) = discard(e)` で、`nothing(...)` では包まない。
    変換は値の表現を変えるだけで、評価すべきものを増やさないからである。
- `widen` を使うのは float だけである。
  要確認 2（16 節）で、any から静的型への暗黙の変換が効かないと分かった場合は、同じノードを `as T` に広げる。

#### 流れごとの形

| 流れ | 挿入する形 |
|---|---|
| `integer@q` → `float@dyn` | `inj<q>(widen(e))` |
| `integer@dyn` → `float@q` | `widen(cast<q>(e))` |
| `integer@dyn` → `float@dyn` | `__dynToFloat(e)`（組み込み関数。10.5 節） |
| integer リテラル `c@dyn` → `float@dyn` | `__dynUnbound(widen(c))`（payload の `c` は `@every` として全エンドポイントで評価される。8.2 節） |

#### `as float` は値が存在する側にだけ現れる

非常駐側では payload が `null` なので、`null as float` にしてはいけない。これは上の射影規則から自動的に守られる。

- `inj<q>(widen(e))` の引数 `widen(e)` は `float@q` なので、`q` 以外では discard されて null になる。結果は `__inject(null, "q")` である。
- 捨てられる `widen(cast<q>(e))` は `discard(cast<q>(e))` になる。cast は呼び出しなので残り、結果は `__cast(e, "q")` である。

#### `__dynToFloat`

`__dynToFloat` では、payload を持つエンドポイントだけが `payload as float` を計算する（10.5 節）。
変換は同じ値の表現を変えるだけなので、ロケーション変数は元の値と共有する。

静的な値同士（`integer@q` → `float@q`）は、今までどおり BlueScript の暗黙の変換に任せる（`spec.md` §operators）。

例:

```ts
// ChoreoBS
// let valAlice: integer@alice = 1@alice;
// let iDyn: integer@dyn = 2@dyn;
let f1: float@dyn = valAlice;     // 静的 → dyn
let f2: float@alice = iDyn;       // dyn → 静的
let f3: float@dyn = iDyn;         // dyn → dyn
let f4: float@dyn = 3;            // リテラル（3 は 3@dyn になる）

// After EPP at alice
let f1: __DynVal = __inject(valAlice as float, "alice");
let f2: float = __cast(iDyn, "alice") as float;
let f3: __DynVal = __dynToFloat(iDyn);
let f4: __DynVal = __dynUnbound(3 as float);

// After EPP at bob
let f1: __DynVal = __inject(null, "alice");
__cast(iDyn, "alice");
let f3: __DynVal = __dynToFloat(iDyn);
let f4: __DynVal = __dynUnbound(3 as float);
```

`===` / `!==` は、静的に「完全に同じ base type」を要求する（`spec.md` §operators）。
payload の表現の不変条件があるので、`__dynEq` は常に同じ表現同士を比べることになる。

### 3.5 転送

論文の T-Comm / T-DynComm / T-DynCommDest / T-DynCommSrc と同じである。`T` は宛先の base type である。

**動的転送**（送信元と宛先の少なくとも一方が `dyn` の転送）は、組み込み関数 `__dynTransfer` の呼び出しに書き換える。

- 転送宣言 `let a: … <- e;` は `let a: … = …;` になる。
- 転送代入 `a <- e;` は `a = …;` になる。

```text
a : T@q    <- e : S@q'    静的転送（spec.md §transfer-semantics のまま）
a : T@dyn  <- e           a ← __dynTransfer(tag, kind(T), "dyn", coerce(e → T@dyn))
a : T@q    <- e : S@dyn   a ← __cast(__dynTransfer(tag, kind(T), "q", coerce(e → T@dyn)), "q")
```

`a ← …` は、宣言なら `let`、代入なら `=` による束縛を表す。

- 書き換えた後は、通常の let・代入として射影される。
  `spec.md` §transfer-projection の規則（送信側と受信側の場合分けや、非送信側での source の discard）は使わない。
  どのエンドポイントも、同じ `__dynTransfer` を呼ぶからである。
- `tag` は 11.1 節の規則で割り当てる。
- source を先に `T@dyn` へ変換するので、payload はすでに宛先の base type の表現を持っている。
  3行目の `__cast` の後ろには `widen` は不要である。

### 3.6 ローカル関数

ローカル関数では、`dyn` を全面的に禁止する。対象は、仮引数・戻り値型・変数・リテラル・関数本体で評価される値である。
ローカル関数のロケーションに `@dyn` を指定することも禁止する。ロケーションの省略は、今までどおりエラーである（`spec.md` §local-function-strict-location-rule）。

***

## 4. 省略と推論

### 4.1 省略は `@dyn` になる

ロケーションが省略され、次の 4.3 節の単純なロケーション推論でも決まらない場合は、`@dyn` になる。

- ロケーションの無いリテラル
- ロケーションの無い仮引数の型
- 右辺からロケーションが推論できない変数宣言
- 宛先のロケーションが書かれていない転送 `let`（`let b: integer <- 32@alice;`）
- ロケーション注釈の無い配列リテラル（要素からは推論しない。5.2 節）
- return からロケーションが一つに定まらない戻り値型

関数宣言のロケーションは、値のロケーションではない。
`function f(...)` は今までどおり choreography 関数であり、`@dyn` にはならない（`spec.md` §function-kinds）。

### 4.2 strict モード

`choreobs.json` で次のように書くと、省略を `@dyn` にせずエラーにする。

```json
{
  "endpoints": ["alice", "bob"],
  "implicitDyn": false
}
```

- 省略時の既定値は `true`（省略は `@dyn`）である。
- `false` のとき、省略は現行の `spec.md` §location-annotation-omission のエラーになる。戻り値のロケーションの lub が取れない場合は `spec.md` §incompatible-inferred-return-locations、宛先の無い転送 `let` は `spec.md` §transfer-let-does-not-infer-destination-type のエラーになる。`@dyn` と明示した箇所だけが動的になる。

### 4.3 単純なロケーション推論

- **変数宣言**: 右辺のロケーションから、変数のロケーションを推論する（`spec.md` §let-type-inference）。部分注釈 `let a: integer = 3@mcu;` も同じである。
- **`for` の初期化子**: 同上（`spec.md` §for-initializer-let-type-inference）。
- **関数の戻り値**: `return` の lub から推論する（`spec.md` §function-return-type-inference）。ロケーションの lub が取れなければ `dyn` にする。
- **戻り値型の部分注釈**: `function f(): integer { … }` のように、戻り値型を書いてロケーションだけを省略した場合。
  let の部分注釈と同じく、base type は注釈から、ロケーションは `return` の lub から取る。lub が取れなければ `dyn` にする。
- **配列リテラルの要素**: 配列リテラル自身の注釈から、注釈の無いリテラル要素へ補う（`spec.md` §array-literals と同じ向き）。
  注釈の無い配列リテラルは `@dyn` になるので、その要素のリテラルも `@dyn` になる。

### 4.4 省略できないもの

- ローカル関数内のロケーション（3.6 節）
- 初期化子の無い `let`。これは `spec.md` §uninitialized-let のエラーのままとする。
  論文のリスト（gradual-temperature）の `let raw: float@dyn;` は、`let raw: float@dyn = 0.0@dyn;` に直す。
  初期値は unbound で、どちらの分岐でも置き換わるので意味は変わらない。
- 型の無い転送 `let y <- x;`。base type が要るので、`spec.md` §transfer-let-without-type-annotation のエラーのままである。

### 4.5 例

例1:

```ts
3;                        // ロケーションを持たないリテラル
let a = 32;               // 右辺からロケーションが推論できない変数宣言
let b: integer <- 32@alice;   // 宛先のロケーションが指定されていない転送
function foo(a: integer) {}   // 関数引数のロケーションが指定されなかった場合
function boo(flag: boolean@every) {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}                         // 関数の返り値のロケーションが一つに定まらない場合
function bar(): integer {
    return 3@alice;
}                         // 戻り値型の部分注釈
```

このプログラムは、コンパイル中に次のように補完される。

```ts
3@dyn;
let a: integer@dyn = 32@dyn;
let b: integer@dyn <- 32@alice;
function foo(a: integer@dyn): void {}
function boo(flag: boolean@every): integer@dyn {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}
function bar(): integer@alice {
    return 3@alice;
}
```

例2:

```ts
let a: integer@dyn = 32@alice;   // 変数 a のロケーションは dyn
```

***

## 5. リテラル

### 5.1 スカラー値のリテラル

型は `T@dyn`、リテラルは `c@dyn` と書く。

```ts
let x: integer@dyn = 3@dyn;
```

```ts
// ChoreoBS
3@dyn;
4.5@dyn;
true@dyn;
"Hello"@dyn;
null@dyn;

// After EPP at alice / bob（共通）
__dynUnbound(3);
__dynUnbound(4.5);
__dynUnbound(true);
__dynUnbound("Hello");
__dynUnbound(null);
```

### 5.2 配列リテラル

- 注釈の無い配列リテラルは `@dyn` になる。要素のロケーションからは推論しない。
  `spec.md` §array-literals の「配列は自分のロケーションを持つ値」という原則を保つためである。
- `@dyn` の配列の、注釈の無いリテラル要素は `@dyn` に補完される。
- 要素と配列自身に、**別の具体ロケーション**を付けることはできない。`dyn` は `~` で受け入れる（3.2 節）。
  - `@dyn` の配列の静的な要素は inject する（`[a@alice]@dyn`）。
  - 静的な配列の dyn 要素は cast する（`[d]@alice` は `[__cast(d, "alice")]`）。
- 要素は要素型へ `coerce` する。

`[e1, …, en]@dyn` は、要素の形に関係なく、空の配列を作ってから要素を1つずつ追加する形に射影する。

| 要素 | 射影 |
|---|---|
| 無し（`[]@dyn`） | `__dynArrayNew(kind)` |
| 1つ以上 | `__dynArrayAppend(…__dynArrayAppend(__dynArrayNew(kind), e1')…, en')` |

- `ei'` は `coerce(ei → T@dyn)` の射影である。
  - 注釈の無いリテラル要素は `c@dyn` になり、`__dynUnbound(c)` へ射影される。
  - 要素型が float のとき、integer の要素は 3.4 節の形で変換される（`[1, 2.5]@dyn` の `1` は `__dynUnbound(1 as float)`）。
- 外側の引数は左から評価されるので、`e1` から `en` の順に評価される（`spec.md` §evaluation-order）。
- `kind` は配列の種別（`"integerArray"` / `"floatArray"` / `"booleanArray"`）である。
- `__dynArrayNew` は、型付きの空配列から unbound な動的配置値を作る（12.4 節）。
  配列の実行時の型は必ずここで決まるので、any に入れた配列リテラルの要素型に頼らずに済む。
- 実行時には、要素ごとに `__DynVal` と `__LocVar` の生成と、push が1回ずつ入る。
  全要素がリテラルの配列でも同じである。MCU でコストが問題になれば、全要素がリテラルの場合に1回で作る特例を後から足せる。

```ts
// ChoreoBS
// let a: integer@alice = 1@alice;
// let b: integer@alice = 2@alice;
// let d: integer@dyn = 3@dyn;
[1, 2];
[1, 2]@dyn;
[1@dyn, 2@dyn]@dyn;
let e: integer[]@dyn = []@dyn;
[a, b];
let xs: integer[]@alice = [d]@alice;

// After EPP at alice
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
let e: __DynVal = __dynArrayNew("integerArray");
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __inject(a, "alice")), __inject(b, "alice"));
let xs: integer[] = [__cast(d, "alice")];

// After EPP at bob
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __dynUnbound(1)), __dynUnbound(2));
let e: __DynVal = __dynArrayNew("integerArray");
__dynArrayAppend(__dynArrayAppend(__dynArrayNew("integerArray"), __inject(null, "alice")), __inject(null, "alice"));
nothing(__cast(d, "alice"));
```

`[a, b]` は、実行時に1つ目の `__dynArrayAppend` で alice に bound される。

***

## 6. Runtime representation

`__runtime_<endpoint>.bs` に記述する（7 節）。

### 6.1 ロケーション変数

ロケーション変数はヒープ上のオブジェクトで、union-find で等式制約を表す。

- グローバルな制約ストアや整数 ID は持たない。
- 不要になったロケーション変数は GC で回収される。
- unbound は、番兵 `""` で表す。

```ts
export class __LocVar {
  parent: __LocVar;   // 代表元なら自分自身
  bound: string;      // "" なら unbound（代表元でだけ意味を持つ）
  rank: integer;

  constructor(bound: string) {
    this.parent = this;
    this.bound = bound;
    this.rank = 0;
  }
}

function __root(v: __LocVar): __LocVar {
  let r: __LocVar = v;
  while (r.parent !== r) {
    r = r.parent;
  }
  return r;   // 経路圧縮を入れてもよい
}

export function __find(v: __LocVar): string {
  return __root(v).bound;
}

export function __unify(a: __LocVar, b: __LocVar): string {
  const ra = __root(a);
  const rb = __root(b);
  if (ra === rb) {
    return ra.bound;
  }
  if (ra.bound !== "" && rb.bound !== "") {
    if (ra.bound !== rb.bound) {
      __locationError();
    }
    return ra.bound;
  }
  // 少なくとも一方が unbound。束縛済みの側を代表元にする。
  // 両方 unbound なら rank の高い側、同順位なら左を代表元にする。
  let top: __LocVar = ra;
  let sub: __LocVar = rb;
  if (rb.bound !== "" || (ra.bound === "" && rb.rank > ra.rank)) {
    top = rb;
    sub = ra;
  }
  sub.parent = top;
  if (sub.rank === top.rank) {
    top.rank = top.rank + 1;
  }
  return top.bound;
}

export function __bind(v: __LocVar, loc: string): void {
  const r = __root(v);
  if (r.bound === "") {
    r.bound = loc;
  } else if (r.bound !== loc) {
    __locationError();
  }
}
```

各操作の仕様:

- **`__find(v)`**: `v` のクラスが bound されていれば、そのロケーションを返す。unbound なら `""` を返す。
- **`__unify(a, b)`**: `a` と `b` のクラスを同じロケーションに置く制約を加え、結果のロケーション（unbound なら `""`）を返す。
  - 両方 unbound: 2つのクラスを1つにまとめる。
  - 片方だけ bound: unbound の側も同じロケーションに bound される。
  - 両方 bound で同じ具体ロケーション: 何もしない。
  - 両方 bound で違う具体ロケーション: location error。
- **`__bind(v, loc)`**:
  - `v` のクラスが unbound なら、クラス全体を `loc` に bound する。
  - すでに別のロケーションに bound されていれば location error。

代表元の選び方には理由がある。

- **束縛済みの代表元は、付け替えない。**
- **両方 unbound なら、rank の高い側（同順位なら左）を代表元にする。**
  演算結果は左オペランドのロケーション変数を共有するので、長生きする側を代表元に残したい。
  こうしないと、`x = x + 1@dyn` や `x = 1@dyn + x` を繰り返すたびに代表元の鎖が伸び、その鎖が生きている別名から到達可能なまま残ることがある。

### 6.2 location error

```ts
export function __locationError(): void {
  // 実行を止める。戻ってはならない。
}
```

- 仕様としては、「location error を検出したエンドポイントは、その操作で実行を停止する」とだけ定める。
- 全エンドポイントが同じ制約を同じ順に加えるので、全エンドポイントが同じ操作で停止する。エンドポイント間の協調は要らない。
- 中身を `throw` にするか、プラットフォームの停止関数にするかは要確認である（16 節）。

### 6.3 `__DynVal`

```ts
export class __DynVal {
  payload: any;
  loc: __LocVar;

  constructor(payload: any, loc: __LocVar) {
    this.payload = payload;
    this.loc = loc;
  }
}

export function __dynUnbound(payload: any): __DynVal {
  return new __DynVal(payload, new __LocVar(""));
}

export function __dynAt(payload: any, loc: string): __DynVal {
  return new __DynVal(payload, new __LocVar(loc));
}
```

- ロケーション変数は、変数ではなく動的配置値に属する。
- 変数への代入は、その変数が参照する動的配置値を置き換えるだけである（14.2 節）。
- `=` による別名（`let a: integer@dyn = b;`）は同じ `__DynVal` を共有するので、ロケーション変数も共有する。

### 6.4 ロケーションに関する関数

```ts
export const __here: string = "alice";   // エンドポイントごとに異なるのはこれだけ

export function __isHere(loc: string): boolean {
  return loc === __here;
}

export function __isEvery(loc: string): boolean {
  return loc === "every";
}

export function __isDyn(loc: string): boolean {
  return loc === "dyn";
}

// __find / __unify の結果 loc について、このエンドポイントが payload を使うか
export function __holdsPayload(loc: string): boolean {
  return loc === "" || __isEvery(loc) || __isHere(loc);
}
```

生成コード中のロケーションは、文字列リテラル（`"alice"` / `"every"` / `"dyn"`）で書く。
これは `spec.md` §communication-api の send / receive と同じ書き方である。
エンドポイント名は `every` にも `dyn` にもなれず、`__` でも始まらないので、これらの文字列が衝突することは無い。

***

## 7. ランタイムファイルと出力

### 7.1 出力ファイル

入力 `index.cbs`、`choreobs.json` の `endpoints` が `["alice", "bob"]` のとき:

```text
index_alice.bs
index_bob.bs
__runtime_alice.bs     @dyn を含むプログラムでだけ生成
__runtime_bob.bs       @dyn を含むプログラムでだけ生成
```

- `<input>_<endpoint>.bs`: EPP が生成するコードである。ローカルのプログラムと、ランタイム関数の import からなる。
- `__runtime_<endpoint>.bs`: ランタイム関数と runtime representation を置く。
  - `__here` 定数以外の中身は、どのエンドポイント用でも同じである。
- 入力ファイルの basename は `__` で始まってはならない。これは `spec.md` §input-files に追加する規則で、`__runtime_<endpoint>.bs` との衝突を防ぐ。
  理屈は `spec.md` §identifiers の `__` の予約と同じである。

### 7.2 生成条件

- **`@dyn` を含むプログラム**（省略から補完されたものを含む）では、ランタイムを生成して import する。
- **`@dyn` を含まないプログラム**では、ランタイムを生成せず、import もしない。
  - 現行の `spec.md` でコンパイルが通るプログラムには dyn が現れない。
    そのため、静的版の出力はバイト単位で今と同じになる。
- `nothing` / `__and` / `__or` は、dyn の有無に関係なく、`spec.md` §and-or-helpers のとおり外部から供給する。
  ランタイムに置くのは、動的操作とその表現だけである。

### 7.3 import と export

- 生成コードから呼ぶランタイム関数と定数は、すべて `export` する。
- 内部だけで使うヘルパにも `__` を付ける（`__root`、`__copyPayload`、`__sendAny` など）。
  BlueScript のモジュールスコープの扱いに依存しないためである。
- `<input>_<endpoint>.bs` では、使用する関数・定数だけを import する。

```ts
// index_alice.bs
import { __DynVal, __dynUnbound, __inject, __cast, __dynPlus } from "./__runtime_alice.bs";
```

***

## 8. EPP 規則

### 8.1 型射影

```text
T@dyn   projected to any endpoint -> __DynVal
T[]@dyn projected to any endpoint -> __DynVal
```

これは `residesAt(dyn, P) = true`（2.1 節）から従う。

### 8.2 組み込み関数

原則: 動的操作は、**全エンドポイントで生成される組み込み関数**の呼び出しとして型付き AST に置く。
EPP では、callee が全エンドポイントで生成される choreography 関数の呼び出しと同じに扱う
（`spec.md` §expression-projection の「call, callee here」の行）。

| 組み込み関数 | 引数の型 | 結果の型 | 由来 |
|---|---|---|---|
| `__dynUnbound(c)` | `c : T@every` | `T@dyn` | dyn リテラル `c@dyn` |
| `__inject(e, "q")` | `e : T@q` | `T@dyn` | `inj<q>(e)` |
| `__cast(v, "q")` | `v : T@dyn` | `T@q` | `cast<q>(v)` |
| `__dynToFloat(v)` | `v : integer@dyn` | `float@dyn` | 3.4 節 |
| `__dynPlus(a, b)` ほか二項演算 | `a : T1@dyn`、`b : T2@dyn` | `T@dyn` | 10.1〜10.3 節 |
| `__dynNot(v)` / `__dynNeg(v)` | `v : T@dyn` | `T@dyn` | 10.4 節 |
| `__dynArrayGet(xs, i)` | `xs : T[]@dyn`、`i : integer@dyn` | `T@dyn` | 12.1 節 |
| `__dynArraySet(xs, i, v)` | `xs : T[]@dyn`、`i : integer@dyn`、`v : T@dyn` | `void` | 12.2 節 |
| `__dynArrayPush(xs, v)` | `xs : T[]@dyn`、`v : T@dyn` | `void` | 12.3 節 |
| `__dynArrayLength(xs)` | `xs : T[]@dyn` | `integer@dyn` | 12.3 節 |
| `__dynArrayNew(kind)` | | `T[]@dyn` | 5.2 節 |
| `__dynArrayAppend(xs, v)` | `xs : T[]@dyn`、`v : T@dyn` | `T[]@dyn` | 5.2 節 |
| `__dynTransfer(tag, kind, "L", v)` | `v : T@dyn` | `T@dyn` | 3.5 節 |

- ロケーション（`"q"`、`"L"`）・`kind`・`tag` の引数は、`string@every` のリテラルである。全エンドポイントで同じ文字列になる。
- `__dynArraySet` と `__dynArrayPush` は void の呼び出しなので、式文として置く。

次の3つは、既存の規則だけから従う。

1. **呼び出しは全エンドポイントに残る。**
   結果が非常駐でも（`__cast` の結果 `T@q` など）、discard に落ちた呼び出しは呼び出しのまま射影される。
2. **引数は `project_P` で射影される。**
   静的な引数（`__inject` の `e : T@q`）は、`q` 以外では null か、呼び出しを残した `nothing(...)` になる。
   これは論文の D-InjNonOwner の absent と同じである。
3. **cleanup は呼び出しを消さない**（`spec.md` §what-this-cleanup-pass-must-not-remove）。
   `__dynUnbound(3);` のような式文も残る。fresh なロケーション変数を作る操作なので、残す必要がある。

したがって、EPP に追加する規則は次の2つだけである。

- `residesAt(dyn, P) = true`（2.1 節）
- 組み込み関数を「全エンドポイントで生成される callee」とみなす

discard の表に行を足す必要は無い。`spec.md` §expression-projection の不変条件（「Why the Operands Are Enough」）に例外を足す必要も無い。
呼び出しの引数は、もともとその不変条件の外で扱われているからである。

cast が非常駐側でも残らなければならない理由を、例で示す。ローカル関数 `f@alice(a: integer@alice)` を `f(valDyn)` と呼ぶとする。

1. bob では callee `f` が生成されないので、呼び出しは `nothing(project_bob(__cast(valDyn, "alice")))` になる。
2. `__cast(...)` の結果型は `integer@alice` なので、bob では非常駐となり discard に落ちる。それでも呼び出しなので残る。
3. もし消えると、bob だけが valDyn のクラスを alice に bound しないことになる。
   制約が全エンドポイントで一致しなくなり、以降のロケーションディスパッチが食い違う。

### 8.3 変換ノード

`widen` は組み込み関数ではなく、静的な変換ノードである。3.4 節の規則で射影する。

- 常駐側では `project(e) as float` になる。
- discard は括弧と同じで、`discard(widen(e)) = discard(e)` である。

***

## 9. `__inject` と `__cast`

- `__inject`: 静的配置値を動的配置値に変換する。
  - payload はコピーせず、新しい `__DynVal` wrapper と、bound 済みの fresh なロケーション変数を生成する。
  - 配列 payload の場合、新しい wrapper は元の配列参照を保持するので、payload の identity は保存される。
- `__cast`: 動的配置値を静的配置値に変換する。
  - ロケーション変数を `loc` に bound してから、値を unwrap する。
  - bound 済みの値を検査するだけでなく、unbound の値を新たに bound する。
  - non-owner は、payload の複製を持っていても `null` を得る（論文の D-CastNonOwner と同じ）。

```ts
export function __inject(payload: any, loc: string): __DynVal {
  return __dynAt(payload, loc);
}

export function __cast(v: __DynVal, loc: string): any {
  __bind(v.loc, loc);
  if (__isHere(loc) || __isEvery(loc)) {
    return v.payload;
  } else {
    return null;
  }
}
```

integer から float への変換を伴う場合は、3.4 節のとおりである。

***

## 10. Operators

### 10.1 Binary Operators

対象: `+`, `-`, `*`, `/`, `%` → `__dynPlus`, `__dynSub`, `__dynMul`, `__dynDiv`, `__dynMod`

`string + string` も `__dynPlus` で扱う。

EPP:

```ts
// ChoreoBS
// let valDyn: integer@dyn = 3@dyn;
// let valAlice: integer@alice = 5@alice;
// let valEvery: integer@every = 6@every;
valDyn + valDyn;
valDyn + valAlice;
valAlice + valAlice;
valDyn + valEvery;

// After EPP at alice
__dynPlus(valDyn, valDyn);
__dynPlus(valDyn, __inject(valAlice, "alice"));
valAlice + valAlice;
__dynPlus(valDyn, __inject(valEvery, "every"));

// After EPP at bob
__dynPlus(valDyn, valDyn);
__dynPlus(valDyn, __inject(null, "alice"));
// nothing(null, null); is removed
__dynPlus(valDyn, __inject(valEvery, "every"));
```

`__dynSub`、`__dynMul`、`__dynDiv`、`__dynMod` についても同様である。

ランタイム関数:

```ts
export function __dynPlus(left: __DynVal, right: __DynVal): __DynVal {
  const loc = __unify(left.loc, right.loc);
  if (__holdsPayload(loc)) {   // unbound、every、または自分が owner
    return new __DynVal(left.payload + right.payload, left.loc);
  } else {
    return new __DynVal(null, left.loc);
  }
}
```

結果は、左オペランドのロケーション変数を共有する。`__unify` の後は両オペランドが同じクラスにあるので、結果のロケーションもオペランドと一致する。

### 10.2 Logical Operators

対象: `&&`, `||` → `__dynAnd`, `__dynOr`

静的な `&&` / `||` と同様に、短絡評価は行わない。両オペランドは、呼び出し前にすべて評価される。
EPP とランタイム関数の実装は Binary Operators と同様である。

### 10.3 Comparison Operators

対象: `<`, `<=`, `>`, `>=`, `===`, `!==` → `__dynLt`, `__dynLe`, `__dynGt`, `__dynGe`, `__dynEq`, `__dynNeq`

EPP とランタイム関数の実装は Binary Operators と同様である。

### 10.4 Unary Operators

対象: `!`, `-` → `__dynNot`, `__dynNeg`

EPP:

```ts
// ChoreoBS
// let a: boolean@dyn = false@dyn;
// let n: integer@dyn = 1@dyn;
a = !a;
n = -n;

// After EPP at alice / bob（共通）
a = __dynNot(a);
n = __dynNeg(n);
```

ランタイム関数:

```ts
export function __dynNot(v: __DynVal): __DynVal {
  const loc = __find(v.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal(!v.payload, v.loc);
  } else {
    return new __DynVal(null, v.loc);
  }
}
```

`__dynNeg` も同様である。

### 10.5 integer から float への変換

```ts
export function __dynToFloat(v: __DynVal): __DynVal {
  const loc = __find(v.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal(v.payload as float, v.loc);
  } else {
    return new __DynVal(null, v.loc);
  }
}
```

***

## 11. Transfer Operators

対象: `<-` → `__dynTransfer`

- 宛先が `dyn` の場合、fresh な unbound の結果を生成する。
  - コピー元が individual location に bound されている場合は、結果の payload を全エンドポイントへ複製するために broadcast する。
- 宛先が具体ロケーションの場合、fresh で、そのロケーションに bound された結果を生成する。
- いずれの場合も、コピー元のロケーション変数は変更しない。
- `kind` は宛先の base type の種別である。
  - 値は `spec.md` §communication-api の8種類（`"integer"` / `"float"` / `"boolean"` / `"string"` / `"null"` / `"integerArray"` / `"floatArray"` / `"booleanArray"`）のいずれか。
  - 静的版が宛先の型で API を選ぶのと同じである。
  - source は 3.5 節で宛先の base type へ変換済みなので、送信側と受信側は同じ API を選ぶ。

### 11.1 タグ

- **動的転送**（送信元と宛先の少なくとも一方が `dyn` の転送）には、実行時に通信するかどうかに関係なく、タグを1つ割り当てる。
- 動的転送は 3.5 節で `__dynTransfer` の呼び出しに書き換えられている。タグは、その `tag` 引数に入れる。
- 通信タグの採番（`spec.md` §communication-tags）は、静的転送と `__dynTransfer` の呼び出しを同じカウンタで数える。
  順序は、書き換え前の転送のソース順である。
- 1回の実行で使うのは send か broadcast のどちらか一方なので、タグは1つで足りる。
- 静的転送だけのプログラムでは、採番は今と変わらない。

### 11.2 EPP

```ts
// ChoreoBS
// let valDyn1: integer@dyn = 4@dyn;
// let valDyn2: integer@dyn = 5@dyn;
// let valAlice: integer@alice = 6@alice;
// function f() { return 3; }   // 戻り値型は integer@dyn
// function g() { return 4; }
let valDyn3: integer@dyn <- valDyn1;
let valDyn4: integer@dyn <- valAlice;
let valBob1: integer@bob <- valDyn1;
let valBob2: integer@bob <- valAlice;    // 静的転送
valDyn2 <- valDyn1;
valDyn2 <- valAlice;
valBob1 <- valDyn1;
valBob1 <- valAlice;                     // 静的転送
let x: integer@dyn <- f() + g();

// After EPP at alice
let valDyn3: __DynVal = __dynTransfer("__top_0", "integer", "dyn", valDyn1);
let valDyn4: __DynVal = __dynTransfer("__top_1", "integer", "dyn", __inject(valAlice, "alice"));
__cast(__dynTransfer("__top_2", "integer", "bob", valDyn1), "bob");
sendInteger("bob", "__top_3", valAlice);
valDyn2 = __dynTransfer("__top_4", "integer", "dyn", valDyn1);
valDyn2 = __dynTransfer("__top_5", "integer", "dyn", __inject(valAlice, "alice"));
__cast(__dynTransfer("__top_6", "integer", "bob", valDyn1), "bob");
sendInteger("bob", "__top_7", valAlice);
let x: __DynVal = __dynTransfer("__top_8", "integer", "dyn", __dynPlus(f(), g()));

// After EPP at bob
let valDyn3: __DynVal = __dynTransfer("__top_0", "integer", "dyn", valDyn1);
let valDyn4: __DynVal = __dynTransfer("__top_1", "integer", "dyn", __inject(null, "alice"));
let valBob1: integer = __cast(__dynTransfer("__top_2", "integer", "bob", valDyn1), "bob");
let valBob2: integer = receiveInteger("alice", "__top_3");
valDyn2 = __dynTransfer("__top_4", "integer", "dyn", valDyn1);
valDyn2 = __dynTransfer("__top_5", "integer", "dyn", __inject(null, "alice"));
valBob1 = __cast(__dynTransfer("__top_6", "integer", "bob", valDyn1), "bob");
valBob1 = receiveInteger("alice", "__top_7");
let x: __DynVal = __dynTransfer("__top_8", "integer", "dyn", __dynPlus(f(), g()));
```

`f` と `g` は、どのエンドポイントでも `function f(): __DynVal { return __dynUnbound(3); }` になる。

integer から float へ転送する例（上の例の続きなので、タグは `__top_9`）:

```ts
// ChoreoBS
let fb: float@bob <- valDyn1;

// After EPP at alice
__cast(__dynTransfer("__top_9", "float", "bob", __dynToFloat(valDyn1)), "bob");

// After EPP at bob
let fb: float = __cast(__dynTransfer("__top_9", "float", "bob", __dynToFloat(valDyn1)), "bob");
```

### 11.3 ランタイム関数

```ts
function __copyPayload(kind: string, v: any): any {
  if (kind === "integerArray") {
    return cloneIntegerArray(v);
  } else if (kind === "floatArray") {
    return cloneFloatArray(v);
  } else if (kind === "booleanArray") {
    return cloneBooleanArray(v);
  } else {
    return v;   // スカラー値はそのまま
  }
}

function __sendAny(to: string, tag: string, kind: string, v: any): void {
  if (kind === "integer") { sendInteger(to, tag, v); }
  else if (kind === "float") { sendFloat(to, tag, v); }
  else if (kind === "boolean") { sendBoolean(to, tag, v); }
  else if (kind === "string") { sendString(to, tag, v); }
  else if (kind === "null") { sendNull(to, tag, v); }
  else if (kind === "integerArray") { sendIntegerArray(to, tag, v); }
  else if (kind === "floatArray") { sendFloatArray(to, tag, v); }
  else { sendBooleanArray(to, tag, v); }
}

function __receiveAny(from: string, tag: string, kind: string): any {
  if (kind === "integer") { return receiveInteger(from, tag); }
  else if (kind === "float") { return receiveFloat(from, tag); }
  else if (kind === "boolean") { return receiveBoolean(from, tag); }
  else if (kind === "string") { return receiveString(from, tag); }
  else if (kind === "null") { return receiveNull(from, tag); }
  else if (kind === "integerArray") { return receiveIntegerArray(from, tag); }
  else if (kind === "floatArray") { return receiveFloatArray(from, tag); }
  else { return receiveBooleanArray(from, tag); }
}

function __broadcastAny(tag: string, kind: string, v: any): void {
  // __sendAny と同様に kind で broadcastInteger などへ分岐する
}

export function __dynTransfer(tag: string, kind: string, to: string, v: __DynVal): __DynVal {
  const from = __find(v.loc);
  if (from === "" || __isEvery(from)) {
    // unbound または every: 全エンドポイントが payload を持つので、通信しない
    if (__isDyn(to)) {
      return __dynUnbound(__copyPayload(kind, v.payload));
    } else if (__isEvery(to) || __isHere(to)) {
      return __dynAt(__copyPayload(kind, v.payload), to);
    } else {
      return __dynAt(null, to);
    }
  } else if (__isHere(from)) {
    // individual location で、自分が owner
    if (__isDyn(to)) {
      __broadcastAny(tag, kind, v.payload);
      return __dynUnbound(__copyPayload(kind, v.payload));
    } else if (__isEvery(to)) {
      __broadcastAny(tag, kind, v.payload);
      return __dynAt(__copyPayload(kind, v.payload), to);
    } else if (__isHere(to)) {
      return __dynAt(__copyPayload(kind, v.payload), to);
    } else {
      __sendAny(to, tag, kind, v.payload);
      return __dynAt(null, to);
    }
  } else {
    // individual location で、自分は owner でない
    if (__isDyn(to)) {
      return __dynUnbound(__receiveAny(from, tag, kind));
    } else if (__isEvery(to) || __isHere(to)) {
      return __dynAt(__receiveAny(from, tag, kind), to);
    } else {
      return __dynAt(null, to);
    }
  }
}
```

分岐は論文の D-DynCopyDyn* / D-DynCopy* 規則と一対一に対応する。`every` の行は論文の範囲外で、本書で追加したものである。
どの分岐でも、fresh なロケーション変数をちょうど1つ作る。

***

## 12. Arrays

静的な配列に dyn の index や値を使う操作も、動的操作にする（3.2 節）。静的なオペランドは inject する。

### 12.1 Array get

対象: `arr[i]` → `__dynArrayGet`

```ts
// ChoreoBS
// let arrDyn: integer[]@dyn = [1, 3, 4]@dyn;
// let arrAlice: integer[]@alice = [1, 3, 4]@alice;
// let iDyn: integer@dyn = 0@dyn;
// let iAlice: integer@alice = 0@alice;
arrDyn[iDyn];
arrAlice[iDyn];
arrDyn[iAlice];
arrAlice[iAlice];

// After EPP at alice
__dynArrayGet(arrDyn, iDyn);
__dynArrayGet(__inject(arrAlice, "alice"), iDyn);
__dynArrayGet(arrDyn, __inject(iAlice, "alice"));
arrAlice[iAlice];

// After EPP at bob
__dynArrayGet(arrDyn, iDyn);
__dynArrayGet(__inject(null, "alice"), iDyn);
__dynArrayGet(arrDyn, __inject(null, "alice"));
// nothing(null, null) is removed
```

ランタイム関数:

```ts
export function __dynArrayGet(arr: __DynVal, i: __DynVal): __DynVal {
  const loc = __unify(arr.loc, i.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal(arr.payload[i.payload], arr.loc);
  } else {
    return new __DynVal(null, arr.loc);
  }
}
```

### 12.2 Array set

対象: `arr[i] = e;` → `__dynArraySet`

```ts
// ChoreoBS
// （宣言は 12.1 に加えて）
// let valDyn: integer@dyn = 5@dyn;
// let valAlice: integer@alice = 5@alice;
arrDyn[iDyn] = valDyn;
arrDyn[iDyn] = valAlice;
arrAlice[iDyn] = valDyn;
arrAlice[iDyn] = valAlice;
arrDyn[iAlice] = valDyn;
arrDyn[iAlice] = valAlice;
arrAlice[iAlice] = valDyn;
arrAlice[iAlice] = valAlice;

// After EPP at alice
__dynArraySet(arrDyn, iDyn, valDyn);
__dynArraySet(arrDyn, iDyn, __inject(valAlice, "alice"));
__dynArraySet(__inject(arrAlice, "alice"), iDyn, valDyn);
__dynArraySet(__inject(arrAlice, "alice"), iDyn, __inject(valAlice, "alice"));
__dynArraySet(arrDyn, __inject(iAlice, "alice"), valDyn);
__dynArraySet(arrDyn, __inject(iAlice, "alice"), __inject(valAlice, "alice"));
__dynArraySet(__inject(arrAlice, "alice"), __inject(iAlice, "alice"), valDyn);
arrAlice[iAlice] = valAlice;

// After EPP at bob
__dynArraySet(arrDyn, iDyn, valDyn);
__dynArraySet(arrDyn, iDyn, __inject(null, "alice"));
__dynArraySet(__inject(null, "alice"), iDyn, valDyn);
__dynArraySet(__inject(null, "alice"), iDyn, __inject(null, "alice"));
__dynArraySet(arrDyn, __inject(null, "alice"), valDyn);
__dynArraySet(arrDyn, __inject(null, "alice"), __inject(null, "alice"));
__dynArraySet(__inject(null, "alice"), __inject(null, "alice"), valDyn);
// nothing(null, null); is removed
```

関与する具体ロケーションが2種類以上になる組み合わせ（例: `arrDyn[iAlice] = valBob`）は、3.2 節により静的エラーである。

ランタイム関数:

```ts
export function __dynArraySet(arr: __DynVal, i: __DynVal, v: __DynVal): void {
  __unify(arr.loc, i.loc);
  const loc = __unify(i.loc, v.loc);
  if (__holdsPayload(loc)) {
    arr.payload[i.payload] = v.payload;
  }
}
```

引数は `arr`、`i`、`v` の順に評価される。これは `spec.md` §evaluation-order の順序と同じである。

### 12.3 Push and Length

対象: `xs.push()`, `xs.length` → `__dynArrayPush`, `__dynArrayLength`

```ts
// ChoreoBS
// let arrDyn: integer[]@dyn = [1, 3, 4]@dyn;
// let arrAlice: integer[]@alice = [1, 3, 4]@alice;
// let valDyn: integer@dyn = 5@dyn;
// let valAlice: integer@alice = 5@alice;
arrDyn.push(valDyn);
arrDyn.push(valAlice);
arrAlice.push(valDyn);
arrAlice.push(valAlice);
arrDyn.length;
arrAlice.length;

// After EPP at alice
__dynArrayPush(arrDyn, valDyn);
__dynArrayPush(arrDyn, __inject(valAlice, "alice"));
__dynArrayPush(__inject(arrAlice, "alice"), valDyn);
arrAlice.push(valAlice);
__dynArrayLength(arrDyn);
arrAlice.length;

// After EPP at bob
__dynArrayPush(arrDyn, valDyn);
__dynArrayPush(arrDyn, __inject(null, "alice"));
__dynArrayPush(__inject(null, "alice"), valDyn);
// nothing(null) is removed
__dynArrayLength(arrDyn);
// null is removed
```

ランタイム関数:

```ts
export function __dynArrayPush(arr: __DynVal, v: __DynVal): void {
  const loc = __unify(arr.loc, v.loc);
  if (__holdsPayload(loc)) {
    arr.payload.push(v.payload);
  }
}

export function __dynArrayLength(arr: __DynVal): __DynVal {
  const loc = __find(arr.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal(arr.payload.length, arr.loc);
  } else {
    return new __DynVal(null, arr.loc);
  }
}
```

`.length` の結果は、配列のロケーション変数を共有する。これは静的な規則 `xs.length : integer@L` と同じである。

### 12.4 配列リテラル用の関数

5.2 節で使う。

```ts
export function __dynArrayNew(kind: string): __DynVal {
  if (kind === "integerArray") {
    const a: integer[] = [];
    return __dynUnbound(a);
  } else if (kind === "floatArray") {
    const a: float[] = [];
    return __dynUnbound(a);
  } else {
    const a: boolean[] = [];
    return __dynUnbound(a);
  }
}

export function __dynArrayAppend(arr: __DynVal, v: __DynVal): __DynVal {
  __dynArrayPush(arr, v);
  return arr;
}
```

### 12.5 unbound の配列と non-owner

1. unbound の配列は、全エンドポイントが同じ変更を行うので、同じ内容を保つ。
2. 後から individual location に bound されると、owner だけが変更を続け、non-owner の payload は古いまま残る。
3. 1 節のとおり、bound 状態の non-owner の payload は未規定で、読まれない。ランタイム関数は、bound 状態では payload に触る前に必ずロケーションを確認する。

***

## 13. 関数定義・関数呼び出し

ローカル関数内では、ロケーションを省略してはいけない。`@dyn` も使えない（3.6 節）。

### 13.1 引数

```ts
// ChoreoBS
// let valDyn: integer@dyn = 5@dyn;
// let valAlice: integer@alice = 5@alice;
function funcDyn(a: integer) {}              // a : integer@dyn
function funcAlice(a: integer@alice) {}      // choreography 関数
funcDyn(valDyn);
funcDyn(valAlice);
funcAlice(valDyn);
funcAlice(valAlice);

// After EPP at alice
function funcDyn(a: __DynVal): void {}
function funcAlice(a: integer): void {}
funcDyn(valDyn);
funcDyn(__inject(valAlice, "alice"));
funcAlice(__cast(valDyn, "alice"));
funcAlice(valAlice);

// After EPP at bob
function funcDyn(a: __DynVal): void {}
function funcAlice(a: null): void {}
funcDyn(valDyn);
funcDyn(__inject(null, "alice"));
funcAlice(__cast(valDyn, "alice"));
funcAlice(null);
```

ローカル関数に dyn の値を渡す場合、callee を持たないエンドポイントにも cast が残る（8.2 節）。

```ts
// ChoreoBS
function useAlice@alice(a: integer@alice): void { … }
useAlice(valDyn);

// After EPP at alice
useAlice(__cast(valDyn, "alice"));

// After EPP at bob
nothing(__cast(valDyn, "alice"));
```

### 13.2 return

戻り値型が dyn の関数では、静的な値を inject して返す。

```ts
// ChoreoBS
function boo(flag: boolean@every) {          // 戻り値型は integer@dyn（4.5 節）
    if (flag) { return 3@alice; }
    else { return 4@every; }
}

// After EPP at alice
function boo(flag: boolean): __DynVal {
    if (flag) { return __inject(3, "alice"); }
    else { return __inject(4, "every"); }
}

// After EPP at bob
function boo(flag: boolean): __DynVal {
    if (flag) { return __inject(null, "alice"); }
    else { return __inject(4, "every"); }
}
```

戻り値型が静的な関数で dyn の値を返す場合は、cast する。

```ts
// ChoreoBS
function toAlice(a: integer@dyn): integer@alice {
    return a;
}

// After EPP at alice
function toAlice(a: __DynVal): integer {
    return __cast(a, "alice");
}

// After EPP at bob
function toAlice(a: __DynVal): null {
    return __cast(a, "alice");
}
```

***

## 14. 変数宣言と代入

### 14.1 変数宣言

```ts
// ChoreoBS
let valDyn1: integer@dyn = 3@dyn;
let valDyn2: integer@dyn = 3@alice;
let valAlice1: integer@alice = 3@dyn;
let valAlice2: integer@alice = 3@alice;

// After EPP at alice
let valDyn1: __DynVal = __dynUnbound(3);
let valDyn2: __DynVal = __inject(3, "alice");
let valAlice1: integer = __cast(__dynUnbound(3), "alice");
let valAlice2: integer = 3;

// After EPP at bob
let valDyn1: __DynVal = __dynUnbound(3);
let valDyn2: __DynVal = __inject(null, "alice");
__cast(__dynUnbound(3), "alice");
// null is removed
```

### 14.2 代入

ロケーション変数は、変数ではなく動的配置値に属する。

- 代入は、変数が参照する動的配置値を置き換える。
- 以前の値と、そのロケーション制約は変更しない。

```ts
// ChoreoBS
// let valDyn: integer@dyn = 3@dyn;
// let valAlice: integer@alice = 3@alice;
valDyn = 4@dyn;
valDyn = 4@alice;
valAlice = 5@dyn;
valAlice = 5@alice;

// After EPP at alice
valDyn = __dynUnbound(4);
valDyn = __inject(4, "alice");
valAlice = __cast(__dynUnbound(5), "alice");
valAlice = 5;

// After EPP at bob
valDyn = __dynUnbound(4);
valDyn = __inject(null, "alice");
__cast(__dynUnbound(5), "alice");
// null is removed
```

***

## 15. Condition

choreography 文脈の条件は `boolean@every` が要求されるので、dyn の条件は `every` へ cast する。
値が別の individual location に bound されていれば、location error になる。

```ts
// ChoreoBS
// let boolDyn: boolean@dyn = true@dyn;
if (boolDyn) {}
while (boolDyn) {}
for (let i = 0; i < 10; i = i + 1) {}

// After EPP at alice / bob（共通）
if (__cast(boolDyn, "every")) {}
while (__cast(boolDyn, "every")) {}
for (let i: __DynVal = __dynUnbound(0); __cast(__dynLt(i, __dynUnbound(10)), "every"); i = __dynPlus(i, __dynUnbound(1))) {}
```

`for` の例では、最初の条件評価で `i` のロケーション変数が `every` に bound される。
以降の `i + 1` の結果もそのロケーション変数を共有するので、ループ中は `every` のままである。
リテラル `10` と `1` は1周ごとに fresh なロケーション変数を作るが、使い終われば GC で回収される（6.1 節）。

***

## 16. 要確認事項

BlueScript の挙動に依存していて、まだ確認していない点。
実装前に、小さな確認用の `.bs` を BlueScript 上で動かして決める。

1. **`any` に対する操作が、静的版と同じ結果になるか。**
   - 対象: `[]`・`.length`・`.push`・算術（`integer / integer`、`%`、`integer + float`、文字列の `+`）・比較（`===`）。
   - 本書のランタイムは、これらが使える前提で書いている。
   - 特に、**integer と float が混ざる算術の結果が float になること**。
     dyn の二項演算では、integer 側のオペランドを変換しない（3.3 節の `coerce` の適用位置に二項演算は含まない）。
     そのため、payload の表現の不変条件（1 節）はこの挙動に依存している。
   - 使えない、または結果が違う場合は、該当する動的演算・配列操作にも `kind` を渡す。
     関数の中で `const a: integer[] = arr.payload;` のように型付きの変数へ戻してから操作する。
2. **`any` から静的型への暗黙の変換。**
   - 例: `let x: integer = __cast(...)`、条件位置の `__cast(...)`、`return __cast(...)`。
   - 変換されない場合は、3.4 節の変換ノード `widen` を `as T` に広げ、静的な位置で使う `__cast` の結果に付ける。
3. **`__LocVar` の書き方。**
   - クラスのフィールドに自クラス型を持てるか（`parent: __LocVar`）。
   - コンストラクタで `this` をフィールドに入れられるか。
   - `===` がオブジェクトの参照比較になるか。
4. **GC。** 到達不能になった `__LocVar` と `__DynVal` が回収されるか。
5. **`__locationError` の中身。** `throw` が使えるか。使えない場合のプラットフォームの停止関数は何か。

***

## 付録 A. spec.md への反映箇所

spec.md の節は、リポジトリの規約（`scripts/spec/README.md`）に従って slug で示す。

| spec.md の節 | 変更 | 本書 |
|---|---|---|
| §input-files | 入力ファイルの basename は `__` で始まってはならない | 7.1 節 |
| §choreobs-json | `implicitDyn` フィールドを追加する。`dyn` はエンドポイント名にできない | 4.2 節、2 節 |
| §output-files、§output-file-naming | `@dyn` を含む場合は `__runtime_<endpoint>.bs` も出力する | 7.1 節 |
| §locations | `Location ::= ConcreteLocation \| dyn` | 2 節 |
| §keywords | `dyn` を予約語に加える | 2 節 |
| §array-literals | 注釈の無い配列リテラルは `@dyn`。要素と配列のロケーション違いは `~` で判定する | 5.2 節 |
| §subtyping、§operators | 部分型は dyn でも保つ。int→float は変換ノード `widen`（`as float`）。payload の表現の不変条件 | 1 節、3.4 節 |
| §location-matching-and-residency | `~` と `⊔` を追加する。`residesAt(dyn, P) = true` | 2.1 節、3.1 節 |
| §assignment-typing 〜 §return-typing | `match` を `~` に置き換える。結果ロケーションは `⊔` で決める。`coerce` の挿入位置 | 3.2 節、3.3 節 |
| §let-type-inference、§function-return-type-inference | 戻り値型の部分注釈。ロケーションの lub が取れなければ dyn | 4.3 節 |
| §transfer-let-does-not-infer-destination-type、§transfer-let-without-type-annotation | 宛先のロケーションを省略した転送 `let` は dyn になる（型の無い `let y <- x;` はエラーのまま） | 4.1 節、4.4 節 |
| §explicit-location-annotations、§every-literals、§location-annotation-omission | 省略は dyn（`implicitDyn: false` では現行どおりエラー） | 4.1 節、4.2 節 |
| §local-function-strict-location-rule | ローカル関数では dyn を全面禁止 | 3.6 節 |
| §transfer-typing | 動的転送は `let` / 代入と `__dynTransfer` の呼び出しに書き換える | 3.5 節 |
| §communication-tags | 静的転送と `__dynTransfer` の `tag` 引数を、同じカウンタでソース順に採番する | 11.1 節 |
| §type-projection | `T@dyn → __DynVal` | 8.1 節 |
| §expression-projection | 組み込み関数は、全エンドポイントで生成される callee として扱う（discard の表の行も、不変条件の例外も追加しない）。`widen` の discard は括弧と同じ | 8.2 節、8.3 節 |
| §type-mapping | `T@dyn → __DynVal` | 8.1 節 |
| §communication-api | `kind` による分岐 | 11.3 節 |
| §projected-ast-cleanup | 組み込み関数の呼び出しは、通常の呼び出しとして残る | 8.2 節 |
| §runtime-support-functions | 動的操作のランタイムを追加する。`nothing` / `__and` / `__or` は今までどおり外部供給 | 6 節、7.2 節 |
| §incompatible-inferred-return-locations | `implicitDyn: false` のときだけエラー | 4.2 節 |
| §gradual-features | 実装した項目（省略、location inference の一部、runtime location checks）を削除する | — |
